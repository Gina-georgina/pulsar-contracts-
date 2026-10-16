# Pulsar

> Scalable, secure, and decentralized smart contracts for Soroban Stellar.

[![CI](https://github.com/queenannaE/pulsar-contracts/actions/workflows/ci.yml/badge.svg)](https://github.com/queenannaE/pulsar-contracts/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Pulsar is a comprehensive payment-processing smart contract for the Stellar Soroban network. It provides merchant management, payment processing with signature verification, refunds, multi-signature payments, and paginated payment history queries — all on-chain.

---

## Table of Contents

- [Overview](#overview)
- [Prerequisites](#prerequisites)
- [Project Structure](#project-structure)
- [Setup](#setup)
- [Testing](#testing)
- [Local Network](#local-network)
- [Deployment](#deployment)
- [Environment Seeding](#environment-seeding)
- [Contract API](#contract-api)
  - [Admin](#admin)
  - [Merchant Management](#merchant-management)
  - [Payment Processing](#payment-processing)
  - [Payment Queries](#payment-queries)
  - [Refunds](#refunds)
  - [Multi-Signature Payments](#multi-signature-payments)
  - [Admin Config](#admin-config)
- [Analytics](#analytics)
- [Events](#events)
- [Error Codes](#error-codes)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [Code of Conduct](#code-of-conduct)
- [License](#license)

## Storage Costs

- **Overview:** Each on-chain operation that creates or updates contract storage consumes ledger entries and affects the network reserve. Actual XLM cost depends on the Stellar/Soroban network parameters (base reserve, entry pricing) at deployment time; the estimates below are for planning only.
- **Register merchant:** creates one merchant ledger entry. Estimated cost: ~0.5 XLM (network-dependent).
- **Process payment:** creates a `Payment` record and appends to merchant, payer and global indexes (so ~4 ledger entries). Estimated cost: ~2.0 XLM total (4 × ~0.5 XLM).
- **Initiate refund:** creates a `Refund` record: ~0.5 XLM.
- **Multi-signature payment:** creates a `MultisigPayment` entry: ~0.5 XLM.
- **Whitelist toggle / admin config changes:** typically create/update a small number of entries: ~0.5 XLM per new entry.

Practical guidance:
- Minimise history growth by using the `archive_payment_record` API to remove full `Payment` objects from hot storage. Note: archived `order_id`s are preserved as tombstones to prevent replay — tombstones are inexpensive but intentionally kept to prevent signature replay attacks.
- For integrations that expect heavy throughput, budget for index growth (merchant/payer/global lists) and consider periodic compaction or off-chain indexing.
- Always verify current network base reserves before deployment; use the Stellar/Soroban network RPC or SDK to compute exact costs for your target environment.

---

## Overview

| Feature | Description |
|---|---|
| Merchant registry | Register, deactivate, and query merchants. |
| Signed payments | Process payments verified by ed25519 merchant signature |
| Refunds | Initiate → Approve/Reject → Execute with 30-day window + 1-hour grace buffer |
| Multi-sig | Require N-of-N signers before executing a payment |
| History queries | Cursor-based pagination with filtering and sorting |
| Global stats | Admin-only aggregate payment and refund statistics |
| Merchant stats | Per-merchant analytics with optional date filtering |

---

## Prerequisites

| Tool | Install |
|---|---|
| Rust (stable) | https://www.rust-lang.org/tools/install |
| Stellar CLI | https://developers.stellar.org/docs/tools/stellar-cli. |
| Docker Desktop | https://www.docker.com/products/docker-desktop |

Verify:

```bash
rustc --version
cargo --version
stellar --version
docker --version
```

Add the WASM target:

```bash
rustup target add wasm32-unknown-unknown
```

---

## Project Structure

```
pulsar-contracts/
├── .github/
│   └── workflows/
│       └── ci.yml                  # CI: fmt, clippy, test, WASM build, audit
├── contracts/
│   └── payment-processing-contract/
│       ├── Cargo.toml
│       └── src/
│           ├── lib.rs              # Contract entry-point and all public functions
│           ├── types.rs            # All data structures and storage keys
│           ├── storage.rs          # Storage read/write helpers
│           ├── error.rs            # ContractError enum
│           ├── helper.rs           # Auth, validation, filter helpers
│           └── test.rs             # Unit tests (soroban testutils)
├── Cargo.toml                      # Workspace manifest
├── .gitignore
├── CODE_OF_CONDUCT.md              # Community guidelines
├── CONTRIBUTING.md
├── LICENSE
└── README.md
```

---

## Setup

Clone the repository and run the automated setup script to install all prerequisites (Rust, WASM target, Stellar CLI):

```bash
git clone https://github.com/queenannaE/pulsar-contracts.git
cd pulsar-contracts
bash scripts/setup.sh
```

The script is idempotent — safe to run multiple times. It detects what is already installed and skips those steps. Supported on **Ubuntu 20.04+** and **macOS 12+**.

> **Manual setup** — if you prefer to install tools yourself, see the [Prerequisites](#prerequisites) section above.

---

## Testing

```bash
cd contracts/payment-processing-contract
cargo test
```

Run a specific test:

```bash
cargo test test_successful_payment_with_signature
cargo test test_successful_refund_flow
cargo test test_get_merchant_payment_history
cargo test test_initiate_multisig_payment_success
```

---

## Local Network

### Option A — Docker Compose (recommended)

The fastest way to get a fully reproducible local environment with no manual
tool installation.

**Prerequisites:** Docker Desktop (or Docker Engine + Compose plugin).

```bash
# 1. Start the local Stellar network and the dev container
docker compose up -d

# 2. Open a shell inside the dev container
docker compose exec dev bash

# 3. Inside the container — build the contract
cargo build --target wasm32-unknown-unknown --release

# 4. Deploy to the local network
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/payment_processing_contract.wasm \
  --source-account <YOUR_SECRET_KEY> \
  --network local
```

Save the returned contract ID as `CONTRACT_ID`.

Horizon is available at `http://localhost:8000` on your host machine.

```bash
# Stop everything when done
docker compose down
```

### Option B — Native (manual)

```bash
# Start Docker Desktop, then:
stellar network container start local

# Build
cargo build --target wasm32-unknown-unknown --release

# Deploy
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/payment_processing_contract.wasm \
  --source-account <YOUR_SECRET_KEY> \
  --network local
```

Save the returned contract ID as `CONTRACT_ID`.

---

## Deployment

### Prerequisites — Keys

Before deploying you need a Stellar keypair, a funded account, and the compiled WASM binary.

**1. Build the WASM binary** (if you haven't already):

```bash
cargo build --target wasm32-unknown-unknown --release
```

**2. Generate a keypair:**

```bash
stellar keys generate --global deployer
stellar keys address deployer        # prints your public key (G...)
stellar keys show deployer           # prints your secret key (S...) — keep this private
```

**3. Fund your testnet account via Friendbot:**

Testnet accounts start with zero balance. Friendbot is a faucet that credits 10 000 XLM to any new address:

```bash
curl "https://friendbot.stellar.org?addr=$(stellar keys address deployer)"
```

Or open the URL in a browser. Once funded, use the secret key wherever `<TESTNET_SECRET_KEY>` or `<ADMIN_SECRET_KEY>` appears in the commands below.

**4. Save the contract ID after deployment:**

`stellar contract deploy` prints a contract address (starting with `C`). Export it immediately so the subsequent commands work:

```bash
export CONTRACT_ID="<address printed by stellar contract deploy>"
```

Use `$CONTRACT_ID` wherever it appears in the commands below.

---

### Testnet

```bash
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/payment_processing_contract.wasm \
  --source-account <TESTNET_SECRET_KEY> \
  --network testnet
```

### Initialise

```bash
stellar contract invoke \
  --id $CONTRACT_ID \
  --source-account <ADMIN_SECRET_KEY> \
  --network testnet \
  -- set_admin \
  --admin <ADMIN_ADDRESS>
```

---

## Environment Seeding

Quickly populate a local or testnet environment with sample merchants, payments, and refunds for manual testing.

### Quick Start

```bash
# 1. Deploy the contract and save the CONTRACT_ID
export CONTRACT_ID="CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4"

# 2. Run the seeding script
bash scripts/seed.sh config/local.toml
```

### What Gets Created

The seeding script automatically:
- Registers 3 merchants with different categories (Retail, Food, Services)
- Processes 10 payments between payer and merchants
- Initiates 2 refunds for testing the refund workflow

### Configuration

Edit `config/local.toml` to customize:
- Number of merchants, payments, and refunds
- Merchant categories and names
- Payment amounts and descriptions
- Network (local, testnet, public)

### Verification

After seeding, query the contract to verify:

```bash
# Global stats
stellar contract invoke --id $CONTRACT_ID --source-account admin --network local \
  -- get_global_payment_stats \
  --admins '["<ADMIN_ADDRESS>"]' \
  --date_start null \
  --date_end null

# Merchant stats
stellar contract invoke --id $CONTRACT_ID --source-account merchant_1 --network local \
  -- get_merchant_stats \
  --merchant <MERCHANT_ADDRESS> \
  --date_start null \
  --date_end null
```

**See also**: [SEEDING_GUIDE.md](docs/SEEDING_GUIDE.md) for detailed instructions and troubleshooting.

---

## Contract API

### Admin

#### `set_admin`

One-time initialisation. Caller becomes admin. Sets contract version to `1`.

```bash
stellar contract invoke --id $CONTRACT_ID --source-account <KEY> --network local \
  -- set_admin --admin <ADDRESS>
```

#### `get_version`

Returns the current contract version (u32).

```bash
stellar contract invoke --id $CONTRACT_ID --source-account <KEY> --network local \
  -- get_version
```

#### `ping`

Health check endpoint. Returns the current ledger timestamp (u64).

```bash
stellar contract invoke --id $CONTRACT_ID --source-account <KEY> --network local \
  -- ping
```

#### `upgrade`

Upgrades the contract WASM in-place. Admin only. Existing storage and contract address are preserved.

```bash
stellar contract invoke --id $CONTRACT_ID --source-account <ADMIN_KEY> --network local \
  -- upgrade \
  --admin <ADMIN_ADDRESS> \
  --new_wasm_hash <32_BYTE_HEX>
```

**Upgrade procedure:**

1. Build the new WASM: `cargo build --target wasm32-unknown-unknown --release`
2. Upload the WASM to the network and obtain its hash:
   ```bash
   stellar contract upload \
     --wasm target/wasm32-unknown-unknown/release/payment_processing_contract.wasm \
     --source-account <ADMIN_KEY> \
     --network testnet
   ```
3. Call `upgrade` with the returned hash.
4. Verify with `get_version`.

---

### Merchant Management

#### `register_merchant`

```bash
stellar contract invoke --id $CONTRACT_ID --source-account <MERCHANT_KEY> --network local \
  -- register_merchant \
  --merchant_address <ADDRESS> \
  --name "My Store" \
  --description "Store description" \
  --contact_info "contact@store.com" \
  --category Retail
```

**Categories**: `Retail` | `Food` | `Services` | `Digital` | `Other`

**Note on Category Management**: Merchant categories are currently implemented as a fixed enum. Adding new categories requires a contract upgrade. See [CATEGORY_MIGRATION_GUIDE.md](docs/CATEGORY_MIGRATION_GUIDE.md) for the migration procedure and [ADR-0004](docs/adr/0004-merchant-category-management.md) for the design rationale.

#### `deactivate_merchant`

Callable by the merchant themselves or the admin.

```bash
stellar contract invoke --id $CONTRACT_ID --source-account <KEY> --network local \
  -- deactivate_merchant --caller <ADDRESS> --merchant_address <ADDRESS>
```

#### `get_merchant`

```bash
stellar contract invoke --id $CONTRACT_ID --source-account <KEY> --network local \
  -- get_merchant --merchant_address <ADDRESS>
```

---

### Payment Processing

#### `process_payment_with_signature`

Transfers tokens from payer to merchant after verifying an ed25519 signature.

```bash
stellar contract invoke --id $CONTRACT_ID --source-account <PAYER_KEY> --network local \
  -- process_payment_with_signature \
  --payer <PAYER_ADDRESS> \
  --order '{"order_id":"ORDER_001","merchant_address":"...","payer":"...","token":"...","amount":1000,"description":"desc","expires_at":0}' \
  --signature <64_BYTE_HEX> \
  --merchant_public_key <32_BYTE_HEX>
Note: the `expires_at` field is a UNIX timestamp in seconds. A value of
`0` is treated as "never expires" (the order will not be rejected due to
expiry). This behaviour is intentional and documented in the contract types.
```

---

### Payment Queries

#### `get_payment_by_id`

Accessible by the payer, merchant, or admin.

```bash
stellar contract invoke --id $CONTRACT_ID --source-account <KEY> --network local \
  -- get_payment_by_id --caller <ADDRESS> --order_id "ORDER_001"
```

#### `get_merchant_payment_history`

```bash
stellar contract invoke --id $CONTRACT_ID --source-account <MERCHANT_KEY> --network local \
  -- get_merchant_payment_history \
  --merchant <ADDRESS> \
  --cursor null \
  --limit 10 \
  --filter null \
  --sort_field Date \
  --sort_order Descending
```

#### `get_payer_payment_history`

```bash
stellar contract invoke --id $CONTRACT_ID --source-account <PAYER_KEY> --network local \
  -- get_payer_payment_history \
  --payer <ADDRESS> \
  --cursor null \
  --limit 10 \
  --filter '{"amount_min":100,"amount_max":1000,"status":"Any"}' \
  --sort_field Amount \
  --sort_order Ascending
```

**Filter fields** (all optional):

| Field | Type | Description |
|---|---|---|
| `date_start` | `u64` | Unix timestamp lower bound |
| `date_end` | `u64` | Unix timestamp upper bound |
| `amount_min` | `i128` | Minimum payment amount |
| `amount_max` | `i128` | Maximum payment amount |
| `token` | `Address` | Filter by token contract |
| `status` | `StatusFilter` | `Any` \| `Completed` \| `PartiallyRefunded` \| `FullyRefunded` |

**Sort fields**: `Date` | `Amount`  
**Sort orders**: `Ascending` | `Descending`  
**Pagination**: pass the `next_cursor` from the previous response as `cursor`. Max 100 results per page.

Cursor format: the returned `next_cursor` is the raw `order_id` bytes of the
last record. When passing the cursor through a textual interface (CLI or
HTTP), encode it (for example base64). The cursor is opaque and callers
should treat it as an opaque token rather than attempting to parse it.

#### `get_global_payment_stats` *(admin only)*

```bash
stellar contract invoke --id $CONTRACT_ID --source-account <ADMIN_KEY> --network local \
  -- get_global_payment_stats \
  --admin <ADDRESS> \
  --date_start null \
  --date_end null
```

#### `get_merchant_stats`

Returns per-merchant payment and refund statistics. Accessible by the merchant (own stats) or admin (any merchant).

```bash
stellar contract invoke --id $CONTRACT_ID --source-account <MERCHANT_KEY> --network local \
  -- get_merchant_stats \
  --merchant <ADDRESS> \
  --date_start null \
  --date_end null
```

**Returns**: `MerchantStats` with `total_payments`, `total_volume`, `total_refunds`, `total_refund_volume`

**Query Modes**:
- **Unfiltered** (no date range): Returns cached stats (O(1))
- **Filtered** (with date range): Computes stats on-demand (O(n) where n = merchant's payment count)

**See also**: [ANALYTICS_GUIDE.md](docs/ANALYTICS_GUIDE.md) for detailed usage and best practices.

---
> **Known Limitation:** The `date_start` and `date_end` parameters for `get_global_payment_stats` are currently a no‑op due to SC‑003. They will be functional once the issue is resolved.

### Refunds

Refund window: **30 days + 1-hour grace buffer** from `paid_at`. Partial refunds are allowed; cumulative refunds cannot exceed the original amount.

#### Timestamp trust model

Refund eligibility is enforced using `env.ledger().timestamp()`, which returns the `close_time` field of the Stellar ledger header set by the validator quorum.

**Why not ledger sequence numbers?**
Ledger sequence numbers increment by 1 per closed ledger, but the wall-clock duration of each ledger varies (typically 5–7 s, not guaranteed). Converting a 30-day window into a fixed sequence-number delta would require assuming a constant close time; any deviation accumulates drift that could silently shorten or extend the window. Because `paid_at` already stores a Unix timestamp, using timestamps for the deadline check is the only consistent approach.

**Validator-provided timestamps**
The Stellar Consensus Protocol requires each ledger's `close_time` to be strictly greater than the previous ledger's `close_time`, so timestamps are monotonically increasing. They are *not* guaranteed to match wall-clock time exactly — validators may set `close_time` a small number of seconds ahead of or behind real time. In practice the drift is well under a minute.

**Grace buffer**
A 1-hour grace buffer (`REFUND_GRACE_BUFFER = 3600 s`) is added to the deadline:

```
deadline = paid_at + REFUND_WINDOW + REFUND_GRACE_BUFFER
         = paid_at + 2_592_000   + 3_600
```

This absorbs minor timestamp drift near the boundary (e.g., a refund submitted seconds before midnight on day 30 that lands in a ledger whose `close_time` is a few seconds past the nominal deadline). The buffer is sized to accommodate expected network timing variance, not to provide a meaningful extension of the 30-day window. Because validator timestamps are monotonically increasing and the buffer is small relative to the window, it does not create a meaningful abuse surface.

#### `initiate_refund`

Callable by payer or merchant.

```bash
stellar contract invoke --id $CONTRACT_ID --source-account <KEY> --network local \
  -- initiate_refund \
  --caller <ADDRESS> \
  --refund_id "REFUND_001" \
  --order_id "ORDER_001" \
  --amount 500 \
  --reason "Customer request"
```

#### `approve_refund`

Callable by merchant or admin.

```bash
stellar contract invoke --id $CONTRACT_ID --source-account <MERCHANT_KEY> --network local \
  -- approve_refund --caller <ADDRESS> --refund_id "REFUND_001"
```

#### `reject_refund`

```bash
stellar contract invoke --id $CONTRACT_ID --source-account <MERCHANT_KEY> --network local \
  -- reject_refund --caller <ADDRESS> --refund_id "REFUND_001"
```

#### `execute_refund`

Transfers funds from merchant to payer. Requires merchant auth.

```bash
stellar contract invoke --id $CONTRACT_ID --source-account <MERCHANT_KEY> --network local \
  -- execute_refund --refund_id "REFUND_001"
```

#### `get_refund_status`

```bash
stellar contract invoke --id $CONTRACT_ID --source-account <KEY> --network local \
  -- get_refund_status --refund_id "REFUND_001"
```

Returns: `Pending` | `Approved` | `Rejected` | `Completed`

---

### Multi-Signature Payments

Require all listed signers to sign before the payment can be executed.

#### `initiate_multisig_payment`

```bash
stellar contract invoke --id $CONTRACT_ID --source-account <KEY> --network local \
  -- initiate_multisig_payment \
  --initiator <ADDRESS> \
  --payment_id "MS_001" \
  --order '{...}' \
  --required_signers '["<ADDR1>","<ADDR2>"]'
```

#### `sign_multisig_payment`

```bash
stellar contract invoke --id $CONTRACT_ID --source-account <SIGNER_KEY> --network local \
  -- sign_multisig_payment --signer <ADDRESS> --payment_id "MS_001"
```

#### `execute_multisig_payment`

Executes once all required signers have signed.

```bash
stellar contract invoke --id $CONTRACT_ID --source-account <KEY> --network local \
  -- execute_multisig_payment --executor <ADDRESS> --payment_id "MS_001"
```

---

### Admin Config

#### `archive_payment_record`

Removes a payment record from storage.

```bash
stellar contract invoke --id $CONTRACT_ID --source-account <ADMIN_KEY> --network local \
  -- archive_payment_record --admin <ADDRESS> --order_id "ORDER_001"
```

#### `cleanup_expired_payments`

```bash
stellar contract invoke --id $CONTRACT_ID --source-account <ADMIN_KEY> --network local \
  -- cleanup_expired_payments --admin <ADDRESS>
```

#### `set_payment_cleanup_period`

Default: 90 days (7 776 000 seconds).

```bash
stellar contract invoke --id $CONTRACT_ID --source-account <ADMIN_KEY> --network local \
  -- set_payment_cleanup_period --admin <ADDRESS> --period 7776000
```

---

## Analytics

The contract provides on-chain analytics capabilities for monitoring payment activity and merchant performance.

### Global Payment Stats

Admin-only aggregate statistics across all merchants and payments.

**Function**: `get_global_payment_stats(admins, date_start, date_end)`

**Returns**: `GlobalStats` with `total_payments`, `total_volume`, `total_refunds`, `total_refund_volume`

**Example**:
```bash
stellar contract invoke --id $CONTRACT_ID --source-account <ADMIN_KEY> --network local \
  -- get_global_payment_stats \
  --admins '["<ADMIN_ADDRESS>"]' \
  --date_start null \
  --date_end null
```

### Per-Merchant Stats

Per-merchant payment and refund statistics with optional date filtering.

**Function**: `get_merchant_stats(merchant, date_start, date_end)`

**Access**: Merchant (own stats) or Admin (any merchant)

**Returns**: `MerchantStats` with merchant address, payment count, volume, refund count, and refund volume

**Example**:
```bash
# Merchant queries their own stats
stellar contract invoke --id $CONTRACT_ID --source-account <MERCHANT_KEY> --network local \
  -- get_merchant_stats \
  --merchant <MERCHANT_ADDRESS> \
  --date_start null \
  --date_end null

# Admin queries a merchant's stats with date filtering
stellar contract invoke --id $CONTRACT_ID --source-account <ADMIN_KEY> --network local \
  -- get_merchant_stats \
  --merchant <MERCHANT_ADDRESS> \
  --date_start 1704067200 \
  --date_end 1704153600
```

**Query Modes**:
- **Unfiltered** (no date range): Returns cached stats (O(1) performance)
- **Filtered** (with date range): Computes stats on-demand (O(n) where n = merchant's payment count)

### Analytics Strategy

The contract implements a **hybrid analytics approach**:

1. **On-Chain Analytics** (current):
   - Per-merchant stats with date filtering
   - Global aggregate stats
   - Cached for performance
   - Suitable for real-time queries and merchant dashboards

2. **Off-Chain Analytics** (future - BE-001):
   - Event-driven indexer service
   - Per-token breakdown and time-series data
   - Complex queries and historical analysis
   - Reduces on-chain computation overhead

**See also**: [ANALYTICS_GUIDE.md](docs/ANALYTICS_GUIDE.md) for detailed usage, best practices, and performance considerations.

---

## Events

| Event | Emitted by |
|---|---|
| `admin_set` | `set_admin` |
| `merchant_registered` | `register_merchant` |
| `merchant_deactivated` | `deactivate_merchant` |
| `payment_processed` | `process_payment_with_signature` |
| `refund_initiated` | `initiate_refund` |
| `refund_approved` | `approve_refund` |
| `refund_rejected` | `reject_refund` |
| `refund_executed` | `execute_refund` |
| `multisig_initiated` | `initiate_multisig_payment` |
| `multisig_signed` | `sign_multisig_payment` |
| `multisig_executed` | `execute_multisig_payment` |
| `contract_upgraded` | `migrate` |

---

## Error Codes

| Code | Name | Description |
|---|---|---|
| 1 | `Unauthorized` | Caller lacks permission |
| 2 | `AdminAlreadySet` | Admin already initialised |
| 10 | `MerchantNotFound` | Merchant not registered |
| 11 | `MerchantAlreadyRegistered` | Duplicate registration |
| 12 | `MerchantInactive` | Merchant is deactivated |
| 20 | `PaymentNotFound` | Order ID not found |
| 21 | `PaymentAlreadyExists` | Duplicate order ID |
| 22 | `InvalidAmount` | Amount ≤ 0 |
| 23 | `InvalidSignature` | Signature verification failed |
| 24 | `PaymentExpired` | Order past `expires_at` |
| 25 | `InsufficientBalance` | Merchant balance too low for refund |
| 30 | `RefundNotFound` | Refund ID not found |
| 31 | `RefundAlreadyExists` | Duplicate refund ID |
| 32 | `RefundWindowExpired` | Past 30-day refund window |
| 33 | `RefundAmountExceedsPayment` | Cumulative refund > original amount |
| 34 | `RefundNotApproved` | Refund not in Approved state |
| 35 | `RefundAlreadyCompleted` | Refund already completed or rejected |
| 40 | `MultisigNotFound` | Multisig payment not found |
| 41 | `MultisigAlreadySigned` | Signer already signed |
| 42 | `MultisigAlreadyExecuted` | Payment already executed |
| 43 | `InsufficientSignatures` | Not all required signers have signed |
| 50 | `InvalidInput` | General input validation failure |

---

## TTL Strategy

Soroban persistent storage entries expire after a ledger TTL. Without active renewal, long-lived records (payments, merchants, refunds) would be evicted and become permanently inaccessible.

**Constants** (defined in `storage.rs`):

| Constant | Value | Description |
|---|---|---|
| `TTL_LEDGERS` | 6,307,200 | ~1 year at 5-second ledger close time |
| `TTL_THRESHOLD` | 3,153,600 | ~6 months — refresh TTL when remaining life drops below this |

**Strategy**: every `get_*` and `save_*` call on a persistent entry calls `env.storage().persistent().extend_ttl(key, TTL_THRESHOLD, TTL_LEDGERS)`. This means:

- A record's TTL is reset to ~1 year on every read or write.
- Records that are never accessed will expire after ~1 year and be evicted by the network.
- Frequently accessed records (active merchants, recent payments) are automatically kept alive.
- Instance storage (admin, config, stats) is managed by the Soroban host and does not require manual TTL extension.

---

## Troubleshooting

### 1. Build fails — `error[E0463]: can't find crate for 'std'`

**Symptom:** `cargo build --target wasm32-unknown-unknown` fails with a missing `std` crate error.  
**Cause:** The `wasm32-unknown-unknown` target is not installed for the active Rust toolchain.  
**Fix:**
```bash
rustup target add wasm32-unknown-unknown
```

---

### 2. Local network fails to start

**Symptom:** `stellar network container start local` hangs or returns a connection error.  
**Cause:** Docker Desktop is not running, or the container is in a bad state.  
**Fix:**
```bash
# Ensure Docker Desktop is running, then:
stellar network container restart local
```
If the container is corrupted, remove it and start fresh:
```bash
docker rm -f stellar-local 2>/dev/null || true
stellar network container start local
```

---

### 3. Test failures — mock auth / `require_auth` panics

**Symptom:** Tests panic with `HostError: Error(Auth, InvalidAction)` or similar auth errors.  
**Cause:** The test environment requires explicit mock authorisation for every address that calls `require_auth()`. A missing `env.mock_all_auths()` or `env.mock_auths(...)` call causes the panic.  
**Fix:** Add `env.mock_all_auths()` at the top of the test, or use `env.mock_auths(&[...])` to authorise specific calls:
```rust
let env = Env::default();
env.mock_all_auths(); // ← add this before any contract calls
```

---

### 4. Test failures — token minting / balance errors

**Symptom:** Tests fail with `HostError: Error(Contract, #10)` or an assertion on token balances fails unexpectedly.  
**Cause:** The test token contract was not minted with enough balance for the payer, or the wrong address was used as the token admin when calling `mint`.  
**Fix:** Ensure the token is minted to the correct address and the amount covers the payment plus any fees:
```rust
token_admin_client.mint(&payer, &10_000_i128); // mint before process_payment_with_signature
```
Also confirm the token address passed to the contract matches the one created in the test setup.

---

### 5. Test failures — snapshot mismatch (`insta` / `expect_test`)

**Symptom:** A test fails with `snapshot assertion failed` and shows a diff between stored and actual output.  
**Cause:** Contract output or error messages changed since the snapshot was last recorded.  
**Fix:** Review the diff to confirm the change is intentional, then update the snapshot:
```bash
cargo test -- --nocapture   # inspect the actual output first
# If the change is correct, update snapshots:
INSTA_UPDATE=always cargo test
# or for expect-test:
UPDATE_EXPECT=1 cargo test
```
Commit the updated snapshot files alongside your code change.

---

### 6. `soroban-sdk` version mismatch

**Symptom:** Compilation errors referencing missing trait implementations or changed API signatures.  
**Cause:** The `soroban-sdk` version in `Cargo.toml` does not match the version expected by the contract source.  
**Fix:** Ensure `soroban-sdk` is pinned to `22.0.0` in `contracts/payment-processing-contract/Cargo.toml` and run:
```bash
cargo update
cargo test
```

---

### 7. `cargo audit` reports vulnerabilities

**Symptom:** CI fails on the `security-audit` step with one or more advisory warnings.  
**Cause:** A dependency has a known CVE or has been yanked from crates.io.  
**Fix:** Run `cargo audit` locally to see the full report, then either update the affected dependency or add a temporary `[advisories]` ignore entry in `deny.toml` with a justification comment while a fix is prepared.

---

## Rate Limiting and Spam Prevention

Pulsar is a Soroban smart contract on Stellar. Stellar's fee market provides natural, protocol-level rate limiting:

- **Resource fees**: every contract invocation pays a fee proportional to the CPU instructions, memory, and storage it consumes. Spamming `process_payment` or `initiate_refund` from a single account rapidly drains that account's XLM balance.
- **Surge pricing**: when the network is congested, base fees rise automatically, making bulk spam economically prohibitive.
- **Sequence number enforcement**: each transaction must use the account's next sequence number, so parallel spam from a single account is serialised by the protocol.

For applications that require stricter per-account throttling (e.g., preventing storage inflation from many small refund initiations), implement rate limiting in an **off-chain API gateway** in front of your contract invocation endpoint:

```
Client → API Gateway (rate limit: N req/min per account) → Stellar RPC → Contract
```

A simple token-bucket or sliding-window limiter keyed on the caller's Stellar address is sufficient. Libraries such as `express-rate-limit` (Node.js) or `slowapi` (Python) can be used for this purpose.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

---

## Code of Conduct

See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

---

## License

[MIT](LICENSE) © Pulsar Contributors
