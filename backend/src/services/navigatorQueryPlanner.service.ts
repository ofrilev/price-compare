import axios from "axios";
import { getSearchTermFallbacks } from "./normalization.service.js";
import { logScrape, logScrapeError } from "./scrapeLogger.js";
import type { Product } from "../types.js";

export interface NavigatorQueryPlan {
  primary: string;
  secondary: string;
  tertiary: string;
  categoryPathHint?: string | null;
}

function fallbackPlan(product: Product): NavigatorQueryPlan {
  const name = (product.name || "").trim();
  const term = (product.searchTerm || name).trim();
  const fallbacks = getSearchTermFallbacks(term);
  const primary = term || name;
  const secondary = fallbacks[1] ?? primary;
  const tertiary =
    fallbacks[2] ??
    (`${name.split(/\s+/)[0] ?? ""} ${product.category}`.trim() || secondary);
  return {
    primary,
    secondary,
    tertiary: tertiary || secondary,
    categoryPathHint: null,
  };
}

/**
 * LLM-generated search queries (primary / secondary / tertiary) before browser opens.
 * Falls back to heuristic plan when OPENAI_API_KEY is missing or the call fails.
 */
export async function planNavigatorQueries(
  product: Product
): Promise<NavigatorQueryPlan> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    await logScrape(
      `NavigatorQueryPlanner: no OPENAI_API_KEY, using fallback queries for "${product.name}"`
    );
    return fallbackPlan(product);
  }

  const prompt = `Product name: "${product.name}"
Search term: "${product.searchTerm || product.name}"
Category: "${product.category}"

Return JSON only:
{
  "primary": "exact or best full product name for site search",
  "secondary": "model-only or shorter variant if primary is long",
  "tertiary": "brand + product type for category-style search",
  "categoryPathHint": null or short Hebrew/English hint for category navigation
}

Rules:
- primary should match how stores list the product (e.g. Roland FP-30X).
- secondary can drop brand if redundant (e.g. FP30X).
- tertiary e.g. "Roland digital piano" / "רולנד פסנתר דיגיטלי".`;

  try {
    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: process.env.OPENAI_MODEL || "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "You plan e-commerce search queries. Return only valid JSON, no markdown.",
          },
          { role: "user", content: prompt },
        ],
        temperature: 0.2,
        max_tokens: 300,
        response_format: { type: "json_object" },
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        timeout: 15000,
      }
    );

    const content = response.data.choices[0]?.message?.content?.trim();
    if (!content) return fallbackPlan(product);

    const parsed = JSON.parse(content) as Partial<NavigatorQueryPlan>;
    const fb = fallbackPlan(product);
    return {
      primary: typeof parsed.primary === "string" && parsed.primary.trim() ? parsed.primary.trim() : fb.primary,
      secondary:
        typeof parsed.secondary === "string" && parsed.secondary.trim()
          ? parsed.secondary.trim()
          : fb.secondary,
      tertiary:
        typeof parsed.tertiary === "string" && parsed.tertiary.trim()
          ? parsed.tertiary.trim()
          : fb.tertiary,
      categoryPathHint:
        typeof parsed.categoryPathHint === "string" && parsed.categoryPathHint.trim()
          ? parsed.categoryPathHint.trim()
          : null,
    };
  } catch (err) {
    await logScrapeError("NavigatorQueryPlanner error", err);
    return fallbackPlan(product);
  }
}
