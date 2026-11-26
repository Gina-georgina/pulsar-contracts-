/**
 * Standardized error response format:
 * { "error": { "code": string, "message": string, "requestId"?: string } }
 */
import { randomUUID } from "node:crypto";
import { ContractError } from "../contractClient.js";

// Map known contract error codes to HTTP status codes
const CONTRACT_ERROR_STATUS = {
  Unauthorized: 403,
  AdminAlreadySet: 409,
  MerchantNotFound: 404,
  MerchantAlreadyRegistered: 409,
  MerchantInactive: 422,
  PaymentNotFound: 404,
  PaymentAlreadyExists: 409,
  InvalidAmount: 422,
  InvalidSignature: 422,
  PaymentExpired: 422,
  RefundNotFound: 404,
  RefundAlreadyExists: 409,
  RefundWindowExpired: 422,
  RefundAmountExceedsPayment: 422,
  RefundNotApproved: 422,
  RefundAlreadyCompleted: 409,
  MultisigNotFound: 404,
  MultisigAlreadySigned: 409,
  MultisigAlreadyExecuted: 409,
  InsufficientSignatures: 422,
  InvalidInput: 422,
};

/**
 * Create a standardized error object.
 * @param {string} code - Machine-readable error code.
 * @param {string} message - Human-readable error message.
 * @param {number} [status] - HTTP status code to associate with the error.
 * @returns {Error & { code: string, status?: number }}
 */
export function createError(code, message, status) {
  const err = new Error(message);
  err.code = code;
  if (status !== undefined) {
    err.status = status;
  }
  return err;
}

/**
 * Resolve a request id from the request, generating one if absent.
 * @param {import("express").Request} req
 * @returns {string}
 */
function resolveRequestId(req) {
  if (req && req.id) {
    return String(req.id);
  }
  const requestId = randomUUID();
  if (req) {
    req.id = requestId;
  }
  return requestId;
}

/**
 * Build the standardized error payload.
 * @param {string} code
 * @param {string} message
 * @param {string} requestId
 * @returns {{ error: { code: string, message: string, requestId: string } }}
 */
function buildErrorBody(code, message, requestId) {
  return { error: { code, message, requestId } };
}

export function errorMiddleware(err, req, res, _next) {
  const requestId = resolveRequestId(req);
  const isProduction = process.env.NODE_ENV === "production";

  if (err instanceof ContractError) {
    const match = Object.entries(CONTRACT_ERROR_STATUS).find(([name]) =>
      err.message.includes(name)
    );
    const status = match ? match[1] : 500;
    const code = match ? match[0] : "ContractError";
    return res.status(status).json(buildErrorBody(code, err.message, requestId));
  }

  if (err && err.status) {
    const code = err.code || "BadRequest";
    return res
      .status(err.status)
      .json(buildErrorBody(code, err.message, requestId));
  }

  // Unexpected error: log server-side, never leak stack traces in production
  console.error(err);
  const message = isProduction
    ? "Internal server error"
    : err && err.message
      ? err.message
      : "Internal server error";
  return res
    .status(500)
    .json(buildErrorBody("InternalError", message, requestId));
}