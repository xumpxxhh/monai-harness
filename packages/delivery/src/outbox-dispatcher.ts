import type { OutboxPort, QueuePort } from "@monai/ports";

export type OutboxDispatcherDeps = {
  outbox: OutboxPort;
  queue: QueuePort;
  ownerId?: string;
  claimLimit?: number;
  claimTtlMs?: number;
};

/**
 * Claims outbox rows and publishes to QueuePort (EDR-004).
 * Does not change Run truth.
 */
export class OutboxDispatcher {
  private readonly outbox: OutboxPort;
  private readonly queue: QueuePort;
  private readonly ownerId: string;
  private readonly claimLimit: number;
  private readonly claimTtlMs: number;

  constructor(deps: OutboxDispatcherDeps) {
    this.outbox = deps.outbox;
    this.queue = deps.queue;
    this.ownerId = deps.ownerId ?? "dispatcher";
    this.claimLimit = deps.claimLimit ?? 32;
    this.claimTtlMs = deps.claimTtlMs ?? 30_000;
  }

  async tick(): Promise<number> {
    const claimed = await this.outbox.claim(this.claimLimit, this.ownerId, this.claimTtlMs);
    let published = 0;
    for (const record of claimed) {
      try {
        if (record.message.messageType !== "queue_run") {
          // Leave tool/other outbox for specialized dispatchers.
          if ("requeueOutbox" in this.outbox && typeof (this.outbox as { requeueOutbox: (id: string) => Promise<void> }).requeueOutbox === "function") {
            await (this.outbox as { requeueOutbox: (id: string) => Promise<void> }).requeueOutbox(
              record.outboxRecordId,
            );
          }
          continue;
        }
        const payload = record.message.payload as
          | { runId?: string; revision?: number; messageType?: string }
          | undefined;
        const runId = payload?.runId ?? record.message.aggregateRef.aggregateId;
        const revision = payload?.revision ?? record.message.aggregateRef.revision;
        await this.queue.enqueue({
          runId,
          revision,
          messageType: record.message.messageType,
          dedupeKey: record.message.dedupeKey,
          payload: {
            ...(typeof record.message.payload === "object" && record.message.payload
              ? (record.message.payload as Record<string, unknown>)
              : {}),
            tenantId: record.message.tenantId,
          },
        });
        await this.outbox.markPublished(record.outboxRecordId);
        published += 1;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await this.outbox.markFailed(record.outboxRecordId, message);
      }
    }
    return published;
  }
}
