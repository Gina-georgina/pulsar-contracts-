import express from "express";
import { randomUUID } from "crypto";
import { createAnalyticsRouter } from "./api";

const PORT = Number(process.env.PORT ?? 3100);
const DATABASE_URL = process.env.DATABASE_URL ?? "";

if (!DATABASE_URL) {
  console.error("DATABASE_URL environment variable is required");
  process.exit(1);
}

const app = express();

app.use((req, res, next) => {
  const incoming = req.header("X-Request-ID");
  const requestId = incoming && incoming.trim() ? incoming.trim() : randomUUID();
  res.locals.requestId = requestId;
  res.setHeader("X-Request-ID", requestId);
  (req as express.Request & { requestId?: string }).requestId = requestId;
  next();
});

app.use(express.json());
app.use(createAnalyticsRouter(DATABASE_URL));

app.listen(PORT, () => {
  console.log(`[analytics] Service listening on port ${PORT}`);
});