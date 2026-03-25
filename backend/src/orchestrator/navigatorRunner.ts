import { v4 as uuidv4 } from "uuid";
import { chromium } from "playwright";
import { getChromiumLaunchOptions } from "../config/playwrightLaunch.js";
import { readJson } from "../services/store.js";
import { emit as progressEmit } from "../services/scrapeProgress.js";
import { logScrape, logScrapeError } from "../services/scrapeLogger.js";
import { planNavigatorQueries } from "../services/navigatorQueryPlanner.service.js";
import { navigateAndExtractProduct } from "../services/navigatorSiteSession.js";
import { compareWithGPT } from "../services/gptComparison.service.js";
import { ensureAnchorSiteInList } from "../config/anchorSite.js";
import {
  getConfiguredDiezSite,
  hasSameDayDiezResult,
  isDiezSite,
  todayUtcYmd,
} from "../config/diezSite.js";
import { findConfiguredSiteIdForOfferHostname, isZapSite } from "../config/zapSite.js";
import { runZapNavigatorExtract } from "../services/zapNavigatorExtract.service.js";
import { productSearchQuery } from "../utils/productSearchQuery.js";
import type { Site, Product, ScrapeResult } from "../types.js";

/** Real desktop Chrome UA — avoids HeadlessChrome fingerprint that some sites block */
const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export interface RunNavigatorComparisonOptions {
  productIds?: string[];
  category?: string;
  siteIds?: string[];
}

/**
 * E-Commerce Navigator: Playwright + query planner + result ranking + variant handling.
 * Only sites with scraperConfig.navigatorEnabled === true participate.
 */
export async function runNavigatorComparison(
  options: RunNavigatorComparisonOptions
): Promise<ScrapeResult[]> {
  const sites = await readJson<Site[]>("sites.json");
  const products = await readJson<Product[]>("products.json");
  const existingResults = await readJson<ScrapeResult[]>("results.json").catch(
    () => [],
  );
  const diezConfigured = getConfiguredDiezSite(sites);
  const todayYmd = todayUtcYmd();

  if (!options.siteIds?.length) {
    throw new Error("חובה לבחור לפחות אתר אחד (לא מריצים על כל האתרים כברירת מחדל)");
  }

  let targetSites = sites.filter(
    (s) =>
      s.enabled &&
      s.scraperConfig?.navigatorEnabled === true &&
      options.siteIds!.includes(s.id)
  );

  targetSites = ensureAnchorSiteInList(targetSites, sites);
  targetSites = targetSites.filter((s) => s.scraperConfig?.navigatorEnabled === true);

  let targetProducts: Product[] = products;
  if (options.productIds?.length) {
    targetProducts = products.filter((p) => options.productIds!.includes(p.id));
  } else if (options.category) {
    targetProducts = products.filter((p) => p.category === options.category);
  }

  if (targetSites.length === 0) {
    throw new Error("לא נמצאו אתרים עם navigatorEnabled — הפעל ב-sites.json");
  }
  if (targetProducts.length === 0) throw new Error("לא נמצאו מוצרים");

  const selectedSiteIds = new Set(options.siteIds!);
  const siteMap = new Map(targetSites.map((s) => [s.id, s]));
  const allResults: ScrapeResult[] = [];

  progressEmit(
    "status",
    `Navigator: ${targetProducts.length} מוצר(ים), ${targetSites.length} אתר(ים)`
  );
  await logScrape(
    `Navigator started: ${targetProducts.length} product(s), ${targetSites.length} site(s)`
  );
  await logScrape(
    `Navigator params: productIds=${JSON.stringify(options.productIds)}, category=${options.category}, siteIds=${JSON.stringify(options.siteIds)}`
  );

  const browser = await chromium.launch(getChromiumLaunchOptions());
  await logScrape("Navigator: browser launched (Playwright Chromium, no stealth)");

  try {
    for (const product of targetProducts) {
      try {
        progressEmit("status", `Navigator: מחפש ${product.name}...`);
        await logScrape(`--- Navigator product: ${product.name} ---`);

        const plan = await planNavigatorQueries(product);
        await logScrape(
          `Navigator queries: primary="${plan.primary}" secondary="${plan.secondary}" tertiary="${plan.tertiary}"`
        );

        const siteResultsBySite = new Map<string, { price: number; productUrl: string }>();

        const zapSite = targetSites.find((s) => isZapSite(s));
        if (zapSite) {
          const zContext = await browser.newContext({
            userAgent: zapSite.scraperConfig?.userAgent ?? DEFAULT_USER_AGENT,
          });
          const zPage = await zContext.newPage();
          try {
            const rawOffers = await runZapNavigatorExtract(
              zPage,
              zapSite,
              plan.primary,
              sites,
            );
            for (const offer of rawOffers) {
              const matchedId = findConfiguredSiteIdForOfferHostname(
                sites,
                offer.hostname,
                selectedSiteIds,
                zapSite,
              );
              if (!matchedId) continue;
              const matchedSite = sites.find((s) => s.id === matchedId);
              if (
                matchedSite &&
                isDiezSite(matchedSite) &&
                hasSameDayDiezResult(
                  existingResults,
                  product.id,
                  diezConfigured,
                  todayYmd,
                )
              ) {
                await logScrape(
                  `${matchedSite.name} (Zap): skip map — כבר יש רשומת דיאז מ-${todayYmd}`,
                );
                continue;
              }
              if (!siteResultsBySite.has(matchedId)) {
                siteResultsBySite.set(matchedId, {
                  price: offer.price,
                  productUrl: offer.productUrl,
                });
                await logScrape(
                  `${siteMap.get(matchedId)?.name ?? matchedId} (Zap): ${offer.price} ILS @ ${offer.productUrl}`,
                );
              }
            }
          } finally {
            await zPage.close().catch(() => null);
            await zContext.close().catch(() => null);
          }
        }

        for (const site of targetSites) {
          if (isZapSite(site)) {
            continue;
          }
          if (
            isDiezSite(site) &&
            hasSameDayDiezResult(
              existingResults,
              product.id,
              diezConfigured,
              todayYmd,
            )
          ) {
            await logScrape(
              `${site.name} (Navigator): skip — כבר יש רשומה מ-${todayYmd}`,
            );
            continue;
          }
          if (siteResultsBySite.has(site.id)) {
            await logScrape(
              `${site.name} (Navigator): skip — כבר מזאפ`,
            );
            continue;
          }
          const context = await browser.newContext({
            userAgent: site.scraperConfig?.userAgent ?? DEFAULT_USER_AGENT,
          });
          const page = await context.newPage();
          try {
            const extracted = await navigateAndExtractProduct(page, site, product, plan);
            if (extracted && extracted.price > 0) {
              siteResultsBySite.set(site.id, {
                price: extracted.price,
                productUrl: extracted.productUrl,
              });
              await logScrape(
                `${site.name} (Navigator): ${extracted.price} ILS @ ${extracted.productUrl}`
              );
            } else {
              await logScrape(`${site.name} (Navigator): no price extracted`);
            }
          } catch (err) {
            await logScrapeError(`${site.name} Navigator failed`, err);
          } finally {
            await page.close().catch(() => null);
            await context.close().catch(() => null);
          }
        }

        const siteResults = Array.from(siteResultsBySite.entries()).map(([siteId, data]) => {
          const meta = siteMap.get(siteId) ?? sites.find((x) => x.id === siteId);
          return {
            siteName: meta?.name ?? siteId,
            siteId,
            price: data.price,
            productUrl: data.productUrl,
          };
        });

        if (siteResults.length === 0) {
          await logScrape(`Navigator: no prices for ${product.name}`);
          continue;
        }

        await logScrape(`Navigator: GPT compare for ${product.name} (${siteResults.length} sites)`);
        const gptResult = await compareWithGPT({
          productName: product.name,
          searchTerm: productSearchQuery(product),
          siteResults,
        });

        const siteNameToId = new Map(siteResults.map((s) => [s.siteName, s.siteId]));

        if (gptResult) {
          for (const r of gptResult.results) {
            if (r.price > 0) {
              const siteId = siteNameToId.get(r.siteName) ?? r.siteId;
              allResults.push({
                id: uuidv4(),
                productId: product.id,
                siteId,
                price: r.price,
                currency: "ILS",
                productUrl: r.productUrl,
                scrapedAt: new Date().toISOString(),
              });
            }
          }
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
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        progressEmit("error", `Navigator נכשל עבור ${product.name}: ${errMsg}`);
        await logScrapeError(`Navigator failed for ${product.name}`, err);
      }
    }
  } finally {
    await browser.close();
    await logScrape("Navigator: browser closed");
  }

  progressEmit("done", `Navigator הושלם: ${allResults.length} תוצאות`);
  await logScrape(`Navigator done: ${allResults.length} result(s) total`);
  return allResults;
}
