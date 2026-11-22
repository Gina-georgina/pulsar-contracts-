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

// ── Graceful shutdown state ───────────────────────────────────────────────────

const SHUTDOWN_TIMEOUT_MS = 10_000;
let shuttingDown = false;
let inFlight = 0;
let pollTimer = null;
let server = null;

function trackOperation() {
  inFlight += 1;
  let done = false;
  return () => {
    if (done) return;
    done = true;
    inFlight -= 1;
  };
}

async function gracefulShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Received ${signal}, starting graceful shutdown (timeout ${SHUTDOWN_TIMEOUT_MS}ms)`);

  // Stop scheduling new polls.
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }

  // Wait for in-flight operations to drain, up to the timeout.
  const deadline = Date.now() + SHUTDOWN_TIMEOUT_MS;
  while (inFlight > 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (inFlight > 0) {
    console.warn(`Shutdown timeout reached with ${inFlight} operation(s) still in flight`);
  }

  // Stop accepting new HTTP connections.
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }

  try {
    await db.end();
  } catch (err) {
    console.error('Error closing database pool:', err.message);
  }

  console.log('Graceful shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// ── REST API ──────────────────────────────────────────────────────────────────

app.get('/health', (req, res) => {
  if (shuttingDown) {
    return res.status(503).json({ status: 'shutting_down' });
  }
  res.json({ status: 'ok' });
});

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

server = app.listen(PORT, () => console.log(`API listening on port ${PORT}`));

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
  if (shuttingDown) return;

  const rpc = new SorobanRpc.Server(HORIZON_URL);
  const startLedger = (await getLastIndexedLedger()) + 1;

  console.log(`Polling events from ledger ${startLedger} for contract ${CONTRACT_ID}`);

  try {
    const response = await rpc.getEvents({
      startLedger,
      filters: [{ type: 'contract', contractIds: [CONTRACT_ID] }],
      limit: 200,
    });

    for (const event of response.events) {
      if (shuttingDown) break;
      const done = trackOperation();
      try {
        await saveEvent({
          ledger: event.ledger,
          txHash: event.txHash,
          contractId: event.contractId,
          type: event.topic[0]?.toString() ?? 'unknown',
          topic: event.topic.map(t => t.toString()),
          value: event.value,
        });
      } finally {
        done();
      }
    }

    if (response.events.length) {
      console.log(`Indexed ${response.events.length} events`);
    }
  } catch (err) {
    console.error('Poll error:', err.message);
  }

  if (shuttingDown) return;
  pollTimer = setTimeout(poll, 6000); // poll every ~1 ledger close
}

poll();
