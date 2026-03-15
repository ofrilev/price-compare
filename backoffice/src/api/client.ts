const API = import.meta.env.VITE_API_URL || "/api";

function getAuthToken(): string | null {
  return localStorage.getItem("auth_token");
}

async function fetchApi<T>(path: string, options?: RequestInit): Promise<T> {
  const token = getAuthToken();
  const headers: HeadersInit = {
    "Content-Type": "application/json",
    ...options?.headers,
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(`${API}${path}`, {
    ...options,
    headers,
  });

  if (res.status === 401) {
    // Unauthorized - clear auth and redirect to login
    localStorage.removeItem("auth_token");
    localStorage.removeItem("auth_user");
    window.location.href = "/login";
    throw new Error("Authentication required");
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? "Request failed");
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  sites: {
    list: () => fetchApi<Site[]>(`/sites`),
    get: (id: string) => fetchApi<Site>(`/sites/${id}`),
    create: (data: Partial<Site>) =>
      fetchApi<Site>(`/sites`, { method: "POST", body: JSON.stringify(data) }),
    update: (id: string, data: Partial<Site>) =>
      fetchApi<Site>(`/sites/${id}`, {
        method: "PUT",
        body: JSON.stringify(data),
      }),
    delete: (id: string) =>
      fetchApi<void>(`/sites/${id}`, { method: "DELETE" }),
  },
  products: {
    list: (params?: { category?: string; search?: string }) => {
      const q = new URLSearchParams(
        params as Record<string, string>,
      ).toString();
      return fetchApi<Product[]>(`/products${q ? `?${q}` : ""}`);
    },
    get: (id: string) => fetchApi<Product>(`/products/${id}`),
    create: (data: Partial<Product>) =>
      fetchApi<Product>(`/products`, {
        method: "POST",
        body: JSON.stringify(data),
      }),
    update: (id: string, data: Partial<Product>) =>
      fetchApi<Product>(`/products/${id}`, {
        method: "PUT",
        body: JSON.stringify(data),
      }),
    delete: (id: string) =>
      fetchApi<void>(`/products/${id}`, { method: "DELETE" }),
  },
  categories: () => fetchApi<string[]>(`/categories`),
  scrape: {
    run: (body?: {
      productIds?: string[];
      category?: string;
      siteIds?: string[];
    }) =>
      fetchApi<{ results: ScrapeResult[]; count: number }>(`/scrape`, {
        method: "POST",
        body: JSON.stringify(body ?? {}),
      }),
    results: (params?: { productId?: string; category?: string }) => {
      const q = new URLSearchParams(
        params as Record<string, string>,
      ).toString();
      return fetchApi<ScrapeResult[]>(`/scrape/results${q ? `?${q}` : ""}`);
    },
    lowest: (params?: { category?: string }) => {
      const q = new URLSearchParams(
        params as Record<string, string>,
      ).toString();
      return fetchApi<LowestPrice[]>(
        `/scrape/results/lowest${q ? `?${q}` : ""}`,
      );
    },
  },
};

export interface ScraperConfig {
  searchStrategy?: "url" | "searchBar";
  searchInputSelector?: string;
  searchSubmitSelector?: string;
  priceSelectors?: string[];
  resultItemSelector?: string;
  priceStrategy?: "first" | "lowest" | "sale";
  waitStrategy?: "domcontentloaded" | "networkidle" | "selector" | "timeout";
  waitSelector?: string;
  waitExtraMs?: number;
  preSteps?: Array<{ type: "click" | "scroll"; selector?: string }>;
  userAgent?: string;
}

export interface Site {
  id: string;
  name: string;
  baseUrl: string;
  siteUrl?: string;
  searchUrlTemplate: string;
  selectors: { price: string; productName?: string; productLink?: string };
  selectorType: "css" | "xpath";
  usePlaywright: boolean;
  enabled: boolean;
  scraperConfig?: ScraperConfig;
}

export interface Product {
  id: string;
  name: string;
  searchTerm: string;
  category: string;
}

export interface ScrapeResult {
  id: string;
  productId: string;
  siteId: string;
  price: number;
  currency: string;
  productUrl: string;
  scrapedAt: string;
  productName?: string;
  siteName?: string;
}

export interface LowestPrice {
  productId: string;
  productName: string;
  siteName: string;
  price: number;
  currency: string;
  productUrl: string;
  scrapedAt: string;
}
