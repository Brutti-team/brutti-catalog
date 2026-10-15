type RouteLocation = { pathname: string; hash: string };

/** Read routing without changing a fragment that Supabase may still need. */
export function resolveAppRoute(location: RouteLocation): string {
  if (location.hash.startsWith("#/")) return location.hash;
  return /\/catalog(?:\/index\.html)?\/?$/.test(location.pathname)
    ? "#/catalog"
    : "#/admin";
}

/** Product hashes work beneath either static entry, including legacy links. */
export function productIdFromHash(hash: string): string | null {
  const match = hash.match(/^#\/(?:catalog\/)?product\/([^/?#]+)$/);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return "";
  }
}
