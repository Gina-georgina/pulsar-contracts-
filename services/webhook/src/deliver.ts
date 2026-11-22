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
  requestId?: string,
): Promise<void> {
  const body = JSON.stringify(payload);
  const firstAttemptAt = new Date().toISOString();
  let lastError = "unknown error";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await post(url, body, requestId);
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

function post(url: string, body: string, requestId?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib = parsed.protocol === "https:" ? https : http;
    const headers: Record<string, string | number> = {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body),
      "User-Agent": "pulsar-webhook/0.1",
    };
    if (requestId) {
      headers["X-Request-ID"] = requestId;
    }
    const req = lib.request(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname + parsed.search,
        method: "POST",
        headers,
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
