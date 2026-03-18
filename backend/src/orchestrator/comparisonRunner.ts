import { v4 as uuidv4 } from "uuid";
import { chromium } from "playwright";
import { readJson, writeJson } from "../services/store.js";
import { emit as progressEmit } from "../services/scrapeProgress.js";
import { logScrape, logScrapeError } from "../services/scrapeLogger.js";
import { scrapeSite } from "../services/scraperService.js";
import {
  normalizeProduct,
  filterMatchingProducts,
  dedupeByUrl,
  getSearchTermFallbacks,
} from "../services/normalization.service.js";
import { compareWithGPT } from "../services/gptComparison.service.js";
import type { Site, Product, ScrapeResult } from "../types.js";

export interface RunScraperComparisonOptions {
  productIds?: string[];
  category?: string;
  siteIds?: string[];
}

/**
 * Query controller: validates request, runs scrapers in parallel, aggregates results, calls GPT once per product.
 */
export async function runScraperComparison(
  options: RunScraperComparisonOptions
): Promise<ScrapeResult[]> {
  const sites = await readJson<Site[]>("sites.json");
  const products = await readJson<Product[]>("products.json");

  let targetSites = sites.filter((s) => s.enabled);
  if (options.siteIds?.length) {
    targetSites = targetSites.filter((s) => options.siteIds!.includes(s.id));
  }

  let targetProducts: Product[] = products;
  if (options.productIds?.length) {
    targetProducts = products.filter((p) => options.productIds!.includes(p.id));
  } else if (options.category) {
    targetProducts = products.filter((p) => p.category === options.category);
  }

  if (targetSites.length === 0) throw new Error("לא נמצאו אתרים פעילים");
  if (targetProducts.length === 0) throw new Error("לא נמצאו מוצרים");

  const siteMap = new Map(targetSites.map((s) => [s.id, s]));
  const allResults: ScrapeResult[] = [];

  const usePlaywrightSites = targetSites.filter(
    (s) => s.scraperConfig?.searchStrategy === "searchBar" || s.usePlaywright
  );
  const hasPlaywright = usePlaywrightSites.length > 0;

  progressEmit("status", `השוואה התחילה: ${targetProducts.length} מוצר(ים), ${targetSites.length} אתר(ים)`);
  await logScrape(`Comparison started: ${targetProducts.length} product(s), ${targetSites.length} site(s)`);
  await logScrape(`Request params: productIds=${JSON.stringify(options.productIds)}, category=${options.category}, siteIds=${JSON.stringify(options.siteIds)}`);

  const browser = hasPlaywright ? await chromium.launch({ headless: true }) : undefined;
  if (browser) await logScrape("Browser launched (reused across sites)");

  try {
    for (const product of targetProducts) {
      try {
        progressEmit("status", `מחפש ${product.name}...`);
        const effectiveSearchTerm = (product.searchTerm || product.name || "").trim();
        await logScrape(`--- Product: ${product.name} (searchTerm: "${product.searchTerm}", effective: "${effectiveSearchTerm}") ---`);

        const searchTerms = getSearchTermFallbacks(effectiveSearchTerm);
        await logScrape(`Search terms to try: [${searchTerms.map((t) => `"${t}"`).join(", ")}]`);
        const siteResultsBySite = new Map<string, { price: number; productUrl: string }>();

          for (const searchTerm of searchTerms) {
          if (searchTerm !== searchTerms[0]) {
            await logScrape(`Retrying with fallback search term: "${searchTerm}"`);
          }
          await logScrape(`Scraping with searchTerm: "${searchTerm}" across sites: [${targetSites.map((s) => s.name).join(", ")}]`);
          const rawBySite = await Promise.all(
            targetSites.map(async (site) => {
              try {
                const raw = await scrapeSite(site, searchTerm, browser);
                await logScrape(`${site.name}: returned ${raw.length} raw product(s) for searchTerm="${searchTerm}"`);
                return { site, raw };
              } catch (err) {
                await logScrapeError(`${site.name} failed`, err);
                return { site, raw: [] };
              }
            })
          );

          for (const { site, raw } of rawBySite) {
            if (siteResultsBySite.has(site.id)) continue;

            const normalized = raw
              .map((r) => normalizeProduct(r))
              .filter((n): n is NonNullable<typeof n> => n !== null);
            const matched = filterMatchingProducts(normalized, searchTerm);
            const deduped = dedupeByUrl(matched);

            await logScrape(`${site.name}: raw=${raw.length} → normalized=${normalized.length} → matched=${matched.length} → deduped=${deduped.length}`);

            if (deduped.length > 0) {
              const best = deduped.reduce((a, b) => (a.price < b.price ? a : b));
              siteResultsBySite.set(site.id, {
                price: best.price,
                productUrl: best.productUrl,
              });
              await logScrape(`${site.name}: best match "${best.name}" @ ${best.price} ILS`);
            }
          }

          const foundCount = siteResultsBySite.size;
          if (foundCount === targetSites.length) break;
          if (foundCount > 0 && searchTerm === searchTerms[0]) break;
        }

        const siteResults = Array.from(siteResultsBySite.entries()).map(([siteId, data]) => ({
          siteName: siteMap.get(siteId)!.name,
          siteId,
          price: data.price,
          productUrl: data.productUrl,
        }));

        if (siteResults.length === 0) {
          progressEmit("status", `לא נמצאו מחירים עבור ${product.name}`);
          await logScrape(`No prices found for ${product.name}`);
          continue;
        }

        await logScrape(`Sending to GPT: ${product.name} with ${siteResults.length} site(s)`);
        const gptResult = await compareWithGPT({
          productName: product.name,
          searchTerm: product.searchTerm,
          siteResults,
        });

        if (gptResult) {
          await logScrape(`GPT result for ${product.name}: cheapest=${gptResult.cheapest}, ${gptResult.results.length} result(s)`);
          for (const r of gptResult.results) {
            if (r.price > 0) {
              allResults.push({
                id: uuidv4(),
                productId: product.id,
                siteId: r.siteId,
                price: r.price,
                currency: "ILS",
                productUrl: r.productUrl,
                scrapedAt: new Date().toISOString(),
              });
            }
          }
          progressEmit("status", `סיים ${product.name}: ${gptResult.results.length} מחירים`);
        } else {
          for (const r of siteResults) {
            allResults.push({
              id: uuidv4(),
              productId: product.id,
              siteId: r.siteId,
              price: r.price,
              currency: "ILS",
              productUrl: r.productUrl,
              scrapedAt: new Date().toISOString(),
            });
          }
          progressEmit("status", `סיים ${product.name} (ללא GPT): ${siteResults.length} מחירים`);
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        progressEmit("error", `השוואה נכשלה עבור ${product.name}: ${errMsg}`);
        await logScrapeError(`Failed for ${product.name}`, err);
      }
    }
  } finally {
    if (browser) {
      await browser.close();
      await logScrape("Browser closed");
    }
  }

  progressEmit("done", `השוואה הושלמה: נמצאו ${allResults.length} מחיר(ים)`);
  await logScrape(`Comparison done: ${allResults.length} result(s) total`);
  return allResults;
}
