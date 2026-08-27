import type { OutboxRecord } from "@monai/contracts";
import type { QueuePort } from "@monai/ports";
import { queueDedupeKey } from "@monai/runtime";

type CreatedRunRow = {
  runId: string;
  tenantId: string;
  revision: number;
  createdAt: string;
};

/** Minimal persistence surface used by compensation (avoids coupling to memory class). */
export type CompensationStore = {
  listRunsByStatus(status: "created"): CreatedRunRow[] | Promise<CreatedRunRow[]>;
  listOutbox(): OutboxRecord[] | Promise<OutboxRecord[]>;
  requeueOutbox(outboxRecordId: string): Promise<void>;
};

export type CompensationScannerDeps = {
  store: CompensationStore;
  queue: QueuePort;
  /** Recreate queue signal for created runs older than this (ms). */
  createdStaleMs?: number;
};

/**
 * Rebuilds the same {runId, revision} queue signal; never creates a new Run.
 */
export class CompensationScanner {
  private readonly store: CompensationStore;
  private readonly queue: QueuePort;
  private readonly createdStaleMs: number;

  constructor(deps: CompensationScannerDeps) {
    this.store = deps.store;
    this.queue = deps.queue;
    this.createdStaleMs = deps.createdStaleMs ?? 0;
  }

  async tick(nowMs = Date.now()): Promise<number> {
    let actions = 0;

    // Unpublished / failed outbox → requeue to pending then dispatcher can claim.
    const outboxRows = await Promise.resolve(this.store.listOutbox());
    for (const row of outboxRows) {
      if (row.status === "pending") {
        // Ensure queue has the signal (idempotent by dedupeKey).
        const payload = row.message.payload as
          | { runId?: string; revision?: number }
          | undefined;
        const runId = payload?.runId ?? row.message.aggregateRef.aggregateId;
        const revision = payload?.revision ?? row.message.aggregateRef.revision;
        await this.queue.enqueue({
          runId,
          revision,
          messageType: row.message.messageType,
          dedupeKey: row.message.dedupeKey,
          payload: {
            ...(typeof row.message.payload === "object" && row.message.payload
              ? row.message.payload
              : {}),
            tenantId: row.message.tenantId,
          },
        });
        actions += 1;
        continue;
      }
      if (row.status === "claimed" || row.status === "failed") {
        await this.store.requeueOutbox(row.outboxRecordId);
        actions += 1;
      }
    }

    // created too long without queued — enqueue same dedupeKey for post-create revision.
    const createdRuns = await Promise.resolve(this.store.listRunsByStatus("created"));
    for (const run of createdRuns) {
      const age = nowMs - Date.parse(run.createdAt);
      if (age < this.createdStaleMs) continue;
      const revision = run.revision; // after create commit, revision is post-create
      const dedupeKey = queueDedupeKey(run.runId, revision);
      await this.queue.enqueue({
        runId: run.runId,
        revision,
        messageType: "queue_run",
        dedupeKey,
        payload: { runId: run.runId, revision, tenantId: run.tenantId, messageType: "queue_run" },
      });
      actions += 1;
    }

    return actions;
  }
}
