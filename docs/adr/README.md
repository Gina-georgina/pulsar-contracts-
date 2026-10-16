# Architecture Decision Records

This directory contains Architecture Decision Records (ADRs) for key design
choices made in the Pulsar smart contract and supporting services.

ADRs capture *why* a decision was made — not just what was decided. They help
new contributors understand trade-offs and avoid re-litigating settled decisions.

## Index

| ADR | Title | Status |
|---|---|---|
| [ADR-0000](./0000-template.md) | Template | — |
| [ADR-0001](./0001-signature-scheme.md) | Use ed25519 for Payment Order Signature Verification | Accepted |
| [ADR-0002](./0002-storage-layout.md) | Per-Entity Storage Layout with Explicit Index Lists | Accepted |
| [ADR-0003](./0003-pagination-design.md) | Cursor-Based Pagination for Payment History Queries | Accepted |
| [ADR-0004](./0004-merchant-category-management.md) | Merchant Category Management | Accepted |
| [ADR-0004b](./0004-expires-at-no-expiry.md) | `expires_at = 0` as "never expires" sentinel | Accepted |
| [ADR-0005](./0005-analytics-and-reporting.md) | Analytics and Reporting Strategy | Accepted |

## Creating a new ADR

1. Copy [`0000-template.md`](./0000-template.md) to a new file named
   `NNNN-short-title.md` where `NNNN` is the next available number.
2. Fill in all sections. Set **Status** to `Proposed`.
3. Open a pull request. Once merged and accepted, update **Status** to `Accepted`.
4. Add the new ADR to the index table above.

## Statuses

| Status | Meaning |
|---|---|
| `Proposed` | Under discussion — not yet adopted |
| `Accepted` | Adopted and in effect |
| `Deprecated` | No longer relevant but kept for historical context |
| `Superseded by ADR-XXXX` | Replaced by a newer decision |
