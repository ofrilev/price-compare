/**
 * Maps internal Hebrew categories to Diez product-category URL slugs.
 * When scraping by category, navigate directly to these URLs instead of using search.
 * Base: https://diez.co.il/product-category/[slug]/
 */
export const DIEZ_CATEGORY_BASE = "https://diez.co.il/product-category";

/** Selector for subcategory links when category page shows subcategories instead of products */
export const DIEZ_SUBCATEGORY_SELECTOR = "ul.products.elementor-grid a[href*='/product-category/']";

export const DIEZ_CATEGORY_SLUGS: Record<string, string> = {
  "פסנתרים": "פסנתרים",
  "גיטרות ומגברים": "גיטרות_ומגברים",
  "כלי הקשה": "כלי-הקשה",
  "כלי קשת": "כלי-קשת",
  "כלי מיתר": "כלי-מיתר",
  "אקורדיונים": "אקורדיונים",
  "סאונד והגברה": "סאונד-והגברה",
};

/** Known categories that have direct Diez URLs */
export const KNOWN_DIEZ_CATEGORIES = Object.keys(DIEZ_CATEGORY_SLUGS);

/**
 * Get the direct Diez category URL for a given category name.
 * Returns null if the category is not in the known mapping.
 */
export function getDiezCategoryUrl(category: string): string | null {
  const slug = DIEZ_CATEGORY_SLUGS[category?.trim() ?? ""];
  if (!slug) return null;
  return `${DIEZ_CATEGORY_BASE}/${slug}/`;
}
