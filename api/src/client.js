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
    const error = normalizeErrorPayload(payload, response);
    throw new ApiError(response.status, error.code, error.message, error.requestId);
  }

  return response.json();
}

/**
 * Normalizes an error payload into the standard { code, message, requestId } shape.
 *
 * Supports the standard format `{ error: { code, message, requestId? } }` as well as
 * legacy formats (`{ error: "message" }`, `{ message: "..." }`, raw strings) so that
 * existing services and clients remain compatible.
 */
function normalizeErrorPayload(payload, response) {
  const fallbackMessage = response.statusText || `Request failed with status ${response.status}`;
  const fallbackCode = "Unknown";

  // Standard format: { error: { code, message, requestId? } }
  if (payload && typeof payload === "object" && payload.error && typeof payload.error === "object") {
    return {
      code: payload.error.code ?? fallbackCode,
      message: payload.error.message ?? fallbackMessage,
      requestId: payload.error.requestId,
    };
  }

  // Legacy format: { error: "message" }
  if (payload && typeof payload === "object" && typeof payload.error === "string") {
    return { code: fallbackCode, message: payload.error, requestId: undefined };
  }

  // Legacy format: { message: "..." }
  if (payload && typeof payload === "object" && typeof payload.message === "string") {
    return { code: fallbackCode, message: payload.message, requestId: undefined };
  }

  return { code: fallbackCode, message: fallbackMessage, requestId: undefined };
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

    // ── Refunds ──────────────────────────────────────────────────────────────

    /**
     * Paginated refund listing. Accepts `{ cursor, limit }` (and any other
     * filter params); null/undefined values are omitted from the query string.
     */
    listRefunds(params = {}, { signal } = {}) {
      const qs = new URLSearchParams(
        Object.entries(params).filter(([, v]) => v != null)
      ).toString();
      return apiFetch(`/api/refunds${qs ? `?${qs}` : ""}`, { ...opts, signal });
    },

    /**
     * @deprecated The full refund list is no longer served by the API.
     * Use `listRefunds({ cursor, limit })` instead.
     */
    getAllRefunds() {
      throw new Error("getAllRefunds is deprecated; use listRefunds({ cursor, limit })");
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
  constructor(status, code, message, requestId) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}
