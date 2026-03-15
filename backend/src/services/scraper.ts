import { chromium } from "playwright";
import * as cheerio from "cheerio";
import axios from "axios";
import { v4 as uuidv4 } from "uuid";
import { readJson, writeJson } from "./store.js";
import { parsePrice } from "./priceParser.js";
import { matchesProduct, getSearchTermFallbacks } from "./searchTermNormalizer.js";
import { emit as progressEmit } from "./scrapeProgress.js";
import { scrapeWithLLMFallback } from "./llmScraper.js";
import type { Site, Product, ScrapeResult } from "../types.js";

const RATE_LIMIT_MS = 2000;
const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/** Resolve price selectors to try (config overrides or legacy) */
function getPriceSelectors(site: Site): string[] {
  const cfg = site.scraperConfig?.priceSelectors;
  if (cfg?.length) return cfg;
  return site.selectors.price ? [site.selectors.price] : [];
}

/** Resolve wait strategy */
function getWaitStrategy(site: Site) {
  return site.scraperConfig?.waitStrategy ?? "domcontentloaded";
}

/** Get initial URL for scrape (baseUrl for searchBar, or built search URL) */
function getInitialUrl(site: Site, searchTerm: string): string {
  const cfg = site.scraperConfig;
  if (cfg?.searchStrategy === "searchBar") {
    const base = site.baseUrl.split("?")[0];
    return base.endsWith("/") ? base : base + "/";
  }
  return site.searchUrlTemplate.replace("{searchTerm}", encodeURIComponent(searchTerm));
}

async function scrapeWithPlaywright(
  url: string,
  site: Site,
  searchTerm: string
): Promise<{ price: number | null; productUrl: string }> {
  const cfg = site.scraperConfig;
  const userAgent = cfg?.userAgent ?? DEFAULT_USER_AGENT;
  const waitStrategy = getWaitStrategy(site);
  const waitUntil = waitStrategy === "networkidle" ? "networkidle" : "domcontentloaded";

  const browser = await chromium.launch({ headless: false });
  try {
    const page = await browser.newPage();

    page.on("console", (msg) => console.log(`[Scrape Console ${msg.type()}]`, msg.text()));
    page.on("request", (req) => console.log(`[Scrape Request]`, req.method(), req.url()));
    page.on("response", (res) => console.log(`[Scrape Response]`, res.status(), res.url()));
    page.on("load", () => console.log(`[Scrape] Page load complete:`, url));
    page.on("domcontentloaded", () => console.log(`[Scrape] DOM ready:`, url));

    await page.setExtraHTTPHeaders({ "User-Agent": userAgent });
    console.log(`[Scrape] Navigating to:`, url);
    await page.goto(url, { waitUntil, timeout: 30000 });

    // Pre-steps (cookie banner, etc.) - run before search so popups don't block
    if (cfg?.preSteps?.length) {
      for (const step of cfg.preSteps) {
        if (step.type === "click" && step.selector) {
          console.log(`[Scrape] Pre-step: click`, step.selector);
          await page.locator(step.selector).first().click({ timeout: 5000 }).catch(() => null);
        }
        if (step.type === "scroll") {
          console.log(`[Scrape] Pre-step: scroll`);
          await page.evaluate(() => window.scrollBy(0, 300));
        }
        await new Promise((r) => setTimeout(r, 500));
      }
    }

    // Search bar flow: type in search input and submit
    if (cfg?.searchStrategy === "searchBar" && cfg?.searchInputSelector) {
      console.log(`[Scrape] Search bar: typing "${searchTerm}"`);
      const searchInput = page.locator(cfg.searchInputSelector).first();
      await searchInput.waitFor({ state: "visible", timeout: 10000 }).catch(() => null);
      await searchInput.fill("");
      await searchInput.fill(searchTerm);
      if (cfg.searchSubmitSelector) {
        await page.locator(cfg.searchSubmitSelector).first().click({ timeout: 5000 }).catch(() => null);
      } else {
        await searchInput.press("Enter");
      }
      await new Promise((r) => setTimeout(r, 2000));
    }

    // Extra wait for lazy content
    if (cfg?.waitExtraMs) {
      console.log(`[Scrape] Extra wait:`, cfg.waitExtraMs, "ms");
      await new Promise((r) => setTimeout(r, cfg!.waitExtraMs!));
    }

    // Wait for selector if configured
    if (cfg?.waitSelector) {
      console.log(`[Scrape] Waiting for selector:`, cfg.waitSelector);
      await page.locator(cfg.waitSelector).first().waitFor({ state: "visible", timeout: 10000 }).catch(() => null);
    }

    const priceSelectors = getPriceSelectors(site);
    const resultItemSelector = cfg?.resultItemSelector;
    const priceStrategy = cfg?.priceStrategy ?? "first";
    const productNameSelector = site.selectors.productName;

    let price: number | null = null;
    let priceText: string | null = null;
    let productUrl = url;

    if (resultItemSelector) {
      // Multiple results: find the one matching search term (regex: cx40 matches cx-40, cx 40)
      const items = page.locator(resultItemSelector);
      const count = await items.count();
      console.log(`[Scrape] Found ${count} result items, matching against "${searchTerm}"`);

      for (let i = 0; i < count; i++) {
        const item = items.nth(i);
        const name = productNameSelector
          ? await item.locator(productNameSelector).first().textContent().catch(() => null)
          : await item.textContent().catch(() => null);
        if (!name || !matchesProduct(name, searchTerm)) continue;

        console.log(`[Scrape] Matched product:`, name.trim());
        for (const sel of priceSelectors) {
          const selector = site.selectorType === "xpath" ? `xpath=${sel}` : sel;
          const text = await item.locator(selector).first().textContent().catch(() => null);
          if (text) {
            const p = parsePrice(text);
            if (p !== null) {
              price = p;
              priceText = text;
              break;
            }
          }
        }
        if (site.selectors.productLink) {
          const href = await item.locator(site.selectors.productLink).first().getAttribute("href").catch(() => null);
          if (href) productUrl = href.startsWith("http") ? href : new URL(href, site.baseUrl).href;
        }
        if (price !== null) break;
      }
    } else {
      // Single result or no product name selector: use first match
      const scope = resultItemSelector ? page.locator(resultItemSelector).first() : page;
      const allPrices: number[] = [];

      for (const sel of priceSelectors) {
        const selector = site.selectorType === "xpath" ? `xpath=${sel}` : sel;
        const el = scope.locator(selector).first();
        await el.waitFor({ state: "visible", timeout: 5000 }).catch(() => null);
        const text = await el.textContent().catch(() => null);
        if (text) {
          const p = parsePrice(text);
          if (p !== null) {
            allPrices.push(p);
            if (price === null || (priceStrategy === "lowest" && p < price) || (priceStrategy === "first" && price === null)) {
              price = p;
              priceText = text;
            }
          }
        }
        if (price !== null && priceStrategy === "first") break;
      }

      if (priceStrategy === "lowest" && allPrices.length > 0) {
        price = Math.min(...allPrices);
        priceText = String(price);
      }

      if (site.selectors.productLink) {
        const linkEl = scope.locator(site.selectors.productLink).first();
        const href = await linkEl.getAttribute("href").catch(() => null);
        if (href) productUrl = href.startsWith("http") ? href : new URL(href, site.baseUrl).href;
      }
    }

    console.log(`[Scrape] Extracted price:`, priceText, "->", price);
    return { price, productUrl };
  } finally {
    await browser.close();
  }
}

async function scrapeWithCheerio(
  url: string,
  site: Site
): Promise<{ price: number | null; productUrl: string }> {
  const userAgent = site.scraperConfig?.userAgent ?? DEFAULT_USER_AGENT;
  console.log(`[Scrape Cheerio] Fetching:`, url);
  const { data } = await axios.get(url, {
    headers: { "User-Agent": userAgent },
    timeout: 15000,
  });

  const $ = cheerio.load(data);
  const priceSelectors = getPriceSelectors(site);
  const cfg = site.scraperConfig;
  const resultItemSelector = cfg?.resultItemSelector;
  const priceStrategy = cfg?.priceStrategy ?? "first";

  const scope = resultItemSelector ? $(resultItemSelector).first() : $.root();
  let price: number | null = null;
  const allPrices: number[] = [];

  for (const sel of priceSelectors) {
    const priceText = scope.find(sel).first().text().trim();
    const p = parsePrice(priceText);
    if (p !== null) {
      allPrices.push(p);
      if (price === null || (priceStrategy === "lowest" && p < price)) {
        price = p;
      }
      if (priceStrategy === "first") break;
    }
  }

  if (priceStrategy === "lowest" && allPrices.length > 0) {
    price = Math.min(...allPrices);
  }
  console.log(`[Scrape Cheerio] Extracted price:`, price);

  let productUrl = url;
  if (site.selectors.productLink) {
    const href = scope.find(site.selectors.productLink).first().attr("href");
    if (href) productUrl = href.startsWith("http") ? href : new URL(href, site.baseUrl).href;
  }

  return { price, productUrl };
}

export async function runScrape(options: {
  productIds?: string[];
  category?: string;
}): Promise<ScrapeResult[]> {
  const sites = await readJson<Site[]>("sites.json");
  const products = await readJson<Product[]>("products.json");

  const enabledSites = sites.filter((s) => s.enabled);
  let targetProducts = products;
  if (options.productIds?.length) {
    targetProducts = products.filter((p) => options.productIds!.includes(p.id));
  } else if (options.category) {
    targetProducts = products.filter((p) => p.category === options.category);
  }

  const results: ScrapeResult[] = [];
  progressEmit("status", `Scrape started: ${targetProducts.length} product(s), ${enabledSites.length} site(s)`);

  for (const product of targetProducts) {
    for (const site of enabledSites) {
      try {
        progressEmit("status", `Now searching for ${product.name} in ${site.name}`);
        console.log(`[Scrape] --- ${product.name} @ ${site.name} ---`);

        const searchTermsToTry = getSearchTermFallbacks(product.searchTerm);
        const usePlaywright = site.scraperConfig?.searchStrategy === "searchBar" || site.usePlaywright;
        let price: number | null = null;
        let productUrl = "";

        for (const searchTerm of searchTermsToTry) {
          const url = getInitialUrl(site, searchTerm);
          if (searchTerm !== product.searchTerm) {
            console.log(`[Scrape] Retrying with fallback: "${searchTerm}"`);
          }
          const result = usePlaywright
            ? await scrapeWithPlaywright(url, site, searchTerm)
            : await scrapeWithCheerio(url, site);
          price = result.price;
          productUrl = result.productUrl;
          if (price !== null) break;
          await new Promise((r) => setTimeout(r, RATE_LIMIT_MS / 2)); // brief delay between fallbacks
        }

        // LLM fallback: if all regular methods failed, try LLM-based extraction
        if (price === null && process.env.OPENAI_API_KEY) {
          console.log(`[Scrape] Regular scraping failed, trying LLM fallback...`);
          progressEmit("status", `Trying LLM fallback for ${product.name} on ${site.name}`);
          try {
            const url = getInitialUrl(site, product.searchTerm);
            const llmResult = await scrapeWithLLMFallback(url, site, product.searchTerm);
            if (llmResult.price !== null) {
              price = llmResult.price;
              productUrl = llmResult.productUrl;
              console.log(`[Scrape] LLM fallback succeeded: ${price} ILS`);
            }
          } catch (err) {
            console.error(`[Scrape] LLM fallback failed:`, err);
          }
        }

        if (price !== null) {
          progressEmit("status", `Finished getting info about ${product.name} from ${site.name}: ${price} ILS`);
          results.push({
            id: uuidv4(),
            productId: product.id,
            siteId: site.id,
            price,
            currency: "ILS",
            productUrl,
            scrapedAt: new Date().toISOString(),
          });
        } else {
          progressEmit("status", `No price found for ${product.name} on ${site.name}`);
        }
        await new Promise((r) => setTimeout(r, RATE_LIMIT_MS));
      } catch (err) {
        progressEmit("error", `Scrape failed for ${product.name} on ${site.name}`);
        console.error(`Scrape failed for ${product.name} on ${site.name}:`, err);
      }
    }
    progressEmit("status", `Finished getting info about ${product.name}`);
  }

  progressEmit("done", `Scrape complete: ${results.length} price(s) found`);
  const existing = await readJson<ScrapeResult[]>("results.json");
  const updated = [...existing, ...results];
  await writeJson("results.json", updated);

  return results;
}
