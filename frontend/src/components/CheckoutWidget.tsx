import React, { useState } from "react";
import {
  SorobanRpc,
  TransactionBuilder,
  Account,
  nativeToScVal,
  Address,
  xdr,
} from "@stellar/stellar-sdk";
import { useContractCall } from "../hooks/useContractCall";
import { Spinner, ErrorMessage, SuccessBanner } from "./ContractCallStatus";
import { server, contract } from "../contract";

export interface CheckoutWidgetProps {
  /** Merchant-assigned order identifier. */
  orderId: string;
  /** Payment amount in the smallest token unit. */
  amount: number;
  /** Token contract address (Stellar asset). */
  token: string;
  /** Merchant's Stellar public key. */
  merchantAddress: string;
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
  onSuccess,
  onError,
}: CheckoutWidgetProps) {
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
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
      const order = {
        order_id: orderId,
        merchant_address: merchantAddress,
        payer: walletAddress,
        token,
        amount,
        description: `Payment for order ${orderId}`,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
      };

      const txHash = await submitPayment({ order, payer: walletAddress });

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
                onClick={() => setConfirmOpen(true)}
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
      {confirmOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 space-y-3 max-w-sm w-full">
            <h3 className="font-semibold">Confirm Payment</h3>
            <p>Type: Payment</p>
            <p>Amount: {amount}</p>
            <p>Recipient: {merchantAddress}</p>
            <p>Estimated fees: ~2.0 XLM</p>
            <div className="flex gap-2">
              <button onClick={() => { setConfirmOpen(false); handlePay(); }} className="flex-1 bg-blue-600 text-white py-2 rounded">Confirm</button>
              <button onClick={() => setConfirmOpen(false)} className="flex-1 border py-2 rounded">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Polling interval and overall timeout for transaction confirmation. */
const POLL_INTERVAL_MS = 2000;
const CONFIRM_TIMEOUT_MS = 60_000;

/**
 * Invoke the contract's `pay` method with the order details, sign the prepared
 * transaction via Freighter, submit it, and poll until it is confirmed.
 *
 * @returns the confirmed transaction hash.
 */
export async function submitPayment(payload: {
  order: {
    order_id: string;
    merchant_address: string;
    payer: string;
    token: string;
    amount: number;
    description: string;
    expires_at: number;
  };
  payer: string;
}): Promise<string> {
  const { order, payer } = payload;

  const freighter = (window as any).freighter;
  if (!freighter) {
    throw new Error("Freighter wallet extension not found. Please install it.");
  }

  // Load the payer account to obtain the current sequence number.
  const account = await server.getAccount(payer);

  // Build the contract invocation for `pay(order_id, merchant, payer, token, amount)`.
  const tx = new TransactionBuilder(account, {
    fee: "1000000",
    networkPassphrase: (server as any).serverURL?.includes?.("futurenet")
      ? "Test SDF Future Network ; October 2022"
      : "Test SDF Network ; September 2015",
  })
    .addOperation(
      contract.call(
        "pay",
        nativeToScVal(order.order_id, { type: "string" }),
        new Address(order.merchant_address).toScVal(),
        new Address(order.payer).toScVal(),
        new Address(order.token).toScVal(),
        nativeToScVal(order.amount, { type: "i128" }),
      ),
    )
    .setTimeout(30)
    .build();

  // Simulate + assemble the transaction (adds footprint and resource fees).
  const prepared = await server.prepareTransaction(tx);

  // Sign the prepared XDR with Freighter.
  const signed = await freighter.signTransaction(prepared.toXDR(), {
    network: "TESTNET",
  });
  const signedXDR: string =
    typeof signed === "string" ? signed : signed?.signedXDR ?? signed?.signedTxXdr;
  if (!signedXDR) {
    throw new Error("Freighter did not return a signed transaction.");
  }

  // Submit the signed transaction.
  const sendResponse = await server.sendTransaction(
    TransactionBuilder.fromXDR(signedXDR, prepared.networkPassphrase),
  );

  if (sendResponse.status === "ERROR") {
    throw new Error(
      `Transaction submission failed: ${JSON.stringify(sendResponse.errorResult ?? sendResponse)}`,
    );
  }

  const hash = sendResponse.hash;

  // Poll until confirmed or failed.
  const deadline = Date.now() + CONFIRM_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const result = await server.getTransaction(hash);

    if (result.status === SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
      return hash;
    }
    if (result.status === SorobanRpc.Api.GetTransactionStatus.FAILED) {
      throw new Error(`Transaction ${hash} failed on-chain.`);
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  throw new Error(
    `Timed out waiting for transaction ${hash} to confirm after ${CONFIRM_TIMEOUT_MS}ms.`,
  );
}
