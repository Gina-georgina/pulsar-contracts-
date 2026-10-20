# Webhook Signature Verification

Addresses: [BE-013] — Webhook service has no signature verification on outbound payloads.

## Overview

Every webhook payload delivered to a merchant endpoint is signed with an
HMAC-SHA256 using a per-merchant secret key. The signature is included in the
`X-Pulsar-Signature` HTTP header so merchants can verify that the payload
originated from Pulsar and has not been tampered with in transit.

## Header format

```
X-Pulsar-Signature: sha256=<lowercase-hex-encoded-HMAC-SHA256>
```

Example:

```
X-Pulsar-Signature: sha256=3ecb4b2e1a3f7c6d...
```

## How to verify (merchant side)

### Python

```python
import hmac
import hashlib

def verify_pulsar_signature(body: bytes, secret: bytes, header: str) -> bool:
    """Returns True if the payload is authentic."""
    expected = "sha256=" + hmac.new(secret, body, hashlib.sha256).hexdigest()
    # Use compare_digest to prevent timing attacks
    return hmac.compare_digest(expected, header)
```

### Node.js

```js
const crypto = require('crypto');

function verifyPulsarSignature(body, secret, header) {
  const sig = 'sha256=' + crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('hex');
  // Use timingSafeEqual to prevent timing attacks
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(header));
}
```

### Go

```go
import (
    "crypto/hmac"
    "crypto/sha256"
    "encoding/hex"
    "fmt"
)

func verifyPulsarSignature(body []byte, secret []byte, header string) bool {
    mac := hmac.New(sha256.New, secret)
    mac.Write(body)
    expected := "sha256=" + hex.EncodeToString(mac.Sum(nil))
    return hmac.Equal([]byte(expected), []byte(header))
}
```

## Implementation notes

- The HMAC is computed over the **raw request body bytes** before JSON parsing.
  Always read the raw body before deserialising to avoid subtle encoding discrepancies.
- The per-merchant `secret_key` is stored in `WebhookRegistration.secret_key`
  and is set at webhook registration time.
- Signing is performed by `build_signature_header(secret_key, payload_bytes)` in
  `contracts/payment-processing-contract/src/webhook.rs` (scaffold feature).
- Reject any delivery that arrives without the `X-Pulsar-Signature` header or
  where verification fails; do not process the payload.
