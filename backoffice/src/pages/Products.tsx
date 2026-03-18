import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type Product } from "../api/client";
import { useState, useRef, useEffect } from "react";

export default function Products() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Product | null>(null);
  const [creating, setCreating] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<string>("");
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkModalOpen, setBulkModalOpen] = useState(false);

  const { data: categories = [] } = useQuery({
    queryKey: ["categories"],
    queryFn: () => api.categories(),
  });

  const { data: products = [], isLoading, isError, error } = useQuery({
    queryKey: ["products", categoryFilter, search],
    queryFn: () =>
      api.products.list({
        ...(categoryFilter ? { category: categoryFilter } : {}),
        ...(search ? { search } : {}),
      }),
  });

  const createMutation = useMutation({
    mutationFn: (data: Partial<Product>) => api.products.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["categories"] });
      setCreating(false);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Product> }) =>
      api.products.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["categories"] });
      setEditing(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.products.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["categories"] });
    },
  });

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === products.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(products.map((p) => p.id)));
    }
  };

  const selectedProducts = products.filter((p) => selectedIds.has(p.id));
  const checkAllRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = checkAllRef.current;
    if (!el) return;
    const n = selectedIds.size;
    const total = products.length;
    el.indeterminate = n > 0 && n < total;
  }, [selectedIds.size, products.length]);

  if (isLoading) return <div className="text-gray-500">טוען...</div>;
  if (isError) return <div className="text-red-600 p-4">שגיאה בטעינה: {error?.message ?? "שגיאה לא ידועה"}</div>;

  return (
    <div dir="rtl" className="text-right">
      <h1 className="text-xl font-semibold mb-4 text-right">מוצרים</h1>
      <div className="flex gap-4 mb-4">
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="border rounded px-2 py-1"
        >
          <option value="">כל הקטגוריות</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <input
          type="text"
          placeholder="חיפוש..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="border rounded px-2 py-1"
        />
        <button
          onClick={() => setCreating(true)}
          className="px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          הוסף מוצר
        </button>
        {selectedIds.size > 0 && (
          <button
            onClick={() => setBulkModalOpen(true)}
            className="px-3 py-1.5 bg-purple-600 text-white rounded hover:bg-purple-700"
          >
            פעולות על {selectedIds.size} נבחרים
          </button>
        )}
      </div>

      {products.length === 0 ? (
        <div className="p-8 bg-gray-50 rounded-lg border border-gray-200 text-center text-gray-600">
          אין מוצרים. הוסף מוצר כדי להתחיל.
        </div>
      ) : (
      <table className="w-full border-collapse border border-gray-200">
        <thead>
          <tr className="bg-gray-100">
            <th className="border p-2 text-left w-12">
              <input
                ref={checkAllRef}
                type="checkbox"
                checked={
                  products.length > 0 && selectedIds.size === products.length
                }
                onChange={toggleSelectAll}
                className="w-4 h-4 rounded"
              />
            </th>
            <th className="border p-2 text-left">שם</th>
            <th className="border p-2 text-left">מונח חיפוש</th>
            <th className="border p-2 text-left">קטגוריה</th>
            <th className="border p-2 text-left">פעולות</th>
          </tr>
        </thead>
        <tbody>
          {products.map((product) => (
            <tr key={product.id} className="border">
              <td className="border p-2">
                <input
                  type="checkbox"
                  checked={selectedIds.has(product.id)}
                  onChange={() => toggleSelect(product.id)}
                  className="w-4 h-4 rounded"
                />
              </td>
              <td className="border p-2">{product.name}</td>
              <td className="border p-2 text-sm text-gray-600">
                {product.searchTerm}
              </td>
              <td className="border p-2">{product.category}</td>
              <td className="border p-2">
                <div className="flex gap-2">
                  <button
                    onClick={() => setEditing(product)}
                    className="px-3 py-1 border border-blue-600 text-blue-600 rounded hover:bg-blue-50"
                  >
                    ערוך
                  </button>
                  <button
                    onClick={() => deleteMutation.mutate(product.id)}
                    className="px-3 py-1 border border-red-600 text-red-600 rounded hover:bg-red-50"
                  >
                    מחק
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      )}

      {creating && (
        <ProductForm
          categories={categories}
          onSave={(data) => createMutation.mutate(data)}
          onCancel={() => {
            createMutation.reset();
            setCreating(false);
          }}
          error={createMutation.error?.message}
        />
      )}
      {editing && (
        <ProductForm
          product={editing}
          categories={categories}
          onSave={(data) => updateMutation.mutate({ id: editing.id, data })}
          onCancel={() => {
            updateMutation.reset();
            setEditing(null);
          }}
          error={updateMutation.error?.message}
        />
      )}
      {bulkModalOpen && (
        <BulkActionsModal
          products={selectedProducts}
          categories={categories}
          onUpdateCategory={async (newCategory) => {
            await Promise.all(
              selectedProducts.map((p) =>
                api.products.update(p.id, { category: newCategory }),
              ),
            );
            queryClient.invalidateQueries({ queryKey: ["products"] });
            queryClient.invalidateQueries({ queryKey: ["categories"] });
            setSelectedIds(new Set());
            setBulkModalOpen(false);
          }}
          onDelete={async () => {
            await Promise.all(
              selectedProducts.map((p) => api.products.delete(p.id)),
            );
            queryClient.invalidateQueries({ queryKey: ["products"] });
            queryClient.invalidateQueries({ queryKey: ["categories"] });
            setSelectedIds(new Set());
            setBulkModalOpen(false);
          }}
          onCancel={() => setBulkModalOpen(false)}
        />
      )}
    </div>
  );
}

function BulkActionsModal({
  products,
  categories,
  onUpdateCategory,
  onDelete,
  onCancel,
}: {
  products: Product[];
  categories: string[];
  onUpdateCategory: (newCategory: string) => Promise<void>;
  onDelete: () => Promise<void>;
  onCancel: () => void;
}) {
  const [newCategory, setNewCategory] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleUpdateCategory = async () => {
    if (newCategory.trim()) {
      setIsUpdating(true);
      try {
        await onUpdateCategory(newCategory.trim());
      } finally {
        setIsUpdating(false);
      }
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setIsDeleting(true);
    try {
      await onDelete();
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-10"
      onClick={(e) => e.target === e.currentTarget && onCancel()}
    >
      <div
        className="bg-white p-6 rounded shadow-lg max-w-md w-full"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold mb-4 text-right">
          פעולות על {products.length} מוצרים נבחרים
        </h2>
        <div className="space-y-4 text-right">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              שנה קטגוריה לכל הנבחרים
            </label>
            <div className="flex gap-2">
              <input
                list="bulk-categories"
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                className="flex-1 border rounded px-2 py-1.5 text-right"
                placeholder="בחר או הקלד קטגוריה"
              />
              <datalist id="bulk-categories">
                {categories.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
              <button
                onClick={handleUpdateCategory}
                disabled={!newCategory.trim() || isUpdating}
                className="px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
              >
                {isUpdating ? "..." : "שנה"}
              </button>
            </div>
          </div>
          <div className="border-t pt-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              מחק את כל הנבחרים
            </label>
            {confirmDelete ? (
              <div className="flex gap-2 items-center">
                <span className="text-sm text-red-600">
                  לחץ שוב לאישור המחיקה
                </span>
                <button
                  onClick={handleDelete}
                  disabled={isDeleting}
                  className="px-3 py-1.5 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
                >
                  {isDeleting ? "..." : "מחק לצמיתות"}
                </button>
              </div>
            ) : (
              <button
                onClick={handleDelete}
                className="px-3 py-1.5 bg-red-100 text-red-700 rounded hover:bg-red-200"
              >
                מחק נבחרים
              </button>
            )}
          </div>
        </div>
        <div className="flex justify-end mt-6">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 border rounded hover:bg-gray-100"
          >
            סגור
          </button>
        </div>
      </div>
    </div>
  );
}

function ProductForm({
  product,
  categories,
  onSave,
  onCancel,
  error,
}: {
  product?: Product;
  categories: string[];
  onSave: (data: Partial<Product>) => void;
  onCancel: () => void;
  error?: string;
}) {
  const [form, setForm] = useState<Partial<Product>>(
    product ?? { name: "", searchTerm: "", category: "" },
  );
  const [categoryInput, setCategoryInput] = useState(product?.category ?? "");

  const handleSave = () => {
    onSave({ ...form, category: categoryInput });
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-10">
      <div className="bg-white p-6 rounded shadow-lg max-w-md w-full">
        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded text-sm text-right">
            {error}
          </div>
        )}
        <h2 className="text-lg font-semibold mb-4">
          {product ? "ערוך מוצר" : "הוסף מוצר"}
        </h2>
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700">
              שם
            </label>
            <input
              value={form.name ?? ""}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="w-full border rounded px-2 py-1"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">
              מונח חיפוש
            </label>
            <input
              value={form.searchTerm ?? ""}
              onChange={(e) => setForm({ ...form, searchTerm: e.target.value })}
              className="w-full border rounded px-2 py-1"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">
              קטגוריה
            </label>
            <input
              list="categories"
              value={categoryInput}
              onChange={(e) => setCategoryInput(e.target.value)}
              className="w-full border rounded px-2 py-1"
              placeholder="לדוגמה: טלפונים, מחשבים ניידים"
            />
            <datalist id="categories">
              {categories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </div>
        </div>
        <div className="flex gap-2 mt-4">
          <button
            onClick={handleSave}
            className="px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            שמור
          </button>
          <button
            onClick={onCancel}
            className="px-3 py-1.5 border rounded hover:bg-gray-100"
          >
            ביטול
          </button>
        </div>
      </div>
    </div>
  );
}
