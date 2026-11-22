import React, { useState } from "react";
import { useAdminAuth } from "../hooks/useAdminAuth";
import { useAuditLog } from "../hooks/useAuditLog";
import { useContractCall } from "../hooks/useContractCall";
import { Spinner, ErrorMessage, SuccessBanner } from "./ContractCallStatus";
import { ErrorBoundary } from "./ErrorBoundary";

interface GlobalStats {
  totalPayments: number;
  totalVolume: number;
  totalRefunds: number;
}

interface Merchant {
  address: string;
  name: string;
  active: boolean;
}

interface AdminPanelProps {
  /** The on-chain admin address used to verify wallet auth. */
  adminAddress: string;
  /** Async fn to fetch global stats from the contract. */
  fetchStats: () => Promise<GlobalStats>;
  /** Async fn to fetch merchant list. */
  fetchMerchants: () => Promise<Merchant[]>;
  /** Async fn to deactivate a merchant. Returns txHash. */
  deactivateMerchant: (address: string, caller: string) => Promise<string>;
  /** Async fn to trigger cleanup. Returns txHash. */
  triggerCleanup: (caller: string) => Promise<string>;
}

export function AdminPanel(props: AdminPanelProps) {
  return (
    <ErrorBoundary>
      <AdminPanelContent {...props} />
    </ErrorBoundary>
  );
}

function AdminPanelContent({
  adminAddress,
  fetchStats,
  fetchMerchants,
  deactivateMerchant,
  triggerCleanup,
}: AdminPanelProps) {
  const auth = useAdminAuth(adminAddress);
  const { log, record } = useAuditLog();
  const statsCall = useContractCall<GlobalStats>();
  const cleanupCall = useContractCall<null>();
  const deactivateCall = useContractCall<null>();

  const [stats, setStats] = useState<GlobalStats | null>(null);
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [tab, setTab] = useState<"stats" | "merchants" | "log">("stats");

  async function loadStats() {
    await statsCall.execute(async () => {
      const data = await fetchStats();
      setStats(data);
      record("fetch_stats", auth.address!);
      return { result: data, txHash: "" };
    });
  }

  async function loadMerchants() {
    const list = await fetchMerchants();
    setMerchants(list);
    record("fetch_merchants", auth.address!);
  }

  async function handleDeactivate(merchantAddress: string) {
    await deactivateCall.execute(async () => {
      const txHash = await deactivateMerchant(merchantAddress, auth.address!);
      record("deactivate_merchant", auth.address!, merchantAddress);
      setMerchants(prev =>
        prev.map(m => (m.address === merchantAddress ? { ...m, active: false } : m))
      );
      return { result: null, txHash };
    });
  }

  async function handleCleanup() {
    await cleanupCall.execute(async () => {
      const txHash = await triggerCleanup(auth.address!);
      record("cleanup_expired_payments", auth.address!);
      return { result: null, txHash };
    });
  }

  if (!auth.address) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[200px] gap-4">
        <p className="text-[var(--color-text-muted)] text-sm">Connect your admin wallet to continue.</p>
        <button
          onClick={auth.connect}
          className="rounded-lg bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white py-2 px-6 text-sm font-medium transition-colors"
        >
          Connect Wallet
        </button>
      </div>
    );
  }

  if (!auth.isAdmin) {
    return (
      <div className="rounded-md bg-red-50 dark:bg-red-900/30 border border-red-300 dark:border-red-700 p-4 text-sm text-red-700 dark:text-red-300">
        Connected address is not the contract admin.{" "}
        <button onClick={auth.disconnect} className="underline">Disconnect</button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-[var(--color-text)]">Admin Panel</h1>
        <div className="flex items-center gap-3 text-xs text-[var(--color-text-muted)]">
          <span className="font-mono truncate max-w-[160px]">{auth.address}</span>
          <button onClick={auth.disconnect} className="underline">Disconnect</button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-[var(--color-border)]">
        {(["stats", "merchants", "log"] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`pb-2 px-3 text-sm font-medium capitalize transition-colors ${
              tab === t
                ? "border-b-2 border-[var(--color-primary)] text-[var(--color-primary)]"
                : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Stats tab */}
      {tab === "stats" && (
        <div className="space-y-3">
          <button
            onClick={loadStats}
            disabled={statsCall.state.status === "loading"}
            className="rounded-lg bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] disabled:opacity-50 text-white py-1.5 px-4 text-sm font-medium transition-colors flex items-center gap-2"
          >
            {statsCall.state.status === "loading" ? <Spinner label="Loading…" /> : "Refresh Stats"}
          </button>
          {statsCall.state.status === "error" && <ErrorMessage message={statsCall.state.message} />}
          {stats && (
            <dl className="grid grid-cols-3 gap-4">
              {[
                { label: "Total Payments", value: stats.totalPayments },
                { label: "Total Volume", value: stats.totalVolume },
                { label: "Total Refunds", value: stats.totalRefunds },
              ].map(({ label, value }) => (
                <div key={label} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
                  <dt className="text-xs text-[var(--color-text-muted)]">{label}</dt>
                  <dd className="text-2xl font-bold text-[var(--color-text)] mt-1">{value}</dd>
                </div>
              ))}
            </dl>
          )}
          <div className="pt-2">
            <button
              onClick={handleCleanup}
              disabled={cleanupCall.state.status === "loading"}
              className="rounded-lg border border-[var(--color-border)] hover:bg-[var(--color-surface)] disabled:opacity-50 text-[var(--color-text)] py-1.5 px-4 text-sm transition-colors flex items-center gap-2"
            >
              {cleanupCall.state.status === "loading" ? <Spinner label="Running…" /> : "Trigger Cleanup"}
            </button>
            {cleanupCall.state.status === "success" && <SuccessBanner txHash={cleanupCall.state.txHash} />}
            {cleanupCall.state.status === "error" && <ErrorMessage message={cleanupCall.state.message} />}
          </div>
        </div>
      )}

      {/* Merchants tab */}
      {tab === "merchants" && (
        <div className="space-y-3">
          <button
            onClick={loadMerchants}
            className="rounded-lg bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white py-1.5 px-4 text-sm font-medium transition-colors"
          >
            Load Merchants
          </button>
          {deactivateCall.state.status === "success" && <SuccessBanner txHash={deactivateCall.state.txHash} />}
          {deactivateCall.state.status === "error" && <ErrorMessage message={deactivateCall.state.message} />}
          {merchants.length > 0 && (
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-left text-[var(--color-text-muted)] border-b border-[var(--color-border)]">
                  <th className="py-2 pr-4">Address</th>
                  <th className="py-2 pr-4">Name</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2">Action</th>
                </tr>
              </thead>
              <tbody>
                {merchants.map(m => (
                  <tr key={m.address} className="border-b border-[var(--color-border)] text-[var(--color-text)]">
                    <td className="py-2 pr-4 font-mono text-xs truncate max-w-[140px]">{m.address}</td>
                    <td className="py-2 pr-4">{m.name}</td>
                    <td className="py-2 pr-4">
                      <span className={`text-xs font-medium ${m.active ? "text-green-600 dark:text-green-400" : "text-red-500 dark:text-red-400"}`}>
                        {m.active ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="py-2">
                      {m.active && (
                        <button
                          onClick={() => handleDeactivate(m.address)}
                          disabled={deactivateCall.state.status === "loading"}
                          className="text-xs text-red-600 dark:text-red-400 underline disabled:opacity-50"
                        >
                          Deactivate
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Audit log tab */}
      {tab === "log" && (
        <div className="space-y-2">
          {log.length === 0 ? (
            <p className="text-sm text-[var(--color-text-muted)]">No actions recorded yet.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {log.map(entry => (
                <li key={entry.id} className="flex gap-3 text-[var(--color-text)]">
                  <span className="text-[var(--color-text-muted)] tabular-nums">
                    {new Date(entry.timestamp).toLocaleTimeString()}
                  </span>
                  <span className="font-mono text-xs bg-[var(--color-surface)] border border-[var(--color-border)] rounded px-1">
                    {entry.action}
                  </span>
                  {entry.detail && <span className="text-[var(--color-text-muted)] truncate">{entry.detail}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
