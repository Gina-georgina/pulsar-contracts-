import https from "https";
import http from "http";
import { URL } from "url";
import * as dlq from "./dlq";

export interface WebhookPayload {
  event: string;
  contractId: string;
  ledger: number;
  timestamp: number;
  data: Record<string, unknown>;
}

const MAX_ATTEMPTS = 5;
const BASE_DELAY_MS = 1_000;

/**
 * Validate that a webhook target URL uses a secure scheme.
 *
 * Plain `http:` URLs leak payment event data in transit, so they are rejected
 * by default.  Insecure delivery is only permitted when either:
 *   - `NODE_ENV=development` (local development convenience), or
 *   - `ALLOW_INSECURE_WEBHOOKS=true` is explicitly set (a warning is logged).
 *
 * Throws a configuration-level error for any other scheme (including `http:`
 * when insecure delivery is not permitted).
 */
export function assertSecureUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(
      `[webhook] Invalid webhook URL "${url}": not a valid absolute URL`,
    );
  }

  if (parsed.protocol === "https:") return;

  const isDevelopment = process.env.NODE_ENV === "development";
  const allowInsecure = process.env.ALLOW_INSECURE_WEBHOOKS === "true";

  if (parsed.protocol === "http:" && (isDevelopment || allowInsecure)) {
    if (allowInsecure) {
      console.warn(
        `[webhook] WARNING: ALLOW_INSECURE_WEBHOOKS is enabled — delivering to insecure URL ${url}. Payment event data will be sent over plain HTTP.`,
      );
    }
    return;
  }

  throw new Error(
    `[webhook] Insecure webhook URL rejected: "${url}" uses scheme "${parsed.protocol}". ` +
      `Only "https:" is allowed. Set ALLOW_INSECURE_WEBHOOKS=true to override (not recommended).`,
  );
}

/**
 * Attempt to deliver `payload` to `url` with exponential-backoff retries.
 *
 * If all attempts are exhausted, the delivery is moved to the Dead Letter
 * Queue (DLQ) instead of being silently dropped.  The DLQ can be inspected
 * and replayed via the admin API endpoints:
 *
 *   GET  /admin/dlq           — list all failed deliveries
 *   GET  /admin/dlq/:id       — inspect a single entry
 *   POST /admin/dlq/:id/replay — replay a single entry
 */
export async function deliver(
  url: string,
  payload: WebhookPayload,
): Promise<void> {
  // Reject insecure targets before any delivery attempt is made.
  assertSecureUrl(url);

  const body = JSON.stringify(payload);
  const firstAttemptAt = new Date().toISOString();
  let lastError = "unknown error";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await post(url, body);
      return; // success — nothing to DLQ
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);

      if (attempt === MAX_ATTEMPTS) {
        // All attempts exhausted — move to DLQ.
        dlq.enqueue(url, payload, attempt, lastError, firstAttemptAt);
        return;
      }

      const delay = BASE_DELAY_MS * 2 ** (attempt - 1);
      console.warn(
        `[webhook] Attempt ${attempt}/${MAX_ATTEMPTS} failed for ${url} (${lastError}). Retrying in ${delay}ms…`,
      );
      await sleep(delay);
    }
  }
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function post(url: string, body: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // Guard again so no plain-HTTP request can ever be issued.
    try {
      assertSecureUrl(url);
    } catch (err) {
      reject(err);
      return;
    }
    const parsed = new URL(url);
    const lib = parsed.protocol === "https:" ? https : http;
    const req = lib.request(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname + parsed.search,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
          "User-Agent": "pulsar-webhook/0.1",
        },
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          resolve();
        } else {
          reject(new Error(`HTTP ${res.statusCode}`));
        }
        res.resume();
      },
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
