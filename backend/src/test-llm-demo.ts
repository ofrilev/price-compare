import { readJson } from "./services/store.js";
import type { Product, Site } from "./types.js";

/**
 * Demo script to show what the LLM comparison function does
 * (without actually calling the API)
 */
async function demonstrateLLMComparison() {
  console.log("🔍 Demonstrating LLM Comparison Function Flow...\n");

  try {
    const products = await readJson<Product[]>("products.json");
    const sites = await readJson<Site[]>("sites.json");

    // Find Roland FP-10
    const product = products.find((p) => p.id === "2969701f-6b4b-4532-8602-871c4272f420");
    if (!product) {
      console.error("Product not found");
      return;
    }

    const enabledSites = sites.filter((s) => s.enabled);

    console.log("📦 Product:");
    console.log(`   Name: ${product.name}`);
    console.log(`   Search Term: ${product.searchTerm}`);
    console.log(`   Category: ${product.category}\n`);

    console.log("🌐 Sites to Compare:");
    enabledSites.forEach((site, i) => {
      const searchUrl = site.searchUrlTemplate.replace(
        "{searchTerm}",
        encodeURIComponent(product.searchTerm)
      );
      console.log(`   ${i + 1}. ${site.name}`);
      console.log(`      Base URL: ${site.baseUrl}`);
      console.log(`      Search URL: ${searchUrl}\n`);
    });

    console.log("📝 What the LLM Prompt Would Include:");
    console.log("   - Product name and search term");
    console.log("   - All site URLs and search URLs");
    console.log("   - Instructions to compare prices");
    console.log("   - JSON format requirements\n");

    console.log("📊 Expected Response Format:");
    console.log(`   {
      "productName": "${product.name}",
      "searchTerm": "${product.searchTerm}",
      "results": [
        {
          "siteName": "חלילית",
          "siteUrl": "https://www.halilit.com/",
          "price": 2990,
          "priceText": "₪2,990",
          "productUrl": "https://www.halilit.com/product/...",
          "confidence": "high"
        },
        ...
      ]
    }\n`);

    console.log("✅ Function Structure:");
    console.log("   1. comparePricesWithLLM() - Calls OpenAI API with prompt");
    console.log("   2. Parses JSON response");
    console.log("   3. Validates and extracts prices");
    console.log("   4. Returns structured results");
    console.log("   5. All interactions logged to logs/llm-YYYY-MM-DD.log\n");

    console.log("🔑 To Test with Real API:");
    console.log("   1. Create backend/.env file");
    console.log("   2. Add: OPENAI_API_KEY=your-key-here");
    console.log("   3. Run: npx tsx src/test-llm.ts\n");

    console.log("📋 Current Log Status:");
    console.log("   ✅ Comparison start/end logged");
    console.log("   ⚠️  No API key - LLM request skipped");
    console.log("   📁 Check logs/llm-2026-03-15.log for details");

  } catch (error: any) {
    console.error("❌ Error:", error.message);
  }
}

demonstrateLLMComparison();
