import { createServer, IncomingMessage, ServerResponse } from "http";
import { Pool } from "pg";
import { rpc } from "@stellar/stellar-sdk";

const DATABASE_URL = process.env.DATABASE_URL ?? "";
const RPC_URL = process.env.RPC_URL ?? "https://soroban-testnet.stellar.org";
const CONTRACT_ID = process.env.CONTRACT_ID ?? "";
const pool = new Pool({ connectionString: DATABASE_URL });
const DEFAULT_TIMEOUT_MS = 3000;

let shuttingDown = false;

export function setShuttingDown(value: boolean): void {
  shuttingDown = value;
}

export function getShutdownStatus(): boolean {
  return shuttingDown;
}

export type ComponentStatus = {
  status: "ok" | "down";
  durationMs?: number;
  error?: string;
  details?: unknown;
};

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

export async function checkDatabase(): Promise<ComponentStatus> {
  const start = Date.now();
  if (!DATABASE_URL) {
    throw new Error("DATABASE_URL is not configured");
  }

  const result = await withTimeout(pool.query("SELECT 1 AS ok"), DEFAULT_TIMEOUT_MS, "database check");
  const durationMs = Date.now() - start;

  if (result.rows.length === 1 && result.rows[0].ok === 1) {
    return { status: "ok", durationMs };
  }

  return { status: "down", durationMs, error: "unexpected database response" };
}

export async function checkRpcHealth(rpcUrl = RPC_URL): Promise<ComponentStatus> {
  const start = Date.now();
  const server = new rpc.Server(rpcUrl);
  const health = await withTimeout(server.getHealth(), DEFAULT_TIMEOUT_MS, "RPC health check");
  const durationMs = Date.now() - start;

  if (health.status === "healthy") {
    return { status: "ok", durationMs, details: health };
  }

  return { status: "down", durationMs, details: health };
}

export async function checkContractHealth(contractId = CONTRACT_ID, rpcUrl = RPC_URL): Promise<ComponentStatus> {
  const start = Date.now();
  if (!contractId) {
    throw new Error("CONTRACT_ID is not configured");
  }

  const server = new rpc.Server(rpcUrl);
  const wasmBuffer = await withTimeout(server.getContractWasmByContractId(contractId), DEFAULT_TIMEOUT_MS, "contract verification");
  const durationMs = Date.now() - start;

  if (wasmBuffer && wasmBuffer.length > 0) {
    return { status: "ok", durationMs, details: { wasmLength: wasmBuffer.length } };
  }

  return { status: "down", durationMs, error: "contract was not found or has no WASM payload" };
}

function downStatus(error: string): ComponentStatus {
  return { status: "down", error };
}

export function checkShutdown(): ComponentStatus {
  if (shuttingDown) {
    return { status: "down", error: "shutting_down" };
  }
  return { status: "ok" };
}

export async function checkDependencies(contractId = CONTRACT_ID, rpcUrl = RPC_URL): Promise<{ database: ComponentStatus; rpc: ComponentStatus; contract: ComponentStatus; shutdown: ComponentStatus }> {
  const shutdown = checkShutdown();

  if (shuttingDown) {
    const down = downStatus("shutting_down");
    return { database: down, rpc: down, contract: down, shutdown };
  }

  const [database, rpcHealth, contract] = await Promise.all([
    checkDatabase().catch((err) => downStatus(err instanceof Error ? err.message : String(err))),
    checkRpcHealth(rpcUrl).catch((err) => downStatus(err instanceof Error ? err.message : String(err))),
    checkContractHealth(contractId, rpcUrl).catch((err) => downStatus(err instanceof Error ? err.message : String(err))),
  ]);

  return { database, rpc: rpcHealth, contract, shutdown };
}

export type HealthReport = {
  status: "ok" | "down";
  components: { database: ComponentStatus; rpc: ComponentStatus; contract: ComponentStatus };
};

export async function buildHealthReport(contractId = CONTRACT_ID, rpcUrl = RPC_URL): Promise<HealthReport> {
  const components = await checkDependencies(contractId, rpcUrl);
  const status = Object.values(components).every((component) => component.status === "ok") ? "ok" : "down";
  return { status, components };
}

export async function healthHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = req.url ?? "/";
  if (url.split("?")[0] !== "/health") {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
    return;
  }

  try {
    const report = await buildHealthReport();
    res.writeHead(report.status === "ok" ? 200 : 503, { "Content-Type": "application/json" });
    res.end(JSON.stringify(report));
  } catch (err) {
    res.writeHead(503, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "down", error: err instanceof Error ? err.message : String(err) }));
  }
}

export function createHealthServer(): ReturnType<typeof createServer> {
  return createServer((req, res) => {
    void healthHandler(req, res);
  });
}

if (require.main === module) {
  const port = Number(process.env.HEALTH_PORT ?? process.env.PORT ?? 3000);
  const server = createHealthServer();
  server.listen(port, () => {
    console.log(`webhook health server listening on port ${port}`);
  });
}
