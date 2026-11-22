import React, { useState, useEffect, useCallback } from "react";
import { useWallet } from "../useWallet";
import { FilterBar } from "./FilterBar";
import { PaymentTable } from "./PaymentTable";
import { ErrorMessage } from "./ContractCallStatus";
import { WalletReconnectPrompt } from "./WalletReconnectPrompt";
import { fetchPayerHistory } from "../contract";
import type { PaymentRecord, PaymentFilter } from "../contract";
import { ErrorBoundary } from "./ErrorBoundary";

const PAGE_SIZE = 20;
const STATUSES = ["Any", "Completed", "PartiallyRefunded", "FullyRefunded"] as const;

type SortField = "Date" | "Amount";
type SortOrder = "Ascending" | "Descending";

function readDashboardState(search: string) {
  const params = new URLSearchParams(search);
  const status = params.get("status");
  const amountMin = Number(params.get("amount_min"));
  const amountMax = Number(params.get("amount_max"));
  const sortField = params.get("sort_field");
  const sortOrder = params.get("sort_order");

  return {
    filter: {
      status: STATUSES.includes(status as (typeof STATUSES)[number])
        ? (status as PaymentFilter["status"])
        : "Any",
      amount_min: params.has("amount_min") && Number.isFinite(amountMin) ? amountMin : undefined,
      amount_max: params.has("amount_max") && Number.isFinite(amountMax) ? amountMax : undefined,
    } satisfies PaymentFilter,
    sortField: sortField === "Amount" ? "Amount" as SortField : "Date" as SortField,
    sortOrder: sortOrder === "Ascending" ? "Ascending" as SortOrder : "Descending" as SortOrder,
  };
}

function writeDashboardState(
  filter: PaymentFilter,
  sortField: SortField,
  sortOrder: SortOrder
) {
  const url = new URL(window.location.href);
  const values: Record<string, string | undefined> = {
    status: filter.status === "Any" ? undefined : filter.status,
    amount_min: filter.amount_min?.toString(),
    amount_max: filter.amount_max?.toString(),
    sort_field: sortField === "Date" ? undefined : sortField,
    sort_order: sortOrder === "Descending" ? undefined : sortOrder,
  };

  Object.entries(values).forEach(([key, value]) => {
    if (value === undefined || value === "") url.searchParams.delete(key);
    else url.searchParams.set(key, value);
  });

  window.history.pushState(null, "", url);
}

export function PayerDashboard() {
  return (
    <ErrorBoundary>
      <PayerDashboardContent />
    </ErrorBoundary>
  );
}

function PayerDashboardContent() {
  const { address, error: walletError, status: walletStatus, showReconnectPrompt, connect, disconnect, dismissReconnectPrompt } = useWallet();

  const [records, setRecords] = useState<PaymentRecord[]>([]);
  const [cursorStack, setCursorStack] = useState<(string | null)[]>([null]);
  const [currentPage, setCurrentPage] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const [initialState] = useState(() => readDashboardState(window.location.search));
  const [filter, setFilter] = useState<PaymentFilter>(initialState.filter);
  const [sortField, setSortField] = useState<SortField>(initialState.sortField);
  const [sortOrder, setSortOrder] = useState<SortOrder>(initialState.sortOrder);

  useEffect(() => {
    const restoreState = () => {
      const state = readDashboardState(window.location.search);
      setFilter(state.filter);
      setSortField(state.sortField);
      setSortOrder(state.sortOrder);
    };

    window.addEventListener("popstate", restoreState);
    return () => window.removeEventListener("popstate", restoreState);
  }, []);

  const updateFilter = (nextFilter: PaymentFilter) => {
    setFilter(nextFilter);
    writeDashboardState(nextFilter, sortField, sortOrder);
  };

  const updateSortField = (nextSortField: SortField) => {
    setSortField(nextSortField);
    writeDashboardState(filter, nextSortField, sortOrder);
  };

  const updateSortOrder = (nextSortOrder: SortOrder) => {
    setSortOrder(nextSortOrder);
    writeDashboardState(filter, sortField, nextSortOrder);
  };

  const load = useCallback(
    async (cursor: string | null) => {
      if (!address) return;
      setLoading(true);
      setFetchError(null);
      try {
        const page = await fetchPayerHistory(address, cursor, PAGE_SIZE, filter, sortField, sortOrder);
        setRecords(page.records);
        setNextCursor(page.next_cursor);
      } catch (e: any) {
        setFetchError(e?.message ?? "Failed to load payments");
      } finally {
        setLoading(false);
      }
    },
    [address, filter, sortField, sortOrder]
  );

  // Reload from page 0 whenever filters/sort change
  useEffect(() => {
    setCursorStack([null]);
    setCurrentPage(0);
    load(null);
  }, [load]);

  const goNext = () => {
    if (!nextCursor) return;
    const newStack = [...cursorStack, nextCursor];
    setCursorStack(newStack);
    setCurrentPage(currentPage + 1);
    load(nextCursor);
  };

  const goPrev = () => {
    if (currentPage === 0) return;
    const newStack = cursorStack.slice(0, -1);
    setCursorStack(newStack);
    setCurrentPage(currentPage - 1);
    load(newStack[newStack.length - 1]);
  };

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: 24, fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ marginBottom: 4 }}>Pulsar — Payer Dashboard</h1>

      {/* Reconnect prompt — shown when wallet session expires */}
      {showReconnectPrompt && (
        <div style={{ marginBottom: 16 }}>
          <WalletReconnectPrompt
            onReconnect={connect}
            onDismiss={dismissReconnectPrompt}
          />
        </div>
      )}

      {!address ? (
        <div>
          <p style={{ color: "#64748b" }}>Connect your Freighter wallet to view your payment history.</p>
          <button
            onClick={connect}
            disabled={walletStatus === "connecting"}
            style={btnStyle("#6366f1")}
          >
            {walletStatus === "connecting" ? "Connecting…" : "Connect Freighter"}
          </button>
          {walletError && <ErrorMessage message={walletError} />}
        </div>
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
            <span style={{ fontFamily: "monospace", background: "#f1f5f9", padding: "4px 10px", borderRadius: 6 }}>
              {address.slice(0, 8)}…{address.slice(-4)}
            </span>
            <button onClick={disconnect} style={btnStyle("#94a3b8")}>
              Disconnect
            </button>
          </div>

          <FilterBar
            filter={filter}
            sortField={sortField}
            sortOrder={sortOrder}
            onChange={updateFilter}
            onSortField={updateSortField}
            onSortOrder={updateSortOrder}
          />

          {fetchError && <ErrorMessage message={fetchError} />}

          <PaymentTable records={records} loading={loading} />

          <div style={{ display: "flex", gap: 12, marginTop: 16, alignItems: "center" }}>
            <button onClick={goPrev} disabled={currentPage === 0} style={btnStyle("#64748b")}>
              ← Previous
            </button>
            <span style={{ color: "#64748b" }}>Page {currentPage + 1}</span>
            <button onClick={goNext} disabled={!nextCursor} style={btnStyle("#6366f1")}>
              Next →
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function btnStyle(bg: string): React.CSSProperties {
  return {
    background: bg,
    color: "#fff",
    border: "none",
    borderRadius: 6,
    padding: "8px 16px",
    cursor: "pointer",
    fontWeight: 600,
  };
}
