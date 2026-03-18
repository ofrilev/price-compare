import { parsePrice } from "./priceParser.js";
import { matchesProduct, getSearchTermFallbacks } from "./searchTermNormalizer.js";
import type { RawProduct } from "../parsers/baseParser.js";

export interface NormalizedProduct {
  name: string;
  price: number;
  priceText: string;
  productUrl: string;
}

/** Reject prices that are clearly wrong (e.g. concatenated digits from multiple elements) */
const MAX_REASONABLE_PRICE_ILS = 500_000;

/**
 * Normalize a raw product: parse price, filter invalid.
 */
export function normalizeProduct(raw: RawProduct): NormalizedProduct | null {
  const price = parsePrice(raw.priceText);
  if (price === null || price <= 0 || !raw.url) return null;
  if (price > MAX_REASONABLE_PRICE_ILS) return null; // Likely parsing bug (e.g. multiple prices concatenated)
  return {
    name: raw.name.trim(),
    price,
    priceText: raw.priceText,
    productUrl: raw.url,
  };
}

/**
 * Filter products to only those matching the search term (brand + model).
 */
export function filterMatchingProducts(
  products: NormalizedProduct[],
  searchTerm: string
): NormalizedProduct[] {
  return products.filter((p) => matchesProduct(p.name, searchTerm));
}

/**
 * Deduplicate by productUrl; keep first occurrence. Handles variants (e.g. "Roland RP107 Black" vs "Roland RP107").
 */
export function dedupeByUrl(products: NormalizedProduct[]): NormalizedProduct[] {
  const seen = new Set<string>();
  return products.filter((p) => {
    const url = p.productUrl.split("?")[0];
    if (seen.has(url)) return false;
    seen.add(url);
    return true;
  });
}

export { getSearchTermFallbacks };
