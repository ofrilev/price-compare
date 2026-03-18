/**
 * Normalize a URL for use in href attributes.
 * Ensures Hebrew and other Unicode characters in the path/query are properly percent-encoded.
 */
export function toHrefUrl(url: string): string {
  if (!url || typeof url !== "string") return url;
  try {
    return new URL(url).href;
  } catch {
    return url;
  }
}
