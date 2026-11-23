require('dotenv').config();
const { SorobanRpc, Networks } = require('@stellar/stellar-sdk');
const { Pool } = require('pg');
const express = require('express');

const {
  HORIZON_URL,
  CONTRACT_ID,
  DATABASE_URL,
  PORT = 3001,
} = process.env;

const db = new Pool({ connectionString: DATABASE_URL });
const app = express();
app.use(express.json());

// ── REST API ──────────────────────────────────────────────────────────────────

app.get('/events', async (req, res) => {
  const { type, limit = 50, offset = 0 } = req.query;
  const params = [Number(limit), Number(offset)];
  let where = '';
  if (type) { where = 'WHERE event_type = $3'; params.push(type); }
  const { rows } = await db.query(
    `SELECT * FROM events ${where} ORDER BY ledger DESC LIMIT $1 OFFSET $2`,
    params
  );
  res.json(rows);
});

app.get('/events/:type', async (req, res) => {
  const { rows } = await db.query(
    'SELECT * FROM events WHERE event_type = $1 ORDER BY ledger DESC LIMIT 50',
    [req.params.type]
  );
  res.json(rows);
});

app.listen(PORT, () => console.log(`API listening on port ${PORT}`));

// ── Indexer ───────────────────────────────────────────────────────────────────

async function getLastIndexedLedger() {
  const { rows } = await db.query('SELECT MAX(ledger) AS last FROM events');
  return rows[0].last || 0;
}

async function saveEvent(event) {
  await db.query(
    `INSERT INTO events (ledger, tx_hash, contract_id, event_type, topics, value)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT DO NOTHING`,
    [
      event.ledger,
      event.txHash,
      event.contractId,
      event.type,
      JSON.stringify(event.topic),
      JSON.stringify(event.value),
    ]
  );
}

// Minimal DDL for the payments table used by the soft-delete path below.
async function ensurePaymentsTable() {
  await db.query(
    `CREATE TABLE IF NOT EXISTS payments (
       order_id TEXT PRIMARY KEY,
       archived BOOLEAN NOT NULL DEFAULT false,
       archived_at TIMESTAMPTZ
     )`
  );
}

// Extract the order_id from a payment_archived event value. The value may be a
// plain string, a base64-encoded ScVal, or an object/array containing order_id.
function extractOrderId(value) {
  if (value == null) return null;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object') return extractOrderId(parsed);
    } catch (_) {
      // not JSON; fall through to treat as raw order id
    }
    return value;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const id = extractOrderId(item);
      if (id != null) return id;
    }
    return null;
  }
  if (typeof value === 'object') {
    if (value.order_id != null) return String(value.order_id);
    if (value.orderId != null) return String(value.orderId);
    for (const key of Object.keys(value)) {
      const id = extractOrderId(value[key]);
      if (id != null) return id;
    }
  }
  return null;
}

async function handlePaymentArchived(event) {
  const orderId = extractOrderId(event.value);
  if (orderId == null) {
    console.warn('payment_archived event missing order_id', event.txHash);
    return;
  }
  const archivedAt = new Date();
  await db.query(
    `UPDATE payments SET archived = true, archived_at = $2 WHERE order_id = $1`,
    [orderId, archivedAt]
  );
}

async function poll() {
  const server = new SorobanRpc.Server(HORIZON_URL);
  const startLedger = (await getLastIndexedLedger()) + 1;

  console.log(`Polling events from ledger ${startLedger} for contract ${CONTRACT_ID}`);

  try {
    const response = await server.getEvents({
      startLedger,
      filters: [{ type: 'contract', contractIds: [CONTRACT_ID] }],
      limit: 200,
    });

    for (const event of response.events) {
      const topics = event.topic.map(t => t.toString());
      const type = event.topic[0]?.toString() ?? 'unknown';
      const saved = {
        ledger: event.ledger,
        txHash: event.txHash,
        contractId: event.contractId,
        type,
        topic: topics,
        value: event.value,
      };
      await saveEvent(saved);

      if (type === 'payment_archived' || topics.includes('payment_archived')) {
        await handlePaymentArchived(saved);
      }
    }

    if (response.events.length) {
      console.log(`Indexed ${response.events.length} events`);
    }
  } catch (err) {
    console.error('Poll error:', err.message);
  }

  setTimeout(poll, 6000); // poll every ~1 ledger close
}

ensurePaymentsTable()
  .catch(err => console.error('Failed to ensure payments table:', err.message))
  .finally(() => poll());
