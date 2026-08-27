import type { OutboxRecord } from "@monai/contracts";

/**
 * Outbox append happens inside Persistence UoW via CommitPlan.outbox.
 * This port covers post-commit claim / publish marking (EDR-004).
 */
export type OutboxPort = {
  claim(limit: number, ownerId: string, claimTtlMs: number): Promise<OutboxRecord[]>;
  markPublished(outboxRecordId: string): Promise<void>;
  markFailed(outboxRecordId: string, error: string): Promise<void>;
};
