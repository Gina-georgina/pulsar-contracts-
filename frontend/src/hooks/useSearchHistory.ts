import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "pulsar_search_history";

export const MAX_HISTORY_ENTRIES = 50;

export function useSearchHistory() {
  const [history, setHistory] = useState<string[]>(() => {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
      if (!Array.isArray(parsed)) return [];
      return parsed.slice(0, MAX_HISTORY_ENTRIES);
    } catch {
      return [];
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(history.slice(0, MAX_HISTORY_ENTRIES)),
      );
    } catch {
      // storage unavailable — silently ignore
    }
  }, [history]);

  const addToHistory = useCallback((query: string) => {
    const trimmed = query.trim();
    if (!trimmed) return;
    setHistory((prev) => {
      const filtered = prev.filter((h) => h !== trimmed);
      return [trimmed, ...filtered].slice(0, MAX_HISTORY_ENTRIES);
    });
  }, []);

  const clearHistory = useCallback(() => setHistory([]), []);

  return { history, addToHistory, clearHistory };
}