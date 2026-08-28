import {
  approvalRecordSchema,
  checkpointSchema,
  continuationSchema,
  eventEnvelopeSchema,
  idempotencyRecordSchema,
  outboxRecordSchema,
  runSchema,
  runStateSchema,
  toolCallRecordSchema,
  type ApprovalRecord,
  type Checkpoint,
  type Continuation,
  type EventEnvelope,
  type IdempotencyRecord,
  type OutboxRecord,
  type Run,
  type RunState,
  type RunStatus,
  type ToolCallRecord,
} from "@monai/contracts";
import type {
  CommitPlan,
  CommitResult,
  IdempotencyPort,
  ListRunsFilter,
  OutboxPort,
  PersistencePort,
  UnitOfWork,
} from "@monai/ports";
import { and, asc, desc, eq, gte, sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";

import { applySchema } from "./apply-schema.js";
import {
  approvals,
  checkpoints,
  continuations,
  events,
  idempotency,
  outbox,
  runState,
  runs,
  schema,
  stateSnapshots,
  toolCalls,
} from "./schema.js";

const { Pool } = pg;

export type PostgresPersistenceDb = NodePgDatabase<typeof schema>;

function isUniqueViolation(err: unknown): boolean {
  let current: unknown = err;
  while (current && typeof current === "object") {
    if ("code" in current && (current as { code: unknown }).code === "23505") {
      return true;
    }
    current = "cause" in current ? (current as { cause: unknown }).cause : undefined;
  }
  return false;
}

/**
 * PostgreSQL Persistence + Outbox + Idempotency (EDR-003/005/006/009).
 * Run mutex: `SELECT … FOR UPDATE` on `runs` (no advisory lock).
 */
export class PostgresPersistence implements PersistencePort, OutboxPort, IdempotencyPort {
  private readonly pool: pg.Pool;
  private readonly db: PostgresPersistenceDb;

  constructor(pool: pg.Pool) {
    this.pool = pool;
    this.db = drizzle(pool, { schema });
  }

  async applySchema(): Promise<void> {
    await applySchema(this.pool);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async beginUnitOfWork(runId: string): Promise<UnitOfWork> {
    const client = await this.pool.connect();
    const db = drizzle(client, { schema });
    let released = false;

    const finish = async (action: "commit" | "rollback"): Promise<void> => {
      if (released) return;
      released = true;
      try {
        await client.query(action === "commit" ? "COMMIT" : "ROLLBACK");
      } finally {
        client.release();
      }
    };

    try {
      await client.query("BEGIN");
      await db.select().from(runs).where(eq(runs.runId, runId)).for("update");
    } catch (err) {
      await finish("rollback");
      throw err;
    }

    return {
      runId,
      commit: async (plan) => {
        try {
          const result = await this.commitLocked(db, runId, plan);
          if (result.ok) {
            await finish("commit");
          } else {
            await finish("rollback");
          }
          return result;
        } catch (err) {
          await finish("rollback");
          if (isUniqueViolation(err)) {
            return { ok: false, code: "conflict", message: "unique constraint violation" };
          }
          throw err;
        }
      },
      rollback: async () => {
        await finish("rollback");
      },
    };
  }

  async getRun(runId: string): Promise<Run | undefined> {
    const [row] = await this.db.select().from(runs).where(eq(runs.runId, runId)).limit(1);
    return row ? runSchema.parse(row.body) : undefined;
  }

  async listRuns(filter: ListRunsFilter): Promise<Run[]> {
    const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
    const conditions = [eq(runs.tenantId, filter.tenantId)];
    if (filter.sessionId) {
      conditions.push(sql`${runs.body}->>'sessionId' = ${filter.sessionId}`);
    }
    if (filter.status) {
      conditions.push(eq(runs.status, filter.status));
    }
    const rows = await this.db
      .select()
      .from(runs)
      .where(and(...conditions))
      .orderBy(desc(runs.updatedAt))
      .limit(limit);
    return rows.map((r) => runSchema.parse(r.body));
  }

  async getState(runId: string): Promise<RunState | undefined> {
    const [row] = await this.db.select().from(runState).where(eq(runState.runId, runId)).limit(1);
    return row ? runStateSchema.parse(row.body) : undefined;
  }

  async getToolCall(toolCallId: string): Promise<ToolCallRecord | undefined> {
    const [row] = await this.db
      .select()
      .from(toolCalls)
      .where(eq(toolCalls.toolCallId, toolCallId))
      .limit(1);
    return row ? toolCallRecordSchema.parse(row.body) : undefined;
  }

  async listToolCalls(runId: string): Promise<ToolCallRecord[]> {
    const rows = await this.db.select().from(toolCalls).where(eq(toolCalls.runId, runId));
    return rows.map((r) => toolCallRecordSchema.parse(r.body));
  }

  async getApproval(approvalId: string): Promise<ApprovalRecord | undefined> {
    const [row] = await this.db
      .select()
      .from(approvals)
      .where(eq(approvals.approvalId, approvalId))
      .limit(1);
    return row ? approvalRecordSchema.parse(row.body) : undefined;
  }

  async listApprovals(runId: string): Promise<ApprovalRecord[]> {
    const rows = await this.db.select().from(approvals).where(eq(approvals.runId, runId));
    return rows.map((r) => approvalRecordSchema.parse(r.body));
  }

  async getLatestCheckpoint(runId: string): Promise<Checkpoint | undefined> {
    const rows = await this.db
      .select()
      .from(checkpoints)
      .where(eq(checkpoints.runId, runId))
      .orderBy(asc(checkpoints.sequence));
    if (rows.length === 0) return undefined;
    return checkpointSchema.parse(rows[rows.length - 1]!.body);
  }

  async getContinuation(runId: string): Promise<Continuation | undefined> {
    const [row] = await this.db
      .select()
      .from(continuations)
      .where(eq(continuations.runId, runId))
      .limit(1);
    return row ? continuationSchema.parse(row.body) : undefined;
  }

  async getStateSnapshot(stateRef: string): Promise<RunState | undefined> {
    const [row] = await this.db
      .select()
      .from(stateSnapshots)
      .where(eq(stateSnapshots.stateRef, stateRef))
      .limit(1);
    return row ? runStateSchema.parse(row.body) : undefined;
  }

  async listEvents(runId: string, fromSequence = 1): Promise<EventEnvelope[]> {
    const rows = await this.db
      .select()
      .from(events)
      .where(and(eq(events.runId, runId), gte(events.sequence, fromSequence)))
      .orderBy(asc(events.sequence));
    return rows.map((r) => eventEnvelopeSchema.parse(r.body));
  }

  async listRunsByStatus(status: RunStatus): Promise<Run[]> {
    const rows = await this.db.select().from(runs).where(eq(runs.status, status));
    return rows.map((r) => runSchema.parse(r.body));
  }

  async claim(limit: number, ownerId: string, claimTtlMs: number): Promise<OutboxRecord[]> {
    const now = new Date();
    const nowIso = now.toISOString();
    const expiresIso = new Date(now.getTime() + claimTtlMs).toISOString();

    return this.db.transaction(async (tx) => {
      const locked = await tx
        .select()
        .from(outbox)
        .where(eq(outbox.status, "pending"))
        .orderBy(asc(outbox.availableAt))
        .limit(limit)
        .for("update", { skipLocked: true });

      const claimed: OutboxRecord[] = [];
      for (const row of locked) {
        const prev = outboxRecordSchema.parse(row.body);
        const next: OutboxRecord = {
          ...prev,
          status: "claimed",
          claimOwner: ownerId,
          claimExpiresAt: expiresIso,
          updatedAt: nowIso,
          revision: prev.revision + 1,
        };
        await tx
          .update(outbox)
          .set({
            status: "claimed",
            claimOwner: ownerId,
            claimExpiresAt: expiresIso,
            revision: next.revision,
            body: next,
          })
          .where(eq(outbox.outboxRecordId, row.outboxRecordId));
        claimed.push(next);
      }
      return claimed;
    });
  }

  async markPublished(outboxRecordId: string): Promise<void> {
    const [row] = await this.db
      .select()
      .from(outbox)
      .where(eq(outbox.outboxRecordId, outboxRecordId))
      .limit(1);
    if (!row) return;
    const prev = outboxRecordSchema.parse(row.body);
    const nowIso = new Date().toISOString();
    const next: OutboxRecord = {
      ...prev,
      status: "published",
      publishedAt: nowIso,
      updatedAt: nowIso,
      revision: prev.revision + 1,
      publishAttempts: prev.publishAttempts + 1,
    };
    await this.db
      .update(outbox)
      .set({ status: "published", revision: next.revision, body: next })
      .where(eq(outbox.outboxRecordId, outboxRecordId));
  }

  async markFailed(outboxRecordId: string, error: string): Promise<void> {
    const [row] = await this.db
      .select()
      .from(outbox)
      .where(eq(outbox.outboxRecordId, outboxRecordId))
      .limit(1);
    if (!row) return;
    const prev = outboxRecordSchema.parse(row.body);
    const nowIso = new Date().toISOString();
    const next: OutboxRecord = {
      ...prev,
      status: "failed",
      lastError: error,
      updatedAt: nowIso,
      revision: prev.revision + 1,
      publishAttempts: prev.publishAttempts + 1,
    };
    await this.db
      .update(outbox)
      .set({ status: "failed", revision: next.revision, body: next })
      .where(eq(outbox.outboxRecordId, outboxRecordId));
  }

  async requeueOutbox(outboxRecordId: string): Promise<void> {
    const [row] = await this.db
      .select()
      .from(outbox)
      .where(eq(outbox.outboxRecordId, outboxRecordId))
      .limit(1);
    if (!row) return;
    const prev = outboxRecordSchema.parse(row.body);
    if (prev.status === "published") return;
    const nowIso = new Date().toISOString();
    const next: OutboxRecord = {
      ...prev,
      status: "pending",
      claimOwner: undefined,
      claimExpiresAt: undefined,
      updatedAt: nowIso,
      revision: prev.revision + 1,
    };
    await this.db
      .update(outbox)
      .set({
        status: "pending",
        claimOwner: null,
        claimExpiresAt: null,
        revision: next.revision,
        body: next,
      })
      .where(eq(outbox.outboxRecordId, outboxRecordId));
  }

  async get(
    namespace: string,
    tenantId: string,
    dedupeKey: string,
  ): Promise<IdempotencyRecord | undefined> {
    const [row] = await this.db
      .select()
      .from(idempotency)
      .where(
        and(
          eq(idempotency.namespace, namespace),
          eq(idempotency.tenantId, tenantId),
          eq(idempotency.dedupeKey, dedupeKey),
        ),
      )
      .limit(1);
    return row ? idempotencyRecordSchema.parse(row.body) : undefined;
  }

  async listOutbox(): Promise<OutboxRecord[]> {
    const rows = await this.db.select().from(outbox);
    return rows.map((r) => outboxRecordSchema.parse(r.body));
  }

  private async commitLocked(
    db: PostgresPersistenceDb,
    runId: string,
    plan: CommitPlan,
  ): Promise<CommitResult> {
    const [existingRow] = await db.select().from(runs).where(eq(runs.runId, runId)).limit(1);
    const existing = existingRow ? runSchema.parse(existingRow.body) : undefined;
    const isCreate = plan.runCreate !== undefined;

    if (isCreate) {
      if (existing) {
        return { ok: false, code: "conflict", message: "run already exists" };
      }
      const created = plan.runCreate;
      if (!created) {
        return { ok: false, code: "validation", message: "runCreate required" };
      }
      if (created.runId !== runId) {
        return { ok: false, code: "validation", message: "runCreate.runId mismatch" };
      }
      if (plan.expectedRevision !== 0 || plan.expectedLeaseEpoch !== 0) {
        return {
          ok: false,
          code: "conflict",
          message: "create expects revision=0 and leaseEpoch=0",
        };
      }
    } else if (!existing) {
      return { ok: false, code: "fatal", message: "run not found" };
    } else if (plan.expectedRevision !== existing.revision) {
      return { ok: false, code: "conflict", message: "expectedRevision mismatch" };
    } else if (plan.expectedLeaseEpoch !== existing.leaseEpoch) {
      return { ok: false, code: "lease_lost", message: "expectedLeaseEpoch mismatch" };
    }

    for (const rec of plan.idempotency ?? []) {
      const prev = await this.lookupIdempotency(
        db,
        rec.namespace,
        rec.tenantId,
        rec.dedupeKey,
      );
      if (prev && prev.requestHash !== rec.requestHash) {
        return { ok: false, code: "conflict", message: "idempotency requestHash mismatch" };
      }
    }

    const now = new Date().toISOString();
    let run: Run = isCreate ? structuredClone(plan.runCreate!) : structuredClone(existing!);

    if (plan.runPatch) {
      run = { ...run, ...plan.runPatch, runId: run.runId };
    }

    const maxSeqRows = await db
      .select({ max: sql<number>`coalesce(max(${events.sequence}), 0)` })
      .from(events)
      .where(eq(events.runId, runId));
    let nextSequence = Number(maxSeqRows[0]?.max ?? 0) + 1;
    const sequences: number[] = [];
    const appended: EventEnvelope[] = [];

    for (const candidate of plan.events) {
      if (candidate.runId !== runId) {
        return { ok: false, code: "validation", message: "event runId mismatch" };
      }
      if (candidate.expectedRevision !== plan.expectedRevision) {
        return {
          ok: false,
          code: "conflict",
          message: "event.expectedRevision must match plan.expectedRevision",
        };
      }
      const envelope: EventEnvelope = {
        ...candidate,
        sequence: nextSequence,
        recordedAt: now,
      };
      sequences.push(nextSequence);
      nextSequence += 1;
      appended.push(envelope);
    }

    run = {
      ...run,
      revision: run.revision + 1,
      updatedAt: now,
    };

    if (isCreate) {
      await db.insert(runs).values(runRow(run));
    } else {
      await db.update(runs).set(runRow(run)).where(eq(runs.runId, runId));
    }

    if (appended.length > 0) {
      await db.insert(events).values(
        appended.map((envelope) => ({
          eventId: envelope.eventId,
          tenantId: envelope.tenantId,
          runId: envelope.runId,
          sequence: envelope.sequence,
          eventType: envelope.eventType,
          body: envelope,
        })),
      );
    }

    if (plan.state !== undefined) {
      await db
        .insert(runState)
        .values({ runId, body: structuredClone(plan.state) })
        .onConflictDoUpdate({
          target: runState.runId,
          set: { body: structuredClone(plan.state) },
        });
    }

    for (const tc of plan.toolCalls ?? []) {
      await db
        .insert(toolCalls)
        .values({
          toolCallId: tc.toolCallId,
          runId: tc.runId,
          status: tc.status,
          body: structuredClone(tc),
        })
        .onConflictDoUpdate({
          target: toolCalls.toolCallId,
          set: { runId: tc.runId, status: tc.status, body: structuredClone(tc) },
        });
    }

    for (const approval of plan.approvals ?? []) {
      await db
        .insert(approvals)
        .values({
          approvalId: approval.approvalId,
          runId: approval.runId,
          status: approval.status,
          body: structuredClone(approval),
        })
        .onConflictDoUpdate({
          target: approvals.approvalId,
          set: {
            runId: approval.runId,
            status: approval.status,
            body: structuredClone(approval),
          },
        });
    }

    if (plan.checkpoint) {
      const lastSeq = sequences.length > 0 ? sequences[sequences.length - 1]! : 0;
      const stamped: Checkpoint = {
        ...structuredClone(plan.checkpoint),
        revision: run.revision,
        sequence: lastSeq,
      };
      await db.insert(checkpoints).values({
        checkpointId: stamped.checkpointId,
        runId,
        sequence: stamped.sequence,
        stateRef: stamped.stateRef,
        body: stamped,
      });
      const snapshotSource =
        plan.state !== undefined ? plan.state : (await this.readState(db, runId));
      if (snapshotSource !== undefined) {
        await db
          .insert(stateSnapshots)
          .values({ stateRef: stamped.stateRef, body: structuredClone(snapshotSource) })
          .onConflictDoUpdate({
            target: stateSnapshots.stateRef,
            set: { body: structuredClone(snapshotSource) },
          });
      }
    }

    if (plan.clearContinuation) {
      await db.delete(continuations).where(eq(continuations.runId, runId));
    } else if (plan.continuation) {
      await db
        .insert(continuations)
        .values({ runId, body: structuredClone(plan.continuation) })
        .onConflictDoUpdate({
          target: continuations.runId,
          set: { body: structuredClone(plan.continuation) },
        });
    }

    for (const rec of plan.outbox ?? []) {
      await db.insert(outbox).values({
        outboxRecordId: rec.outboxRecordId,
        status: rec.status,
        availableAt: rec.message.availableAt,
        claimOwner: rec.claimOwner ?? null,
        claimExpiresAt: rec.claimExpiresAt ?? null,
        revision: rec.revision,
        body: structuredClone(rec),
      });
    }

    for (const rec of plan.idempotency ?? []) {
      await db
        .insert(idempotency)
        .values({
          idempotencyRecordId: rec.idempotencyRecordId,
          namespace: rec.namespace,
          tenantId: rec.tenantId,
          dedupeKey: rec.dedupeKey,
          requestHash: rec.requestHash,
          body: structuredClone(rec),
        })
        .onConflictDoUpdate({
          target: [idempotency.namespace, idempotency.tenantId, idempotency.dedupeKey],
          set: {
            idempotencyRecordId: rec.idempotencyRecordId,
            requestHash: rec.requestHash,
            body: structuredClone(rec),
          },
        });
    }

    return {
      ok: true,
      revision: run.revision,
      sequences,
      leaseEpoch: run.leaseEpoch,
    };
  }

  private async lookupIdempotency(
    db: PostgresPersistenceDb,
    namespace: string,
    tenantId: string,
    dedupeKey: string,
  ): Promise<IdempotencyRecord | undefined> {
    const [row] = await db
      .select()
      .from(idempotency)
      .where(
        and(
          eq(idempotency.namespace, namespace),
          eq(idempotency.tenantId, tenantId),
          eq(idempotency.dedupeKey, dedupeKey),
        ),
      )
      .limit(1);
    return row ? idempotencyRecordSchema.parse(row.body) : undefined;
  }

  private async readState(db: PostgresPersistenceDb, runId: string): Promise<RunState | undefined> {
    const [row] = await db.select().from(runState).where(eq(runState.runId, runId)).limit(1);
    return row ? runStateSchema.parse(row.body) : undefined;
  }
}

function runRow(run: Run) {
  return {
    runId: run.runId,
    tenantId: run.tenantId,
    status: run.status,
    revision: run.revision,
    leaseEpoch: run.leaseEpoch,
    updatedAt: run.updatedAt,
    body: run,
  };
}

export function createPostgresPool(connectionString: string): pg.Pool {
  return new Pool({ connectionString });
}

export async function createPostgresPersistence(
  connectionString: string,
): Promise<PostgresPersistence> {
  const store = new PostgresPersistence(createPostgresPool(connectionString));
  await store.applySchema();
  return store;
}
