import { expect, it } from 'vitest';
import { assertBuildCredentials } from '../scripts/build-credentials';

it('refuses private or authenticated-user credentials before bundling', () => {
  for (const role of ['service_role', 'authenticated']) {
    const token = `header.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.signature`;
    expect(() => assertBuildCredentials({ VITE_SUPABASE_ANON_KEY: token })).toThrow(/public/);
  }
  expect(() => assertBuildCredentials({ VITE_SUPABASE_ANON_KEY: 'sb_secret_test' })).toThrow(/Private/);
  expect(() => assertBuildCredentials({ VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test', VITE_SUPABASE_ANON_KEY: 'sb_secret_test' })).toThrow(/Private/);
});
it('allows unconfigured source checks and public-only configured builds', () => {
  expect(() => assertBuildCredentials({})).not.toThrow();
  expect(() => assertBuildCredentials({ VITE_SUPABASE_ANON_KEY: 'sb_publishable_test' })).not.toThrow();
  const token = `header.${Buffer.from(JSON.stringify({ role: 'anon' })).toString('base64url')}.signature`;
  expect(() => assertBuildCredentials({ VITE_SUPABASE_ANON_KEY: token })).not.toThrow();
});
it('rejects an opaque password or malformed JWT placed in a browser variable', () => {
  expect(() => assertBuildCredentials({ VITE_SUPABASE_ANON_KEY: 'not-a-public-key' })).toThrow(/public/);
  expect(() => assertBuildCredentials({ VITE_SUPABASE_ANON_KEY: 'header.bad.signature' })).toThrow(/Invalid/);
});
