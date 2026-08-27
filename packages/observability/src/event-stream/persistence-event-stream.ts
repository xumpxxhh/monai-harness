import type { EventEnvelope } from "@monai/contracts";
import type { EventStreamPort, PersistencePort } from "@monai/ports";

/**
 * Read-only Event stream from committed Persistence (design 07 §2).
 * Yields events with sequence >= fromSequence in ascending order.
 */
export class PersistenceEventStream implements EventStreamPort {
  private readonly persistence: PersistencePort;

  constructor(persistence: PersistencePort) {
    this.persistence = persistence;
  }

  async *readFrom(runId: string, fromSequence: number): AsyncIterable<EventEnvelope> {
    const events = await this.persistence.listEvents(runId, fromSequence);
    for (const event of events) {
      yield event;
    }
  }

  /** Collect committed tail for tests and polling clients. */
  async readBatch(runId: string, fromSequence: number): Promise<EventEnvelope[]> {
    return this.persistence.listEvents(runId, fromSequence);
  }
}
