/**
 * Pulsar API client with AbortController-based request cancellation.
 *
 * Usage:
 *   const client = createApiClient({ baseUrl: "http://localhost:3000" });
 *
 *   // In a component:
 *   const { signal, cancel } = client.cancellable();
 *   client.getMerchant(id, { signal }).then(...);
 *
 *   // On unmount:
 *   cancel();
 */

const DEFAULT_BASE_URL = process.env.API_BASE_URL ?? "http://localhost:3000";

/**
 * Core fetch wrapper — throws CancelledError on abort, ApiError on HTTP errors.
 *
 * If `requestId` is provided it is sent as the `X-Request-ID` header so the
 * request can be correlated across services for distributed tracing.
 */
async function apiFetch(path, { signal, method = "GET", body, baseUrl = DEFAULT_BASE_URL, requestId } = {}) {
  const headers = {};
  if (body) headers["Content-Type"] = "application/json";
  if (requestId) headers["X-Request-ID"] = requestId;

  let response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method,
      signal,
      headers: Object.keys(headers).length ? headers : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    if (err.name === "AbortError") throw new CancelledError();
    throw err;
  }

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new ApiError(response.status, payload?.error?.code ?? "Unknown", payload?.error?.message ?? response.statusText);
  }

  return response.json();
}

/**
 * Returns a { signal, cancel } pair backed by a single AbortController.
 */
export function cancellable() {
  const controller = new AbortController();
  return { signal: controller.signal, cancel: () => controller.abort() };
}

export function createApiClient({ baseUrl = DEFAULT_BASE_URL } = {}) {
  const opts = { baseUrl };

  return {
    /** Returns a { signal, cancel } pair for manual cancellation. */
    cancellable,

    // ── Merchants ────────────────────────────────────────────────────────────

    registerMerchant(data, { signal, requestId } = {}) {
      return apiFetch("/api/merchants", { ...opts, method: "POST", body: data, signal, requestId });
    },

    getMerchant(id, { signal, requestId } = {}) {
      return apiFetch(`/api/merchants/${encodeURIComponent(id)}`, { ...opts, signal, requestId });
    },

    // ── Payments ─────────────────────────────────────────────────────────────

    processPayment(data, { signal, requestId } = {}) {
      return apiFetch("/api/payments", { ...opts, method: "POST", body: data, signal, requestId });
    },

    getPayment(id, caller, { signal, requestId } = {}) {
      return apiFetch(`/api/payments/${encodeURIComponent(id)}?caller=${encodeURIComponent(caller)}`, { ...opts, signal, requestId });
    },

    listPayments(params = {}, { signal, requestId } = {}) {
      const qs = new URLSearchParams(
        Object.entries(params).filter(([, v]) => v != null)
      ).toString();
      return apiFetch(`/api/payments${qs ? `?${qs}` : ""}`, { ...opts, signal, requestId });
    },
  };
}

export class CancelledError extends Error {
  constructor() {
    super("Request was cancelled");
    this.name = "CancelledError";
  }
}

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}
