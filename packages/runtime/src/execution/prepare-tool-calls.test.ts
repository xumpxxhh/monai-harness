import { CONTRACTS_SCHEMA_VERSION, type Action, type Run, type ToolCallRecord } from "@monai/contracts";
import { InMemoryPersistence } from "@monai/persistence-memory";
import { describe, expect, it } from "vitest";

import { inspectActionBatchSiblings, prepareToolCalls } from "./prepare-tool-calls.js";

const run: Run = {
  schemaVersion: CONTRACTS_SCHEMA_VERSION,
  runId: "r1",
  tenantId: "t1",
  sessionId: "s1",
  goal: "test",
  status: "running",
  revision: 3,
  leaseEpoch: 1,
  executionManifestRef: "manifest://m1",
  agentDefinitionId: "agent",
  agentVersion: "1",
  strategy: { type: "light", version: "1" },
  packVersions: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

function eventBase() {
  return () =>
    ({
      schemaVersion: CONTRACTS_SCHEMA_VERSION,
      eventId: "evt",
      eventType: "test",
      tenantId: "t1",
      sessionId: "s1",
      runId: "r1",
      occurredAt: new Date().toISOString(),
      correlationId: "c1",
      producer: { type: "engine" as const, id: "runtime" },
      hash: "evt",
      expectedRevision: 3,
      payload: {},
    }) as const;
}

describe("prepareToolCalls", () => {
  it("fans out one ToolCallRecord per allowed call index", async () => {
    const persistence = new InMemoryPersistence();
    const action: Action = {
      schemaVersion: CONTRACTS_SCHEMA_VERSION,
      actionId: "act-batch",
      type: "tool.call",
      calls: [
        { toolId: "echo", arguments: { text: "a" } },
        { toolId: "echo", arguments: { text: "b" } },
      ],
    };

    const result = await prepareToolCalls({
      run,
      stepId: "step-1",
      action,
      correlationId: "c1",
      expectedRevision: 3,
      callIndices: [0, 1],
      persistence,
      eventBase: eventBase(),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.toolCalls).toHaveLength(2);
    expect(result.toolCalls.map((t) => t.toolCallId)).toEqual([
      "tc-r1-act-batch-0",
      "tc-r1-act-batch-1",
    ]);
    expect(result.outbox).toHaveLength(2);
  });

  it("blocks blind retry when outcome_unknown exists for the tool", async () => {
    const persistence = new InMemoryPersistence();
    const unknown: ToolCallRecord = {
      schemaVersion: CONTRACTS_SCHEMA_VERSION,
      toolCallId: "tc-unknown",
      tenantId: "t1",
      sessionId: "s1",
      runId: "r1",
      stepId: "step-0",
      actionId: "act-prev",
      toolId: "synthetic.write_high",
      toolVersion: "0.1.0",
      executionManifestRef: "manifest://m1",
      inputHash: "ih",
      arguments: {},
      idempotencyKey: "ik-same",
      idempotencyScope: "run",
      deliverySemantics: "at_least_once",
      sideEffectProfile: "write",
      status: "outcome_unknown",
      attempt: 1,
      preparedAt: new Date().toISOString(),
      dispatchLeaseEpoch: 1,
      revision: 1,
      reconcileSupported: true,
    };
    const uow = await persistence.beginUnitOfWork("r1");
    const seeded = await uow.commit({
      expectedRevision: 0,
      expectedLeaseEpoch: 0,
      runCreate: run,
      events: [],
      toolCalls: [unknown],
    });
    expect(seeded.ok).toBe(true);

    const action: Action = {
      schemaVersion: CONTRACTS_SCHEMA_VERSION,
      actionId: "act-retry",
      type: "tool.call",
      calls: [
        {
          toolId: "synthetic.write_high",
          arguments: { resourceKey: "synthetic://demo/resource" },
          idempotencyKey: "ik-same",
        },
      ],
    };

    const result = await prepareToolCalls({
      run,
      stepId: "step-2",
      action,
      correlationId: "c1",
      expectedRevision: 3,
      callIndices: [0],
      persistence,
      eventBase: eventBase(),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toMatch(/blind-retry|reconcile_tool/);
  });
});

describe("inspectActionBatchSiblings", () => {
  it("waits until all prepared siblings are terminal", () => {
    const siblings: ToolCallRecord[] = [
      {
        schemaVersion: CONTRACTS_SCHEMA_VERSION,
        toolCallId: "tc-0",
        tenantId: "t1",
        sessionId: "s1",
        runId: "r1",
        stepId: "step-1",
        actionId: "act-1",
        toolId: "echo",
        toolVersion: "0.1.0",
        executionManifestRef: "manifest://m1",
        inputHash: "ih",
        status: "succeeded",
        attempt: 1,
        preparedAt: new Date().toISOString(),
        dispatchLeaseEpoch: 1,
        revision: 1,
        deliverySemantics: "at_least_once",
        sideEffectProfile: "none",
        reconcileSupported: false,
      },
      {
        schemaVersion: CONTRACTS_SCHEMA_VERSION,
        toolCallId: "tc-1",
        tenantId: "t1",
        sessionId: "s1",
        runId: "r1",
        stepId: "step-1",
        actionId: "act-1",
        toolId: "echo",
        toolVersion: "0.1.0",
        executionManifestRef: "manifest://m1",
        inputHash: "ih2",
        status: "dispatched",
        attempt: 1,
        preparedAt: new Date().toISOString(),
        dispatchLeaseEpoch: 1,
        revision: 1,
        deliverySemantics: "at_least_once",
        sideEffectProfile: "none",
        reconcileSupported: false,
      },
    ];

    const open = inspectActionBatchSiblings(siblings, "act-1");
    expect(open.stepShouldComplete).toBe(false);
    expect(open.anyUnresolved).toBe(true);

    siblings[1]!.status = "succeeded";
    const done = inspectActionBatchSiblings(siblings, "act-1");
    expect(done.stepShouldComplete).toBe(true);
    expect(done.anyUnresolved).toBe(false);
  });
});
