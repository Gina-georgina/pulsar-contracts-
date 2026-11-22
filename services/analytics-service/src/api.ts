// SPDX-License-Identifier: MIT
import express, { NextFunction, Request, Response } from "express";
import { randomUUID } from "crypto";
import { Pool } from "pg";
import { AnalyticsCache, cacheTtlFromEnv } from "./cache";

/** Header used to correlate a request across services. */
export const REQUEST_ID_HEADER = "X-Request-ID";

/** Returns the incoming request ID (if any) or a freshly generated UUID. */
export function resolveRequestId(req: Request): string {
  const incoming = req.header(REQUEST_ID_HEADER);
  if (typeof incoming === "string" && incoming.trim().length > 0) {
    return incoming.trim();
  }
  return randomUUID();
}

/** Reads the request ID previously attached to the request by the middleware. */
export function requestIdOf(req: Request): string {
  return (req as Request & { requestId?: string }).requestId ?? "";
}

/** Emits a structured log line that always carries the request ID. */
export function logWithRequestId(
  level: "info" | "warn" | "error",
  requestId: string,
  message: string,
  extra: Record<string, unknown> = {}
): void {
  const entry = JSON.stringify({
    level,
    service: "analytics-service",
    request_id: requestId,
    message,
    timestamp: new Date().toISOString(),
    ...extra,
  });
  if (level === "error") {
    console.error(entry);
  } else if (level === "warn") {
    console.warn(entry);
  } else {
    console.log(entry);
  }
}

/** Express middleware: propagate or generate the X-Request-ID header. */
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const requestId = resolveRequestId(req);
  (req as Request & { requestId?: string }).requestId = requestId;
  res.setHeader(REQUEST_ID_HEADER, requestId);
  next();
}
=======

const REPORT_TABLES: Record<string, string> = {
  payments: "payments",
  refunds: "refunds",
};

/** Allowed granularities for the time-series endpoint. */
type Granularity = "hour" | "day" | "week";
const GRANULARITIES: Readonly<Record<string, Granularity>> = {
  hour: "hour",
  day: "day",
  week: "week",
};

/** Safe map from granularity → Postgres `date_trunc` unit (validated, not user-supplied). */
const DATE_TRUNC_UNIT: Readonly<Record<Granularity, string>> = {
  hour: "hour",
  day: "day",
  week: "week",
};

function parseGranularity(value: unknown): Granularity {
  if (typeof value === "string" && GRANULARITIES[value]) return GRANULARITIES[value];
  return "day";
}

function defaultEnd(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Builds a stable cache key from the request path and sorted query parameters. */
function cacheKeyFor(req: Request): string {
  const sorted = Object.keys(req.query)
    .sort()
    .map((k) => `${k}=${String(req.query[k])}`)
    .join("&");
  return `${req.path}?${sorted}`;
}

export function createAnalyticsRouter(databaseUrl: string): express.Router {
  const router = express.Router();
  const db = new Pool({ connectionString: databaseUrl });
  const cache = new AnalyticsCache(cacheTtlFromEnv());

  router.use(requestIdMiddleware);

  router.get("/analytics/summary", async (req, res) => {
    try {
      const result = await cache.getOrCompute(cacheKeyFor(req), async () => {
        const { rows: paymentRows } = await db.query(
          "SELECT COUNT(*)::int AS payment_count, COALESCE(SUM(amount), 0)::numeric AS total_volume, COALESCE(AVG(amount), 0)::numeric AS avg_transaction_value FROM payments"
        );
        const { rows: refundRows } = await db.query(
          "SELECT COUNT(*)::int AS refund_count, COALESCE(SUM(amount), 0)::numeric AS refund_volume FROM refunds"
        );
        const { rows: topMerchants } = await db.query(
          `SELECT merchant_id, COALESCE(SUM(amount), 0)::numeric AS volume
             FROM payments
            GROUP BY merchant_id
            ORDER BY volume DESC
            LIMIT 10`
        );

        const payments = paymentRows[0];
        const refunds = refundRows[0];
        const refundRate = payments.payment_count === 0
          ? 0
          : Number(refunds.refund_count) / Number(payments.payment_count);

        return {
          payment_count: payments.payment_count,
          total_payment_volume: payments.total_volume,
          average_transaction_value: payments.avg_transaction_value,
          refund_count: refunds.refund_count,
          total_refund_volume: refunds.refund_volume,
          refund_rate: refundRate,
          top_merchants_by_volume: topMerchants,
        };
      });
      res.json(result);
    } catch (err) {
      const requestId = requestIdOf(req);
      logWithRequestId("error", requestId, "Failed to compute analytics summary", {
        error: err instanceof Error ? err.message : String(err),
      });
      res.status(500).json({ error: "Failed to compute analytics summary", request_id: requestId });
    }
  });

  router.get("/analytics/trends", async (req, res) => {
    try {
      const { startDate, endDate } = req.query;
      const start = startDate ? String(startDate) : "2024-01-01";
      const end = endDate ? String(endDate) : defaultEnd();
      const result = await cache.getOrCompute(cacheKeyFor(req), async () => {
        const { rows } = await db.query(
          `SELECT date_trunc('day', created_at)::date AS day,
                  COUNT(*)::int AS payment_count,
                  COALESCE(SUM(amount),0)::numeric AS payment_volume
             FROM payments
            WHERE created_at BETWEEN $1::date AND $2::date + INTERVAL '1 day'
            GROUP BY 1
            ORDER BY 1`,
          [start, end]
        );
        return { trends: rows };
      });
      res.json(result);
    } catch (err) {
      const requestId = requestIdOf(req);
      logWithRequestId("error", requestId, "Failed to compute trends", {
        error: err instanceof Error ? err.message : String(err),
      });
      res.status(500).json({ error: "Failed to compute trends", request_id: requestId });
    }
  });

  router.get("/analytics/segments", async (req, res) => {
    try {
      const { startDate, endDate } = req.query;
      const start = startDate ? String(startDate) : "2024-01-01";
      const end = endDate ? String(endDate) : defaultEnd();
      const result = await cache.getOrCompute(cacheKeyFor(req), async () => {
        const { rows } = await db.query(
          `WITH customer_totals AS (
             SELECT customer_id,
                    COALESCE(SUM(amount),0)::numeric AS total_spend,
                    COUNT(*)::int AS payment_count
               FROM payments
              WHERE created_at BETWEEN $1::date AND $2::date + INTERVAL '1 day'
              GROUP BY customer_id
           )
           SELECT CASE
                    WHEN total_spend < 100 THEN 'low'
                    WHEN total_spend < 1000 THEN 'medium'
                    ELSE 'high'
                  END AS segment,
                  COUNT(*)::int AS customer_count,
                  COALESCE(SUM(total_spend),0)::numeric AS total_segment_spend,
                  COALESCE(AVG(payment_count),0)::numeric AS avg_payments_per_customer
             FROM customer_totals
            GROUP BY segment
            ORDER BY segment`,
          [start, end]
        );
        return { segments: rows };
      });
      res.json(result);
    } catch (err) {
      const requestId = requestIdOf(req);
      logWithRequestId("error", requestId, "Failed to compute customer segments", {
        error: err instanceof Error ? err.message : String(err),
      });
      res.status(500).json({ error: "Failed to compute customer segments", request_id: requestId });
    }
  });

  router.get("/analytics/custom-report", async (req, res) => {
    try {
      const { metric = "payments", merchant_id, startDate, endDate } = req.query;
      const start = startDate ? String(startDate) : "2024-01-01";
      const end = endDate ? String(endDate) : defaultEnd();
      const table = REPORT_TABLES[String(metric)] ?? "payments";
      let query = `SELECT date_trunc('day', created_at)::date AS day,
                          COUNT(*)::int AS count,
                          COALESCE(SUM(amount),0)::numeric AS volume
                     FROM ${table}
                    WHERE created_at BETWEEN $1::date AND $2::date + INTERVAL '1 day'`;
      const params: Array<string> = [start, end];

      if (merchant_id) {
        query += ` AND merchant_id = $3`;
        params.push(String(merchant_id));
      }

      query += ` GROUP BY 1 ORDER BY 1`;
      const { rows } = await db.query(query, params);
      res.json({ report: rows });
    } catch (err) {
      const requestId = requestIdOf(req);
      logWithRequestId("error", requestId, "Failed to generate custom report", {
        error: err instanceof Error ? err.message : String(err),
      });
      res.status(500).json({ error: "Failed to generate custom report", request_id: requestId });
    }
  });

  /**
   * GET /analytics/tokens
   *
   * Returns payment volume and count broken down by token. Optionally filtered
   * by a date range.
   *
   * Query params:
   *   - startDate  ISO date string (default 2024-01-01)
   *   - endDate    ISO date string (default today)
   *
   * Example response:
   *   {
   *     "tokens": [
   *       { "token": "native", "payment_count": 12, "payment_volume": "2400" },
   *       { "token": "CAS...XYZ", "payment_count": 5, "payment_volume": "875" }
   *     ],
   *     "cache": { "enabled": true, "ttl_seconds": 60 }
   *   }
   */
  router.get("/analytics/tokens", async (req, res) => {
    try {
      const { startDate, endDate } = req.query;
      const start = startDate ? String(startDate) : "2024-01-01";
      const end = endDate ? String(endDate) : defaultEnd();
      const result = await cache.getOrCompute(cacheKeyFor(req), async () => {
        const { rows } = await db.query(
          `SELECT token,
                  COUNT(*)::int AS payment_count,
                  COALESCE(SUM(amount), 0)::numeric AS payment_volume
             FROM payments
            WHERE created_at BETWEEN $1::date AND $2::date + INTERVAL '1 day'
            GROUP BY token
            ORDER BY payment_volume DESC`,
          [start, end]
        );
        return {
          tokens: rows,
          cache: { enabled: cache.enabled, ttl_seconds: cache.ttlSeconds },
        };
      });
      res.json(result);
    } catch (err) {
      const requestId = requestIdOf(req);
      logWithRequestId("error", requestId, "Failed to compute per-token breakdown", {
        error: err instanceof Error ? err.message : String(err),
      });
      res.status(500).json({ error: "Failed to compute per-token breakdown", request_id: requestId });
    }
  });

  /**
   * GET /analytics/timeseries
   *
   * Returns a time-series aggregation of payment count and volume with a
   * configurable granularity.
   *
   * Query params:
   *   - granularity  one of "hour" | "day" | "week" (default "day")
   *   - startDate    ISO date string (default 2024-01-01)
   *   - endDate      ISO date string (default today)
   *   - token        optional token filter
   *
   * Example response (granularity=day):
   *   {
   *     "granularity": "day",
   *     "series": [
   *       { "bucket": "2025-01-01", "payment_count": 3, "payment_volume": "600" },
   *       { "bucket": "2025-01-02", "payment_count": 5, "payment_volume": "1100" }
   *     ],
   *     "cache": { "enabled": true, "ttl_seconds": 60 }
   *   }
   */
  router.get("/analytics/timeseries", async (req, res) => {
    try {
      const { startDate, endDate, token } = req.query;
      const start = startDate ? String(startDate) : "2024-01-01";
      const end = endDate ? String(endDate) : defaultEnd();
      const granularity = parseGranularity(req.query.granularity);
      const unit = DATE_TRUNC_UNIT[granularity];

      const result = await cache.getOrCompute(cacheKeyFor(req), async () => {
        let query = `SELECT date_trunc('${unit}', created_at) AS bucket,
                            COUNT(*)::int AS payment_count,
                            COALESCE(SUM(amount), 0)::numeric AS payment_volume
                       FROM payments
                      WHERE created_at BETWEEN $1::date AND $2::date + INTERVAL '1 day'`;
        const params: Array<string> = [start, end];

        if (token) {
          query += ` AND token = $3`;
          params.push(String(token));
        }

        query += ` GROUP BY 1 ORDER BY 1`;
        const { rows } = await db.query(query, params);
        return {
          granularity,
          series: rows.map((r) => ({
            bucket: r.bucket,
            payment_count: r.payment_count,
            payment_volume: r.payment_volume,
          })),
          cache: { enabled: cache.enabled, ttl_seconds: cache.ttlSeconds },
        };
      });
      res.json(result);
    } catch (err) {
      const requestId = requestIdOf(req);
      logWithRequestId("error", requestId, "Failed to compute time-series aggregation", {
        error: err instanceof Error ? err.message : String(err),
      });
      res.status(500).json({ error: "Failed to compute time-series aggregation", request_id: requestId });
    }
  });

  return router;
}
