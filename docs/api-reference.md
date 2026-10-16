# Pulsar Contract API Reference

This document is the authoritative reference for off-chain integrators building
React frontends, Node.js backends, or any other client that interacts with the
Pulsar Soroban smart contract.

A machine-readable ABI is available at [`docs/contract-abi.json`](./contract-abi.json).

---

## Table of Contents

- [Data Types](#data-types)
- [Functions](#functions)
  - [Admin](#admin)
  - [Merchant Management](#merchant-management)
  - [Payment Processing](#payment-processing)
  - [Payment Queries](#payment-queries)
  - [Refunds](#refunds)
  - [Multi-Signature Payments](#multi-signature-payments)
  - [Admin Config](#admin-config)
- [Events](#events)
- [Error Codes](#error-codes)
- [TypeScript SDK](#typescript-sdk)

---

## Data Types

### Primitive mappings

| Soroban type   | TypeScript type | Notes |
|---|---|---|
| `Address`      | `string`        | Stellar G… or C… address |
| `Bytes`        | `Buffer` / `Uint8Array` / hex string | Raw byte array |
| `BytesN<32>`   | `Uint8Array` (32 bytes) | Fixed-length byte array |
| `BytesN<64>`   | `Uint8Array` (64 bytes) | ed25519 signature |
| `String`       | `string`        | UTF-8 string |
| `u32`          | `number`        | 32-bit unsigned integer |
| `u64`          | `bigint`        | 64-bit unsigned integer |
| `i128`         | `bigint`        | 128-bit signed integer (token amounts) |
| `bool`         | `boolean`       | |
| `Option<T>`    | `T \| null`     | Use `null` to represent `None` |
| `Vec<T>`       | `T[]`           | Array |

---

### `MerchantCategory` (enum)

```
Retail | Food | Services | Digital | Other
```

---

### `PaymentStatus` (enum)

```
Completed | PartiallyRefunded | FullyRefunded
```

---

### `RefundStatus` (enum)

```
Pending | Approved | Rejected | Completed | Disputed
```

---

### `SortField` (enum)

```
Date | Amount
```

---

### `SortOrder` (enum)

```
Ascending | Descending
```

---

### `StatusFilter` (enum)

```
Any | Completed | PartiallyRefunded | FullyRefunded
```

---

### `Merchant` (struct)

| Field                | Type                    | Description |
|---|---|---|
| `address`            | `Address`               | Merchant Stellar address |
| `name`               | `String`                | Display name |
| `description`        | `String`                | Merchant description |
| `contact_info`       | `String`                | Contact email/URL |
| `category`           | `MerchantCategory`      | Business category |
| `active`             | `bool`                  | Whether the merchant is active |
| `registered_at`      | `u64`                   | Unix timestamp of registration |
| `signing_public_key` | `Option<BytesN<32>>`    | ed25519 public key for order signing (`None` = no key stored) |

---

### `PaymentOrder` (struct)

Used as input to `process_payment_with_signature` and `initiate_multisig_payment`.

| Field              | Type      | Description |
|---|---|---|
| `order_id`         | `Bytes`   | Unique order identifier — used as the idempotency key |
| `merchant_address` | `Address` | Destination merchant |
| `payer`            | `Address` | Source payer |
| `token`            | `Address` | Token contract address |
| `amount`           | `i128`    | Payment amount in the token's smallest unit |
| `description`      | `String`  | Human-readable description |
| `expires_at`       | `u64`     | Unix timestamp (seconds). `0` = never expires |

---

### `PaymentRecord` (struct)

Returned by `get_payment_by_id` and inside `PaymentPage`.

| Field                  | Type            | Description |
|---|---|---|
| `order_id`             | `Bytes`         | |
| `merchant_address`     | `Address`       | |
| `payer`                | `Address`       | |
| `token`                | `Address`       | |
| `amount`               | `i128`          | Original payment amount |
| `refunded_amount`      | `i128`          | Total refunded so far |
| `pending_refund_amount`| `i128`          | Amount in pending/approved refunds |
| `status`               | `PaymentStatus` | Current status |
| `paid_at`              | `u64`           | Unix timestamp of payment |
| `description`          | `String`        | |

---

### `RefundRecord` (struct)

| Field           | Type           | Description |
|---|---|---|
| `refund_id`     | `Bytes`        | |
| `order_id`      | `Bytes`        | Associated payment |
| `amount`        | `i128`         | Refund amount |
| `reason`        | `String`       | |
| `status`        | `RefundStatus` | |
| `initiated_by`  | `Address`      | Payer or merchant who initiated |
| `initiated_at`  | `u64`          | Unix timestamp |
| `dispute_reason`| `String`       | Empty string if not disputed |

---

### `MultisigPayment` (struct)

| Field              | Type             | Description |
|---|---|---|
| `payment_id`       | `Bytes`          | |
| `order`            | `PaymentOrder`   | |
| `required_signers` | `Vec<Address>`   | All must sign before execution |
| `signatures`       | `Vec<Address>`   | Signers who have signed so far |
| `executed`         | `bool`           | |
| `expires_at`       | `u64`            | |
| `created_at`       | `u64`            | |

---

### `PaymentFilter` (struct)

All fields are optional. Omit or pass `null` to match all values.

| Field        | Type                    | Description |
|---|---|---|
| `date_start` | `Option<u64>`           | Payments on or after this Unix timestamp |
| `date_end`   | `Option<u64>`           | Payments on or before this Unix timestamp |
| `amount_min` | `Option<i128>`          | Minimum payment amount (inclusive) |
| `amount_max` | `Option<i128>`          | Maximum payment amount (inclusive) |
| `tokens`     | `Option<Vec<Address>>`  | Filter by token(s). `null` or empty = all tokens |
| `status`     | `StatusFilter`          | Payment status filter (default: `Any`) |

---

### `PaymentPage` (struct)

| Field         | Type                    | Description |
|---|---|---|
| `records`     | `Vec<PaymentRecord>`    | Current page of results |
| `next_cursor` | `Option<Bytes>`         | Opaque cursor — encode as base64 for textual transport. `null` = last page |
| `total`       | `u32`                   | Total matching records (before pagination) |

---

### `GlobalStats` (struct)

| Field                 | Type   | Description |
|---|---|---|
| `total_payments`      | `u64`  | Total payments processed |
| `total_volume`        | `i128` | Total payment volume |
| `total_refunds`       | `u64`  | Total refunds |
| `total_refund_volume` | `i128` | Total refund volume |

---

### `MerchantStats` (struct)

| Field                 | Type      | Description |
|---|---|---|
| `merchant_address`    | `Address` | |
| `total_payments`      | `u64`     | |
| `total_volume`        | `i128`    | |
| `total_refunds`       | `u64`     | |
| `total_refund_volume` | `i128`    | |

---

## Functions

### Admin

#### `set_admin(admin: Address)`

One-time initialisation. The caller becomes admin and the contract version is
set to `1`. Fails with `AdminAlreadySet` if called again.

#### `get_version() → u32`

Returns the current contract version.

#### `ping() → u64`

Health-check. Returns the current ledger timestamp.

#### `upgrade(admin: Address, new_wasm_hash: BytesN<32>)`

Upgrades the contract WASM in-place. Admin only. See README for the full
upgrade procedure.

---

### Merchant Management

#### `register_merchant(merchant_address, name, description, contact_info, category)`

Registers a new merchant. The caller must be `merchant_address`.

**Parameters**

| Name               | Type               |
|---|---|
| `merchant_address` | `Address`          |
| `name`             | `String`           |
| `description`      | `String`           |
| `contact_info`     | `String`           |
| `category`         | `MerchantCategory` |

**Errors**: `MerchantAlreadyRegistered`

---

#### `deactivate_merchant(caller: Address, merchant_address: Address)`

Deactivates a merchant. Callable by the merchant themselves or the admin.

**Errors**: `Unauthorized`, `MerchantNotFound`

---

#### `get_merchant(merchant_address: Address) → Merchant`

Returns the `Merchant` struct.

**Errors**: `MerchantNotFound`

---

### Payment Processing

#### `process_payment_with_signature(payer, order, signature, merchant_public_key)`

Transfers `order.amount` tokens from `payer` to `order.merchant_address` after
verifying that `signature` is a valid ed25519 signature of the serialised
`order` using `merchant_public_key`.

| Parameter            | Type           |
|---|---|
| `payer`              | `Address`      |
| `order`              | `PaymentOrder` |
| `signature`          | `BytesN<64>`   |
| `merchant_public_key`| `BytesN<32>`   |

**Errors**: `MerchantNotFound`, `MerchantInactive`, `PaymentAlreadyExists` (idempotent), `InvalidAmount`, `InvalidSignature`, `PaymentExpired`

> **Idempotency**: `PaymentAlreadyExists` means the same `order_id` was already
> processed. Off-chain clients should treat this as a success on retry. See
> [IDEMPOTENCY_GUIDE.md](./IDEMPOTENCY_GUIDE.md).

---

### Payment Queries

#### `get_payment_by_id(caller: Address, order_id: Bytes) → PaymentRecord`

Accessible by the payer, merchant, or admin.

**Errors**: `Unauthorized`, `PaymentNotFound`

---

#### `get_merchant_payment_history(merchant, cursor, limit, filter, sort_field, sort_order) → PaymentPage`

Returns a paginated page of payments for a merchant.

| Parameter    | Type                  | Notes |
|---|---|---|
| `merchant`   | `Address`             | |
| `cursor`     | `Option<Bytes>`       | `null` for first page |
| `limit`      | `u32`                 | Max 100 |
| `filter`     | `Option<PaymentFilter>`| `null` for no filter |
| `sort_field` | `SortField`           | |
| `sort_order` | `SortOrder`           | |

---

#### `get_payer_payment_history(payer, cursor, limit, filter, sort_field, sort_order) → PaymentPage`

Same signature as `get_merchant_payment_history` but scoped to a payer.

---

#### `get_global_payment_stats(admin, date_start, date_end) → GlobalStats`

Admin only. Returns aggregate stats across all merchants.

> **Known limitation**: `date_start` / `date_end` are currently a no-op (SC-003).

---

#### `get_merchant_stats(merchant, date_start, date_end) → MerchantStats`

Accessible by the merchant (own stats) or admin (any merchant).

- No date range: returns cached stats — O(1).
- With date range: computes on-demand — O(n) where n = merchant's payment count.

---

### Refunds

Refund window: **30 days + 1-hour grace buffer** from `paid_at`.

#### `initiate_refund(caller, refund_id, order_id, amount, reason)`

**Errors**: `RefundAlreadyExists` (idempotent), `RefundWindowExpired`, `RefundAmountExceedsPayment`

#### `approve_refund(caller: Address, refund_id: Bytes)`

Callable by merchant or admin.

#### `reject_refund(caller: Address, refund_id: Bytes)`

Callable by merchant or admin.

#### `execute_refund(refund_id: Bytes)`

Transfers funds. Requires merchant auth. Refund must be in `Approved` state.

#### `get_refund_status(refund_id: Bytes) → RefundStatus`

---

### Multi-Signature Payments

#### `initiate_multisig_payment(initiator, payment_id, order, required_signers)`

#### `sign_multisig_payment(signer: Address, payment_id: Bytes)`

**Errors**: `MultisigAlreadySigned` (idempotent)

#### `execute_multisig_payment(executor: Address, payment_id: Bytes)`

Executes once all required signers have signed.

**Errors**: `MultisigAlreadyExecuted` (idempotent), `InsufficientSignatures`

---

### Admin Config

#### `archive_payment_record(admin: Address, order_id: Bytes)`

Removes a payment from hot storage. Preserves a tombstone to prevent replay.

#### `cleanup_expired_payments(admin: Address)`

Removes payments older than the configured cleanup period.

#### `set_payment_cleanup_period(admin: Address, period: u64)`

Default: `7,776,000` seconds (90 days).

---

## Events

Events are emitted as Soroban contract events and can be retrieved from the
Stellar Horizon API or an event indexer.

### `admin_set`

Emitted by `set_admin`.

| Field   | Type      |
|---|---|
| `admin` | `Address` |

---

### `merchant_registered`

Emitted by `register_merchant`.

| Field              | Type               |
|---|---|
| `merchant_address` | `Address`          |
| `name`             | `String`           |
| `category`         | `MerchantCategory` |

---

### `merchant_deactivated`

Emitted by `deactivate_merchant`.

| Field              | Type      |
|---|---|
| `merchant_address` | `Address` |
| `caller`           | `Address` |

---

### `payment_processed`

Emitted by `process_payment_with_signature`.

| Field              | Type      |
|---|---|
| `order_id`         | `Bytes`   |
| `merchant_address` | `Address` |
| `payer`            | `Address` |
| `token`            | `Address` |
| `amount`           | `i128`    |

---

### `refund_initiated`

Emitted by `initiate_refund`.

| Field          | Type      |
|---|---|
| `refund_id`    | `Bytes`   |
| `order_id`     | `Bytes`   |
| `amount`       | `i128`    |
| `initiated_by` | `Address` |

---

### `refund_approved`

Emitted by `approve_refund`.

| Field       | Type      |
|---|---|
| `refund_id` | `Bytes`   |
| `caller`    | `Address` |

---

### `refund_rejected`

Emitted by `reject_refund`.

| Field       | Type      |
|---|---|
| `refund_id` | `Bytes`   |
| `caller`    | `Address` |

---

### `refund_executed`

Emitted by `execute_refund`.

| Field       | Type   |
|---|---|
| `refund_id` | `Bytes` |
| `amount`    | `i128`  |

---

### `multisig_initiated`

Emitted by `initiate_multisig_payment`.

| Field              | Type           |
|---|---|
| `payment_id`       | `Bytes`        |
| `initiator`        | `Address`      |
| `required_signers` | `Vec<Address>` |

---

### `multisig_signed`

Emitted by `sign_multisig_payment`.

| Field        | Type      |
|---|---|
| `payment_id` | `Bytes`   |
| `signer`     | `Address` |

---

### `multisig_executed`

Emitted by `execute_multisig_payment`.

| Field        | Type      |
|---|---|
| `payment_id` | `Bytes`   |
| `executor`   | `Address` |

---

### `contract_upgraded`

Emitted by `upgrade`.

| Field          | Type         |
|---|---|
| `new_wasm_hash`| `BytesN<32>` |

---

## Error Codes

| Code | Name                          | Description                                              | Idempotent? |
|---|---|---|---|
| 1    | `Unauthorized`                | Caller lacks permission                                  | No |
| 2    | `AdminAlreadySet`             | Admin already initialised                                | No |
| 10   | `MerchantNotFound`            | Merchant not registered                                  | No |
| 11   | `MerchantAlreadyRegistered`   | Duplicate merchant registration                          | No |
| 12   | `MerchantInactive`            | Merchant is deactivated                                  | No |
| 20   | `PaymentNotFound`             | Order ID not found                                       | No |
| 21   | `PaymentAlreadyExists`        | Duplicate `order_id` — treat as success on retry         | ✅ Yes |
| 22   | `InvalidAmount`               | Amount ≤ 0                                               | No |
| 23   | `InvalidSignature`            | ed25519 signature verification failed                    | No |
| 24   | `PaymentExpired`              | Order past `expires_at`                                  | No |
| 25   | `InsufficientBalance`         | Merchant balance too low for refund                      | No |
| 30   | `RefundNotFound`              | Refund ID not found                                      | No |
| 31   | `RefundAlreadyExists`         | Duplicate `refund_id` — treat as success on retry        | ✅ Yes |
| 32   | `RefundWindowExpired`         | Past 30-day refund window                                | No |
| 33   | `RefundAmountExceedsPayment`  | Cumulative refund > original amount                      | No |
| 34   | `RefundNotApproved`           | Refund not in Approved state                             | No |
| 35   | `RefundAlreadyCompleted`      | Refund already completed or rejected                     | No |
| 40   | `MultisigNotFound`            | Multisig payment not found                               | No |
| 41   | `MultisigAlreadySigned`       | Signer already signed — treat as success on retry        | ✅ Yes |
| 42   | `MultisigAlreadyExecuted`     | Payment already executed — treat as success on retry     | ✅ Yes |
| 43   | `InsufficientSignatures`      | Not all required signers have signed                     | No |
| 50   | `InvalidInput`                | General input validation failure                         | No |

---

## TypeScript SDK

The `@pulsar-contracts/sdk` package provides helpers for building and signing
`PaymentOrder` structs off-chain before submitting to the contract.

### Installation

```bash
npm install @pulsar-contracts/sdk
```

### Quick start

```typescript
import { createOrder, signOrder, getPublicKey, processPaymentIdempotent } from '@pulsar-contracts/sdk';

// 1. Build the order
const order = createOrder({
  orderId: 'ORDER-001',
  merchantAddress: 'G...',
  payer: 'G...',
  token: 'C...',
  amount: 1000n,
  description: 'Coffee purchase',
  expiresAt: 0n, // 0 = no expiry
});

// 2. Sign with merchant ed25519 private key (32-byte seed)
const signature = signOrder(order, privateKeySeed);

// 3. Get matching public key (pass to process_payment_with_signature)
const merchantPublicKey = getPublicKey(privateKeySeed);

// 4. Submit with idempotency handling
const result = await processPaymentIdempotent(
  (payload) => apiClient.processPayment(payload),
  { payer, order, signature, merchantPublicKey },
);
console.log(result.alreadyExisted ? 'Duplicate (safe)' : 'New payment');
```

For full SDK documentation see [`sdk/README.md`](../sdk/README.md).

For idempotency guidance see [`docs/IDEMPOTENCY_GUIDE.md`](./IDEMPOTENCY_GUIDE.md).
