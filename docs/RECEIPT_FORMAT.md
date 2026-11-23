# Payment Receipt Format

This document defines the data and format used to generate a payment
receipt for a completed payment, as required by issue MISC-010.

## On-chain data source

The contract exposes `get_payment_receipt(caller, order_id)` in
`contracts/payment-processing-contract/src/lib.rs`, which returns a
`PaymentReceipt`. The authoritative definition of that struct is in
[`contracts/payment-processing-contract/src/types.rs`](../contracts/payment-processing-contract/src/types.rs)
(see the `PaymentReceipt` struct); the table below mirrors it exactly:

| Field             | Type           | Description                                              |
|-------------------|----------------|------------------------------------------------------------|
| `order_id`        | `Bytes`        | Unique order identifier.                                    |
| `amount`          | `i128`         | Payment amount, in the token's smallest unit (stroops).      |
| `token`           | `Address`      | Contract address of the token used for payment.              |
| `merchant_address`| `Address`      | The merchant's Stellar address.                              |
| `merchant_name`   | `String`       | The merchant's registered display name.                      |
| `payer`           | `Address`      | The payer's Stellar address.                                 |
| `status`          | `PaymentStatus`| Completed / Refunded / PartiallyRefunded, at time of query.   |
| `paid_at`         | `u64`          | Unix timestamp (seconds) the payment was recorded.            |

Access control matches `get_payment_by_id`: only the payer, the
merchant, or an admin may request a receipt for a given `order_id`
(`PaymentError::Unauthorized` otherwise).

> **Note:** `tx_hash` is **NOT** an on-chain field. It is not part of
> `PaymentReceipt` and is never returned by `get_payment_receipt`. Any
> receipt format that lists `tx_hash` alongside the fields above is
> describing an *enriched* off-chain record, not the contract's output.

## Why the transaction hash is not returned by the contract

A Soroban contract cannot observe the hash of the Stellar transaction
that invoked it, so `tx_hash` is intentionally **not** a field on
`PaymentReceipt` (this is called out explicitly in the struct
documentation in
[`types.rs`](../contracts/payment-processing-contract/src/types.rs)).
The off-chain service that renders the PDF (see below) must resolve it
independently from the **Stellar transaction envelope**, e.g. by
looking up the `payment_processed` event (see the event emitted in
`process_payment_with_signature`) via Horizon or an indexer and reading
the enclosing transaction's hash from there.

## Enriching the on-chain receipt with `tx_hash` (indexer example)

The following TypeScript example shows how an indexer/service fetches
the `payment_processed` event for an order, reads the hash of the
transaction that emitted it, and merges that hash with the on-chain
receipt returned by `get_payment_receipt`:

```ts
import { Horizon, SorobanRpc, xdr, scValToNative } from "@stellar/stellar-sdk";

const server = new SorobanRpc.Server("https://soroban-testnet.stellar.org");
const horizon = new Horizon.Server("https://horizon-testnet.stellar.org");

interface OnChainReceipt {
  order_id: Uint8Array;
  amount: bigint;
  token: string;
  merchant_address: string;
  merchant_name: string;
  payer: string;
  status: "Completed" | "Refunded" | "PartiallyRefunded";
  paid_at: bigint;
}

interface EnrichedReceipt extends OnChainReceipt {
  tx_hash: string; // sourced from the Stellar transaction envelope
}

/**
 * Find the transaction hash of the `payment_processed` event whose
 * `order_id` matches, using Horizon's event/transaction history.
 */
async function findTxHashForOrder(
  contractId: string,
  orderId: Uint8Array,
): Promise<string> {
  // Page backwards through the contract's events until we find the
  // `payment_processed` event for this order.
  let page = await horizon
    .contractEvents(contractId)
    .order("desc")
    .limit(200)
    .call();

  while (true) {
    for (const event of page.records) {
      if (event.type !== "contract" || event.topic.length < 1) continue;

      const topicName = scValToNative(event.topic[0] as xdr.ScVal);
      if (topicName !== "payment_processed") continue;

      const data = scValToNative(event.value as xdr.ScVal) as {
        order_id: Uint8Array;
      };
      if (Buffer.from(data.order_id).equals(Buffer.from(orderId))) {
        // `transaction_hash` is the hash of the envelope that emitted
        // the event — this is the value the contract cannot see.
        return event.transaction_hash;
      }
    }
    if (page.records.length === 0) break;
    page = await page.next();
  }
  throw new Error("payment_processed event not found for order");
}

/** Merge the on-chain receipt with the off-chain transaction hash. */
export async function buildEnrichedReceipt(
  contractId: string,
  onChain: OnChainReceipt,
): Promise<EnrichedReceipt> {
  const txHash = await findTxHashForOrder(contractId, onChain.order_id);
  return { ...onChain, tx_hash: txHash };
}
```

The `tx_hash` in the enriched record is verifiable against the Stellar
ledger (the transaction envelope), while every other field comes
straight from contract storage via `get_payment_receipt`.

## Off-chain PDF rendering (service responsibility)

Turning the fields above into a downloadable PDF, and exposing a
download endpoint to the payer/merchant, is an off-chain concern and
out of scope for the contract itself. The recommended shape for that
service:

1. Call `get_payment_receipt` (or read the already-indexed payment
   record) to obtain the on-chain fields listed above — note that
   `tx_hash` is not among them.
2. Resolve the transaction hash for the `payment_processed` event with
   the matching `order_id` via the indexer/Horizon, as shown in the
   enrichment example above, and merge it into the receipt record.
3. Render a PDF containing: order ID, amount (formatted with the
   token's decimals), token code, merchant name, ISO-8601 timestamp
   derived from `paid_at`, and the transaction hash obtained in step 2.
4. Serve it from a download endpoint authorized the same way as
   `get_payment_receipt` (payer, merchant, or admin only).

This keeps the receipt's on-chain-verifiable fields authoritative
(sourced directly from contract storage) while leaving formatting and
file generation to the off-chain layer where PDF libraries are
available.
