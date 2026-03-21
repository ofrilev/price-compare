import { chromium, type Browser } from "playwright";
import axios from "axios";
import { parseSiteHtml } from "../parsers/configParser.js";
import { logScrape } from "./scrapeLogger.js";
import type { Site } from "../types.js";
import type { RawProduct } from "../parsers/baseParser.js";

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function getWaitStrategy(site: Site) {
  return site.scraperConfig?.waitStrategy ?? "domcontentloaded";
}

function getInitialUrl(site: Site, searchTerm: string): string {
  const cfg = site.scraperConfig;
  if (cfg?.searchStrategy === "searchBar") {
    const base = site.baseUrl.split("?")[0];
    return base.endsWith("/") ? base : base + "/";
  }
  if (!site.searchUrlTemplate) return "";
  const encoded = encodeURIComponent(searchTerm);
  return site.searchUrlTemplate
    .replace("{searchTerm}", encoded)
    .replace("{item}", encoded);
}

function usePlaywright(site: Site): boolean {
  return (
    site.scraperConfig?.searchStrategy === "searchBar" || site.usePlaywright
  );
}

export interface ScrapeSiteOptions {
  /** When set, navigate directly to this URL instead of building from search. Skips search bar. */
  urlOverride?: string;
}

async function scrapeWithPlaywright(
  url: string,
  site: Site,
  searchTerm: string,
  browser?: Browser,
  skipSearchBar = false,
): Promise<RawProduct[]> {
  const cfg = site.scraperConfig;
  const userAgent = cfg?.userAgent ?? DEFAULT_USER_AGENT;
  const waitStrategy = getWaitStrategy(site);
  const waitUntil =
    waitStrategy === "networkidle" ? "networkidle" : "domcontentloaded";

  const shouldClose = !browser;
  const b = browser ?? (await chromium.launch({ headless: true }));

  try {
    const page = await b.newPage();
    await page.setExtraHTTPHeaders({ "User-Agent": userAgent });
    await logScrape(
      `${site.name}: navigating to url=${url} (waitUntil=${waitUntil})`,
    );
    await page.goto(url, { waitUntil, timeout: 30000 });
    const urlAfterNav = page.url();
    await logScrape(
      `${site.name}: after navigation, currentUrl=${urlAfterNav}`,
    );

    if (cfg?.preSteps?.length) {
      await logScrape(
        `${site.name}: running ${cfg.preSteps.length} pre-step(s)`,
      );
      for (const step of cfg.preSteps) {
        if (step.type === "click" && step.selector) {
          await page
            .locator(step.selector)
            .first()
            .click({ timeout: 5000 })
            .catch(() => null);
        }
        if (step.type === "scroll") {
          await page.evaluate(() => window.scrollBy(0, 300));
        }
        await new Promise((r) => setTimeout(r, 500));
      }
    }

    if (
      !skipSearchBar &&
      cfg?.searchStrategy === "searchBar" &&
      cfg?.searchInputSelector
    ) {
      await logScrape(
        `${site.name}: typing search searchTerm="${searchTerm}" (selector=${cfg.searchInputSelector})`,
      );
      const searchInput = page.locator(cfg.searchInputSelector).first();
      const inputVisible = await searchInput
        .waitFor({ state: "visible", timeout: 10000 })
        .then(() => true)
        .catch(() => false);
      await logScrape(`${site.name}: search input visible=${inputVisible}`);
      await searchInput.fill("");
      await searchInput.fill(searchTerm);
      if (cfg.searchSubmitSelector) {
        await page
          .locator(cfg.searchSubmitSelector)
          .first()
          .click({ timeout: 5000 })
          .catch(() => null);
      } else {
        await searchInput.press("Enter");
      }
      await new Promise((r) => setTimeout(r, 2000));
      const urlAfterSearch = page.url();
      await logScrape(
        `${site.name}: after search, currentUrl=${urlAfterSearch}`,
      );
    }

    if (cfg?.waitExtraMs) {
      await logScrape(
        `${site.name}: waiting ${cfg.waitExtraMs}ms for lazy content`,
      );
      await new Promise((r) => setTimeout(r, cfg.waitExtraMs));
    }

    if (cfg?.waitSelector) {
      await logScrape(`${site.name}: waiting for selector ${cfg.waitSelector}`);
      await page
        .locator(cfg.waitSelector)
        .first()
        .waitFor({ state: "visible", timeout: 10000 })
        .catch(() => null);
    }

    const finalUrl = page.url();
    const html = await page.content();
    const products = await parseSiteHtml(html, site);
    await logScrape(
      `${site.name} (Playwright): finalUrl=${finalUrl} | parsed ${products.length} product(s) | htmlLength=${html.length}`,
    );
    return products;
  } finally {
    if (shouldClose) await b.close();
  }
}

async function scrapeWithCheerio(
  url: string,
  site: Site,
): Promise<RawProduct[]> {
  const userAgent = site.scraperConfig?.userAgent ?? DEFAULT_USER_AGENT;
  const { data } = await axios.get(url, {
    headers: { "User-Agent": userAgent },
    timeout: 15000,
  });
  const products = await parseSiteHtml(data, site);
  await logScrape(
    `${site.name} (Cheerio): url=${url} | parsed ${products.length} product(s) | htmlLength=${data.length}`,
  );
  return products;
}

/**
 * Scrape a site for a search term. Returns raw product list.
 * If browser is provided, reuses it; otherwise launches and closes.
 * When options.urlOverride is set (e.g. direct category URL), navigates there and skips search bar.
 */
export async function scrapeSite(
  site: Site,
  searchTerm: string,
  browser?: Browser,
  options?: ScrapeSiteOptions,
): Promise<RawProduct[]> {
  const url = options?.urlOverride ?? getInitialUrl(site, searchTerm);
  const searchParams = {
    searchTerm,
    encoded: encodeURIComponent(searchTerm || ""),
    searchStrategy: site.scraperConfig?.searchStrategy ?? "url",
    urlOverride: !!options?.urlOverride,
  };
  if (!url) {
    await logScrape(
      `${site.name}: no URL (empty searchUrlTemplate for searchBar sites), baseUrl=${site.baseUrl}, searchParams=${JSON.stringify(searchParams)}`,
    );
    return [];
  }

  const method = usePlaywright(site) ? "Playwright" : "Cheerio";
  await logScrape(
    `${site.name}: scraping searchParams=${JSON.stringify(searchParams)} via ${method} | initialUrl=${url}`,
  );

  const skipSearchBar = !!options?.urlOverride;
  if (usePlaywright(site)) {
    return scrapeWithPlaywright(url, site, searchTerm, browser, skipSearchBar);
  }
  return scrapeWithCheerio(url, site);
}
