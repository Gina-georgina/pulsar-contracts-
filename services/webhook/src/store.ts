import { Pool, PoolClient } from 'pg';

export interface WebhookRegistration {
  merchantAddress: string;
  url: string;
  status: WebhookStatus;
  challengeToken: string;
  createdAt: number;
  registeredAt: number;
  confirmedAt?: number;
}

// In-memory cache backed by PostgreSQL for durability.
const store = new Map<string, WebhookRegistration>();

let pool: Pool | null = null;

function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString:
        process.env.DATABASE_URL ||
        process.env.WEBHOOK_DATABASE_URL ||
        'postgres://postgres:postgres@localhost:5432/webhooks',
    });
  }
  return pool;
}

const CREATE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS webhooks (
  merchant_address TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  registered_at BIGINT NOT NULL
);
`;

/**
 * Ensures the webhooks table exists and loads all registrations into the
 * in-memory cache. Call once on service startup.
 */
export async function initStore(): Promise<void> {
  const client: PoolClient = await getPool().connect();
  try {
    await client.query(CREATE_TABLE_SQL);
    const result = await client.query<{
      merchant_address: string;
      url: string;
      registered_at: string;
    }>('SELECT merchant_address, url, registered_at FROM webhooks');
    store.clear();
    for (const row of result.rows) {
      store.set(row.merchant_address, {
        merchantAddress: row.merchant_address,
        url: row.url,
        registeredAt: Number(row.registered_at),
      });
    }
  } finally {
    client.release();
  }
}

/**
 * Closes the underlying connection pool. Intended for tests and graceful
 * shutdown.
 */
export async function closeStore(): Promise<void> {
  store.clear();
  if (pool) {
    const current = pool;
    pool = null;
    await current.end();
  }
}

export async function registerWebhook(
  merchantAddress: string,
  url: string,
): Promise<WebhookRegistration> {
  const reg: WebhookRegistration = { merchantAddress, url, registeredAt: Date.now() };
  await getPool().query(
    `INSERT INTO webhooks (merchant_address, url, registered_at)
     VALUES ($1, $2, $3)
     ON CONFLICT (merchant_address)
     DO UPDATE SET url = EXCLUDED.url, registered_at = EXCLUDED.registered_at`,
    [reg.merchantAddress, reg.url, reg.registeredAt],
  );
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

export async function deleteWebhook(merchantAddress: string): Promise<boolean> {
  const result = await getPool().query(
    'DELETE FROM webhooks WHERE merchant_address = $1',
    [merchantAddress],
  );
  store.delete(merchantAddress);
  return (result.rowCount ?? 0) > 0;
}

/**
 * Returns only confirmed registrations so the listener never delivers
 * events to unverified URLs.
 */
export function allWebhooks(): WebhookRegistration[] {
  return Array.from(store.values());
}