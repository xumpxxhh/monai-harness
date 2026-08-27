import { CONTRACTS_SCHEMA_VERSION } from "@monai/contracts";
import type { HarnessCommand } from "@monai/ports";
import { InMemoryLease } from "@monai/lease-memory";
import { InMemoryPersistence } from "@monai/persistence-memory";
import { InMemoryQueue } from "@monai/queue-memory";
import { Engine } from "@monai/runtime";
import { describe, expect, it } from "vitest";

import { CompensationScanner } from "./compensation-scanner.js";
import { OutboxDispatcher } from "./outbox-dispatcher.js";
import { Scheduler } from "./scheduler.js";

function buildHarness() {
  const persistence = new InMemoryPersistence();
  const lease = new InMemoryLease();
  const queue = new InMemoryQueue();
  const engine = new Engine({ persistence, lease });
  const dispatcher = new OutboxDispatcher({ outbox: persistence, queue });
  const scheduler = new Scheduler({ queue, engine });
  const compensation = new CompensationScanner({
    store: persistence,
    queue,
    createdStaleMs: 0,
  });
  return { persistence, lease, queue, engine, dispatcher, scheduler, compensation };
}

/** Local test helper — avoid depending on @monai/api (breaks turbo cycle with api→delivery). */
function createCmd(runId: string, commandId: string): HarnessCommand {
  return {
    schemaVersion: CONTRACTS_SCHEMA_VERSION,
    commandId,
    commandType: "create_run",
    tenantId: "tenant-1",
    runId,
    payload: {
      runId,
      sessionId: "session-1",
      agentDefinitionId: "agent",
      agentVersion: "1",
      executionManifestRef: "manifest-1",
      packVersions: [],
      goal: "goal",
      strategy: { type: "light", version: "1" },
      budgets: {},
    },
    issuedAt: new Date().toISOString(),
    correlationId: commandId,
  };
}

describe("P2 CreateRun → running loop", () => {
  it("reaches running with created → queued → lease_acquired events", async () => {
    const { persistence, engine, dispatcher, scheduler } = buildHarness();
    const created = await engine.handle(createCmd("run-main", "cmd-main"));
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.run.status).toBe("created");

    expect(await dispatcher.tick()).toBeGreaterThan(0);
    expect(await scheduler.tick()).toBeGreaterThan(0);

    const run = await persistence.getRun("run-main");
    expect(run?.status).toBe("running");
    expect(run?.leaseEpoch).toBe(1);

    const types = (await persistence.listEvents("run-main")).map((e) => e.eventType);
    expect(types).toEqual(["run.created", "run.queued", "run.lease_acquired"]);
  });

  it("dedupes dual outbox/queue delivery", async () => {
    const { persistence, engine, dispatcher, scheduler, queue } = buildHarness();
    await engine.handle(createCmd("run-dup", "cmd-dup"));

    await dispatcher.tick();
    // Second publish attempt of same dedupeKey is a no-op on queue.
    const outbox = persistence.listOutbox()[0]!;
    await queue.enqueue({
      runId: "run-dup",
      revision: 1,
      messageType: "queue_run",
      dedupeKey: outbox.message.dedupeKey,
      payload: outbox.message.payload,
    });
    expect(queue.size()).toBe(1);

    await scheduler.tick();
    // Duplicate queue_run after success should be idempotent if another message appeared.
    await scheduler.tick();

    const run = await persistence.getRun("run-dup");
    expect(run?.status).toBe("running");
    const events = await persistence.listEvents("run-dup");
    expect(events.filter((e) => e.eventType === "run.queued")).toHaveLength(1);
    expect(events.filter((e) => e.eventType === "run.lease_acquired")).toHaveLength(1);
  });

  it("compensation rebuilds queue signal for unpublished outbox", async () => {
    const { persistence, engine, dispatcher, scheduler, compensation, queue } = buildHarness();
    await engine.handle(createCmd("run-comp", "cmd-comp"));

    // Simulate dispatcher failure: leave outbox pending, do not call dispatcher.
    expect(persistence.listOutbox()[0]?.status).toBe("pending");
    expect(queue.size()).toBe(0);

    await compensation.tick();
    expect(queue.size()).toBe(1);

    // Still pending outbox; dispatcher can publish (queue dedupe keeps one message).
    await dispatcher.tick();
    await scheduler.tick();

    const run = await persistence.getRun("run-comp");
    expect(run?.status).toBe("running");
    const types = (await persistence.listEvents("run-comp")).map((e) => e.eventType);
    expect(types).toEqual(["run.created", "run.queued", "run.lease_acquired"]);
  });
});
