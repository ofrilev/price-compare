import axios from "axios";
import { readJson } from "./store.js";

/** Extract JSON object from LLM response (for matching step with comparison/unmatched) */
function extractMatchingJsonFromResponse(content: string): string | null {
  const trimmed = content.trim();
  const codeBlock = trimmed.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
  if (codeBlock) return codeBlock[1];
  if (trimmed.startsWith("{")) {
    try {
      JSON.parse(trimmed);
      return trimmed;
    } catch {}
    let depth = 0;
    for (let i = 0; i < trimmed.length; i++) {
      if (trimmed[i] === "{") depth++;
      else if (trimmed[i] === "}") {
        depth--;
        if (depth === 0) {
          try {
            const candidate = trimmed.slice(0, i + 1);
            const parsed = JSON.parse(candidate);
            if (parsed && typeof parsed === "object") return candidate;
          } catch {}
          break;
        }
      }
    }
  }
  const idx = trimmed.indexOf('{"comparison"');
  if (idx < 0) return null;
  let depth = 0;
  for (let i = idx; i < trimmed.length; i++) {
    if (trimmed[i] === "{") depth++;
    else if (trimmed[i] === "}") {
      depth--;
      if (depth === 0) {
        try {
          return trimmed.slice(idx, i + 1);
        } catch {}
        break;
      }
    }
  }
  return null;
}

import { emit as progressEmit } from "./scrapeProgress.js";
import { logScrape, logScrapeError } from "./scrapeLogger.js";
import { ensureAnchorSiteInList } from "../config/anchorSite.js";
import { getStealthChromium } from "../config/playwrightChromium.js";
import { getChromiumLaunchOptions } from "../config/playwrightLaunch.js";
import { logLLMRequest, logLLMResponse, logLLMError } from "./llmLogger.js";
import type { ScrapeResult, Product, Site } from "../types.js";

interface SiteProductData {
  siteName: string;
  siteUrl: string;
  products: Array<{
    name: string;
    price: number;
    url: string;
  }>;
}

interface MatchedProduct {
  model: string;
  common_features: string;
  prices: Array<{
    site: string;
    price: number;
    url: string;
  }>;
  best_deal: string;
}

interface UnmatchedProduct {
  model: string;
  site: string;
  price: number;
  url: string;
}

interface CategoryMatchResponse {
  comparison: MatchedProduct[];
  unmatched_highlights: string[];
  unmatched?: UnmatchedProduct[];
}

interface SiteProductItem {
  name: string;
  price: number;
  url: string;
}

/**
 * Scrape product list from a single site for a category using Playwright/Cheerio.
 * Uses optional per-site category URL from scraperConfig, otherwise searches by category name.
 */
async function scrapeCategoryFromSite(
  site: Site,
  category: string,
  browser?: import("playwright").Browser,
): Promise<SiteProductItem[]> {
  const categoryUrl =
    site.scraperConfig?.categoryUrlByProductCategory?.[category];

  progressEmit("status", `מחפש מוצרים ב-${site.name}...`);
  await logScrape(
    `Category match: scraping ${site.name} | category="${category}" | ${categoryUrl ? `categoryUrl=${categoryUrl}` : `search="${category}"`}`,
  );

  try {
    const { scrapeSite } = await import("./scraperService.js");
    const { normalizeProduct, dedupeByUrl } =
      await import("./normalization.service.js");
    const options = categoryUrl ? { urlOverride: categoryUrl } : undefined;
    const raw = await scrapeSite(site, category, browser, options);
    await logScrape(
      `Category match: ${site.name} raw=${raw.length} product(s)`,
    );
    const normalized = raw
      .map((r) => normalizeProduct(r))
      .filter((n): n is NonNullable<typeof n> => n !== null);
    const deduped = dedupeByUrl(normalized);

    const MAX_PRODUCTS = 20;
    const items: SiteProductItem[] = deduped
      .slice(0, MAX_PRODUCTS)
      .map((p) => ({
        name: p.name,
        price: p.price,
        url: p.productUrl,
      }));

    progressEmit(
      "status",
      `נמצאו ${items.length} מוצרים ב-${site.name} (מוגבל ל-${MAX_PRODUCTS})`,
    );
    await logScrape(
      `Category match: ${site.name} → ${items.length} product(s) after normalize+dedupe (capped at ${MAX_PRODUCTS})`,
    );
    return items;
  } catch (err: any) {
    progressEmit(
      "error",
      `שגיאה בחיפוש ב-${site.name}: ${err.message || "שגיאה לא ידועה"}`,
    );
    await logScrapeError(`Category match: ${site.name} failed`, err);
    return [];
  }
}

/** Check if product name matches whitelist (products.json) - fuzzy by normalized name/searchTerm */
function isInWhitelist(
  productName: string,
  whitelistKeys: Set<string>,
): boolean {
  const n = productName.toLowerCase().trim();
  if (!n) return false;
  for (const k of whitelistKeys) {
    if (n.includes(k) || k.includes(n)) return true;
  }
  return false;
}

/**
 * Use LLM to match products across sites for a category.
 * Fetches new products from each site AND uses existing scrape results.
 */
export async function matchCategoryProducts(
  category: string,
  siteIds?: string[],
): Promise<CategoryMatchResponse | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.log(`[Category Matcher] No OPENAI_API_KEY found`);
    return null;
  }

  const results = await readJson<ScrapeResult[]>("results.json").catch(
    () => [],
  );
  const products = await readJson<Product[]>("products.json");
  const sites = await readJson<Site[]>("sites.json");

  if (!siteIds?.length) {
    throw new Error("חובה לבחור לפחות אתר אחד להתאמת קטגוריה");
  }

  // Filter sites — רק מה שנבחר בלקוח (ללא ברירת מחדל לכל האתרים)
  let targetSites = sites.filter((s) => s.enabled && siteIds.includes(s.id));
  targetSites = ensureAnchorSiteInList(targetSites, sites);

  if (targetSites.length === 0) {
    progressEmit("status", "לא נמצאו אתרים פעילים");
    return { comparison: [], unmatched_highlights: [] };
  }

  const productMap = new Map(products.map((p) => [p.id, p]));
  const catLower = category.toLowerCase().trim();
  const productIdsInCategory = products
    .filter((p) => {
      const pCat = (p.category || "").toLowerCase().trim();
      return (
        p.category === category ||
        pCat.includes(catLower) ||
        catLower.includes(pCat)
      );
    })
    .map((p) => p.id);
  const categoryResults = results.filter((r) =>
    productIdsInCategory.includes(r.productId),
  );

  const whitelistKeys = new Set(
    products.flatMap((p) =>
      [p.name, p.searchTerm, p.brand]
        .filter(Boolean)
        .map((s) => String(s).toLowerCase().trim()),
    ),
  );

  const leadSite = targetSites[0];
  const otherSites = targetSites.slice(1);

  const usePlaywrightSites = targetSites.filter(
    (s) => s.scraperConfig?.searchStrategy === "searchBar" || s.usePlaywright,
  );
  const browser =
    usePlaywrightSites.length > 0
      ? await getStealthChromium().launch(getChromiumLaunchOptions())
      : undefined;

  await logScrape(
    `Category match: category="${category}", lead="${leadSite.name}", ${targetSites.length} site(s)`,
  );

  const siteProducts: SiteProductData[] = [];

  try {
    // Step 1: Scrape lead site (first in list) for category discovery
    const leadProducts = await scrapeCategoryFromSite(
      leadSite,
      category,
      browser,
    );
    const newProducts = leadProducts.filter(
      (p) => !isInWhitelist(p.name, whitelistKeys),
    );

    progressEmit(
      "status",
      `${leadSite.name}: ${leadProducts.length} מוצרים, ${newProducts.length} חדשים (לא בוויטליסט)`,
    );
    await logScrape(
      `Category match: ${leadSite.name} ${leadProducts.length} products, ${newProducts.length} new (not in whitelist)`,
    );

    siteProducts.push({
      siteName: leadSite.name,
      siteUrl: leadSite.siteUrl || leadSite.baseUrl,
      products: leadProducts,
    });

    // Step 2: For new products, search in other sites via search bar (with fallback variations)
    const { scrapeSite } = await import("./scraperService.js");
    const {
      normalizeProduct,
      filterMatchingProducts,
      dedupeByUrl,
      getSearchTermFallbacks,
    } = await import("./normalization.service.js");

    for (const otherSite of otherSites) {
      const siteItems: SiteProductItem[] = [];

      // Add existing results for whitelist products
      const existingForSite = categoryResults
        .filter((r) => r.siteId === otherSite.id)
        .map((r) => ({
          name: productMap.get(r.productId)?.name || "Unknown",
          price: r.price,
          url: r.productUrl,
        }));
      for (const p of existingForSite) {
        siteItems.push(p);
      }

      // Search new products via search bar, with fallback variations (max 20)
      const MAX_PRODUCTS_PER_SITE = 20;
      for (const newProduct of newProducts) {
        if (siteItems.length >= MAX_PRODUCTS_PER_SITE) break;
        const searchTerms = getSearchTermFallbacks(newProduct.name);
        let found = false;
        for (const searchTerm of searchTerms) {
          progressEmit("status", `מחפש "${searchTerm}" ב-${otherSite.name}...`);
          try {
            const raw = await scrapeSite(otherSite, searchTerm, browser);
            const normalized = raw
              .map((r) => normalizeProduct(r))
              .filter((n): n is NonNullable<typeof n> => n !== null);
            const matched = filterMatchingProducts(normalized, newProduct.name);
            const deduped = dedupeByUrl(matched);
            if (deduped.length > 0) {
              const best = deduped.reduce((a, b) =>
                a.price < b.price ? a : b,
              );
              siteItems.push({
                name: best.name,
                price: best.price,
                url: best.productUrl,
              });
              await logScrape(
                `${otherSite.name}: found "${newProduct.name}" (via "${searchTerm}") @ ${best.price} ILS`,
              );
              found = true;
              break;
            }
          } catch (err: any) {
            await logScrapeError(
              `${otherSite.name} search for "${searchTerm}"`,
              err,
            );
          }
        }
        if (!found && searchTerms.length > 1) {
          await logScrape(
            `${otherSite.name}: no results for "${newProduct.name}" after ${searchTerms.length} variations`,
          );
        }
      }

      siteProducts.push({
        siteName: otherSite.name,
        siteUrl: otherSite.siteUrl || otherSite.baseUrl,
        products: siteItems.slice(0, MAX_PRODUCTS_PER_SITE),
      });
    }
  } finally {
    if (browser) await browser.close();
  }

  const totalProducts = siteProducts.reduce(
    (sum, s) => sum + s.products.length,
    0,
  );
  if (totalProducts === 0) {
    progressEmit("status", `לא נמצאו מוצרים בקטגוריה "${category}" באף אתר`);
    await logScrape("Category match: no products found in any site");
    return { comparison: [], unmatched_highlights: [] };
  }

  progressEmit(
    "status",
    `מתחיל התאמת מוצרים בקטגוריה "${category}" עבור ${siteProducts.length} אתר(ים)`,
  );
  await logScrape(
    `Category match: ${totalProducts} total product(s) across ${siteProducts.length} site(s), sending to GPT for matching`,
  );
  progressEmit("status", `סה"כ ${totalProducts} מוצרים נמצאו`);

  const prompt = `**Role**: Music Gear Data Matching Expert
**Task**: Compare product lists from multiple music stores and identify common items to create a price comparison table.

**Input Data**: You will receive several JSON lists. Each list represents products found on a specific website for the category. The lists may include both products we already track AND newly discovered products - compare and match ALL of them.

**Rules for Matching**:
1. **Fuzzy Matching**: Identify if products are the same even if titles vary (e.g., "Roland FP10" vs "Roland FP-10 Black").
2. **Exclusion**: Ignore accessories (cases, stands) unless they are part of a bundle for the main product.
3. **Threshold**: Only include products that appear in **at least two different stores** when multiple stores are listed; if only one store was scraped, one price is enough.
4. **Normalization**: Extract the core Model Name as the primary key.

**Category**: ${category}

**Product Data from Sites**:
${JSON.stringify(siteProducts, null, 2)}

**Output Format**:
Return a JSON object with the following structure:
{
  "comparison": [
    {
      "model": "Exact Model Name",
      "common_features": "Brief summary",
      "prices": [
        { "site": "Site Name", "price": number, "url": "Product page URL for this site - REQUIRED" },
        ...
      ],
      "best_deal": "Site Name"
    }
  ],
  "unmatched_highlights": [
    "List high-value items found only in one store that the user might like"
  ],
  "unmatched": [
    {
      "model": "Exact Model Name",
      "site": "Site Name",
      "price": number,
      "url": "Product URL from input data"
    }
  ]
}

For "unmatched": Include products found in only ONE store. Use the exact site name and URL from the input Product Data. **IMPORTANT**: Every item in "prices" and "unmatched" MUST include the "url" field - the product page URL for that site. These will be saved as products for future comparison.

**Important**:
- Match products intelligently across sites (e.g., "Roland FP-10" = "Roland FP10" = "Roland FP 10")
- Only include products found in **at least two stores** when the input lists multiple stores
- Sort prices from lowest to highest
- Set "best_deal" to the site with the lowest price
- Return ONLY valid JSON, no markdown, no explanations`;

  // Category compare always uses better model for matching
  const model = process.env.OPENAI_MODEL_BETTER || "gpt-4o";

  await logLLMRequest(
    `Category Match: ${category}`,
    category,
    siteProducts.map((s) => ({
      name: s.siteName,
      baseUrl: s.siteUrl,
      searchUrl: s.siteUrl,
    })),
    prompt,
    model,
  ).catch((err) => console.error("[LLM Logger] Failed to log request:", err));

  progressEmit("llm_prompt", JSON.stringify({ category, prompt }));
  progressEmit("status", `שולח בקשה ל-LLM להתאמת מוצרים...`);

  try {
    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model,
        messages: [
          {
            role: "system",
            content:
              "You are a Music Gear Data Matching Expert. Your task is to compare product lists from multiple music stores, identify common products using fuzzy matching, and return structured JSON results. Every price entry must include the product page URL for that site. Always return valid JSON only - no markdown, no explanations, just the JSON object.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        temperature: 0.1,
        max_tokens: 3000,
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        timeout: 60000,
      },
    );

    const content = response.data.choices[0]?.message?.content?.trim();
    if (!content) return null;

    const jsonStr = extractMatchingJsonFromResponse(content);
    if (!jsonStr) {
      const isRefusal =
        /^(I'm sorry|I cannot|I'm unable|I don't have|As an AI)/i.test(content);
      const msg = isRefusal
        ? "המודל לא יכול לבצע את המשימה - נסה מודל אחר"
        : "תשובה לא צפויה מהמודל - לא נמצא JSON";
      progressEmit("error", `שגיאה בהתאמת קטגוריה: ${msg}`);
      throw new Error(msg);
    }

    const result: CategoryMatchResponse = JSON.parse(jsonStr);

    const minPrices = targetSites.length >= 2 ? 2 : 1;
    const filteredComparison = (result.comparison || []).filter(
      (item) => (item.prices?.length ?? 0) >= minPrices,
    );
    result.comparison = filteredComparison;

    await logLLMResponse(`Category Match: ${category}`, response, result).catch(
      (err) => console.error("[LLM Logger] Failed to log response:", err),
    );

    const rawContent =
      response.data?.choices?.[0]?.message?.content?.trim() || "";
    progressEmit(
      "llm_response",
      JSON.stringify({
        category,
        rawResponse: rawContent,
        parsedResult: result,
      }),
    );

    progressEmit(
      "status",
      `התאמה הושלמה: נמצאו ${result.comparison.length} מוצרים משותפים`,
    );
    if (result.unmatched_highlights && result.unmatched_highlights.length > 0) {
      progressEmit(
        "status",
        `נמצאו ${result.unmatched_highlights.length} מוצרים ייחודיים`,
      );
    }

    return result;
  } catch (err: any) {
    await logLLMError(`Category Match: ${category}`, err, {
      category,
      siteProducts: siteProducts.map((s) => ({
        name: s.siteName,
        productCount: s.products.length,
      })),
      model,
    }).catch((logErr) =>
      console.error("[LLM Logger] Failed to log error:", logErr),
    );

    progressEmit(
      "error",
      `שגיאה בהתאמת קטגוריה: ${err.message || "שגיאה לא ידועה"}`,
    );
    console.error(`[Category Matcher] Error:`, err.message);
    return null;
  }
}
