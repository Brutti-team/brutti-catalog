import { describe, expect, it, vi } from 'vitest';
// @ts-expect-error Operator module is intentionally not part of the browser bundle.
import { cleanupOwnedArtifacts, runWriteVerification } from '../scripts/live-write-verification.mjs';

const token = `header.${Buffer.from(JSON.stringify({ role: 'authenticated' })).toString('base64url')}.signature`;

describe('explicit live integration verification safety', () => {
  it('refuses any other project before connecting or writing', async () => {
    const makeClient = vi.fn();
    const result = await runWriteVerification({ url: 'https://other.supabase.co', key: 'sb_publishable_test', token, makeClient });
    expect(result.status).toBe('blocked');
    expect(makeClient).not.toHaveBeenCalled();
  });
  it('never mutates without verified administrator membership', async () => {
    const mutate = vi.fn();
    const fake = {
      auth: { getUser: vi.fn(async () => ({ data: { user: { id: 'admin-id' } }, error: null })) },
      from: vi.fn(() => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }), insert: mutate, delete: mutate })),
    };
    const result = await runWriteVerification({ url: 'https://lgdjoxafleqnbomtfzqt.supabase.co', key: 'sb_publishable_test', token, makeClient: () => fake });
    expect(result.status).toBe('blocked');
    expect(mutate).not.toHaveBeenCalled();
  });
  it('only cleans owned identities and attempts all cleanups even after one failure', async () => {
    const removed: string[] = [];
    const paths: string[][] = [];
    const client = {
      from: (table: string) => ({
        delete: () => ({ eq: (_column: string, id: string) => ({ select: () => ({ maybeSingle: async () => {
          removed.push(`${table}:${id}`);
          return { data: table === 'products' ? null : { id }, error: table === 'products' ? { message: 'Private diagnostic must not be echoed' } : null };
        } }) }) }),
      }),
      storage: { from: () => ({ remove: async (items: string[]) => { paths.push(items); return { data: [], error: null }; }, download: async () => ({ data: null, error: { statusCode: '404' } }) }) },
    };
    const result = await cleanupOwnedArtifacts(client, { productId: 'owned-product', categoryId: 'owned-category', storagePath: 'owned-user/verification/run.webp', productAttempted: true, categoryAttempted: true, storageAttempted: true });
    expect(removed).toEqual(['products:owned-product', 'categories:owned-category']);
    expect(paths).toEqual([['owned-user/verification/run.webp']]);
    expect(result.remainingArtifacts).toEqual([{ kind: 'product', id: 'owned-product' }]);
    expect(JSON.stringify(result)).not.toContain('Private diagnostic');
  });
});
