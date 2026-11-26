# Changelog

All notable changes to this project will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> See [docs/VERSIONING.md](docs/VERSIONING.md) for the full versioning policy and release process.

## Versioning Policy

Versions follow **MAJOR.MINOR.PATCH** semantics:

| Increment | When to use |
|-----------|-------------|
| **MAJOR** | Breaking ABI change — any change to public function signatures, removed functions, or changed `#[contracttype]` layouts that would break existing callers or stored data. |
| **MINOR** | Backwards-compatible new functionality — new public functions, new optional parameters, new event topics, or new storage keys that do not affect existing callers. |
| **PATCH** | Backwards-compatible bug fixes, documentation updates, internal refactors, or dependency bumps that do not change the public ABI. |

### Release process

1. Update the version in `contracts/payment-processing-contract/Cargo.toml`.
2. Add a new `## [x.y.z] - YYYY-MM-DD` section to this file describing all changes.
3. Commit with message `chore(release): bump version to x.y.z`.
4. Push the commit and open a pull request.
5. Once merged, CI automatically creates a GitHub Release and tags the commit
   `v<x.y.z>` (see `.github/workflows/release.yml`).

---

## [Unreleased]

### Added
- Subscription support: recurring payments with configurable billing intervals, subscription creation/cancellation, and per-subscription payment execution.
- Merchant tiers and categories: merchants are assigned a tier (`Basic`, `Standard`, `Premium`) alongside the existing category (`Retail`, `Food`, `Services`, `Digital`, `Other`), with tier-based fee configuration.
- Analytics service: aggregated merchant and global analytics, including revenue breakdowns, payment volume trends, and date-range queries.
- Circuit breaker for external token transfers: repeated transfer failures trip the breaker and short-circuit subsequent calls until it is reset by an admin.
- Webhook registration: merchants can register, update, and remove webhook endpoints for payment and refund events.
- Dead-letter queue (DLQ) admin endpoints: inspect, replay, and purge failed webhook deliveries.
- `sdk/`: TypeScript SDK (`@pulsar-contracts/sdk`) with `createOrder`, `signOrder`, `getPublicKey`, `serializeOrder`, and `processPaymentIdempotent` helpers for off-chain order construction and signing (closes #83).
- `sdk/package.json`: npm publish config, `exports` field, `prepublishOnly` build step, Jest test runner, and pinned dependencies.
- `sdk/.npmignore`: excludes source and test files from the published package.
- `sdk/README.md`: comprehensive README with installation, quick start, full API docs, and links to the idempotency guide and contract API reference.
- `README.md`: added SDK & Integrator Resources table linking to the SDK, API reference, ABI, and idempotency guide.
- `SECURITY.md`: added a "Rewards and Recognition" section covering release-notes credit, a Security Hall of Fame, advisory credit, what counts as a valid report, the bounty scope (on-chain contract plus off-chain services), and the planned post-mainnet bug bounty platform listing (Immunefi / HackerOne). Closes #492.
- `README.md`: added a Security section linking the disclosure policy and the bug bounty / researcher recognition program.

### Changed
- Harden payment and refund flows against external token transfer re-entrancy by committing state before external calls.
- Add best-effort zero/burn admin address validation and test coverage for invalid admin assignment.
- Add date-filter coverage for `get_global_payment_stats` to cover all-payments and no-payments ranges.
- Add `InsufficientBalance` (code 25) to `PaymentError` enum and pre-check payer/merchant token balances before transfers in `process_payment_with_signature` and `execute_refund`, returning a typed error instead of a host trap. Closes #10.
- Merchant registration now records tier and category metadata; existing merchants default to the `Basic` tier.

### Fixed
- Payment and refund flows no longer trap the host on insufficient token balance; a typed `InsufficientBalance` error is returned instead.
- Re-entrancy via external token transfers in payment and refund execution is prevented by committing state before the external call.

### Removed
- Remove unused `StorageError` (code 51) variant from the payment contract ABI and SDK (`error.rs`, `sdk/errors.ts`, `sdk/error-registry.json`). The variant was never returned by any code path; removing it reduces ABI noise for integrators. Closes #9.

### Security
- Admin address validation rejects zero/burn addresses on assignment.
- Circuit breaker limits the blast radius of failing external token transfers.

---

## [0.2.0] - YYYY-MM-DD

### Added
- Subscription support for recurring payments.
- Merchant tiers and tier-based fee configuration.
- Analytics service with merchant and global revenue reporting.
- Circuit breaker for external token transfers.
- Webhook registration and dead-letter queue admin endpoints.
- TypeScript SDK (`@pulsar-contracts/sdk`) with order construction, signing, and idempotent payment helpers.

### Changed
- Payment and refund flows commit state before external token transfers (re-entrancy hardening).
- `InsufficientBalance` (code 25) added to `PaymentError`; balances are pre-checked before transfers.
- Merchant registration records tier and category metadata.

### Fixed
- Insufficient token balances now return a typed error instead of trapping the host.

### Removed
- Unused `StorageError` (code 51) variant removed from the contract ABI and SDK.

### Security
- Zero/burn admin addresses are rejected.
- Circuit breaker guards against repeated external transfer failures.

---

## [0.1.0] - 2025-05-31

### Added
- Initial release of the payment processing smart contract for Soroban / Stellar.
- Merchant registration with optional whitelist mode and admin pre-approval; merchants are categorised as `Retail`, `Food`, `Services`, `Digital`, or `Other`.
- Signature-verified single payments (`process_payment_with_signature`) using ed25519 merchant signatures and replay-prevention via order-ID tombstones.
- Multi-signature escrow payments (`initiate_multisig_payment`, `sign_multisig_payment`, `execute_multisig_payment`) requiring N-of-N signers before execution.
- Full refund workflow: initiate → approve/reject → execute, with a 30-day window plus a 1-hour grace buffer enforced via ledger timestamps.
- Partial refund support; cumulative refunds are validated against the original payment amount.
- Paginated, filtered, and sorted payment history for merchants (`get_merchant_payment_history`) and payers (`get_payer_payment_history`), with cursor-based pagination (max 100 results per page).
- Per-merchant analytics (`get_merchant_stats`) with optional date-range filtering; unfiltered queries use cached counters (O(1)), filtered queries compute on-demand (O(n)).
- Global payment statistics (`get_global_payment_stats`) accessible by admin only.
- On-chain event emission for all state transitions: `admin_set`, `merchant_registered`, `merchant_deactivated`, `payment_processed`, `refund_initiated`, `refund_approved`, `refund_rejected`, `refund_executed`, `multisig_initiated`, `multisig_signed`, `multisig_executed`, `contract_upgraded`.
- Admin management: one-time `set_admin` initialisation, in-place WASM `upgrade`, `get_version`, and `ping` health-check.
- Configurable payment cleanup period (default 90 days) via `set_payment_cleanup_period`; `cleanup_expired_payments` and `archive_payment_record` for storage lifecycle management.
- Persistent storage TTL strategy: entries are extended to ~1 year (`TTL_LEDGERS = 6,307,200`) on every read/write, with a ~6-month renewal threshold (`TTL_THRESHOLD = 3,153,600`).
- Structured error codes (1–50) covering auth, merchant, payment, refund, multisig, and input validation failures.
- Per-environment TOML configuration files (`config/local.toml`, `config/testnet.toml`, `config/mainnet.toml`).
- Docker Compose local development environment with a Stellar network container and dev container.
- Automated `scripts/setup.sh` (idempotent; supports Ubuntu 20.04+ and macOS 12+) and `scripts/seed.sh` for environment seeding.
- Full `///` rustdoc coverage on all public contract functions.
