# ADR 0007: Refund Pagination and Configurable Refund Window

- **Status:** Accepted
- **Date:** 2025-01-01
- **Deciders:** Smart Contract Team
- **Related Issues:** #356 (SC-052), #364 (SC-055)

## Context

### Refund list unbounded scan (#356)

`DataKey::AllRefunds` previously stored a flat `Vec<Bytes>` of every refund ID in the
contract. `get_all_refunds` returned this entire list in a single call. As refund volume
grows, this approach will exceed Soroban's memory and CPU budget limits, causing the call
to fail and making refund data inaccessible. This is an unbounded scan problem: the cost
of the call scales linearly with total refund volume, not with the amount of data the
caller actually needs.

The payment history feature already solved an analogous problem using a cursor-based
paginated query. We should follow the same pattern for refunds for consistency and to
reuse the proven approach.

### Hardcoded refund window constants (#364)

`REFUND_WINDOW` and `REFUND_GRACE_BUFFER` were defined as compile-time constants in
`storage.rs`. Adjusting them (for example, to comply with a different jurisdiction's
consumer protection rules) required a full contract redeployment. This is operationally
expensive and risky, and prevents per-deployment tuning without shipping new code.

## Decision

### 1. Cursor-based pagination for refunds

Replace the flat `AllRefunds` list with a paginated, cursor-based query that mirrors the
payment history pattern.

- **New entry point:** `get_refund_page(env, cursor: Option<Bytes>, limit: u32) -> RefundPage`
  (or the equivalent signature matching the payment history API).
- **Deprecate `get_all_refunds`:** The function is retained temporarily for backward
  compatibility but is deprecated. It should be removed in a future release once all
  callers have migrated. New code MUST use `get_refund_page`.
- **Storage layout:** Refund IDs are stored in an ordered structure keyed so that a page
  can be read starting from a cursor without scanning the full set. The cursor encodes the
  position of the last item returned in the previous page.

#### Cursor format

The cursor is an opaque `Bytes` value produced by the contract. Callers MUST treat it as
opaque and MUST NOT construct or parse it themselves. Internally it encodes the position
of the last returned refund ID (e.g. the refund ID bytes or an index into the ordered
set). A `None` cursor requests the first page. The response includes an optional
`next_cursor`; when it is `None`, the caller has reached the end of the list.

#### Page-size cap

To bound per-call cost, `limit` is capped at a compile-time maximum
(`MAX_REFUND_PAGE_SIZE`). Requests above the cap are clamped to the cap rather than
rejected, matching the payment history behaviour. A `limit` of `0` returns an empty page
with the same cursor (or the first-page cursor), so callers cannot make progress with a
zero limit.

#### Migration notes

- Existing `AllRefunds` data is migrated lazily: on first paginated access, the legacy
  flat list is read and re-indexed into the ordered paginated structure, then the legacy
  key is cleared. Alternatively, the migration may be performed by an admin-only
  `migrate_refunds` routine if the list is large enough that lazy migration would exceed
  budget in a single call.
- Callers in tests and the API layer are updated to use `get_refund_page`. Any remaining
  callers of `get_all_refunds` receive a deprecation warning in the docs and should be
  migrated before the function is removed.

### 2. Configurable refund window and grace buffer

Move `refund_window` and `refund_grace_buffer` from compile-time constants into contract
instance storage.

- **Storage:** Both values are stored under instance storage keys
  (`DataKey::RefundWindow`, `DataKey::RefundGraceBuffer`).
- **Admin setter:** Add `set_refund_window(env, window_secs: u64, grace_buffer_secs: u64)`,
  restricted to the contract admin. The setter validates bounds:
  - `window_secs` must be within `[MIN_REFUND_WINDOW, MAX_REFUND_WINDOW]`.
  - `grace_buffer_secs` must be within `[MIN_REFUND_GRACE_BUFFER, MAX_REFUND_GRACE_BUFFER]`.
  - Out-of-bounds values are rejected with an error; they are not silently clamped.
- **Migration defaults:** On first access, if the instance storage keys are absent, the
  contract falls back to the previous hardcoded values (`REFUND_WINDOW` and
  `REFUND_GRACE_BUFFER`) and persists them to instance storage. This provides a seamless
  migration path: existing deployments behave identically until an admin explicitly
  changes the values.

#### Tests and docs

- Tests cover custom window and grace buffer values, bounds validation (rejection of
  out-of-range values), admin-only access control, and the default-on-first-access
  migration path.
- This ADR and the contract docs are updated to describe the new admin setter and the
  storage-backed configuration.

## Consequences

### Positive

- Refund queries have bounded cost regardless of total refund volume, avoiding budget
  exhaustion.
- The pagination API is consistent with payment history, reducing cognitive overhead.
- Refund window and grace buffer can be tuned per deployment without redeployment,
  supporting jurisdiction-specific consumer protection rules.

### Negative / Risks

- Callers must migrate from `get_all_refunds` to `get_refund_page`; the deprecated
  function carries maintenance overhead until removed.
- The lazy migration of legacy `AllRefunds` data adds complexity and must be tested for
  large lists; an admin migration routine may be required.
- The admin setter introduces a privileged operation that must be access-controlled and
  audited.

## Alternatives Considered

- **Keep `get_all_refunds` and add pagination alongside it:** Rejected; maintaining two
  code paths for the same data increases risk and does not address the unbounded scan for
  existing callers.
- **Reject `limit` values above the cap:** Rejected in favour of clamping, to match the
  payment history behaviour and avoid surprising callers.
- **Keep refund window as constants and redeploy per jurisdiction:** Rejected; redeployment
  is operationally expensive and risky.

## References

- Issue #356 — [SC-052] `get_all_refunds` unbounded scan
- Issue #364 — [SC-055] Hardcoded `refund_window` / `refund_grace_buffer`
- Payment history pagination implementation (pattern reference)