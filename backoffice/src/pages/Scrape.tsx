import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, API_BASE, type CategoryMatchResult } from "../api/client";
import { useState, useRef, useEffect } from "react";
import { Link } from "react-router-dom";
import { toHrefUrl } from "../utils/url";

export default function Scrape() {
  const queryClient = useQueryClient();
  const [categoryFilter, setCategoryFilter] = useState<string>("");
  const [categorySearch, setCategorySearch] = useState<string>("");
  const [showCategoryDropdown, setShowCategoryDropdown] = useState(false);
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
  const [selectedSiteIds, setSelectedSiteIds] = useState<string[]>([]);
  const [scrapeLog, setScrapeLog] = useState<
    Array<{ type: string; message: string; timestamp: number }>
  >([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [categoryMatchResult, setCategoryMatchResult] =
    useState<CategoryMatchResult | null>(null);
  const [isMatchingCategory, setIsMatchingCategory] = useState(false);
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
  const [scrapeMode, setScrapeMode] = useState<
    "scraper" | "llm_websearch" | "navigator"
  >("scraper");
  const eventSourceRef = useRef<EventSource | null>(null);
  const logContainerRef = useRef<HTMLDivElement>(null);
  const categoryDropdownRef = useRef<HTMLDivElement>(null);

  const { data: categories = [] } = useQuery({
    queryKey: ["categories"],
    queryFn: () => api.categories(),
  });

  const { data: sites = [] } = useQuery({
    queryKey: ["sites"],
    queryFn: () => api.sites.list(),
  });

  const { data: products = [] } = useQuery({
    queryKey: ["products", categoryFilter],
    queryFn: () =>
      api.products.list(categoryFilter ? { category: categoryFilter } : {}),
  });

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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["scrape-results"] });
      queryClient.invalidateQueries({ queryKey: ["scrape-lowest"] });
    },
    onError: () => {
      setIsStreaming(false);
    },
  });

  const runScrape = () => {
    // If category is selected, run category match instead
    if (categoryFilter) {
      handleMatchCategory();
      return;
    }

    // Otherwise run regular scrape
    const body: {
      productIds?: string[];
      category?: string;
      siteIds?: string[];
      mode?: "scraper" | "llm_websearch" | "navigator";
    } = selectedProductIds.length > 0 ? { productIds: selectedProductIds } : {};

    if (selectedSiteIds.length > 0) {
      body.siteIds = selectedSiteIds;
    }
    body.mode = scrapeMode;

    scrapeMutation.mutate(Object.keys(body).length > 0 ? body : {});
  };

  const toggleProduct = (id: string) => {
    setSelectedProductIds((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id],
    );
  };

  const selectAllInCategory = () => {
    const allProductIds = products.map((p) => p.id);
    if (selectedProductIds.length === allProductIds.length) {
      // Deselect all if all are selected
      setSelectedProductIds([]);
    } else {
      // Select all products in current filter
      setSelectedProductIds(allProductIds);
    }
  };

  const selectAllSites = () => {
    const enabledSiteIds = sites.filter((s) => s.enabled).map((s) => s.id);
    if (selectedSiteIds.length === enabledSiteIds.length) {
      // Deselect all if all are selected
      setSelectedSiteIds([]);
    } else {
      // Select all enabled sites
      setSelectedSiteIds(enabledSiteIds);
    }
  };

  // Auto-scroll log container when new messages arrive
  useEffect(() => {
    if (logContainerRef.current && scrapeLog.length > 0) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [scrapeLog]);

  // Close category dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        categoryDropdownRef.current &&
        !categoryDropdownRef.current.contains(event.target as Node)
      ) {
        setShowCategoryDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Filter categories based on search
  const filteredCategories = categories.filter((cat) =>
    cat.toLowerCase().includes(categorySearch.toLowerCase()),
  );

  const matchCategoryMutation = useMutation({
    mutationFn: async (category: string) => {
      setIsMatchingCategory(true);
      setCategoryMatchResult(null);
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
        console.log("EventSource connection opened for category match");
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
        const result = await api.scrape.matchCategory({
          category,
          siteIds: selectedSiteIds.length > 0 ? selectedSiteIds : undefined,
        });
        setCategoryMatchResult(result);
        setIsStreaming(false);
        es.close();
        eventSourceRef.current = null;
        return result;
      } catch (err) {
        setIsStreaming(false);
        es.close();
        eventSourceRef.current = null;
        throw err;
      } finally {
        setIsMatchingCategory(false);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["scrape-results"] });
      queryClient.invalidateQueries({ queryKey: ["scrape-lowest"] });
      queryClient.invalidateQueries({ queryKey: ["products"] });
    },
  });

  const handleMatchCategory = () => {
    if (categoryFilter) {
      matchCategoryMutation.mutate(categoryFilter);
    }
  };

  return (
    <div dir="rtl" className="text-right">
      <h1 className="text-xl font-semibold mb-4 text-right">השוואת מחירים</h1>

      <div className="flex flex-wrap gap-4 mb-4 justify-end items-center">
        {!categoryFilter && (
          <div className="flex rounded-lg border border-gray-200 overflow-hidden bg-gray-50">
            <button
              type="button"
              onClick={() => setScrapeMode("scraper")}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                scrapeMode === "scraper"
                  ? "bg-white text-blue-600 shadow-sm"
                  : "text-gray-600 hover:text-gray-800"
              }`}
            >
              גריפה + LLM
            </button>
            <button
              type="button"
              onClick={() => setScrapeMode("llm_websearch")}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                scrapeMode === "llm_websearch"
                  ? "bg-white text-blue-600 shadow-sm"
                  : "text-gray-600 hover:text-gray-800"
              }`}
            >
              LLM + חיפוש אינטרנט
            </button>
            <button
              type="button"
              onClick={() => setScrapeMode("navigator")}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                scrapeMode === "navigator"
                  ? "bg-white text-blue-600 shadow-sm"
                  : "text-gray-600 hover:text-gray-800"
              }`}
            >
              Navigator (סוכן)
            </button>
          </div>
        )}
        <div className="relative" ref={categoryDropdownRef}>
          <div className="flex items-center gap-2">
            <div className="relative">
              <input
                type="text"
                placeholder="חפש קטגוריה..."
                value={categorySearch}
                onChange={(e) => {
                  setCategorySearch(e.target.value);
                  setShowCategoryDropdown(true);
                }}
                onFocus={() => setShowCategoryDropdown(true)}
                className="border rounded px-3 py-2 pr-10 text-right min-w-[200px] focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <svg
                className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
            </div>
            {categoryFilter && (
              <div className="flex items-center gap-2 bg-blue-100 text-blue-800 px-3 py-1 rounded-full">
                <span className="text-sm font-medium">{categoryFilter}</span>
                <button
                  onClick={() => {
                    setCategoryFilter("");
                    setCategorySearch("");
                    setSelectedProductIds([]);
                  }}
                  className="text-blue-600 hover:text-blue-800"
                >
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
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              </div>
            )}
          </div>
          {showCategoryDropdown && (
            <div className="absolute top-full mt-1 bg-white border rounded-lg shadow-lg z-50 max-h-60 overflow-y-auto min-w-[200px] right-0">
              <div className="p-2">
                <button
                  onClick={() => {
                    setCategoryFilter("");
                    setCategorySearch("");
                    setShowCategoryDropdown(false);
                    setSelectedProductIds([]);
                    setCategoryMatchResult(null); // Clear match results when clearing category
                  }}
                  className={`w-full text-right px-3 py-2 rounded hover:bg-gray-100 transition-colors ${
                    categoryFilter === ""
                      ? "bg-blue-50 text-blue-700 font-medium"
                      : ""
                  }`}
                >
                  כל הקטגוריות
                </button>
                {filteredCategories.length > 0 ? (
                  filteredCategories.map((cat) => (
                    <button
                      key={cat}
                      onClick={() => {
                        setCategoryFilter(cat);
                        setCategorySearch(cat);
                        setShowCategoryDropdown(false);
                        setSelectedProductIds([]); // Clear product selection when category is selected
                        setCategoryMatchResult(null); // Clear previous match results
                      }}
                      className={`w-full text-right px-3 py-2 rounded hover:bg-gray-100 transition-colors ${
                        categoryFilter === cat
                          ? "bg-blue-50 text-blue-700 font-medium"
                          : ""
                      }`}
                    >
                      {cat}
                    </button>
                  ))
                ) : (
                  <div className="px-3 py-2 text-gray-500 text-sm text-right">
                    לא נמצאו קטגוריות
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
        <div
          className="inline-block rounded-lg p-[2px] bg-gradient-to-r from-purple-600 via-pink-600 to-blue-600 shadow-lg hover:shadow-xl transition-all duration-200 transform hover:scale-105"
          style={{
            boxShadow:
              "0 10px 25px -5px rgba(147, 51, 234, 0.4), 0 10px 10px -5px rgba(219, 39, 119, 0.3), 0 10px 15px -3px rgba(37, 99, 235, 0.3)",
          }}
        >
          <button
            onClick={runScrape}
            disabled={
              scrapeMutation.isPending ||
              isStreaming ||
              isMatchingCategory ||
              (!categoryFilter && selectedProductIds.length === 0)
            }
            className="px-6 py-3 bg-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 font-semibold transition-all duration-200 w-full"
          >
            {isStreaming || isMatchingCategory ? (
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
              {isMatchingCategory
                ? "מתאים מוצרים..."
                : scrapeMutation.isPending || isStreaming
                  ? "משווה מחירים..."
                  : categoryFilter
                    ? "התאם מוצרים בקטגוריה"
                    : "השווה מחירים"}
            </span>
          </button>
        </div>
      </div>

      {sites.length > 0 && (
        <div className="mb-4 p-3 bg-blue-50 rounded-lg border border-blue-200 text-right">
          <div className="flex items-center justify-between mb-2 flex-row-reverse">
            <p className="text-sm text-gray-700 font-medium">
              בחר אתרים להשוואה (אופציונלי - כל האתרים הפעילים ישמשו אם לא
              נבחרו):
            </p>
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
              .map((site) => (
                <label
                  key={site.id}
                  className="flex items-center gap-1.5 text-sm px-2 py-1 rounded-md hover:bg-blue-100 transition-colors cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={selectedSiteIds.includes(site.id)}
                    onChange={() =>
                      setSelectedSiteIds((prev) =>
                        prev.includes(site.id)
                          ? prev.filter((id) => id !== site.id)
                          : [...prev, site.id],
                      )
                    }
                    className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                  />
                  <span className="font-medium">{site.name}</span>
                </label>
              ))}
          </div>
        </div>
      )}

      <div className="mb-4 p-3 bg-gradient-to-r from-gray-50 to-gray-100 rounded-lg border border-gray-200 shadow-sm text-right">
        <div className="flex items-center justify-between mb-3 flex-row-reverse">
          <p className="text-sm text-gray-700 font-medium">
            {categoryFilter
              ? `קטגוריה נבחרה: "${categoryFilter}" - בחירת מוצרים ספציפיים מושבתת`
              : selectedProductIds.length > 0
                ? `משווה ${selectedProductIds.length} מוצר(ים) נבחר(ים)`
                : "בחר מוצרים או קטגוריה להשוואה"}
          </p>
          {products.length > 0 && (
            <button
              onClick={selectAllInCategory}
              disabled={!!categoryFilter}
              className="px-4 py-2 bg-gradient-to-r from-indigo-500 to-purple-600 text-white text-sm rounded-lg hover:from-indigo-600 hover:to-purple-700 transition-all duration-200 shadow-md hover:shadow-lg transform hover:scale-105 flex items-center gap-2 font-medium disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
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
              {selectedProductIds.length === products.length
                ? "בטל הכל"
                : "בחר הכל בקטגוריה"}
            </button>
          )}
        </div>
        {products.length > 0 && (
          <div className="flex flex-wrap gap-2 justify-end">
            {products.map((p) => (
              <label
                key={p.id}
                className={`flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md transition-colors border border-gray-200 hover:border-indigo-300 hover:shadow-sm ${
                  categoryFilter
                    ? "opacity-50 cursor-not-allowed bg-gray-100"
                    : "hover:bg-white cursor-pointer"
                }`}
              >
                <input
                  type="checkbox"
                  checked={selectedProductIds.includes(p.id)}
                  onChange={() => toggleProduct(p.id)}
                  disabled={!!categoryFilter}
                  className="w-4 h-4 text-indigo-600 rounded focus:ring-indigo-500 disabled:cursor-not-allowed"
                />
                <span className="font-medium">{p.name}</span>
              </label>
            ))}
          </div>
        )}
      </div>

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

      {/* Category Match Results Section */}
      {categoryFilter && categoryMatchResult && (
        <div className="mb-6 p-4 bg-gradient-to-r from-purple-50 to-blue-50 rounded-lg border border-purple-200">
          <div className="flex items-center justify-between mb-3 flex-row-reverse">
            <div>
              <h2 className="text-lg font-semibold mb-1 text-right">
                תוצאות התאמת מוצרים בקטגוריה
              </h2>
              <p className="text-sm text-gray-600 text-right">
                מוצרים זהים שנמצאו בחנויות שונות
              </p>
            </div>
          </div>

          {categoryMatchResult && (
            <div className="mt-4 space-y-4">
              {categoryMatchResult.comparison.length > 0 && (
                <div>
                  <h3 className="text-md font-semibold mb-3 text-right">
                    מוצרים משותפים (נמצאו ב-2+ חנויות)
                  </h3>
                  <div className="space-y-3">
                    {categoryMatchResult.comparison.map((product, idx) => {
                      const lowestPrice = Math.min(
                        ...product.prices.map((p) => p.price),
                      );
                      const highestPrice = Math.max(
                        ...product.prices.map((p) => p.price),
                      );

                      return (
                        <div
                          key={idx}
                          className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm"
                        >
                          <div className="flex items-start justify-between flex-row-reverse mb-3">
                            <div>
                              <h4 className="font-semibold text-lg text-right">
                                {product.model}
                              </h4>
                              {product.common_features && (
                                <p className="text-sm text-gray-600 mt-1 text-right">
                                  {product.common_features}
                                </p>
                              )}
                            </div>
                            <div className="text-left">
                              <div className="text-sm text-gray-500">
                                מחיר נמוך ביותר
                              </div>
                              <div className="text-xl font-bold text-green-600">
                                ₪{lowestPrice.toLocaleString()}
                              </div>
                            </div>
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                            {product.prices.map((price, priceIdx) => {
                              const isLowest = price.price === lowestPrice;
                              const isHighest =
                                price.price === highestPrice &&
                                lowestPrice !== highestPrice;

                              return (
                                <div
                                  key={priceIdx}
                                  className={`p-3 rounded border ${
                                    isLowest
                                      ? "bg-green-50 border-green-300"
                                      : isHighest
                                        ? "bg-red-50 border-red-300"
                                        : "bg-gray-50 border-gray-200"
                                  }`}
                                >
                                  <div className="flex items-center justify-between mb-1">
                                    <span
                                      className={`font-medium text-sm ${isLowest ? "text-green-700" : isHighest ? "text-red-700" : "text-gray-700"}`}
                                    >
                                      {price.site}
                                    </span>
                                    {isLowest && (
                                      <span className="text-xs bg-green-600 text-white px-2 py-0.5 rounded">
                                        הכי זול
                                      </span>
                                    )}
                                  </div>
                                  <div
                                    className={`text-lg font-semibold ${isLowest ? "text-green-700" : isHighest ? "text-red-700" : "text-gray-900"}`}
                                  >
                                    ₪{price.price.toLocaleString()}
                                  </div>
                                  <a
                                    href={toHrefUrl(price.url)}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-xs text-blue-600 hover:underline mt-1 block"
                                  >
                                    צפה במוצר →
                                  </a>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {categoryMatchResult.unmatched_highlights &&
                categoryMatchResult.unmatched_highlights.length > 0 && (
                  <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                    <h3 className="text-md font-semibold mb-2 text-right">
                      מוצרים ייחודיים (נמצאו בחנות אחת בלבד)
                    </h3>
                    <ul className="list-disc list-inside space-y-1 text-right">
                      {categoryMatchResult.unmatched_highlights.map(
                        (highlight, idx) => (
                          <li key={idx} className="text-sm text-gray-700">
                            {highlight}
                          </li>
                        ),
                      )}
                    </ul>
                  </div>
                )}

              {categoryMatchResult.comparison.length === 0 &&
                (!categoryMatchResult.unmatched_highlights ||
                  categoryMatchResult.unmatched_highlights.length === 0) && (
                  <div className="text-center py-8 text-gray-500">
                    לא נמצאו מוצרים משותפים בקטגוריה זו
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
