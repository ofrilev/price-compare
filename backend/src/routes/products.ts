import { Router } from "express";
import { v4 as uuidv4 } from "uuid";
import { readJson, writeJson } from "../services/store.js";
import { KNOWN_DIEZ_CATEGORIES } from "../config/diezCategoryMapping.js";
import type { Product } from "../types.js";

export const productsRouter = Router();

async function getProducts(): Promise<Product[]> {
  return readJson<Product[]>("products.json");
}

export async function getCategories(): Promise<string[]> {
  const products = await getProducts();
  const fromProducts = [...new Set(products.map((p) => p.category).filter(Boolean))];
  const merged = [...new Set([...fromProducts, ...KNOWN_DIEZ_CATEGORIES])];
  return merged.sort();
}

/** Distinct non-empty brand (חברה) values for filters */
export async function getBrands(): Promise<string[]> {
  const products = await getProducts();
  const set = new Set<string>();
  for (const p of products) {
    const b = (p.brand ?? "").trim();
    if (b) set.add(b);
  }
  return [...set].sort((a, b) => a.localeCompare(b, "he"));
}

productsRouter.get("/brands", async (_req, res) => {
  try {
    const brands = await getBrands();
    res.json(brands);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch brands" });
  }
});

productsRouter.get("/", async (req, res) => {
  try {
    let products = await getProducts();
    const category = req.query.category as string | undefined;
    const brand = req.query.brand as string | undefined;
    const search = req.query.search as string | undefined;
    if (category) products = products.filter((p) => p.category === category);
    if (brand === "__none__") {
      products = products.filter((p) => !(p.brand ?? "").trim());
    } else if (brand?.trim()) {
      const b = brand.trim();
      products = products.filter((p) => (p.brand ?? "").trim() === b);
    }
    if (search) {
      const q = search.toLowerCase();
      products = products.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.searchTerm && p.searchTerm.toLowerCase().includes(q)) ||
          (p.brand && p.brand.toLowerCase().includes(q)) ||
          p.category.toLowerCase().includes(q)
      );
    }
    res.json(products);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch products" });
  }
});

productsRouter.get("/:id", async (req, res) => {
  try {
    const products = await getProducts();
    const product = products.find((p) => p.id === req.params.id);
    if (!product) return res.status(404).json({ error: "Product not found" });
    res.json(product);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch product" });
  }
});

/**
 * Apply brand and/or category to many products in one read/write (avoids parallel PUT races on products.json).
 */
productsRouter.post("/bulk-update", async (req, res) => {
  try {
    const ids: unknown = req.body?.ids;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: "ids array required" });
    }
    const idSet = new Set(ids.map((x) => String(x)));
    const hasBrand = Object.prototype.hasOwnProperty.call(req.body, "brand");
    const hasCategory = Object.prototype.hasOwnProperty.call(req.body, "category");
    if (!hasBrand && !hasCategory) {
      return res.status(400).json({ error: "Provide brand and/or category" });
    }

    const products = await getProducts();
    let changed = 0;

    for (let i = 0; i < products.length; i++) {
      if (!idSet.has(products[i].id)) continue;
      const p = products[i];
      const name = p.name.trim();
      const category = (
        hasCategory ? String(req.body.category ?? "").trim() : p.category
      ).trim();
      const brand = hasBrand
        ? String(req.body.brand ?? "").trim()
        : (p.brand ?? "").trim();
      const searchTerm = (p.searchTerm ?? p.name).trim();

      if (hasCategory) {
        const dup = products.find(
          (x) =>
            x.id !== p.id &&
            x.name.trim().toLowerCase() === name.toLowerCase() &&
            x.category.trim().toLowerCase() === category.toLowerCase()
        );
        if (dup) {
          return res.status(400).json({
            error: `Product '${name}' already exists in category '${category}'`,
          });
        }
      }

      products[i] = {
        ...p,
        id: p.id,
        name,
        category: hasCategory ? category : p.category,
        brand: hasBrand ? brand || undefined : p.brand,
        searchTerm: searchTerm || undefined,
      };
      changed++;
    }

    if (changed === 0) {
      return res.status(404).json({ error: "No matching product ids" });
    }

    await writeJson("products.json", products);
    res.json({ ok: true, count: changed });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Bulk update failed" });
  }
});

productsRouter.post("/bulk-delete", async (req, res) => {
  try {
    const ids: unknown = req.body?.ids;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: "ids array required" });
    }
    const idSet = new Set(ids.map((x) => String(x)));
    const products = await getProducts();
    const filtered = products.filter((p) => !idSet.has(p.id));
    const deleted = products.length - filtered.length;
    if (deleted === 0) {
      return res.status(404).json({ error: "No matching product ids" });
    }
    await writeJson("products.json", filtered);
    res.json({ ok: true, deleted });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Bulk delete failed" });
  }
});

productsRouter.post("/", async (req, res) => {
  try {
    const products = await getProducts();
    const name = (req.body.name ?? "").trim();
    const searchTerm = (req.body.searchTerm ?? name).trim();
    const brand = (req.body.brand ?? "").trim();
    const category = (req.body.category ?? "").trim();

    const existingByNameAndCategory = products.find(
      (p) =>
        p.name.trim().toLowerCase() === name.toLowerCase() &&
        p.category.trim().toLowerCase() === category.toLowerCase()
    );
    if (existingByNameAndCategory) {
      const msg = category
        ? `Product '${name}' in category '${category}' already exists`
        : `Product '${name}' already exists`;
      return res.status(400).json({ error: msg });
    }

    const product: Product = {
      id: uuidv4(),
      name,
      searchTerm: searchTerm || undefined,
      brand: brand || undefined,
      category,
    };
    products.push(product);
    await writeJson("products.json", products);
    res.status(201).json(product);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create product" });
  }
});

productsRouter.put("/:id", async (req, res) => {
  try {
    const products = await getProducts();
    const idx = products.findIndex((p) => p.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: "Product not found" });

    const name = (req.body.name ?? products[idx].name).trim();
    const prev = products[idx];
    const searchTerm = (req.body.searchTerm ?? prev.searchTerm ?? prev.name).trim();
    const brand = (req.body.brand !== undefined ? String(req.body.brand) : prev.brand ?? "").trim();
    const category = (req.body.category ?? products[idx].category).trim();

    const existingByNameAndCategory = products.find(
      (p) =>
        p.id !== req.params.id &&
        p.name.trim().toLowerCase() === name.toLowerCase() &&
        p.category.trim().toLowerCase() === category.toLowerCase()
    );
    if (existingByNameAndCategory) {
      const msg = category
        ? `Product '${name}' in category '${category}' already exists`
        : `Product '${name}' already exists`;
      return res.status(400).json({ error: msg });
    }

    products[idx] = {
      ...products[idx],
      id: products[idx].id,
      name,
      searchTerm: searchTerm || undefined,
      brand: brand || undefined,
      category,
    };
    await writeJson("products.json", products);
    res.json(products[idx]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update product" });
  }
});

productsRouter.delete("/:id", async (req, res) => {
  try {
    const products = await getProducts();
    const filtered = products.filter((p) => p.id !== req.params.id);
    if (filtered.length === products.length) return res.status(404).json({ error: "Product not found" });
    await writeJson("products.json", filtered);
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to delete product" });
  }
});
