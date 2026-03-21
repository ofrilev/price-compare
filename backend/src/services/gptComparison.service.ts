import axios from "axios";
import { logScrape, logScrapeError } from "./scrapeLogger.js";

export interface SiteResult {
  siteName: string;
  siteId: string;
  price: number;
  productUrl: string;
}

export interface GPTComparisonInput {
  productName: string;
  searchTerm: string;
  siteResults: SiteResult[];
}

export interface GPTComparisonOutput {
  productName: string;
  results: SiteResult[];
  cheapest: string; // site name
}

/**
 * Call GPT once per product with structured scraped data. Returns comparison JSON.
 */
export async function compareWithGPT(input: GPTComparisonInput): Promise<GPTComparisonOutput | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    await logScrape("GPT: no OPENAI_API_KEY, skipping");
    return null;
  }

  await logScrape(`GPT: comparing "${input.productName}" across ${input.siteResults.length} site(s)`);

  const prompt = `Here are prices for "${input.productName}" (search term: "${input.searchTerm}") from ${input.siteResults.length} sites. Return JSON in this exact format:
{
  "productName": "${input.productName}",
  "results": [
    { "siteName": "exact site name from input", "price": 1234, "productUrl": "https://..." }
  ],
  "cheapest": "Site Name"
}

Rules:
- Include only sites with valid price > 0
- Sort results by price ascending
- Set "cheapest" to the site name with lowest price
- Return ONLY valid JSON, no markdown`;

  const siteData = input.siteResults
    .filter((r) => r.price > 0)
    .map((r) => `${r.siteName}: ${r.price} ILS - ${r.productUrl}`)
    .join("\n");

  const fullPrompt = `${prompt}\n\nSite data:\n${siteData}`;

  try {
    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: process.env.OPENAI_MODEL || "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "You are a price comparison assistant. Return only valid JSON, no markdown.",
          },
          { role: "user", content: fullPrompt },
        ],
        temperature: 0.1,
        max_tokens: 1000,
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
    if (!content) return null;

    let jsonStr = content;
    const jsonMatch = content.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
    if (jsonMatch) jsonStr = jsonMatch[1];

    const result = JSON.parse(jsonStr) as GPTComparisonOutput;
    await logScrape(`GPT: done for "${input.productName}", cheapest=${result.cheapest}`);
    return result;
  } catch (err) {
    await logScrapeError("GPT error", err);
    return null;
  }
}
