import { afterEach, expect, it, vi } from 'vitest';
import { subscribeCatalogRefresh } from '../src/lib/catalog-refresh';
afterEach(() => vi.useRealTimers());

it('refreshes visible tabs, skips hidden/inflight work and cleans up listeners', async () => {
  vi.useFakeTimers();
  let listener: (() => void) | undefined;
  const visibility = { visibilityState: 'visible', addEventListener: vi.fn((_type, fn) => { listener = fn; }), removeEventListener: vi.fn() };
  let finish: (() => void) | undefined;
  const refresh = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
  const stop = subscribeCatalogRefresh(refresh, visibility as unknown as Document);
  await vi.advanceTimersByTimeAsync(30_000);
  expect(refresh).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(30_000);
  expect(refresh).toHaveBeenCalledTimes(1);
  finish?.();
  await Promise.resolve(); await Promise.resolve();
  visibility.visibilityState = 'hidden';
  await vi.advanceTimersByTimeAsync(30_000);
  expect(refresh).toHaveBeenCalledTimes(1);
  visibility.visibilityState = 'visible'; listener?.();
  expect(refresh).toHaveBeenCalledTimes(2);
  stop(); finish?.();
  await vi.advanceTimersByTimeAsync(60_000);
  listener?.();
  expect(refresh).toHaveBeenCalledTimes(2);
  expect(visibility.removeEventListener).toHaveBeenCalledWith('visibilitychange', listener);
});
