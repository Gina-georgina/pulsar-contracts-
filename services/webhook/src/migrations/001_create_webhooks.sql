-- Migration 001: create webhooks table
-- Idempotent: safe to run multiple times.
-- Invoked from service startup (see src/db.ts) and via `npm run migrate`.

CREATE TABLE IF NOT EXISTS webhooks (
    merchant_address TEXT PRIMARY KEY,
    url              TEXT NOT NULL,
    registered_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);