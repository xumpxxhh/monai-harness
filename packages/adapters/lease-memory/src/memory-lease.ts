import type { LeasePort, LeaseRecord } from "@monai/ports";

/**
 * In-memory lease metadata store.
 * leaseEpoch values are supplied by Engine after CommitPlan success.
 */
export class InMemoryLease implements LeasePort {
  private readonly leases = new Map<string, LeaseRecord>();

  async bind(runId: string, ownerId: string, leaseEpoch: number, ttlMs: number): Promise<void> {
    const now = Date.now();
    const acquiredAt = new Date(now).toISOString();
    this.leases.set(runId, {
      runId,
      ownerId,
      leaseEpoch,
      acquiredAt,
      expiresAt: new Date(now + ttlMs).toISOString(),
      lastHeartbeatAt: acquiredAt,
    });
  }

  async heartbeat(runId: string, ownerId: string, leaseEpoch: number): Promise<void> {
    const lease = this.leases.get(runId);
    if (!lease || lease.ownerId !== ownerId || lease.leaseEpoch !== leaseEpoch) {
      throw new Error("lease heartbeat rejected");
    }
    const now = Date.now();
    const ttlMs = Date.parse(lease.expiresAt) - Date.parse(lease.acquiredAt);
    this.leases.set(runId, {
      ...lease,
      lastHeartbeatAt: new Date(now).toISOString(),
      expiresAt: new Date(now + Math.max(ttlMs, 1)).toISOString(),
    });
  }

  async validate(runId: string, ownerId: string, leaseEpoch: number): Promise<boolean> {
    const lease = this.leases.get(runId);
    if (!lease) return false;
    if (lease.ownerId !== ownerId || lease.leaseEpoch !== leaseEpoch) return false;
    return Date.parse(lease.expiresAt) > Date.now();
  }

  async release(runId: string, ownerId: string, leaseEpoch: number): Promise<void> {
    const lease = this.leases.get(runId);
    if (!lease) return;
    if (lease.ownerId !== ownerId || lease.leaseEpoch !== leaseEpoch) return;
    this.leases.delete(runId);
  }

  async get(runId: string): Promise<LeaseRecord | undefined> {
    const lease = this.leases.get(runId);
    return lease ? structuredClone(lease) : undefined;
  }
}
