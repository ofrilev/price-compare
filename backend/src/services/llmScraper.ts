import axios from "axios";
import { chromium } from "playwright";
import { parsePrice } from "./priceParser.js";
import { matchesProduct } from "./searchTermNormalizer.js";
import { logLLMRequest, logLLMResponse, logLLMError } from "./llmLogger.js";
import type { Site } from "../types.js";

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

interface LLMResponse {
  price: number | null;
  priceText: string | null;
  productName: string | null;
  productUrl: string | null;
  confidence: "high" | "medium" | "low";
}

/**
 * Extract visible text content from page, removing scripts, styles, and excessive whitespace
 */
async function extractPageText(page: any): Promise<string> {
  const text = await page.evaluate(() => {
    // Remove script and style elements
    const scripts = document.querySelectorAll("script, style, noscript");
    scripts.forEach((el) => el.remove());

    // Get text content
    const body = document.body;
    if (!body) return "";

    // Extract text from main content areas (prioritize product listings)
    const mainContent =
      body.querySelector(
        "main, .main-content, .products, .search-results, .product-list",
      ) || body;
    const textContent =
      (mainContent as HTMLElement).innerText ||
      (mainContent as HTMLElement).textContent ||
      "";

    // Clean up: remove excessive whitespace, normalize newlines
    return textContent
      .replace(/\s+/g, " ")
      .replace(/\n\s*\n/g, "\n")
      .trim();
  });

  return text.substring(0, 15000); // Limit to ~15k chars to avoid token limits
}

/**
 * Use LLM to extract product price from page content
 */
async function scrapeWithLLM(
  url: string,
  site: Site,
  searchTerm: string,
  pageText: string,
): Promise<LLMResponse> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.log(`[LLM Scrape] No OPENAI_API_KEY found, skipping LLM fallback`);
    return {
      price: null,
      priceText: null,
      productName: null,
      productUrl: null,
      confidence: "low",
    };
  }

  const productName = site.selectors.productName
    ? `Product name selector: ${site.selectors.productName}`
    : "N/A";

  const prompt = `You are a web scraping assistant. Extract product information from the following page content.

Search term: "${searchTerm}"
Site: ${site.name}
URL: ${url}
Product name selector hint: ${productName}

Page content:
${pageText}

Instructions:
1. Find products matching the search term "${searchTerm}" (be flexible: "FP-10" matches "FP 10", "FP10", etc.)
2. Extract the price in ILS (Israeli Shekel). Look for numbers with ₪ symbol or "ILS" or "שקל"
3. Return ONLY valid JSON in this exact format:
{
  "price": 1234.56,  // number or null if not found
  "priceText": "₪1,234.56",  // original price text or null
  "productName": "Roland FP-10",  // matched product name or null
  "productUrl": "https://...",  // product page URL or null
  "confidence": "high"  // "high", "medium", or "low"
}

Rules:
- If multiple products match, return the FIRST one found
- Price must be a number (remove currency symbols, commas)
- If no matching product found, set price to null
- confidence: "high" if exact match, "medium" if partial match, "low" if uncertain
- Return ONLY the JSON object, no other text`;

  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

  // Log the request (fallback scraper)
  await logLLMRequest(
    searchTerm,
    searchTerm,
    [{ name: site.name, baseUrl: site.baseUrl, searchUrl: url }],
    prompt,
    model,
  ).catch((err) =>
    console.error("[LLM Logger] Failed to log fallback request:", err),
  );

  try {
    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model,
        messages: [
          {
            role: "system",
            content:
              "You are a web scraping assistant. Always return valid JSON only.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        temperature: 0.1, // Low temperature for consistent extraction
        max_tokens: 200,
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        timeout: 30000,
      },
    );

    const content = response.data.choices[0]?.message?.content?.trim();
    if (!content) {
      return {
        price: null,
        priceText: null,
        productName: null,
        productUrl: null,
        confidence: "low",
      };
    }

    // Extract JSON from response (handle cases where LLM adds markdown code blocks)
    let jsonStr = content;
    const jsonMatch = content.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1];
    }

    const result: LLMResponse = JSON.parse(jsonStr);

    // Validate and parse price
    if (result.priceText && !result.price) {
      result.price = parsePrice(result.priceText);
    }
    if (result.price && typeof result.price === "string") {
      result.price = parsePrice(result.price) || null;
    }

    // Validate product match
    if (result.productName && !matchesProduct(result.productName, searchTerm)) {
      console.log(
        `[LLM Scrape] Product name "${result.productName}" doesn't match search "${searchTerm}"`,
      );
      if (result.confidence === "high") {
        result.confidence = "medium";
      }
    }

    // Log the response (fallback scraper)
    await logLLMResponse(searchTerm, response, result).catch((err) =>
      console.error("[LLM Logger] Failed to log fallback response:", err),
    );

    return result;
  } catch (err: any) {
    // Log the error (fallback scraper)
    await logLLMError(searchTerm, err, {
      url,
      site: site.name,
      searchTerm,
      pageTextLength: pageText.length,
      model,
    }).catch((logErr) =>
      console.error("[LLM Logger] Failed to log fallback error:", logErr),
    );

    console.error(`[LLM Scrape] Error:`, err.message);
    return {
      price: null,
      priceText: null,
      productName: null,
      productUrl: null,
      confidence: "low",
    };
  }
}

/**
 * Scrape using LLM as fallback when regular selectors fail
 */
export async function scrapeWithLLMFallback(
  url: string,
  site: Site,
  searchTerm: string,
): Promise<{ price: number | null; productUrl: string }> {
  const cfg = site.scraperConfig;
  const userAgent = cfg?.userAgent ?? DEFAULT_USER_AGENT;
  const waitStrategy = cfg?.waitStrategy ?? "domcontentloaded";
  const waitUntil =
    waitStrategy === "networkidle" ? "networkidle" : "domcontentloaded";

  const browser = await chromium.launch({ headless: false });
  try {
    const page = await browser.newPage();
    await page.setExtraHTTPHeaders({ "User-Agent": userAgent });

    console.log(`[LLM Scrape] Navigating to:`, url);
    await page.goto(url, { waitUntil, timeout: 30000 });

    // Dismiss cookie popups
    if (cfg?.preSteps?.length) {
      for (const step of cfg.preSteps) {
        if (step.type === "click" && step.selector) {
          await page
            .locator(step.selector)
            .first()
            .click({ timeout: 5000 })
            .catch(() => null);
        }
      }
    }

    // If search bar strategy, perform search
    if (cfg?.searchStrategy === "searchBar" && cfg?.searchInputSelector) {
      console.log(`[LLM Scrape] Performing search: "${searchTerm}"`);
      const searchInput = page.locator(cfg.searchInputSelector).first();
      await searchInput
        .waitFor({ state: "visible", timeout: 10000 })
        .catch(() => null);
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
    }

    // Wait for content
    if (cfg?.waitExtraMs) {
      await new Promise((r) => setTimeout(r, cfg.waitExtraMs));
    }

    // Extract page text
    console.log(`[LLM Scrape] Extracting page content...`);
    const pageText = await extractPageText(page);

    if (!pageText || pageText.length < 50) {
      console.log(`[LLM Scrape] Insufficient page content`);
      return { price: null, productUrl: url };
    }

    // Use LLM to extract product info
    console.log(`[LLM Scrape] Using LLM to extract product info...`);
    const result = await scrapeWithLLM(url, site, searchTerm, pageText);

    if (result.price !== null) {
      console.log(
        `[LLM Scrape] Found price: ${result.priceText} (${result.price}) - confidence: ${result.confidence}`,
      );
    } else {
      console.log(`[LLM Scrape] No price found`);
    }

    return {
      price: result.price,
      productUrl: result.productUrl || url,
    };
  } finally {
    await browser.close();
  }
}
