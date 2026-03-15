# LLM Comparison Function Test Results

## Test Execution Summary

**Date:** 2026-03-15  
**Product Tested:** Roland FP-10  
**Sites Compared:** 4 (חלילית, כלי זמר, קילומבו, Next Pro)

## Function Flow

### 1. **Function Called:** `runLLMComparison()`
   - Input: `{ productIds: ["2969701f-6b4b-4532-8602-871c4272f420"] }`
   - Loads products and sites from JSON files
   - Filters enabled sites (4 sites found)

### 2. **Comparison Start Logged**
   ```json
   {
     "type": "COMPARISON_START",
     "products": [{"id": "...", "name": "Roland FP-10"}],
     "sites": [
       {"id": "...", "name": "חלילית"},
       {"id": "...", "name": "כלי זמר"},
       {"id": "...", "name": "קילומבו"},
       {"id": "...", "name": "Next Pro"}
     ]
   }
   ```

### 3. **LLM Request Attempt**
   - Function: `comparePricesWithLLM()`
   - **Status:** ⚠️ Skipped - No OPENAI_API_KEY found
   - Would have logged:
     - Full prompt sent to LLM
     - Product info and search URLs
     - Model used (gpt-4o-mini)

### 4. **Comparison End Logged**
   ```json
   {
     "type": "COMPARISON_END",
     "resultsCount": 0,
     "results": []
   }
   ```

## Expected Function Result Structure

When API key is configured, the function returns:

```typescript
ScrapeResult[] = [
  {
    id: "uuid",
    productId: "2969701f-6b4b-4532-8602-871c4272f420",
    siteId: "547e6ae1-4586-4a36-be4b-408c64ac5af0",
    price: 2990,
    currency: "ILS",
    productUrl: "https://www.halilit.com/product/...",
    scrapedAt: "2026-03-15T18:27:45.123Z"
  },
  // ... more results for other sites
]
```

## What Gets Logged (with API key)

### Request Log Entry:
```json
{
  "type": "LLM_REQUEST",
  "product": {
    "name": "Roland FP-10",
    "searchTerm": "Roland FP-10"
  },
  "sites": [
    {
      "name": "חלילית",
      "baseUrl": "https://www.halilit.com/",
      "searchUrl": "https://www.halilit.com/search?q=Roland%20FP-10"
    },
    // ... other sites
  ],
  "model": "gpt-4o-mini",
  "prompt": "You are a price comparison assistant..."
}
```

### Response Log Entry:
```json
{
  "type": "LLM_RESPONSE",
  "product": "Roland FP-10",
  "rawResponse": "{...}",
  "parsedResult": {
    "productName": "Roland FP-10",
    "searchTerm": "Roland FP-10",
    "results": [
      {
        "siteName": "חלילית",
        "siteUrl": "https://www.halilit.com/",
        "price": 2990,
        "priceText": "₪2,990",
        "productUrl": "https://...",
        "confidence": "high"
      }
    ]
  },
  "usage": {
    "prompt_tokens": 500,
    "completion_tokens": 200,
    "total_tokens": 700
  }
}
```

## Current Status

✅ **Logging System:** Working  
✅ **Function Structure:** Correct  
⚠️ **API Key:** Not configured  
📁 **Log File:** `logs/llm-2026-03-15.log` created

## To Test with Real API

1. Create `backend/.env`:
   ```bash
   OPENAI_API_KEY=sk-your-key-here
   ```

2. Run test:
   ```bash
   cd backend
   npx tsx src/test-llm.ts
   ```

3. Check logs:
   ```bash
   cat logs/llm-2026-03-15.log
   ```

## Function Return Value

The function returns `ScrapeResult[]` which:
- Contains price results for each site where product was found
- Each result includes: productId, siteId, price, currency, productUrl, scrapedAt
- Results are saved to `data/results.json`
- Can be viewed in the backoffice UI
