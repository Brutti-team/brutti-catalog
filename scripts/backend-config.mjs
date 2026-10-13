export const PROJECT_URL = 'https://lgdjoxafleqnbomtfzqt.supabase.co';

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
  }
  return { url, key };
}

export async function requestJson(url, headers) {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Read-only backend request failed (HTTP ${response.status}).`);
  return response.json();
}
