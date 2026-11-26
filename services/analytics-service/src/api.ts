// SPDX-License-Identifier: MIT
import express, { Request, Response, NextFunction } from "express";
import { Pool } from "pg";
import { AnalyticsCache, cacheTtlFromEnv } from "./cache";

/** Standard error response body shared across all services. */
export interface ErrorBody {
  error: {
    code: string;
    message: string;
    requestId?: string;
  };
}

/** Error carrying an HTTP status and a stable machine-readable code. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

function requestIdFor(req: Request): string | undefined {
  const header = req.header("x-request-id");
  if (header) return header;
  const local = (res0 => res0)(req as unknown as { id?: string });
  return typeof local === "string" ? local : undefined;
}

/**
 * Shared Express error middleware. Normalizes every error path into the
 * standard `{ error: { code, message, requestId? } }` shape and never leaks
 * stack traces when `NODE_ENV=production`.
 */
export function errorMiddleware(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const isProduction = process.env.NODE_ENV === "production";
  const requestId = requestIdFor(req);

  let status = 500;
  let code = "INTERNAL_ERROR";
  let message = "Internal server error";

  if (err instanceof ApiError) {
    status = err.status;
    code = err.code;
    message = err.message;
  } else if (err instanceof Error) {
    if (!isProduction) {
      message = err.message || message;
    }
  }

  if (!isProduction && err instanceof Error && err.stack) {
    console.error(err.stack);
  } else {
    console.error(err);
  }

  const body: ErrorBody = { error: { code, message } };
  if (requestId) body.error.requestId = requestId;
  res.status(status).json(body);
}

/** Wraps an async route handler so rejected promises reach the error middleware. */
function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

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

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validates that a value is a string matching `YYYY-MM-DD` and represents a
 * real calendar date (e.g. rejects `2024-02-30`).
 */
function isValidDate(value: unknown): value is string {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/** Builds a stable cache key from the request path and sorted query parameters. */
function cacheKeyFor(req: Request): string {
  const sorted = Object.keys(req.query)
    .sort()
    .map((k) => `${k}=${String(req.query[k])}`)
    .join("&");
  return `${req.path}?${sorted}`;
}

/**
 * Loads the set of valid analytics API keys from the environment.
 *
 * Keys are provided via `ANALYTICS_API_KEYS` as a comma-separated list
 * (e.g. `ANALYTICS_API_KEYS=key1,key2`). In production this value should be
 * sourced from a secrets manager rather than committed to source control.
 */
function loadApiKeys(): Set<string> {
  const raw = process.env.ANALYTICS_API_KEYS ?? "";
  return new Set(
    raw
      .split(",")
      .map((k) => k.trim())
      .filter((k) => k.length > 0)
  );
}

/**
 * Express middleware that requires a valid API key on every analytics route.
 *
 * Expects `Authorization: Bearer <key>`. Responds with 401 when no key is
 * supplied and 403 when the supplied key is not recognized.
 */
export function requireApiKey(validKeys: Set<string>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const header = req.header("authorization") ?? "";
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    const provided = match ? match[1].trim() : "";

    if (!provided) {
      res.status(401).json({ error: "Missing API key" });
      return;
    }

    if (!validKeys.has(provided)) {
      res.status(403).json({ error: "Invalid API key" });
      return;
    }

    next();
  };
}

export function createAnalyticsRouter(databaseUrl: string): express.Router {
  const router = express.Router();
  const db = new Pool({ connectionString: databaseUrl });
  const cache = new AnalyticsCache(cacheTtlFromEnv());

  // Require a valid API key on all analytics routes.
  router.use("/analytics", requireApiKey(loadApiKeys()));

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
  }));

  router.get("/analytics/trends", asyncHandler(async (req, res) => {
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
  }));

  router.get("/analytics/segments", asyncHandler(async (req, res) => {
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
  }));

  router.get("/analytics/custom-report", asyncHandler(async (req, res) => {
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
  }));

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
      console.error(err);
      res.status(500).json({ error: "Failed to compute token analytics" });
    }
  });

  return router;
}

/**
 * Builds the analytics Express app with the shared error middleware registered
 * last so every error path returns the standardized error schema.
 */
export function createAnalyticsApp(databaseUrl: string): express.Express {
  const app = express();
  app.use(express.json());
  app.use(createAnalyticsRouter(databaseUrl));
  app.use((_req, res) => {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Not found" } });
  });
  app.use(errorMiddleware);
  return app;
}
