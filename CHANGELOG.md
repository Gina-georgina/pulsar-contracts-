# Changelog

All notable changes to this project will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
- `sdk/`: TypeScript SDK (`@pulsar-contracts/sdk`) with `createOrder`, `signOrder`, `getPublicKey`, `serializeOrder`, and `processPaymentIdempotent` helpers for off-chain order construction and signing (closes #83).
- `sdk/package.json`: updated with npm publish config, `exports` field, `prepublishOnly` build step, Jest test runner, and pinned dependencies.
- `sdk/.npmignore`: excludes source and test files from the published package.
- `sdk/README.md`: comprehensive README with installation, quick start, full API docs, and links to the idempotency guide and contract API reference.
- `README.md`: added SDK & Integrator Resources table linking to the SDK, API reference, ABI, and idempotency guide.

### Changed
- Remove unused `StorageError` variant from the payment contract ABI.
- Harden payment and refund flows against external token transfer re-entrancy by committing state before external calls.
- Add best-effort zero/burn admin address validation and test coverage for invalid admin assignment.
- Add date-filter coverage for `get_global_payment_stats` to cover all-payments and no-payments ranges.

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
