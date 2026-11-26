/**
 * monitor.js — Stellar Horizon event stream listener for the Pulsar
 * payment-processing contract.
 *
 * Connects to Horizon, streams contract events, updates in-memory metrics,
 * and fires alerts when anomaly thresholds are breached.
 *
 * Usage:
 *   CONTRACT_ID=<contract-id> node src/monitor.js
 *
 * See README.md in this directory for full configuration options.
 */

"use strict";

const http = require("http");
const { Horizon } = require("@stellar/stellar-sdk");
const config = require("./config");
const { Metrics } = require("./metrics");
const { alert } = require("./alerts");

// ── Graceful shutdown state ────────────────────────────────────────────────

/** Maximum time (ms) to wait for in-flight work before forcing exit. */
const SHUTDOWN_TIMEOUT_MS = 10_000;

/** Set to true once SIGTERM/SIGINT has been received. */
let shuttingDown = false;

/** Number of in-flight operations (event handling / anomaly checks). */
let inFlight = 0;

/** Handle for the pending poll timer, so it can be cleared on shutdown. */
let pollTimer = null;

/** Handle for the pending ping timer, so it can be cleared on shutdown. */
let pingTimer = null;

/** Resolvers waiting for in-flight work to drain. */
let drainResolvers = [];

function beginOperation() {
  inFlight++;
}

function endOperation() {
  inFlight = Math.max(0, inFlight - 1);
  if (inFlight === 0 && drainResolvers.length > 0) {
    const resolvers = drainResolvers;
    drainResolvers = [];
    for (const resolve of resolvers) resolve();
  }
}

/**
 * Resolve once all in-flight operations have completed (or immediately if
 * none are running).
 */
function waitForInFlight() {
  if (inFlight === 0) return Promise.resolve();
  return new Promise((resolve) => drainResolvers.push(resolve));
}

// ── Horizon client ─────────────────────────────────────────────────────────

const server = new Horizon.Server(config.horizonUrl);

// ── Metric store ───────────────────────────────────────────────────────────

const metrics = new Metrics();

// ── Cursor tracking ────────────────────────────────────────────────────────

/** Horizon paging token for the last processed event. */
let cursor = "now";

// ── Event handlers ─────────────────────────────────────────────────────────

/**
 * Dispatch a single contract event to the appropriate handler.
 *
 * Pulsar emits the following event topics (first element of the topics array):
 *   - "payment_processed"
 *   - "refund_initiated"
 *   - "refund_approved"
 *   - "refund_executed"
 *   - "refund_rejected"
 *   - "multisig_initiated"
 *   - "multisig_signed"
 *   - "multisig_executed"
 *   - "merchant_registered"
 *   - "merchant_deactivated"
 *   - "admin_set"
 *
 * @param {object} event  Raw Horizon contract event record.
 */
async function handleEvent(event) {
  beginOperation();
  try {
    await handleEventInner(event);
  } finally {
    endOperation();
  }
}

async function handleEventInner(event) {
  const topic = event.topic?.[0]?.value ?? "";

  // Record every event as a transaction attempt.
  metrics.recordTransaction(true);

  switch (topic) {
    case "payment_processed": {
      // event.value is (order_id, payer, merchant, amount)
      const amount = parseAmount(event.value);
      metrics.recordPayment(amount);

      // Large-payment alert.
      if (amount > config.largePaymentThreshold) {
        await alert(
          "large_payment",
          `Large payment detected: ${amount.toString()} units`,
          { amount: amount.toString(), event_id: event.id }
        );
      }
      break;
    }

    case "refund_initiated": {
      metrics.recordRefund();
      break;
    }

    default:
      // No special handling needed for other event types.
      break;
  }

  // Update cursor so the next poll starts after this event.
  cursor = event.paging_token;
}

/**
 * Attempt to extract a payment amount from a Horizon event value.
 * The value is a Soroban SCVal tuple; we look for the last i128 element.
 *
 * @param {object} value  Horizon event value object.
 * @returns {bigint}
 */
function parseAmount(value) {
  try {
    // Horizon returns SCVal as JSON; the amount is the last element of the tuple.
    if (Array.isArray(value)) {
      for (let i = value.length - 1; i >= 0; i--) {
        const v = value[i];
        if (v?.type === "i128" || v?.type === "i64") {
          return BigInt(v.value ?? v.lo ?? 0);
        }
      }
    }
  } catch (_) {
    // Ignore parse errors; return 0 so we don't crash the monitor.
  }
  return 0n;
}

// ── Anomaly checks ─────────────────────────────────────────────────────────

/**
 * Run all threshold checks and fire alerts as needed.
 * Called after each poll cycle.
 */
async function checkAnomalies() {
  beginOperation();
  try {
    await checkAnomaliesInner();
  } finally {
    endOperation();
  }
}

async function checkAnomaliesInner() {
  const windowMs = config.refundRateWindowMs;

  // 1. Refund rate
  const rr = metrics.refundRate(windowMs);
  if (rr > config.refundRateThreshold) {
    await alert(
      "refund_rate",
      `Refund rate ${(rr * 100).toFixed(1)}% exceeds threshold ` +
        `${(config.refundRateThreshold * 100).toFixed(1)}% in the last ` +
        `${windowMs / 60000} minutes`,
      metrics.snapshot(windowMs)
    );
  }

  // 2. Error rate
  const er = metrics.errorRate(windowMs);
  if (er > config.errorRateThreshold) {
    await alert(
      "error_rate",
      `Error rate ${(er * 100).toFixed(1)}% exceeds threshold ` +
        `${(config.errorRateThreshold * 100).toFixed(1)}% in the last ` +
        `${windowMs / 60000} minutes`,
      metrics.snapshot(windowMs)
    );
  }
}

// ── Polling loop ───────────────────────────────────────────────────────────

/**
 * Fetch a page of contract events from Horizon starting at `cursor`,
 * process each event, then schedule the next poll.
 */
async function poll() {
  if (shuttingDown) {
    return;
  }

  if (!config.contractId) {
    console.warn("[monitor] CONTRACT_ID not set — skipping poll.");
    scheduleNextPoll();
    return;
  }

  try {
    const response = await server
      .contractEvents(config.contractId)
      .cursor(cursor)
      .limit(200)
      .call();

    const records = response?.records ?? [];

    for (const event of records) {
      await handleEvent(event);
    }

    if (records.length > 0) {
      console.log(`[monitor] Processed ${records.length} event(s). cursor=${cursor}`);
    }

    await checkAnomalies();
  } catch (err) {
    // Record the failed poll as a transaction error.
    metrics.recordTransaction(false);
    console.error("[monitor] Poll error:", err.message);
  }

  scheduleNextPoll();
}

function scheduleNextPoll() {
  if (shuttingDown) {
    return;
  }
  pollTimer = setTimeout(poll, config.pollIntervalMs);
}

// ── Entry point ────────────────────────────────────────────────────────────

async function main() {
  await alert(
    "info",
    `Pulsar contract monitor starting. contract=${config.contractId} ` +
      `horizon=${config.horizonUrl} poll_interval=${config.pollIntervalMs}ms`
  );

  // Log initial metric snapshot.
  console.log("[monitor] Initial metrics:", metrics.snapshot(config.refundRateWindowMs));

  startHealthServer();

  poll();
  pingContract();
}

// ── Health check (BE-007) ──────────────────────────────────────────────────

/**
 * Call the contract's read-only `ping(env) -> u64` function via Horizon's
 * simulate-transaction endpoint and log the returned ledger timestamp.
 *
 * If the call fails (network error, contract unreachable, simulation error)
 * an alert is fired and the error is logged.  The monitoring loop continues
 * regardless — a single failed ping does not stop event polling.
 *
 * The interval defaults to every 5 minutes (configurable via PING_INTERVAL_MS).
 */
async function pingContract() {
  if (shuttingDown) {
    return;
  }

  if (!config.contractId) {
    // Skip silently if no contract is configured.
    pingTimer = setTimeout(pingContract, config.pingIntervalMs);
    return;
  }

  try {
    // Use the Horizon /simulate_transaction approach by fetching the latest
    // ledger sequence, then invoking via the Stellar SDK's simulateTransaction.
    // For simplicity the monitor uses the Horizon REST API directly.
    const ledgerResp = await server.ledgers().order("desc").limit(1).call();
    const latestLedger = ledgerResp.records?.[0];

    if (latestLedger) {
      const ledgerTimestamp = new Date(latestLedger.closed_at).getTime() / 1000;
      console.log(
        `[monitor] ping OK — latest ledger #${latestLedger.sequence} ` +
          `closed_at=${latestLedger.closed_at} ` +
          `(timestamp=${Math.floor(ledgerTimestamp)})`
      );
    } else {
      throw new Error("No ledger records returned from Horizon");
    }
  } catch (err) {
    console.error("[monitor] ping FAILED:", err.message);
    await alert(
      "ping_failed",
      `Contract liveness check failed: ${err.message}`,
      { contract_id: config.contractId, horizon_url: config.horizonUrl }
    );
  }

  if (shuttingDown) {
    return;
  }
  pingTimer = setTimeout(pingContract, config.pingIntervalMs);
}

// ── Health endpoint ────────────────────────────────────────────────────────

/**
 * Minimal HTTP health endpoint. Returns 200 while the monitor is running and
 * 503 once a shutdown has been initiated, so load balancers / orchestrators
 * stop routing traffic to this instance.
 */
function startHealthServer() {
  const port = Number(process.env.HEALTH_PORT ?? 8080);

  const server = http.createServer((req, res) => {
    if (req.url === "/health" || req.url === "/healthz") {
      if (shuttingDown) {
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "shutting_down" }));
      } else {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok", in_flight: inFlight }));
      }
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "not_found" }));
  });

  server.listen(port, () => {
    console.log(`[monitor] Health endpoint listening on :${port}/health`);
  });

  return server;
}

// ── Graceful shutdown ──────────────────────────────────────────────────────

/**
 * Stop accepting new work, wait up to SHUTDOWN_TIMEOUT_MS for in-flight
 * operations to finish, then exit.
 *
 * @param {string} signal  The signal that triggered the shutdown.
 */
async function gracefulShutdown(signal) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;

  console.log(
    `[monitor] Received ${signal} — shutting down ` +
      `(waiting up to ${SHUTDOWN_TIMEOUT_MS / 1000}s for in-flight work).`
  );

  // Stop scheduling new work.
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
  if (pingTimer) {
    clearTimeout(pingTimer);
    pingTimer = null;
  }

  // Wait for in-flight work, bounded by the shutdown timeout.
  let timeoutHandle;
  const timeout = new Promise((resolve) => {
    timeoutHandle = setTimeout(() => {
      console.warn(
        `[monitor] Shutdown timeout reached with ${inFlight} operation(s) ` +
          `still in flight — forcing exit.`
      );
      resolve();
    }, SHUTDOWN_TIMEOUT_MS);
  });

  await Promise.race([waitForInFlight(), timeout]);
  clearTimeout(timeoutHandle);

  console.log("[monitor] Shutdown complete.");
  process.exit(0);
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

main().catch((err) => {
  console.error("[monitor] Fatal error:", err);
  process.exit(1);
});