import express from "express";
import { createAnalyticsRouter } from "./api";

const PORT = Number(process.env.PORT ?? 3100);
const DATABASE_URL = process.env.DATABASE_URL ?? "";
const SHUTDOWN_TIMEOUT_MS = 10_000;

if (!DATABASE_URL) {
  console.error("DATABASE_URL environment variable is required");
  process.exit(1);
}

let shuttingDown = false;
let inFlightOperations = 0;
let resolveDrained: (() => void) | null = null;

function trackOperation<T>(operation: Promise<T>): Promise<T> {
  inFlightOperations += 1;
  return operation.finally(() => {
    inFlightOperations -= 1;
    if (shuttingDown && inFlightOperations === 0 && resolveDrained) {
      resolveDrained();
    }
  });
}

function waitForDrain(timeoutMs: number): Promise<void> {
  if (inFlightOperations === 0) {
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      resolveDrained = null;
      resolve();
    }, timeoutMs);
    resolveDrained = () => {
      clearTimeout(timer);
      resolveDrained = null;
      resolve();
    };
  });
}

const app = express();
app.use(express.json());

app.get("/health", (_req, res) => {
  if (shuttingDown) {
    res.status(503).json({ status: "shutting_down" });
    return;
  }
  res.status(200).json({ status: "ok" });
});

app.use(createAnalyticsRouter(DATABASE_URL));

const server = app.listen(PORT, () => {
  console.log(`[analytics] Service listening on port ${PORT}`);
});

async function gracefulShutdown(signal: string): Promise<void> {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  console.log(
    `[analytics] Received ${signal}, starting graceful shutdown (timeout ${SHUTDOWN_TIMEOUT_MS}ms)`
  );

  const serverClosed = new Promise<void>((resolve) => {
    server.close(() => resolve());
  });

  await Promise.all([serverClosed, waitForDrain(SHUTDOWN_TIMEOUT_MS)]);

  if (inFlightOperations > 0) {
    console.warn(
      `[analytics] Shutdown timeout reached with ${inFlightOperations} in-flight operation(s) remaining`
    );
  }

  try {
    const pool = (app.locals as { pool?: { end?: () => Promise<void> } }).pool;
    if (pool && typeof pool.end === "function") {
      await pool.end();
    }
  } catch (err) {
    console.error("[analytics] Error closing database pool", err);
  }

  console.log("[analytics] Graceful shutdown complete");
  process.exit(0);
}

process.on("SIGTERM", () => {
  void gracefulShutdown("SIGTERM");
});

process.on("SIGINT", () => {
  void gracefulShutdown("SIGINT");
});

export { app, server, trackOperation, SHUTDOWN_TIMEOUT_MS };