import { runScraperComparison } from "../orchestrator/comparisonRunner.js";
import type { ScrapeResult } from "../types.js";

export interface ScraperOrchestratorOptions {
  productIds?: string[];
  category?: string;
  siteIds?: string[];
}

/**
 * Wraps the scraper-first comparison flow. Handles product/site filtering and progress emits.
 */
export async function runScraperOrchestrator(
  options: ScraperOrchestratorOptions
): Promise<ScrapeResult[]> {
  return runScraperComparison(options);
}
