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

sitesRouter.post("/", async (req, res) => {
  try {
    const sites = await getSites();
    const site: Site = {
      id: uuidv4(),
      name: req.body.name ?? "",
      baseUrl: req.body.baseUrl ?? "",
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
