import express from "express";
import { errorMiddleware } from "./middleware/errors.js";
import merchantsRouter from "./routes/merchants.js";
import paymentsRouter from "./routes/payments.js";

const app = express();

app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => res.json({ status: "ok" }));
app.use("/api/merchants", merchantsRouter);
app.use("/api/payments", paymentsRouter);

app.use(errorMiddleware);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Pulsar API running on port ${PORT}`));