# Pulsar Contract Monitor (DO-012)

Off-chain monitoring and alerting for the deployed Pulsar payment-processing
contract. Connects to Stellar Horizon, streams contract events, tracks key
metrics, and fires alerts when anomaly thresholds are breached.

---

## Key Metrics

| Metric | Description |
|---|---|
| **payment_volume** | Number of `payment_processed` events in the rolling window |
| **refund_rate** | `refunds_initiated / payments_processed` in the rolling window |
| **error_rate** | `failed_polls / total_polls` in the rolling window |
| **total_payment_volume** | Cumulative sum of all payment amounts (token units) |

---

## Alert Conditions

| Alert type | Default threshold | Trigger |
|---|---|---|
| `refund_rate` | > 20 % in 1 hour | Refund rate exceeds `REFUND_RATE_THRESHOLD` within `REFUND_RATE_WINDOW_MS` |
| `large_payment` | > 1 000 XLM | Single payment amount exceeds `LARGE_PAYMENT_THRESHOLD` |
| `error_rate` | > 5 % in 1 hour | Poll error rate exceeds `ERROR_RATE_THRESHOLD` within the rolling window |

All alerts are logged to **stdout** and optionally POSTed to a webhook
(Slack, PagerDuty, or any HTTP endpoint) when `ALERT_WEBHOOK_URL` is set.

---

## Prerequisites

- Node.js ≥ 18
- A deployed Pulsar contract ID
- Network access to a Stellar Horizon instance

---

## Installation

```bash
cd monitoring
npm install
```

---

## Configuration

All settings are controlled via environment variables. No secrets are
hard-coded in source.

| Variable | Default | Description |
|---|---|---|
| `CONTRACT_ID` | *(required)* | Deployed contract address to monitor |
| `HORIZON_URL` | `https://horizon-testnet.stellar.org` | Horizon base URL |
| `POLL_INTERVAL_MS` | `15000` | How often to poll Horizon (ms) |
| `PING_INTERVAL_MS` | `300000` | How often to call the contract `ping` health check (ms, default 5 min) |
| `REFUND_RATE_THRESHOLD` | `0.20` | Refund rate alert threshold (0–1) |
| `REFUND_RATE_WINDOW_MS` | `3600000` | Rolling window for rate metrics (ms) |
| `LARGE_PAYMENT_THRESHOLD` | `1000000000` | Single-payment alert threshold (token units) |
| `ERROR_RATE_THRESHOLD` | `0.05` | Poll error rate alert threshold (0–1) |
| `ALERT_WEBHOOK_URL` | *(empty)* | Webhook URL for alert delivery |

### Example `.env` file

```bash
CONTRACT_ID=CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4
HORIZON_URL=https://horizon.stellar.org
POLL_INTERVAL_MS=15000
PING_INTERVAL_MS=300000
REFUND_RATE_THRESHOLD=0.20
REFUND_RATE_WINDOW_MS=3600000
LARGE_PAYMENT_THRESHOLD=1000000000
ERROR_RATE_THRESHOLD=0.05
ALERT_WEBHOOK_URL=https://hooks.slack.com/services/YOUR/SLACK/WEBHOOK
```

---

## Running

```bash
# Testnet (default)
CONTRACT_ID=<your-contract-id> npm start

# Mainnet
CONTRACT_ID=<your-contract-id> \
HORIZON_URL=https://horizon.stellar.org \
npm start
```

---

## Health Check — `ping` (BE-007)

The monitor calls the contract's read-only `ping(env) -> u64` function every
**5 minutes** (default) to verify the contract is live and responsive without
making any state-mutating call.

A successful ping logs:

```
[monitor] ping OK — latest ledger #12345678 closed_at=2026-10-21T22:29:11Z (timestamp=1761083351)
```

If the ping fails (network error, Horizon unreachable, or the contract is
unresponsive), the monitor fires a `ping_failed` alert and continues running.

You can also call ping directly from the CLI:

```bash
stellar contract invoke \
  --id $CONTRACT_ID \
  --source-account <KEY> \
  --network testnet \
  -- ping
```

The returned `u64` is the ledger `close_time` in Unix seconds. Compare it
against wall-clock time to detect severely stale ledger heads.

Adjust the ping interval via the `PING_INTERVAL_MS` environment variable
(default: `300000` ms = 5 minutes).

---

## How It Works

1. **Event streaming** — The monitor polls `GET /contract_events?contract_id=<id>`
   on Horizon using a cursor to avoid re-processing events. Horizon also
   supports SSE (`EventSource`) streaming; the cursor-based polling approach
   used here is simpler and more resilient to network interruptions.

2. **Metric collection** — Each `payment_processed` event increments the
   payment counter and adds the amount to the rolling window buffer.
   Each `refund_initiated` event increments the refund counter.

3. **Anomaly detection** — After every poll cycle the monitor computes
   windowed rates and compares them against configured thresholds.

4. **Alert dispatch** — Alerts are always printed to stdout. When
   `ALERT_WEBHOOK_URL` is set, a JSON payload is also POSTed to that URL.

### Alert payload format

```json
{
  "source": "pulsar-contract-monitor",
  "contract_id": "C...",
  "alert_type": "refund_rate",
  "message": "Refund rate 25.0% exceeds threshold 20.0% in the last 60 minutes",
  "data": {
    "window_ms": 3600000,
    "payment_volume_in_window": 40,
    "refund_rate_in_window": 0.25,
    "error_rate_in_window": 0,
    "total_payments": "40",
    "total_payment_volume": "4000000000",
    "total_refunds": "10",
    "total_errors": "0"
  },
  "timestamp": "2026-05-31T12:00:00.000Z"
}
```

---

## Deployment

The monitor is a long-running Node.js process. Recommended deployment options:

- **Docker** — use the provided `monitoring/Dockerfile` (minimal
  `node:18-alpine` image) and deploy alongside your existing infrastructure.
- **systemd** — use a unit file with `Restart=always` for bare-metal servers.
- **Cloud Run / ECS / Fly.io** — deploy as a single-container service.

### Docker

A `Dockerfile` is included in this directory. Build and run it directly:

```bash
cd monitoring

# Build the image
docker build -t pulsar-monitor .

# Run with your .env file (see "Example .env file" above)
docker run --env-file .env pulsar-monitor
```

On startup the container logs a message including the configured Horizon URL,
for example:

```
[monitor] starting — contract=C... horizon=https://horizon-testnet.stellar.org
```

If the container exits immediately, check that `CONTRACT_ID` is set and that
`HORIZON_URL` is reachable from inside the container.

### Docker Compose

The `monitoring` service is defined in the repository root
`docker-compose.yml`, with all environment variables bound from your shell or
a root-level `.env` file. From the repository root:

```bash
docker compose up monitoring
```

To run it in the background:

```bash
docker compose up -d monitoring
docker compose logs -f monitoring
```

---

## Extending

- **Add a new alert type**: add a case in `monitor.js → handleEvent()` and
  call `alert(type, message, data)`.
- **Persist metrics**: replace the in-memory `Metrics` class with a
  time-series store (e.g. Prometheus + Grafana, InfluxDB).
- **SSE streaming**: replace the `poll()` loop with an `EventSource` listener
  on `GET /contract_events?contract_id=<id>&cursor=now` for lower latency.
