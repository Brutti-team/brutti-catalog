import { catalogClient } from "./catalog";

export type Photo3DJob = {
  id: string;
  status: "creating" | "processing" | "ready" | "failed";
  progress?: number;
  error?: string;
  failureReason?: string;
};
export type Photo3DResponse = {
  configured?: boolean;
  job?: Photo3DJob | null;
  resumed?: boolean;
};
type Action = "config" | "start" | "status" | "download";

async function callPhoto3D(action: Action, productId: string, args: {
  imageIds?: string[]; jobId?: string
} = {}): Promise<Response> {
  const db = catalogClient();
  const { data: { session }, error } = await db.auth.getSession();
  if (error || !session?.access_token) throw new Error("Sign in to Brutti Catalog before generating 3D.");
  const url = (import.meta.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
  const apikey = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    import.meta.env.VITE_SUPABASE_ANON_KEY || "").trim();
  if (!url || !apikey) throw new Error("Brutti Catalog is not connected to Supabase.");
  const response = await fetch(url + "/functions/v1/catalog-image-to-3d", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + session.access_token,
      apikey,
    },
    body: JSON.stringify({ action, productId, ...args }),
  });
  if (!response.ok) {
    const details = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(details?.error || "Could not reach the 3D generation service. Try again.");
  }
  return response;
}
export async function photo3DRequest(action: Exclude<Action, "download">,
  productId: string, args: { imageIds?: string[]; jobId?: string } = {}): Promise<Photo3DResponse> {
  const response = await callPhoto3D(action, productId, args);
  return await response.json() as Photo3DResponse;
}
export async function downloadGenerated3D(productId: string, jobId: string): Promise<File> {
  const response = await callPhoto3D("download", productId, { jobId });
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength < 20 || bytes.byteLength > 48 * 1024 * 1024 ||
    new TextDecoder().decode(bytes.slice(0, 4)) !== "glTF") {
    throw new Error("Generated model is not a valid GLB. Please try again.");
  }
  return new File([bytes], "generated-model.glb", { type: "model/gltf-binary" });
}
