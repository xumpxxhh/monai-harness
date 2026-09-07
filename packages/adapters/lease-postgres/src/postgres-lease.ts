import type { LeasePort, LeaseRecord } from "@monai/ports";
import pg from "pg";

import { applyLeaseSchema } from "./apply-schema.js";

const { Pool } = pg;

type LeaseRow = {
  run_id: string;
  owner_id: string;
  lease_epoch: number;
  acquired_at: string;
  expires_at: string;
  last_heartbeat_at: string;
};

/**
 * PostgreSQL lease metadata store.
 * leaseEpoch is supplied by Engine after CommitPlan success (same as memory adapter).
 */
export class PostgresLease implements LeasePort {
  private readonly pool: pg.Pool;

  constructor(pool: pg.Pool) {
    this.pool = pool;
  }

  async applySchema(): Promise<void> {
    await applyLeaseSchema(this.pool);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async bind(runId: string, ownerId: string, leaseEpoch: number, ttlMs: number): Promise<void> {
    const now = Date.now();
    const acquiredAt = new Date(now).toISOString();
    const expiresAt = new Date(now + ttlMs).toISOString();
    await this.pool.query(
      `INSERT INTO run_leases (
         run_id, owner_id, lease_epoch, acquired_at, expires_at, last_heartbeat_at
       ) VALUES ($1, $2, $3, $4, $5, $4)
       ON CONFLICT (run_id) DO UPDATE SET
         owner_id = EXCLUDED.owner_id,
         lease_epoch = EXCLUDED.lease_epoch,
         acquired_at = EXCLUDED.acquired_at,
         expires_at = EXCLUDED.expires_at,
         last_heartbeat_at = EXCLUDED.last_heartbeat_at`,
      [runId, ownerId, leaseEpoch, acquiredAt, expiresAt],
    );
  }

  async heartbeat(runId: string, ownerId: string, leaseEpoch: number): Promise<void> {
    const lease = await this.get(runId);
    if (!lease || lease.ownerId !== ownerId || lease.leaseEpoch !== leaseEpoch) {
      throw new Error("lease heartbeat rejected");
    }
    const now = Date.now();
    const ttlMs = Date.parse(lease.expiresAt) - Date.parse(lease.acquiredAt);
    const expiresAt = new Date(now + Math.max(ttlMs, 1)).toISOString();
    const lastHeartbeatAt = new Date(now).toISOString();
    const result = await this.pool.query(
      `UPDATE run_leases
       SET last_heartbeat_at = $4, expires_at = $5
       WHERE run_id = $1 AND owner_id = $2 AND lease_epoch = $3`,
      [runId, ownerId, leaseEpoch, lastHeartbeatAt, expiresAt],
    );
    if (result.rowCount !== 1) {
      throw new Error("lease heartbeat rejected");
    }
  }

  async validate(runId: string, ownerId: string, leaseEpoch: number): Promise<boolean> {
    const lease = await this.get(runId);
    if (!lease) return false;
    if (lease.ownerId !== ownerId || lease.leaseEpoch !== leaseEpoch) return false;
    return Date.parse(lease.expiresAt) > Date.now();
  }

  async release(runId: string, ownerId: string, leaseEpoch: number): Promise<void> {
    await this.pool.query(
      `DELETE FROM run_leases
       WHERE run_id = $1 AND owner_id = $2 AND lease_epoch = $3`,
      [runId, ownerId, leaseEpoch],
    );
  }

  async get(runId: string): Promise<LeaseRecord | undefined> {
    const result = await this.pool.query<LeaseRow>(
      `SELECT run_id, owner_id, lease_epoch, acquired_at, expires_at, last_heartbeat_at
       FROM run_leases WHERE run_id = $1`,
      [runId],
    );
    const row = result.rows[0];
    if (!row) return undefined;
    return {
      runId: row.run_id,
      ownerId: row.owner_id,
      leaseEpoch: row.lease_epoch,
      acquiredAt: row.acquired_at,
      expiresAt: row.expires_at,
      lastHeartbeatAt: row.last_heartbeat_at,
    };
  }
}

export function createPostgresLeasePool(connectionString: string): pg.Pool {
  return new Pool({ connectionString });
}

export async function createPostgresLease(connectionString: string): Promise<PostgresLease> {
  const lease = new PostgresLease(createPostgresLeasePool(connectionString));
  await lease.applySchema();
  return lease;
}
