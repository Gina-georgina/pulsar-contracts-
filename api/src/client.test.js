/**
 * Tests for request cancellation in the Pulsar API client.
 * Run with: node --test api/src/client.test.js
 */
import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { createApiClient, CancelledError, ApiError } from "./client.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeAbortableFetch(resolveWith, { rejectWith } = {}) {
  return async (url, init = {}) => {
    return new Promise((resolve, reject) => {
      if (init.signal?.aborted) {
        const err = new DOMException("Aborted", "AbortError");
        reject(err);
        return;
      }
      const onAbort = () => reject(new DOMException("Aborted", "AbortError"));
      init.signal?.addEventListener("abort", onAbort, { once: true });

      if (rejectWith) {
        reject(rejectWith);
        return;
      }
      resolve({
        ok: true,
        json: async () => resolveWith,
      });
    });
  };
}

const client = createApiClient({ baseUrl: "" });

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("CancelledError", () => {
  it("is an Error", () => {
    const err = new CancelledError();
    assert.ok(err instanceof Error);
    assert.equal(err.name, "CancelledError");
  });
});

describe("ApiError", () => {
  it("carries status and code", () => {
    const err = new ApiError(404, "MerchantNotFound", "Not found");
    assert.equal(err.status, 404);
    assert.equal(err.code, "MerchantNotFound");
    assert.equal(err.message, "Not found");
  });
});

describe("createApiClient", () => {
  beforeEach(() => {
    // Reset globalThis.fetch to a default no-op
    globalThis.fetch = makeAbortableFetch({ ok: true });
  });

  it("cancellable() returns signal and cancel", () => {
    const { signal, cancel } = client.cancellable();
    assert.ok(signal instanceof AbortSignal);
    assert.equal(signal.aborted, false);
    cancel();
    assert.equal(signal.aborted, true);
  });

  it("throws CancelledError when signal is aborted before request", async () => {
    const { signal, cancel } = client.cancellable();
    cancel();
    globalThis.fetch = makeAbortableFetch({});
    await assert.rejects(
      () => client.getMerchant("G123", { signal }),
      (err) => {
        assert.ok(err instanceof CancelledError);
        return true;
      }
    );
  });

  it("throws CancelledError when aborted mid-flight", async () => {
    let doAbort;
    globalThis.fetch = (url, init = {}) =>
      new Promise((_resolve, reject) => {
        doAbort = () => reject(new DOMException("Aborted", "AbortError"));
        init.signal?.addEventListener("abort", doAbort, { once: true });
      });

    const { signal, cancel } = client.cancellable();
    const promise = client.getMerchant("G123", { signal });
    cancel();
    await assert.rejects(promise, (err) => {
      assert.ok(err instanceof CancelledError);
      return true;
    });
  });

  it("resolves with data on successful request", async () => {
    const merchant = { name: "Test Store", active: true };
    globalThis.fetch = makeAbortableFetch(merchant);
    const { signal } = client.cancellable();
    const result = await client.getMerchant("G123", { signal });
    assert.deepEqual(result, merchant);
  });

  it("throws ApiError on HTTP error response", async () => {
    globalThis.fetch = async () => ({
      ok: false,
      status: 404,
      statusText: "Not Found",
      json: async () => ({ error: { code: "MerchantNotFound", message: "Not found" } }),
    });
    await assert.rejects(
      () => client.getMerchant("G_MISSING", {}),
      (err) => {
        assert.ok(err instanceof ApiError);
        assert.equal(err.status, 404);
        assert.equal(err.code, "MerchantNotFound");
        return true;
      }
    );
  });

  it("parses the standardized error format including requestId", async () => {
    globalThis.fetch = async () => ({
      ok: false,
      status: 400,
      statusText: "Bad Request",
      json: async () => ({
        error: { code: "ValidationError", message: "Invalid merchant", requestId: "req-123" },
      }),
    });
    await assert.rejects(
      () => client.getMerchant("", {}),
      (err) => {
        assert.ok(err instanceof ApiError);
        assert.equal(err.status, 400);
        assert.equal(err.code, "ValidationError");
        assert.equal(err.message, "Invalid merchant");
        assert.equal(err.requestId, "req-123");
        return true;
      }
    );
  });

  it("falls back to a generic code when error body is malformed", async () => {
    globalThis.fetch = async () => ({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      json: async () => ({ message: "legacy shape" }),
    });
    await assert.rejects(
      () => client.getMerchant("G123", {}),
      (err) => {
        assert.ok(err instanceof ApiError);
        assert.equal(err.status, 500);
        assert.equal(typeof err.code, "string");
        assert.ok(err.code.length > 0);
        return true;
      }
    );
  });

  it("listPayments builds query string correctly", async () => {
    let capturedUrl;
    globalThis.fetch = async (url) => { capturedUrl = url; return { ok: true, json: async () => [] }; };
    await client.listPayments({ merchant: "G1", limit: 5, status: "Completed" });
    assert.ok(capturedUrl.includes("merchant=G1"));
    assert.ok(capturedUrl.includes("limit=5"));
    assert.ok(capturedUrl.includes("status=Completed"));
  });

  it("listPayments excludes null/undefined params", async () => {
    let capturedUrl;
    globalThis.fetch = async (url) => { capturedUrl = url; return { ok: true, json: async () => [] }; };
    await client.listPayments({ merchant: "G1", cursor: null, date_start: undefined });
    assert.ok(!capturedUrl.includes("cursor"));
    assert.ok(!capturedUrl.includes("date_start"));
  });
});

// ── Standardized error format ─────────────────────────────────────────────────

/**
 * Minimal Express-like app harness that mounts the shared error middleware so
 * we can assert the response shape for every error path.
 */
function makeErrorApp(errorMiddleware) {
  const routes = new Map();
  const app = {
    get(path, handler) { routes.set(path, handler); },
    async request(path) {
      const handler = routes.get(path);
      const res = {
        statusCode: 200,
        body: undefined,
        status(code) { this.statusCode = code; return this; },
        json(payload) { this.body = payload; return this; },
      };
      const req = { id: "req-test", method: "GET", path };
      try {
        await handler(req, res);
      } catch (err) {
        errorMiddleware(err, req, res, () => {});
      }
      return res;
    },
  };
  return app;
}

function assertStandardError(body, expectedCode) {
  assert.ok(body && typeof body === "object", "response body must be an object");
  assert.ok(body.error && typeof body.error === "object", "body.error must be an object");
  assert.equal(typeof body.error.code, "string");
  assert.ok(body.error.code.length > 0, "error.code must be non-empty");
  assert.equal(typeof body.error.message, "string");
  assert.ok(body.error.message.length > 0, "error.message must be non-empty");
  if (expectedCode) assert.equal(body.error.code, expectedCode);
  // No legacy top-level shapes
  assert.equal(body.message, undefined);
  assert.equal(body.stack, undefined);
  assert.equal(body.error.stack, undefined);
}

describe("standardized error middleware", () => {
  let errorMiddleware;

  beforeEach(async () => {
    ({ errorMiddleware } = await import("./middleware/error.js"));
  });

  it("validation errors return { error: { code, message } }", async () => {
    const app = makeErrorApp(errorMiddleware);
    app.get("/validate", () => {
      const err = new Error("merchant is required");
      err.status = 400;
      err.code = "ValidationError";
      throw err;
    });
    const res = await app.request("/validate");
    assert.equal(res.statusCode, 400);
    assertStandardError(res.body, "ValidationError");
    assert.equal(res.body.error.message, "merchant is required");
  });

  it("not-found errors return { error: { code, message } }", async () => {
    const app = makeErrorApp(errorMiddleware);
    app.get("/missing", () => {
      const err = new Error("Merchant not found");
      err.status = 404;
      err.code = "MerchantNotFound";
      throw err;
    });
    const res = await app.request("/missing");
    assert.equal(res.statusCode, 404);
    assertStandardError(res.body, "MerchantNotFound");
  });

  it("unexpected errors return a generic 500 shape without leaking details", async () => {
    const app = makeErrorApp(errorMiddleware);
    app.get("/boom", () => { throw new Error("kaboom: secret internal detail"); });
    const res = await app.request("/boom");
    assert.equal(res.statusCode, 500);
    assertStandardError(res.body, "InternalServerError");
    assert.ok(!res.body.error.message.includes("secret internal detail"));
  });

  it("includes requestId when available", async () => {
    const app = makeErrorApp(errorMiddleware);
    app.get("/with-id", () => {
      const err = new Error("bad input");
      err.status = 400;
      err.code = "ValidationError";
      throw err;
    });
    const res = await app.request("/with-id");
    assert.equal(res.body.error.requestId, "req-test");
  });

  it("omits stack traces when NODE_ENV=production", async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const app = makeErrorApp(errorMiddleware);
      app.get("/prod-boom", () => { throw new Error("kaboom"); });
      const res = await app.request("/prod-boom");
      assert.equal(res.statusCode, 500);
      assertStandardError(res.body, "InternalServerError");
      assert.equal(res.body.error.stack, undefined);
      assert.equal(res.body.stack, undefined);
      assert.ok(!JSON.stringify(res.body).includes("kaboom"));
    } finally {
      process.env.NODE_ENV = prev;
    }
  });
});
