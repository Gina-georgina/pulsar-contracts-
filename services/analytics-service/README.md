# Pulsar Analytics Aggregation Service

A lightweight analytics service for Pulsar payment and refund data. Supports
per-token payment breakdowns, configurable time-series aggregation, and an
in-memory TTL cache for query results.

## Authentication

All `/analytics/*` endpoints require an API key. Send it as a bearer token in
the `Authorization` header:

```
Authorization: Bearer <key>
```

Valid keys are read from the `ANALYTICS_API_KEYS` environment variable (a
comma-separated list, so keys can be rotated without downtime). In production,
supply this value from your secrets manager rather than committing it.

Responses for missing or invalid credentials:

| Condition | Status |
|---|---|
| No `Authorization` header / no bearer key | `401 Unauthorized` |
| Key present but not in the allowlist | `403 Forbidden` |

## Endpoints

- `GET /analytics/summary`
  - Returns total payment volume, total payment count, total refund volume, refund count, refund rate, average transaction value, and top merchants by volume.

- `GET /analytics/trends?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD`
  - Returns day-over-day payment volume and count for the given date range.

- `GET /analytics/segments?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD`
  - Returns customer segmentation by total spend and payment count.

- `GET /analytics/custom-report?metric=payment_count|refund_rate|payments|refunds&merchant_id=...&startDate=...&endDate=...`
  - Generates a custom report for payments or refunds.

### Per-token breakdown — `GET /analytics/tokens`

Returns payment volume and count broken down by token contract ID. The
`payments` table must include a `token` column (see `schema.sql` and
`migrations/001_add_payments_token_column.sql` for existing databases).

**Query params:**

| Param | Type | Default | Description |
|---|---|---|---|
| `startDate` | date | `2024-01-01` | Inclusive lower bound |
| `endDate` | date | today | Inclusive upper bound |

**Example request:**

```
GET /analytics/tokens?startDate=2025-01-01&endDate=2025-01-31
Authorization: Bearer <key>
```

**Example response:**

```json
{
  "tokens": [
    { "token": "native", "payment_count": 12, "payment_volume": "2400" },
    { "token": "CAS...XYZ", "payment_count": 5, "payment_volume": "875" }
  ],
  "cache": { "enabled": true, "ttl_seconds": 60 }
}
```

Results are ordered by descending payment volume.

### Time-series — `GET /analytics/timeseries`

Returns payment count and volume bucketed by a configurable time granularity.

**Query params:**

| Param | Type | Default | Description |
|---|---|---|---|
| `granularity` | `hour` \| `day` \| `week` | `day` | Bucket size |
| `startDate` | date | `2024-01-01` | Inclusive lower bound |
| `endDate` | date | today | Inclusive upper bound |
| `token` | string | _(none)_ | Optional token filter |

**Example request:**

```
GET /analytics/timeseries?granularity=day&startDate=2025-01-01&endDate=2025-01-31
Authorization: Bearer <key>
```

**Example response:**

```json
{
  "granularity": "day",
  "series": [
    { "bucket": "2025-01-01", "payment_count": 3, "payment_volume": "600" },
    { "bucket": "2025-01-02", "payment_count": 5, "payment_volume": "1100" }
  ],
  "cache": { "enabled": true, "ttl_seconds": 60 }
}
```

The `bucket` field is a timestamp for `hour` granularity and a date for `day`
and `week` granularity (as returned by Postgres `date_trunc`).

## Caching

Query results are cached in memory with a configurable TTL to reduce repeated
database load. Configure it via the `ANALYTICS_CACHE_TTL_SECONDS` environment
variable (in seconds):

- `0` or unset — caching disabled; every request hits the database.
- `60` — cache results for one minute (recommended for dashboards).
- `300` — cache results for five minutes (suitable for heavier reports).

Each cached endpoint includes a `cache` object in its response indicating
whether caching is enabled and the active TTL, so clients can reason about
data freshness. Cache keys are derived from the request path and sorted query
parameters.

## Schema

This service expects a relational analytics database with `payments` and
`refunds` tables. See `schema.sql` for the minimal schema (includes the `token`
column required by the per-token breakdown).

For existing databases, apply the migration in
`migrations/001_add_payments_token_column.sql` to add the `token` column.

## Setup

```bash
cd services/analytics-service
npm install
cp .env.example .env
```

Set `DATABASE_URL` to the analytics database connection string. Set
`ANALYTICS_API_KEYS` to one or more comma-separated API keys (required — all
`/analytics/*` routes reject unauthenticated requests). Optionally set
`ANALYTICS_CACHE_TTL_SECONDS` to enable result caching.

## Run

```bash
npm run dev
```

## Notes

- The `token` column defaults to `'native'` so pre-existing payment records
  group under a single native-asset bucket until the indexer populates real
  token contract IDs.
- Granularity values are validated against an allowlist before being used in a
  `date_trunc` call, so arbitrary SQL cannot be injected through the
  `granularity` query parameter.
