import type {
  ApprovalRecord,
  Checkpoint,
  Continuation,
  EventEnvelope,
  IdempotencyRecord,
  OutboxRecord,
  Run,
  RunState,
  RunStatus,
  ToolCallRecord,
} from "@monai/contracts";
import type {
  CommitPlan,
  CommitResult,
  IdempotencyPort,
  OutboxPort,
  PersistencePort,
  UnitOfWork,
} from "@monai/ports";

function cloneRun(run: Run): Run {
  return structuredClone(run);
}

function idempotencyMapKey(namespace: string, tenantId: string, dedupeKey: string): string {
  return `${namespace}::${tenantId}::${dedupeKey}`;
}

/**
 * In-memory Persistence + Outbox + Idempotency for L0/L1 tests.
 * Simulates FOR UPDATE via a per-runId async mutex (EDR-006 semantics).
 */
export class InMemoryPersistence implements PersistencePort, OutboxPort, IdempotencyPort {
  private readonly runs = new Map<string, Run>();
  private readonly events = new Map<string, EventEnvelope[]>();
  private readonly states = new Map<string, RunState>();
  private readonly toolCalls = new Map<string, ToolCallRecord>();
  private readonly approvals = new Map<string, ApprovalRecord>();
  private readonly checkpoints = new Map<string, Checkpoint[]>();
  private readonly stateSnapshots = new Map<string, RunState>();
  private readonly continuations = new Map<string, Continuation>();
  private readonly outbox = new Map<string, OutboxRecord>();
  private readonly idempotency = new Map<string, IdempotencyRecord>();
  private readonly lockTails = new Map<string, Promise<void>>();

  async beginUnitOfWork(runId: string): Promise<UnitOfWork> {
    const unlock = await this.acquire(runId);
    let released = false;
    const releaseOnce = () => {
      if (!released) {
        released = true;
        unlock();
      }
    };

    return {
      runId,
      commit: async (plan) => {
        try {
          return this.commitLocked(runId, plan);
        } finally {
          releaseOnce();
        }
      },
      rollback: async () => {
        releaseOnce();
      },
    };
  }

  async getRun(runId: string): Promise<Run | undefined> {
    const run = this.runs.get(runId);
    return run ? cloneRun(run) : undefined;
  }

  async getState(runId: string): Promise<RunState | undefined> {
    const state = this.states.get(runId);
    return state ? structuredClone(state) : undefined;
  }

  async getToolCall(toolCallId: string): Promise<ToolCallRecord | undefined> {
    const record = this.toolCalls.get(toolCallId);
    return record ? structuredClone(record) : undefined;
  }

  async listToolCalls(runId: string): Promise<ToolCallRecord[]> {
    return [...this.toolCalls.values()]
      .filter((t) => t.runId === runId)
      .map((t) => structuredClone(t));
  }

  async getApproval(approvalId: string): Promise<ApprovalRecord | undefined> {
    const record = this.approvals.get(approvalId);
    return record ? structuredClone(record) : undefined;
  }

  async listApprovals(runId: string): Promise<ApprovalRecord[]> {
    return [...this.approvals.values()]
      .filter((a) => a.runId === runId)
      .map((a) => structuredClone(a));
  }

  async getLatestCheckpoint(runId: string): Promise<Checkpoint | undefined> {
    const list = this.checkpoints.get(runId) ?? [];
    if (list.length === 0) return undefined;
    return structuredClone(list[list.length - 1]!);
  }

  async getContinuation(runId: string): Promise<Continuation | undefined> {
    const c = this.continuations.get(runId);
    return c ? structuredClone(c) : undefined;
  }

  async getStateSnapshot(stateRef: string): Promise<RunState | undefined> {
    const state = this.stateSnapshots.get(stateRef);
    return state ? structuredClone(state) : undefined;
  }

  async listEvents(runId: string, fromSequence = 1): Promise<EventEnvelope[]> {
    const list = this.events.get(runId) ?? [];
    return list.filter((e) => e.sequence >= fromSequence).map((e) => structuredClone(e));
  }

  /** Scan helper for compensation (P2). */
  listRunsByStatus(status: RunStatus): Run[] {
    return [...this.runs.values()].filter((r) => r.status === status).map((r) => cloneRun(r));
  }

  async claim(limit: number, ownerId: string, claimTtlMs: number): Promise<OutboxRecord[]> {
    const now = Date.now();
    const claimed: OutboxRecord[] = [];
    for (const record of this.outbox.values()) {
      if (claimed.length >= limit) break;
      if (record.status !== "pending") continue;
      const next: OutboxRecord = {
        ...structuredClone(record),
        status: "claimed",
        claimOwner: ownerId,
        claimExpiresAt: new Date(now + claimTtlMs).toISOString(),
        updatedAt: new Date(now).toISOString(),
        revision: record.revision + 1,
      };
      this.outbox.set(record.outboxRecordId, next);
      claimed.push(structuredClone(next));
    }
    return claimed;
  }

  async markPublished(outboxRecordId: string): Promise<void> {
    const record = this.outbox.get(outboxRecordId);
    if (!record) return;
    this.outbox.set(outboxRecordId, {
      ...record,
      status: "published",
      publishedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      revision: record.revision + 1,
      publishAttempts: record.publishAttempts + 1,
    });
  }

  async markFailed(outboxRecordId: string, error: string): Promise<void> {
    const record = this.outbox.get(outboxRecordId);
    if (!record) return;
    this.outbox.set(outboxRecordId, {
      ...record,
      status: "failed",
      lastError: error,
      updatedAt: new Date().toISOString(),
      revision: record.revision + 1,
      publishAttempts: record.publishAttempts + 1,
    });
  }

  /** Reset claimed/failed rows back to pending for compensation replay (same record). */
  async requeueOutbox(outboxRecordId: string): Promise<void> {
    const record = this.outbox.get(outboxRecordId);
    if (!record) return;
    if (record.status === "published") return;
    this.outbox.set(outboxRecordId, {
      ...record,
      status: "pending",
      claimOwner: undefined,
      claimExpiresAt: undefined,
      updatedAt: new Date().toISOString(),
      revision: record.revision + 1,
    });
  }

  async get(
    namespace: string,
    tenantId: string,
    dedupeKey: string,
  ): Promise<IdempotencyRecord | undefined> {
    const record = this.idempotency.get(idempotencyMapKey(namespace, tenantId, dedupeKey));
    return record ? structuredClone(record) : undefined;
  }

  /** Test helper: peek outbox rows. */
  listOutbox(): OutboxRecord[] {
    return [...this.outbox.values()].map((r) => structuredClone(r));
  }

  private commitLocked(runId: string, plan: CommitPlan): CommitResult {
    const existing = this.runs.get(runId);
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
      const key = idempotencyMapKey(rec.namespace, rec.tenantId, rec.dedupeKey);
      const prev = this.idempotency.get(key);
      if (prev && prev.requestHash !== rec.requestHash) {
        return { ok: false, code: "conflict", message: "idempotency requestHash mismatch" };
      }
    }

    const now = new Date().toISOString();
    let run: Run = isCreate ? cloneRun(plan.runCreate!) : cloneRun(existing!);

    if (plan.runPatch) {
      run = { ...run, ...plan.runPatch, runId: run.runId };
    }

    const priorEvents = [...(this.events.get(runId) ?? [])];
    let nextSequence =
      priorEvents.length === 0 ? 1 : priorEvents[priorEvents.length - 1]!.sequence + 1;
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

    this.runs.set(runId, run);
    this.events.set(runId, [...priorEvents, ...appended]);
    if (plan.state !== undefined) {
      this.states.set(runId, structuredClone(plan.state));
    }
    for (const tc of plan.toolCalls ?? []) {
      this.toolCalls.set(tc.toolCallId, structuredClone(tc));
    }
    for (const approval of plan.approvals ?? []) {
      this.approvals.set(approval.approvalId, structuredClone(approval));
    }
    if (plan.checkpoint) {
      const lastSeq = sequences.length > 0 ? sequences[sequences.length - 1]! : 0;
      const stamped: Checkpoint = {
        ...structuredClone(plan.checkpoint),
        revision: run.revision,
        sequence: lastSeq,
      };
      const list = this.checkpoints.get(runId) ?? [];
      list.push(stamped);
      this.checkpoints.set(runId, list);
      const snapshotSource =
        plan.state !== undefined ? plan.state : this.states.get(runId);
      if (snapshotSource !== undefined) {
        this.stateSnapshots.set(stamped.stateRef, structuredClone(snapshotSource));
      }
    }
    if (plan.clearContinuation) {
      this.continuations.delete(runId);
    } else if (plan.continuation) {
      this.continuations.set(runId, structuredClone(plan.continuation));
    }
    for (const rec of plan.outbox ?? []) {
      this.outbox.set(rec.outboxRecordId, structuredClone(rec));
    }
    for (const rec of plan.idempotency ?? []) {
      const key = idempotencyMapKey(rec.namespace, rec.tenantId, rec.dedupeKey);
      this.idempotency.set(key, structuredClone(rec));
    }

    return {
      ok: true,
      revision: run.revision,
      sequences,
      leaseEpoch: run.leaseEpoch,
    };
  }

  private async acquire(runId: string): Promise<() => void> {
    const prev = this.lockTails.get(runId) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.lockTails.set(
      runId,
      prev.then(() => gate),
    );
    await prev;
    return release;
  }
}
