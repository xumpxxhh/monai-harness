import type { EventEnvelope } from "@monai/contracts";
import type { PersistencePort } from "@monai/ports";

export type SubscribeRunEventsOptions = {
  persistence: PersistencePort;
  runId: string;
  fromSequence?: number;
};

export type RunEventSubscription = {
  runId: string;
  fromSequence: number;
  /** Async iterator over committed events (sequence >= fromSequence). */
  events(): AsyncIterable<EventEnvelope>;
  /** One-shot read of committed events since fromSequence. */
  readBatch(): Promise<EventEnvelope[]>;
};

/**
 * Read-only Event subscription view (no HTTP/SSE — EDR-007 Deferred).
 */
export function subscribeRunEvents(options: SubscribeRunEventsOptions): RunEventSubscription {
  const fromSequence = options.fromSequence ?? 1;
  const { persistence, runId } = options;

  return {
    runId,
    fromSequence,
    async *events(): AsyncIterable<EventEnvelope> {
      const batch = await persistence.listEvents(runId, fromSequence);
      for (const event of batch) {
        yield event;
      }
    },
    readBatch: () => persistence.listEvents(runId, fromSequence),
  };
}
