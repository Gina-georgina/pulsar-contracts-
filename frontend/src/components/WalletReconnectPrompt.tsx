import React, { useCallback, useEffect, useRef, useState } from "react";

/**
 * Minimal shape of the Freighter API we rely on. Kept structural so tests and
 * consumers can inject a mock without importing the real package.
 */
export interface FreighterLike {
  isConnected?: () => Promise<boolean>;
  isAllowed?: () => Promise<boolean>;
  requestAccess?: () => Promise<unknown>;
  getPublicKey?: () => Promise<string>;
  getNetwork?: () => Promise<string>;
}

export interface UseWalletSessionOptions {
  /** Freighter API object. Defaults to `window.freighter` when available. */
  freighter?: FreighterLike | null;
  /** Poll interval in ms. Defaults to 60_000 (60 s). */
  pollIntervalMs?: number;
  /** Whether automatic detection is enabled. Defaults to true. */
  enabled?: boolean;
  /** Called when a disconnection is detected. */
  onDisconnect?: () => void;
  /** Called after a successful reconnect. */
  onReconnect?: () => void;
}

export interface UseWalletSessionResult {
  /** True when the wallet is known to be disconnected / session expired. */
  isDisconnected: boolean;
  /** True while a reconnect attempt is in flight. */
  isReconnecting: boolean;
  /** Last error from a reconnect attempt, if any. */
  error: Error | null;
  /** Attempt to re-establish the wallet session. Resolves true on success. */
  reconnect: () => Promise<boolean>;
  /** Manually mark the session as disconnected (e.g. after a failed call). */
  markDisconnected: () => void;
  /** Manually mark the session as connected. */
  markConnected: () => void;
}

function resolveFreighter(
  provided: FreighterLike | null | undefined
): FreighterLike | null {
  if (provided !== undefined) return provided;
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    freighter?: FreighterLike;
    freighterApi?: FreighterLike;
  };
  return w.freighter ?? w.freighterApi ?? null;
}

async function checkConnection(api: FreighterLike | null): Promise<boolean> {
  if (!api) return false;
  try {
    if (typeof api.isConnected === "function") {
      const connected = await api.isConnected();
      if (!connected) return false;
    }
    if (typeof api.isAllowed === "function") {
      const allowed = await api.isAllowed();
      if (!allowed) return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Encapsulates wallet session detection for Freighter: polls
 * `freighter.isConnected()` (default every 60 s), listens for
 * `accountChanged` / `networkChanged` events when available, and exposes a
 * `reconnect` action that re-requests access.
 */
export function useWalletSession(
  options: UseWalletSessionOptions = {}
): UseWalletSessionResult {
  const {
    freighter,
    pollIntervalMs = 60_000,
    enabled = true,
    onDisconnect,
    onReconnect,
  } = options;

  const api = resolveFreighter(freighter);

  const [isDisconnected, setIsDisconnected] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const mountedRef = useRef(true);
  const onDisconnectRef = useRef(onDisconnect);
  const onReconnectRef = useRef(onReconnect);

  useEffect(() => {
    onDisconnectRef.current = onDisconnect;
    onReconnectRef.current = onReconnect;
  }, [onDisconnect, onReconnect]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const markDisconnected = useCallback(() => {
    setIsDisconnected((prev) => {
      if (!prev) onDisconnectRef.current?.();
      return true;
    });
  }, []);

  const markConnected = useCallback(() => {
    setIsDisconnected(false);
    setError(null);
  }, []);

  // Poll connection state.
  useEffect(() => {
    if (!enabled || !api) return;

    let cancelled = false;

    const runCheck = async () => {
      const connected = await checkConnection(api);
      if (cancelled || !mountedRef.current) return;
      if (connected) {
        setIsDisconnected((prev) => {
          if (prev) {
            setError(null);
            onReconnectRef.current?.();
          }
          return false;
        });
      } else {
        setIsDisconnected((prev) => {
          if (!prev) onDisconnectRef.current?.();
          return true;
        });
      }
    };

    void runCheck();
    const interval = setInterval(runCheck, pollIntervalMs);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [api, enabled, pollIntervalMs]);

  // Listen for Freighter account/network change events when available.
  useEffect(() => {
    if (!enabled || !api) return;

    const w = window as unknown as {
      addEventListener?: (type: string, listener: () => void) => void;
      removeEventListener?: (type: string, listener: () => void) => void;
    };
    if (typeof w.addEventListener !== "function") return;

    const handleChange = () => {
      void checkConnection(api).then((connected) => {
        if (!mountedRef.current) return;
        if (connected) {
          setIsDisconnected((prev) => {
            if (prev) {
              setError(null);
              onReconnectRef.current?.();
            }
            return false;
          });
        } else {
          setIsDisconnected((prev) => {
            if (!prev) onDisconnectRef.current?.();
            return true;
          });
        }
      });
    };

    w.addEventListener("accountChanged", handleChange);
    w.addEventListener("networkChanged", handleChange);

    return () => {
      w.removeEventListener?.("accountChanged", handleChange);
      w.removeEventListener?.("networkChanged", handleChange);
    };
  }, [api, enabled]);

  const reconnect = useCallback(async (): Promise<boolean> => {
    if (!api) {
      const err = new Error("Freighter wallet is not available.");
      setError(err);
      return false;
    }

    setIsReconnecting(true);
    setError(null);

    try {
      if (typeof api.requestAccess === "function") {
        await api.requestAccess();
      }
      const connected = await checkConnection(api);
      if (!mountedRef.current) return connected;

      if (connected) {
        setIsDisconnected(false);
        setError(null);
        onReconnectRef.current?.();
        return true;
      }

      const err = new Error("Wallet reconnect failed.");
      setError(err);
      setIsDisconnected(true);
      return false;
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      if (mountedRef.current) {
        setError(err);
        setIsDisconnected(true);
      }
      return false;
    } finally {
      if (mountedRef.current) setIsReconnecting(false);
    }
  }, [api]);

  return {
    isDisconnected,
    isReconnecting,
    error,
    reconnect,
    markDisconnected,
    markConnected,
  };
}

export interface WalletReconnectPromptProps {
  /** Called when the user clicks "Reconnect". */
  onReconnect?: () => void;
  /** Called when the user dismisses the prompt. */
  onDismiss?: () => void;
  /** Optional injected Freighter API (defaults to `window.freighter`). */
  freighter?: FreighterLike | null;
  /** Poll interval in ms. Defaults to 60_000. */
  pollIntervalMs?: number;
  /** Whether automatic detection is enabled. Defaults to true. */
  enabled?: boolean;
  /** Force the prompt visible regardless of detection (useful for tests). */
  forceVisible?: boolean;
}

/**
 * Banner shown when the connected wallet session has expired or the wallet
 * has been disconnected. Prompts the user to reconnect or dismiss.
 *
 * Uses `useWalletSession` to automatically detect disconnection and to
 * auto-hide once a reconnect succeeds.
 */
export function WalletReconnectPrompt({
  onReconnect,
  onDismiss,
  freighter,
  pollIntervalMs,
  enabled,
  forceVisible,
}: WalletReconnectPromptProps) {
  const [dismissed, setDismissed] = useState(false);

  const session = useWalletSession({
    freighter,
    pollIntervalMs,
    enabled,
    onReconnect: () => {
      setDismissed(false);
      onReconnect?.();
    },
  });

  const visible = forceVisible || (session.isDisconnected && !dismissed);

  const handleReconnect = useCallback(async () => {
    setDismissed(false);
    onReconnect?.();
    await session.reconnect();
  }, [onReconnect, session]);

  const handleDismiss = useCallback(() => {
    setDismissed(true);
    onDismiss?.();
  }, [onDismiss]);

  if (!visible) return null;

  return (
    <div
      role="alert"
      className="rounded-md bg-yellow-50 dark:bg-yellow-900/30 border border-yellow-300 dark:border-yellow-700 p-3 flex items-center justify-between gap-4 text-sm text-yellow-800 dark:text-yellow-200"
    >
      <span>
        ⚠️ Your wallet session has expired. Please reconnect to continue.
      </span>
      <div className="flex gap-2 shrink-0">
        <button
          onClick={handleReconnect}
          disabled={session.isReconnecting}
          className="rounded bg-yellow-600 hover:bg-yellow-700 disabled:opacity-60 disabled:cursor-not-allowed text-white px-3 py-1 text-xs font-medium transition-colors"
        >
          {session.isReconnecting ? "Reconnecting…" : "Reconnect"}
        </button>
        <button
          onClick={handleDismiss}
          className="rounded border border-yellow-400 dark:border-yellow-600 hover:bg-yellow-100 dark:hover:bg-yellow-900/50 px-3 py-1 text-xs transition-colors"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}

export default WalletReconnectPrompt;