import type { Product } from "../types.js";

/**
 * Query string sent to site search: brand (חברה) + model/name/search term.
 */
export function productSearchQuery(product: Product): string {
  const base = (product.searchTerm || product.name || "").trim();
  const brand = (product.brand || "").trim();
  if (brand && base) return `${brand} ${base}`.trim();
  return base || brand;
}
