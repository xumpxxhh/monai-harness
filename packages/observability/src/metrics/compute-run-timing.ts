import { CONTRACTS_SCHEMA_VERSION, type EventEnvelope, type Run } from "@monai/contracts";

export type RunTimingMetrics = {
  runId: string;
  /** Sum of queued → lease_acquired segments (ms). */
  queueLatencyMs: number;
  /** Running intervals while lease was held (ms). */
  activeExecutionMs: number;
  /** awaiting_approval + awaiting_input + waiting_child (ms). */
  awaitingMs: number;
  /** Terminal runs only: terminal − created (ms). */
  totalWallMs: number | null;
};

const AWAITING_STATUSES = new Set(["awaiting_approval", "awaiting_input", "waiting_child"]);
const TERMINAL_EVENT_TYPES = new Set(["run.completed", "run.failed", "run.cancelled"]);

function parseTime(iso: string): number {
  return Date.parse(iso);
}

function closeAwaiting(status: string, statusSince: number | null, at: number, awaitingMs: number): number {
  if (statusSince !== null && AWAITING_STATUSES.has(status)) {
    return awaitingMs + Math.max(0, at - statusSince);
  }
  return awaitingMs;
}

function closeActive(
  status: string,
  leaseActiveSince: number | null,
  at: number,
  activeExecutionMs: number,
): { activeExecutionMs: number; leaseActiveSince: number | null } {
  if (status === "running" && leaseActiveSince !== null) {
    return {
      activeExecutionMs: activeExecutionMs + Math.max(0, at - leaseActiveSince),
      leaseActiveSince: null,
    };
  }
  return { activeExecutionMs, leaseActiveSince };
}

/**
 * Reconstruct design 07 §4.2 time metrics from committed Run Events only.
 */
export function computeRunTiming(events: EventEnvelope[], run: Run): RunTimingMetrics {
  const ordered = [...events].sort((a, b) => a.sequence - b.sequence);

  let status = "created";
  let statusSince: number | null = null;
  let leaseActiveSince: number | null = null;
  let queuedSince: number | null = null;
  let createdAt: number | null = null;

  let queueLatencyMs = 0;
  let activeExecutionMs = 0;
  let awaitingMs = 0;
  let totalWallMs: number | null = null;

  for (const event of ordered) {
    const at = parseTime(event.occurredAt);

    switch (event.eventType) {
      case "run.created":
        createdAt = at;
        status = "created";
        statusSince = at;
        break;

      case "run.queued":
        awaitingMs = closeAwaiting(status, statusSince, at, awaitingMs);
        ({ activeExecutionMs, leaseActiveSince } = closeActive(status, leaseActiveSince, at, activeExecutionMs));
        status = "queued";
        statusSince = at;
        queuedSince = at;
        break;

      case "run.lease_acquired":
        if (queuedSince !== null) {
          queueLatencyMs += Math.max(0, at - queuedSince);
          queuedSince = null;
        }
        status = "running";
        statusSince = at;
        leaseActiveSince = at;
        break;

      case "run.lease_lost":
        ({ activeExecutionMs, leaseActiveSince } = closeActive("running", leaseActiveSince, at, activeExecutionMs));
        break;

      case "run.status_changed": {
        const payload = event.payload as { from?: string; to?: string } | undefined;
        const to = payload?.to;
        if (!to) break;
        awaitingMs = closeAwaiting(status, statusSince, at, awaitingMs);
        ({ activeExecutionMs, leaseActiveSince } = closeActive(status, leaseActiveSince, at, activeExecutionMs));
        status = to;
        statusSince = at;
        if (to === "queued") {
          queuedSince = at;
        }
        break;
      }

      case "run.completed":
      case "run.failed":
      case "run.cancelled":
        awaitingMs = closeAwaiting(status, statusSince, at, awaitingMs);
        ({ activeExecutionMs, leaseActiveSince } = closeActive(status, leaseActiveSince, at, activeExecutionMs));
        if (createdAt !== null) {
          totalWallMs = Math.max(0, at - createdAt);
        }
        status = event.eventType === "run.completed" ? "succeeded" : run.status;
        statusSince = at;
        break;

      default:
        break;
    }
  }

  const terminal =
    run.status === "succeeded" || run.status === "failed" || run.status === "cancelled";
  if (!terminal) {
    totalWallMs = null;
  }

  return {
    runId: run.runId,
    queueLatencyMs,
    activeExecutionMs,
    awaitingMs,
    totalWallMs,
  };
}

/** Test helper — minimal event row. */
export function timingEvent(
  partial: Pick<EventEnvelope, "sequence" | "eventType" | "occurredAt"> &
    Partial<Pick<EventEnvelope, "payload">>,
): EventEnvelope {
  return {
    schemaVersion: CONTRACTS_SCHEMA_VERSION,
    eventId: `evt-${partial.sequence}`,
    eventType: partial.eventType,
    tenantId: "t1",
    sessionId: "s1",
    runId: "r1",
    occurredAt: partial.occurredAt,
    correlationId: "c1",
    producer: { type: "test", id: "timing" },
    hash: `h-${partial.sequence}`,
    expectedRevision: 1,
    sequence: partial.sequence,
    recordedAt: partial.occurredAt,
    payload: partial.payload,
  };
}

export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1);
  return sorted[idx] ?? null;
}

export function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}
