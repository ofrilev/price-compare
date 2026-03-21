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

productsRouter.get("/", async (req, res) => {
  try {
    let products = await getProducts();
    const category = req.query.category as string | undefined;
    const search = req.query.search as string | undefined;
    if (category) products = products.filter((p) => p.category === category);
    if (search) {
      const q = search.toLowerCase();
      products = products.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.searchTerm.toLowerCase().includes(q) ||
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

productsRouter.post("/", async (req, res) => {
  try {
    const products = await getProducts();
    const name = (req.body.name ?? "").trim();
    const searchTerm = (req.body.searchTerm ?? "").trim();
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

    const existingBySearchTerm = searchTerm && products.find(
      (p) => p.searchTerm.trim().toLowerCase() === searchTerm.toLowerCase()
    );
    if (existingBySearchTerm) {
      return res.status(400).json({ error: `Search term '${searchTerm}' already exists` });
    }

    const product: Product = {
      id: uuidv4(),
      name,
      searchTerm,
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
    const searchTerm = (req.body.searchTerm ?? products[idx].searchTerm).trim();
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

    const existingBySearchTerm = searchTerm && products.find(
      (p) => p.id !== req.params.id && p.searchTerm.trim().toLowerCase() === searchTerm.toLowerCase()
    );
    if (existingBySearchTerm) {
      return res.status(400).json({ error: `Search term '${searchTerm}' already exists` });
    }

    products[idx] = { ...products[idx], ...req.body, id: products[idx].id };
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
