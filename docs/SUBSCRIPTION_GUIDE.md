# Subscription / Recurring Payment Guide

This guide documents the recurring-payment ("subscription") feature of the
payment processing contract and, in particular, the off-chain scheduling
requirement called for by MISC-005.

## Overview

Soroban contracts have no built-in scheduler or cron-like mechanism — a
contract cannot wake itself up and execute code at a future ledger close. To
support subscriptions, the contract exposes a set of functions that an
**external, off-chain scheduler service must invoke on a timer**. The
contract itself only enforces correctness (duplicate-ID checks, interval
guards, authorization, status transitions); it never initiates a charge on
its own.

> **Design rationale:** the key architectural decisions behind this feature —
> why scheduling is off-chain, the subscription ID format, interval
> enforcement via the ledger timestamp, the cancellation-only lifecycle (no
> pause), and the enforced limits — are recorded in
> [ADR-0007: Subscription Payment Model](adr/0007-subscription-payment-model.md).
> Read it before changing subscription behaviour.

Implementation: `contracts/payment-processing-contract/src/lib.rs`
- `create_subscription` (lib.rs:1752)
- `cancel_subscription` (lib.rs:1802)
- `process_subscription_payment` (lib.rs:1844)
- `get_subscription` / merchant subscription listing (lib.rs, following
  `process_subscription_payment`)

Types: `contracts/payment-processing-contract/src/types.rs`
- `SubscriptionPlan { interval: u64, amount: i128, token: Address }` (types.rs:215)
- `SubscriptionStatus { Active, Cancelled }` (types.rs:223)
- `SubscriptionState { subscription_id, payer, merchant, plan, status, created_at, last_charged_at }` (types.rs:230)

## Lifecycle

1. **Create** — `create_subscription(payer, merchant, subscription_id, plan)`.
   `payer` must sign (`require_auth`). Fails with `SubscriptionAlreadyExists`
   if the ID is reused, `MerchantNotFound` / `MerchantInactive` if the
   merchant isn't a valid active merchant, and `InvalidInput` if
   `plan.interval == 0` or `plan.amount <= 0`. A merchant may hold at most
   `MAX_SUBSCRIPTIONS_PER_MERCHANT` (10 000) subscriptions; once that limit
   is reached, further `create_subscription` calls fail with `InvalidInput`.
2. **Charge** — `process_subscription_payment(caller, subscription_id)` must
   be called once per billing interval by an off-chain scheduler. **`caller`
   must be the subscription's `payer` address** and must provide
   authorization for that call (the scheduler needs a signed payer
   authorization, e.g. via a pre-signed auth entry or a payer-operated bot —
   it cannot act as an arbitrary third party). The first charge is always
   allowed (`last_charged_at == 0`); every subsequent charge requires
   `now >= last_charged_at + plan.interval`, otherwise the call fails with
   `SubscriptionIntervalNotElapsed`. When the token allowlist is enabled,
   `plan.token` must be on the admin-managed allowlist; otherwise the charge
   fails with `TokenNotAllowed` (the same check applied by
   `process_payment_with_signature`). Each successful charge transfers
   `plan.amount` of `plan.token` from payer to merchant and emits a
   `subscription_charged` event.
3. **Cancel** — `cancel_subscription(caller, subscription_id)`, callable only
   by the payer. Once cancelled, further `process_subscription_payment` calls
   fail with `SubscriptionNotActive`.

## Scheduler Requirements

**The contract does not charge subscriptions on its own.** Soroban has no
timers, so recurring payments only happen if an off-chain scheduler calls
`process_subscription_payment` at each interval boundary. Without a running
scheduler, subscriptions are created but never charged.

A production deployment MUST run a scheduler process that:

- Tracks each active `SubscriptionState` (via `get_subscription` /
  merchant-subscription listing) and its `plan.interval` /
  `last_charged_at`.
- Invokes `process_subscription_payment` once the interval has elapsed,
  with the payer's authorization attached to the transaction.
- Handles `SubscriptionIntervalNotElapsed` (safe to retry later) and
  `SubscriptionNotActive` (stop scheduling — the payer cancelled) without
  treating them as unexpected errors.
- Reconciles missed charges after downtime: because the interval guard only
  checks `now >= last_charged_at + interval`, a late scheduler run simply
  charges once for the elapsed interval; it does not automatically
  back-charge multiple missed periods, so the scheduler is responsible for
  deciding whether to catch up or skip missed cycles per its own billing
  policy.

### Minimal Node.js cron example

The scheduler must submit the call with the payer's authorization attached.
The example below polls active subscriptions and charges each one whose
interval has elapsed, using `node-cron` for the timer:

```js
const cron = require("node-cron");
const { Contract, Keypair, TransactionBuilder, Networks, rpc } = require("@stellar/stellar-sdk");

const server = new rpc.Server(process.env.SOROBAN_RPC_URL);
const contract = new Contract(process.env.CONTRACT_ID);
const payerKeypair = Keypair.fromSecret(process.env.PAYER_SECRET); // payer-operated bot

async function charge(subscriptionId) {
  const account = await server.getAccount(payerKeypair.publicKey());
  const tx = new TransactionBuilder(account, {
    fee: "1000000",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(contract.call("process_subscription_payment", payerKeypair.publicKey(), subscriptionId))
    .setTimeout(30)
    .build();

  tx.sign(payerKeypair); // payer authorization
  const prepared = await server.prepareTransaction(tx);
  prepared.sign(payerKeypair);
  return server.sendTransaction(prepared);
}

// Run every minute; the contract enforces the real interval.
cron.schedule("* * * * *", async () => {
  for (const subscriptionId of await listActiveSubscriptions()) {
    try {
      await charge(subscriptionId);
    } catch (err) {
      if (String(err).includes("SubscriptionIntervalNotElapsed")) {
        // Not due yet — safe to retry on the next tick.
        continue;
      }
      if (String(err).includes("SubscriptionNotActive")) {
        // Payer cancelled — stop scheduling this subscription.
        await markCancelled(subscriptionId);
        continue;
      }
      console.error(`charge failed for ${subscriptionId}`, err);
    }
  }
});
```

`listActiveSubscriptions()` / `markCancelled()` are application-specific: read
active subscriptions via `get_subscription` or the merchant subscription
listing and persist their state in your own database.

### `SubscriptionIntervalNotElapsed`

`process_subscription_payment` fails with `SubscriptionIntervalNotElapsed`
when `now < last_charged_at + plan.interval` (the first charge, with
`last_charged_at == 0`, is always allowed). For the scheduler this is a
**normal, expected outcome**, not an error condition: it means the
subscription is not yet due. The scheduler should treat it as safe to retry
later (e.g. on the next cron tick) and must not mark the subscription as
failed or alert on it.

There is currently no reference scheduler implementation in this repository;
the off-chain indexer service (`indexer/`) is a reasonable place to add one in
a future iteration, but it is out of scope for this contract-level change.

## Events

| Event                   | Payload                          | Emitted by |
|-------------------------|-----------------------------------|------------|
| `subscription_created`  | `subscription_id`                | `create_subscription` |
| `subscription_cancelled`| `subscription_id`                | `cancel_subscription` |
| `subscription_charged`  | `(subscription_id, amount)`      | `process_subscription_payment` |

## Tests

Unit tests covering the lifecycle (creation, duplicate IDs, inactive
merchants, the per-merchant subscription limit, cancellation, first charge,
interval enforcement, token allowlist enforcement on charges, and charging a
cancelled subscription) live in
`contracts/payment-processing-contract/src/test.rs`, e.g.
`test_create_subscription_success`, `test_cancel_subscription_wrong_payer_fails`,
`test_process_subscription_payment_before_interval_fails`,
`test_create_subscription_merchant_limit_exceeded`, and
`test_process_subscription_payment_token_not_allowed`.
