import { useState } from "react";
import { contract, server } from "../contract";

export interface AdminAuthState {
  address: string | null;
  isAdmin: boolean;
  isVerifying: boolean;
  error: string | null;
  connect: () => Promise<void>;
  disconnect: () => void;
}

/**
 * Wallet-based admin auth via Freighter.
 * isAdmin is verified against the contract's on-chain admin address
 * (via the `get_admin` read function), not against a prop.
 *
 * @param adminAddressHint Optional hint for display purposes only. It is
 *   never used to determine admin access.
 */
export function useAdminAuth(adminAddressHint?: string): AdminAuthState {
  const [address, setAddress] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState<boolean>(false);
  const [isVerifying, setIsVerifying] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  async function fetchOnChainAdmin(): Promise<string> {
    const tx = await contract.call("get_admin");
    const simulation = await server.simulateTransaction(tx);
    if ("error" in simulation) {
      throw new Error(
        typeof simulation.error === "string"
          ? simulation.error
          : "Failed to simulate get_admin transaction."
      );
    }
    const result = (simulation as any).result;
    if (!result) {
      throw new Error("get_admin returned no result.");
    }
    // Soroban returns the value as a ScVal; use the SDK helper to decode it.
    const scVal = result.retval ?? result;
    const { scValToNative } = await import("@stellar/stellar-sdk");
    const native = scValToNative(scVal);
    if (typeof native !== "string") {
      throw new Error("get_admin returned an unexpected value.");
    }
    return native;
  }

  async function connect() {
    setError(null);
    setIsVerifying(false);
    setIsAdmin(false);

    const freighter = (window as any).freighter;
    if (!freighter) {
      setError("Freighter wallet extension not found.");
      return;
    }

    let pubKey: string;
    try {
      await freighter.setAllowed();
      pubKey = await freighter.getPublicKey();
    } catch (e: any) {
      setError(e?.message ?? "Failed to connect wallet.");
      return;
    }

    setAddress(pubKey);
    setIsVerifying(true);

    try {
      const onChainAdmin = await fetchOnChainAdmin();
      setIsAdmin(onChainAdmin === pubKey);
    } catch (e: any) {
      setError(
        e?.message ?? "Failed to verify admin status against the contract."
      );
      setIsAdmin(false);
    } finally {
      setIsVerifying(false);
    }
  }

  function disconnect() {
    setAddress(null);
    setIsAdmin(false);
    setIsVerifying(false);
    setError(null);
  }

  // adminAddressHint is intentionally unused for authorization decisions.
  void adminAddressHint;

  return {
    address,
    isAdmin,
    isVerifying,
    error,
    connect,
    disconnect,
  };
}