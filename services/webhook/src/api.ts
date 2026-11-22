import express from "express";
import crypto from "crypto";
import { registerWebhook, getWebhook, deleteWebhook } from "./store";
import { checkDependencies, ComponentStatus } from "./health";
import * as dlq from "./dlq";
import { deliver } from "./deliver";

// ── Webhook registration handshake ──────────────────────────────────────────
//
// A registration is only confirmed once the registering party proves control
// of the target URL.  On POST /webhooks we create a *pending* registration
// with a random challenge token and attempt to deliver it to the target URL.
// The target must echo the token back via POST /webhooks/:merchantAddress/verify
// (or by calling the challenge URL) before the registration becomes active.
//
// Pending registrations expire after PENDING_TTL_MS.

const PENDING_TTL_MS = 15 * 60 * 1000;

interface PendingRegistration {
  merchantAddress: string;
  url: string;
  token: string;
  createdAt: number;
}

const pendingRegistrations = new Map<string, PendingRegistration>();

function pendingKey(merchantAddress: string): string {
  return merchantAddress.toLowerCase();
}

function pruneExpiredPending(now = Date.now()): void {
  for (const [key, pending] of pendingRegistrations) {
    if (now - pending.createdAt > PENDING_TTL_MS) {
      pendingRegistrations.delete(key);
    }
  }
}

function tokensMatch(expected: string, provided: unknown): boolean {
  if (typeof provided !== "string") return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

async function sendChallenge(url: string, merchantAddress: string, token: string): Promise<boolean> {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "webhook.verification",
        merchantAddress,
        token,
      }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export function createRouter(rpcUrl: string, contractId: string): express.Router {
  const router = express.Router();
  router.use(express.json());

  const metrics = {
    totalHealthCalls: 0,
    totalDeepCalls: 0,
    totalReadinessCalls: 0,
    totalLivenessCalls: 0,
    totalMetricsCalls: 0,
    averageResponseMs: 0,
    lastResponseMs: 0,
  };

  function recordMetrics(route: keyof Omit<typeof metrics, "averageResponseMs" | "lastResponseMs">, durationMs: number) {
    metrics[route] += 1;
    metrics.lastResponseMs = durationMs;
    metrics.averageResponseMs = Math.round((metrics.averageResponseMs * (metrics.totalHealthCalls + metrics.totalDeepCalls + metrics.totalReadinessCalls + metrics.totalLivenessCalls + metrics.totalMetricsCalls - 1) + durationMs) / (metrics.totalHealthCalls + metrics.totalDeepCalls + metrics.totalReadinessCalls + metrics.totalLivenessCalls + metrics.totalMetricsCalls));
  }

  function buildComponentSummary(components: Record<string, ComponentStatus>) {
    return Object.entries(components).reduce((acc, [key, value]) => {
      acc[key] = {
        status: value.status,
        durationMs: value.durationMs,
        details: value.details,
        error: value.error,
      };
      return acc;
    }, {} as Record<string, unknown>);
  }

  router.get("/health", (_req, res) => {
    const start = Date.now();
    const payload = {
      status: "ok",
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      dependencies: {
        database: "unverified",
        rpc: "unverified",
        contract: "unverified",
      },
    };
    const durationMs = Date.now() - start;
    recordMetrics("totalHealthCalls", durationMs);
    res.set("X-Health-Duration-Ms", durationMs.toString()).json(payload);
  });

  router.get("/health/deep", async (_req, res) => {
    const start = Date.now();
    const components = await checkDependencies(contractId, rpcUrl);
    const status = components.database.status === "ok" && components.rpc.status === "ok" && components.contract.status === "ok" ? "ok" : "unhealthy";
    const payload = {
      status,
      timestamp: new Date().toISOString(),
      components: buildComponentSummary(components),
    };
    const durationMs = Date.now() - start;
    recordMetrics("totalDeepCalls", durationMs);
    res.status(status === "ok" ? 200 : 503).set("X-Health-Duration-Ms", durationMs.toString()).json(payload);
  });

  router.get("/health/liveness", (_req, res) => {
    const start = Date.now();
    const payload = { status: "alive" };
    const durationMs = Date.now() - start;
    recordMetrics("totalLivenessCalls", durationMs);
    res.status(200).set("X-Health-Duration-Ms", durationMs.toString()).json(payload);
  });

  router.get("/health/readiness", async (_req, res) => {
    const start = Date.now();
    const components = await checkDependencies(contractId, rpcUrl);
    const ready = components.database.status === "ok" && components.rpc.status === "ok" && components.contract.status === "ok";
    const payload = {
      status: ready ? "ready" : "not ready",
      timestamp: new Date().toISOString(),
      components: buildComponentSummary(components),
    };
    const durationMs = Date.now() - start;
    recordMetrics("totalReadinessCalls", durationMs);
    res.status(ready ? 200 : 503).set("X-Health-Duration-Ms", durationMs.toString()).json(payload);
  });

  router.get("/health/metrics", (_req, res) => {
    const start = Date.now();
    const payload = {
      metrics,
      generatedAt: new Date().toISOString(),
    };
    const durationMs = Date.now() - start;
    recordMetrics("totalMetricsCalls", durationMs);
    res.status(200).set("X-Health-Duration-Ms", durationMs.toString()).json(payload);
  });

  // POST /webhooks — begin registration of a webhook URL for a merchant.
  //
  // Creates a pending registration and sends a challenge token to the target
  // URL.  The registration is NOT active until the target echoes the token
  // back via POST /webhooks/:merchantAddress/verify.
  router.post("/webhooks", async (req, res) => {
    const { merchantAddress, url } = req.body as { merchantAddress?: string; url?: string };
    if (!merchantAddress || !url) {
      res.status(400).json({ error: "merchantAddress and url are required" });
      return;
    }
    try {
      new URL(url);
    } catch {
      res.status(400).json({ error: "url is not a valid URL" });
      return;
    }

    pruneExpiredPending();

    const token = crypto.randomBytes(32).toString("hex");
    const key = pendingKey(merchantAddress);
    pendingRegistrations.set(key, {
      merchantAddress,
      url,
      token,
      createdAt: Date.now(),
    });

    const challengeDelivered = await sendChallenge(url, merchantAddress, token);

    res.status(202).json({
      status: "pending",
      merchantAddress,
      url,
      challengeDelivered,
      message:
        "Registration pending verification. Echo the challenge token back via " +
        "POST /webhooks/:merchantAddress/verify to confirm ownership of the URL.",
    });
  });

  // POST /webhooks/:merchantAddress/verify — complete the registration handshake.
  // Body: { token: string }
  router.post("/webhooks/:merchantAddress/verify", (req, res) => {
    const { token } = req.body as { token?: string };
    if (!token) {
      res.status(400).json({ error: "token is required" });
      return;
    }

    pruneExpiredPending();

    const key = pendingKey(req.params.merchantAddress);
    const pending = pendingRegistrations.get(key);
    if (!pending) {
      res.status(404).json({ error: "No pending registration for this merchant" });
      return;
    }

    if (!tokensMatch(pending.token, token)) {
      res.status(403).json({ error: "Invalid verification token" });
      return;
    }

    pendingRegistrations.delete(key);
    const reg = registerWebhook(pending.merchantAddress, pending.url);
    res.status(201).json(reg);
  });

  // GET /webhooks/:merchantAddress — retrieve registration
  router.get("/webhooks/:merchantAddress", (req, res) => {
    const reg = getWebhook(req.params.merchantAddress);
    if (!reg) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json(reg);
  });

  // DELETE /webhooks/:merchantAddress — remove registration
  router.delete("/webhooks/:merchantAddress", (req, res) => {
    const deleted = deleteWebhook(req.params.merchantAddress);
    res.status(deleted ? 204 : 404).end();
  });

  // ── DLQ Admin endpoints ────────────────────────────────────────────────────
  //
  // These endpoints are intended for admin / ops use only.  In production,
  // protect them with an API key or IP allowlist middleware before exposing
  // them publicly.

  // GET /admin/dlq — list all DLQ entries (newest first)
  // Query params:
  //   url_prefix — filter to entries whose target URL starts with this string
  router.get("/admin/dlq", (_req, res) => {
    const urlPrefix =
      typeof _req.query["url_prefix"] === "string"
        ? _req.query["url_prefix"]
        : undefined;
    const entries = dlq.listEntries(urlPrefix);
    res.json({
      depth: dlq.depth(),
      threshold: dlq.DLQ_ALERT_THRESHOLD,
      thresholdExceeded: dlq.depth() >= dlq.DLQ_ALERT_THRESHOLD,
      entries,
    });
  });

  // GET /admin/dlq/:id — inspect a single DLQ entry
  router.get("/admin/dlq/:id", (req, res) => {
    const entry = dlq.getEntry(req.params.id);
    if (!entry) {
      res.status(404).json({ error: "DLQ entry not found" });
      return;
    }
    res.json(entry);
  });

  // POST /admin/dlq/:id/replay — replay a single DLQ entry
  // Re-attempts delivery with the original payload and full backoff.
  // On success the entry is removed from the DLQ.
  // On failure the entry is retained for further manual retry; a new DLQ
  // entry may be created by deliver() for the re-attempt.
  router.post("/admin/dlq/:id/replay", async (req, res) => {
    const entry = dlq.getEntry(req.params.id);
    if (!entry) {
      res.status(404).json({ error: "DLQ entry not found" });
      return;
    }

    dlq.markReplayAttempt(req.params.id);

    try {
      await deliver(entry.url, entry.payload);
      dlq.remove(req.params.id);
      res
        .status(200)
        .json({ success: true, message: `Entry ${req.params.id} replayed and removed from DLQ.` });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(502).json({ success: false, error: message });
    }
  });

  // DELETE /admin/dlq/:id — discard a DLQ entry without replaying
  router.delete("/admin/dlq/:id", (req, res) => {
    const removed = dlq.remove(req.params.id);
    res.status(removed ? 204 : 404).end();
  });

  return router;
}
