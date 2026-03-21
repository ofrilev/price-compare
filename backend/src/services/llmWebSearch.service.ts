import axios from "axios";
import { v4 as uuidv4 } from "uuid";
import { readJson } from "./store.js";
import { emit as progressEmit } from "./scrapeProgress.js";
import { parsePrice } from "./priceParser.js";
import { ensureAnchorSiteInList } from "../config/anchorSite.js";
import { productSearchQuery } from "../utils/productSearchQuery.js";
import { getSearchTermFallbacks } from "./normalization.service.js";
import type { Site, Product, ScrapeResult } from "../types.js";

/** OpenAI models with built-in web search - mini has broader availability */
const WEB_SEARCH_MODEL =
  process.env.OPENAI_WEB_SEARCH_MODEL || "gpt-4o-mini-search-preview";

interface LLMPriceResult {
  siteName: string;
  siteId: string;
  price: number | null;
  productUrl: string | null;
}

function extractJsonFromContent(content: string): Record<string, unknown> | null {
  const trimmed = content.trim();
  const jsonMatch = trimmed.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[1]) as Record<string, unknown>;
    } catch {}
  }
  if (trimmed.startsWith("{")) {
    try {
      return JSON.parse(trimmed) as Record<string, unknown>;
    } catch {}
  }
  const idx = trimmed.indexOf('{"results"');
  if (idx >= 0) {
    let depth = 0;
    for (let i = idx; i < trimmed.length; i++) {
      if (trimmed[i] === "{") depth++;
      else if (trimmed[i] === "}") {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(trimmed.slice(idx, i + 1)) as Record<string, unknown>;
          } catch {}
          break;
        }
      }
    }
  }
  return null;
}

export interface LLMWebSearchOptions {
  productIds?: string[];
  category?: string;
  siteIds?: string[];
}

/**
 * Compare prices using OpenAI's built-in web search models (gpt-4o-search-preview
 * or gpt-4o-mini-search-preview). These models search the web internally - no
 * Tavily or other external search API needed. Only OPENAI_API_KEY required.
 */
export async function runLLMWebSearch(
  options: LLMWebSearchOptions
): Promise<ScrapeResult[]> {
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) {
    throw new Error("OPENAI_API_KEY required for LLM web search mode");
  }

  const sites = await readJson<Site[]>("sites.json");
  const products = await readJson<Product[]>("products.json");

  let targetSites = sites.filter((s) => s.enabled);
  if (options.siteIds?.length) {
    targetSites = targetSites.filter((s) => options.siteIds!.includes(s.id));
  }
  targetSites = ensureAnchorSiteInList(targetSites, sites);

  let targetProducts: Product[] = products;
  if (options.productIds?.length) {
    targetProducts = products.filter((p) => options.productIds!.includes(p.id));
  } else if (options.category) {
    targetProducts = products.filter((p) => p.category === options.category);
  }

  if (targetSites.length === 0) throw new Error("לא נמצאו אתרים פעילים");
  if (targetProducts.length === 0) throw new Error("לא נמצאו מוצרים");

  const siteMap = new Map(targetSites.map((s) => [s.id, s]));
  const allResults: ScrapeResult[] = [];

  progressEmit("status", `השוואה (LLM + חיפוש אינטרנט מובנה): ${targetProducts.length} מוצר(ים), ${targetSites.length} אתר(ים)`);

  for (const product of targetProducts) {
    try {
      const searchTerm = productSearchQuery(product);
      const fallbacks = getSearchTermFallbacks(searchTerm);
      const fallbackHint =
        fallbacks.length > 1
          ? `\nIf not found with "${searchTerm}", try these variations: ${fallbacks.slice(1, 5).map((f) => `"${f}"`).join(", ")}`
          : "";

      progressEmit("status", `מחפש מחירים עבור ${product.name}...`);

      const prompt = `You are a price comparison assistant for Israeli e-commerce. Search the web to find the current price in ILS for this product on each of the listed sites.

Product: ${product.name}
Search term: ${searchTerm}
Category: ${product.category}${fallbackHint}

Sites to check (use the exact siteId in your response):
${targetSites.map((s) => `- ${s.name}: siteId="${s.id}", ${s.baseUrl}`).join("\n")}

Search for the product on each site (e.g. "${searchTerm} site-name.co.il מחיר"). Return ONLY valid JSON in this exact format:
{
  "productName": "${product.name}",
  "results": [
    {
      "siteName": "Site Name",
      "siteId": "exact-site-uuid-from-above",
      "price": 1234,
      "productUrl": "https://direct-product-page-url"
    }
  ]
}

Rules:
- price: number in ILS, or null if not found
- productUrl: direct product page URL, or null if not found
- Include ALL sites from the list above
- Use exact siteId values from the input`;

      let response;
      try {
        response = await axios.post(
          "https://api.openai.com/v1/chat/completions",
          {
            model: WEB_SEARCH_MODEL,
            messages: [
              {
                role: "system",
                content:
                  "You are a price comparison assistant. Search the web for product prices on Israeli e-commerce sites. Return only valid JSON, no markdown.",
              },
              { role: "user", content: prompt },
            ],
            max_tokens: 2000,
          },
        {
          headers: {
            Authorization: `Bearer ${openaiKey}`,
            "Content-Type": "application/json",
          },
          timeout: 90000,
        }
        );
      } catch (apiErr: unknown) {
        const axiosErr = apiErr as { response?: { status?: number; data?: { error?: { message?: string } } } };
        const status = axiosErr.response?.status;
        const apiMsg = axiosErr.response?.data?.error?.message || "";
        const msg = apiErr instanceof Error ? apiErr.message : String(apiErr);
        const isModelError = status === 400 || /model|not found|invalid|incompatible/i.test(msg + apiMsg);
        if (isModelError && WEB_SEARCH_MODEL !== "gpt-4o-mini-search-preview") {
          progressEmit("status", `ניסיון עם מודל חלופי (${product.name})...`);
          response = await axios.post(
            "https://api.openai.com/v1/chat/completions",
            {
              model: "gpt-4o-mini-search-preview",
              messages: [
                { role: "system", content: "You are a price comparison assistant. Search the web for product prices on Israeli e-commerce sites. Return only valid JSON, no markdown." },
                { role: "user", content: prompt },
              ],
              max_tokens: 2000,
            },
            {
              headers: { Authorization: `Bearer ${openaiKey}`, "Content-Type": "application/json" },
              timeout: 90000,
            }
          );
        } else {
          throw apiErr;
        }
      }

      const content = response.data?.choices?.[0]?.message?.content?.trim();
      if (!content) {
        progressEmit("error", `תשובה ריקה מ-LLM עבור ${product.name}`);
        continue;
      }

      const parsed = extractJsonFromContent(content);
      if (parsed && Array.isArray(parsed.results)) {
        const results = (parsed.results as LLMPriceResult[]).filter(
          (r) => r.price !== null && (r.price ?? parsePrice(String(r.price))) > 0 && r.siteId
        );
        for (const r of results) {
          const price = r.price ?? parsePrice(String(r.price));
          if (price !== null && price > 0 && r.siteId) {
            allResults.push({
              id: uuidv4(),
              productId: product.id,
              siteId: r.siteId,
              price: typeof price === "number" ? price : parsePrice(String(price)) ?? 0,
              currency: "ILS",
              productUrl: r.productUrl || siteMap.get(r.siteId)?.baseUrl || "",
              scrapedAt: new Date().toISOString(),
            });
          }
        }
        progressEmit("status", `סיים ${product.name}: ${results.length} תוצאות`);
      } else {
        progressEmit("error", `לא הצלחתי לפרסר JSON עבור ${product.name}`);
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      progressEmit("error", `השוואה נכשלה עבור ${product.name}: ${errMsg}`);
      console.error("[LLM Web Search] Error:", err);
    }
  }

  progressEmit("done", `השוואה הושלמה: נמצאו ${allResults.length} מחיר(ים)`);
  return allResults;
}
