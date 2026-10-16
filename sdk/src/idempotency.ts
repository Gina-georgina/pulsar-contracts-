import { PulsarErrorCode } from '../errors';

/**
 * Result returned by processPaymentIdempotent.
 */
export interface IdempotentPaymentResult {
  /** true if the payment already existed (duplicate order_id on retry). */
  alreadyExisted: boolean;
}

/**
 * Minimal interface for the payment submission function expected by
 * processPaymentIdempotent. Compatible with the API client and direct
 * contract invocations.
 */
export interface PaymentSubmitFn {
  (payload: unknown): Promise<unknown>;
}

/**
 * Wraps a payment submission call and treats PaymentAlreadyExists (error
 * code 21) as a successful idempotent response rather than an error.
 *
 * Use this when retrying payments after a network timeout or transient
 * error — the same order_id will safely resolve instead of throwing.
 *
 * @param submitFn  Function that submits the payment (e.g. client.processPayment).
 * @param payload   Payload forwarded to submitFn as-is.
 * @returns         { alreadyExisted: false } on first creation,
 *                  { alreadyExisted: true }  on duplicate submission.
 * @throws          Re-throws any error that is NOT PaymentAlreadyExists.
 *
 * @example
 * ```typescript
 * const result = await processPaymentIdempotent(
 *   (p) => client.processPayment(p),
 *   { payer, order, signature },
 * );
 * if (result.alreadyExisted) {
 *   console.log('Payment was already recorded — safe retry');
 * }
 * ```
 */
export async function processPaymentIdempotent(
  submitFn: PaymentSubmitFn,
  payload: unknown,
): Promise<IdempotentPaymentResult> {
  try {
    await submitFn(payload);
    return { alreadyExisted: false };
  } catch (err: unknown) {
    if (isPulsarError(err, PulsarErrorCode.PaymentAlreadyExists)) {
      return { alreadyExisted: true };
    }
    throw err;
  }
}

/**
 * Check whether an error carries a specific Pulsar contract error code.
 * Works for both numeric codes thrown directly and objects with a `.code`
 * property (as returned by the off-chain API layer).
 */
export function isPulsarError(err: unknown, code: PulsarErrorCode): boolean {
  if (err == null) return false;
  if (typeof err === 'object') {
    const e = err as Record<string, unknown>;
    // API layer: { code: 'PaymentAlreadyExists' } or { code: 21 }
    if (e.code === code || e.code === PulsarErrorCode[code]) return true;
    // Numeric error from contract invocation
    if (typeof e.message === 'string' && e.message.includes(`#${code}`)) return true;
  }
  return false;
}
