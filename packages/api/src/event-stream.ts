import type { EventEnvelope } from "@monai/contracts";
import type { PersistencePort } from "@monai/ports";

export type SubscribeRunEventsOptions = {
  persistence: PersistencePort;
  runId: string;
  fromSequence?: number;
};

export type LiveSubscribeRunEventsOptions = SubscribeRunEventsOptions & {
  /** Abort to stop polling (client disconnect). */
  signal?: AbortSignal;
  pollIntervalMs?: number;
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
 * Read-only Event subscription view (committed Event Log only).
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

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Live poll of committed events for SSE (push failures must not roll back Run).
 * `Last-Event-ID` maps to `fromSequence` (event.sequence).
 */
export async function* liveSubscribeRunEvents(
  options: LiveSubscribeRunEventsOptions,
): AsyncGenerator<EventEnvelope, void, undefined> {
  let nextSequence = options.fromSequence ?? 1;
  const pollIntervalMs = options.pollIntervalMs ?? 200;
  const { persistence, runId, signal } = options;

  while (!signal?.aborted) {
    const batch = await persistence.listEvents(runId, nextSequence);
    for (const event of batch) {
      yield event;
      nextSequence = event.sequence + 1;
    }
    try {
      await sleep(pollIntervalMs, signal);
    } catch {
      return;
    }
  }
}

export function parseLastEventId(header: string | undefined): number | undefined {
  if (!header) return undefined;
  const n = Number(header.trim());
  if (!Number.isFinite(n) || n < 1) return undefined;
  // Last-Event-ID is the last received sequence; resume from the next one.
  return Math.floor(n) + 1;
}
