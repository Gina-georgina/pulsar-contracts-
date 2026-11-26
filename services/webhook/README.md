# Pulsar Webhook Service

Off-chain service that listens to Pulsar contract events and delivers HTTP POST notifications to registered merchant webhook URLs.

## Setup

```bash
cd services/webhook
cp .env.example .env    # fill in CONTRACT_ID
npm install
npm run dev             # development
npm run build && npm start  # production
```

## API

### Register a webhook

Registration is a two-step handshake. `POST /webhooks` does **not** immediately activate the URL; it creates a **pending** registration and sends a challenge token to the target URL. The registration only becomes **confirmed** (and starts receiving events) after the challenge is echoed back via the verification endpoint.

```http
POST /webhooks
Content-Type: application/json

{
  "merchantAddress": "GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  "url": "https://your-server.example.com/pulsar-events"
}
```

Response `202` (pending):
```json
{
  "merchantAddress": "GXXX...",
  "url": "https://your-server.example.com/pulsar-events",
  "status": "pending",
  "registeredAt": 1717200000000
}
```

The service then delivers a `POST` to the registered URL:

```json
{
  "event": "webhook_challenge",
  "merchantAddress": "GXXX...",
  "challenge": "<opaque challenge token>"
}
```

### Verify a webhook registration

Echo the challenge token back to confirm ownership of the URL:

```http
POST /webhooks/:merchantAddress/verify
Content-Type: application/json

{
  "challenge": "<opaque challenge token>"
}
```

Response `200` (confirmed):
```json
{
  "merchantAddress": "GXXX...",
  "url": "https://your-server.example.com/pulsar-events",
  "status": "confirmed",
  "registeredAt": 1717200000000,
  "confirmedAt": 1717200060000
}
```

An incorrect or expired challenge returns `400` and the registration stays pending.

### Get a registration

```http
GET /webhooks/:merchantAddress
```

### Delete a registration

```http
DELETE /webhooks/:merchantAddress
```

### Health endpoints

#### `GET /health`
Basic service status with a timestamp and uptime.

#### `GET /health/deep`
Full dependency health check including:
- database connection
- RPC node health
- contract availability on Soroban

#### `GET /health/liveness`
Reports whether the service process is alive.

#### `GET /health/readiness`
Reports whether the service is ready to receive traffic.

#### `GET /health/metrics`
Returns runtime health metrics and response-time statistics.

---

## Registration Security Model

Registering a webhook URL is a privileged action: whoever controls a registration receives that merchant's payment events. To prevent an attacker from registering a victim merchant's URL and intercepting their events, registrations must prove control of the target URL.

### Challenge-token handshake

1. **Request** — the client calls `POST /webhooks` with `merchantAddress` and `url`. The service stores the registration with `status: "pending"` and generates a single-use, time-limited challenge token.
2. **Challenge delivery** — the service sends a `webhook_challenge` event containing the token to the submitted URL. Only a party that actually receives traffic at that URL can read the token.
3. **Echo back** — the client calls `POST /webhooks/:merchantAddress/verify` with the token. If it matches the stored challenge and has not expired, the registration is marked `status: "confirmed"`.
4. **Activation** — only `confirmed` registrations receive event deliveries.

### Lifecycle

| Status | Meaning | Receives events |
|---|---|---|
| `pending` | Challenge issued, awaiting verification | No |
| `confirmed` | Challenge echoed back successfully | Yes |

Pending registrations that are never verified expire and are discarded. Re-registering a URL restarts the handshake with a fresh challenge token.

### Why unverified URLs are rejected

Without the handshake, anyone could register an arbitrary URL (including a victim merchant's) and receive events they do not own. Requiring the challenge to be echoed back proves the registrant controls the endpoint, so events are only ever delivered to URLs whose owners opted in. Event delivery to `pending` registrations is refused.

---

## Webhook Payload

Every event delivers a `POST` to the registered URL with this JSON body:

```json
{
  "event": "payment_processed",
  "contractId": "CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  "ledger": 1234567,
  "timestamp": 1717200000,
  "data": {
    "id": "0000000000000000-0000000000000000-0",
    "value": { ... }
  }
}
```

### Supported events

| `event` | Trigger |
|---|---|
| `payment_processed` | A payment was successfully processed |
| `refund_initiated` | A refund was initiated |
| `refund_approved` | A refund was approved |
| `refund_rejected` | A refund was rejected |
| `refund_executed` | A refund was executed (funds transferred) |
| `multisig_initiated` | A multisig payment was initiated |
| `multisig_signed` | A signer signed a multisig payment |
| `multisig_executed` | A multisig payment was executed |

---

## Retry Logic

Failed deliveries are retried with exponential backoff:

| Attempt | Delay |
|---|---|
| 1 | immediate |
| 2 | 1 s |
| 3 | 2 s |
| 4 | 4 s |
| 5 | 8 s |

After 5 failed attempts the delivery is dropped and the error is logged.
