/** Background reads need no Supabase Realtime publication or deployment. */
export function subscribeCatalogRefresh(
  refresh: () => Promise<void>,
  visibility: Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'> = document,
): () => void {
  let active = true;
  let pending = false;
  const run = () => {
    if (!active || pending || visibility.visibilityState !== 'visible') return;
    pending = true;
    void refresh().catch(() => undefined).finally(() => { pending = false; });
  };
  const timer = setInterval(run, 30_000);
  visibility.addEventListener('visibilitychange', run);
  return () => { active = false; clearInterval(timer); visibility.removeEventListener('visibilitychange', run); };
}
