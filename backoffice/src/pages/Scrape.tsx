import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { useState, useRef, useEffect } from "react";

export default function Scrape() {
  const queryClient = useQueryClient();
  const [categoryFilter, setCategoryFilter] = useState<string>("");
  const [categorySearch, setCategorySearch] = useState<string>("");
  const [showCategoryDropdown, setShowCategoryDropdown] = useState(false);
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
  const [selectedSiteIds, setSelectedSiteIds] = useState<string[]>([]);
  const [scrapeLog, setScrapeLog] = useState<Array<{ type: string; message: string; timestamp: number }>>([]);
  const [isStreaming, setIsStreaming] = useState(false);
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
    mutationFn: async (body: { productIds?: string[]; category?: string; siteIds?: string[] } = {}) => {
      setScrapeLog([]);
      setIsStreaming(true);
      
      const streamUrl = "/api/scrape/stream";
      const es = new EventSource(streamUrl);
      eventSourceRef.current = es;
      
      es.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          setScrapeLog((prev) => {
            const newLog = [
              ...prev,
              {
                type: data.type || "status",
                message: data.message || "",
                timestamp: Date.now(),
              },
            ];
            // Auto-scroll to bottom
            setTimeout(() => {
              if (logContainerRef.current) {
                logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
              }
            }, 10);
            return newLog;
          });
        } catch {}
      };
      
      es.onerror = () => {
        setIsStreaming(false);
        es.close();
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
    const body: { productIds?: string[]; category?: string; siteIds?: string[] } =
      selectedProductIds.length > 0
        ? { productIds: selectedProductIds }
        : categoryFilter
          ? { category: categoryFilter }
          : {};
    
    if (selectedSiteIds.length > 0) {
      body.siteIds = selectedSiteIds;
    }
    
    scrapeMutation.mutate(Object.keys(body).length > 0 ? body : {});
  };

  const toggleProduct = (id: string) => {
    setSelectedProductIds((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]
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
      if (categoryDropdownRef.current && !categoryDropdownRef.current.contains(event.target as Node)) {
        setShowCategoryDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Filter categories based on search
  const filteredCategories = categories.filter((cat) =>
    cat.toLowerCase().includes(categorySearch.toLowerCase())
  );

  return (
    <div dir="rtl" className="text-right">
      <h1 className="text-xl font-semibold mb-4 text-right">השוואת מחירים</h1>

      <div className="flex flex-wrap gap-4 mb-4 justify-end items-center">
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
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
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
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
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
                  }}
                  className={`w-full text-right px-3 py-2 rounded hover:bg-gray-100 transition-colors ${
                    categoryFilter === "" ? "bg-blue-50 text-blue-700 font-medium" : ""
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
                        setSelectedProductIds([]);
                      }}
                      className={`w-full text-right px-3 py-2 rounded hover:bg-gray-100 transition-colors ${
                        categoryFilter === cat ? "bg-blue-50 text-blue-700 font-medium" : ""
                      }`}
                    >
                      {cat}
                    </button>
                  ))
                ) : (
                  <div className="px-3 py-2 text-gray-500 text-sm text-right">לא נמצאו קטגוריות</div>
                )}
              </div>
            </div>
          )}
        </div>
        <div 
          className="inline-block rounded-lg p-[2px] bg-gradient-to-r from-purple-600 via-pink-600 to-blue-600 shadow-lg hover:shadow-xl transition-all duration-200 transform hover:scale-105"
          style={{
            boxShadow: "0 10px 25px -5px rgba(147, 51, 234, 0.4), 0 10px 10px -5px rgba(219, 39, 119, 0.3), 0 10px 15px -3px rgba(37, 99, 235, 0.3)"
          }}
        >
          <button
            onClick={runScrape}
            disabled={scrapeMutation.isPending || isStreaming}
            className="px-6 py-3 bg-white rounded-lg disabled:opacity-50 flex items-center gap-2 font-semibold transition-all duration-200 w-full"
          >
            {isStreaming ? (
              <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" style={{ stroke: "url(#gradient)" }}>
                <defs>
                  <linearGradient id="gradient" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" style={{ stopColor: "#9333ea", stopOpacity: 1 }} />
                    <stop offset="50%" style={{ stopColor: "#db2777", stopOpacity: 1 }} />
                    <stop offset="100%" style={{ stopColor: "#2563eb", stopOpacity: 1 }} />
                  </linearGradient>
                </defs>
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="url(#gradient)" strokeWidth="4"></circle>
                <path className="opacity-75" fill="url(#gradient)" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
            ) : (
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <defs>
                  <linearGradient id="starGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" style={{ stopColor: "#9333ea", stopOpacity: 1 }} />
                    <stop offset="50%" style={{ stopColor: "#db2777", stopOpacity: 1 }} />
                    <stop offset="100%" style={{ stopColor: "#2563eb", stopOpacity: 1 }} />
                  </linearGradient>
                </defs>
                <path fill="url(#starGradient)" d="M12 2L9.09 8.26L2 9.27L7 14.14L5.18 21.02L12 17.77L18.82 21.02L17 14.14L22 9.27L14.91 8.26L12 2Z" />
              </svg>
            )}
            <span className="bg-gradient-to-r from-purple-600 via-pink-600 to-blue-600 bg-clip-text text-transparent">
              {scrapeMutation.isPending || isStreaming ? "משווה מחירים..." : "השווה מחירים"}
            </span>
          </button>
        </div>
      </div>

      {sites.length > 0 && (
        <div className="mb-4 p-3 bg-blue-50 rounded-lg border border-blue-200 text-right">
          <div className="flex items-center justify-between mb-2 flex-row-reverse">
            <p className="text-sm text-gray-700 font-medium">בחר אתרים להשוואה (אופציונלי - כל האתרים הפעילים ישמשו אם לא נבחרו):</p>
            <button
              onClick={selectAllSites}
              className="px-4 py-2 bg-gradient-to-r from-indigo-500 to-purple-600 text-white text-sm rounded-lg hover:from-indigo-600 hover:to-purple-700 transition-all duration-200 shadow-md hover:shadow-lg transform hover:scale-105 flex items-center gap-2 font-medium"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {selectedSiteIds.length === sites.filter((s) => s.enabled).length ? "בטל הכל" : "בחר הכל"}
            </button>
          </div>
          <div className="flex flex-wrap gap-2 justify-end">
            {sites.filter((s) => s.enabled).map((site) => (
              <label key={site.id} className="flex items-center gap-1.5 text-sm px-2 py-1 rounded-md hover:bg-blue-100 transition-colors cursor-pointer">
                <input
                  type="checkbox"
                  checked={selectedSiteIds.includes(site.id)}
                  onChange={() =>
                    setSelectedSiteIds((prev) =>
                      prev.includes(site.id)
                        ? prev.filter((id) => id !== site.id)
                        : [...prev, site.id]
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
            {selectedProductIds.length > 0
              ? `משווה ${selectedProductIds.length} מוצר(ים) נבחר(ים)`
              : categoryFilter
                ? `משווה את כל המוצרים בקטגוריה "${categoryFilter}"`
                : "משווה את כל המוצרים בכל הקטגוריות"}
          </p>
          {products.length > 0 && (
            <button
              onClick={selectAllInCategory}
              className="px-4 py-2 bg-gradient-to-r from-indigo-500 to-purple-600 text-white text-sm rounded-lg hover:from-indigo-600 hover:to-purple-700 transition-all duration-200 shadow-md hover:shadow-lg transform hover:scale-105 flex items-center gap-2 font-medium"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {selectedProductIds.length === products.length ? "בטל הכל" : "בחר הכל בקטגוריה"}
            </button>
          )}
        </div>
        {products.length > 0 && (
          <div className="flex flex-wrap gap-2 justify-end">
            {products.map((p) => (
              <label key={p.id} className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md hover:bg-white transition-colors cursor-pointer border border-gray-200 hover:border-indigo-300 hover:shadow-sm">
                <input
                  type="checkbox"
                  checked={selectedProductIds.includes(p.id)}
                  onChange={() => toggleProduct(p.id)}
                  className="w-4 h-4 text-indigo-600 rounded focus:ring-indigo-500"
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
                <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }}></div>
                <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }}></div>
                <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }}></div>
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
        </div>
      )}

      <h2 className="text-lg font-medium mb-2 text-right">השוואת מחירים</h2>
      {resultsLoading || lowestLoading ? (
        <div className="flex items-center gap-2 text-gray-500 justify-end">
          <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          טוען...
        </div>
      ) : results.length === 0 ? (
        <p className="text-gray-500 text-right">אין תוצאות עדיין. השווה מחירים כדי לראות תוצאות.</p>
      ) : (
        (() => {
          // Group results by product
          const productsMap = new Map<string, { product: typeof products[0]; results: typeof results }>();
          const enabledSites = sites.filter((s) => s.enabled);
          
          for (const result of results) {
            const product = products.find((p) => p.id === result.productId);
            if (!product) continue;
            
            if (!productsMap.has(product.id)) {
              productsMap.set(product.id, { product, results: [] });
            }
            productsMap.get(product.id)!.results.push(result);
          }

          // Calculate min/max prices per product for color coding
          const productPriceRanges = new Map<string, { min: number; max: number }>();
          productsMap.forEach(({ results: productResults }, productId) => {
            const prices = productResults.map((r) => r.price).filter((p) => p > 0);
            if (prices.length > 0) {
              productPriceRanges.set(productId, {
                min: Math.min(...prices),
                max: Math.max(...prices),
              });
            }
          });

          return (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse border border-gray-200 mb-6 text-right">
                <thead>
                  <tr className="bg-gray-100">
                    <th className="border p-2 text-right sticky right-0 bg-gray-100 z-10">מוצר</th>
                    {enabledSites.map((site) => (
                      <th key={site.id} className="border p-2 text-center min-w-[120px]">
                        <div className="font-semibold">{site.name}</div>
                        {site.siteUrl && (
                          <a
                            href={site.siteUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-blue-600 hover:underline"
                            onClick={(e) => e.stopPropagation()}
                          >
                            אתר
                          </a>
                        )}
                      </th>
                    ))}
                    <th className="border p-2 text-right">תאריך</th>
                  </tr>
                </thead>
                <tbody>
                  {Array.from(productsMap.values()).map(({ product, results: productResults }) => {
                    const priceRange = productPriceRanges.get(product.id);
                    const latestDate = productResults.length > 0
                      ? new Date(Math.max(...productResults.map((r) => new Date(r.scrapedAt).getTime())))
                      : null;

                    return (
                      <tr key={product.id} className="border hover:bg-gray-50">
                        <td className="border p-2 font-medium sticky right-0 bg-white z-10 text-right">
                          {product.name}
                        </td>
                        {enabledSites.map((site) => {
                          const siteResult = productResults.find((r) => r.siteId === site.id);
                          if (!siteResult) {
                            return (
                              <td key={site.id} className="border p-2 text-center text-gray-400">
                                -
                              </td>
                            );
                          }

                          const isLowest = priceRange && siteResult.price === priceRange.min;
                          const isHighest = priceRange && siteResult.price === priceRange.max && priceRange.min !== priceRange.max;

                          return (
                            <td
                              key={site.id}
                              className={`border p-2 text-center ${
                                isLowest
                                  ? "bg-green-100 font-semibold text-green-800"
                                  : isHighest
                                    ? "bg-red-100 font-semibold text-red-800"
                                    : ""
                              }`}
                            >
                              <div className="flex flex-col items-center gap-1">
                                <span className="text-lg">
                                  ₪{siteResult.price.toLocaleString()}
                                </span>
                                <a
                                  href={siteResult.productUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-xs text-blue-600 hover:underline"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  קישור
                                </a>
                              </div>
                            </td>
                          );
                        })}
                        <td className="border p-2 text-sm text-gray-600 text-right">
                          {latestDate ? latestDate.toLocaleDateString("he-IL") : "-"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        })()
      )}
    </div>
  );
}
