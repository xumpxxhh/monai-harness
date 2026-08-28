import {
  CONTRACTS_SCHEMA_VERSION,
  type EventCandidate,
  type IdempotencyRecord,
  type OutboxRecord,
  type ToolCallRecord,
} from "@monai/contracts";
import { InMemoryLease } from "@monai/lease-memory";
import { StubModelPort } from "@monai/model-stub";
import type { HarnessCommand } from "@monai/ports";
import { wireWorkspaceGenericPack } from "@monai/delivery";
import {
  computeStateHash,
  Engine,
  InMemoryManifestStore,
  RecoveryService,
  replayEvents,
  ToolInvoker,
} from "@monai/runtime";
import { IsolatedSyntheticSink } from "@monai/synthetic-sink";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { truncateAll } from "./apply-schema.js";
import { PostgresPersistence } from "./postgres-persistence.js";
import { startTestPostgres, type TestPgHandle } from "./postgres-persistence.test-utils.js";

function wirePgEngine(
  store: PostgresPersistence,
  lease: InMemoryLease,
  options?: { requireApprovalTools?: readonly string[] },
) {
  const pack = wireWorkspaceGenericPack({ tenantId: "t1" });
  const manifestStore = new InMemoryManifestStore();
  const engine = new Engine({
    persistence: store,
    lease,
    model: new StubModelPort(),
    hooks: pack.hookRunner,
    registry: pack.registry,
    manifestStore,
    toolAllowlist: pack.toolAllowlist,
    requireApprovalTools: options?.requireApprovalTools ?? pack.requireApprovalTools,
  });
  return { pack, invoker: pack.invoker, engine, manifestStore };
}

function cmd(
  partial: Partial<HarnessCommand> & Pick<HarnessCommand, "commandType" | "commandId">,
): HarnessCommand {
  return {
    schemaVersion: CONTRACTS_SCHEMA_VERSION,
    tenantId: "t1",
    issuedAt: new Date().toISOString(),
    ...partial,
  };
}

async function toRunning(engine: Engine, runId: string, goal: string, ownerId: string) {
  const created = await engine.handle(
    cmd({
      commandType: "create_run",
      commandId: `create-${runId}`,
      payload: {
        runId,
        sessionId: "s1",
        agentDefinitionId: "agent",
        agentVersion: "1",
        executionManifestRef: "manifest://m1",
        packVersions: [{ packId: "core", version: "0.1.0" }],
        goal,
        strategy: { type: "light", version: "1" },
      },
    }),
  );
  expect(created.ok).toBe(true);
  if (!created.ok) return created;

  const queued = await engine.handle(
    cmd({
      commandType: "queue_run",
      commandId: `queue-${runId}`,
      runId,
      expectedRevision: created.revision,
    }),
  );
  expect(queued.ok).toBe(true);
  if (!queued.ok) return queued;

  return engine.handle(
    cmd({
      commandType: "acquire_lease",
      commandId: `lease-${runId}`,
      runId,
      expectedRevision: queued.revision,
      actor: { principalId: ownerId },
    }),
  );
}

async function dispatchEchoSuccess(
  engine: Engine,
  persistence: PostgresPersistence,
  invoker: ToolInvoker,
  args: {
    runId: string;
    revision: number;
    leaseEpoch: number;
    toolCallId: string;
  },
) {
  const accepted = await engine.handle(
    cmd({
      commandType: "tool_dispatch_result",
      commandId: `accept-${args.toolCallId}`,
      runId: args.runId,
      expectedRevision: args.revision,
      leaseEpoch: args.leaseEpoch,
      payload: { toolCallId: args.toolCallId, phase: "accepted" },
    }),
  );
  expect(accepted.ok).toBe(true);
  if (!accepted.ok) return accepted;

  const record = await persistence.getToolCall(args.toolCallId);
  expect(record).toBeDefined();
  const outcome = await invoker.invoke(record!);

  return engine.handle(
    cmd({
      commandType: "tool_dispatch_result",
      commandId: `term-${args.toolCallId}`,
      runId: args.runId,
      expectedRevision: accepted.revision,
      leaseEpoch: args.leaseEpoch,
      payload: {
        toolCallId: args.toolCallId,
        phase: "succeeded",
        data: outcome.ok ? outcome.data : {},
        resultHash: outcome.ok ? outcome.resultHash : undefined,
      },
    }),
  );
}

function baseCandidate(runId: string, expectedRevision: number, eventType: string): EventCandidate {
  return {
    schemaVersion: CONTRACTS_SCHEMA_VERSION,
    eventId: `${eventType}-${expectedRevision}-${runId}`,
    eventType,
    tenantId: "t1",
    sessionId: "s1",
    runId,
    occurredAt: "2026-08-27T00:00:00.000Z",
    correlationId: "corr-1",
    producer: { type: "test", id: "persistence-postgres-l2" },
    hash: "hash-1",
    expectedRevision,
    payload: {},
  };
}

describe("PostgresPersistence L2 scenarios (recovery + prepared)", () => {
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

  it("recovery: full replay State hash matches persisted state after tool chain", async () => {
    const lease = new InMemoryLease();
    const { invoker, engine, manifestStore } = wirePgEngine(store, lease, { requireApprovalTools: [] });
    const ownerId = "worker-1";

    const running = await toRunning(engine, "r-l2-rec-echo", "hello world", ownerId);
    expect(running.ok).toBe(true);
    if (!running.ok) return;

    const turn = await engine.handle(
      cmd({
        commandType: "execute_turn",
        commandId: "turn-1",
        runId: "r-l2-rec-echo",
        expectedRevision: running.revision,
        leaseEpoch: running.leaseEpoch,
        actor: { principalId: ownerId },
      }),
    );
    expect(turn.ok).toBe(true);
    if (!turn.ok) return;

    const toolCall = (await store.listToolCalls("r-l2-rec-echo"))[0]!;
    const dispatched = await dispatchEchoSuccess(engine, store, invoker, {
      runId: "r-l2-rec-echo",
      revision: turn.revision,
      leaseEpoch: running.leaseEpoch,
      toolCallId: toolCall.toolCallId,
    });
    expect(dispatched.ok).toBe(true);

    const recovery = new RecoveryService({ persistence: store, lease, manifestStore });
    const result = await recovery.recover("r-l2-rec-echo");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const persisted = await store.getState("r-l2-rec-echo");
    expect(result.stateHash).toBe(computeStateHash(persisted));
    expect(result.replayMode).toBe("full");
    expect(result.toolInventory.prepared).toHaveLength(0);
  });

  it("recovery: checkpoint-accelerated replay hash matches full replay", async () => {
    const lease = new InMemoryLease();
    const ownerId = "worker-1";
    const { engine, manifestStore } = wirePgEngine(store, lease);

    const running = await toRunning(engine, "r-l2-rec-cp", "synthetic high", ownerId);
    expect(running.ok).toBe(true);
    if (!running.ok) return;

    const waitTurn = await engine.handle(
      cmd({
        commandType: "execute_turn",
        commandId: "turn-wait",
        runId: "r-l2-rec-cp",
        expectedRevision: running.revision,
        leaseEpoch: running.leaseEpoch,
        actor: { principalId: ownerId },
      }),
    );
    expect(waitTurn.ok).toBe(true);
    if (!waitTurn.ok) return;
    expect(waitTurn.run.status).toBe("awaiting_approval");

    const cp = await store.getLatestCheckpoint("r-l2-rec-cp");
    expect(cp).toBeDefined();
    expect(cp!.sequence).toBeGreaterThan(0);

    const events = await store.listEvents("r-l2-rec-cp");
    const toolCalls = await store.listToolCalls("r-l2-rec-cp");
    const snapshot = await store.getStateSnapshot(cp!.stateRef);
    expect(snapshot).toBeDefined();

    const fullHash = computeStateHash(replayEvents({ events, toolCalls, fromSequence: 1 }));
    const acceleratedHash = computeStateHash(
      replayEvents({
        events,
        toolCalls,
        initialState: snapshot,
        fromSequence: cp!.sequence + 1,
      }),
    );
    expect(acceleratedHash).toBe(fullHash);

    const recovery = new RecoveryService({ persistence: store, lease, manifestStore });
    const recovered = await recovery.recover("r-l2-rec-cp");
    expect(recovered.ok).toBe(true);
    if (!recovered.ok) return;
    expect(recovered.replayMode).toBe("checkpoint");
    expect(recovered.continuation?.kind).toBe("approval");
  });

  it("prepared-before-dispatch: prepare UoW rollback leaves no ToolCall / Outbox / Idempotency", async () => {
    const lease = new InMemoryLease();
    const ownerId = "worker-1";
    const { engine } = wirePgEngine(store, lease, { requireApprovalTools: [] });

    const running = await toRunning(engine, "r-l2-prep-atom", "hello", ownerId);
    expect(running.ok).toBe(true);
    if (!running.ok) return;

    const run = await store.getRun("r-l2-prep-atom");
    expect(run).toBeDefined();
    const now = "2026-08-27T01:00:00.000Z";
    const toolCallId = "tc-prep-atom";
    const toolCall: ToolCallRecord = {
      schemaVersion: CONTRACTS_SCHEMA_VERSION,
      toolCallId,
      tenantId: "t1",
      sessionId: "s1",
      runId: "r-l2-prep-atom",
      stepId: "step-1",
      actionId: "act-1",
      toolId: "synthetic.write_high",
      toolVersion: "0.1.0",
      executionManifestRef: "manifest://m1",
      inputHash: "ih",
      arguments: { resourceKey: "synthetic://demo/resource", payload: { x: 1 } },
      idempotencyKey: "syn-prep-atom",
      idempotencyScope: "run",
      deliverySemantics: "at_least_once",
      sideEffectProfile: "write_high",
      status: "prepared",
      attempt: 1,
      preparedAt: now,
      dispatchLeaseEpoch: run!.leaseEpoch,
      revision: 0,
      reconcileSupported: true,
    };
    const idem: IdempotencyRecord = {
      schemaVersion: CONTRACTS_SCHEMA_VERSION,
      idempotencyRecordId: "idem-prep-atom",
      namespace: "tool_call",
      tenantId: "t1",
      key: "syn-prep-atom",
      dedupeKey: "syn-prep-atom",
      requestHash: "ih",
      ownerRef: { ownerType: "tool_call", runId: "r-l2-prep-atom", toolCallId },
      status: "completed",
      revision: 0,
      createdAt: now,
      updatedAt: now,
      expiresAt: "2026-09-27T00:00:00.000Z",
    };
    const ob: OutboxRecord = {
      schemaVersion: CONTRACTS_SCHEMA_VERSION,
      outboxRecordId: "ob-prep-atom",
      message: {
        messageType: "dispatch_tool",
        tenantId: "t1",
        aggregateRef: { aggregateType: "tool_call", aggregateId: toolCallId, revision: run!.revision + 1 },
        dedupeKey: `dispatch_tool:${toolCallId}`,
        payloadHash: `dispatch_tool:${toolCallId}`,
        availableAt: now,
        payload: {
          runId: "r-l2-prep-atom",
          toolCallId,
          revision: run!.revision + 1,
          leaseEpoch: run!.leaseEpoch,
          tenantId: "t1",
        },
      },
      status: "pending",
      publishAttempts: 0,
      revision: 0,
      createdAt: now,
      updatedAt: now,
      expiresAt: "2026-09-27T00:00:00.000Z",
    };

    const uow = await store.beginUnitOfWork("r-l2-prep-atom");
    const failed = await uow.commit({
      expectedRevision: run!.revision,
      expectedLeaseEpoch: run!.leaseEpoch,
      events: [
        { ...baseCandidate("r-l2-prep-atom", run!.revision, "tool.call_prepared"), eventId: "dup-prep" },
        { ...baseCandidate("r-l2-prep-atom", run!.revision, "tool.call_prepared"), eventId: "dup-prep" },
      ],
      toolCalls: [toolCall],
      idempotency: [idem],
      outbox: [ob],
    });
    expect(failed.ok).toBe(false);

    expect(await store.listToolCalls("r-l2-prep-atom")).toEqual([]);
    expect(await store.getToolCall(toolCallId)).toBeUndefined();
    expect(await store.get("tool_call", "t1", "syn-prep-atom")).toBeUndefined();
    const dispatchOutbox = (await store.listOutbox()).filter(
      (row) => row.message.messageType === "dispatch_tool",
    );
    expect(dispatchOutbox).toEqual([]);
  });

  it("prepared-before-dispatch: no prepared ToolCall → accept fails and sink stays at zero", async () => {
    const lease = new InMemoryLease();
    const { pack, invoker, engine } = wirePgEngine(store, lease, { requireApprovalTools: [] });
    const sink = pack.synthetic;
    const ownerId = "worker-1";
    const resourceKey = "synthetic://demo/resource";

    const running = await toRunning(engine, "r-l2-prep-none", "do synthetic write", ownerId);
    expect(running.ok).toBe(true);
    if (!running.ok) return;

    expect(await store.listToolCalls("r-l2-prep-none")).toEqual([]);
    expect(sink.effectCount(resourceKey)).toBe(0);

    const missing = await engine.handle(
      cmd({
        commandType: "tool_dispatch_result",
        commandId: "accept-missing",
        runId: "r-l2-prep-none",
        expectedRevision: running.revision,
        leaseEpoch: running.leaseEpoch,
        payload: { toolCallId: "tc-does-not-exist", phase: "accepted" },
      }),
    );
    expect(missing.ok).toBe(false);
    expect(sink.effectCount(resourceKey)).toBe(0);

    // Positive control: prepare then invoke once → exactly one side effect.
    const turn = await engine.handle(
      cmd({
        commandType: "execute_turn",
        commandId: "turn-prep",
        runId: "r-l2-prep-none",
        expectedRevision: running.revision,
        leaseEpoch: running.leaseEpoch,
        actor: { principalId: ownerId },
      }),
    );
    expect(turn.ok).toBe(true);
    if (!turn.ok) return;

    const prepared = (await store.listToolCalls("r-l2-prep-none"))[0]!;
    expect(prepared.status).toBe("prepared");
    expect(sink.effectCount(resourceKey)).toBe(0);

    const accepted = await engine.handle(
      cmd({
        commandType: "tool_dispatch_result",
        commandId: "accept-real",
        runId: "r-l2-prep-none",
        expectedRevision: turn.revision,
        leaseEpoch: running.leaseEpoch,
        payload: { toolCallId: prepared.toolCallId, phase: "accepted" },
      }),
    );
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;

    const outcome = await invoker.invoke((await store.getToolCall(prepared.toolCallId))!);
    expect(outcome.ok).toBe(true);
    expect(sink.effectCount(resourceKey)).toBe(1);
  });
});
