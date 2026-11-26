/**
 * alerts.js — Alert dispatcher for the Pulsar contract monitor.
 *
 * Supported channels:
 *   - stdout (always)
 *   - Webhook (Slack / PagerDuty / generic HTTP POST) when ALERT_WEBHOOK_URL
 *     is configured.
 */

"use strict";

const config = require("./config");

/**
 * Fire an alert.
 *
 * @param {"refund_rate" | "large_payment" | "error_rate" | "info"} type
 * @param {string} message  Human-readable description.
 * @param {object} [data]   Optional structured payload attached to the alert.
 */
async function alert(type, message, data = {}) {
  const payload = {
    source: "pulsar-contract-monitor",
    contract_id: config.contractId,
    alert_type: type,
    message,
    data,
    timestamp: new Date().toISOString(),
  };

  // Always log to stdout.
  const prefix = type === "info" ? "[INFO]" : "[ALERT]";
  console.log(`${prefix} [${type}] ${message}`, JSON.stringify(data));

  // Optionally POST to a webhook, with retries.
  if (config.alertWebhookUrl) {
    const MAX_ATTEMPTS = 3;
    const RETRY_DELAY_MS = 5000;

    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    let lastError = null;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const { default: fetch } = await import("node-fetch");
        const res = await fetch(config.alertWebhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (res.ok) {
          lastError = null;
          break;
        }
        lastError = new Error(
          `Webhook POST failed: ${res.status} ${res.statusText}`
        );
      } catch (err) {
        lastError = err;
      }

      if (attempt < MAX_ATTEMPTS) {
        console.error(
          `[alerts] Webhook retry ${attempt}/${MAX_ATTEMPTS} after failure: ${lastError.message}`
        );
        await sleep(RETRY_DELAY_MS);
      }
    }

    if (lastError) {
      console.error(
        `[alerts] Webhook alert failed after ${MAX_ATTEMPTS} attempts, alert dropped:`,
        lastError.message
      );
    }
  }
}

module.exports = { alert };
