import type { Pool } from "pg";

/** DDL for LeasePort postgres store (EDR-006 fencing metadata). */
export const APPLY_LEASE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS run_leases (
  run_id text PRIMARY KEY,
  owner_id text NOT NULL,
  lease_epoch integer NOT NULL,
  acquired_at text NOT NULL,
  expires_at text NOT NULL,
  last_heartbeat_at text NOT NULL
);
`;

export const TRUNCATE_LEASE_SQL = `TRUNCATE TABLE run_leases`;

export async function applyLeaseSchema(pool: Pool): Promise<void> {
  await pool.query(APPLY_LEASE_SCHEMA_SQL);
}

export async function truncateLeases(pool: Pool): Promise<void> {
  await pool.query(TRUNCATE_LEASE_SQL);
}
