import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type Site } from "../api/client";
import { useState, useRef, useEffect } from "react";

export default function Sites() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Site | null>(null);
  const [creating, setCreating] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkModalOpen, setBulkModalOpen] = useState(false);

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

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === sites.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(sites.map((s) => s.id)));
    }
  };

  const selectedSites = sites.filter((s) => selectedIds.has(s.id));
  const checkAllRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = checkAllRef.current;
    if (!el) return;
    const n = selectedIds.size;
    const total = sites.length;
    el.indeterminate = n > 0 && n < total;
  }, [selectedIds.size, sites.length]);

  if (isLoading) return <div className="text-gray-500">טוען...</div>;

  return (
    <div dir="rtl" className="text-right">
      <h1 className="text-xl font-semibold mb-4 text-right">אתרים</h1>
      <div className="flex gap-4 mb-4">
        <button
          onClick={() => setCreating(true)}
          className="px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          הוסף אתר
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

      <table className="w-full border-collapse border border-gray-200">
        <thead>
          <tr className="bg-gray-100">
            <th className="border p-2 text-left w-12">
              <input
                ref={checkAllRef}
                type="checkbox"
                checked={sites.length > 0 && selectedIds.size === sites.length}
                onChange={toggleSelectAll}
                className="w-4 h-4 rounded"
              />
            </th>
            <th className="border p-2 text-left">שם</th>
            <th className="border p-2 text-left">כתובת בסיס</th>
            <th className="border p-2 text-left">פעיל</th>
            <th className="border p-2 text-left">פעולות</th>
          </tr>
        </thead>
        <tbody>
          {sites.map((site) => (
            <tr key={site.id} className="border">
              <td className="border p-2">
                <input
                  type="checkbox"
                  checked={selectedIds.has(site.id)}
                  onChange={() => toggleSelect(site.id)}
                  className="w-4 h-4 rounded"
                />
              </td>
              <td className="border p-2">{site.name}</td>
              <td className="border p-2 text-sm text-gray-600">{site.baseUrl}</td>
              <td className="border p-2">{site.enabled ? "כן" : "לא"}</td>
              <td className="border p-2">
                <div className="flex gap-2">
                  <button
                    onClick={() => setEditing(site)}
                    className="px-3 py-1 border border-blue-600 text-blue-600 rounded hover:bg-blue-50"
                  >
                    ערוך
                  </button>
                  <button
                    onClick={() => deleteMutation.mutate(site.id)}
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

      {creating && (
        <SiteForm
          onSave={(data) => createMutation.mutate(data)}
          onCancel={() => {
            createMutation.reset();
            setCreating(false);
          }}
          error={createMutation.error?.message}
        />
      )}
      {editing && (
        <SiteForm
          site={editing}
          onSave={(data) => updateMutation.mutate({ id: editing.id, data })}
          onCancel={() => {
            updateMutation.reset();
            setEditing(null);
          }}
          error={updateMutation.error?.message}
        />
      )}
      {bulkModalOpen && (
        <SiteBulkActionsModal
          sites={selectedSites}
          onDelete={async () => {
            await Promise.all(selectedSites.map((s) => api.sites.delete(s.id)));
            queryClient.invalidateQueries({ queryKey: ["sites"] });
            setSelectedIds(new Set());
            setBulkModalOpen(false);
          }}
          onToggleEnabled={async (enabled) => {
            await Promise.all(
              selectedSites.map((s) => api.sites.update(s.id, { enabled }))
            );
            queryClient.invalidateQueries({ queryKey: ["sites"] });
            setSelectedIds(new Set());
            setBulkModalOpen(false);
          }}
          onCancel={() => setBulkModalOpen(false)}
        />
      )}
    </div>
  );
}

function SiteBulkActionsModal({
  sites,
  onDelete,
  onToggleEnabled,
  onCancel,
}: {
  sites: Site[];
  onDelete: () => Promise<void>;
  onToggleEnabled: (enabled: boolean) => Promise<void>;
  onCancel: () => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isToggling, setIsToggling] = useState(false);

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
      <div className="bg-white p-6 rounded shadow-lg max-w-md w-full" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold mb-4 text-right">
          פעולות על {sites.length} אתרים נבחרים
        </h2>
        <div className="space-y-4 text-right">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              שנה סטטוס פעיל
            </label>
            <div className="flex gap-2">
              <button
                onClick={async () => {
                  setIsToggling(true);
                  try {
                    await onToggleEnabled(true);
                  } finally {
                    setIsToggling(false);
                  }
                }}
                disabled={isToggling}
                className="px-3 py-1.5 border border-green-600 text-green-600 rounded hover:bg-green-50 disabled:opacity-50"
              >
                {isToggling ? "..." : "הפעל נבחרים"}
              </button>
              <button
                onClick={async () => {
                  setIsToggling(true);
                  try {
                    await onToggleEnabled(false);
                  } finally {
                    setIsToggling(false);
                  }
                }}
                disabled={isToggling}
                className="px-3 py-1.5 border border-gray-600 text-gray-600 rounded hover:bg-gray-50 disabled:opacity-50"
              >
                {isToggling ? "..." : "השבת נבחרים"}
              </button>
            </div>
          </div>
          <div className="border-t pt-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              מחק את כל הנבחרים
            </label>
            {confirmDelete ? (
              <div className="flex gap-2 items-center">
                <span className="text-sm text-red-600">לחץ שוב לאישור המחיקה</span>
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
                className="px-3 py-1.5 border border-red-600 text-red-600 rounded hover:bg-red-50"
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

function SiteForm({
  site,
  onSave,
  onCancel,
  error,
}: {
  site?: Site;
  onSave: (data: Partial<Site>) => void;
  onCancel: () => void;
  error?: string;
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
        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded text-sm text-right">
            {error}
          </div>
        )}
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
