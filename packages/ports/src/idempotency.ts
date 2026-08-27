import type { IdempotencyRecord } from "@monai/contracts";

/**
 * Idempotency writes are typically part of CommitPlan (same UoW).
 * This port is for read / lookup outside an open Engine commit.
 */
export type IdempotencyPort = {
  get(namespace: string, tenantId: string, dedupeKey: string): Promise<IdempotencyRecord | undefined>;
};
