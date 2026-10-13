/** Fail before Vite embeds a private key in any browser bundle. */
export function assertBuildCredentials(env: Record<string, string | undefined>): void {
  for (const value of [env.VITE_SUPABASE_PUBLISHABLE_KEY, env.VITE_SUPABASE_ANON_KEY]) {
  const key = (value || '').trim();
  if (!key) continue; // Source-only compilation is allowed; configured builds have a separate live gate.
  if (key.startsWith('sb_secret_')) throw new Error('Private Supabase credentials cannot be bundled.');
  if (key.startsWith('sb_publishable_')) continue;
  if (key.includes('.')) {
    let claims: { role?: string };
    try { claims = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()); }
    catch { throw new Error('Invalid public browser key; build refused.'); }
    if (claims.role !== 'anon') throw new Error('Only public anon/publishable keys can be bundled.');
    continue;
  }
  throw new Error('A public anon/publishable key is required when configuring a browser build.');
  }
}
