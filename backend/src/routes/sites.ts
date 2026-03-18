import { Router } from "express";
import { v4 as uuidv4 } from "uuid";
import { readJson, writeJson } from "../services/store.js";
import type { Site } from "../types.js";

export const sitesRouter = Router();

async function getSites(): Promise<Site[]> {
  return readJson<Site[]>("sites.json");
}

sitesRouter.get("/", async (_req, res) => {
  try {
    const sites = await getSites();
    res.json(sites);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch sites" });
  }
});

sitesRouter.get("/:id", async (req, res) => {
  try {
    const sites = await getSites();
    const site = sites.find((s) => s.id === req.params.id);
    if (!site) return res.status(404).json({ error: "Site not found" });
    res.json(site);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch site" });
  }
});

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url.startsWith("http") ? url : `https://${url}`);
    return u.origin.toLowerCase().replace(/\/$/, "");
  } catch {
    return url.toLowerCase();
  }
}

sitesRouter.post("/", async (req, res) => {
  try {
    const sites = await getSites();
    const name = (req.body.name ?? "").trim();
    const baseUrl = (req.body.baseUrl ?? "").trim();

    const existingByName = sites.find(
      (s) => s.name.trim().toLowerCase() === name.toLowerCase()
    );
    if (existingByName) {
      return res.status(400).json({ error: `Site '${name}' already exists` });
    }

    const normalizedBase = baseUrl ? normalizeUrl(baseUrl) : "";
    const existingByUrl = normalizedBase && sites.find(
      (s) => s.baseUrl && normalizeUrl(s.baseUrl) === normalizedBase
    );
    if (existingByUrl) {
      return res.status(400).json({ error: `Site with URL '${baseUrl}' already exists` });
    }

    const site: Site = {
      id: uuidv4(),
      name,
      baseUrl,
      searchUrlTemplate: req.body.searchUrlTemplate ?? "",
      selectors: req.body.selectors ?? { price: "" },
      selectorType: req.body.selectorType ?? "css",
      usePlaywright: req.body.usePlaywright ?? true,
      enabled: req.body.enabled ?? true,
      scraperConfig: req.body.scraperConfig,
    };
    sites.push(site);
    await writeJson("sites.json", sites);
    res.status(201).json(site);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create site" });
  }
});

sitesRouter.put("/:id", async (req, res) => {
  try {
    const sites = await getSites();
    const idx = sites.findIndex((s) => s.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: "Site not found" });

    const name = (req.body.name ?? sites[idx].name).trim();
    const baseUrl = (req.body.baseUrl ?? sites[idx].baseUrl).trim();

    const existingByName = sites.find(
      (s) => s.id !== req.params.id && s.name.trim().toLowerCase() === name.toLowerCase()
    );
    if (existingByName) {
      return res.status(400).json({ error: `Site '${name}' already exists` });
    }

    const normalizedBase = baseUrl ? normalizeUrl(baseUrl) : "";
    const existingByUrl = normalizedBase && sites.find(
      (s) => s.id !== req.params.id && s.baseUrl && normalizeUrl(s.baseUrl) === normalizedBase
    );
    if (existingByUrl) {
      return res.status(400).json({ error: `Site with URL '${baseUrl}' already exists` });
    }

    sites[idx] = { ...sites[idx], ...req.body, id: sites[idx].id };
    await writeJson("sites.json", sites);
    res.json(sites[idx]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update site" });
  }
});

sitesRouter.delete("/:id", async (req, res) => {
  try {
    const sites = await getSites();
    const filtered = sites.filter((s) => s.id !== req.params.id);
    if (filtered.length === sites.length) return res.status(404).json({ error: "Site not found" });
    await writeJson("sites.json", filtered);
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to delete site" });
  }
});
