import type { GovernanceEventCandidate, GovernanceEventEnvelope } from "@monai/contracts";
import type { GovernanceAppendResult, GovernanceEventStorePort } from "@monai/ports";

function streamKey(tenantId: string, governanceStreamId: string): string {
  return `${tenantId}::${governanceStreamId}`;
}

/**
 * In-memory GovernanceEvent store with per-stream sequence (L0/L1).
 */
export class InMemoryGovernanceEventStore implements GovernanceEventStorePort {
  private readonly streams = new Map<string, GovernanceEventEnvelope[]>();
  private readonly lockTails = new Map<string, Promise<void>>();

  async append(
    tenantId: string,
    governanceStreamId: string,
    candidate: GovernanceEventCandidate,
  ): Promise<GovernanceAppendResult> {
    const key = streamKey(tenantId, governanceStreamId);
    const unlock = await this.acquire(key);
    try {
      const existing = this.streams.get(key) ?? [];
      const last = existing.at(-1);
      if (last && last.hash === candidate.hash) {
        return { ok: true, event: last };
      }
      const sequence = (last?.sequence ?? 0) + 1;
      const recordedAt = new Date().toISOString();
      const event: GovernanceEventEnvelope = {
        ...candidate,
        sequence,
        recordedAt,
      };
      this.streams.set(key, [...existing, event]);
      return { ok: true, event };
    } finally {
      unlock();
    }
  }

  async list(tenantId: string, governanceStreamId: string): Promise<GovernanceEventEnvelope[]> {
    const key = streamKey(tenantId, governanceStreamId);
    return (this.streams.get(key) ?? []).map((event) => ({ ...event }));
  }

  private async acquire(key: string): Promise<() => void> {
    const prev = this.lockTails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.lockTails.set(
      key,
      prev.then(() => gate),
    );
    await prev;
    return () => {
      release();
    };
  }
}
