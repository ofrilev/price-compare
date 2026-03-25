import type { Site } from "../types.js";

function hostnameFromBaseUrl(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** Normalize host: lowercase, strip leading www. */
export function normalizeHost(hostname: string): string {
  let h = hostname.trim().toLowerCase();
  if (h.startsWith("www.")) h = h.slice(4);
  return h;
}

export function hostnameLooksLikeZap(url: string): boolean {
  try {
    const h = new URL(url).hostname.toLowerCase();
    return (
      h === "zap.co.il" ||
      h.endsWith(".zap.co.il") ||
      /(^|\.)zap\.co\.il$/i.test(h)
    );
  } catch {
    return /zap\.co\.il/i.test(url);
  }
}

export function isZapSite(site: Site): boolean {
  return (
    hostnameLooksLikeZap(site.baseUrl || "") ||
    hostnameLooksLikeZap(site.siteUrl || "")
  );
}

/** True when the user selected only זאפ in the Navigator UI — still map Zap rows to retailers by hostname / name. */
export function zapIsOnlySelectedSite(
  selectedSiteIds: Set<string>,
  zapSite: Site | undefined,
): boolean {
  return !!(
    zapSite &&
    selectedSiteIds.size === 1 &&
    selectedSiteIds.has(zapSite.id)
  );
}

/**
 * Match a retailer offer hostname to a configured enabled Navigator site.
 * Never maps to Zap itself. When only Zap is selected, matches any navigator retailer;
 * otherwise the site must be in selectedSiteIds.
 */
export function findConfiguredSiteIdForOfferHostname(
  allSites: Site[],
  offerHostname: string,
  selectedSiteIds: Set<string>,
  zapSite: Site | undefined,
): string | undefined {
  const normOffer = normalizeHost(offerHostname);
  const allowAnyRetailer = zapIsOnlySelectedSite(selectedSiteIds, zapSite);
  for (const s of allSites) {
    if (!s.enabled || !s.scraperConfig?.navigatorEnabled) continue;
    if (zapSite && s.id === zapSite.id) continue;
    if (!allowAnyRetailer && !selectedSiteIds.has(s.id)) continue;
    const hBase = hostnameFromBaseUrl(s.baseUrl.split("?")[0] || s.baseUrl);
    const hSite = s.siteUrl
      ? hostnameFromBaseUrl(s.siteUrl.split("?")[0] || s.siteUrl)
      : null;
    if (hBase && normOffer === normalizeHost(hBase)) return s.id;
    if (hSite && normOffer === normalizeHost(hSite)) return s.id;
  }
  return undefined;
}

/** Strip Zap UI prefix e.g. "ב-דיאז" → "דיאז" */
export function normalizeZapRetailerLabel(raw: string): string {
  return raw
    .replace(/^\s*[\u200e\u200f]*/g, "")
    .replace(/^\s*ב[-־\s]*/u, "")
    .trim()
    .toLowerCase();
}

/** When Zap shows a store line without outbound URL, match `retailer_name` to a configured site and use search URL as product link. */
export function findSiteByZapRetailerLabel(
  allSites: Site[],
  retailerNameRaw: string,
  zapSite: Site | undefined,
  searchQuery: string,
): { site: Site; productUrl: string } | undefined {
  const label = normalizeZapRetailerLabel(retailerNameRaw);
  if (!label) return undefined;
  const q = searchQuery.trim() || "product";

  const candidates = allSites.filter(
    (s) =>
      s.enabled &&
      s.scraperConfig?.navigatorEnabled &&
      (!zapSite || s.id !== zapSite.id),
  );

  const norm = (x: string) => x.trim().toLowerCase();

  for (const site of candidates) {
    const sn = norm(site.name);
    if (!sn) continue;
    if (label === sn || label.includes(sn) || sn.includes(label)) {
      const productUrl = fallbackZapOfferUrlForSite(site, q);
      if (productUrl) return { site, productUrl };
    }
  }
  return undefined;
}

function fallbackZapOfferUrlForSite(site: Site, searchTerm: string): string | null {
  const t = site.searchUrlTemplate?.trim() || "";
  if (t.includes("{searchTerm}")) {
    return t.split("{searchTerm}").join(encodeURIComponent(searchTerm));
  }
  try {
    const u = new URL(site.baseUrl.split("?")[0] || site.baseUrl);
    return u.href.endsWith("/") ? u.href : `${u.href}/`;
  } catch {
    return null;
  }
}
