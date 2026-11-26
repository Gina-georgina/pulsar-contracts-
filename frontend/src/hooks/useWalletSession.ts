import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Minimal shape of the Freighter API we rely on. The real package
 * (`@stellar/freighter-api`) exposes these functions; we keep the surface
 * small and defensive so the hook degrades gracefully when the API (or a
 * particular event) is unavailable.
 */
interface FreighterApi {
  isConnected?: () => Promise<boolean> | boolean;
  getPublicKey?: () => Promise<string> | string;
  // Event subscription helpers (may or may not exist depending on version).
  onAccountChanged?: (cb: (publicKey: string | null) => void) => (() => void) | void;
  onNetworkChanged?: (cb: (network: string | null) => void) => (() => void) | void;
  // Some versions expose a generic event emitter style API.
  addEventListener?: (event: string, cb: (...args: unknown[]) => void) => void;
  removeEventListener?: (event: string, cb: (...args: unknown[]) => void) => void;
}

const POLL_INTERVAL_MS = 60_000;

/**
 * Attempt to load the Freighter API. Returns `null` when the package is not
 * installed or cannot be resolved, so callers can fall back to polling or
 * simply treat the wallet as disconnected.
 */
function loadFreighter(): FreighterApi | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
    const mod = require('@stellar/freighter-api');
    return (mod?.default ?? mod) as FreighterApi;
  } catch {
    return null;
  }
}

async function safeIsConnected(api: FreighterApi | null): Promise<boolean> {
  if (!api?.isConnected) return false;
  try {
    const result = await api.isConnected();
    return Boolean(result);
  } catch {
    return false;
  }
}

export interface UseWalletSessionResult {
  /** True when a previously-connected wallet is detected as disconnected. */
  disconnected: boolean;
  /** Attempt to reconnect; resolves to true on success. */
  reconnect: () => Promise<boolean>;
  /** Manually mark the session as disconnected (e.g. after a failed call). */
  markDisconnected: () => void;
}

/**
 * Detects Freighter wallet disconnects / session expiry and exposes a
 * reconnect helper. Subscribes to `accountChanged` / `networkChanged` events
 * when available and falls back to polling `isConnected()` every 60 s while a
 * wallet is connected.
 */
export function useWalletSession(): UseWalletSessionResult {
  const [disconnected, setDisconnected] = useState(false);

  const apiRef = useRef<FreighterApi | null>(null);
  const wasConnectedRef = useRef(false);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

  const clearPoll = useCallback(() => {
    if (pollTimerRef.current !== null) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const handleDisconnect = useCallback(() => {
    if (!mountedRef.current) return;
    wasConnectedRef.current = false;
    setDisconnected(true);
    clearPoll();
  }, [clearPoll]);

  const startPolling = useCallback(() => {
    clearPoll();
    pollTimerRef.current = setInterval(async () => {
      const api = apiRef.current;
      const connected = await safeIsConnected(api);
      if (!mountedRef.current) return;
      if (!connected && wasConnectedRef.current) {
        handleDisconnect();
      } else if (connected) {
        wasConnectedRef.current = true;
      }
    }, POLL_INTERVAL_MS);
  }, [clearPoll, handleDisconnect]);

  const reconnect = useCallback(async (): Promise<boolean> => {
    const api = apiRef.current ?? loadFreighter();
    apiRef.current = api;

    if (!api) {
      if (mountedRef.current) setDisconnected(true);
      return false;
    }

    let connected = await safeIsConnected(api);

    // If isConnected is unavailable, fall back to checking for a public key.
    if (!connected && !api.isConnected && api.getPublicKey) {
      try {
        const key = await api.getPublicKey();
        connected = Boolean(key);
      } catch {
        connected = false;
      }
    }

    if (!mountedRef.current) return connected;

    if (connected) {
      wasConnectedRef.current = true;
      setDisconnected(false);
      startPolling();
    } else {
      wasConnectedRef.current = false;
      setDisconnected(true);
      clearPoll();
    }

    return connected;
  }, [clearPoll, startPolling]);

  const markDisconnected = useCallback(() => {
    handleDisconnect();
  }, [handleDisconnect]);

  // Initialise: detect current connection state and wire up event listeners.
  useEffect(() => {
    mountedRef.current = true;

    const api = loadFreighter();
    apiRef.current = api;

    const cleanups: Array<() => void> = [];

    // Subscribe to account changes (disconnect => null/empty key).
    if (api?.onAccountChanged) {
      const unsubscribe = api.onAccountChanged((publicKey) => {
        if (!mountedRef.current) return;
        if (!publicKey) {
          handleDisconnect();
        } else {
          wasConnectedRef.current = true;
          setDisconnected(false);
          startPolling();
        }
      });
      if (typeof unsubscribe === 'function') cleanups.push(unsubscribe);
    } else if (api?.addEventListener && api?.removeEventListener) {
      const onAccountChanged = (publicKey: unknown) => {
        if (!mountedRef.current) return;
        if (!publicKey) {
          handleDisconnect();
        } else {
          wasConnectedRef.current = true;
          setDisconnected(false);
          startPolling();
        }
      };
      api.addEventListener('accountChanged', onAccountChanged);
      cleanups.push(() => api.removeEventListener?.('accountChanged', onAccountChanged));
    }

    // Subscribe to network changes; a network switch invalidates the session.
    if (api?.onNetworkChanged) {
      const unsubscribe = api.onNetworkChanged(() => {
        if (!mountedRef.current) return;
        // A network change means the user must re-approve / reconnect.
        handleDisconnect();
      });
      if (typeof unsubscribe === 'function') cleanups.push(unsubscribe);
    } else if (api?.addEventListener && api?.removeEventListener) {
      const onNetworkChanged = () => {
        if (!mountedRef.current) return;
        handleDisconnect();
      };
      api.addEventListener('networkChanged', onNetworkChanged);
      cleanups.push(() => api.removeEventListener?.('networkChanged', onNetworkChanged));
    }

    // Establish initial state and start polling if already connected.
    (async () => {
      const connected = await safeIsConnected(api);
      if (!mountedRef.current) return;
      if (connected) {
        wasConnectedRef.current = true;
        setDisconnected(false);
        startPolling();
      } else {
        wasConnectedRef.current = false;
        // Only surface the prompt if we previously believed we were connected.
        setDisconnected(false);
      }
    })();

    return () => {
      mountedRef.current = false;
      clearPoll();
      cleanups.forEach((fn) => {
        try {
          fn();
        } catch {
          // ignore cleanup errors
        }
      });
    };
  }, [clearPoll, handleDisconnect, startPolling]);

  return { disconnected, reconnect, markDisconnected };
}

export default useWalletSession;