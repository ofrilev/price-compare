import { Router } from "express";
import { v4 as uuidv4 } from "uuid";
import { readJson, writeJson } from "../services/store.js";
import { runLLMComparison } from "../services/llmComparison.js";
import { runScraperComparison } from "../orchestrator/comparisonRunner.js";
import { runNavigatorComparison } from "../orchestrator/navigatorRunner.js";
import { runLLMWebSearch } from "../services/llmWebSearch.service.js";
import { matchCategoryProducts } from "../services/categoryMatcher.js";
import { subscribe } from "../services/scrapeProgress.js";
import { mergeDiezSiteId } from "../config/diezSite.js";
import type { ScrapeResult, Product, Site } from "../types.js";

interface CategoryMatchPrice {
  site: string;
  price: number;
  url: string;
}

interface CategoryMatchItem {
  model: string;
  common_features?: string;
  prices: CategoryMatchPrice[];
  best_deal: string;
}

interface UnmatchedItem {
  model: string;
  site: string;
  price: number;
  url: string;
}

async function saveCategoryMatchResults(
  category: string,
  comparison: CategoryMatchItem[],
  unmatched: UnmatchedItem[] = []
): Promise<{ productsAdded: number; resultsAdded: number }> {
  const products = await readJson<Product[]>("products.json").catch(() => []);
  const sites = await readJson<Site[]>("sites.json");
  const existingResults = await readJson<ScrapeResult[]>("results.json").catch(() => []);

  const siteByName = new Map(sites.map((s) => [s.name, s]));
  const productByNameAndCategory = new Map(
    products.map((p) => [`${p.name}|${p.category}`, p])
  );
  const now = new Date().toISOString();
  const today = now.split("T")[0];

  const existingResultKeys = new Set(
    existingResults.map((r) => `${r.productId}-${r.siteId}-${r.scrapedAt.split("T")[0]}`)
  );

  const newProducts: Product[] = [];
  const newResults: ScrapeResult[] = [];

  for (const item of comparison) {
    const modelName = item.model.trim();
    const key = `${modelName}|${category}`;
    let product = productByNameAndCategory.get(key);

    if (!product) {
      product = {
        id: uuidv4(),
        name: modelName,
        searchTerm: modelName,
        category,
      };
      newProducts.push(product);
      productByNameAndCategory.set(key, product);
    }

    for (const p of item.prices) {
      const site = siteByName.get(p.site);
      if (!site || !p.url || p.price <= 0) continue;

      const resultKey = `${product!.id}-${site.id}-${today}`;
      if (existingResultKeys.has(resultKey)) continue;

      const scrapeResult: ScrapeResult = {
        id: uuidv4(),
        productId: product!.id,
        siteId: site.id,
        price: p.price,
        currency: "ILS",
        productUrl: p.url,
        scrapedAt: now,
      };
      newResults.push(scrapeResult);
      existingResultKeys.add(resultKey);
    }
  }

  // Also save unmatched products (found in only one store)
  for (const item of unmatched) {
    const modelName = item.model.trim();
    const key = `${modelName}|${category}`;
    let product = productByNameAndCategory.get(key);

    if (!product) {
      product = {
        id: uuidv4(),
        name: modelName,
        searchTerm: modelName,
        category,
      };
      newProducts.push(product);
      productByNameAndCategory.set(key, product);
    }

    const site = siteByName.get(item.site);
    if (!site || item.price <= 0) continue;

    const url = item.url || site.siteUrl || site.baseUrl;
    const resultKey = `${product!.id}-${site.id}-${today}`;
    if (existingResultKeys.has(resultKey)) continue;

    const scrapeResult: ScrapeResult = {
      id: uuidv4(),
      productId: product!.id,
      siteId: site.id,
      price: item.price,
      currency: "ILS",
      productUrl: url,
      scrapedAt: now,
    };
    newResults.push(scrapeResult);
    existingResultKeys.add(resultKey);
  }

  if (newProducts.length > 0) {
    await writeJson("products.json", [...products, ...newProducts]);
  }
  if (newResults.length > 0) {
    await writeJson("results.json", [...existingResults, ...newResults]);
  }

  return { productsAdded: newProducts.length, resultsAdded: newResults.length };
}

export const scrapeRouter = Router();

scrapeRouter.get("/stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // Disable nginx buffering
  res.flushHeaders();

  // Send initial connection confirmation
  res.write(`data: ${JSON.stringify({ type: "status", message: "Stream connected" })}\n\n`);

  const unsubscribe = subscribe((data) => {
    try {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch (err) {
      // Connection closed, unsubscribe
      unsubscribe();
    }
  });

  // Send keep-alive ping every 30 seconds
  const keepAliveInterval = setInterval(() => {
    try {
      res.write(`: keep-alive\n\n`);
    } catch (err) {
      clearInterval(keepAliveInterval);
      unsubscribe();
    }
  }, 30000);

  req.on("close", () => {
    clearInterval(keepAliveInterval);
    unsubscribe();
  });

  req.on("error", () => {
    clearInterval(keepAliveInterval);
    unsubscribe();
  });
});

scrapeRouter.post("/", async (req, res) => {
  try {
    const { productIds, category, siteIds, mode } = req.body ?? {};
    const useLegacy = process.env.USE_LEGACY_LLM_SCRAPE === "true";

    const sitesList = await readJson<Site[]>("sites.json");
    const ids = mergeDiezSiteId(Array.isArray(siteIds) ? siteIds : [], sitesList);
    if (ids.length === 0) {
      return res.status(400).json({
        error: "יש לבחור לפחות אתר אחד לפני ההשוואה",
      });
    }

    let results: ScrapeResult[];
    if (mode === "navigator") {
      results = await runNavigatorComparison({ productIds, category, siteIds: ids });
    } else if (mode === "llm_websearch") {
      results = await runLLMWebSearch({ productIds, category, siteIds: ids });
    } else if (useLegacy) {
      results = await runLLMComparison({ productIds, category, siteIds: ids });
    } else {
      results = await runScraperComparison({ productIds, category, siteIds: ids });
    }
    
    // Save results (merge with existing, avoiding duplicates)
    const existing = await readJson<ScrapeResult[]>("results.json").catch(() => []);
    const existingIds = new Set(existing.map((r) => `${r.productId}-${r.siteId}-${r.scrapedAt.split("T")[0]}`));
    const newResults = results.filter((r) => {
      const key = `${r.productId}-${r.siteId}-${r.scrapedAt.split("T")[0]}`;
      return !existingIds.has(key);
    });
    const updated = [...existing, ...newResults];
    await writeJson("results.json", updated);
    
    res.json({ results, count: results.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "השוואה נכשלה" });
  }
});

scrapeRouter.get("/results", async (req, res) => {
  try {
    let results = await readJson<ScrapeResult[]>("results.json");
    const productId = req.query.productId as string | undefined;
    const category = req.query.category as string | undefined;

    if (productId) results = results.filter((r) => r.productId === productId);
    if (category) {
      const products = await readJson<Product[]>("products.json");
      const productIdsInCategory = products.filter((p) => p.category === category).map((p) => p.id);
      results = results.filter((r) => productIdsInCategory.includes(r.productId));
    }

    const products = await readJson<Product[]>("products.json");
    const sites = await readJson<Site[]>("sites.json");
    const productMap = new Map(products.map((p) => [p.id, p]));
    const siteMap = new Map(sites.map((s) => [s.id, s]));

    const enriched = results.map((r) => ({
      ...r,
      productName: productMap.get(r.productId)?.name ?? "Unknown",
      siteName: siteMap.get(r.siteId)?.name ?? "Unknown",
    }));

    res.json(enriched);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "נכשל בטעינת תוצאות" });
  }
});

scrapeRouter.get("/results/lowest", async (req, res) => {
  try {
    const results = await readJson<ScrapeResult[]>("results.json");
    const products = await readJson<Product[]>("products.json");
    const sites = await readJson<Site[]>("sites.json");

    const category = req.query.category as string | undefined;
    let filteredResults = results;
    if (category) {
      const productIdsInCategory = products.filter((p) => p.category === category).map((p) => p.id);
      filteredResults = results.filter((r) => productIdsInCategory.includes(r.productId));
    }

    const byProduct = new Map<string, ScrapeResult>();
    for (const r of filteredResults) {
      const existing = byProduct.get(r.productId);
      if (!existing || r.price < existing.price) {
        byProduct.set(r.productId, r);
      }
    }

    const productMap = new Map(products.map((p) => [p.id, p]));
    const siteMap = new Map(sites.map((s) => [s.id, s]));

    const lowest = Array.from(byProduct.entries()).map(([productId, r]) => ({
      productId,
      productName: productMap.get(productId)?.name ?? "Unknown",
      siteName: siteMap.get(r.siteId)?.name ?? "Unknown",
      price: r.price,
      currency: r.currency,
      productUrl: r.productUrl,
      scrapedAt: r.scrapedAt,
    }));

    res.json(lowest);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "נכשל בטעינת המחירים הנמוכים ביותר" });
  }
});

/**
 * PATCH /api/scrape/results/:id
 * Manually update price and/or product URL. `scrapedAt` is refreshed only when `price` changes.
 */
scrapeRouter.patch("/results/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const body = req.body ?? {};
    const hasPrice = Object.prototype.hasOwnProperty.call(body, "price");
    const hasUrl = Object.prototype.hasOwnProperty.call(body, "productUrl");

    if (!hasPrice && !hasUrl) {
      return res.status(400).json({
        error: "נדרש לפחות אחד: price או productUrl",
      });
    }

    const results = await readJson<ScrapeResult[]>("results.json");
    const idx = results.findIndex((r) => r.id === id);
    if (idx === -1) {
      return res.status(404).json({ error: "תוצאה לא נמצאה" });
    }

    const current = results[idx];
    let nextPrice = current.price;
    let nextUrl = current.productUrl;
    let nextScrapedAt = current.scrapedAt;

    if (hasPrice) {
      const raw = body.price;
      const p = typeof raw === "number" ? raw : parseFloat(String(raw));
      if (!Number.isFinite(p) || p <= 0) {
        return res.status(400).json({ error: "מחיר לא תקין" });
      }
      if (p !== current.price) {
        nextPrice = p;
        nextScrapedAt = new Date().toISOString();
      }
    }

    if (hasUrl) {
      const u = String(body.productUrl ?? "").trim();
      if (!u) {
        return res.status(400).json({ error: "קישור לא יכול להיות ריק" });
      }
      nextUrl = u;
    }

    const updated: ScrapeResult = {
      ...current,
      price: nextPrice,
      productUrl: nextUrl,
      scrapedAt: nextScrapedAt,
    };
    results[idx] = updated;
    await writeJson("results.json", results);

    const products = await readJson<Product[]>("products.json");
    const sites = await readJson<Site[]>("sites.json");
    const productMap = new Map(products.map((p) => [p.id, p]));
    const siteMap = new Map(sites.map((s) => [s.id, s]));

    res.json({
      ...updated,
      productName: productMap.get(updated.productId)?.name ?? "Unknown",
      siteName: siteMap.get(updated.siteId)?.name ?? "Unknown",
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "עדכון תוצאה נכשל" });
  }
});

/**
 * DELETE /api/scrape/results/:id
 * Remove one stored price row (product × site).
 */
scrapeRouter.delete("/results/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const results = await readJson<ScrapeResult[]>("results.json");
    const next = results.filter((r) => r.id !== id);
    if (next.length === results.length) {
      return res.status(404).json({ error: "תוצאה לא נמצאה" });
    }
    await writeJson("results.json", next);
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "מחיקת תוצאה נכשלה" });
  }
});

/**
 * POST /api/scrape/match-category
 * Match products across sites for a category using LLM
 */
scrapeRouter.post("/match-category", async (req, res) => {
  try {
    const { category, siteIds } = req.body ?? {};
    
    if (!category) {
      return res.status(400).json({ error: "קטגוריה נדרשת" });
    }

    const sitesForCategory = await readJson<Site[]>("sites.json");
    const mIds = mergeDiezSiteId(Array.isArray(siteIds) ? siteIds : [], sitesForCategory);
    if (mIds.length === 0) {
      return res.status(400).json({
        error: "יש לבחור לפחות אתר אחד להתאמת קטגוריה",
      });
    }

    const result = await matchCategoryProducts(category, mIds);
    
    if (!result) {
      return res.status(500).json({ error: "התאמת קטגוריה נכשלה" });
    }

    // Parse unmatched: use structured array if present, else parse unmatched_highlights
    let unmatched: UnmatchedItem[] = result.unmatched || [];
    if (unmatched.length === 0 && result.unmatched_highlights?.length) {
      const siteByName = new Map((await readJson<Site[]>("sites.json")).map((s) => [s.name, s]));
      for (const s of result.unmatched_highlights) {
        const m = s.match(/^(.+?)\s*-\s*found only at\s+(.+?)\s+for\s+(\d+)/i);
        if (m) {
          const [, model, siteName, priceStr] = m;
          const site = siteByName.get(siteName?.trim() || "");
          if (model && site) {
            unmatched.push({
              model: model.trim(),
              site: siteName?.trim() || "",
              price: parseInt(priceStr || "0", 10),
              url: site.siteUrl || site.baseUrl,
            });
          }
        }
      }
    }

    // Store comparison results as products and scrape results (including unmatched)
    const { productsAdded, resultsAdded } = await saveCategoryMatchResults(
      category,
      result.comparison,
      unmatched
    );
    if (productsAdded > 0 || resultsAdded > 0) {
      console.log(
        `[Category Match] Saved: ${productsAdded} new product(s), ${resultsAdded} new result(s)`
      );
    }
    
    res.json({ ...result, saved: { productsAdded, resultsAdded } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[match-category]", err);
    res.status(500).json({ error: "התאמת קטגוריה נכשלה", details: msg });
  }
});
