import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import { useDebounce } from "../hooks/useDebounce";
import { useSearchHistory } from "../hooks/useSearchHistory";
import { highlightMatch } from "../utils/highlightMatch";
import type { GroupedResults, SearchResult } from "../types/search";
import "./GlobalSearchBar.css";

interface GlobalSearchBarProps {
  /**
   * Async function that performs the actual search.
   * Must return results grouped by type.
   */
  onSearch: (query: string) => Promise<GroupedResults>;
  placeholder?: string;
}

const GROUPS = ["Merchants", "Payments", "Customers"] as const;

export function GlobalSearchBar({
  onSearch,
  placeholder = "Search merchants, payments, customers…",
}: GlobalSearchBarProps) {
  const inputId = useId();
  const listboxId = useId();

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GroupedResults | null>(null);
  const [loading, setLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const { history, addToHistory, clearHistory } = useSearchHistory();
  const debouncedQuery = useDebounce(query, 300);
  const trimmedQuery = query.trim();
  const trimmedDebouncedQuery = debouncedQuery.trim();

  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Flatten results into a navigable flat list
  const flatResults: SearchResult[] = results
    ? GROUPS.flatMap((g) => results[g])
    : [];

  // ── Fetch results when debounced query changes ────────────────────────────

  useEffect(() => {
    if (!trimmedDebouncedQuery) {
      setResults(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    onSearch(trimmedDebouncedQuery)
      .then((data) => {
        if (!cancelled) {
          setResults(data);
          setActiveIndex(-1);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setResults(null);
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [trimmedDebouncedQuery, onSearch]);

  // ── Close on outside click ────────────────────────────────────────────────

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // ── Keyboard navigation ───────────────────────────────────────────────────

  const handleSelectResult = useCallback(
    (result: SearchResult) => {
      addToHistory(query);
      setIsOpen(false);
      setQuery(result.title);
      // consumers can extend via onSelect prop if needed
    },
    [query, addToHistory],
  );

  // ── Submit (Enter without active suggestion, or search button) ────────────

  const handleSubmit = useCallback(
    (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const trimmed = query.trim();
      if (!trimmed) return;
      addToHistory(trimmed);
      setIsOpen(true);
    },
    [query, addToHistory],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (!isOpen) return;

      const items = flatResults.length > 0 ? flatResults : [];
      const historyItems = !trimmedQuery ? history : [];
      const navigableCount =
        items.length > 0 ? items.length : historyItems.length;

      if (navigableCount === 0 && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
        e.preventDefault();
        return;
      }

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setActiveIndex((i) => (i + 1) % navigableCount);
          break;
        case "ArrowUp":
          e.preventDefault();
          setActiveIndex((i) => (i - 1 + navigableCount) % navigableCount);
          break;
        case "Enter":
          if (activeIndex >= 0) {
            // Suggestion is active: handle it here and prevent the form
            // submit path from also writing history (avoids double-write).
            e.preventDefault();
            if (items.length > 0 && activeIndex < items.length) {
              handleSelectResult(items[activeIndex]);
            } else if (historyItems.length > 0 && activeIndex < historyItems.length) {
              setQuery(historyItems[activeIndex]);
            }
          }
          // Otherwise let the form's onSubmit handle the history write.
          break;
        case "Escape":
          setIsOpen(false);
          setActiveIndex(-1);
          inputRef.current?.blur();
          break;
      }
    },
    [isOpen, flatResults, history, trimmedQuery, activeIndex],
  );

  const handleSelectResult = useCallback(
    (result: SearchResult) => {
      addToHistory(query);
      setIsOpen(false);
      setQuery(result.title);
      // consumers can extend via onSelect prop if needed
    },
    [query, addToHistory],
  );

  const showDropdown = isOpen && (trimmedQuery || history.length > 0);
  const showHistory = !trimmedQuery && history.length > 0;
  const hasResults =
    results &&
    GROUPS.some((g) => results[g].length > 0);

  const activeResult = flatResults[activeIndex];
  const activeHistory = showHistory ? history[activeIndex] : undefined;
  const selectedAnnouncement = showHistory && activeHistory
    ? `${activeHistory}, item ${activeIndex + 1} of ${history.length} selected.`
    : activeResult
      ? `${activeResult.title}, ${activeResult.type}, item ${activeIndex + 1} of ${flatResults.length} selected.`
      : "";
  const searchAnnouncement = loading
    ? "Searching."
    : showHistory
      ? `${history.length} recent searches available. ${selectedAnnouncement}`
      : trimmedQuery && results
        ? `${flatResults.length} ${flatResults.length === 1 ? "result" : "results"} available. ${selectedAnnouncement}`
        : "";
  const optionId = (index: number) => `${listboxId}-option-${index}`;

  return (
    <div
      ref={containerRef}
      className="gsb"
      role="search"
      aria-label="Global search"
    >
      <form className="gsb__input-wrap" role="search" onSubmit={handleSubmit}>
        {/* Search icon */}
        <svg
          className="gsb__icon"
          aria-hidden="true"
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" strokeWidth="1.5" />
          <line
            x1="10.5"
            y1="10.5"
            x2="14"
            y2="14"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>

        <input
          ref={inputRef}
          id={inputId}
          type="search"
          role="combobox"
          aria-expanded={!!showDropdown}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={
            activeIndex >= 0 ? optionId(activeIndex) : undefined
          }
          aria-label="Search merchants, payments, and customers"
          autoComplete="off"
          spellCheck={false}
          className="gsb__input"
          placeholder={placeholder}
          value={query}
          onChange={(e) => {
            // Only update the query here — history is written on submit.
            setQuery(e.target.value);
            setIsOpen(true);
            setActiveIndex(-1);
          }}
          onFocus={() => setIsOpen(true)}
          onKeyDown={handleKeyDown}
        />

        {loading && (
          <span className="gsb__spinner" aria-label="Searching…" role="status" />
        )}

        {query && (
          <button
            type="button"
            className="gsb__clear"
            aria-label="Clear search"
            onClick={() => {
              setQuery("");
              setResults(null);
              setIsOpen(false);
              inputRef.current?.focus();
            }}
          >
            ×
          </button>
        )}

        <button
          type="submit"
          className="gsb__submit"
          aria-label="Submit search"
        >
          Search
        </button>
      </form>

      <span className="gsb__sr-only" role="status" aria-live="polite" aria-atomic="true">
        {searchAnnouncement}
      </span>

      {/* Dropdown */}
      {showDropdown && (
        <ul
          id={listboxId}
          role="listbox"
          aria-label="Search suggestions"
          className="gsb__dropdown"
        >
          {/* Recent searches */}
          {showHistory && (
            <>
              <li className="gsb__group-header" role="presentation">
                <span>Recent searches</span>
                <button
                  type="button"
                  className="gsb__clear-history"
                  onClick={clearHistory}
                >
                  Clear
                </button>
              </li>
              {history.map((h, i) => (
                <li
                  key={h}
                  id={optionId(i)}
                  role="option"
                  aria-selected={activeIndex === i}
                  className={`gsb__option gsb__option--history${activeIndex === i ? " gsb__option--active" : ""}`}
                  onMouseDown={() => {
                    setQuery(h);
                    setIsOpen(true);
                  }}
                >
                  <span className="gsb__history-icon" aria-hidden="true">↺</span>
                  {h}
                </li>
              ))}
            </>
          )}

          {/* Search results grouped by type */}
          {!showHistory && trimmedQuery && !loading && hasResults &&
            GROUPS.map((group) => {
              const items = results![group];
              if (!items.length) return null;
              const groupOffset = GROUPS.slice(
                0,
                GROUPS.indexOf(group),
              ).reduce((acc, g) => acc + (results![g]?.length ?? 0), 0);

              return (
                <React.Fragment key={group}>
                  <li className="gsb__group-header" role="presentation">
                    {group}
                  </li>
                  {items.map((item, i) => {
                    const idx = groupOffset + i;
                    return (
                      <li
                        key={item.id}
                        id={optionId(idx)}
                        role="option"
                        aria-selected={activeIndex === idx}
                        className={`gsb__option${activeIndex === idx ? " gsb__option--active" : ""}`}
                        onMouseDown={() => handleSelectResult(item)}
                      >
                        <span className="gsb__option-title">
                          {highlightMatch(item.title, query)}
                        </span>
                        {item.subtitle && (
                          <span className="gsb__option-subtitle">
                            {highlightMatch(item.subtitle, query)}
                          </span>
                        )}
                      </li>
                    );
                  })}
                </React.Fragment>
              );
            })}

          {/* No results */}
          {!showHistory && trimmedQuery && !loading && !hasResults && (
            <li className="gsb__empty" role="option" aria-selected={false}>
              No results for "{query}"
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
