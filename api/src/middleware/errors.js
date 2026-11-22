/**
 * Standardized error response format:
 * { "error": { "code": string, "message": string } }
 */
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

export function errorMiddleware(err, req, res, _next) {
  const requestId = req.id;

  if (err instanceof ContractError) {
    const match = Object.entries(CONTRACT_ERROR_STATUS).find(([name]) =>
      err.message.includes(name)
    );
    const status = match ? match[1] : 500;
    const code = match ? match[0] : "ContractError";
    return res.status(status).json({ error: { code, message: err.message, requestId } });
  }

  if (err.status) {
    return res
      .status(err.status)
      .json({ error: { code: "BadRequest", message: err.message, requestId } });
  }

  console.error({ requestId, error: err });
  res
    .status(500)
    .json({ error: { code: "InternalError", message: "Internal server error", requestId } });
}