import express from "express";
import { createRouter } from "./api";
import { startListener } from "./listener";

const PORT = Number(process.env.PORT ?? 3001);
const RPC_URL = process.env.RPC_URL ?? "https://soroban-testnet.stellar.org";
const CONTRACT_ID = process.env.CONTRACT_ID ?? "";
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? 5_000);

const SHUTDOWN_TIMEOUT_MS = 10_000;

if (!CONTRACT_ID) {
  console.error("CONTRACT_ID environment variable is required");
  process.exit(1);
}

let shuttingDown = false;

export function isShuttingDown(): boolean {
  return shuttingDown;
}

const app = express();

app.get("/health", (_req, res) => {
  if (shuttingDown) {
    res.status(503).json({ status: "shutting_down" });
    return;
  }
  res.status(200).json({ status: "ok" });
});

app.use(createRouter(RPC_URL, CONTRACT_ID));

const server = app.listen(PORT, () => {
  console.log(`[api] Webhook service listening on port ${PORT}`);
  startListener(RPC_URL, CONTRACT_ID, POLL_INTERVAL_MS);
});

let shutdownInProgress = false;

async function gracefulShutdown(signal: string): Promise<void> {
  if (shutdownInProgress) {
    return;
  }
  shutdownInProgress = true;
  shuttingDown = true;
  console.log(`[api] Received ${signal}, starting graceful shutdown (timeout ${SHUTDOWN_TIMEOUT_MS}ms)`);

  const forceExitTimer = setTimeout(() => {
    console.error(`[api] Graceful shutdown timed out after ${SHUTDOWN_TIMEOUT_MS}ms, forcing exit`);
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExitTimer.unref();

  try {
    // Stop accepting new work: stop the listener from polling for new events.
    const { stopListener } = await import("./listener");
    if (typeof stopListener === "function") {
      await stopListener();
    }

    // Wait for in-flight webhook deliveries to complete.
    const { waitForInflightDeliveries } = await import("./listener");
    if (typeof waitForInflightDeliveries === "function") {
      await waitForInflightDeliveries(SHUTDOWN_TIMEOUT_MS);
    }

    // Close the HTTP server, waiting for in-flight requests to finish.
    await new Promise<void>((resolve, reject) => {
      server.close((err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });

    clearTimeout(forceExitTimer);
    console.log("[api] Graceful shutdown complete");
    process.exit(0);
  } catch (err) {
    clearTimeout(forceExitTimer);
    console.error("[api] Error during graceful shutdown:", err);
    process.exit(1);
  }
}

process.on("SIGTERM", () => {
  void gracefulShutdown("SIGTERM");
});

process.on("SIGINT", () => {
  void gracefulShutdown("SIGINT");
});