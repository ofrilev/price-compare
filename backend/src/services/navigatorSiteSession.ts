import type { Page } from "playwright";
import { productSearchQuery } from "../utils/productSearchQuery.js";
import type { Product, Site } from "../types.js";
import { extractNavigatorPriceFromHtml } from "./navigatorPriceExtract.js";
import { similarityScore } from "./navigatorStringSimilarity.js";
import { logScrape } from "./scrapeLogger.js";
import type { NavigatorQueryPlan } from "./navigatorQueryPlanner.service.js";
import { tryNavigatorVariantAssist } from "./navigatorVariantAssist.service.js";

async function runPreSteps(page: Page, site: Site): Promise<void> {
  const cfg = site.scraperConfig;
  if (!cfg?.preSteps?.length) return;
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

function buildSearchUrl(site: Site, query: string): string {
  const encoded = encodeURIComponent(query);
  return site.searchUrlTemplate
    .replace("{searchTerm}", encoded)
    .replace("{item}", encoded);
}

async function performSearch(page: Page, site: Site, query: string): Promise<void> {
  const cfg = site.scraperConfig;
  const base = site.baseUrl.split("?")[0];
  const root = base.endsWith("/") ? base : `${base}/`;

  if (cfg?.searchStrategy === "searchBar" && cfg.searchInputSelector) {
    await page.goto(root, { waitUntil: "domcontentloaded", timeout: 30000 });
    await runPreSteps(page, site);
    const searchInput = page.locator(cfg.searchInputSelector).first();
    await searchInput.waitFor({ state: "visible", timeout: 10000 }).catch(() => null);
    await searchInput.fill("");
    await searchInput.fill(query);
    if (cfg.searchSubmitSelector) {
      await page.locator(cfg.searchSubmitSelector).first().click({ timeout: 5000 }).catch(() => null);
    } else {
      await searchInput.press("Enter");
    }
    await new Promise((r) => setTimeout(r, 2000));
  } else if (site.searchUrlTemplate) {
    const pathOrUrl = buildSearchUrl(site, query);
    const url = pathOrUrl.startsWith("http")
      ? pathOrUrl
      : new URL(pathOrUrl.replace(/^\//, ""), site.baseUrl).href;
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await runPreSteps(page, site);
  } else {
    await page.goto(root, { waitUntil: "domcontentloaded", timeout: 30000 });
    await runPreSteps(page, site);
  }

  if (cfg?.waitExtraMs) {
    await new Promise((r) => setTimeout(r, cfg.waitExtraMs));
  }
}

interface LinkCandidate {
  href: string;
  text: string;
}

async function collectCandidates(page: Page, site: Site): Promise<LinkCandidate[]> {
  const containerSel =
    site.scraperConfig?.navigatorResultContainer ??
    "main, #main-content, .page-content, .productlist, [role='main'], body";
  const origin = new URL(site.baseUrl).origin;

  return page.evaluate(
    ({ containerSel: cs, origin: o }) => {
      const out: { href: string; text: string }[] = [];
      const roots = document.querySelectorAll(cs);
      const scopes = roots.length > 0 ? Array.from(roots) : [document.body];
      for (const root of scopes) {
        root.querySelectorAll("a[href]").forEach((a) => {
          const href = (a as HTMLAnchorElement).href;
          if (!href || href.startsWith("javascript:") || href.startsWith("#")) return;
          if (href.startsWith("mailto:") || href.startsWith("tel:")) return;
          try {
            if (new URL(href).origin !== o) return;
          } catch {
            return;
          }
          const text = (a.textContent || "").replace(/\s+/g, " ").trim().slice(0, 200);
          if (text.length < 2 && !/\/product\/|\/items?\//i.test(href)) return;
          out.push({ href, text: text || href });
        });
      }
      const seen = new Set<string>();
      return out.filter((c) => {
        if (seen.has(c.href)) return false;
        seen.add(c.href);
        return true;
      });
    },
    { containerSel, origin }
  );
}

async function tryResolveVariants(page: Page): Promise<boolean> {
  const selects = page.locator("select:visible");
  const n = await selects.count();
  if (n > 0) {
    const sel = selects.first();
    const opts = sel.locator("option");
    const oc = await opts.count();
    for (let i = 0; i < oc; i++) {
      const label = (await opts.nth(i).textContent())?.trim() ?? "";
      if (/black|שחור|standard|default|לבן|white/i.test(label) || i === 0) {
        const value = await opts.nth(i).getAttribute("value");
        try {
          if (value) await sel.selectOption({ value });
          else await sel.selectOption({ index: i });
        } catch {
          await sel.selectOption({ index: i }).catch(() => null);
        }
        await new Promise((r) => setTimeout(r, 1200));
        return true;
      }
    }
    await sel.selectOption({ index: 0 }).catch(() => null);
    await new Promise((r) => setTimeout(r, 1200));
    return true;
  }

  const radios = page.locator("input[type=radio]:visible");
  if ((await radios.count()) > 0) {
    await radios.first().click({ timeout: 3000 }).catch(() => null);
    await new Promise((r) => setTimeout(r, 1200));
    return true;
  }

  const swatches = page.locator(
    "[class*='swatch'] button:visible, [data-attribute_name] label:visible, .variation-selector button:visible"
  );
  if ((await swatches.count()) > 0) {
    await swatches.first().click({ timeout: 3000 }).catch(() => null);
    await new Promise((r) => setTimeout(r, 1200));
    return true;
  }

  return false;
}

async function gotoCategoryIfConfigured(
  page: Page,
  site: Site,
  product: Product
): Promise<boolean> {
  const raw = site.scraperConfig?.categoryUrlByProductCategory?.[product.category];
  if (!raw) return false;
  const url = raw.startsWith("http") ? raw : new URL(raw.replace(/^\//, ""), site.baseUrl).href;
  await logScrape(`Navigator ${site.name}: fallback category URL ${url}`);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  await runPreSteps(page, site);
  return true;
}

async function searchFromCurrentPage(page: Page, site: Site, query: string): Promise<void> {
  const cfg = site.scraperConfig;
  if (cfg?.searchStrategy === "searchBar" && cfg.searchInputSelector) {
    const si = page.locator(cfg.searchInputSelector).first();
    await si.waitFor({ state: "visible", timeout: 8000 }).catch(() => null);
    await si.fill("").catch(() => null);
    await si.fill(query).catch(() => null);
    if (cfg.searchSubmitSelector) {
      await page.locator(cfg.searchSubmitSelector).first().click({ timeout: 5000 }).catch(() => null);
    } else {
      await si.press("Enter").catch(() => null);
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  if (cfg?.waitExtraMs) {
    await new Promise((r) => setTimeout(r, cfg.waitExtraMs));
  }
}

async function tryExtractPdp(
  page: Page,
  site: Site
): Promise<{ price: number; productUrl: string } | null> {
  const html = await page.content();
  const extracted = extractNavigatorPriceFromHtml(html, site);
  if (extracted) {
    return { price: extracted.price, productUrl: page.url() };
  }
  return null;
}

async function openBestCandidate(
  page: Page,
  site: Site,
  product: Product,
  candidates: LinkCandidate[]
): Promise<boolean> {
  if (candidates.length === 0) return false;
  const name = product.name;
  const term = productSearchQuery(product);

  let best: LinkCandidate = candidates[0];
  let bestScore = similarityScore(best.text + " " + best.href, name, term);

  for (let i = 1; i < candidates.length; i++) {
    const c = candidates[i];
    const s = similarityScore(c.text + " " + c.href, name, term);
    if (s > bestScore) {
      bestScore = s;
      best = c;
    }
  }

  if (candidates.length > 1 && bestScore < 0.08) {
    await logScrape(
      `Navigator ${site.name}: weak match (score=${bestScore.toFixed(3)}), skipping among ${candidates.length} results`
    );
    return false;
  }

  await logScrape(`Navigator ${site.name}: open ${best.href}`);
  await page.goto(best.href, { waitUntil: "domcontentloaded", timeout: 30000 });
  if (site.scraperConfig?.waitExtraMs) {
    await new Promise((r) => setTimeout(r, site.scraperConfig!.waitExtraMs));
  }
  return true;
}

/**
 * Navigator loop: search → rank results → PDP → variant heuristics → optional LLM assist.
 */
export async function navigateAndExtractProduct(
  page: Page,
  site: Site,
  product: Product,
  plan: NavigatorQueryPlan
): Promise<{ price: number; productUrl: string } | null> {
  const queries = [plan.primary, plan.secondary, plan.tertiary].filter(
    (q, i, a) => q && a.indexOf(q) === i
  );

  const categoryUrlConfigured = Boolean(
    site.scraperConfig?.categoryUrlByProductCategory?.[product.category]
  );

  for (const query of queries) {
    await logScrape(`Navigator ${site.name}: query "${query}"`);

    try {
      await performSearch(page, site, query);
    } catch (err) {
      await logScrape(`Navigator ${site.name}: performSearch failed: ${String(err)}`);
      continue;
    }

    let candidates = await collectCandidates(page, site);
    await logScrape(`Navigator ${site.name}: ${candidates.length} candidate link(s)`);

    if (candidates.length === 0 && categoryUrlConfigured) {
      await gotoCategoryIfConfigured(page, site, product);
      await searchFromCurrentPage(page, site, query);
      candidates = await collectCandidates(page, site);
      await logScrape(`Navigator ${site.name}: after category fallback, ${candidates.length} candidate(s)`);
    }

    if (candidates.length === 0) {
      const direct = await tryExtractPdp(page, site);
      if (direct) return direct;
      continue;
    }

    const opened = await openBestCandidate(page, site, product, candidates);
    if (!opened) continue;

    let result = await tryExtractPdp(page, site);
    if (result) return result;

    for (let attempt = 0; attempt < 3; attempt++) {
      const changed = await tryResolveVariants(page);
      if (!changed) break;
      result = await tryExtractPdp(page, site);
      if (result) return result;
    }

    const assisted = await tryNavigatorVariantAssist(page, site, product);
    if (assisted) {
      result = await tryExtractPdp(page, site);
      if (result) return result;
    }
  }

  return null;
}
