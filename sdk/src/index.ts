import nacl from 'tweetnacl';

export interface PaymentOrder {
  order_id: string;
  merchant_address: string;
  payer: string;
  token: string;
  amount: bigint;
  description: string;
  expires_at: bigint;
}

export interface CreateOrderParams {
  orderId: string;
  merchantAddress: string;
  payer: string;
  token: string;
  amount: bigint;
  description: string;
  /** Unix timestamp (seconds). 0 = no expiry. */
  expiresAt?: bigint;
}

/**
 * Construct a PaymentOrder struct ready for on-chain submission.
 */
export function createOrder(params: CreateOrderParams): PaymentOrder {
  return {
    order_id: params.orderId,
    merchant_address: params.merchantAddress,
    payer: params.payer,
    token: params.token,
    amount: params.amount,
    description: params.description,
    expires_at: params.expiresAt ?? 0n,
  };
}

/**
 * Serialize a PaymentOrder to the canonical byte representation used for signing.
 * Fields are concatenated as UTF-8 strings separated by ':'.
 */
export function serializeOrder(order: PaymentOrder): Uint8Array {
  const raw = [
    order.order_id,
    order.merchant_address,
    order.payer,
    order.token,
    order.amount.toString(),
    order.description,
    order.expires_at.toString(),
  ].join(':');
  return new TextEncoder().encode(raw);
}

/**
 * Sign a PaymentOrder with an ed25519 private key.
 *
 * @param order       The PaymentOrder to sign.
 * @param privateKey  32-byte ed25519 seed (or 64-byte keypair secret).
 * @returns           64-byte signature as a hex string.
 */
export function signOrder(order: PaymentOrder, privateKey: Uint8Array): string {
  const seed = privateKey.length === 64 ? privateKey.slice(0, 32) : privateKey;
  const keyPair = nacl.sign.keyPair.fromSeed(seed);
  const message = serializeOrder(order);
  const signature = nacl.sign.detached(message, keyPair.secretKey);
  return Buffer.from(signature).toString('hex');
}

/**
 * Derive the ed25519 public key from a private key seed.
 * Returns the 32-byte public key as a hex string.
 */
export function getPublicKey(privateKey: Uint8Array): string {
  const seed = privateKey.length === 64 ? privateKey.slice(0, 32) : privateKey;
  const { publicKey } = nacl.sign.keyPair.fromSeed(seed);
  return Buffer.from(publicKey).toString('hex');
}

// ── Idempotency helpers ───────────────────────────────────────────────────────

export {
  processPaymentIdempotent,
  isPulsarError,
} from './idempotency';
export type {
  IdempotentPaymentResult,
  PaymentSubmitFn,
} from './idempotency';
