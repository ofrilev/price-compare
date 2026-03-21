import * as cheerio from "cheerio";
import type { Browser } from "playwright";
import { parseSiteHtml } from "../parsers/configParser.js";
import { logScrape, logScrapeError } from "./scrapeLogger.js";
import { emit as progressEmit } from "./scrapeProgress.js";
import { normalizeProduct, dedupeByUrl } from "./normalization.service.js";
import { DIEZ_SUBCATEGORY_SELECTOR } from "../config/diezCategoryMapping.js";
import type { Site } from "../types.js";
import type { RawProduct } from "../parsers/baseParser.js";

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const MAX_SUBCATEGORIES = 20;
const MAX_PRODUCTS_PER_SEARCH = 20;

export interface SiteProductItem {
  name: string;
  price: number;
  url: string;
}

/**
 * Extract subcategory URLs from a Diez category page.
 * Looks for links inside ul.products.elementor-grid that point to /product-category/.
 */
export function extractSubcategoryUrls(html: string, baseUrl: string, currentUrl: string): string[] {
  const $ = cheerio.load(html);
  const seen = new Set<string>();
  const urls: string[] = [];

  $(DIEZ_SUBCATEGORY_SELECTOR).each((_, el) => {
    const href = $(el).attr("href");
    if (!href || !href.includes("/product-category/")) return;
    if (href.includes("/product/")) return; // product page, not subcategory

    const absolute = href.startsWith("http") ? href : new URL(href, baseUrl).href;
    const normalized = absolute.replace(/\/+$/, "");

    if (seen.has(normalized)) return;
    if (normalized === currentUrl.replace(/\/+$/, "")) return; // avoid loop

    seen.add(normalized);
    urls.push(absolute);
  });

  return urls.slice(0, MAX_SUBCATEGORIES);
}

/**
 * Scrape Diez category: if page has subcategories in ul.products.elementor-grid,
 * visit each subcategory and aggregate products. Otherwise scrape current page.
 */
export async function scrapeDiezCategory(
  categoryUrl: string,
  site: Site,
  browser: Browser
): Promise<SiteProductItem[]> {
  const cfg = site.scraperConfig;
  const userAgent = cfg?.userAgent ?? DEFAULT_USER_AGENT;
  const waitExtraMs = cfg?.waitExtraMs ?? 2000;

  const page = await browser.newPage();
  const allProducts: RawProduct[] = [];
  const seenUrls = new Set<string>();

  try {
    await page.setExtraHTTPHeaders({ "User-Agent": userAgent });
    await logScrape(`Diez category: navigating to ${categoryUrl}`);
    progressEmit("status", `מחפש מוצרים בדיאז...`);

    await page.goto(categoryUrl, { waitUntil: "domcontentloaded", timeout: 30000 });

    if (cfg?.preSteps?.length) {
      for (const step of cfg.preSteps) {
        if (step.type === "click" && step.selector) {
          await page.locator(step.selector).first().click({ timeout: 5000 }).catch(() => null);
        }
        if (step.type === "scroll") {
          await page.evaluate(() => window.scrollBy(0, 300));
        }
        await new Promise((r) => setTimeout(r, 500));
      }
    }

    if (waitExtraMs) {
      await new Promise((r) => setTimeout(r, waitExtraMs));
    }

    const currentUrl = page.url();
    const html = await page.content();
    const subcategoryUrls = extractSubcategoryUrls(html, site.baseUrl, currentUrl);

    if (subcategoryUrls.length > 0) {
      await logScrape(`Diez category: found ${subcategoryUrls.length} subcategories, scraping each`);
      progressEmit("status", `דיאז: ${subcategoryUrls.length} תת-קטגוריות נמצאו`);

      for (const subUrl of subcategoryUrls) {
        try {
          await page.goto(subUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
          if (waitExtraMs) await new Promise((r) => setTimeout(r, waitExtraMs));
          const subHtml = await page.content();
          const products = await parseSiteHtml(subHtml, site);
          for (const p of products) {
            const urlKey = p.url.split("?")[0];
            if (!seenUrls.has(urlKey) && p.url && p.name) {
              seenUrls.add(urlKey);
              allProducts.push(p);
            }
          }
          await logScrape(`Diez subcategory ${subUrl}: ${products.length} product(s)`);
        } catch (err: unknown) {
          await logScrapeError(`Diez subcategory ${subUrl}`, err);
        }
      }
    } else {
      const products = await parseSiteHtml(html, site);
      allProducts.push(...products);
      await logScrape(`Diez category (no subcategories): ${products.length} product(s) on main page`);
    }

    const normalized = allProducts
      .map((r) => normalizeProduct(r))
      .filter((n): n is NonNullable<typeof n> => n !== null);
    const deduped = dedupeByUrl(normalized);

    const items: SiteProductItem[] = deduped
      .slice(0, MAX_PRODUCTS_PER_SEARCH)
      .map((p) => ({
        name: p.name,
        price: p.price,
        url: p.productUrl,
      }));

    progressEmit("status", `נמצאו ${items.length} מוצרים בדיאז (מוגבל ל-${MAX_PRODUCTS_PER_SEARCH})`);
    await logScrape(`Diez category: total ${items.length} product(s) after dedupe (capped at ${MAX_PRODUCTS_PER_SEARCH})`);
    return items;
  } finally {
    await page.close();
  }
}
