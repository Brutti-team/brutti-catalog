import { describe, expect, it, vi } from 'vitest';
// @ts-expect-error Native Node operator module intentionally has no browser declaration.
import { verifyLive } from '../scripts/verify-live.mjs';
// @ts-expect-error Native Node operator module intentionally has no browser declaration.
import { CATEGORY_NAMES } from '../scripts/import-manifest.mjs';

const config = { url: 'https://lgdjoxafleqnbomtfzqt.supabase.co', key: 'sb_publishable_test-only-fixture' };
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
const publicRead = async (input: string) => {
  const url = new URL(input);
  if (url.pathname === '/rest/v1/') return response({ message: 'restricted' }, 401);
  if (url.pathname.endsWith('/categories')) return response(CATEGORY_NAMES.map((name: string, i: number) => ({ id: `category-${i}`, name })));
  if (url.pathname === '/auth/v1/settings') return response({ external: { email: true }, disable_signup: false, mailer_autoconfirm: false });
  if (url.pathname === '/auth/v1/user') return response({ error_code: 'no_authorization', message: 'Token SECRET_TEST' }, 401);
  if (url.pathname.endsWith('/catalog_admins')) return response({ code: '42501' }, 401);
  if (url.pathname.endsWith('/catalog_imports')) return response({ code: 'PGRST205' }, 404);
  if (url.pathname.includes('/storage/v1/bucket/')) return response({ error: 'NoSuchBucket' }, 400);
  if (['price_basis', 'display_order'].includes(url.searchParams.get('select') || '')) return response({ code: '42703' }, 400);
  return response([]);
};

describe('safe live verification', () => {
  it('uses only GET by default and keeps empty-catalog and privileged checks blocked', async () => {
    const fetchImpl = vi.fn(async (input: string, _init: RequestInit) => publicRead(input));
    const writeRunner = vi.fn();
    const report = await verifyLive(config, { fetchImpl, env: { CATALOG_ADMIN_ACCESS_TOKEN: 'must-not-use-without-flag' }, writeRunner });
    expect(report.readOnlyChecksPassed).toBe(true);
    expect(report.fullAcceptanceComplete).toBe(false);
    expect(report.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'anonymous-admin-table-denied', status: 'passed' }),
      expect.objectContaining({ id: 'anonymous-unpublished-isolation', status: 'blocked' }),
      expect.objectContaining({ id: 'storage-integration', status: 'blocked' }),
      expect.objectContaining({ id: 'authenticated-crud', status: 'blocked' }),
    ]));
    expect(report.storageMetadata).toMatchObject({ status: 400, bucketExistence: 'unverified' });
    expect(report.authSettings).toMatchObject({ emailEnabled: true, disableSignup: false, emailAutoconfirm: false });
    expect(writeRunner).not.toHaveBeenCalled();
    expect(fetchImpl.mock.calls.every(([, init]) => init.method === 'GET')).toBe(true);
    expect(JSON.stringify(report)).not.toContain('must-not-use-without-flag');
    expect(JSON.stringify(report)).not.toContain('SECRET_TEST');
  });

  it('blocks an explicitly requested write run when the secure admin token is missing', async () => {
    const writeRunner = vi.fn();
    const report = await verifyLive(config, { fetchImpl: publicRead, env: {}, writeTest: true, writeRunner });
    expect(report.writeVerification).toMatchObject({ status: 'blocked' });
    expect(report.writeVerification.reason).toMatch(/CATALOG_ADMIN_ACCESS_TOKEN/);
    expect(writeRunner).not.toHaveBeenCalled();
  });

  it('does not start privileged integration when public project preflight fails', async () => {
    const writeRunner = vi.fn();
    const report = await verifyLive(config, {
      fetchImpl: async () => response({ code: '42501' }, 401),
      env: { CATALOG_ADMIN_ACCESS_TOKEN: 'test-admin-token' }, writeTest: true, writeRunner,
    });
    expect(report.readOnlyChecksPassed).toBe(false);
    expect(report.writeVerification.status).toBe('blocked');
    expect(writeRunner).not.toHaveBeenCalled();
  });

  it('redacts unexpected write-runner error bodies and marks cleanup unverified', async () => {
    const writeRunner = vi.fn(async () => { throw new Error('Bearer SECRET_FROM_SDK_ERROR'); });
    const report = await verifyLive(config, {
      fetchImpl: publicRead, env: { CATALOG_ADMIN_ACCESS_TOKEN: 'fixture-token' }, writeTest: true, writeRunner,
    });
    expect(writeRunner).toHaveBeenCalledWith({ ...config, token: 'fixture-token' });
    expect(report.writeVerification).toMatchObject({ status: 'failed', cleanupStatus: 'unverified' });
    expect(JSON.stringify(report)).not.toContain('SECRET_FROM_SDK_ERROR');
    expect(JSON.stringify(report)).not.toContain('fixture-token');
  });
});
