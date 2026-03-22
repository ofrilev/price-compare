import * as cheerio from "cheerio";
import type { Element } from "domhandler";
import { parsePrice } from "./priceParser.js";
import type { Site } from "../types.js";

function getPriceSelectors(site: Site): string[] {
  const cfg = site.scraperConfig?.priceSelectors;
  if (cfg?.length) return cfg;
  return site.selectors.price ? [site.selectors.price] : [];
}

/**
 * WooCommerce / Elementor sale markup: <p class="price"><del>old</del><ins>new</ins></p>
 * Using .text() on the whole node merges digits (wrong price). Prefer <ins>; else drop <del>.
 */
function priceTextFromElement($: cheerio.CheerioAPI, el: Element): string {
  const $el = $(el);

  if ($el.is("ins")) {
    return $el.text().trim();
  }

  const $ins = $el.find("ins").first();
  if ($ins.length > 0) {
    const fromIns = $ins.text().trim();
    if (fromIns) return fromIns;
  }

  const clone = $el.clone();
  clone.find("del").remove();
  const withoutDel = clone.text().trim();
  if (withoutDel) return withoutDel;

  return $el.text().trim();
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

  for (const sel of priceSelectors) {
    // Never use strikethrough amounts; WooCommerce puts old price in <del>, current in <ins>.
    const $els = $(sel).filter((_, el) => !$(el).closest("del").length);

    const count = $els.length;
    for (let i = 0; i < count; i++) {
      const text = priceTextFromElement($, $els[i] as Element);
      const p = parsePrice(text);
      if (p !== null && p > 0) {
        return { price: p, priceText: text };
      }
    }
  }

  return null;
}
