/**
 * Tests for processPaymentIdempotent — verifies that PaymentAlreadyExists
 * is treated as a successful idempotent response and not re-thrown.
 *
 * Run with: npm test  (from sdk/)
 */

import { processPaymentIdempotent, isPulsarError } from '../src/idempotency';
import { PulsarErrorCode } from '../errors';

// ── helpers ────────────────────────────────────────────────────────────────

function makeApiError(code: string | number) {
  const err = new Error(`Contract error: #${code}`) as Error & { code: unknown };
  err.code = code;
  return err;
}

const SAMPLE_PAYLOAD = {
  payer: 'GPAYER',
  order: { order_id: 'ORDER-001', amount: 1000n },
  signature: 'aabbcc',
};

// ── isPulsarError ──────────────────────────────────────────────────────────

describe('isPulsarError', () => {
  it('returns true for numeric code match', () => {
    const err = makeApiError(21);
    expect(isPulsarError(err, PulsarErrorCode.PaymentAlreadyExists)).toBe(true);
  });

  it('returns true for string code match', () => {
    const err = makeApiError('PaymentAlreadyExists');
    expect(isPulsarError(err, PulsarErrorCode.PaymentAlreadyExists)).toBe(true);
  });

  it('returns false for a different error code', () => {
    const err = makeApiError(22);
    expect(isPulsarError(err, PulsarErrorCode.PaymentAlreadyExists)).toBe(false);
  });

  it('returns false for null', () => {
    expect(isPulsarError(null, PulsarErrorCode.PaymentAlreadyExists)).toBe(false);
  });

  it('returns true when error message contains the code number', () => {
    const err = new Error('Contract invocation failed with #21');
    expect(isPulsarError(err, PulsarErrorCode.PaymentAlreadyExists)).toBe(true);
  });
});

// ── processPaymentIdempotent ───────────────────────────────────────────────

describe('processPaymentIdempotent', () => {
  it('returns alreadyExisted=false on first successful submission', async () => {
    const submit = jest.fn().mockResolvedValueOnce({ success: true });
    const result = await processPaymentIdempotent(submit, SAMPLE_PAYLOAD);
    expect(result.alreadyExisted).toBe(false);
    expect(submit).toHaveBeenCalledWith(SAMPLE_PAYLOAD);
  });

  it('returns alreadyExisted=true when PaymentAlreadyExists is thrown (numeric code)', async () => {
    const submit = jest.fn().mockRejectedValueOnce(makeApiError(21));
    const result = await processPaymentIdempotent(submit, SAMPLE_PAYLOAD);
    expect(result.alreadyExisted).toBe(true);
  });

  it('returns alreadyExisted=true when PaymentAlreadyExists is thrown (string code)', async () => {
    const submit = jest.fn().mockRejectedValueOnce(makeApiError('PaymentAlreadyExists'));
    const result = await processPaymentIdempotent(submit, SAMPLE_PAYLOAD);
    expect(result.alreadyExisted).toBe(true);
  });

  it('re-throws non-idempotent errors', async () => {
    const submit = jest.fn().mockRejectedValueOnce(makeApiError(22));
    await expect(processPaymentIdempotent(submit, SAMPLE_PAYLOAD)).rejects.toMatchObject({ code: 22 });
  });

  it('re-throws generic network errors', async () => {
    const networkError = new Error('Network timeout');
    const submit = jest.fn().mockRejectedValueOnce(networkError);
    await expect(processPaymentIdempotent(submit, SAMPLE_PAYLOAD)).rejects.toThrow('Network timeout');
  });

  it('handles retry scenario: first succeeds, second is idempotent', async () => {
    const submit = jest
      .fn()
      .mockResolvedValueOnce({ success: true })          // attempt 1
      .mockRejectedValueOnce(makeApiError(21));           // attempt 2 (retry)

    const result1 = await processPaymentIdempotent(submit, SAMPLE_PAYLOAD);
    const result2 = await processPaymentIdempotent(submit, SAMPLE_PAYLOAD);

    expect(result1.alreadyExisted).toBe(false);
    expect(result2.alreadyExisted).toBe(true);
    expect(submit).toHaveBeenCalledTimes(2);
  });
});
