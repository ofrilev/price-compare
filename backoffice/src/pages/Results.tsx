import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { useState, useMemo, useEffect, useRef } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { toHrefUrl } from "../utils/url";
import {
  buildComparisonTableSiteColumns,
  findResultForComparisonColumn,
} from "../utils/comparisonTableSites";

const PAGE_SIZES = [10, 25, 50, 100];
type SortField = "product" | "category" | "lowestPrice" | "siteCount";
type SortDir = "asc" | "desc";

type EditModalState = {
  resultId: string;
  originalPrice: number;
  originalUrl: string;
  productName: string;
  siteName: string;
};

export default function Results() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [categoryFilter, setCategoryFilter] = useState<string>("");
  const [brandFilter, setBrandFilter] = useState<string>("");
  const [siteFilter, setSiteFilter] = useState<string[]>([]);
  const [searchFilter, setSearchFilter] = useState<string>("");
  const [sortField, setSortField] = useState<SortField>("product");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [editModal, setEditModal] = useState<EditModalState | null>(null);
  const [editPrice, setEditPrice] = useState("");
  const [editUrl, setEditUrl] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const modalPriceInputRef = useRef<HTMLInputElement>(null);
  const [highlightProductIds, setHighlightProductIds] = useState<string[]>(
    [],
  );

  const updateResultMutation = useMutation({
    mutationFn: (args: {
      id: string;
      body: { price?: number; productUrl?: string };
    }) => api.scrape.updateResult(args.id, args.body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["scrape-results"] });
      queryClient.invalidateQueries({ queryKey: ["scrape-lowest"] });
      setEditModal(null);
      setEditError(null);
    },
    onError: (err: Error) => {
      setEditError(err.message || "שמירה נכשלה");
    },
  });

  const deleteResultMutation = useMutation({
    mutationFn: (id: string) => api.scrape.deleteResult(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["scrape-results"] });
      queryClient.invalidateQueries({ queryKey: ["scrape-lowest"] });
    },
  });

  const confirmDeleteResult = (
    resultId: string,
    productName: string,
    siteName: string,
  ) => {
    if (
      !window.confirm(
        `למחוק את התוצאה עבור "${productName}" באתר ${siteName}?`,
      )
    ) {
      return;
    }
    deleteResultMutation.mutate(resultId);
  };

  useEffect(() => {
    if (editModal) {
      modalPriceInputRef.current?.focus();
    }
  }, [editModal]);

  useEffect(() => {
    if (!editModal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !updateResultMutation.isPending) {
        setEditModal(null);
        setEditError(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editModal, updateResultMutation.isPending]);

  const openEditModal = (
    r: { id: string; price: number; productUrl: string },
    productName: string,
    siteName: string,
  ) => {
    setEditModal({
      resultId: r.id,
      originalPrice: r.price,
      originalUrl: r.productUrl,
      productName,
      siteName,
    });
    setEditPrice(String(r.price));
    setEditUrl(r.productUrl);
    setEditError(null);
  };

  const closeEditModal = () => {
    if (updateResultMutation.isPending) return;
    setEditModal(null);
    setEditError(null);
  };

  const saveEdit = () => {
    if (!editModal) return;
    setEditError(null);
    const { resultId, originalPrice, originalUrl } = editModal;
    const priceTrim = editPrice.trim();
    const urlTrim = editUrl.trim();
    const body: { price?: number; productUrl?: string } = {};

    if (priceTrim !== String(originalPrice)) {
      const p = parseFloat(priceTrim.replace(/,/g, ""));
      if (!Number.isFinite(p) || p <= 0) {
        setEditError("הזן מחיר תקין");
        return;
      }
      body.price = p;
    }
    if (urlTrim !== originalUrl) {
      body.productUrl = urlTrim;
    }

    if (Object.keys(body).length === 0) {
      setEditModal(null);
      return;
    }

    updateResultMutation.mutate({ id: resultId, body });
  };

  const {
    data: results = [],
    isLoading: resultsLoading,
    isFetching: resultsFetching,
  } = useQuery({
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
  const tableSiteColumns = useMemo(
    () => buildComparisonTableSiteColumns(sites.filter((s) => s.enabled)),
    [sites]
  );
  const { data: categories = [] } = useQuery({
    queryKey: ["categories"],
    queryFn: () => api.categories(),
  });

  const { data: brands = [] } = useQuery({
    queryKey: ["brands"],
    queryFn: () => api.products.brands(),
  });

  const { allRows, rows, totalPages, totalRows } = useMemo(() => {
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

    // Filter by brand (חברה)
    if (brandFilter === "__none__") {
      rows = rows.filter((r) => !(r.product.brand ?? "").trim());
    } else if (brandFilter.trim()) {
      const b = brandFilter.trim();
      rows = rows.filter((r) => (r.product.brand ?? "").trim() === b);
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
          (r.product.searchTerm?.toLowerCase().includes(q) ?? false) ||
          (r.product.brand?.toLowerCase().includes(q) ?? false)
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

    return { allRows: rows, rows: paginatedRows, totalPages, totalRows };
  }, [
    results,
    products,
    categoryFilter,
    brandFilter,
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

  const focusProductsRaw = searchParams.get("focusProducts");

  useEffect(() => {
    const raw = focusProductsRaw?.trim();
    if (!raw || resultsLoading) return;

    const ids = raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (!ids.length) return;

    const clearFocusParam = () => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete("focusProducts");
          return next;
        },
        { replace: true },
      );
    };

    const idx = allRows.findIndex((r) => ids.includes(r.product.id));
    if (idx === -1) {
      if (resultsFetching) return;
      clearFocusParam();
      return;
    }

    const targetPage = Math.floor(idx / pageSize) + 1;
    setPage(targetPage);
    setHighlightProductIds(ids);

    const rowId = allRows[idx]!.product.id;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const el = document.getElementById(`comparison-row-${rowId}`);
        el?.scrollIntoView({ behavior: "smooth", block: "center" });
        el?.focus({ preventScroll: true });
      });
    });

    clearFocusParam();
  }, [
    focusProductsRaw,
    resultsLoading,
    resultsFetching,
    allRows,
    pageSize,
    setSearchParams,
  ]);

  useEffect(() => {
    if (!highlightProductIds.length) return;
    const t = window.setTimeout(() => setHighlightProductIds([]), 5000);
    return () => window.clearTimeout(t);
  }, [highlightProductIds]);

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
            <label className="block text-xs text-gray-500 mb-1 text-right">חברה</label>
            <select
              value={brandFilter}
              onChange={(e) => {
                setBrandFilter(e.target.value);
                setPage(1);
              }}
              className="border rounded px-3 py-2 text-right min-w-[160px] focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                  <th className="border p-2 text-right sticky right-[280px] bg-gray-100 z-10 min-w-[120px]">
                    חברה
                  </th>
                  {tableSiteColumns.map((site) => (
                    <th
                      key={site.id}
                      className={`border p-2 text-center min-w-[130px] ${
                        site.isDiez
                          ? "bg-amber-100 border-amber-200 text-amber-950"
                          : ""
                      }`}
                    >
                      <div className="font-semibold">{site.name}</div>
                      {site.siteUrl && (
                        <a
                          href={site.siteUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={`text-xs hover:underline ${
                            site.isDiez
                              ? "text-amber-800"
                              : "text-blue-600"
                          }`}
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
                  const rowHighlighted = highlightProductIds.includes(
                    product.id,
                  );
                  return (
                    <tr
                      key={product.id}
                      id={`comparison-row-${product.id}`}
                      tabIndex={rowHighlighted ? 0 : undefined}
                      className={`border hover:bg-gray-50 transition-shadow duration-300 ${
                        rowHighlighted
                          ? "bg-amber-50 z-[2] relative ring-[3px] ring-inset ring-indigo-600 shadow-[0_6px_18px_rgba(67,56,202,0.28),0_2px_6px_rgba(15,23,42,0.12)]"
                          : ""
                      }`}
                    >
                      <td
                        className={`border p-2 sticky right-0 z-10 ${
                          rowHighlighted
                            ? "bg-amber-50 font-bold text-gray-950"
                            : "bg-white font-medium"
                        }`}
                      >
                        {product.name}
                      </td>
                      <td
                        className={`border p-2 text-sm sticky right-[180px] z-10 ${
                          rowHighlighted
                            ? "bg-amber-50 font-semibold text-gray-900"
                            : "bg-white text-gray-600"
                        }`}
                      >
                        {product.category}
                      </td>
                      <td
                        className={`border p-2 text-sm sticky right-[280px] z-10 ${
                          rowHighlighted
                            ? "bg-amber-50 font-semibold text-gray-900"
                            : "bg-white text-gray-600"
                        }`}
                      >
                        {(product.brand ?? "").trim() || "—"}
                      </td>
                      {tableSiteColumns.map((site) => {
                        const siteResult = findResultForComparisonColumn(
                          site,
                          productResults
                        );
                        const diezBase =
                          "border-amber-100 bg-amber-50/90 text-amber-950";
                        if (!siteResult) {
                          return (
                            <td
                              key={site.id}
                              className={`border p-2 text-center text-gray-400 ${
                                site.isDiez ? diezBase : ""
                              }`}
                            >
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

                        const priceBg = isLowest
                          ? "bg-green-100 font-semibold text-green-800"
                          : isHighest
                            ? "bg-red-100 font-semibold text-red-800"
                            : site.isDiez
                              ? diezBase
                              : "";

                        const diezRing =
                          site.isDiez && (isLowest || isHighest)
                            ? " ring-2 ring-amber-300/80 ring-inset"
                            : "";

                        return (
                          <td
                            key={site.id}
                            className={`group border p-2 text-center ${priceBg}${diezRing}`}
                          >
                            <div className="flex flex-col items-center gap-1">
                              <span className="text-lg">
                                ₪{siteResult.price.toLocaleString()}
                              </span>
                              <a
                                href={toHrefUrl(siteResult.productUrl)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className={`text-xs hover:underline ${
                                  site.isDiez
                                    ? "text-amber-800"
                                    : "text-blue-600"
                                }`}
                              >
                                קישור
                              </a>
                              <span className="text-xs text-gray-500">
                                {cellDate.toLocaleDateString("he-IL")}
                              </span>
                              <div className="flex flex-col gap-0.5 mt-0.5 opacity-0 pointer-events-none transition-opacity duration-150 group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto">
                                <button
                                  type="button"
                                  onClick={() =>
                                    openEditModal(siteResult, product.name, site.name)
                                  }
                                  className="text-xs text-gray-600 hover:text-gray-900 underline"
                                >
                                  עריכה
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    confirmDeleteResult(
                                      siteResult.id,
                                      product.name,
                                      site.name,
                                    )
                                  }
                                  disabled={deleteResultMutation.isPending}
                                  className="text-xs text-red-600 hover:text-red-800 underline disabled:opacity-50"
                                >
                                  מחיקה
                                </button>
                              </div>
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

      {/* Edit price / URL modal */}
      {editModal && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50"
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-result-modal-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeEditModal();
          }}
        >
          <div
            className="bg-white rounded-lg shadow-xl border border-gray-200 w-full max-w-md p-5 text-right"
            onClick={(e) => e.stopPropagation()}
          >
            <h2
              id="edit-result-modal-title"
              className="text-lg font-semibold text-gray-900 mb-1"
            >
              עריכת תוצאה
            </h2>
            <p className="text-sm text-gray-600 mb-4">
              {editModal.productName}
              <span className="text-gray-400 mx-1">·</span>
              {editModal.siteName}
            </p>

            <div className="space-y-3">
              <label className="block text-sm text-gray-700">
                מחיר (₪)
                <input
                  ref={modalPriceInputRef}
                  type="text"
                  inputMode="decimal"
                  value={editPrice}
                  onChange={(e) => setEditPrice(e.target.value)}
                  className="mt-1 w-full border rounded-lg px-3 py-2 text-center"
                  disabled={updateResultMutation.isPending}
                />
              </label>
              <label className="block text-sm text-gray-700">
                קישור למוצר
                <input
                  type="url"
                  value={editUrl}
                  onChange={(e) => setEditUrl(e.target.value)}
                  className="mt-1 w-full border rounded-lg px-3 py-2 text-sm text-left dir-ltr"
                  disabled={updateResultMutation.isPending}
                />
              </label>
            </div>

            {editError && (
              <p className="mt-3 text-sm text-red-600 text-center">{editError}</p>
            )}

            <div className="mt-5 flex gap-2 justify-end flex-wrap">
              <button
                type="button"
                onClick={closeEditModal}
                disabled={updateResultMutation.isPending}
                className="px-4 py-2 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 text-sm disabled:opacity-50"
              >
                ביטול
              </button>
              <button
                type="button"
                onClick={saveEdit}
                disabled={updateResultMutation.isPending}
                className="px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 text-sm disabled:opacity-50"
              >
                {updateResultMutation.isPending ? "שומר…" : "שמור"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
