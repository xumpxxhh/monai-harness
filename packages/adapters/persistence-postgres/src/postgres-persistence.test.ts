import {
  CONTRACTS_SCHEMA_VERSION,
  createEmptyRunState,
  createInitialRun,
  type EventCandidate,
  type IdempotencyRecord,
  type OutboxRecord,
} from "@monai/contracts";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { truncateAll } from "./apply-schema.js";
import { PostgresPersistence } from "./postgres-persistence.js";
import { startTestPostgres, type TestPgHandle } from "./postgres-persistence.test-utils.js";

function baseCandidate(runId: string, expectedRevision: number, eventType: string): EventCandidate {
  return {
    schemaVersion: CONTRACTS_SCHEMA_VERSION,
    eventId: `${eventType}-${expectedRevision}-${runId}`,
    eventType,
    tenantId: "tenant-1",
    sessionId: "session-1",
    runId,
    occurredAt: "2026-08-27T00:00:00.000Z",
    correlationId: "corr-1",
    producer: { type: "test", id: "persistence-postgres" },
    hash: "hash-1",
    expectedRevision,
    payload: {},
  };
}

function sampleRun(runId: string) {
  return createInitialRun({
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
}

function sampleOutbox(runId: string, outboxRecordId: string): OutboxRecord {
  return {
    schemaVersion: CONTRACTS_SCHEMA_VERSION,
    outboxRecordId,
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
}

function sampleIdempotency(runId: string, requestHash: string): IdempotencyRecord {
  return {
    schemaVersion: CONTRACTS_SCHEMA_VERSION,
    idempotencyRecordId: `idemp-${runId}`,
    namespace: "create_run",
    tenantId: "tenant-1",
    key: "create",
    dedupeKey: "dedupe-shared",
    requestHash,
    ownerRef: { ownerType: "run", runId },
    status: "completed",
    revision: 0,
    createdAt: "2026-08-27T00:00:00.000Z",
    updatedAt: "2026-08-27T00:00:00.000Z",
    expiresAt: "2026-09-27T00:00:00.000Z",
  };
}

describe("PostgresPersistence L2", () => {
  let handle: TestPgHandle;
  let store: PostgresPersistence;

  beforeAll(async () => {
    handle = await startTestPostgres();
    store = new PostgresPersistence(handle.pool);
    await store.applySchema();
  });

  afterAll(async () => {
    await handle.stop();
  });

  beforeEach(async () => {
    await truncateAll(handle.pool);
  });

  it("CreateRun assigns continuous sequences and bumps revision", async () => {
    const runId = "run-create";
    const uow = await store.beginUnitOfWork(runId);
    const result = await uow.commit({
      expectedRevision: 0,
      expectedLeaseEpoch: 0,
      runCreate: sampleRun(runId),
      events: [
        baseCandidate(runId, 0, "run.created"),
        { ...baseCandidate(runId, 0, "run.created"), eventId: "extra-1", eventType: "run.status_changed" },
      ],
      outbox: [sampleOutbox(runId, "ob-1")],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.revision).toBe(1);
    expect(result.sequences).toEqual([1, 2]);

    const saved = await store.getRun(runId);
    expect(saved?.status).toBe("created");
    expect(saved?.revision).toBe(1);

    const listed = await store.listEvents(runId);
    expect(listed.map((e) => e.sequence)).toEqual([1, 2]);
    expect(await store.listOutbox()).toHaveLength(1);
  });

  it("CreateRun is atomic: unique violation rolls back Run, Event, and Outbox", async () => {
    const runId = "run-atomic";
    const uow = await store.beginUnitOfWork(runId);
    const result = await uow.commit({
      expectedRevision: 0,
      expectedLeaseEpoch: 0,
      runCreate: sampleRun(runId),
      events: [
        { ...baseCandidate(runId, 0, "run.created"), eventId: "dup-event" },
        { ...baseCandidate(runId, 0, "run.queued"), eventId: "dup-event" },
      ],
      outbox: [sampleOutbox(runId, "ob-atomic")],
    });

    expect(result.ok).toBe(false);
    expect(await store.getRun(runId)).toBeUndefined();
    expect(await store.listEvents(runId)).toEqual([]);
    expect(await store.listOutbox()).toEqual([]);
  });

  it("continues sequences across commits with no holes", async () => {
    const runId = "run-seq";
    const createUow = await store.beginUnitOfWork(runId);
    await createUow.commit({
      expectedRevision: 0,
      expectedLeaseEpoch: 0,
      runCreate: sampleRun(runId),
      events: [baseCandidate(runId, 0, "run.created")],
    });

    const uow = await store.beginUnitOfWork(runId);
    const queued = await uow.commit({
      expectedRevision: 1,
      expectedLeaseEpoch: 0,
      events: [
        baseCandidate(runId, 1, "run.queued"),
        { ...baseCandidate(runId, 1, "run.queued"), eventId: "lease-note", eventType: "run.status_changed" },
      ],
      runPatch: { status: "queued" },
    });

    expect(queued.ok).toBe(true);
    if (!queued.ok) return;
    expect(queued.revision).toBe(2);
    expect(queued.sequences).toEqual([2, 3]);
    expect((await store.listEvents(runId)).map((e) => e.sequence)).toEqual([1, 2, 3]);
    expect((await store.getRun(runId))?.status).toBe("queued");
  });

  it("returns conflict when expectedRevision does not match (first writer wins)", async () => {
    const runId = "run-rev";
    const createUow = await store.beginUnitOfWork(runId);
    await createUow.commit({
      expectedRevision: 0,
      expectedLeaseEpoch: 0,
      runCreate: sampleRun(runId),
      events: [baseCandidate(runId, 0, "run.created")],
    });

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
    expect((await store.getRun(runId))?.revision).toBe(1);
    expect((await store.getRun(runId))?.status).toBe("created");
    expect(await store.listEvents(runId)).toHaveLength(1);
  });

  it("returns lease_lost when expectedLeaseEpoch does not match", async () => {
    const runId = "run-lease";
    const createUow = await store.beginUnitOfWork(runId);
    await createUow.commit({
      expectedRevision: 0,
      expectedLeaseEpoch: 0,
      runCreate: sampleRun(runId),
      events: [baseCandidate(runId, 0, "run.created")],
    });

    const uow = await store.beginUnitOfWork(runId);
    const lost = await uow.commit({
      expectedRevision: 1,
      expectedLeaseEpoch: 9,
      events: [baseCandidate(runId, 1, "run.queued")],
    });

    expect(lost).toEqual({
      ok: false,
      code: "lease_lost",
      message: "expectedLeaseEpoch mismatch",
    });
    expect((await store.getRun(runId))?.revision).toBe(1);
  });

  it("Idempotency same key different hash → conflict and no second Run", async () => {
    const firstId = "run-idemp-a";
    const first = await store.beginUnitOfWork(firstId);
    const created = await first.commit({
      expectedRevision: 0,
      expectedLeaseEpoch: 0,
      runCreate: sampleRun(firstId),
      events: [baseCandidate(firstId, 0, "run.created")],
      idempotency: [sampleIdempotency(firstId, "hash-a")],
    });
    expect(created.ok).toBe(true);

    const secondId = "run-idemp-b";
    const second = await store.beginUnitOfWork(secondId);
    const conflict = await second.commit({
      expectedRevision: 0,
      expectedLeaseEpoch: 0,
      runCreate: sampleRun(secondId),
      events: [baseCandidate(secondId, 0, "run.created")],
      idempotency: [sampleIdempotency(secondId, "hash-b")],
    });

    expect(conflict).toEqual({
      ok: false,
      code: "conflict",
      message: "idempotency requestHash mismatch",
    });
    expect(await store.getRun(secondId)).toBeUndefined();
    expect(await store.listEvents(secondId)).toEqual([]);
  });

  it("Outbox claim is exclusive under SKIP LOCKED", async () => {
    const runId = "run-claim";
    const uow = await store.beginUnitOfWork(runId);
    await uow.commit({
      expectedRevision: 0,
      expectedLeaseEpoch: 0,
      runCreate: sampleRun(runId),
      events: [baseCandidate(runId, 0, "run.created")],
      outbox: [sampleOutbox(runId, "ob-claim")],
    });

    const [a, b] = await Promise.all([
      store.claim(10, "owner-a", 5_000),
      store.claim(10, "owner-b", 5_000),
    ]);
    const combined = [...a, ...b];
    expect(combined).toHaveLength(1);
    expect(combined[0]?.outboxRecordId).toBe("ob-claim");
    expect(["owner-a", "owner-b"]).toContain(combined[0]?.claimOwner);
  });

  it("persists state, checkpoint snapshot, and tool/approval projections", async () => {
    const runId = "run-proj";
    const createUow = await store.beginUnitOfWork(runId);
    await createUow.commit({
      expectedRevision: 0,
      expectedLeaseEpoch: 0,
      runCreate: sampleRun(runId),
      events: [baseCandidate(runId, 0, "run.created")],
    });

    const state = createEmptyRunState();
    const uow = await store.beginUnitOfWork(runId);
    const result = await uow.commit({
      expectedRevision: 1,
      expectedLeaseEpoch: 0,
      events: [baseCandidate(runId, 1, "checkpoint.saved")],
      state,
      checkpoint: {
        schemaVersion: CONTRACTS_SCHEMA_VERSION,
        checkpointId: "cp-1",
        runId,
        executionManifestRef: "manifest-1",
        revision: 0,
        sequence: 0,
        stateRef: "state-ref-1",
        stateHash: "sh",
        strategy: {
          type: "light",
          version: "1",
          cursorRef: "cur",
          cursorHash: "ch",
        },
        createdAt: "2026-08-27T00:00:00.000Z",
        hash: "cp-hash",
      },
    });
    expect(result.ok).toBe(true);

    const cp = await store.getLatestCheckpoint(runId);
    expect(cp?.checkpointId).toBe("cp-1");
    expect(cp?.revision).toBe(2);
    expect(cp?.sequence).toBe(2);
    expect(await store.getState(runId)).toEqual(state);
    expect(await store.getStateSnapshot("state-ref-1")).toEqual(state);
  });
});
