import { useEffect, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAtom, useSetAtom } from "jotai";
import { api, API_BASE } from "../api/client";
import {
  appToastAtom,
  lastSearchRunStatusAtom,
  navigatorLastLlmPromptAtom,
  navigatorLastLlmResponseAtom,
  navigatorRunRequestAtom,
  type NavigatorRunRequest,
  navigatorScrapeLogAtom,
  navigatorStreamRunningAtom,
} from "../atoms/scrapeAtoms";

/**
 * Keeps Navigator EventSource + mutation alive across route changes so the run
 * continues and the log/status update when the user returns to /scrape.
 */
export function NavigatorScrapeRunner() {
  const queryClient = useQueryClient();
  const [, setLog] = useAtom(navigatorScrapeLogAtom);
  const setStreaming = useSetAtom(navigatorStreamRunningAtom);
  const setLastSearchStatus = useSetAtom(lastSearchRunStatusAtom);
  const setLastLlmPrompt = useSetAtom(navigatorLastLlmPromptAtom);
  const setLastLlmResponse = useSetAtom(navigatorLastLlmResponseAtom);
  const setAppToast = useSetAtom(appToastAtom);
  const [request, setRequest] = useAtom(navigatorRunRequestAtom);
  const lastHandledId = useRef<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  const { mutate } = useMutation({
    mutationFn: async (payload: NavigatorRunRequest) => {
      setLog([]);
      setLastLlmPrompt(null);
      setLastLlmResponse(null);
      setStreaming(true);

      const token = localStorage.getItem("auth_token");
      const streamUrl = token
        ? `${API_BASE}/scrape/stream?token=${encodeURIComponent(token)}`
        : `${API_BASE}/scrape/stream`;
      const es = new EventSource(streamUrl);
      eventSourceRef.current = es;

      es.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data.type === "llm_prompt") {
            try {
              const parsed = JSON.parse(data.message || "{}");
              setLastLlmPrompt(parsed);
            } catch {
              /* ignore */
            }
            return;
          }
          if (data.type === "llm_response") {
            try {
              const parsed = JSON.parse(data.message || "{}");
              setLastLlmResponse(parsed);
            } catch {
              /* ignore */
            }
            return;
          }
          setLog((prev) => [
            ...prev,
            {
              type: data.type || "status",
              message: data.message || "",
              timestamp: Date.now(),
            },
          ]);
        } catch (err) {
          console.error("Error parsing EventSource message:", err);
        }
      };

      es.onerror = () => {
        if (es.readyState === EventSource.CLOSED) {
          setStreaming(false);
          es.close();
          eventSourceRef.current = null;
        }
      };

      try {
        const result = await api.scrape.run(payload.body);
        setStreaming(false);
        es.close();
        eventSourceRef.current = null;
        return { result, payload };
      } catch (err) {
        setStreaming(false);
        es.close();
        eventSourceRef.current = null;
        throw err;
      }
    },
    onSuccess: ({ result, payload }) => {
      setLastSearchStatus({
        updatedAt: new Date().toISOString(),
        runType: "navigator",
        state: "success",
        summary: `השוואת Navigator הושלמה — ${result.count} תוצאות`,
        resultsCount: result.count,
        scopeHint: payload.scopeHint,
      });
      queryClient.invalidateQueries({ queryKey: ["scrape-results"] });
      queryClient.invalidateQueries({ queryKey: ["scrape-lowest"] });
      const focusProductIds = [
        ...new Set(result.results.map((r) => r.productId)),
      ];
      setAppToast({
        id: Date.now(),
        variant: "success",
        message:
          result.count > 0
            ? `Navigator הושלם — נוספו ${result.count} תוצאות`
            : "Navigator הושלם — לא נמצאו מחירים חדשים לשמירה",
        focusProductIds:
          result.count > 0 && focusProductIds.length > 0
            ? focusProductIds
            : undefined,
      });
    },
    onError: (err, payload) => {
      setStreaming(false);
      setLastSearchStatus({
        updatedAt: new Date().toISOString(),
        runType: "navigator",
        state: "error",
        summary: "שגיאה בהרצת Navigator",
        detail: err instanceof Error ? err.message : String(err),
        scopeHint: payload.scopeHint,
      });
      setAppToast({
        id: Date.now(),
        variant: "error",
        message: `שגיאה ב-Navigator: ${err instanceof Error ? err.message : String(err)}`,
      });
    },
  });

  useEffect(() => {
    if (!request) return;
    if (lastHandledId.current === request.id) return;
    lastHandledId.current = request.id;
    const payload = request;
    setRequest(null);
    mutate(payload);
  }, [request, setRequest, mutate]);

  return null;
}
