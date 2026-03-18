import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import { useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { toHrefUrl } from "../utils/url";

const PAGE_SIZES = [10, 25, 50, 100];
type SortField = "product" | "category" | "lowestPrice" | "siteCount";
type SortDir = "asc" | "desc";

export default function Results() {
  const [categoryFilter, setCategoryFilter] = useState<string>("");
  const [siteFilter, setSiteFilter] = useState<string[]>([]);
  const [searchFilter, setSearchFilter] = useState<string>("");
  const [sortField, setSortField] = useState<SortField>("product");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const { data: results = [], isLoading: resultsLoading } = useQuery({
    queryKey: ["scrape-results"],
    queryFn: () => api.scrape.results(),
  });

  const { data: products = [] } = useQuery({
    queryKey: ["products"],
    queryFn: () => api.products.list(),
  });

  const { data: sites = [] } = useQuery({
    queryKey: ["sites"],
    queryFn: () => api.sites.list(),
  });

  const enabledSites = sites.filter((s) => s.enabled);
  const { data: categories = [] } = useQuery({
    queryKey: ["categories"],
    queryFn: () => api.categories(),
  });

  const { rows, totalPages, totalRows } = useMemo(() => {
    const productMap = new Map(products.map((p) => [p.id, p]));
    const productsMap = new Map<string, { product: (typeof products)[0]; results: typeof results }>();

    for (const result of results) {
      const product = productMap.get(result.productId);
      if (!product) continue;

      if (!productsMap.has(product.id)) {
        productsMap.set(product.id, { product, results: [] });
      }
      productsMap.get(product.id)!.results.push(result);
    }

    let rows = Array.from(productsMap.values());

    // Filter by category
    if (categoryFilter) {
      rows = rows.filter((r) => r.product.category === categoryFilter);
    }

    // Filter by site (product must have at least one result in selected sites)
    if (siteFilter.length > 0) {
      rows = rows.filter((r) =>
        siteFilter.every((siteId) => r.results.some((res) => res.siteId === siteId))
      );
    }

    // Filter by search
    if (searchFilter.trim()) {
      const q = searchFilter.toLowerCase().trim();
      rows = rows.filter(
        (r) =>
          r.product.name.toLowerCase().includes(q) ||
          r.product.category.toLowerCase().includes(q) ||
          r.product.searchTerm.toLowerCase().includes(q)
      );
    }

    // Sort
    rows = [...rows].sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "product":
          cmp = a.product.name.localeCompare(b.product.name, "he");
          break;
        case "category":
          cmp = a.product.category.localeCompare(b.product.category, "he");
          break;
        case "lowestPrice": {
          const aMin = Math.min(...a.results.map((r) => r.price).filter((p) => p > 0), Infinity);
          const bMin = Math.min(...b.results.map((r) => r.price).filter((p) => p > 0), Infinity);
          cmp = (aMin === Infinity ? 0 : aMin) - (bMin === Infinity ? 0 : bMin);
          break;
        }
        case "siteCount":
          cmp = a.results.length - b.results.length;
          break;
        default:
          cmp = 0;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });

    const totalRows = rows.length;
    const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
    const start = (page - 1) * pageSize;
    const paginatedRows = rows.slice(start, start + pageSize);

    return { rows: paginatedRows, totalPages, totalRows };
  }, [
    results,
    products,
    categoryFilter,
    siteFilter,
    searchFilter,
    sortField,
    sortDir,
    page,
    pageSize,
  ]);

  const productPriceRanges = useMemo(() => {
    const ranges = new Map<string, { min: number; max: number }>();
    for (const { product, results: productResults } of rows) {
      const prices = productResults.map((r) => r.price).filter((p) => p > 0);
      if (prices.length > 0) {
        ranges.set(product.id, {
          min: Math.min(...prices),
          max: Math.max(...prices),
        });
      }
    }
    return ranges;
  }, [rows]);

  const toggleSiteFilter = (siteId: string) => {
    setSiteFilter((prev) =>
      prev.includes(siteId) ? prev.filter((id) => id !== siteId) : [...prev, siteId]
    );
    setPage(1);
  };

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("asc");
    }
    setPage(1);
  };

  return (
    <div dir="rtl" className="text-right">
      <h1 className="text-xl font-semibold mb-4 text-right">טבלת תוצאות השוואה</h1>

      {/* Filters */}
      <div className="mb-6 p-4 bg-white rounded-lg border border-gray-200 shadow-sm">
        <h2 className="text-sm font-semibold text-gray-700 mb-3 text-right">סינון ומיון</h2>
        <div className="flex flex-wrap gap-4 items-end justify-end">
          <div>
            <label className="block text-xs text-gray-500 mb-1 text-right">חיפוש</label>
            <input
              type="text"
              placeholder="חפש מוצר..."
              value={searchFilter}
              onChange={(e) => {
                setSearchFilter(e.target.value);
                setPage(1);
              }}
              className="border rounded px-3 py-2 text-right min-w-[180px] focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1 text-right">קטגוריה</label>
            <select
              value={categoryFilter}
              onChange={(e) => {
                setCategoryFilter(e.target.value);
                setPage(1);
              }}
              className="border rounded px-3 py-2 text-right min-w-[160px] focus:outline-none focus:ring-2 focus:ring-blue-500"
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
            <label className="block text-xs text-gray-500 mb-1 text-right">אתר (חייב להכיל)</label>
            <div className="flex flex-wrap gap-2">
              {enabledSites.map((site) => (
                <button
                  key={site.id}
                  onClick={() => toggleSiteFilter(site.id)}
                  className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                    siteFilter.includes(site.id)
                      ? "bg-blue-600 text-white"
                      : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                  }`}
                >
                  {site.name}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1 text-right">מיון לפי</label>
            <div className="flex gap-2">
              {(
                [
                  { field: "product" as SortField, label: "שם מוצר" },
                  { field: "category" as SortField, label: "קטגוריה" },
                  { field: "lowestPrice" as SortField, label: "מחיר נמוך" },
                  { field: "siteCount" as SortField, label: "מספר אתרים" },
                ] as const
              ).map(({ field, label }) => (
                <button
                  key={field}
                  onClick={() => toggleSort(field)}
                  className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                    sortField === field
                      ? "bg-purple-600 text-white"
                      : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                  }`}
                >
                  {label} {sortField === field && (sortDir === "asc" ? "↑" : "↓")}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Table */}
      {resultsLoading ? (
        <div className="flex gap-2 text-gray-500 justify-end">
          <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          טוען...
        </div>
      ) : rows.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-lg border border-gray-200">
          <p className="text-gray-500 mb-4">אין תוצאות להצגה</p>
          <Link
            to="/scrape"
            className="text-blue-600 hover:underline font-medium"
          >
            עבור להשוואת מחירים ←
          </Link>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto bg-white rounded-lg border border-gray-200 shadow-sm">
            <table className="w-full border-collapse text-right">
              <thead>
                <tr className="bg-gray-100">
                  <th className="border p-2 text-right sticky right-0 bg-gray-100 z-10 min-w-[180px]">
                    מוצר
                  </th>
                  <th className="border p-2 text-right sticky right-[180px] bg-gray-100 z-10 min-w-[100px]">
                    קטגוריה
                  </th>
                  {enabledSites.map((site) => (
                    <th key={site.id} className="border p-2 text-center min-w-[130px]">
                      <div className="font-semibold">{site.name}</div>
                      {site.siteUrl && (
                        <a
                          href={site.siteUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-blue-600 hover:underline"
                        >
                          אתר
                        </a>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(({ product, results: productResults }) => {
                  const priceRange = productPriceRanges.get(product.id);
                  return (
                    <tr key={product.id} className="border hover:bg-gray-50">
                      <td className="border p-2 font-medium sticky right-0 bg-white z-10">
                        {product.name}
                      </td>
                      <td className="border p-2 text-sm text-gray-600 sticky right-[180px] bg-white z-10">
                        {product.category}
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
                        const isLowest =
                          priceRange && siteResult.price === priceRange.min;
                        const isHighest =
                          priceRange &&
                          siteResult.price === priceRange.max &&
                          priceRange.min !== priceRange.max;
                        const cellDate = new Date(siteResult.scrapedAt);

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
                                href={toHrefUrl(siteResult.productUrl)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs text-blue-600 hover:underline"
                              >
                                קישור
                              </a>
                              <span className="text-xs text-gray-500">
                                {cellDate.toLocaleDateString("he-IL")}
                              </span>
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <span className="text-sm text-gray-600">
                מציג {Math.min((page - 1) * pageSize + 1, totalRows)}-
                {Math.min(page * pageSize, totalRows)} מתוך {totalRows}
              </span>
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setPage(1);
                }}
                className="border rounded px-2 py-1 text-sm"
              >
                {PAGE_SIZES.map((n) => (
                  <option key={n} value={n}>
                    {n} לשורה
                  </option>
                ))}
              </select>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setPage(1)}
                disabled={page <= 1}
                className="px-3 py-1 rounded border bg-white disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
              >
                ראשון
              </button>
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="px-3 py-1 rounded border bg-white disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
              >
                הקודם
              </button>
              <span className="px-3 py-1 text-sm text-gray-700">
                עמוד {page} / {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="px-3 py-1 rounded border bg-white disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
              >
                הבא
              </button>
              <button
                onClick={() => setPage(totalPages)}
                disabled={page >= totalPages}
                className="px-3 py-1 rounded border bg-white disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
              >
                אחרון
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
