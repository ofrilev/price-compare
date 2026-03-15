import { Router } from "express";
import { readJson, writeJson } from "../services/store.js";
import { runLLMComparison } from "../services/llmComparison.js";
import { subscribe } from "../services/scrapeProgress.js";
import type { ScrapeResult, Product, Site } from "../types.js";

export const scrapeRouter = Router();

scrapeRouter.get("/stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const unsubscribe = subscribe((data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  });

  req.on("close", () => unsubscribe());
});

scrapeRouter.post("/", async (req, res) => {
  try {
    const { productIds, category, siteIds } = req.body ?? {};
    
    // Always use LLM comparison (scraping removed)
    const results = await runLLMComparison({ productIds, category, siteIds });
    
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
