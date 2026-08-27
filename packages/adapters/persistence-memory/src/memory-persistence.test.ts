import {
  CONTRACTS_SCHEMA_VERSION,
  createInitialRun,
  type EventCandidate,
  type OutboxRecord,
} from "@monai/contracts";
import { describe, expect, it } from "vitest";

import { InMemoryPersistence } from "./memory-persistence.js";

function baseCandidate(runId: string, expectedRevision: number, eventType: string): EventCandidate {
  return {
    schemaVersion: CONTRACTS_SCHEMA_VERSION,
    eventId: `${eventType}-${expectedRevision}`,
    eventType,
    tenantId: "tenant-1",
    sessionId: "session-1",
    runId,
    occurredAt: "2026-08-27T00:00:00.000Z",
    correlationId: "corr-1",
    producer: { type: "test", id: "persistence" },
    hash: "hash-1",
    expectedRevision,
    payload: {},
  };
}

describe("InMemoryPersistence commit", () => {
  it("creates run, assigns continuous sequences, bumps revision", async () => {
    const store = new InMemoryPersistence();
    const runId = "run-1";
    const run = createInitialRun({
      runId,
      tenantId: "tenant-1",
      sessionId: "session-1",
      agentDefinitionId: "agent",
      agentVersion: "1",
      executionManifestRef: "manifest-1",
      packVersions: [],
      goal: "test",
      strategy: { type: "light", version: "1" },
      budgets: {},
    });

    const outbox: OutboxRecord = {
      schemaVersion: CONTRACTS_SCHEMA_VERSION,
      outboxRecordId: "ob-1",
      message: {
        messageType: "queue_run",
        tenantId: "tenant-1",
        aggregateRef: { aggregateType: "run", aggregateId: runId, revision: 0 },
        dedupeKey: `queue_run:${runId}:0`,
        payloadHash: "ph",
        availableAt: "2026-08-27T00:00:00.000Z",
        payload: { runId, revision: 0 },
      },
      status: "pending",
      publishAttempts: 0,
      revision: 0,
      createdAt: "2026-08-27T00:00:00.000Z",
      updatedAt: "2026-08-27T00:00:00.000Z",
      expiresAt: "2026-09-27T00:00:00.000Z",
    };

    const uow = await store.beginUnitOfWork(runId);
    const result = await uow.commit({
      expectedRevision: 0,
      expectedLeaseEpoch: 0,
      runCreate: run,
      events: [baseCandidate(runId, 0, "run.created")],
      outbox: [outbox],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.revision).toBe(1);
    expect(result.sequences).toEqual([1]);

    const saved = await store.getRun(runId);
    expect(saved?.status).toBe("created");
    expect(saved?.revision).toBe(1);

    const events = await store.listEvents(runId);
    expect(events).toHaveLength(1);
    expect(events[0]?.sequence).toBe(1);
    expect(store.listOutbox()).toHaveLength(1);
  });

  it("returns conflict when expectedRevision does not match", async () => {
    const store = new InMemoryPersistence();
    const runId = "run-2";
    const run = createInitialRun({
      runId,
      tenantId: "tenant-1",
      sessionId: "session-1",
      agentDefinitionId: "agent",
      agentVersion: "1",
      executionManifestRef: "manifest-1",
      packVersions: [],
      goal: "test",
      strategy: { type: "light", version: "1" },
      budgets: {},
    });

    const createUow = await store.beginUnitOfWork(runId);
    const created = await createUow.commit({
      expectedRevision: 0,
      expectedLeaseEpoch: 0,
      runCreate: run,
      events: [baseCandidate(runId, 0, "run.created")],
    });
    expect(created.ok).toBe(true);

    const uow = await store.beginUnitOfWork(runId);
    const conflict = await uow.commit({
      expectedRevision: 0,
      expectedLeaseEpoch: 0,
      events: [baseCandidate(runId, 0, "run.queued")],
      runPatch: { status: "queued" },
    });

    expect(conflict).toEqual({
      ok: false,
      code: "conflict",
      message: "expectedRevision mismatch",
    });

    const after = await store.getRun(runId);
    expect(after?.revision).toBe(1);
    expect(after?.status).toBe("created");
    expect(await store.listEvents(runId)).toHaveLength(1);
  });

  it("accepts matching revision and continues sequences", async () => {
    const store = new InMemoryPersistence();
    const runId = "run-3";
    const run = createInitialRun({
      runId,
      tenantId: "tenant-1",
      sessionId: "session-1",
      agentDefinitionId: "agent",
      agentVersion: "1",
      executionManifestRef: "manifest-1",
      packVersions: [],
      goal: "test",
      strategy: { type: "light", version: "1" },
      budgets: {},
    });

    const createUow = await store.beginUnitOfWork(runId);
    await createUow.commit({
      expectedRevision: 0,
      expectedLeaseEpoch: 0,
      runCreate: run,
      events: [baseCandidate(runId, 0, "run.created")],
    });

    const uow = await store.beginUnitOfWork(runId);
    const queued = await uow.commit({
      expectedRevision: 1,
      expectedLeaseEpoch: 0,
      events: [baseCandidate(runId, 1, "run.queued")],
      runPatch: { status: "queued" },
    });

    expect(queued.ok).toBe(true);
    if (!queued.ok) return;
    expect(queued.revision).toBe(2);
    expect(queued.sequences).toEqual([2]);

    const events = await store.listEvents(runId);
    expect(events.map((e) => e.sequence)).toEqual([1, 2]);
    expect((await store.getRun(runId))?.status).toBe("queued");
  });
});
