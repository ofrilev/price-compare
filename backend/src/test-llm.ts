import "dotenv/config";
import { runLLMComparison } from "./services/llmComparison.js";

/**
 * Test script to call LLM comparison for a product
 */
async function testLLMComparison() {
  console.log("🧪 Testing LLM Comparison...\n");

  try {
    // Test with Roland FP-10 product
    const results = await runLLMComparison({
      productIds: ["2969701f-6b4b-4532-8602-871c4272f420"], // Roland FP-10
    });

    console.log("\n✅ LLM Comparison completed!");
    console.log(`📊 Found ${results.length} price result(s):\n`);

    if (results.length === 0) {
      console.log("⚠️  No prices found. Check logs/llm-*.log for details.");
    } else {
      results.forEach((result, index) => {
        console.log(`${index + 1}. Product ID: ${result.productId}`);
        console.log(`   Site ID: ${result.siteId}`);
        console.log(`   Price: ${result.price} ${result.currency}`);
        console.log(`   URL: ${result.productUrl}`);
        console.log(`   Scraped: ${result.scrapedAt}`);
        console.log("");
      });
    }

    console.log("📝 Check logs/llm-*.log for full LLM interaction details");
  } catch (error: any) {
    console.error("❌ Test failed:", error.message);
    console.error(error);
    process.exit(1);
  }
}

testLLMComparison();
