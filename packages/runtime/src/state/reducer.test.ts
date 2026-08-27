import {
  CONTRACTS_SCHEMA_VERSION,
  createEmptyRunState,
  type Observation,
} from "@monai/contracts";
import { describe, expect, it } from "vitest";

import { reduce, validateObservationToFact } from "./reducer.js";

function observation(data: unknown): Observation {
  return {
    schemaVersion: CONTRACTS_SCHEMA_VERSION,
    observationId: "obs-1",
    tenantId: "t1",
    sessionId: "s1",
    runId: "r1",
    stepId: "step-1",
    source: { kind: "tool", sourceId: "echo:1", version: "0.1.0" },
    observedAt: "2026-08-27T00:00:00.000Z",
    data,
    hash: "h1",
  };
}

describe("validateObservationToFact + reduce", () => {
  it("accepts observation and reduces state deterministically", () => {
    const obs = observation({ summary: "hello", text: "hello" });
    const validated = validateObservationToFact(obs, {
      authorizationDecisionRef: "policy:stub/allow",
    });
    expect(validated.accepted).toBe(true);
    if (!validated.accepted) return;

    const s1 = reduce(createEmptyRunState(), validated.fact);
    const s2 = reduce(createEmptyRunState(), validated.fact);
    expect(s1).toEqual(s2);
    expect(s1.cursor.stepCount).toBe(1);
    expect(s1.lastFactId).toBe(validated.fact.factId);
    expect(s1.facts[0]?.summary).toBe("hello");
  });

  it("rejects observation without data", () => {
    const obs = observation(undefined);
    delete (obs as { data?: unknown }).data;
    const validated = validateObservationToFact(obs, {
      authorizationDecisionRef: "policy:stub/allow",
    });
    expect(validated.accepted).toBe(false);
  });

  it("applies facts serially", () => {
    const v1 = validateObservationToFact(observation({ summary: "a" }), {
      authorizationDecisionRef: "p",
    });
    const obs2 = observation({ summary: "b" });
    obs2.observationId = "obs-2";
    obs2.hash = "h2";
    const v2 = validateObservationToFact(obs2, { authorizationDecisionRef: "p" });
    expect(v1.accepted && v2.accepted).toBe(true);
    if (!v1.accepted || !v2.accepted) return;

    const state = reduce(reduce(createEmptyRunState(), v1.fact), v2.fact);
    expect(state.cursor.stepCount).toBe(2);
    expect(state.facts.map((f) => f.summary)).toEqual(["a", "b"]);
  });
});
