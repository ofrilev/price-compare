import { atomWithStorage, createJSONStorage } from "jotai/utils";
const jsonStorage = <T>() => createJSONStorage<T>(() => localStorage);

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
