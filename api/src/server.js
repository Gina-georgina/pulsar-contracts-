import express from "express";
import { randomUUID } from "crypto";
import { errorMiddleware } from "./middleware/errors.js";
import merchantsRouter from "./routes/merchants.js";
import paymentsRouter from "./routes/payments.js";

const app = express();

// Request-ID middleware: generate or propagate X-Request-ID for distributed tracing.
// Must run before all routes and other middleware so every request is correlated.
app.use((req, res, next) => {
  const incomingId = req.headers["x-request-id"];
  const requestId =
    typeof incomingId === "string" && incomingId.trim() !== ""
      ? incomingId.trim()
      : randomUUID();

  req.requestId = requestId;
  res.setHeader("X-Request-ID", requestId);

  next();
});

app.use(express.json());

app.get("/health", (_req, res) => res.json({ status: "ok" }));
app.use("/api/merchants", merchantsRouter);
app.use("/api/payments", paymentsRouter);

app.use(errorMiddleware);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Pulsar API running on port ${PORT}`));