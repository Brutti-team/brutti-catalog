export const PROJECT_URL = 'https://lgdjoxafleqnbomtfzqt.supabase.co';
export const PROJECT_REF = new URL(PROJECT_URL).hostname.split('.')[0];

export function backendConfig(env = process.env) {
  const url = (env.VITE_SUPABASE_URL || '').trim();
  const key = (env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY || '').trim();
  if (url !== PROJECT_URL) throw new Error('Use the existing Brutti project URL: ' + PROJECT_URL);
  if (!key) throw new Error('Set the public publishable/anon key securely in environment settings.');
  if (key.startsWith('sb_secret_')) throw new Error('Private Supabase keys are forbidden.');
  if (!key.startsWith('sb_publishable_')) {
    let claims;
    try { claims = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()); }
    catch { throw new Error('A valid public Supabase publishable/anon key is required.'); }
    if (claims.role !== 'anon') throw new Error('Only the public anon key may be used.');
    if (claims.ref !== PROJECT_REF) throw new Error('The public anon key must belong to the existing Brutti project.');
  }
  return { url, key };
}

const knownErrorCodes = new Set([
  'NoSuchBucket', 'bad_jwt', 'session_not_found', 'not_authenticated',
  'invalid_token', 'no_authorization', 'AuthSessionMissingError',
]);

function safeErrorCode(data) {
  for (const code of [data?.code, data?.error_code, data?.error]) {
    if (typeof code === 'string' && (/^\d{5}$/.test(code) || /^PGRST\d{3}$/.test(code) || knownErrorCodes.has(code))) return code;
  }
  return null;
}

// Error response bodies and network exception messages can contain credentials.
// Keep only HTTP evidence and known structured error codes in returned failures.
export async function readOnlyJson(url, headers, { fetchImpl = fetch } = {}) {
  const requestedAt = new Date().toISOString();
  let response;
  try {
    response = await fetchImpl(url, { method: 'GET', headers, signal: AbortSignal.timeout(15000) });
  } catch {
    return { ok: false, status: null, requestedAt, completedAt: new Date().toISOString(), errorCode: 'NETWORK_ERROR', data: null };
  }
  let data;
  try { data = await response.json(); }
  catch {
    return { ok: false, status: response.status, requestedAt, completedAt: new Date().toISOString(), errorCode: 'INVALID_JSON', data: null };
  }
  return {
    ok: response.ok, status: response.status, requestedAt, completedAt: new Date().toISOString(),
    errorCode: response.ok ? null : safeErrorCode(data), data: response.ok ? data : null,
  };
}

export function requestEvidence({ ok, status, requestedAt, completedAt, errorCode }) {
  return { ok, status, requestedAt, completedAt, errorCode };
}

export async function requestJson(url, headers, options) {
  const result = await readOnlyJson(url, headers, options);
  if (!result.ok) throw new Error(`Read-only backend request failed (${result.status === null ? 'network unavailable' : `HTTP ${result.status}`}).`);
  return result.data;
}
