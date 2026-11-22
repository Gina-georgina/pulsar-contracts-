require('dotenv').config();
const { SorobanRpc, Networks } = require('@stellar/stellar-sdk');
const { Pool } = require('pg');
const express = require('express');
const crypto = require('crypto');

const REQUEST_ID_HEADER = 'X-Request-ID';

function getRequestId(req) {
  const incoming = req.headers[REQUEST_ID_HEADER.toLowerCase()];
  return (typeof incoming === 'string' && incoming.trim()) || crypto.randomUUID();
}

function logWithRequestId(requestId, ...args) {
  console.log(`[requestId=${requestId}]`, ...args);
}

function logErrorWithRequestId(requestId, ...args) {
  console.error(`[requestId=${requestId}]`, ...args);
}

const {
  HORIZON_URL,
  CONTRACT_ID,
  DATABASE_URL,
  PORT = 3001,
} = process.env;

const db = new Pool({ connectionString: DATABASE_URL });
const app = express();

// Correlation ID middleware: read or generate X-Request-ID, echo it back,
// and expose it to handlers for structured logging.
app.use((req, res, next) => {
  const requestId = getRequestId(req);
  req.requestId = requestId;
  res.setHeader(REQUEST_ID_HEADER, requestId);
  next();
});

app.use(express.json());

// ── REST API ──────────────────────────────────────────────────────────────────

app.get('/events', async (req, res) => {
  const { type, limit = 50, offset = 0 } = req.query;
  const params = [Number(limit), Number(offset)];
  let where = '';
  if (type) { where = 'WHERE event_type = $3'; params.push(type); }
  logWithRequestId(req.requestId, `GET /events type=${type ?? 'all'} limit=${limit} offset=${offset}`);
  const { rows } = await db.query(
    `SELECT * FROM events ${where} ORDER BY ledger DESC LIMIT $1 OFFSET $2`,
    params
  );
  res.json(rows);
});

app.get('/events/:type', async (req, res) => {
  logWithRequestId(req.requestId, `GET /events/${req.params.type}`);
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

async function poll() {
  const server = new SorobanRpc.Server(HORIZON_URL);
  const startLedger = (await getLastIndexedLedger()) + 1;

  const pollRequestId = crypto.randomUUID();
  logWithRequestId(pollRequestId, `Polling events from ledger ${startLedger} for contract ${CONTRACT_ID}`);

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
      logWithRequestId(pollRequestId, `Indexed ${response.events.length} events`);
    }
  } catch (err) {
    logErrorWithRequestId(pollRequestId, 'Poll error:', err.message);
  }

  setTimeout(poll, 6000); // poll every ~1 ledger close
}

poll();
