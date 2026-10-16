# @pulsar-contracts/sdk

[![npm version](https://img.shields.io/npm/v/@pulsar-contracts/sdk.svg)](https://www.npmjs.com/package/@pulsar-contracts/sdk)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](../LICENSE)

TypeScript/JavaScript SDK for building and signing Pulsar `PaymentOrder` structs
off-chain before submitting them to the Soroban smart contract on Stellar.

---

## Installation

```bash
npm install @pulsar-contracts/sdk
```

Requires **Node.js ≥ 18**.

---

## Quick start

```typescript
import { createOrder, signOrder, getPublicKey, processPaymentIdempotent } from '@pulsar-contracts/sdk';

// 1. Build the order
const order = createOrder({
  orderId: 'ORDER-001',           // unique per payment — your idempotency key
  merchantAddress: 'GMERCHANT...',
  payer: 'GPAYER...',
  token: 'CTOKEN...',
  amount: 1000n,                  // in the token's smallest unit
  description: 'Coffee purchase',
  expiresAt: 0n,                  // 0n = no expiry
});

// 2. Sign with the merchant's ed25519 private key (32-byte seed)
const signature = signOrder(order, privateKeySeed);

// 3. Derive the matching public key to pass to the contract
const merchantPublicKey = getPublicKey(privateKeySeed);

// 4. Submit to the contract via your API layer (with idempotency handling)
const result = await processPaymentIdempotent(
  (payload) => apiClient.processPayment(payload),
  { payer: order.payer, order, signature, merchantPublicKey },
);

if (result.alreadyExisted) {
  console.log('Payment was already recorded — safe retry');
} else {
  console.log('Payment processed successfully');
}
```

---

## API reference

### `createOrder(params): PaymentOrder`

Constructs a `PaymentOrder` object ready for signing and on-chain submission.

| Parameter         | Type     | Required | Description |
|---|---|---|---|
| `orderId`         | `string` | ✅        | Unique order identifier. Used as the on-chain idempotency key. Generate a UUID v4 at checkout time and persist it before the first submission attempt. |
| `merchantAddress` | `string` | ✅        | Merchant's Stellar address (G…) |
| `payer`           | `string` | ✅        | Payer's Stellar address (G…) |
| `token`           | `string` | ✅        | Token contract address (C…) |
| `amount`          | `bigint` | ✅        | Payment amount in the token's smallest unit. Must be > 0. |
| `description`     | `string` | ✅        | Human-readable description (stored on-chain) |
| `expiresAt`       | `bigint` | —         | Unix timestamp (seconds). `0n` = no expiry. Defaults to `0n`. |

```typescript
const order = createOrder({
  orderId: 'ORDER-abc123',
  merchantAddress: 'GMERCHANT...',
  payer: 'GPAYER...',
  token: 'CTOKEN...',
  amount: 5000n,
  description: 'Subscription renewal',
  expiresAt: BigInt(Math.floor(Date.now() / 1000) + 3600), // expires in 1 hour
});
```

---

### `serializeOrder(order): Uint8Array`

Returns the canonical byte representation of an order used for signing.
Fields are concatenated as UTF-8 strings separated by `':'`.

Use this if you need to implement a custom signing flow outside this SDK.

```typescript
const bytes = serializeOrder(order);
// bytes can now be signed with any ed25519 library
```

---

### `signOrder(order, privateKey): string`

Signs a `PaymentOrder` with an ed25519 private key seed.

| Parameter    | Type         | Description |
|---|---|---|
| `order`      | `PaymentOrder` | The order to sign |
| `privateKey` | `Uint8Array`   | 32-byte ed25519 seed, or 64-byte keypair secret (first 32 bytes used as seed) |

Returns a **64-byte signature as a hex string**.

```typescript
// Generate a key pair (for testing — store your key securely in production)
import nacl from 'tweetnacl';
const keyPair = nacl.sign.keyPair();
const seed = keyPair.secretKey.slice(0, 32);

const signature = signOrder(order, seed);
// => "a1b2c3...128 hex chars"
```

---

### `getPublicKey(privateKey): string`

Derives the 32-byte ed25519 public key from a private key seed.
Returns a **32-byte public key as a hex string**.

Pass this value as `merchant_public_key` to `process_payment_with_signature`.

```typescript
const merchantPublicKey = getPublicKey(seed);
// => "d4e5f6...64 hex chars"
```

---

### `processPaymentIdempotent(submitFn, payload): Promise<IdempotentPaymentResult>`

Wraps a payment submission call and treats `PaymentAlreadyExists` (error code 21)
as a successful idempotent response rather than an error. Use this when retrying
after a network timeout.

```typescript
import { processPaymentIdempotent } from '@pulsar-contracts/sdk';

const result = await processPaymentIdempotent(
  (p) => myApiClient.processPayment(p),
  paymentPayload,
);

// result.alreadyExisted === false  →  freshly created
// result.alreadyExisted === true   →  duplicate order_id, already recorded
```

See [docs/IDEMPOTENCY_GUIDE.md](../docs/IDEMPOTENCY_GUIDE.md) for full guidance.

---

### `isPulsarError(err, code): boolean`

Utility to check whether a caught error carries a specific Pulsar contract error
code. Works with both numeric codes and string names.

```typescript
import { isPulsarError } from '@pulsar-contracts/sdk';
import { PulsarErrorCode } from '@pulsar-contracts/sdk/errors';

try {
  await client.processPayment(payload);
} catch (err) {
  if (isPulsarError(err, PulsarErrorCode.InvalidSignature)) {
    console.error('Signature check failed — regenerate and retry');
  }
}
```

---

## TypeScript types

All public types are exported from the package root:

```typescript
import type {
  PaymentOrder,
  CreateOrderParams,
  IdempotentPaymentResult,
  PaymentSubmitFn,
} from '@pulsar-contracts/sdk';
```

---

## Error codes

The SDK re-exports `PulsarErrorCode` and `getErrorMessage` from the error
registry:

```typescript
import { PulsarErrorCode, getErrorMessage } from '@pulsar-contracts/sdk/errors';

console.log(getErrorMessage(21));
// => "A payment with this order ID already exists"
```

Full error code reference: [`docs/api-reference.md#error-codes`](../docs/api-reference.md#error-codes).

---

## Building from source

```bash
cd sdk
npm install
npm run build    # compiles TypeScript to dist/
npm test         # runs the test suite
```

---

## Publishing to npm

The package is published automatically by CI when a release tag is pushed.
To publish manually:

```bash
cd sdk
npm run build
npm publish --access public
```

---

## Further reading

- [API Reference](../docs/api-reference.md) — full contract function signatures and types
- [Idempotency Guide](../docs/IDEMPOTENCY_GUIDE.md) — handling network retries safely
- [Contract README](../README.md) — deployment, testing, and CLI usage
