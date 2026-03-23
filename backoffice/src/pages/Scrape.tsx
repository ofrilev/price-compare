import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, API_BASE, type Product, type Site } from "../api/client";
import { useState, useRef, useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import { useAtom } from "jotai";
import {
  scrapeCategoryFilterAtom,
  scrapeBrandFilterAtom,
  scrapeSelectedProductIdsAtom,
  scrapeSelectedSiteIdsAtom,
  scrapeIncludeDiezDefaultAtom,
  lastSearchRunStatusAtom,
} from "../atoms/scrapeAtoms";
import { isDiezConfiguredSite } from "../utils/comparisonTableSites";
import { APP_TITLE } from "../config/app";

/** Navigator is the only scrape mode for now */
const SCRAPE_MODE = "navigator" as const;

function getDiezSiteId(sitesList: Site[]): string | undefined {
  return sitesList.find((s) => s.enabled && isDiezConfiguredSite(s))?.id;
}

/** When includeDiez is true, ensure enabled Diez is in the selected site ids */
function withRequiredDiezIds(
  ids: string[],
  sitesList: Site[],
  includeDiez: boolean,
): string[] {
  if (!includeDiez) return [...ids];
  const diezId = getDiezSiteId(sitesList);
  if (!diezId || ids.includes(diezId)) return [...ids];
  return [...ids, diezId];
}

function formatNavigatorScopeHint(
  productIds: string[] | undefined,
  productsList: Product[],
): string | undefined {
  if (!productIds?.length) return undefined;
  const names = productIds
    .map((id) => productsList.find((p) => p.id === id)?.name)
    .filter(Boolean) as string[];
  if (names.length === 0) return undefined;
  if (names.length === 1) return `מוצר: ${names[0]}`;
  if (names.length === 2) return `מוצרים: ${names[0]} · ${names[1]}`;
  return `מוצרים: ${names[0]} · ${names[1]} ועוד ${names.length - 2}`;
}

function getDefaultSiteIdsForBrand(
  brandFilter: string,
  sitesList: Site[],
): string[] {
  if (!brandFilter || brandFilter === "__none__") return [];
  const b = brandFilter.toLowerCase();
  const enabled = sitesList.filter((s) => s.enabled);
  if (b.includes("yamaha")) {
    const s =
      enabled.find((x) => /kley|klei|זמר/i.test(x.name)) ||
      enabled.find((x) => x.baseUrl.toLowerCase().includes("kley-zemer"));
    return s ? [s.id] : [];
  }
  if (b.includes("roland")) {
    const s =
      enabled.find((x) => /halilit|חלילית/i.test(x.name)) ||
      enabled.find((x) => x.baseUrl.toLowerCase().includes("halilit.com"));
    return s ? [s.id] : [];
  }
  return [];
}

export default function Scrape() {
  const queryClient = useQueryClient();
  const [categoryFilter, setCategoryFilter] = useAtom(scrapeCategoryFilterAtom);
  const [scrapeBrandFilter, setScrapeBrandFilter] = useAtom(
    scrapeBrandFilterAtom,
  );
  const [showProductsDropdown, setShowProductsDropdown] = useState(false);
  const [productDropdownSearch, setProductDropdownSearch] = useState("");
  const [selectedProductIds, setSelectedProductIds] = useAtom(
    scrapeSelectedProductIdsAtom,
  );
  const [selectedSiteIds, setSelectedSiteIds] = useAtom(
    scrapeSelectedSiteIdsAtom,
  );
  const [includeDiezDefault, setIncludeDiezDefault] = useAtom(
    scrapeIncludeDiezDefaultAtom,
  );
  const [lastSearchStatus, setLastSearchStatus] = useAtom(
    lastSearchRunStatusAtom,
  );
  const [scrapeLog, setScrapeLog] = useState<
    Array<{ type: string; message: string; timestamp: number }>
  >([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [lastLlmPrompt, setLastLlmPrompt] = useState<{
    product?: string;
    category?: string;
    prompt: string;
  } | null>(null);
  const [lastLlmResponse, setLastLlmResponse] = useState<{
    product?: string;
    category?: string;
    rawResponse: string;
    parsedResult: unknown;
  } | null>(null);
  const [showLlmDebug, setShowLlmDebug] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const logContainerRef = useRef<HTMLDivElement>(null);
  const productsDropdownRef = useRef<HTMLDivElement>(null);

  const { data: categories = [] } = useQuery({
    queryKey: ["categories"],
    queryFn: () => api.categories(),
  });

  const { data: brands = [] } = useQuery({
    queryKey: ["brands"],
    queryFn: () => api.products.brands(),
  });

  const { data: sites = [] } = useQuery({
    queryKey: ["sites"],
    queryFn: () => api.sites.list(),
  });

  const { data: products = [] } = useQuery({
    queryKey: ["products", categoryFilter, scrapeBrandFilter],
    queryFn: () =>
      api.products.list({
        ...(categoryFilter ? { category: categoryFilter } : {}),
        ...(scrapeBrandFilter ? { brand: scrapeBrandFilter } : {}),
      }),
  });

  const filteredProductsForDropdown = useMemo(() => {
    const q = productDropdownSearch.trim().toLowerCase();
    if (!q) return products;
    return products.filter((p) => {
      const name = (p.name ?? "").toLowerCase();
      const brand = (p.brand ?? "").toLowerCase();
      const term = (p.searchTerm ?? "").toLowerCase();
      const cat = (p.category ?? "").toLowerCase();
      return (
        name.includes(q) ||
        brand.includes(q) ||
        term.includes(q) ||
        cat.includes(q)
      );
    });
  }, [products, productDropdownSearch]);

  const { data: results = [], isLoading: resultsLoading } = useQuery({
    queryKey: ["scrape-results", categoryFilter],
    queryFn: () =>
      api.scrape.results(categoryFilter ? { category: categoryFilter } : {}),
  });

  const { isLoading: lowestLoading } = useQuery({
    queryKey: ["scrape-lowest", categoryFilter],
    queryFn: () =>
      api.scrape.lowest(categoryFilter ? { category: categoryFilter } : {}),
  });

  const scrapeMutation = useMutation({
    mutationFn: async (
      body: {
        productIds?: string[];
        category?: string;
        siteIds?: string[];
        mode?: "scraper" | "llm_websearch" | "navigator";
        includeDiezInCompare?: boolean;
      } = {},
    ) => {
      setScrapeLog([]);
      setLastLlmPrompt(null);
      setLastLlmResponse(null);
      setIsStreaming(true);

      // Get auth token for EventSource (which can't send headers)
      const token = localStorage.getItem("auth_token");
      const streamUrl = token
        ? `${API_BASE}/scrape/stream?token=${encodeURIComponent(token)}`
        : `${API_BASE}/scrape/stream`;
      const es = new EventSource(streamUrl);
      eventSourceRef.current = es;

      es.onopen = () => {
        console.log("EventSource connection opened for scrape");
      };

      es.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data.type === "llm_prompt") {
            try {
              const parsed = JSON.parse(data.message || "{}");
              setLastLlmPrompt(parsed);
              setShowLlmDebug(true);
            } catch {}
            return;
          }
          if (data.type === "llm_response") {
            try {
              const parsed = JSON.parse(data.message || "{}");
              setLastLlmResponse(parsed);
              setShowLlmDebug(true);
            } catch {}
            return;
          }
          setScrapeLog((prev) => {
            const newLog = [
              ...prev,
              {
                type: data.type || "status",
                message: data.message || "",
                timestamp: Date.now(),
              },
            ];
            setTimeout(() => {
              if (logContainerRef.current) {
                logContainerRef.current.scrollTop =
                  logContainerRef.current.scrollHeight;
              }
            }, 10);
            return newLog;
          });
        } catch (err) {
          console.error("Error parsing EventSource message:", err);
        }
      };

      es.onerror = (event) => {
        console.error(
          "EventSource error:",
          event,
          "readyState:",
          es.readyState,
        );
        // EventSource.CONNECTING = 0, EventSource.OPEN = 1, EventSource.CLOSED = 2
        // Only close if the connection is actually closed
        if (es.readyState === EventSource.CLOSED) {
          console.log("EventSource connection closed");
          setIsStreaming(false);
          es.close();
        }
        // If connecting or open, EventSource will try to reconnect automatically
      };

      try {
        const result = await api.scrape.run(body);
        setIsStreaming(false);
        es.close();
        eventSourceRef.current = null;
        return result;
      } catch (err) {
        setIsStreaming(false);
        es.close();
        eventSourceRef.current = null;
        throw err;
      }
    },
    onSuccess: (data, variables) => {
      setLastSearchStatus({
        updatedAt: new Date().toISOString(),
        runType: "navigator",
        state: "success",
        summary: `השוואת Navigator הושלמה — ${data.count} תוצאות`,
        resultsCount: data.count,
        scopeHint: formatNavigatorScopeHint(variables?.productIds, products),
      });
      queryClient.invalidateQueries({ queryKey: ["scrape-results"] });
      queryClient.invalidateQueries({ queryKey: ["scrape-lowest"] });
    },
    onError: (err, variables) => {
      setIsStreaming(false);
      setLastSearchStatus({
        updatedAt: new Date().toISOString(),
        runType: "navigator",
        state: "error",
        summary: "שגיאה בהרצת Navigator",
        detail: err instanceof Error ? err.message : String(err),
        scopeHint: formatNavigatorScopeHint(variables?.productIds, products),
      });
    },
  });

  const runScrape = () => {
    if (selectedSiteIds.length === 0 || sites.length === 0) return;

    const body: {
      productIds?: string[];
      siteIds: string[];
      mode: typeof SCRAPE_MODE;
      includeDiezInCompare: boolean;
    } = {
      siteIds: selectedSiteIds,
      mode: SCRAPE_MODE,
      includeDiezInCompare: includeDiezDefault,
    };
    if (selectedProductIds.length > 0) {
      body.productIds = selectedProductIds;
    }

    scrapeMutation.mutate(body);
  };

  const toggleProduct = (id: string) => {
    setSelectedProductIds((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id],
    );
  };

  /** Toggle selection for all products currently visible in the dropdown (after search filter) */
  const selectAllFilteredInDropdown = () => {
    const ids = filteredProductsForDropdown.map((p) => p.id);
    if (ids.length === 0) return;
    const allFilteredSelected = ids.every((id) =>
      selectedProductIds.includes(id),
    );
    if (allFilteredSelected) {
      setSelectedProductIds((prev) => prev.filter((id) => !ids.includes(id)));
    } else {
      setSelectedProductIds((prev) => [...new Set([...prev, ...ids])]);
    }
  };

  const selectAllSites = () => {
    const enabledSiteIds = sites.filter((s) => s.enabled).map((s) => s.id);
    const diezId = getDiezSiteId(sites);
    if (selectedSiteIds.length === enabledSiteIds.length) {
      setSelectedSiteIds(
        includeDiezDefault && diezId ? [diezId] : [],
      );
    } else {
      setSelectedSiteIds(enabledSiteIds);
    }
  };

  // Auto-scroll log container when new messages arrive
  useEffect(() => {
    if (logContainerRef.current && scrapeLog.length > 0) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [scrapeLog]);

  const prevScrapeBrandRef = useRef<string | undefined>(undefined);
  const brandHydratedRef = useRef(false);
  // Default אתרים לפי חברה (רק כשהחברה במסנן משתנה): Yamaha → כלי זמר, Roland → חלילית
  // Skip first run so Jotai/localStorage hydrated site ids are not overwritten on mount.
  useEffect(() => {
    if (!brandHydratedRef.current) {
      brandHydratedRef.current = true;
      prevScrapeBrandRef.current = scrapeBrandFilter;
      return;
    }
    const brandChanged = prevScrapeBrandRef.current !== scrapeBrandFilter;
    prevScrapeBrandRef.current = scrapeBrandFilter;
    if (!brandChanged) return;
    const ids = getDefaultSiteIdsForBrand(scrapeBrandFilter, sites);
    if (ids.length > 0) {
      setSelectedSiteIds(withRequiredDiezIds(ids, sites, includeDiezDefault));
    }
  }, [
    scrapeBrandFilter,
    sites,
    setSelectedSiteIds,
    includeDiezDefault,
  ]);

  // דיאז נבחר אוטומטית רק כש"כלול דיאז כברירת מחדל" דלוק
  useEffect(() => {
    if (!includeDiezDefault) return;
    const diezId = getDiezSiteId(sites);
    if (!diezId) return;
    setSelectedSiteIds((prev) =>
      prev.includes(diezId) ? prev : [...prev, diezId],
    );
  }, [sites, setSelectedSiteIds, includeDiezDefault]);

  // נקה בחירת מוצרים שלא מופיעים ברשימה המסוננת
  useEffect(() => {
    const allowed = new Set(products.map((p) => p.id));
    setSelectedProductIds((prev) => prev.filter((id) => allowed.has(id)));
  }, [products, setSelectedProductIds]);

  // Close product dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const t = event.target as Node;
      if (
        productsDropdownRef.current &&
        !productsDropdownRef.current.contains(t)
      ) {
        setShowProductsDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (!showProductsDropdown) setProductDropdownSearch("");
  }, [showProductsDropdown]);

  return (
    <div dir="rtl" className="text-right">
      <h1 className="text-xl font-semibold mb-4 text-right">{APP_TITLE}</h1>

      {lastSearchStatus.updatedAt ? (
        <div
          className={`mb-4 rounded-lg border px-4 py-3 text-sm text-right ${
            lastSearchStatus.state === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-900"
              : lastSearchStatus.state === "error"
                ? "border-red-200 bg-red-50 text-red-900"
                : "border-gray-200 bg-gray-50 text-gray-800"
          }`}
        >
          <div className="flex flex-col gap-1 items-end">
            <div className="font-medium">
              {lastSearchStatus.state === "success"
                ? "✓ "
                : lastSearchStatus.state === "error"
                  ? "✗ "
                  : ""}
              {lastSearchStatus.summary}
            </div>
            {lastSearchStatus.scopeHint ? (
              <div className="text-sm font-medium text-gray-800 opacity-90">
                {lastSearchStatus.scopeHint}
              </div>
            ) : null}
            <div className="text-xs opacity-80">
              {lastSearchStatus.runType === "navigator"
                ? "Navigator"
                : lastSearchStatus.runType === "category_match"
                  ? "התאמת קטגוריה"
                  : ""}{" "}
              · {new Date(lastSearchStatus.updatedAt).toLocaleString("he-IL")}
            </div>
            {lastSearchStatus.detail ? (
              <div className="text-xs opacity-90 mt-1 max-w-full break-all">
                {lastSearchStatus.detail}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="mb-3 flex flex-wrap gap-3 justify-end"></div>

      <div className="mb-6 p-4 bg-white rounded-lg border border-gray-200 shadow-sm">
        <h2 className="text-sm font-semibold text-gray-700 mb-3 text-right">
          סינון ומיון
        </h2>
        <div className="flex flex-wrap gap-4 items-end justify-end">
          <div>
            <label className="block text-xs text-gray-500 mb-1 text-right">
              קטגוריה
            </label>
            <select
              value={categoryFilter}
              onChange={(e) => {
                setCategoryFilter(e.target.value);
              }}
              className="border rounded px-3 py-2 text-right min-w-[240px] w-full max-w-[min(28rem,100%)] sm:w-auto focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">כל הקטגוריות</option>
              {categories.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1 text-right">
              חברה
            </label>
            <select
              value={scrapeBrandFilter}
              onChange={(e) => {
                setScrapeBrandFilter(e.target.value);
                setShowProductsDropdown(false);
              }}
              className="border rounded px-3 py-2 text-right min-w-[240px] w-full max-w-[min(28rem,100%)] sm:w-auto focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">כל החברות</option>
              <option value="__none__">ללא חברה</option>
              {brands.map((br) => (
                <option key={br} value={br}>
                  {br}
                </option>
              ))}
            </select>
          </div>
          <div
            className="relative max-w-[min(52rem,calc(100vw-1rem))] w-full sm:w-auto sm:min-w-[min(52rem,calc(100vw-2rem))] shrink-0"
            ref={productsDropdownRef}
          >
            <label className="block text-xs text-gray-500 mb-1 text-right">
              מוצרים
            </label>
            <button
              type="button"
              onClick={() => setShowProductsDropdown((v) => !v)}
              className={`border rounded px-3 py-2 text-right w-full min-w-0 max-w-full focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white flex items-center justify-between gap-2 ${
                selectedProductIds.length > 0
                  ? "sm:min-w-[28rem]"
                  : "sm:min-w-[20rem]"
              }`}
            >
              <span className="min-w-0 truncate">
                {selectedProductIds.length === 0
                  ? "בחר מוצרים…"
                  : `${selectedProductIds.length} נבחרו`}
              </span>
              <span className="text-gray-400 text-sm shrink-0">
                {showProductsDropdown ? "▲" : "▼"}
              </span>
            </button>
            {showProductsDropdown && products.length > 0 && (
              <div className="absolute top-full mt-1 right-0 left-0 sm:left-auto sm:w-full max-w-[min(52rem,calc(100vw-1rem))] min-w-[min(100%,20rem)] bg-white border rounded-lg shadow-lg z-50 max-h-[28rem] flex flex-col min-w-0">
                <div className="p-2 border-b border-gray-100 flex justify-between items-center gap-2 flex-row-reverse flex-wrap">
                  <span className="text-xs text-gray-600">
                    {filteredProductsForDropdown.length === products.length
                      ? `${products.length} מוצרים`
                      : `${filteredProductsForDropdown.length} מתוך ${products.length} מוצרים`}
                  </span>
                  <button
                    type="button"
                    onClick={selectAllFilteredInDropdown}
                    disabled={filteredProductsForDropdown.length === 0}
                    className="text-xs px-2 py-1 rounded bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {filteredProductsForDropdown.length > 0 &&
                    filteredProductsForDropdown.every((p) =>
                      selectedProductIds.includes(p.id),
                    )
                      ? "בטל הכל (במסונן)"
                      : "בחר הכל (במסונן)"}
                  </button>
                </div>
                <div className="p-2 border-b border-gray-100">
                  <input
                    type="search"
                    dir="rtl"
                    placeholder="חפש במוצרים (שם, חברה, קטגוריה)…"
                    value={productDropdownSearch}
                    onChange={(e) => setProductDropdownSearch(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    className="w-full border rounded px-3 py-2 text-right text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div className="overflow-y-auto flex-1 p-1 min-h-0">
                  {filteredProductsForDropdown.length === 0 ? (
                    <p className="px-3 py-6 text-sm text-gray-500 text-center">
                      לא נמצאו מוצרים התואמים לחיפוש
                    </p>
                  ) : (
                    filteredProductsForDropdown.map((p) => (
                      <label
                        key={p.id}
                        className="flex gap-2 px-3 py-2 rounded hover:bg-gray-50 cursor-pointer text-right items-start flex-row-reverse"
                      >
                        <input
                          type="checkbox"
                          checked={selectedProductIds.includes(p.id)}
                          onChange={() => toggleProduct(p.id)}
                          className="w-4 h-4 text-indigo-600 rounded shrink-0 mt-1"
                        />
                        <div className="flex-1 min-w-0 space-y-0.5">
                          <span className="block font-medium text-sm whitespace-normal break-words">
                            {p.name}
                          </span>
                          {p.brand ? (
                            <span className="block text-xs text-gray-500 whitespace-normal break-words">
                              {p.brand}
                            </span>
                          ) : null}
                        </div>
                      </label>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-2 items-end justify-end">
            <div
              className="inline-block rounded-lg p-[2px] bg-gradient-to-r from-purple-600 via-pink-600 to-blue-600 shadow-lg hover:shadow-xl transition-all duration-200 transform hover:scale-105"
              style={{
                boxShadow:
                  "0 10px 25px -5px rgba(147, 51, 234, 0.4), 0 10px 10px -5px rgba(219, 39, 119, 0.3), 0 10px 15px -3px rgba(37, 99, 235, 0.3)",
              }}
            >
              <button
                type="button"
                onClick={runScrape}
                disabled={
                  scrapeMutation.isPending ||
                  isStreaming ||
                  sites.length === 0 ||
                  selectedSiteIds.length === 0 ||
                  selectedProductIds.length === 0
                }
                className="px-6 py-3 bg-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 font-semibold transition-all duration-200 w-full"
              >
                {isStreaming ? (
                  <svg
                    className="animate-spin h-5 w-5"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    style={{ stroke: "url(#gradient)" }}
                  >
                    <defs>
                      <linearGradient
                        id="gradient"
                        x1="0%"
                        y1="0%"
                        x2="100%"
                        y2="0%"
                      >
                        <stop
                          offset="0%"
                          style={{ stopColor: "#9333ea", stopOpacity: 1 }}
                        />
                        <stop
                          offset="50%"
                          style={{ stopColor: "#db2777", stopOpacity: 1 }}
                        />
                        <stop
                          offset="100%"
                          style={{ stopColor: "#2563eb", stopOpacity: 1 }}
                        />
                      </linearGradient>
                    </defs>
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="url(#gradient)"
                      strokeWidth="4"
                    ></circle>
                    <path
                      className="opacity-75"
                      fill="url(#gradient)"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    ></path>
                  </svg>
                ) : (
                  <svg
                    className="h-5 w-5"
                    fill="none"
                    viewBox="0 0 24 24"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <defs>
                      <linearGradient
                        id="starGradient"
                        x1="0%"
                        y1="0%"
                        x2="100%"
                        y2="0%"
                      >
                        <stop
                          offset="0%"
                          style={{ stopColor: "#9333ea", stopOpacity: 1 }}
                        />
                        <stop
                          offset="50%"
                          style={{ stopColor: "#db2777", stopOpacity: 1 }}
                        />
                        <stop
                          offset="100%"
                          style={{ stopColor: "#2563eb", stopOpacity: 1 }}
                        />
                      </linearGradient>
                    </defs>
                    <path
                      fill="url(#starGradient)"
                      d="M12 2L9.09 8.26L2 9.27L7 14.14L5.18 21.02L12 17.77L18.82 21.02L17 14.14L22 9.27L14.91 8.26L12 2Z"
                    />
                  </svg>
                )}
                <span className="bg-gradient-to-r from-purple-600 via-pink-600 to-blue-600 bg-clip-text text-transparent">
                  {scrapeMutation.isPending || isStreaming
                    ? "משווה מחירים..."
                    : "השווה מחירים"}
                </span>
              </button>
            </div>
          </div>
        </div>
      </div>
      {(sites.length === 0 || selectedSiteIds.length === 0) && (
        <p className="text-sm text-amber-800 text-right mb-3 px-1">
          {sites.length === 0
            ? "טוען אתרים… או שאין אתרים מוגדרים. כפתור ההשוואה יופעל לאחר טעינה ובחירת אתר."
            : "יש לסמן לפחות אתר אחד — ההשוואה לא תרוץ על כל האתרים ללא בחירה."}
        </p>
      )}

      {sites.length > 0 && (
        <div className="mb-4 p-3 bg-blue-50 rounded-lg border border-blue-200 text-right">
          <label className="flex items-center gap-2 justify-end mb-3 cursor-pointer select-none flex-row-reverse">
            <span className="text-sm font-medium text-gray-800">
              כלול דיאז כברירת מחדל בהשוואה
            </span>
            <input
              type="checkbox"
              checked={includeDiezDefault}
              onChange={(e) => setIncludeDiezDefault(e.target.checked)}
              className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
            />
          </label>
          <p className="text-xs text-gray-600 mb-3">
            כבוי: דיאז לא נוסף אוטומטית לבחירה ולא נשלח בשרת אלא אם סימנת אותו
            ידנית. דלוק: דיאז נשאר מסומן ונכלל בכל השוואה (כמו קודם).
          </p>
          <div className="flex items-center justify-between mb-2 flex-row-reverse">
            <div className="text-sm text-gray-700 font-medium space-y-1">
              <p>
                חובה לבחור לפחות אתר אחד — ההשוואה לא רצה על כל האתרים אוטומטית.
              </p>
              <p className="text-xs font-normal text-indigo-800">
                {includeDiezDefault
                  ? "דיאז מסומן כברירת מחדל ולא ניתן לבטל — בשרת הוא נכלל אם לא בחרת אחרת; ב-Navigator דילוג על דיאז רק כשכבר יש תוצאה מאותו מוצר מאותו יום (UTC)."
                  : "דיאז לא נכלל אלא אם סימנת אותו. ב-Navigator דילוג על דיאז רק כשכבר יש תוצאה מאותו מוצר מאותו יום (UTC) כשדיאז בכלל נבחר."}
              </p>
            </div>
            <button
              onClick={selectAllSites}
              className="px-4 py-2 bg-gradient-to-r from-indigo-500 to-purple-600 text-white text-sm rounded-lg hover:from-indigo-600 hover:to-purple-700 transition-all duration-200 shadow-md hover:shadow-lg transform hover:scale-105 flex items-center gap-2 font-medium"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              {selectedSiteIds.length === sites.filter((s) => s.enabled).length
                ? "בטל הכל"
                : "בחר הכל"}
            </button>
          </div>
          <div className="flex flex-wrap gap-2 justify-end">
            {sites
              .filter((s) => s.enabled)
              .map((site) => {
                const lockedDiez =
                  isDiezConfiguredSite(site) && includeDiezDefault;
                return (
                  <label
                    key={site.id}
                    className={`flex items-center gap-1.5 text-sm px-2 py-1 rounded-md transition-colors ${
                      lockedDiez
                        ? "cursor-not-allowed bg-slate-100 border border-slate-200"
                        : "hover:bg-blue-100 cursor-pointer"
                    }`}
                    title={
                      lockedDiez
                        ? "דיאז — נדרש כשברירת המחדל דלוקה, לא ניתן לבטל"
                        : undefined
                    }
                  >
                    <input
                      type="checkbox"
                      disabled={lockedDiez}
                      checked={selectedSiteIds.includes(site.id)}
                      onChange={() => {
                        if (lockedDiez) return;
                        setSelectedSiteIds((prev) =>
                          prev.includes(site.id)
                            ? prev.filter((id) => id !== site.id)
                            : [...prev, site.id],
                        );
                      }}
                      className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500 disabled:opacity-70 disabled:cursor-not-allowed"
                    />
                    <span className="font-medium">{site.name}</span>
                    {lockedDiez ? (
                      <span className="text-[10px] text-slate-500 font-normal">
                        (חובה)
                      </span>
                    ) : null}
                  </label>
                );
              })}
          </div>
        </div>
      )}

      <p className="mb-3 text-sm text-gray-600 text-right">
        {selectedProductIds.length > 0 ? (
          <>
            נבחרו <strong>{selectedProductIds.length}</strong> מוצרים — לחצו
            &quot;השווה מחירים&quot; ל-Navigator. אפשר לצמצם את הרשימה בסינון
            קטגוריה/חברה למעלה.
          </>
        ) : (
          <>
            בחרו מוצרים מהרשימה (אחרי סינון קטגוריה/חברה לפי הצורך) ואז לחצו
            &quot;השווה מחירים&quot;.
          </>
        )}
      </p>

      {(isStreaming || scrapeLog.length > 0) && (
        <div className="mb-6 p-4 bg-gradient-to-br from-blue-900 to-indigo-900 text-white rounded-lg shadow-lg text-right">
          <div className="flex items-center gap-2 mb-3 flex-row-reverse">
            {isStreaming && (
              <div className="flex gap-1">
                <div
                  className="w-2 h-2 bg-blue-400 rounded-full animate-bounce"
                  style={{ animationDelay: "0ms" }}
                ></div>
                <div
                  className="w-2 h-2 bg-blue-400 rounded-full animate-bounce"
                  style={{ animationDelay: "150ms" }}
                ></div>
                <div
                  className="w-2 h-2 bg-blue-400 rounded-full animate-bounce"
                  style={{ animationDelay: "300ms" }}
                ></div>
              </div>
            )}
            <h3 className="font-semibold text-lg">סטטוס השוואה חי</h3>
          </div>
          <div
            ref={logContainerRef}
            className="bg-black/30 rounded p-3 font-mono text-sm max-h-64 overflow-y-auto"
          >
            {scrapeLog.length === 0 ? (
              <div className="text-gray-400">מתחיל השוואה...</div>
            ) : (
              scrapeLog.map((log, i) => (
                <div
                  key={i}
                  className={`py-1 px-2 rounded mb-1 ${
                    log.type === "error"
                      ? "bg-red-900/50 text-red-200"
                      : log.type === "done"
                        ? "bg-green-900/50 text-green-200 font-semibold"
                        : "text-gray-200"
                  }`}
                >
                  <span className="text-gray-400 text-xs">
                    {new Date(log.timestamp).toLocaleTimeString()}
                  </span>{" "}
                  {log.message}
                </div>
              ))
            )}
          </div>

          {/* LLM Prompt & Response visibility */}
          {(lastLlmPrompt || lastLlmResponse) && (
            <div className="mt-4 border-t border-white/20 pt-4">
              <button
                onClick={() => setShowLlmDebug(!showLlmDebug)}
                className="flex items-center gap-2 text-sm text-blue-200 hover:text-blue-100 mb-2"
              >
                {showLlmDebug ? "▼" : "▶"} צפה בפרומפט ותשובת LLM
              </button>
              {showLlmDebug && (
                <div className="space-y-3 text-right">
                  {lastLlmPrompt && (
                    <div>
                      <div className="text-xs text-blue-200 font-semibold mb-1">
                        פרומפט שנשלח:
                      </div>
                      <pre className="bg-black/40 rounded p-3 text-xs font-mono overflow-x-auto max-h-48 overflow-y-auto whitespace-pre-wrap break-words text-right">
                        {lastLlmPrompt.prompt}
                      </pre>
                    </div>
                  )}
                  {lastLlmResponse && (
                    <div>
                      <div className="text-xs text-green-200 font-semibold mb-1">
                        תשובה שנשלחה:
                      </div>
                      <pre className="bg-black/40 rounded p-3 text-xs font-mono overflow-x-auto max-h-48 overflow-y-auto whitespace-pre-wrap break-words text-right">
                        {typeof lastLlmResponse.rawResponse === "string"
                          ? lastLlmResponse.rawResponse
                          : JSON.stringify(
                              lastLlmResponse.parsedResult,
                              null,
                              2,
                            )}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div className="p-4 bg-white rounded-lg border border-gray-200 shadow-sm">
        <h2 className="text-lg font-medium mb-2 text-right">השוואת מחירים</h2>
        {resultsLoading || lowestLoading ? (
          <div className="flex items-center gap-2 text-gray-500 justify-end">
            <svg
              className="animate-spin h-5 w-5"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              ></circle>
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              ></path>
            </svg>
            טוען...
          </div>
        ) : results.length === 0 ? (
          <p className="text-gray-500 text-right">
            אין תוצאות עדיין. השווה מחירים כדי לראות תוצאות.
          </p>
        ) : (
          <p className="text-gray-600 text-right mb-3">
            יש {results.length} תוצאות. צפה בטבלת ההשוואה המלאה עם סינון, מיון
            ועימוד.
          </p>
        )}
        <Link
          to="/results"
          className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-indigo-500 to-purple-600 text-white rounded-lg hover:from-indigo-600 hover:to-purple-700 font-medium transition-all"
        >
          צפה בטבלת תוצאות מלאה
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 5l7 7-7 7"
            />
          </svg>
        </Link>
      </div>
    </div>
  );
}
