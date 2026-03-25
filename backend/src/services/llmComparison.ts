import axios from "axios";
import { v4 as uuidv4 } from "uuid";
import { readJson } from "./store.js";
import { emit as progressEmit } from "./scrapeProgress.js";
import { parsePrice } from "./priceParser.js";
import {
  logLLMRequest,
  logLLMResponse,
  logLLMError,
  logLLMComparisonStart,
  logLLMComparisonEnd,
} from "./llmLogger.js";
import { appendLlmTokenUsage, logScrape } from "./scrapeLogger.js";
import { ensureAnchorSiteInList } from "../config/anchorSite.js";
import { productSearchQuery } from "../utils/productSearchQuery.js";
import { getSearchTermFallbacks } from "./normalization.service.js";
import type { Site, Product, ScrapeResult } from "../types.js";

interface LLMComparisonRequest {
  productIds: string[];
  siteIds?: string[];
  category?: string;
}

interface LLMPriceResult {
  siteName: string;
  siteUrl: string;
  price: number | null;
  priceText: string | null;
  productUrl: string | null;
  confidence: "high" | "medium" | "low";
  notes?: string;
}

interface LLMComparisonResponse {
  productName: string;
  searchTerm: string;
  results: LLMPriceResult[];
  summary?: string;
}

/**
 * Use LLM to compare prices across multiple sites for a product
 */
async function comparePricesWithLLM(
  product: Product,
  sites: Site[]
): Promise<LLMComparisonResponse | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.log(`[LLM Comparison] No OPENAI_API_KEY found`);
    return null;
  }

  const searchTerm = productSearchQuery(product);
  const encodedSearch = encodeURIComponent(searchTerm);

  // Build site information for LLM
  const siteInfo = sites.map((site) => ({
    name: site.name,
    baseUrl: site.baseUrl,
    searchUrl: site.searchUrlTemplate
      ? site.searchUrlTemplate
          .replace("{searchTerm}", encodedSearch)
          .replace("{item}", encodedSearch)
      : site.baseUrl,
  }));

  const fallbacks = getSearchTermFallbacks(searchTerm);
  const fallbackHint =
    fallbacks.length > 1
      ? `\n- If not found, try these search variations: ${fallbacks.slice(1, 5).map((f) => `"${f}"`).join(", ")}`
      : "";

  const prompt = `You are a price comparison assistant. Your task is to compare prices for a product across multiple Israeli e-commerce websites.

PRODUCT TO COMPARE:
- Product Name: ${product.name}
- Search Term: "${searchTerm}"
- Category: ${product.category}${fallbackHint}

WEBSITES TO COMPARE:
${siteInfo.map((s, i) => `${i + 1}. ${s.name}
   Base URL: ${s.baseUrl}
   Search URL: ${s.searchUrl || "(use base URL and site search)"}`).join("\n\n")}

COMPARISON INSTRUCTIONS:
1. Visit each website: use the Search URL if provided, otherwise go to Base URL and search for "${searchTerm}" in the site's search box
2. Find products matching "${product.name}" - be flexible with model numbers:
   - "FP-10" matches "FP 10", "FP10", "Roland FP-10", etc.
   - "P-225" matches "P 225", "P225", "Yamaha P-225", etc.
   - Match by brand + model number even if formatting differs
3. Extract the CURRENT PRICE in ILS (Israeli Shekel):
   - Look for ₪ symbol, "ILS", "שקל", "ש\"ח"
   - Check for sale prices, discounts, or special offers
   - Use the final price after any discounts
4. **REQUIRED - Product URL for each site**: For EVERY site you check, you MUST provide the productUrl - the direct link to the product page (not the search page or homepage). Click on the product to get its dedicated product page URL. Format: https://site.com/product/name or https://site.com/products/id. If product not found, set productUrl to null. This is mandatory for each result.
5. Return ONLY valid JSON in this exact format:
{
  "productName": "${product.name}",
  "searchTerm": "${searchTerm}",
  "results": [
    {
      "siteName": "Site Name",
      "siteUrl": "https://site.com",
      "price": 1234.56,  // number or null if not found
      "priceText": "₪1,234.56",  // original price text or null
      "productUrl": "https://site.com/product/123",  // REQUIRED: direct product page URL for this site, or null if not found
      "confidence": "high",  // "high", "medium", or "low"
      "notes": "Optional notes about availability or special conditions"
    }
  ],
  "summary": "Brief comparison summary (optional)"
}

COMPARISON RULES:
- Visit each website systematically and search for the product
- Compare prices across ALL sites for the same product
- If product not found on a site, set price to null and confidence to "low"
- Price must be a numeric value (remove currency symbols, commas, spaces)
- confidence levels:
  * "high": Exact product match found with clear price
  * "medium": Similar product found or partial match
  * "low": Product not found, uncertain match, or estimated price
- Include notes about availability, special offers, or shipping conditions if relevant
- Return ONLY the JSON object, no other text or markdown
- Ensure all sites are checked - return results for ALL ${siteInfo.length} sites listed above, each with productUrl when product is found
- If you cannot directly access a website, indicate this in notes and mark confidence as "low"

IMPORTANT: This is a price comparison task. Your goal is to help the user find the best price across all these Israeli e-commerce sites. Be thorough and accurate.`;

  const useBetterModel = sites.length > 3;
  const model = useBetterModel
    ? (process.env.OPENAI_MODEL_BETTER || "gpt-4o")
    : (process.env.OPENAI_MODEL || "gpt-4o-mini");

  // Log the request
  await logLLMRequest(product.name, searchTerm, siteInfo, prompt, model).catch((err) =>
    console.error("[LLM Logger] Failed to log request:", err)
  );

  // Emit prompt for UI visibility
  progressEmit("llm_prompt", JSON.stringify({ product: product.name, prompt }));

  try {
    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model,
        messages: [
          {
            role: "system",
            content:
              "You are an expert price comparison assistant specializing in Israeli e-commerce sites. Your task is to compare prices for products across multiple websites, visit each site, search for products, extract prices in ILS, and return structured JSON results. For each site, you MUST include the productUrl - the direct link to the product page. Always return valid JSON only - no markdown, no explanations, just the JSON object.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        temperature: 0.1,
        max_tokens: 2000,
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        timeout: 60000, // 60s timeout for web browsing
      }
    );

    const content = response.data.choices[0]?.message?.content?.trim();
    if (!content) {
      return null;
    }

    // Extract JSON from response (handle markdown code blocks)
    let jsonStr = content;
    const jsonMatch = content.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1];
    }

    const result: LLMComparisonResponse = JSON.parse(jsonStr);

    await logScrape(
      appendLlmTokenUsage(`LLM comparison model response: "${product.name}"`, response.data?.usage),
    );

    // Validate and parse prices
    for (const res of result.results) {
      if (res.priceText && !res.price) {
        res.price = parsePrice(res.priceText);
      }
      if (res.price && typeof res.price === "string") {
        res.price = parsePrice(res.price) || null;
      }
    }

    // Log the response
    await logLLMResponse(product.name, response, result).catch((err) =>
      console.error("[LLM Logger] Failed to log response:", err)
    );

    // Emit response for UI visibility
    progressEmit("llm_response", JSON.stringify({ product: product.name, rawResponse: content, parsedResult: result }));

    return result;
  } catch (err: any) {
    // Log the error
    await logLLMError(product.name, err, {
      product: { name: product.name, searchTerm },
      sites: siteInfo,
      model,
    }).catch((logErr) => console.error("[LLM Logger] Failed to log error:", logErr));

    console.error(`[LLM Comparison] Error:`, err.message);
    return null;
  }
}

/**
 * Check if a date is today (same day)
 */
function isToday(dateStr: string): boolean {
  const date = new Date(dateStr);
  const today = new Date();
  return (
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate()
  );
}

/**
 * Compare prices across sites using LLM
 */
export async function runLLMComparison(
  options: LLMComparisonRequest
): Promise<ScrapeResult[]> {
  const sites = await readJson<Site[]>("sites.json");
  const products = await readJson<Product[]>("products.json");
  const existingResults = await readJson<ScrapeResult[]>("results.json").catch(() => []);

  // Filter sites
  let targetSites = sites.filter((s) => s.enabled);
  if (options.siteIds?.length) {
    targetSites = targetSites.filter((s) => options.siteIds!.includes(s.id));
  }
  targetSites = ensureAnchorSiteInList(targetSites, sites);

  // Filter products
  let targetProducts = products;
  if (options.productIds?.length) {
    targetProducts = products.filter((p) => options.productIds!.includes(p.id));
  } else if (options.category) {
    targetProducts = products.filter((p) => p.category === options.category);
  }

  if (targetSites.length === 0) {
    throw new Error("לא נמצאו אתרים פעילים");
  }
  if (targetProducts.length === 0) {
    throw new Error("לא נמצאו מוצרים");
  }

  const allResults: ScrapeResult[] = [];
  const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD

  progressEmit("status", `השוואה התחילה: ${targetProducts.length} מוצר(ים), ${targetSites.length} אתר(ים)`);

  // Log comparison start
  await logLLMComparisonStart(
    targetProducts.map((p) => ({ id: p.id, name: p.name })),
    targetSites.map((s) => ({ id: s.id, name: s.name }))
  ).catch((err) => console.error("[LLM Logger] Failed to log comparison start:", err));

  for (const product of targetProducts) {
    try {
      // Find existing results from today for this product
      const existingToday = existingResults.filter(
        (r) => r.productId === product.id && isToday(r.scrapedAt)
      );

      // Map of siteId -> existing result
      const existingBySite = new Map<string, ScrapeResult>();
      for (const existing of existingToday) {
        existingBySite.set(existing.siteId, existing);
      }

      // Sites to check with LLM (exclude sites with today's data)
      const sitesToCheck = targetSites.filter((site) => !existingBySite.has(site.id));

      if (sitesToCheck.length === 0) {
        progressEmit("status", `כל האתרים עבור ${product.name} כבר מכילים נתונים מהיום, מדלג על קריאת LLM`);
        existingToday.forEach((r) => allResults.push(r));
        continue;
      }

      progressEmit("status", `משווה ${product.name}: ${sitesToCheck.length} אתר(ים) דורש(ים) בדיקה, ${existingToday.length} כבר מכיל(ים) נתונים מהיום`);
      console.log(`[LLM Comparison] --- ${product.name} ---`);
      console.log(`[LLM Comparison] Skipping ${existingToday.length} site(s) with today's data, checking ${sitesToCheck.length} site(s)`);

      // Call LLM only for sites without today's data
      const comparison = await comparePricesWithLLM(product, sitesToCheck);
      if (!comparison) {
        progressEmit("error", `השוואה נכשלה עבור ${product.name}`);
        existingToday.forEach((r) => allResults.push(r));
        continue;
      }

      console.log(`[LLM Comparison] Found ${comparison.results.length} new results for ${product.name}`);

      // Convert LLM results to ScrapeResult format
      const newResults: ScrapeResult[] = [];
      for (const llmResult of comparison.results) {
        const site = sitesToCheck.find((s) => s.name === llmResult.siteName || s.baseUrl === llmResult.siteUrl);
        if (!site) {
          console.warn(`[LLM Comparison] Site not found: ${llmResult.siteName}`);
          continue;
        }

        if (llmResult.price !== null) {
          const result: ScrapeResult = {
            id: uuidv4(),
            productId: product.id,
            siteId: site.id,
            price: llmResult.price,
            currency: "ILS",
            productUrl: llmResult.productUrl || site.baseUrl,
            scrapedAt: new Date().toISOString(),
          };
          newResults.push(result);
          allResults.push(result);

          console.log(`[LLM Comparison] ${site.name}: ${llmResult.priceText} (${llmResult.price} ILS) - confidence: ${llmResult.confidence}`);
        } else {
          console.log(`[LLM Comparison] ${site.name}: No price found`);
        }
      }

      // Add existing today's results
      existingToday.forEach((r) => allResults.push(r));

      const totalFound = newResults.length + existingToday.length;
      progressEmit("status", `סיים ${product.name}: ${newResults.length} מחיר(ים) חדש(ים), ${existingToday.length} מהיום, ${totalFound} סה"כ`);
    } catch (err) {
      progressEmit("error", `השוואה נכשלה עבור ${product.name}`);
      console.error(`[LLM Comparison] Failed for ${product.name}:`, err);
    }
  }

  progressEmit("done", `השוואה הושלמה: נמצאו ${allResults.length} מחיר(ים)`);

  // Log comparison end
  await logLLMComparisonEnd(
    allResults.map((r) => ({ productId: r.productId, siteId: r.siteId, price: r.price }))
  ).catch((err) => console.error("[LLM Logger] Failed to log comparison end:", err));

  return allResults;
}
