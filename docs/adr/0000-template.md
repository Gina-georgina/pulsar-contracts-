# ADR-0007: Subscription Payment Model

**Status:** Accepted  
**Date:** 2025-01-15  
**Deciders:** Core protocol team

## Context

The protocol needs to support recurring payments so that merchants can charge
payers on a repeating schedule (e.g. monthly SaaS fees, weekly memberships).
Soroban smart contracts are event-driven and have no native scheduler: a
contract cannot wake itself up at a future time, and there is no cron-like
primitive on-chain. Any recurring-payment design must therefore decide how
charges are triggered, how subscriptions are identified, how intervals are
measured, what lifecycle states exist, and what guardrails prevent abuse.

The subscription feature is a significant architectural addition to the
contract. This ADR records the key design choices so future contributors
understand the rationale and constraints behind them.

Relevant constraints:

- Soroban has no on-chain scheduler; contracts execute only when invoked.
- Ledger timestamps are the only trustworthy, monotonic time source available
  to the contract.
- Storage is expensive; per-subscription state should be minimal.
- The contract must remain safe against griefing and unauthorized charges.

## Decision

We adopt the following subscription payment model:

1. **Off-chain scheduling.** There is no on-chain scheduler. A subscription is
   a stored record; charges are executed when an authorized party (the payer or
   the merchant) invokes the charge entry point. Off-chain infrastructure is
   responsible for triggering charges at the appropriate time.

2. **Subscription ID format.** Each subscription is identified by a `Bytes`
   value generated at creation time. The ID is opaque to the contract and is
   used as the storage key for the subscription record.

3. **Interval enforcement via ledger timestamp.** A charge is permitted only
   when the current ledger timestamp is at or after the subscription's
   `last_charged + interval`. The ledger timestamp is the sole source of truth
   for elapsed time.

4. **Cancellation-only lifecycle.** A subscription is either active or
   cancelled. There is no pause/resume state. Cancellation is terminal.

5. **Limits and authorization.** The contract enforces:
   - `interval > 0` at creation.
   - `amount > 0` at creation.
   - Only the payer may cancel the subscription.
   - Only the payer or the merchant may trigger a charge.

## Rationale

- **Off-chain scheduling** is the only viable option given Soroban's lack of a
  scheduler. Keeping triggering off-chain also keeps the contract simple and
  cheap, and lets integrators choose their own reliability/retry strategy.
- **Opaque `Bytes` IDs** decouple the contract from any particular ID scheme,
  allow callers to generate collision-resistant identifiers, and map cleanly to
  Soroban storage keys.
- **Ledger-timestamp enforcement** ensures interval correctness cannot be
  spoofed by callers and is consistent across all invocations. It also makes
  the charge rule deterministic and auditable.
- **Cancellation-only lifecycle** avoids the ambiguity and edge cases of
  pause/resume (e.g. whether paused time counts toward the interval, how
  partial periods are handled). A terminal cancel is simple to reason about and
  to audit.
- **Limits and authorization** prevent zero-value or zero-interval spam
  subscriptions and ensure no party other than the payer can cancel, and no
  unauthorized party can trigger charges.

## Alternatives Considered

| Option | Reason rejected |
|---|---|
| On-chain scheduler / self-invoking contract | Not supported by Soroban; contracts cannot schedule their own future execution. |
| Sequential integer subscription IDs | Requires a global counter and coordination; opaque `Bytes` IDs avoid contention and couple less to contract state. |
| Caller-supplied timestamp for interval checks | Untrustworthy and spoofable; ledger timestamp is the only reliable time source. |
| Pause/resume lifecycle | Adds state and ambiguous semantics (interval accounting while paused); cancellation-only is simpler and sufficient. |
| Allow any party to cancel | Would let merchants or third parties terminate subscriptions against the payer's interest. |
| Allow only the payer to charge | Would force payers to self-trigger every payment, defeating the purpose of recurring billing. |

## Consequences

### Positive
- Simple, auditable contract with minimal per-subscription state.
- Deterministic interval enforcement using a trusted time source.
- Clear authorization model protects payers from unauthorized cancellation and
  charges.
- Opaque IDs are flexible and avoid global-counter contention.

### Negative
- Charges depend on off-chain infrastructure; missed triggers mean missed
  payments until the next invocation.
- No pause capability; users who want to temporarily stop payments must cancel
  and recreate the subscription.
- Opaque `Bytes` IDs place the burden of uniqueness on the caller.

### Neutral
- Interval semantics are "at or after" `last_charged + interval`, so charges
  may occur later than the nominal schedule depending on trigger timing.
- Integrators must build and operate their own scheduling/retry layer.

## References

- Issue #296 — [DOC-017] No ADR for the subscription payment model design decisions
- `docs/adr/0000-template.md` — ADR template
- Subscription guide (`docs/subscriptions.md`)
- Contract source: subscription module comments