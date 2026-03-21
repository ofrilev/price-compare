import axios from "axios";
import { logScrape, logScrapeError } from "./scrapeLogger.js";
import type { NormalizedProduct } from "./normalization.service.js";

export interface ProductMatchValidatorInput {
  productName: string;
  searchTerm: string;
  productsBySite: Array<{
    siteId: string;
    siteName: string;
    products: NormalizedProduct[];
  }>;
}

export interface ProductMatchValidatorOutput {
  /** Map of siteId -> the selected product (same product type as search, not accessories) */
  selections: Map<string, NormalizedProduct>;
}

/**
 * Call LLM to validate that products from different sites are the same product type.
 * Filters out accessories (e.g. stands, bags) when searching for the main product (e.g. piano).
 */
export async function validateProductMatch(
  input: ProductMatchValidatorInput
): Promise<ProductMatchValidatorOutput | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    await logScrape("ProductMatchValidator: no OPENAI_API_KEY, skipping");
    return null;
  }

  const { productName, searchTerm, productsBySite } = input;
  const sitesWithProducts = productsBySite.filter((p) => p.products.length > 0);
  if (sitesWithProducts.length === 0) return null;

  const lines = sitesWithProducts.map(({ siteName, products }) => {
    const list = products
      .map((p, i) => `${i + 1}) "${p.name}" @ ${p.price} ILS`)
      .join(", ");
    return `${siteName}: [${list}]`;
  });

  await logScrape(
    `ProductMatchValidator: validating "${productName}" across ${sitesWithProducts.length} site(s) with ${sitesWithProducts.reduce((a, s) => a + s.products.length, 0)} product(s)`
  );

  const prompt = `We are searching for "${productName}" (search term: "${searchTerm}").
The main product we want is the core item (e.g. a digital piano), NOT accessories like stands, bags, cables, or add-ons.

Model numbers may be written with or without hyphens — treat them as the SAME product (e.g. DGX-670 = DGX670 = DGX 670).

Price note: The prices shown are the final/current price (the last price on each product page). Product pages often show two prices—one with strikethrough (original) and one as the new/sale price. We always use the last price (the current sale price) for comparison.

Products found per site:
${lines.join("\n")}

Task: For each site, pick ONE product that is the actual "${productName}" (the main product, not an accessory).
- If a site has the piano and a stand for the piano, pick the PIANO.
- If a site has only accessories (e.g. only a stand), return null for that site.
- Return the 1-based index of the selected product per site.

Return JSON in this exact format:
{
  "selections": {
    "SiteName": 1,
    "AnotherSite": 2
  }
}

Rules:
- "selections" keys must match site names exactly from the input
- Value is the 1-based index (1 = first product) of the matching product
- Omit sites where no product matches (or use null)
- Return ONLY valid JSON, no markdown`;

  try {
    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: process.env.OPENAI_MODEL || "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "You are a product matching assistant. Return only valid JSON, no markdown. Match the main product, exclude accessories.",
          },
          { role: "user", content: prompt },
        ],
        temperature: 0.1,
        max_tokens: 500,
        response_format: { type: "json_object" },
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        timeout: 10000,
      }
    );

    const content = response.data.choices[0]?.message?.content?.trim();
    if (!content) return null;

    let jsonStr = content;
    const jsonMatch = content.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
    if (jsonMatch) jsonStr = jsonMatch[1];

    const parsed = JSON.parse(jsonStr) as { selections?: Record<string, number | null> };
    const selectionsObj = parsed.selections;
    if (!selectionsObj || typeof selectionsObj !== "object") return null;

    const result = new Map<string, NormalizedProduct>();
    for (const { siteId, siteName, products } of sitesWithProducts) {
      const raw = selectionsObj[siteName];
      if (raw === null || raw === undefined) {
        const detail =
          raw === null
            ? "LLM returned null for this site"
            : "site key omitted or missing in selections JSON";
        await logScrape(
          `ProductMatchValidator: rejection ${siteName} — ${detail} (no matching main product, only accessories, or name mismatch)`
        );
        continue;
      }
      if (typeof raw !== "number") {
        await logScrape(
          `ProductMatchValidator: rejection ${siteName} — invalid selection type (${typeof raw}), expected 1-based index`
        );
        continue;
      }
      if (raw < 1 || raw > products.length) {
        await logScrape(
          `ProductMatchValidator: rejection ${siteName} — index out of range (got ${raw}, valid 1–${products.length})`
        );
        continue;
      }
      const product = products[raw - 1];
      if (product) {
        result.set(siteId, product);
        await logScrape(
          `ProductMatchValidator: ${siteName} → "${product.name}" @ ${product.price} ILS`
        );
      } else {
        await logScrape(
          `ProductMatchValidator: rejection ${siteName} — empty product at index ${raw}`
        );
      }
    }

    return { selections: result };
  } catch (err) {
    await logScrapeError("ProductMatchValidator error", err);
    return null;
  }
}
