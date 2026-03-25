import { atom } from "jotai";
import { atomWithStorage, createJSONStorage } from "jotai/utils";

const jsonStorage = <T>() => createJSONStorage<T>(() => localStorage);
const sessionJsonStorage = <T>() => createJSONStorage<T>(() => sessionStorage);

/** Compare page: category / product / brand / site selections — persisted across navigation */
export const scrapeCategoryFilterAtom = atomWithStorage(
  "price-scraper-scrape-cat-filter-v1",
  "",
);

export const scrapeBrandFilterAtom = atomWithStorage(
  "price-scraper-scrape-brand-v1",
  "",
);

export const scrapeSelectedProductIdsAtom = atomWithStorage<string[]>(
  "price-scraper-scrape-product-ids-v1",
  [],
  jsonStorage<string[]>(),
);

export const scrapeSelectedSiteIdsAtom = atomWithStorage<string[]>(
  "price-scraper-scrape-site-ids-v1",
  [],
  jsonStorage<string[]>(),
);

/** When true, Diez is auto-selected and server merges Diez into compare. When false, only explicit site selection. */
export const scrapeIncludeDiezDefaultAtom = atomWithStorage<boolean>(
  "price-scraper-include-diez-default-v1",
  true,
  jsonStorage<boolean>(),
);

export type LastSearchRunStatus = {
  updatedAt: string;
  runType: "navigator" | "category_match" | null;
  state: "idle" | "success" | "error";
  summary: string;
  detail?: string;
  resultsCount?: number;
  /** מוצרים / קטגוריה — להצגה בבאנר אחרון */
  scopeHint?: string;
};

const defaultLastSearch: LastSearchRunStatus = {
  updatedAt: "",
  runType: null,
  state: "idle",
  summary: "",
};

export const lastSearchRunStatusAtom = atomWithStorage<LastSearchRunStatus>(
  "price-scraper-last-search-v1",
  defaultLastSearch,
  jsonStorage<LastSearchRunStatus>(),
);

/** Live log line (Navigator stream) — sessionStorage survives SPA route changes; cleared on next run */
export type NavigatorLogEntry = {
  type: string;
  message: string;
  timestamp: number;
};

export const navigatorScrapeLogAtom = atomWithStorage<NavigatorLogEntry[]>(
  "price-scraper-navigator-log-v1",
  [],
  sessionJsonStorage<NavigatorLogEntry[]>(),
);

/** True while EventSource + POST scrape are in flight (memory only; runner stays mounted at app root) */
export const navigatorStreamRunningAtom = atom(false);

export type NavigatorLlmPrompt = {
  product?: string;
  category?: string;
  prompt: string;
};

export type NavigatorLlmResponse = {
  product?: string;
  category?: string;
  rawResponse: string;
  parsedResult: unknown;
};

export const navigatorLastLlmPromptAtom =
  atomWithStorage<NavigatorLlmPrompt | null>(
    "price-scraper-navigator-llm-prompt-v1",
    null,
    sessionJsonStorage<NavigatorLlmPrompt | null>(),
  );

export const navigatorLastLlmResponseAtom =
  atomWithStorage<NavigatorLlmResponse | null>(
    "price-scraper-navigator-llm-resp-v1",
    null,
    sessionJsonStorage<NavigatorLlmResponse | null>(),
  );

export type NavigatorRunBody = {
  productIds?: string[];
  category?: string;
  siteIds?: string[];
  mode?: "scraper" | "llm_websearch" | "navigator";
  includeDiezInCompare?: boolean;
};

/** Dispatched from Scrape; consumed by NavigatorScrapeRunner (app root, survives /scrape unmount) */
export type NavigatorRunRequest = {
  id: string;
  body: NavigatorRunBody;
  /** Precomputed for lastSearch banner */
  scopeHint?: string;
};

export const navigatorRunRequestAtom = atom<NavigatorRunRequest | null>(null);

/** Global toast (e.g. Navigator finished); optional deep-link product rows on Results */
export type AppToastState = {
  id: number;
  message: string;
  variant: "success" | "error";
  /** Product IDs for `/results?focusProducts=` — newest navigator rows */
  focusProductIds?: string[];
};

export const appToastAtom = atom<AppToastState | null>(null);
