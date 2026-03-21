import * as cheerio from "cheerio";
import { parsePrice } from "./priceParser.js";
import type { Site } from "../types.js";

function getPriceSelectors(site: Site): string[] {
  const cfg = site.scraperConfig?.priceSelectors;
  if (cfg?.length) return cfg;
  return site.selectors.price ? [site.selectors.price] : [];
}

/**
 * Best visible price on PDP HTML (excludes <del> when site requests it).
 */
export function extractNavigatorPriceFromHtml(
  html: string,
  site: Site
): { price: number; priceText: string } | null {
  const $ = cheerio.load(html);
  const priceSelectors = getPriceSelectors(site);
  const excludePriceInDel = site.scraperConfig?.excludePriceInDel ?? false;

  for (const sel of priceSelectors) {
    const $els = excludePriceInDel
      ? $(sel).filter((_, el) => !$(el).closest("del").length)
      : $(sel);

    const count = $els.length;
    for (let i = 0; i < count; i++) {
      const text = $($els[i]).text().trim();
      const p = parsePrice(text);
      if (p !== null && p > 0) {
        return { price: p, priceText: text };
      }
    }
  }

  return null;
}
