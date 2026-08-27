import { CONTRACTS_SCHEMA_VERSION, type EventCandidate } from "@monai/contracts";
import { describe, expect, it } from "vitest";

import { orderEventCandidates } from "../ordering/order-events.js";

function candidate(eventType: string, eventId: string): EventCandidate {
  return {
    schemaVersion: CONTRACTS_SCHEMA_VERSION,
    eventId,
    eventType,
    tenantId: "t1",
    sessionId: "s1",
    runId: "r1",
    occurredAt: "2026-08-27T00:00:00.000Z",
    correlationId: "c1",
    producer: { type: "test", id: "order" },
    hash: "h",
    expectedRevision: 0,
    payload: { eventId },
  };
}

describe("orderEventCandidates", () => {
  it("orders run.queued before run.created into created then queued", () => {
    const input = [candidate("run.queued", "e-queued"), candidate("run.created", "e-created")];
    const ordered = orderEventCandidates(input);
    expect(ordered.map((e) => e.eventType)).toEqual(["run.created", "run.queued"]);
    expect(ordered.map((e) => e.eventId)).toEqual(["e-created", "e-queued"]);
  });

  it("is stable for equal ranks", () => {
    const input = [candidate("run.failed", "a"), candidate("run.cancelled", "b")];
    const ordered = orderEventCandidates(input);
    expect(ordered.map((e) => e.eventId)).toEqual(["a", "b"]);
  });
});
