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
 */
async function apiFetch(path, { signal, method = "GET", body, baseUrl = DEFAULT_BASE_URL } = {}) {
  let response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method,
      signal,
      headers: body ? { "Content-Type": "application/json" } : undefined,
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

    registerMerchant(data, { signal } = {}) {
      return apiFetch("/api/merchants", { ...opts, method: "POST", body: data, signal });
    },

    getMerchant(id, { signal } = {}) {
      return apiFetch(`/api/merchants/${encodeURIComponent(id)}`, { ...opts, signal });
    },

    // ── Payments ─────────────────────────────────────────────────────────────

    processPayment(data, { signal } = {}) {
      return apiFetch("/api/payments", { ...opts, method: "POST", body: data, signal });
    },

    getPayment(id, caller, { signal } = {}) {
      return apiFetch(`/api/payments/${encodeURIComponent(id)}?caller=${encodeURIComponent(caller)}`, { ...opts, signal });
    },

    listPayments(params = {}, { signal } = {}) {
      const qs = new URLSearchParams(
        Object.entries(params).filter(([, v]) => v != null)
      ).toString();
      return apiFetch(`/api/payments${qs ? `?${qs}` : ""}`, { ...opts, signal });
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
  constructor(status, code, message) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}
