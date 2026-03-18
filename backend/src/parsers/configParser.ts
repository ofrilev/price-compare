import * as cheerio from "cheerio";
import { parsePrice } from "../services/priceParser.js";
import { logScrape } from "../services/scrapeLogger.js";
import type { Site } from "../types.js";
import type { RawProduct } from "./baseParser.js";

export { type RawProduct } from "./baseParser.js";

function getPriceSelectors(site: Site): string[] {
  const cfg = site.scraperConfig?.priceSelectors;
  if (cfg?.length) return cfg;
  return site.selectors.price ? [site.selectors.price] : [];
}

/**
 * Parse HTML from a site into structured product list using site config.
 */
export async function parseSiteHtml(html: string, site: Site): Promise<RawProduct[]> {
  const $ = cheerio.load(html);
  const priceSelectors = getPriceSelectors(site);
  const cfg = site.scraperConfig;
  const resultItemSelector = cfg?.resultItemSelector;
  const priceStrategy = cfg?.priceStrategy ?? "first";
  const productNameSelector = site.selectors.productName ?? site.selectors.price;
  const productLinkSelector = site.selectors.productLink;

  const products: RawProduct[] = [];

  if (resultItemSelector) {
    $(resultItemSelector).each((_, el) => {
      const $el = $(el);
      let name = "";
      if (productNameSelector) {
        name = $el.find(productNameSelector).first().text().trim();
      }
      if (!name) {
        name = $el.text().trim().slice(0, 100);
      }

      let priceText = "";
      let price: number | null = null;
      const allPrices: number[] = [];

      for (const sel of priceSelectors) {
        const text = $el.find(sel).first().text().trim();
        const p = parsePrice(text);
        if (p !== null) {
          allPrices.push(p);
          if (price === null || (priceStrategy === "lowest" && p < price)) {
            price = p;
            priceText = text;
          }
          if (priceStrategy === "first") break;
        }
      }

      if (priceStrategy === "lowest" && allPrices.length > 0) {
        price = Math.min(...allPrices);
        priceText = String(price);
      }

      let url = site.baseUrl;
      if (productLinkSelector) {
        const href = $el.find(productLinkSelector).first().attr("href");
        if (href) {
          url = href.startsWith("http") ? href : new URL(href, site.baseUrl).href;
        }
      }

      if (name && price !== null && price > 0) {
        products.push({ name, priceText, url });
      }
    });
  } else {
    // No result item selector: treat page as single product
    let name = "";
    if (productNameSelector) {
      name = $(productNameSelector).first().text().trim();
    }
    if (!name) name = $("title").text().trim().slice(0, 100);

    let price: number | null = null;
    let priceText = "";
    const scope = $.root();
    for (const sel of priceSelectors) {
      const text = scope.find(sel).first().text().trim();
      const p = parsePrice(text);
      if (p !== null) {
        price = p;
        priceText = text;
        break;
      }
    }

    let url = site.baseUrl;
    if (productLinkSelector) {
      const href = scope.find(productLinkSelector).first().attr("href");
      if (href) url = href.startsWith("http") ? href : new URL(href, site.baseUrl).href;
    }

    if (name && price !== null && price > 0) {
      products.push({ name, priceText, url });
    }
  }

  if (products.length === 0 && (resultItemSelector || priceSelectors.length > 0)) {
    await logScrape(`Parser: ${site.name} returned 0 products | resultItemSelector=${resultItemSelector ?? "none"} | priceSelectors=[${priceSelectors.join(", ")}] (selectors may need update)`);
  }
  return products;
}
