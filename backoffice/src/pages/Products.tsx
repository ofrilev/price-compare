import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type Product } from "../api/client";
import { useState } from "react";

export default function Products() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Product | null>(null);
  const [creating, setCreating] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<string>("");
  const [search, setSearch] = useState("");

  const { data: categories = [] } = useQuery({
    queryKey: ["categories"],
    queryFn: () => api.categories(),
  });

  const { data: products = [], isLoading } = useQuery({
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

  if (isLoading) return <div className="text-gray-500">טוען...</div>;

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
      </div>

      <table className="w-full border-collapse border border-gray-200">
        <thead>
          <tr className="bg-gray-100">
            <th className="border p-2 text-left">שם</th>
            <th className="border p-2 text-left">מונח חיפוש</th>
            <th className="border p-2 text-left">קטגוריה</th>
            <th className="border p-2 text-left">פעולות</th>
          </tr>
        </thead>
        <tbody>
          {products.map((product) => (
            <tr key={product.id} className="border">
              <td className="border p-2">{product.name}</td>
              <td className="border p-2 text-sm text-gray-600">{product.searchTerm}</td>
              <td className="border p-2">{product.category}</td>
              <td className="border p-2">
                <button
                  onClick={() => setEditing(product)}
                  className="text-blue-600 hover:underline mr-2"
                >
                  ערוך
                </button>
                <button
                  onClick={() => deleteMutation.mutate(product.id)}
                  className="text-red-600 hover:underline"
                >
                  מחק
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {creating && (
        <ProductForm
          categories={categories}
          onSave={(data) => createMutation.mutate(data)}
          onCancel={() => setCreating(false)}
        />
      )}
      {editing && (
        <ProductForm
          product={editing}
          categories={categories}
          onSave={(data) => updateMutation.mutate({ id: editing.id, data })}
          onCancel={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function ProductForm({
  product,
  categories,
  onSave,
  onCancel,
}: {
  product?: Product;
  categories: string[];
  onSave: (data: Partial<Product>) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<Partial<Product>>(
    product ?? { name: "", searchTerm: "", category: "" }
  );
  const [categoryInput, setCategoryInput] = useState(product?.category ?? "");

  const handleSave = () => {
    onSave({ ...form, category: categoryInput });
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-10">
      <div className="bg-white p-6 rounded shadow-lg max-w-md w-full">
        <h2 className="text-lg font-semibold mb-4">{product ? "ערוך מוצר" : "הוסף מוצר"}</h2>
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700">שם</label>
            <input
              value={form.name ?? ""}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="w-full border rounded px-2 py-1"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">מונח חיפוש</label>
            <input
              value={form.searchTerm ?? ""}
              onChange={(e) => setForm({ ...form, searchTerm: e.target.value })}
              className="w-full border rounded px-2 py-1"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">קטגוריה</label>
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
          <button onClick={onCancel} className="px-3 py-1.5 border rounded hover:bg-gray-100">
            ביטול
          </button>
        </div>
      </div>
    </div>
  );
}
