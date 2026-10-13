/** Resolve bundled public assets when hosted under a GitHub Pages subdirectory. */
export function publicAssetUrl(source?: string): string {
  const url = source || "/images/placeholder.svg";
  // Keep remote Supabase images, data URLs and blob previews untouched.
  if (!url.startsWith("/images/")) return url;
  return `${import.meta.env.BASE_URL}${url.slice(1)}`;
}
