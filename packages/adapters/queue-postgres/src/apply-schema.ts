import type { Pool } from "pg";

/** DDL for QueuePort postgres projection (EDR-004). Safe on empty DB. */
export const APPLY_QUEUE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS queue_messages (
  message_id text PRIMARY KEY,
  run_id text NOT NULL,
  revision integer NOT NULL,
  message_type text NOT NULL,
  dedupe_key text NOT NULL UNIQUE,
  payload jsonb,
  status text NOT NULL,
  owner_id text,
  available_at text NOT NULL,
  created_at text NOT NULL
);
CREATE INDEX IF NOT EXISTS queue_messages_ready_available_idx
  ON queue_messages (status, available_at);
`;

export const TRUNCATE_QUEUE_SQL = `TRUNCATE TABLE queue_messages`;

export async function applyQueueSchema(pool: Pool): Promise<void> {
  await pool.query(APPLY_QUEUE_SCHEMA_SQL);
}

export async function truncateQueue(pool: Pool): Promise<void> {
  await pool.query(TRUNCATE_QUEUE_SQL);
}
