import type { QueueEnqueueInput, QueueMessage, QueuePort } from "@monai/ports";
import pg from "pg";

import { applyQueueSchema } from "./apply-schema.js";

const { Pool } = pg;

type QueueRow = {
  message_id: string;
  run_id: string;
  revision: number;
  message_type: string;
  dedupe_key: string;
  payload: unknown;
};

/**
 * PostgreSQL at-least-once queue projection (EDR-004).
 * enqueue is idempotent on dedupe_key; lease uses FOR UPDATE SKIP LOCKED.
 */
export class PostgresQueue implements QueuePort {
  private readonly pool: pg.Pool;
  private seq = 0;

  constructor(pool: pg.Pool) {
    this.pool = pool;
  }

  async applySchema(): Promise<void> {
    await applyQueueSchema(this.pool);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async enqueue(message: QueueEnqueueInput): Promise<void> {
    this.seq += 1;
    const messageId = `qm-${Date.now()}-${this.seq}`;
    const now = new Date().toISOString();
    await this.pool.query(
      `INSERT INTO queue_messages (
         message_id, run_id, revision, message_type, dedupe_key, payload,
         status, owner_id, available_at, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, 'ready', NULL, $7, $7)
       ON CONFLICT (dedupe_key) DO NOTHING`,
      [
        messageId,
        message.runId,
        message.revision,
        message.messageType,
        message.dedupeKey,
        message.payload === undefined ? null : JSON.stringify(message.payload),
        now,
      ],
    );
  }

  async lease(limit: number, ownerId: string): Promise<QueueMessage[]> {
    if (limit <= 0) return [];
    const now = new Date().toISOString();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const selected = await client.query<{ message_id: string }>(
        `SELECT message_id
         FROM queue_messages
         WHERE status = 'ready' AND available_at <= $1
         ORDER BY available_at ASC, message_id ASC
         FOR UPDATE SKIP LOCKED
         LIMIT $2`,
        [now, limit],
      );
      if (selected.rows.length === 0) {
        await client.query("COMMIT");
        return [];
      }
      const ids = selected.rows.map((r) => r.message_id);
      const updated = await client.query<QueueRow>(
        `UPDATE queue_messages
         SET status = 'leased', owner_id = $1
         WHERE message_id = ANY($2::text[])
         RETURNING message_id, run_id, revision, message_type, dedupe_key, payload`,
        [ownerId, ids],
      );
      await client.query("COMMIT");
      return updated.rows.map(rowToMessage);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async ack(messageId: string): Promise<void> {
    await this.pool.query(
      `UPDATE queue_messages SET status = 'acked', owner_id = NULL WHERE message_id = $1`,
      [messageId],
    );
  }

  async nack(messageId: string): Promise<void> {
    const now = new Date().toISOString();
    await this.pool.query(
      `UPDATE queue_messages
       SET status = 'ready', owner_id = NULL, available_at = $2
       WHERE message_id = $1`,
      [messageId, now],
    );
  }
}

function rowToMessage(row: QueueRow): QueueMessage {
  return {
    messageId: row.message_id,
    runId: row.run_id,
    revision: row.revision,
    messageType: row.message_type,
    dedupeKey: row.dedupe_key,
    payload: row.payload === null ? undefined : row.payload,
  };
}

export function createPostgresQueuePool(connectionString: string): pg.Pool {
  return new Pool({ connectionString });
}

export async function createPostgresQueue(connectionString: string): Promise<PostgresQueue> {
  const queue = new PostgresQueue(createPostgresQueuePool(connectionString));
  await queue.applySchema();
  return queue;
}
