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

app.get('/health', async (req, res) => {
  try {
    await db.query('SELECT 1');
    res.status(200).json({ status: 'ok' });
  } catch (err) {
    res.status(503).json({ status: 'down' });
  }
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
      await saveEvent({
        ledger: event.ledger,
        txHash: event.txHash,
        contractId: event.contractId,
        type: event.topic[0]?.toString() ?? 'unknown',
        topic: event.topic.map(t => t.toString()),
        value: event.value,
      });
    }

    if (response.events.length) {
      console.log(`Indexed ${response.events.length} events`);
    }
  } catch (err) {
    console.error('Poll error:', err.message);
  }

  setTimeout(poll, 6000); // poll every ~1 ledger close
}

poll();
