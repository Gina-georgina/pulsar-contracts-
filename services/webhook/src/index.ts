import express from "express";
import { createRouter } from "./api";
import { startListener } from "./listener";
import { requestIdMiddleware } from "./requestId";

const PORT = Number(process.env.PORT ?? 3001);
const RPC_URL = process.env.RPC_URL ?? "https://soroban-testnet.stellar.org";
const CONTRACT_ID = process.env.CONTRACT_ID ?? "";
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? 5_000);

if (!CONTRACT_ID) {
  console.error("CONTRACT_ID environment variable is required");
  process.exit(1);
}

const app = express();
app.use(requestIdMiddleware);
app.use(createRouter(RPC_URL, CONTRACT_ID));

app.listen(PORT, () => {
  console.log(`[api] Webhook service listening on port ${PORT}`);
  startListener(RPC_URL, CONTRACT_ID, POLL_INTERVAL_MS);
});