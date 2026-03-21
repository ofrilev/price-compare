import type { Site } from "../types.js";

/** Diez (diez.co.il) is the default anchor site - products must be found here to be included */
export const ANCHOR_SITE_BASE_URL = "https://diez.co.il/";

export function isAnchorSite(site: Site): boolean {
  try {
    const url = new URL(site.baseUrl || site.siteUrl || "");
    return url.hostname === "diez.co.il";
  } catch {
    return false;
  }
}

export function getAnchorSite(sites: Site[]): Site | undefined {
  return sites.find(isAnchorSite);
}

/**
 * Always include Diez in the site list. Diez is checked first in every search.
 * @param targetSites - Sites selected by user (or all enabled)
 * @param allSites - Full sites list to find Diez (use when targetSites is filtered)
 */
export function ensureAnchorSiteInList(targetSites: Site[], allSites?: Site[]): Site[] {
  const anchor = getAnchorSite(allSites ?? targetSites);
  if (!anchor) {
    throw new Error("אתר דיאז (diez.co.il) לא נמצא או לא פעיל - נדרש להשוואה");
  }
  const hasAnchor = targetSites.some((s) => s.id === anchor.id);
  if (hasAnchor) {
    // Put Diez first
    const rest = targetSites.filter((s) => s.id !== anchor.id);
    return [anchor, ...rest];
  }
  return [anchor, ...targetSites];
}
