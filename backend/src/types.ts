/** Per-site adaptive scraper configuration */
export interface ScraperConfig {
  /** "url" = use searchUrlTemplate; "searchBar" = navigate to baseUrl, find search input, type & submit */
  searchStrategy?: "url" | "searchBar";
  /** Selector for search input (when searchStrategy is searchBar) */
  searchInputSelector?: string;
  /** Selector for search submit button (optional; if omitted, press Enter) */
  searchSubmitSelector?: string;
  /** Multiple price selectors tried in order; first match wins */
  priceSelectors?: string[];
  /** Scope extraction to items matching this (e.g. first search result card) */
  resultItemSelector?: string;
  /** When multiple prices found: "first" | "lowest" | "sale" (prefer sale/original) */
  priceStrategy?: "first" | "lowest" | "sale";
  /** Exclude prices inside <del> (old/strikethrough price). Use current/sale price only. */
  excludePriceInDel?: boolean;
  /** Wait before extracting: "domcontentloaded" | "networkidle" | "selector" | "timeout" */
  waitStrategy?: "domcontentloaded" | "networkidle" | "selector" | "timeout";
  /** Selector to wait for (when waitStrategy is "selector") */
  waitSelector?: string;
  /** Extra wait in ms (e.g. for lazy-loaded content) */
  waitExtraMs?: number;
  /** Steps before extraction (e.g. dismiss cookie banner) */
  preSteps?: Array<{ type: "click" | "scroll"; selector?: string }>;
  /** Custom User-Agent override */
  userAgent?: string;
  /** E-Commerce Navigator: use Playwright+LLM loop for this site (pilot / opt-in) */
  navigatorEnabled?: boolean;
  /** Scope link collection for navigator (e.g. `.productlist`, `main`) */
  navigatorResultContainer?: string;
  /** Optional category URL per product category key (e.g. פסנתרים → category page) */
  categoryUrlByProductCategory?: Record<string, string>;
}

export interface Site {
  id: string;
  name: string;
  baseUrl: string;
  siteUrl?: string; // Optional site URL (for display/linking)
  searchUrlTemplate: string;
  selectors: {
    price: string;
    productName?: string;
    productLink?: string;
  };
  selectorType: "css" | "xpath";
  usePlaywright: boolean;
  enabled: boolean;
  /** Optional per-site adaptive overrides */
  scraperConfig?: ScraperConfig;
}

export interface Product {
  id: string;
  name: string;
  /** Optional; defaults to name for search matching when empty */
  searchTerm?: string;
  /** Brand (חברה) — prepended to every search query with the product name/term */
  brand?: string;
  category: string;
}

export interface ScrapeResult {
  id: string;
  productId: string;
  siteId: string;
  price: number;
  currency: string;
  productUrl: string;
  scrapedAt: string;
}
