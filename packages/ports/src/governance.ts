import type { GovernanceEventCandidate, GovernanceEventEnvelope } from "@monai/contracts";

export type GovernanceAppendResult =
  | { ok: true; event: GovernanceEventEnvelope }
  | { ok: false; code: "conflict"; message: string };

/**
 * Append-only governance event store (EDR-013).
 * Separate sequence space from Run Event; no Run write path.
 */
export type GovernanceEventStorePort = {
  append(
    tenantId: string,
    governanceStreamId: string,
    candidate: GovernanceEventCandidate,
  ): Promise<GovernanceAppendResult>;

  list(tenantId: string, governanceStreamId: string): Promise<GovernanceEventEnvelope[]>;
};
