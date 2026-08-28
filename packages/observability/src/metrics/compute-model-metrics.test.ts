import { describe, expect, it } from "vitest";
import type { EventEnvelope } from "@monai/contracts";
import { computeModelAndContextMetrics } from "./compute-model-metrics.js";

function mockEvent(partial: Partial<EventEnvelope>): EventEnvelope {
  return {
    schemaVersion: "1.0.0",
    eventId: "evt-test",
    eventType: "model.called",
    tenantId: "t1",
    sessionId: "s1",
    runId: "r1",
    occurredAt: "2026-08-28T10:00:00.000Z",
    correlationId: "c1",
    producer: { type: "engine", id: "runtime" },
    hash: "h1",
    expectedRevision: 0,
    sequence: 1,
    recordedAt: "2026-08-28T10:00:00.000Z",
    ...partial,
  };
}

describe("computeModelAndContextMetrics", () => {
  it("computes tokens, costs and context metrics from committed events", () => {
    const events: EventEnvelope[] = [
      mockEvent({
        sequence: 1,
        eventType: "context.built",
        payload: { truncations: [{ sectionKind: "recent_events" }] },
      }),
      mockEvent({
        sequence: 2,
        eventType: "model.called",
        payload: { target: "gpt-4o" },
      }),
      mockEvent({
        sequence: 3,
        eventType: "model.responded",
        payload: {
          target: "gpt-4o",
          usage: { inputTokens: 1000, outputTokens: 200, totalTokens: 1200 },
        },
      }),
      mockEvent({
        sequence: 4,
        eventType: "context.built",
        payload: { truncations: [] },
      }),
      mockEvent({
        sequence: 5,
        eventType: "model.called",
        payload: { target: "custom-unpriced-model" },
      }),
      mockEvent({
        sequence: 6,
        eventType: "model.responded",
        payload: {
          target: "custom-unpriced-model",
          usage: { inputTokens: 500, outputTokens: 100, totalTokens: 600 },
        },
      }),
      mockEvent({
        sequence: 7,
        eventType: "step.failed",
        payload: { reason: "Context budget hardMaxTokens overflow limit 100 reached" },
      }),
    ];

    const metrics = computeModelAndContextMetrics(events, "r1");

    expect(metrics.model.modelCallsCount).toBe(2);
    expect(metrics.model.inputTokens).toBe(1500);
    expect(metrics.model.outputTokens).toBe(300);
    expect(metrics.model.totalTokens).toBe(1800);
    // gpt-4o price: 5 USD / 1M input, 15 USD / 1M output
    // 1000 input = 0.005, 200 output = 0.003, total = 0.008
    expect(metrics.model.totalCostUsd).toBe(0.008);
    expect(metrics.model.unknownCostCalls).toBe(1);

    expect(metrics.context.contextBuildAttempts).toBe(3); // 2 built + 1 overflow step.failed
    expect(metrics.context.contextOverflows).toBe(1);
    expect(metrics.context.contextTruncations).toBe(1);
    expect(metrics.context.contextOverflowRate).toBeCloseTo(1 / 3, 4);
    expect(metrics.context.contextTruncationRate).toBeCloseTo(1 / 3, 4);
  });
});
