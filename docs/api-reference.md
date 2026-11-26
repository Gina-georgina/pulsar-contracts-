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
- [HTTP API (Off-Chain Services)](#http-api-off-chain-services)
  - [Health Endpoints](#health-endpoints)
  - [Merchant Routes](#merchant-routes)
  - [Payment Routes](#payment-routes)
  - [Analytics Service](#analytics-service)
  - [Webhook Registration](#webhook-registration)
  - [DLQ Admin](#dlq-admin)

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
| 25   | `InsufficientBalance`         | Payer or merchant token balance too low for the transfer | No |
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

---

## HTTP API (Off-Chain Services)

The sections below document the HTTP services that sit alongside the contract:
the API gateway (`api/`), the analytics service (`services/analytics-service/`),
and the webhook service (`services/webhook/`).

Unless stated otherwise:

- All request and response bodies are JSON (`Content-Type: application/json`).
- Errors use the shape `{ "error": "<message>" }` with the HTTP status codes
  listed per endpoint.
- Amounts are serialised as strings to avoid precision loss on `i128` values.

---

### Health Endpoints

#### `GET /health`

Liveness probe exposed by the API gateway (`api/src/server.js`).

**Response `200 OK`**

```json
{ "status": "ok", "uptime": 1234.56 }
```

#### `GET /health` (analytics service)

The analytics service exposes the same liveness contract.

**Response `200 OK`**

```json
{ "status": "ok" }
```

---

### Merchant Routes

Base path: `/merchants` (`api/src/routes/merchants.js`).

#### `GET /merchants/:address`

Returns the merchant record for `address`.

**Path parameters**

| Name      | Type     | Description |
|---|---|---|
| `address` | `string` | Stellar merchant address |

**Response `200 OK`**

```json
{
  "address": "G...",
  "name": "Acme Coffee",
  "description": "Coffee shop",
  "contactInfo": "hello@acme.example",
  "category": "Food",
  "active": true,
  "registeredAt": "1700000000",
  "signingPublicKey": null
}
```

**Errors**: `404` merchant not found.

---

#### `GET /merchants/:address/payments`

Paginated payment history for a merchant. Query parameters mirror
`get_merchant_payment_history` on the contract.

**Query parameters**

| Name         | Type     | Default      | Description |
|---|---|---|---|
| `cursor`     | `string` | —            | Opaque pagination cursor (base64) |
| `limit`      | `number` | `20`         | Page size, max `100` |
| `dateStart`  | `number` | —            | Unix timestamp (seconds) |
| `dateEnd`    | `number` | —            | Unix timestamp (seconds) |
| `amountMin`  | `string` | —            | Minimum amount (`i128` as string) |
| `amountMax`  | `string` | —            | Maximum amount (`i128` as string) |
| `tokens`     | `string` | —            | Comma-separated token addresses |
| `status`     | `string` | `Any`        | `Any` \| `Completed` \| `PartiallyRefunded` \| `FullyRefunded` |
| `sortField`  | `string` | `Date`       | `Date` \| `Amount` |
| `sortOrder`  | `string` | `Descending` | `Ascending` \| `Descending` |

**Response `200 OK`**

```json
{
  "records": [ /* PaymentRecord[] */ ],
  "nextCursor": "eyJvZmZzZXQiOjIwfQ==",
  "total": 42
}
```

`nextCursor` is `null` on the last page.

**Errors**: `400` invalid query parameter, `404` merchant not found.

---

### Payment Routes

Base path: `/payments` (`api/src/routes/payments.js`).

#### `GET /payments/:orderId`

Returns a single payment record. `orderId` is the hex-encoded `Bytes` order ID.

**Response `200 OK`**

```json
{
  "orderId": "4f524445522d303031",
  "merchantAddress": "G...",
  "payer": "G...",
  "token": "C...",
  "amount": "1000",
  "refundedAmount": "0",
  "pendingRefundAmount": "0",
  "status": "Completed",
  "paidAt": "1700000000",
  "description": "Coffee purchase"
}
```

**Errors**: `404` payment not found.

---

#### `POST /payments`

Submits a signed payment order to the contract.

**Request body**

| Field               | Type     | Required | Description |
|---|---|---|---|
| `payer`             | `string` | yes      | Payer address |
| `order`             | `object` | yes      | `PaymentOrder` (see [Data Types](#paymentorder-struct)) |
| `signature`         | `string` | yes      | Hex-encoded 64-byte ed25519 signature |
| `merchantPublicKey` | `string` | yes      | Hex-encoded 32-byte ed25519 public key |

**Response `201 Created`**

```json
{ "orderId": "4f524445522d303031", "status": "Completed" }
```

A duplicate `orderId` returns `200 OK` with `"alreadyExisted": true` rather than
an error (idempotent retry semantics).

**Errors**: `400` invalid body, `422` contract rejected the payment
(`InvalidSignature`, `PaymentExpired`, `InvalidAmount`, …).

---

### Analytics Service

Base path: `/analytics` (`services/analytics-service/src/api.ts`). All
endpoints accept an optional `merchant` query parameter to scope results to a
single merchant; omitting it aggregates across all merchants.

#### `GET /analytics/summary`

Aggregate totals for the requested scope.

**Query parameters**

| Name       | Type     | Default | Description |
|---|---|---|---|
| `merchant` | `string` | —       | Merchant address filter |
| `from`     | `number` | —       | Unix timestamp (seconds), inclusive |
| `to`       | `number` | —       | Unix timestamp (seconds), inclusive |

**Response `200 OK`**

```json
{
  "totalPayments": 128,
  "totalVolume": "250000",
  "totalRefunds": 6,
  "totalRefundVolume": "12000",
  "averagePayment": "1953"
}
```

**Errors**: `400` invalid date range.

---

#### `GET /analytics/trends`

Time-bucketed payment volume and counts.

**Query parameters**

| Name       | Type     | Default | Description |
|---|---|---|---|
| `merchant` | `string` | —       | Merchant address filter |
| `from`     | `number` | —       | Unix timestamp (seconds) |
| `to`       | `number` | —       | Unix timestamp (seconds) |
| `interval` | `string` | `day`   | `hour` \| `day` \| `week` \| `month` |

**Response `200 OK`**

```json
{
  "interval": "day",
  "points": [
    { "bucket": "2024-01-01", "payments": 12, "volume": "24000" }
  ]
}
```

**Errors**: `400` invalid `interval` or date range.

---

#### `GET /analytics/segments`

Breaks payments down by a dimension.

**Query parameters**

| Name        | Type     | Default   | Description |
|---|---|---|---|
| `merchant`  | `string` | —         | Merchant address filter |
| `from`      | `number` | —         | Unix timestamp (seconds) |
| `to`        | `number` | —         | Unix timestamp (seconds) |
| `dimension` | `string` | `token`   | `token` \| `merchant` \| `status` |

**Response `200 OK`**

```json
{
  "dimension": "token",
  "segments": [
    { "key": "C...", "payments": 80, "volume": "160000" }
  ]
}
```

**Errors**: `400` invalid `dimension`.

---

#### `GET /analytics/tokens`

Per-token totals for the requested scope.

**Query parameters**

| Name       | Type     | Default | Description |
|---|---|---|---|
| `merchant` | `string` | —       | Merchant address filter |
| `from`     | `number` | —       | Unix timestamp (seconds) |
| `to`       | `number` | —       | Unix timestamp (seconds) |

**Response `200 OK`**

```json
{
  "tokens": [
    { "token": "C...", "payments": 80, "volume": "160000", "refunds": 3, "refundVolume": "6000" }
  ]
}
```

---

#### `POST /analytics/custom-report`

Runs an ad-hoc report described by the request body.

**Request body**

| Field        | Type       | Required | Description |
|---|---|---|---|
| `merchant`   | `string`   | no       | Merchant address filter |
| `from`       | `number`   | no       | Unix timestamp (seconds) |
| `to`         | `number`   | no       | Unix timestamp (seconds) |
| `metrics`    | `string[]` | yes      | Any of `payments`, `volume`, `refunds`, `refundVolume`, `averagePayment` |
| `groupBy`    | `string`   | no       | `day` \| `week` \| `month` \| `token` \| `merchant` |
| `filters`    | `object`   | no       | `{ "status"?: string, "tokens"?: string[] }` |

**Response `200 OK`**

```json
{
  "rows": [
    { "group": "2024-01-01", "payments": 12, "volume": "24000" }
  ]
}
```

**Errors**: `400` unknown metric or `groupBy` value, `422` invalid filter.

---

### Webhook Registration

Base path: `/webhooks` (`services/webhook/src/api.ts`). Webhooks are delivered
as signed `POST` requests to the registered `url`; each delivery includes an
`X-Pulsar-Signature` header containing an HMAC-SHA256 of the raw body keyed by
the registration's `secret`.

#### `POST /webhooks`

Registers a new webhook endpoint.

**Request body**

| Field     | Type       | Required | Description |
|---|---|---|---|
| `url`     | `string`   | yes      | HTTPS endpoint to deliver events to |
| `events`  | `string[]` | yes      | Event names, e.g. `payment_processed`, `refund_executed` |
| `secret`  | `string`   | no       | Signing secret; generated and returned if omitted |
| `active`  | `boolean`  | no       | Defaults to `true` |

**Response `201 Created`**

```json
{
  "id": "wh_01HXYZ",
  "url": "https://example.com/hooks/pulsar",
  "events": ["payment_processed"],
  "secret": "whsec_...",
  "active": true,
  "createdAt": "2024-01-01T00:00:00.000Z"
}
```

The `secret` is only returned on creation.

**Errors**: `400` missing `url`/`events` or non-HTTPS URL.

---

#### `GET /webhooks`

Lists all registered webhooks. Secrets are redacted.

**Response `200 OK`**

```json
{
  "webhooks": [
    {
      "id": "wh_01HXYZ",
      "url": "https://example.com/hooks/pulsar",
      "events": ["payment_processed"],
      "active": true,
      "createdAt": "2024-01-01T00:00:00.000Z"
    }
  ]
}
```

---

#### `DELETE /webhooks/:id`

Deletes a webhook registration.

**Response `204 No Content`**

**Errors**: `404` webhook not found.

---

### DLQ Admin

Base path: `/admin/dlq` (`services/webhook/src/dlq.ts`). These endpoints manage
the webhook dead-letter queue. They require an admin bearer token
(`Authorization: Bearer <token>`); missing or invalid tokens return `401`.

#### `GET /admin/dlq`

Lists dead-lettered deliveries, newest first.

**Query parameters**

| Name    | Type     | Default | Description |
|---|---|---|---|
| `limit` | `number` | `50`    | Page size, max `200` |
| `cursor`| `string` | —       | Opaque pagination cursor |

**Response `200 OK`**

```json
{
  "entries": [
    {
      "id": "dlq_01HXYZ",
      "webhookId": "wh_01HXYZ",
      "event": "payment_processed",
      "attempts": 5,
      "lastError": "HTTP 500",
      "failedAt": "2024-01-01T00:00:00.000Z"
    }
  ],
  "nextCursor": null
}
```

---

#### `GET /admin/dlq/:id`

Returns a single dead-letter entry including the original payload.

**Response `200 OK`**

```json
{
  "id": "dlq_01HXYZ",
  "webhookId": "wh_01HXYZ",
  "event": "payment_processed",
  "payload": { "orderId": "4f524445522d303031" },
  "attempts": 5,
  "lastError": "HTTP 500",
  "failedAt": "2024-01-01T00:00:00.000Z"
}
```

**Errors**: `404` entry not found.

---

#### `POST /admin/dlq/:id/replay`

Re-delivers the entry to its webhook. On success the entry is removed from the
DLQ; on failure it remains with an incremented `attempts` count.

**Response `200 OK`**

```json
{ "id": "dlq_01HXYZ", "replayed": true, "status": 200 }
```

**Errors**: `404` entry not found, `409` webhook registration no longer exists,
`502` delivery failed.

---

#### `DELETE /admin/dlq/:id`

Permanently discards a dead-letter entry.

**Response `204 No Content`**

**Errors**: `404` entry not found.
