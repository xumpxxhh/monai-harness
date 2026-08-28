import { createInitialRun } from "@monai/contracts";
import { describe, expect, it } from "vitest";

import { bootstrapRunning, createEvalContext, executeTurn } from "../eval/eval-harness.js";
import { computeRunTiming, timingEvent } from "./compute-run-timing.js";
import { MVP_METRIC_GAPS, MVP_TIMING_METRICS_IMPLEMENTED } from "./mvp-gaps.js";

describe("computeRunTiming", () => {
  it("derives queue, active, awaiting, and wall time from synthetic lifecycle", () => {
    const events = [
      timingEvent({ sequence: 1, eventType: "run.created", occurredAt: "2026-01-01T00:00:00.000Z" }),
      timingEvent({ sequence: 2, eventType: "run.queued", occurredAt: "2026-01-01T00:00:10.000Z" }),
      timingEvent({ sequence: 3, eventType: "run.lease_acquired", occurredAt: "2026-01-01T00:00:15.000Z" }),
      timingEvent({
        sequence: 4,
        eventType: "run.lease_lost",
        occurredAt: "2026-01-01T00:00:25.000Z",
      }),
      timingEvent({
        sequence: 5,
        eventType: "run.status_changed",
        occurredAt: "2026-01-01T00:00:26.000Z",
        payload: { from: "running", to: "awaiting_approval" },
      }),
      timingEvent({
        sequence: 6,
        eventType: "run.status_changed",
        occurredAt: "2026-01-01T00:01:26.000Z",
        payload: { from: "awaiting_approval", to: "queued" },
      }),
      timingEvent({ sequence: 7, eventType: "run.lease_acquired", occurredAt: "2026-01-01T00:01:31.000Z" }),
      timingEvent({ sequence: 8, eventType: "run.completed", occurredAt: "2026-01-01T00:02:01.000Z" }),
    ];
    const run = { ...createInitialRun({
      runId: "r1",
      tenantId: "t1",
      sessionId: "s1",
      agentDefinitionId: "agent",
      agentVersion: "1",
      executionManifestRef: "manifest://m1",
      packVersions: [],
      goal: "timing",
      strategy: { type: "light", version: "1" },
      budgets: {},
    }), status: "succeeded" as const };
    const timing = computeRunTiming(events, run);

    expect(timing.queueLatencyMs).toBe(10_000);
    expect(timing.activeExecutionMs).toBe(40_000);
    expect(timing.awaitingMs).toBe(60_000);
    expect(timing.totalWallMs).toBe(121_000);
  });

  it("derives timing from golden eval path events", async () => {
    const ctx = createEvalContext();
    const runId = "eval-timing-golden";
    await bootstrapRunning(ctx, runId, "please finish");
    await executeTurn(ctx, runId);

    const run = await ctx.persistence.getRun(runId);
    const events = await ctx.persistence.listEvents(runId);
    expect(run?.status).toBe("succeeded");

    const timing = computeRunTiming(events, run!);
    expect(timing.totalWallMs).not.toBeNull();
    expect(timing.totalWallMs).toBeGreaterThanOrEqual(0);
    expect(timing.queueLatencyMs).toBeGreaterThanOrEqual(0);
    expect(timing.activeExecutionMs).toBeGreaterThanOrEqual(0);
  });

  it("derives awaiting time from approval path", async () => {
    const ctx = createEvalContext();
    const runId = "eval-timing-approval";
    await bootstrapRunning(ctx, runId, "synthetic high");
    await executeTurn(ctx, runId);

    const run = await ctx.persistence.getRun(runId);
    expect(run?.status).toBe("awaiting_approval");
    const timing = computeRunTiming(await ctx.persistence.listEvents(runId), run!);
    expect(timing.awaitingMs).toBeGreaterThanOrEqual(0);
    expect(timing.totalWallMs).toBeNull();
  });

  it("MVP timing gaps are closed in P9c", () => {
    expect(MVP_TIMING_METRICS_IMPLEMENTED.length).toBe(4);
    expect(MVP_METRIC_GAPS.some((g) => g.includes("queue latency"))).toBe(false);
    expect(MVP_METRIC_GAPS.some((g) => g.includes("total wall time"))).toBe(false);
  });
});
