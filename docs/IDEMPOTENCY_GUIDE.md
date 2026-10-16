# Idempotency Guide

Pulsar's on-chain contract is **naturally idempotent** for payment submission: if a
client submits the same `order_id` twice, the second call returns the
`PaymentAlreadyExists` error (code `21`). This document explains how off-chain
clients should handle that behaviour correctly so that network retries are safe.

---

## Why idempotency matters

Soroban transactions may be resubmitted by the client due to:

- Network timeouts before a response is received.
- Transient RPC errors (HTTP 5xx, connection resets).
- Client-side retry loops in payment SDKs or API gateways.

Without idempotency-aware handling, a generic error handler would surface
`PaymentAlreadyExists` as a failure even though the payment was actually
processed. This causes false error alerts and confuses downstream systems.

---

## Contract behaviour

| Scenario | Contract response | Meaning |
|---|---|---|
| First submission | Success (HTTP 201) | Payment recorded on-chain |
| Re-submission of same `order_id` | `PaymentAlreadyExists` (code 21) | Payment already recorded — treat as success |
| Different `order_id`, same data | New payment created | Treated as a distinct payment |

The `order_id` is the idempotency key. Clients **must** generate a stable,
unique `order_id` per logical payment (e.g. a UUID v4 generated at checkout
time and stored before the first submission attempt).

---

## SDK behaviour

The `@pulsar-contracts/sdk` treats `PaymentAlreadyExists` as a non-error when
calling `processPaymentIdempotent`. This helper wraps the standard payment
submission and resolves rather than rejects when the duplicate is detected:

```typescript
import { processPaymentIdempotent } from '@pulsar-contracts/sdk';

const result = await processPaymentIdempotent(client, {
  payer,
  order,
  signature,
  merchantPublicKey,
});
// result.alreadyExisted === true if the payment was a duplicate
// result.alreadyExisted === false if it was newly created
```

See [`sdk/src/idempotency.ts`](../sdk/src/idempotency.ts) for the full
implementation.

---

## Off-chain API layer

The REST API (`api/`) returns **HTTP 200** (not 201) when a duplicate
`order_id` is detected, with an `idempotent: true` flag in the response body:

```json
{
  "message": "Payment already processed",
  "idempotent": true
}
```

This lets API consumers distinguish a fresh creation (HTTP 201) from a
safe-retry (HTTP 200) without parsing contract error codes.

### Example: Node.js retry with axios

```typescript
import axios from 'axios';

async function submitPaymentWithRetry(payload, { maxRetries = 3 } = {}) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await axios.post('/api/payments', payload);
      return response.data; // 201 = new, 200 + idempotent:true = duplicate
    } catch (err) {
      const code = err.response?.data?.error?.code;
      if (code === 'PaymentAlreadyExists') {
        // Treat as success — payment was recorded on a previous attempt
        return { message: 'Payment already processed', idempotent: true };
      }
      if (attempt === maxRetries) throw err;
      // Exponential back-off: 200 ms, 400 ms, 800 ms …
      await new Promise(r => setTimeout(r, 200 * 2 ** (attempt - 1)));
    }
  }
}
```

---

## Generating stable order IDs

An `order_id` must be:

1. **Unique per logical payment** — two different purchases must never share an ID.
2. **Stable across retries** — the same purchase must always use the same ID.
3. **Generated before the first submission** — derive it from checkout session data, not from a server response.

Recommended pattern:

```typescript
import { v4 as uuidv4 } from 'uuid';

// At checkout creation time:
const orderId = uuidv4();        // e.g. "f47ac10b-58cc-4372-a567-0e02b2c3d479"
sessionStorage.setItem('pendingOrderId', orderId);

// On payment submission (and all retries):
const orderId = sessionStorage.getItem('pendingOrderId');
```

If you derive `order_id` from a hash of the order contents (merchant + payer +
amount + token), note that any two orders with identical contents will share the
same ID — this may be intentional (natural deduplication) or a bug depending on
your use case.

---

## Testing idempotency

The SDK test suite includes a scenario that verifies the retry behaviour:

```typescript
// sdk/src/__tests__/idempotency.test.ts
it('treats PaymentAlreadyExists as success on retry', async () => {
  // First call succeeds
  mockClient.processPayment.mockResolvedValueOnce({ success: true });
  // Second call simulates the contract returning PaymentAlreadyExists
  mockClient.processPayment.mockRejectedValueOnce(
    new PulsarError(PulsarErrorCode.PaymentAlreadyExists)
  );

  const result1 = await processPaymentIdempotent(mockClient, payload);
  const result2 = await processPaymentIdempotent(mockClient, payload);

  expect(result1.alreadyExisted).toBe(false);
  expect(result2.alreadyExisted).toBe(true);
});
```

Run the tests with:

```bash
cd sdk
npm install
npm run build
npm test
```

---

## Error code reference

| Code | Name | Description | Idempotent? |
|---|---|---|---|
| 21 | `PaymentAlreadyExists` | Duplicate `order_id` on payment submission | ✅ Yes — treat as success |
| 31 | `RefundAlreadyExists` | Duplicate `refund_id` on refund initiation | ✅ Yes — treat as success |
| 41 | `MultisigAlreadySigned` | Signer already signed this multisig payment | ✅ Yes — treat as success |
| 42 | `MultisigAlreadyExecuted` | Multisig payment already executed | ✅ Yes — treat as success |

All other error codes represent genuine failures and should not be swallowed.
