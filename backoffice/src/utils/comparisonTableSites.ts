import type { Site, ScrapeResult } from "../api/client";

/** Historical Diez row id from results scraped before site was removed from config */
export const LEGACY_DIEZ_SITE_ID = "f23c873f-d398-476c-b583-eb00f8755272";

export type ComparisonTableSiteColumn = {
  id: string;
  name: string;
  siteUrl?: string;
  /** דיאז column — styled differently in the comparison table */
  isDiez: boolean;
};

function hostnameLooksLikeDiez(url: string): boolean {
  try {
    const h = new URL(url).hostname.toLowerCase();
    return h === "diez.co.il" || h.endsWith(".diez.co.il");
  } catch {
    return /diez\.co\.il/i.test(url);
  }
}

export function isDiezConfiguredSite(site: Site): boolean {
  if (site.id === LEGACY_DIEZ_SITE_ID) return true;
  return (
    hostnameLooksLikeDiez(site.baseUrl || "") ||
    hostnameLooksLikeDiez(site.siteUrl || "")
  );
}

/** Match stored scrape rows to Diez (legacy id or product URL host) */
export function isDiezScrapeResult(r: ScrapeResult): boolean {
  if (r.siteId === LEGACY_DIEZ_SITE_ID) return true;
  if (r.productUrl && hostnameLooksLikeDiez(r.productUrl)) return true;
  const sn = r.siteName?.toLowerCase() ?? "";
  return sn.includes("diez") || sn.includes("דיאז");
}

export function buildComparisonTableSiteColumns(
  enabledSites: Site[]
): ComparisonTableSiteColumn[] {
  const fromConfig: ComparisonTableSiteColumn[] = enabledSites.map((s) => ({
    id: s.id,
    name: s.name,
    siteUrl: s.siteUrl || s.baseUrl,
    isDiez: isDiezConfiguredSite(s),
  }));

  const diezFromConfig = fromConfig.filter((c) => c.isDiez);
  const rest = fromConfig.filter((c) => !c.isDiez);

  if (diezFromConfig.length > 0) {
    return [...diezFromConfig, ...rest];
  }

  return [
    {
      id: LEGACY_DIEZ_SITE_ID,
      name: "דיאז",
      siteUrl: "https://diez.co.il/",
      isDiez: true,
    },
    ...rest,
  ];
}

export function findResultForComparisonColumn(
  col: ComparisonTableSiteColumn,
  productResults: ScrapeResult[]
): ScrapeResult | undefined {
  if (col.isDiez) {
    const byId = productResults.find((r) => r.siteId === col.id);
    if (byId) return byId;
    return productResults.find((r) => isDiezScrapeResult(r));
  }
  return productResults.find((r) => r.siteId === col.id);
}
