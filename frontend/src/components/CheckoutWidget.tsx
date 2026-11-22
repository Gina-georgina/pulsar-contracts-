import React, { useState } from "react";
import { useContractCall } from "../hooks/useContractCall";
import { Spinner, ErrorMessage, SuccessBanner } from "./ContractCallStatus";

/** Supported Stellar networks for Freighter signing. */
export const STELLAR_NETWORKS = ["TESTNET", "MAINNET", "FUTURENET"] as const;
export type StellarNetwork = (typeof STELLAR_NETWORKS)[number];

/** Compile-time guard: fails if a value is not a valid StellarNetwork. */
function assertNetwork(network: string): StellarNetwork {
  if (!(STELLAR_NETWORKS as readonly string[]).includes(network)) {
    throw new Error(
      `Invalid Stellar network "${network}". Expected one of: ${STELLAR_NETWORKS.join(", ")}.`,
    );
  }
  return network as StellarNetwork;
}

/** Resolve the default network from VITE_STELLAR_NETWORK, falling back to TESTNET. */
export const DEFAULT_STELLAR_NETWORK: StellarNetwork = assertNetwork(
  (import.meta.env.VITE_STELLAR_NETWORK as string | undefined) ?? "TESTNET",
);

export interface CheckoutWidgetProps {
  /** Merchant-assigned order identifier. */
  orderId: string;
  /** Payment amount in the smallest token unit. */
  amount: number;
  /** Token contract address (Stellar asset). */
  token: string;
  /** Merchant's Stellar public key. */
  merchantAddress: string;
  /**
   * Stellar network used when signing with Freighter.
   * Defaults to VITE_STELLAR_NETWORK (or "TESTNET" if unset).
   */
  network?: StellarNetwork;
  /** Called with the transaction hash on successful submission. */
  onSuccess?: (txHash: string) => void;
  /** Called with a human-readable error message on failure. */
  onError?: (message: string) => void;
}

/**
 * Embeddable checkout widget.
 *
 * Drop-in React component that handles Freighter wallet connection, order
 * signing, and contract submission. Accepts orderId, amount, token, and
 * merchantAddress props, and emits onSuccess / onError callbacks.
 *
 * Usage:
 * ```tsx
 * <CheckoutWidget
 *   orderId="order_123"
 *   amount={1000}
 *   token="USDC_CONTRACT_ADDRESS"
 *   merchantAddress="GMERCHANT..."
 *   onSuccess={(tx) => console.log("paid", tx)}
 *   onError={(msg) => console.error(msg)}
 * />
 * ```
 */
export function CheckoutWidget({
  orderId,
  amount,
  token,
  merchantAddress,
  network = DEFAULT_STELLAR_NETWORK,
  onSuccess,
  onError,
}: CheckoutWidgetProps) {
  // Compile-time guard: `network` is typed as StellarNetwork, so an invalid
  // or missing value fails TypeScript compilation.
  const resolvedNetwork: StellarNetwork = network;
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const { state, execute, reset } = useContractCall<null>();

  async function connectWallet() {
    const freighter = (window as any).freighter;
    if (!freighter) {
      alert("Freighter wallet extension not found. Please install it.");
      return;
    }
    await freighter.setAllowed();
    const address = await freighter.getPublicKey();
    setWalletAddress(address);
  }

  async function handlePay() {
    if (!walletAddress) return;

    await execute(async () => {
      const freighter = (window as any).freighter;

      // Build the order payload
      const order = {
        order_id: orderId,
        merchant_address: merchantAddress,
        payer: walletAddress,
        token,
        amount,
        description: `Payment for order ${orderId}`,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
      };

      // Sign the order with Freighter
      const orderJson = JSON.stringify(order);
      const { signedXDR } = await freighter.signTransaction(orderJson, {
        network: resolvedNetwork,
      });

      // Submit to contract (replace with actual @stellar/stellar-sdk call)
      const txHash = await submitPayment({ order, signature: signedXDR });

      // Fire success callback inside the executor so the txHash is available
      // immediately and before React re-renders with the success state.
      onSuccess?.(txHash);
      return { result: null, txHash };
    });
    // Note: onError is wired via useEffect below so it fires after React
    // has actually committed the error state — avoiding a stale-closure bug
    // where state.status is checked synchronously before the state update.
  }

  // Fire onError callback after the state update has been committed.
  // Using a ref-flag avoids calling the callback on the initial render.
  const prevStatusRef = React.useRef(state.status);
  React.useEffect(() => {
    if (
      prevStatusRef.current !== "error" &&
      state.status === "error" &&
      onError
    ) {
      onError((state as Extract<typeof state, { status: "error" }>).message);
    }
    prevStatusRef.current = state.status;
  }, [state, onError]);

  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 max-w-sm w-full shadow-sm space-y-4">
      <h2 className="text-lg font-semibold text-[var(--color-text)]">Checkout</h2>

      <dl className="text-sm space-y-1 text-[var(--color-text-muted)]">
        <div className="flex justify-between">
          <dt>Order</dt>
          <dd className="font-mono text-[var(--color-text)]">{orderId}</dd>
        </div>
        <div className="flex justify-between">
          <dt>Amount</dt>
          <dd className="font-medium text-[var(--color-text)]">{amount}</dd>
        </div>
        <div className="flex justify-between">
          <dt>Token</dt>
          <dd className="font-mono truncate max-w-[160px] text-[var(--color-text)]">{token}</dd>
        </div>
      </dl>

      {state.status === "success" && <SuccessBanner txHash={state.txHash} />}
      {state.status === "error" && <ErrorMessage message={state.message} />}

      {state.status !== "success" && (
        <>
          {!walletAddress ? (
            <button
              onClick={connectWallet}
              className="w-full rounded-lg bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white py-2 px-4 text-sm font-medium transition-colors"
            >
              Connect Wallet
            </button>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-[var(--color-text-muted)] truncate">
                Connected: <span className="font-mono">{walletAddress}</span>
              </p>
              <button
                onClick={handlePay}
                disabled={state.status === "loading"}
                className="w-full rounded-lg bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] disabled:opacity-50 text-white py-2 px-4 text-sm font-medium transition-colors flex items-center justify-center gap-2"
              >
                {state.status === "loading" ? <Spinner label="Submitting…" /> : "Pay Now"}
              </button>
            </div>
          )}
        </>
      )}

      {state.status === "error" && (
        <button onClick={reset} className="text-xs text-[var(--color-text-muted)] underline">
          Try again
        </button>
      )}
    </div>
  );
}

/** Stub — replace with actual @stellar/stellar-sdk contract invocation. */
async function submitPayment(_payload: {
  order: object;
  signature: string;
}): Promise<string> {
  throw new Error("submitPayment: not yet wired to contract SDK.");
}
