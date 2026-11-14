import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.110.0";

// All provider calls and keys remain server-side. RLS blocks all client reads
// from catalog_3d_jobs. No model is published until the editor saves the product.
type Job = {
  id: string; product_id: string; provider_task_id: string | null;
  status: "creating" | "processing" | "ready" | "failed";
  failure_reason: string | null; created_at: string;
};
type RequestBody = {
  action?: "config" | "start" | "status" | "download";
  productId?: string;
  imageIds?: string[];
  jobId?: string;
};
type ProviderTask = {
  id?: string; status?: string; progress?: number;
  error?: string; model_ready?: boolean;
};

const allowedOrigins = new Set([
  "https://brutti-team.github.io",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:4173",
]);
const maxGlbBytes = 48 * 1024 * 1024;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// This URL and bearer token are server-only Supabase Edge Function secrets.
// Never accept worker addresses from user input.
const rawWorkerUrl = Deno.env.get("BRUTTI_3D_WORKER_URL")?.trim() ?? "";
const workerUrl = rawWorkerUrl.endsWith("/") ? rawWorkerUrl.slice(0, -1) : rawWorkerUrl;
const workerToken = Deno.env.get("BRUTTI_3D_WORKER_TOKEN")?.trim();
function workerConfigured(): boolean {
  if (!workerUrl || !workerToken || workerToken.length < 24) return false;
  try {
    const address = new URL(workerUrl);
    const host = address.hostname.toLowerCase();
    const local = host === "localhost" || host.endsWith(".local") ||
      host.endsWith(".localhost") || host.includes(":") ||
      ["127.", "10.", "192.168.", "169.254."].some(prefix => host.startsWith(prefix));
    return address.protocol === "https:" && !local &&
      !address.username && !address.password && !address.port &&
      !/^[0-9.]+$/.test(host) && !address.search && !address.hash &&
      address.pathname === "/";
  } catch { return false; }
}
async function workerFetch(path: string, options: RequestInit = {}, timeoutMs = 16000): Promise<Response> {
  return await fetch(workerUrl + path, {
    ...options,
    redirect: "error",
    headers: { Authorization: "Bearer " + workerToken, ...options.headers },
    signal: AbortSignal.timeout(timeoutMs),
  });
}

function headers(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin && allowedOrigins.has(origin) ? origin : "https://brutti-team.github.io",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
    "Cache-Control": "no-store",
  };
}
function json(data: unknown, status = 200, origin: string | null = null) {
  return Response.json(data, { status, headers: headers(origin) });
}
function failure(message: string, status: number, origin: string | null) {
  return json({ error: message }, status, origin);
}
function workerError(status: number): string {
  if (status === 401 || status === 403) return "GPU worker access rejected. Check server token.";
  if (status === 429 || status === 503) return "GPU worker is busy or offline.";
  if (status === 422) return "The source product photo could not be processed.";
  return "GPU worker could not finish the request. Check its logs.";
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: headers(origin) });
  if (req.method !== "POST") return failure("Method not allowed.", 405, origin);
  if (origin && !allowedOrigins.has(origin)) return failure("Origin not allowed.", 403, origin);
  if (Number(req.headers.get("content-length") || 0) > 8192) return failure("Request too large.", 413, origin);
  const endpoint = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
    || JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}").default;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")
    || JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") || "{}").default;
  const configured = workerConfigured();
  if (!endpoint || !serviceKey || !anonKey) return failure("3D service is not configured.", 503, origin);
  const token = /^Bearer\s+(.+)$/i.exec(req.headers.get("authorization") || "")?.[1];
  if (!token) return failure("Sign in to Brutti Catalog first.", 401, origin);
  const service = createClient(endpoint, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
  // Use the caller's JWT for catalog tables, preserving their existing RLS.
  // The service client is limited to the private catalog_3d_jobs table.
  const userClient = createClient(endpoint, anonKey, {
    global: { headers: { Authorization: "Bearer " + token } },
    auth: { autoRefreshToken: false, persistSession: false }
  });
  const { data: userResult, error: userError } = await userClient.auth.getUser(token);
  if (userError || !userResult.user) return failure("Session expired. Sign in again.", 401, origin);
  const userId = userResult.user.id;
  const { data: member, error: memberError } = await userClient.from("catalog_admins")
    .select("user_id").eq("user_id", userId).maybeSingle();
  if (memberError || !member) return failure("Catalog staff permission is required.", 403, origin);

  let body: RequestBody;
  try { body = await req.json() as RequestBody; }
  catch { return failure("Invalid request.", 400, origin); }
  if (!body || !["config","start","status","download"].includes(body.action || "")) {
    return failure("Unknown request.", 400, origin);
  }
  if (!body.productId || !uuidPattern.test(body.productId)) {
    return failure("Save the product before generating its 3D model.", 400, origin);
  }
  const { data: product, error: productError } = await userClient.from("products")
    .select("id,name,images").eq("id", body.productId).maybeSingle();
  if (productError || !product) return failure("Save the product first, then reopen Edit Product.", 404, origin);

  const getJob = async (): Promise<Job | null> => {
    const { data } = await service.from("catalog_3d_jobs")
      .select("id,product_id,provider_task_id,status,failure_reason,created_at")
      .eq("product_id", product.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
    return (data as Job | null) ?? null;
  };
  const latest = await getJob();

  if (body.action === "config") {
    let online = false;
    if (configured) {
      try {
        const reply = await workerFetch("/health", {}, 4500);
        online = reply.ok && (await reply.json()).status === "healthy";
      } catch { /* No GPU service reachable: fail closed, no billable work. */ }
    }
    return json({
      configured: configured && online,
      engine: "TRELLIS.2 (self-hosted)",
      job: latest && { id: latest.id, status: latest.status, failureReason: latest.failure_reason },
    }, 200, origin);
  }
  if (!configured) return failure("Self-hosted GPU worker is not configured. Set BRUTTI_3D_WORKER_URL and BRUTTI_3D_WORKER_TOKEN in Supabase secrets.", 503, origin);

  const updateJob = async (id: string, values: Record<string, unknown>) => {
    await service.from("catalog_3d_jobs").update({
      ...values, updated_at: new Date().toISOString(),
    }).eq("id", id);
  };

  if (body.action === "start") {
    const imageIds = body.imageIds;
    if (!Array.isArray(imageIds) || imageIds.length !== 1 ||
      imageIds.some(id => typeof id !== "string" || id.length > 100) ||
      new Set(imageIds).size !== imageIds.length) {
      return failure("Select exactly one saved product photo for TRELLIS.2.", 400, origin);
    }
    const photos = Array.isArray(product.images) ? product.images as Array<{
      id?: string; storagePath?: string
    }> : [];
    const selected = imageIds.map(id => photos.find(photo => photo.id === id));
    if (selected.some(photo => !photo || typeof photo.storagePath !== "string" ||
      !photo.storagePath || photo.storagePath.length > 1024 || photo.storagePath.startsWith("/"))) {
      return failure("These photos must be uploaded and saved to the product first.", 400, origin);
    }
    // Preflight the saved image to avoid running GPU inference for missing photos.
    const imageUrls = selected.map(photo => userClient.storage
      .from("product-images").getPublicUrl(photo!.storagePath!).data.publicUrl);
    const probes = await Promise.all(imageUrls.map(async url => {
      try {
        const response = await fetch(url, { method: "HEAD", redirect: "error", signal: AbortSignal.timeout(9000) });
        return response.ok && (response.headers.get("content-type") || "").startsWith("image/");
      } catch { return false; }
    }));
    if (probes.some(ok => !ok)) {
      return failure("Selected photo is unavailable. Save the photo again and retry. No GPU job was started.", 422, origin);
    }
    const { count, error: countError } = await service.from("catalog_3d_jobs")
      .select("id", { count: "exact", head: true }).eq("requested_by", userId)
      .gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
    if (countError) return failure("Unable to check 3D generation quota.", 503, origin);
    if ((count ?? 0) >= 3) return failure("Limit reached: maximum 3 GPU jobs per staff member in 24 hours.", 429, origin);
    if (latest && ["creating", "processing"].includes(latest.status)) {
      const age = Date.now() - Date.parse(latest.created_at);
      if (age < 24 * 60 * 60 * 1000) {
        return json({ job: { id: latest.id, status: latest.status }, resumed: true }, 200, origin);
      }
      await updateJob(latest.id, { status: "failed", failure_reason: "The previous GPU job expired." });
    }

    // Reserve one GPU job per product; the unique index handles parallel clicks.
    const { data: reserved, error: reserveError } = await service.from("catalog_3d_jobs").insert({
      product_id: product.id, requested_by: userId,
      image_ids: imageIds, status: "creating",
    }).select("id").single();
    if (reserveError || !reserved) return failure("Another 3D task is already running for this product.", 409, origin);

    try {
      const result = await workerFetch("/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job_id: reserved.id, image_url: imageUrls[0] }),
      }, 20000);
      if (!result.ok) {
        const message = workerError(result.status);
        await updateJob(reserved.id, { status: "failed", failure_reason: message });
        return failure(message, result.status >= 500 ? 502 : 400, origin);
      }
      const answer = await result.json() as { job_id?: string; status?: string };
      if (answer.job_id !== reserved.id) throw new Error("Mismatched worker job id");
      await updateJob(reserved.id, { status: "processing", provider_task_id: answer.job_id });
      return json({ job: { id: reserved.id, status: "processing" } }, 200, origin);
    } catch {
      // Worker accepts idempotent job IDs, so a connection timeout cannot
      // create duplicate GPU work for this product.
      await updateJob(reserved.id, { status: "failed", failure_reason: "GPU job could not be confirmed. Check worker logs before retrying." });
      return failure("GPU worker could not confirm the job. Check its logs before retrying.", 502, origin);
    }
  }

  if (!latest || !body.jobId || latest.id !== body.jobId) {
    return failure("This 3D task is no longer active. Reopen the editor.", 404, origin);
  }
  if (latest.status === "failed") return json({ job: { id: latest.id, status: "failed", error: latest.failure_reason } }, 200, origin);
  if (!latest.provider_task_id) {
    return json({ job: { id: latest.id, status: latest.status, progress: 0 } }, 200, origin);
  }

  let task: ProviderTask;
  try {
    const result = await workerFetch("/jobs/" + encodeURIComponent(latest.provider_task_id), {}, 16000);
    if (!result.ok) return failure(workerError(result.status), result.status >= 500 ? 502 : 400, origin);
    task = await result.json() as ProviderTask;
  } catch {
    return failure("Could not reach the GPU worker. Check its connection and retry.", 502, origin);
  }
  if (task.status === "failed" || task.status === "error") {
    const message = "3D generation failed on the GPU worker. Try a clearer product photo.";
    await updateJob(latest.id, { status: "failed", failure_reason: message });
    return json({ job: { id: latest.id, status: "failed", error: message } }, 200, origin);
  }
  if (task.status === "completed" && task.model_ready === true) {
    if (latest.status !== "ready") await updateJob(latest.id, { status: "ready" });
    if (body.action === "status") {
      return json({ job: { id: latest.id, status: "ready", progress: 100 } }, 200, origin);
    }
    try {
      const asset = await workerFetch("/jobs/" + encodeURIComponent(latest.provider_task_id) + "/model", {}, 30000);
      if (!asset.ok) return failure("The generated GLB is no longer available on the GPU worker.", 502, origin);
      const advertised = Number(asset.headers.get("content-length") || 0);
      if (advertised > maxGlbBytes) return failure("Generated model exceeds 48 MB. Reduce texture resolution.", 413, origin);
      const bytes = await asset.arrayBuffer();
      if (bytes.byteLength < 20 || bytes.byteLength > maxGlbBytes ||
        new TextDecoder().decode(bytes.slice(0, 4)) !== "glTF") {
        return failure("GPU worker returned an invalid or oversized GLB.", 502, origin);
      }
      return new Response(bytes, {
        headers: {
          ...headers(origin),
          "Content-Type": "application/octet-stream",
          "Content-Disposition": 'attachment; filename="generated-model.glb"',
        },
      });
    } catch {
      return failure("Could not fetch the generated GLB from the GPU worker.", 502, origin);
    }
  }
  if (body.action === "download") return failure("The model is still generating.", 409, origin);
  return json({ job: {
    id: latest.id, status: "processing",
    progress: Math.max(0, Math.min(99, Number(task.progress) || 0)),
  } }, 200, origin);
});
