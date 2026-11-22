export type WebhookStatus = 'pending' | 'confirmed';

export interface WebhookRegistration {
  merchantAddress: string;
  url: string;
  status: WebhookStatus;
  challengeToken: string;
  createdAt: number;
  registeredAt: number;
  confirmedAt?: number;
}

// In-memory store — replace with a database in production.
const store = new Map<string, WebhookRegistration>();

export function registerWebhook(merchantAddress: string, url: string): WebhookRegistration {
  const now = Date.now();
  const reg: WebhookRegistration = {
    merchantAddress,
    url,
    status: 'confirmed',
    challengeToken: '',
    createdAt: now,
    registeredAt: now,
    confirmedAt: now,
  };
  store.set(merchantAddress, reg);
  return reg;
}

/**
 * Create a pending registration awaiting handshake confirmation.
 * The challenge token must be echoed back by the target URL before the
 * registration is promoted to 'confirmed'.
 */
export function createPendingWebhook(
  merchantAddress: string,
  url: string,
  challengeToken: string,
): WebhookRegistration {
  const now = Date.now();
  const reg: WebhookRegistration = {
    merchantAddress,
    url,
    status: 'pending',
    challengeToken,
    createdAt: now,
    registeredAt: now,
  };
  store.set(merchantAddress, reg);
  return reg;
}

/**
 * Confirm a pending registration if the provided challenge token matches.
 * Returns the confirmed registration, or undefined if no pending registration
 * exists or the token does not match.
 */
export function confirmWebhook(
  merchantAddress: string,
  challengeToken: string,
): WebhookRegistration | undefined {
  const reg = store.get(merchantAddress);
  if (!reg || reg.status !== 'pending') {
    return undefined;
  }
  if (!reg.challengeToken || reg.challengeToken !== challengeToken) {
    return undefined;
  }
  const confirmed: WebhookRegistration = {
    ...reg,
    status: 'confirmed',
    confirmedAt: Date.now(),
  };
  store.set(merchantAddress, confirmed);
  return confirmed;
}

export function getWebhook(merchantAddress: string): WebhookRegistration | undefined {
  return store.get(merchantAddress);
}

export function deleteWebhook(merchantAddress: string): boolean {
  return store.delete(merchantAddress);
}

/**
 * Returns only confirmed registrations so the listener never delivers
 * events to unverified URLs.
 */
export function allWebhooks(): WebhookRegistration[] {
  return Array.from(store.values()).filter((reg) => reg.status === 'confirmed');
}