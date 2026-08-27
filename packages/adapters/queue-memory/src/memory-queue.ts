import type { QueueEnqueueInput, QueueMessage, QueuePort } from "@monai/ports";

type InternalMessage = QueueMessage & {
  status: "ready" | "leased" | "acked";
  ownerId?: string;
};

/**
 * In-memory at-least-once queue with dedupeKey idempotent enqueue.
 */
export class InMemoryQueue implements QueuePort {
  private readonly byId = new Map<string, InternalMessage>();
  private readonly byDedupe = new Map<string, string>();
  private seq = 0;

  async enqueue(message: QueueEnqueueInput): Promise<void> {
    const existingId = this.byDedupe.get(message.dedupeKey);
    if (existingId) {
      return;
    }
    this.seq += 1;
    const messageId = `qm-${this.seq}`;
    const row: InternalMessage = {
      messageId,
      runId: message.runId,
      revision: message.revision,
      messageType: message.messageType,
      dedupeKey: message.dedupeKey,
      payload: message.payload,
      status: "ready",
    };
    this.byId.set(messageId, row);
    this.byDedupe.set(message.dedupeKey, messageId);
  }

  async lease(limit: number, ownerId: string): Promise<QueueMessage[]> {
    const leased: QueueMessage[] = [];
    for (const row of this.byId.values()) {
      if (leased.length >= limit) break;
      if (row.status !== "ready") continue;
      row.status = "leased";
      row.ownerId = ownerId;
      leased.push({
        messageId: row.messageId,
        runId: row.runId,
        revision: row.revision,
        messageType: row.messageType,
        dedupeKey: row.dedupeKey,
        payload: row.payload,
      });
    }
    return leased;
  }

  async ack(messageId: string): Promise<void> {
    const row = this.byId.get(messageId);
    if (!row) return;
    row.status = "acked";
  }

  async nack(messageId: string): Promise<void> {
    const row = this.byId.get(messageId);
    if (!row) return;
    row.status = "ready";
    row.ownerId = undefined;
  }

  /** Test helper */
  size(): number {
    return this.byId.size;
  }
}
