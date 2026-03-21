import type { Site } from "../types.js";

/** @deprecated No fixed anchor store; kept for any legacy URL checks */
export const ANCHOR_SITE_BASE_URL = "";

export function isAnchorSite(_site: Site): boolean {
  return false;
}

export function getAnchorSite(_sites: Site[]): Site | undefined {
  return undefined;
}

/**
 * Returns the ordered site list as-is (no injected anchor).
 */
export function ensureAnchorSiteInList(targetSites: Site[], _allSites?: Site[]): Site[] {
  return [...targetSites];
}
