import type { Pool } from "pg";

/** DDL aligned with `schema.ts`. Safe to run on an empty database (IF NOT EXISTS). */
export const APPLY_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS runs (
  run_id text PRIMARY KEY,
  tenant_id text NOT NULL,
  status text NOT NULL,
  revision integer NOT NULL,
  lease_epoch integer NOT NULL,
  updated_at text NOT NULL,
  body jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS runs_tenant_status_updated_idx
  ON runs (tenant_id, status, updated_at);

CREATE TABLE IF NOT EXISTS events (
  event_id text PRIMARY KEY,
  tenant_id text NOT NULL,
  run_id text NOT NULL,
  sequence integer NOT NULL,
  event_type text NOT NULL,
  body jsonb NOT NULL,
  UNIQUE (tenant_id, run_id, sequence)
);
CREATE INDEX IF NOT EXISTS events_run_sequence_idx
  ON events (run_id, sequence);

CREATE TABLE IF NOT EXISTS run_state (
  run_id text PRIMARY KEY,
  body jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS tool_calls (
  tool_call_id text PRIMARY KEY,
  run_id text NOT NULL,
  status text NOT NULL,
  body jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS tool_calls_run_status_idx
  ON tool_calls (run_id, status);

CREATE TABLE IF NOT EXISTS approvals (
  approval_id text PRIMARY KEY,
  run_id text NOT NULL,
  status text NOT NULL,
  body jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS checkpoints (
  checkpoint_id text PRIMARY KEY,
  run_id text NOT NULL,
  sequence integer NOT NULL,
  state_ref text NOT NULL,
  body jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS checkpoints_run_seq_idx
  ON checkpoints (run_id, sequence);

CREATE TABLE IF NOT EXISTS continuations (
  run_id text PRIMARY KEY,
  body jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS state_snapshots (
  state_ref text PRIMARY KEY,
  body jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS outbox (
  outbox_record_id text PRIMARY KEY,
  status text NOT NULL,
  available_at text NOT NULL,
  claim_owner text,
  claim_expires_at text,
  revision integer NOT NULL,
  body jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS outbox_pending_available_idx
  ON outbox (status, available_at);

CREATE TABLE IF NOT EXISTS idempotency (
  idempotency_record_id text PRIMARY KEY,
  namespace text NOT NULL,
  tenant_id text NOT NULL,
  dedupe_key text NOT NULL,
  request_hash text NOT NULL,
  body jsonb NOT NULL,
  UNIQUE (namespace, tenant_id, dedupe_key)
);
`;

export const TRUNCATE_SQL = `
TRUNCATE TABLE
  events,
  run_state,
  tool_calls,
  approvals,
  checkpoints,
  continuations,
  state_snapshots,
  outbox,
  idempotency,
  runs
`;

export async function applySchema(pool: Pool): Promise<void> {
  await pool.query(APPLY_SCHEMA_SQL);
}

export async function truncateAll(pool: Pool): Promise<void> {
  await pool.query(TRUNCATE_SQL);
}
