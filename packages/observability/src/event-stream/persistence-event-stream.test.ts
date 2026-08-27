import { buildCreateRunCommand } from "@monai/api";
import { CONTRACTS_SCHEMA_VERSION } from "@monai/contracts";
import { InMemoryPersistence } from "@monai/persistence-memory";
import { describe, expect, it } from "vitest";

import { PersistenceEventStream } from "./persistence-event-stream.js";
import { computeRunMetrics } from "../metrics/compute-metrics.js";
import { MVP_METRIC_GAPS } from "../metrics/mvp-gaps.js";

describe("PersistenceEventStream", () => {
  it("yields events from sequence cursor", async () => {
    const persistence = new InMemoryPersistence();
    const { Engine } = await import("@monai/runtime");
    const { InMemoryLease } = await import("@monai/lease-memory");
    const engine = new Engine({ persistence, lease: new InMemoryLease() });
    await engine.handle(
      buildCreateRunCommand({
        tenantId: "t1",
        commandId: "c1",
        runId: "r-stream",
        sessionId: "s1",
        agentDefinitionId: "agent",
        agentVersion: "1",
        executionManifestRef: "m1",
        packVersions: [],
        goal: "g",
        strategy: { type: "light", version: "1" },
      }),
    );

    const stream = new PersistenceEventStream(persistence);
    const all: string[] = [];
    for await (const e of stream.readFrom("r-stream", 1)) {
      all.push(`${e.sequence}:${e.eventType}`);
    }
    expect(all.length).toBeGreaterThan(0);
    expect(all[0]).toMatch(/^1:run\.created$/);
  });
});

describe("computeRunMetrics", () => {
  it("reports policy deny rate inputs from events", async () => {
    const persistence = new InMemoryPersistence();
    const { Engine, HookRunner } = await import("@monai/runtime");
    const { InMemoryLease } = await import("@monai/lease-memory");
    const { StubModelPort } = await import("@monai/model-stub");
    const { OutboxDispatcher, Scheduler } = await import("@monai/delivery");
    const { InMemoryQueue } = await import("@monai/queue-memory");

    const lease = new InMemoryLease();
    const queue = new InMemoryQueue();
    const engine = new Engine({
      persistence,
      lease,
      model: new StubModelPort(),
      hooks: new HookRunner(),
    });
    const dispatcher = new OutboxDispatcher({ outbox: persistence, queue });
    const scheduler = new Scheduler({ queue, engine });

    await engine.handle(
      buildCreateRunCommand({
        tenantId: "t1",
        commandId: "c-deny",
        runId: "r-deny",
        sessionId: "s1",
        agentDefinitionId: "agent",
        agentVersion: "1",
        executionManifestRef: "m1",
        packVersions: [],
        goal: "deny-me",
        strategy: { type: "light", version: "1" },
      }),
    );
    await dispatcher.tick();
    await scheduler.tick();

    const run = await persistence.getRun("r-deny");
    expect(run?.status).toBe("running");
    await engine.handle({
      schemaVersion: CONTRACTS_SCHEMA_VERSION,
      commandId: "turn-deny",
      commandType: "execute_turn",
      tenantId: "t1",
      runId: "r-deny",
      expectedRevision: run!.revision,
      leaseEpoch: run!.leaseEpoch,
      issuedAt: new Date().toISOString(),
      actor: { principalId: "scheduler" },
    });

    const events = await persistence.listEvents("r-deny");
    const snap = computeRunMetrics(events, (await persistence.getRun("r-deny"))!);
    expect(snap.policyEvaluated).toBeGreaterThan(0);
    expect(snap.policyDenied).toBeGreaterThan(0);
    expect(MVP_METRIC_GAPS.length).toBeGreaterThan(0);
  });
});
