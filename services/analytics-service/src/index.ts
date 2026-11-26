import express from "express";
import { createAnalyticsRouter } from "./api";
import {
  requestIdMiddleware,
  errorHandler,
  notFoundHandler,
} from "@shared/error-middleware";

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
app.use(requestIdMiddleware);
app.use(express.json());

app.get("/health", (_req, res) => {
  if (shuttingDown) {
    res.status(503).json({ status: "shutting_down" });
    return;
  }
  res.status(200).json({ status: "ok" });
});

app.use(createAnalyticsRouter(DATABASE_URL));

// 404 handler for unmatched routes
app.use(notFoundHandler);

// Shared error middleware must be registered last
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`[analytics] Service listening on port ${PORT}`);
});
