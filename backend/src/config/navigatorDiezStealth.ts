/**
 * Browser context hints for Diez (Cloudflare / bot checks).
 * Used with playwright-extra stealth + realistic viewport and headers.
 */
export const DIEZ_STEALTH_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export const DIEZ_STEALTH_VIEWPORT = { width: 1440, height: 900 } as const;

export const DIEZ_STEALTH_EXTRA_HEADERS: Record<string, string> = {
  "Accept-Language": "he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7",
  Referer: "https://www.google.com/",
};
