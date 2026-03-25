import { useEffect } from "react";
import { Link } from "react-router-dom";
import { useAtom } from "jotai";
import { appToastAtom } from "../atoms/scrapeAtoms";

const TOAST_MS = 12_000;

export function ToastHost() {
  const [toast, setToast] = useAtom(appToastAtom);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), TOAST_MS);
    return () => window.clearTimeout(t);
  }, [toast, setToast]);

  if (!toast) return null;

  const focusQuery =
    toast.focusProductIds && toast.focusProductIds.length > 0
      ? `?focusProducts=${encodeURIComponent(toast.focusProductIds.join(","))}`
      : "";

  return (
    <div
      className="fixed bottom-4 left-4 right-4 z-[200] flex justify-center pointer-events-none sm:left-auto sm:right-4 sm:max-w-md"
      dir="rtl"
      role="status"
    >
      <div
        className={`pointer-events-auto w-full rounded-xl border px-4 py-3 text-sm shadow-lg text-right ${
          toast.variant === "success"
            ? "border-emerald-200 bg-emerald-50 text-emerald-950"
            : "border-red-200 bg-red-50 text-red-950"
        }`}
      >
        <p className="font-medium">{toast.message}</p>
        {toast.variant === "success" &&
        toast.focusProductIds &&
        toast.focusProductIds.length > 0 ? (
          <Link
            to={`/results${focusQuery}`}
            className="mt-2 inline-block text-sm font-semibold text-indigo-700 underline hover:text-indigo-900"
            onClick={() => setToast(null)}
          >
            מעבר לטבלת ההשוואה והדגשת השורות החדשות
          </Link>
        ) : null}
        <button
          type="button"
          onClick={() => setToast(null)}
          className="mt-2 block w-full text-center text-xs opacity-70 hover:opacity-100"
        >
          סגור
        </button>
      </div>
    </div>
  );
}
