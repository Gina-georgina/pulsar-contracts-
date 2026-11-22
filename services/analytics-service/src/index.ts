import express from "express";
import { createAnalyticsRouter } from "./api";

const PORT = Number(process.env.PORT ?? 3100);
const DATABASE_URL = process.env.DATABASE_URL ?? "";

if (!DATABASE_URL) {
  console.error("DATABASE_URL environment variable is required");
  process.exit(1);
}

const app = express();
app.use(express.json());
app.use(createAnalyticsRouter(DATABASE_URL));

// Global error-handling middleware.
// Ensures no stack traces are included in production error responses.
app.use(
  (
    err: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    const status =
      typeof (err as { status?: unknown })?.status === "number"
        ? (err as { status: number }).status
        : 500;

    const message =
      err instanceof Error ? err.message : "Internal Server Error";

    const body: Record<string, unknown> = {
      error: status >= 500 ? "Internal Server Error" : message,
    };

    if (process.env.NODE_ENV !== "production") {
      if (err instanceof Error && err.stack) {
        body.stack = err.stack;
      }
    }

    res.status(status).json(body);
  }
);

app.listen(PORT, () => {
  console.log(`[analytics] Service listening on port ${PORT}`);
});