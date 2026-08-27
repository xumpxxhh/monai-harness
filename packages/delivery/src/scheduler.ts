import { CONTRACTS_SCHEMA_VERSION } from "@monai/contracts";
import type { HarnessCommand, QueuePort } from "@monai/ports";
import type { Engine } from "@monai/runtime";

export type SchedulerDeps = {
  queue: QueuePort;
  engine: Engine;
  ownerId?: string;
  leaseLimit?: number;
};

/**
 * Leases queue messages and drives queue_run → acquire_lease via Engine.
 */
export class Scheduler {
  private readonly queue: QueuePort;
  private readonly engine: Engine;
  private readonly ownerId: string;
  private readonly leaseLimit: number;

  constructor(deps: SchedulerDeps) {
    this.queue = deps.queue;
    this.engine = deps.engine;
    this.ownerId = deps.ownerId ?? "scheduler";
    this.leaseLimit = deps.leaseLimit ?? 16;
  }

  async tick(): Promise<number> {
    const messages = await this.queue.lease(this.leaseLimit, this.ownerId);
    let handled = 0;

    for (const msg of messages) {
      try {
        if (msg.messageType === "queue_run") {
          const queueCmd: HarnessCommand = {
            schemaVersion: CONTRACTS_SCHEMA_VERSION,
            commandId: `cmd-queue-${msg.messageId}`,
            commandType: "queue_run",
            tenantId: "unknown",
            runId: msg.runId,
            expectedRevision: msg.revision,
            issuedAt: new Date().toISOString(),
            correlationId: msg.dedupeKey,
          };

          // Prefer tenant from payload when present
          const payload = msg.payload as { tenantId?: string } | undefined;
          if (payload?.tenantId) {
            queueCmd.tenantId = payload.tenantId;
          } else {
            // Load not available here; Engine only needs runId for queue_run.
            queueCmd.tenantId = "_";
          }

          const queued = await this.engine.handle(queueCmd);
          if (!queued.ok) {
            await this.queue.nack(msg.messageId);
            continue;
          }

          if (queued.run.status === "queued") {
            const acquireCmd: HarnessCommand = {
              schemaVersion: CONTRACTS_SCHEMA_VERSION,
              commandId: `cmd-lease-${msg.messageId}`,
              commandType: "acquire_lease",
              tenantId: queued.run.tenantId,
              runId: msg.runId,
              expectedRevision: queued.revision,
              actor: { principalId: this.ownerId },
              issuedAt: new Date().toISOString(),
              correlationId: msg.dedupeKey,
            };
            const acquired = await this.engine.handle(acquireCmd);
            if (!acquired.ok) {
              await this.queue.nack(msg.messageId);
              continue;
            }
          }

          await this.queue.ack(msg.messageId);
          handled += 1;
        } else {
          await this.queue.ack(msg.messageId);
        }
      } catch {
        await this.queue.nack(msg.messageId);
      }
    }

    return handled;
  }
}
