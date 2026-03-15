import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type Site } from "../api/client";
import { useState } from "react";

export default function Sites() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Site | null>(null);
  const [creating, setCreating] = useState(false);

  const { data: sites = [], isLoading } = useQuery({
    queryKey: ["sites"],
    queryFn: () => api.sites.list(),
  });

  const createMutation = useMutation({
    mutationFn: (data: Partial<Site>) => api.sites.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sites"] });
      setCreating(false);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Site> }) => api.sites.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sites"] });
      setEditing(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.sites.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["sites"] }),
  });

  if (isLoading) return <div className="text-gray-500">טוען...</div>;

  return (
    <div dir="rtl" className="text-right">
      <h1 className="text-xl font-semibold mb-4 text-right">אתרים</h1>
      <button
        onClick={() => setCreating(true)}
        className="mb-4 px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700"
      >
        הוסף אתר
      </button>

      <table className="w-full border-collapse border border-gray-200">
        <thead>
          <tr className="bg-gray-100">
            <th className="border p-2 text-left">שם</th>
            <th className="border p-2 text-left">כתובת בסיס</th>
            <th className="border p-2 text-left">פעיל</th>
            <th className="border p-2 text-left">פעולות</th>
          </tr>
        </thead>
        <tbody>
          {sites.map((site) => (
            <tr key={site.id} className="border">
              <td className="border p-2">{site.name}</td>
              <td className="border p-2 text-sm text-gray-600">{site.baseUrl}</td>
              <td className="border p-2">{site.enabled ? "כן" : "לא"}</td>
              <td className="border p-2">
                <button
                  onClick={() => setEditing(site)}
                  className="text-blue-600 hover:underline mr-2"
                >
                  ערוך
                </button>
                <button
                  onClick={() => deleteMutation.mutate(site.id)}
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
        <SiteForm
          onSave={(data) => createMutation.mutate(data)}
          onCancel={() => setCreating(false)}
        />
      )}
      {editing && (
        <SiteForm
          site={editing}
          onSave={(data) => updateMutation.mutate({ id: editing.id, data })}
          onCancel={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function SiteForm({
  site,
  onSave,
  onCancel,
}: {
  site?: Site;
  onSave: (data: Partial<Site>) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<Partial<Site>>(
    site ?? {
      name: "",
      siteUrl: "",
    }
  );

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-10" dir="rtl">
      <div className="bg-white p-6 rounded shadow-lg max-w-md w-full">
        <h2 className="text-lg font-semibold mb-4 text-right">{site ? "ערוך אתר" : "הוסף אתר"}</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1 text-right">שם *</label>
            <input
              value={form.name ?? ""}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="w-full border rounded px-3 py-2 text-right"
              placeholder="לדוגמה: חלילית"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1 text-right">כתובת אתר (אופציונלי)</label>
            <input
              value={form.siteUrl ?? ""}
              onChange={(e) => setForm({ ...form, siteUrl: e.target.value || undefined })}
              className="w-full border rounded px-3 py-2 text-right"
              placeholder="https://example.com"
              type="url"
            />
          </div>
        </div>
        <div className="flex gap-2 mt-6 justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-2 border rounded hover:bg-gray-100 transition-colors"
          >
            ביטול
          </button>
          <button
            onClick={() => onSave(form)}
            disabled={!form.name}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            שמור
          </button>
        </div>
      </div>
    </div>
  );
}
