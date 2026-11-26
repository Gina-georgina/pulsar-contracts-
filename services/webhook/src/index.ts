import express from "express";
import { createRouter } from "./api";
import { startListener } from "./listener";
import { initStore } from "./store";

const PORT = Number(process.env.PORT ?? 3001);
const RPC_URL = process.env.RPC_URL ?? "https://soroban-testnet.stellar.org";
const CONTRACT_ID = process.env.CONTRACT_ID ?? "";
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? 5_000);
const DATABASE_URL = process.env.DATABASE_URL ?? "";

const SHUTDOWN_TIMEOUT_MS = 10_000;

if (!CONTRACT_ID) {
  console.error("CONTRACT_ID environment variable is required");
  process.exit(1);
}

if (!DATABASE_URL) {
  console.error("DATABASE_URL environment variable is required");
  process.exit(1);
}

async function main(): Promise<void> {
  try {
    await initStore(DATABASE_URL);
    console.log("[store] Webhook registrations loaded into memory cache");
  } catch (err) {
    console.error("[store] Failed to initialize webhook store:", err);
    process.exit(1);
  }

  const app = express();
  app.use(createRouter(RPC_URL, CONTRACT_ID));

  app.listen(PORT, () => {
    console.log(`[api] Webhook service listening on port ${PORT}`);
    startListener(RPC_URL, CONTRACT_ID, POLL_INTERVAL_MS);
  });
}

main().catch((err) => {
  console.error("[startup] Fatal error:", err);
  process.exit(1);
});