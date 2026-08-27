import type { EventCandidate, KnownEventType } from "@monai/contracts";
import { KNOWN_EVENT_TYPES } from "@monai/contracts";

/**
 * Fixed lifecycle stage order (design 03 §8 / engineering 03).
 * Unknown event types sort after known ones, preserving relative order (stable).
 */
const EVENT_ORDER: Record<KnownEventType, number> = {
  "run.created": 10,
  "run.queued": 20,
  "run.lease_acquired": 30,
  "run.lease_lost": 35,
  "run.status_changed": 40,

  "step.started": 100,
  "hook.invoked": 110,
  "hook.context_contributed": 120,
  "hook.vetoed": 120,
  "hook.failed": 120,
  "context.built": 130,
  "model.called": 140,
  "model.responded": 150,
  "action.proposed": 160,
  "policy.evaluated": 170,
  "policy.denied": 175,
  "action.accepted": 180,
  "action.rejected": 180,

  "approval.requested": 182,
  "approval.approved": 183,
  "approval.rejected": 183,
  "approval.expired": 183,
  "approval.revoked": 183,
  "approval.consumed": 184,

  "tool.call_prepared": 185,
  "tool.dispatched": 190,
  "tool.succeeded": 195,
  "tool.failed": 195,
  "tool.outcome_unknown": 195,
  "tool.reconciled": 196,

  "observation.recorded": 200,
  "fact.accepted": 210,
  "fact.rejected": 210,
  "state.reduced": 220,

  "checkpoint.saved": 280,

  "step.completed": 300,
  "step.failed": 300,
  "run.completed": 400,
  "run.failed": 400,
  "run.cancelled": 400,
};

function stageRank(eventType: string): number {
  if ((KNOWN_EVENT_TYPES as readonly string[]).includes(eventType)) {
    return EVENT_ORDER[eventType as KnownEventType];
  }
  return 1000;
}

/**
 * Order EventCandidates before Persistence assigns sequences.
 * Stable: equal rank keeps input order.
 */
export function orderEventCandidates(events: EventCandidate[]): EventCandidate[] {
  return events
    .map((event, index) => ({ event, index }))
    .sort((a, b) => {
      const rankDiff = stageRank(a.event.eventType) - stageRank(b.event.eventType);
      if (rankDiff !== 0) return rankDiff;
      return a.index - b.index;
    })
    .map(({ event }) => event);
}
