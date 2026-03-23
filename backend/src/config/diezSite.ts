import type { ScrapeResult, Site } from "../types.js";

/** Historical Diez id in stored results (site removed from config at some point) */
export const LEGACY_DIEZ_SITE_ID = "f23c873f-d398-476c-b583-eb00f8755272";

function hostnameLooksLikeDiez(url: string): boolean {
  try {
    const h = new URL(url).hostname.toLowerCase();
    return h === "diez.co.il" || h.endsWith(".diez.co.il");
  } catch {
    return /diez\.co\.il/i.test(url);
  }
}

export function isDiezSite(site: Site): boolean {
  if (site.id === LEGACY_DIEZ_SITE_ID) return true;
  return (
    hostnameLooksLikeDiez(site.baseUrl || "") ||
    hostnameLooksLikeDiez(site.siteUrl || "")
  );
}

/** First enabled Diez row from config (current id), if any */
export function getConfiguredDiezSite(sites: Site[]): Site | undefined {
  return sites.find((s) => s.enabled && isDiezSite(s));
}

/**
 * When `includeDiezByDefault` is true (default): append configured Diez to siteIds if missing.
 * When false: leave siteIds unchanged so scrapes only run on explicitly selected sites.
 */
export function mergeDiezSiteId(
  siteIds: string[],
  sites: Site[],
  includeDiezByDefault = true,
): string[] {
  if (!includeDiezByDefault) return [...siteIds];
  const diez = getConfiguredDiezSite(sites);
  if (!diez) return [...siteIds];
  if (!diez.scraperConfig?.navigatorEnabled) return [...siteIds];
  if (siteIds.includes(diez.id)) return [...siteIds];
  return [...siteIds, diez.id];
}

/** Calendar day of scrape (UTC Y-M-D), consistent with routes/scrape.ts dedupe keys */
export function scrapeCalendarDayUtc(iso: string): string {
  return iso.split("T")[0] ?? "";
}

export function todayUtcYmd(): string {
  return new Date().toISOString().split("T")[0] ?? "";
}

/** True if we already store a Diez price for this product for today's UTC date */
export function hasSameDayDiezResult(
  results: ScrapeResult[],
  productId: string,
  diezSite: Site | undefined,
  dayYmd: string,
): boolean {
  const diezIds = new Set<string>([LEGACY_DIEZ_SITE_ID]);
  if (diezSite) diezIds.add(diezSite.id);
  return results.some(
    (r) =>
      r.productId === productId &&
      diezIds.has(r.siteId) &&
      scrapeCalendarDayUtc(r.scrapedAt) === dayYmd,
  );
}
