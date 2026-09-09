import {
  CONTRACTS_SCHEMA_VERSION,
  type Action,
  type ApprovalRecord,
  type Continuation,
  type Run,
} from "@monai/contracts";
import { InMemoryLease } from "@monai/lease-memory";
import { InMemoryPersistence } from "@monai/persistence-memory";
import { describe, expect, it } from "vitest";

import { actionDigestMeta, computeActionDigest } from "../control/action-digest.js";
import { prepareToolCalls } from "../execution/prepare-tool-calls.js";
import { HookRunner } from "../hooks/hook-runner.js";
import { wireTestWorkspacePack } from "../test-helpers/wire-workspace-pack.js";
import { resumeApprovedToolCall } from "./wait-and-resume.js";

const baseRun: Run = {
  schemaVersion: CONTRACTS_SCHEMA_VERSION,
  runId: "r-resume",
  tenantId: "t1",
  sessionId: "s1",
  goal: "test",
  status: "running",
  revision: 1,
  leaseEpoch: 1,
  executionManifestRef: "manifest://m1",
  agentDefinitionId: "agent",
  agentVersion: "1",
  strategy: { type: "light", version: "1" },
  packVersions: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

describe("resumeApprovedToolCall empty prepare", () => {
  it("consumes approval and clears continuation without backfilling toolCallIds", async () => {
    const persistence = new InMemoryPersistence();
    const { registry } = wireTestWorkspacePack();
    const sharedIk = "ik-shared-stale";
    const args = { path: "/notes/a.md", content: "one" };

    const priorAction: Action = {
      schemaVersion: CONTRACTS_SCHEMA_VERSION,
      actionId: "act-old",
      type: "tool.call",
      calls: [
        {
          toolId: "workspace.write",
          arguments: args,
          idempotencyKey: sharedIk,
        },
      ],
    };

    const prepared = await prepareToolCalls({
      run: { ...baseRun, revision: 0 },
      stepId: "step-old",
      action: priorAction,
      correlationId: "c-seed",
      expectedRevision: 0,
      callIndices: [0],
      persistence,
      registry,
      eventBase: (run, partial) => ({
        schemaVersion: CONTRACTS_SCHEMA_VERSION,
        eventId: partial.eventId,
        eventType: partial.eventType,
        tenantId: run.tenantId,
        sessionId: run.sessionId,
        runId: run.runId,
        stepId: partial.stepId,
        toolCallId: partial.toolCallId,
        occurredAt: new Date().toISOString(),
        correlationId: partial.correlationId,
        producer: { type: "engine", id: "runtime" },
        hash: partial.eventId,
        expectedRevision: partial.expectedRevision,
        payload: partial.payload ?? {},
      }),
    });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;

    const action: Action = {
      schemaVersion: CONTRACTS_SCHEMA_VERSION,
      actionId: "act-new",
      type: "tool.call",
      calls: [
        {
          toolId: "workspace.write",
          arguments: args,
          idempotencyKey: sharedIk,
        },
      ],
    };
    const digest = computeActionDigest(action);
    const meta = actionDigestMeta();
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 60_000).toISOString();

    const approval: ApprovalRecord = {
      schemaVersion: CONTRACTS_SCHEMA_VERSION,
      approvalId: "appr-1",
      tenantId: "t1",
      sessionId: "s1",
      runId: baseRun.runId,
      stepId: "step-new",
      actionId: action.actionId,
      requestKind: "policy_required",
      actionDigest: digest,
      canonicalizationVersion: meta.canonicalizationVersion,
      actionSchemaVersion: meta.actionSchemaVersion,
      digestAlgorithm: meta.digestAlgorithm,
      riskLevel: "medium",
      evaluatedPolicyVersions: [],
      executionManifestRef: "manifest://m1",
      requestedAt: now,
      expiresAt,
      status: "approved",
      approver: {
        principalId: "u1",
        tenantId: "t1",
        decidedAt: now,
      },
      revision: 1,
      actionSnapshot: action,
      toolRef: { toolId: "workspace.write", version: "0.1.0" },
    };

    const continuation: Continuation = {
      schemaVersion: CONTRACTS_SCHEMA_VERSION,
      continuationId: "cth-1",
      tenantId: "t1",
      sessionId: "s1",
      runId: baseRun.runId,
      kind: "approval",
      stepId: "step-new",
      actionId: action.actionId,
      resumePhase: "awaiting_approval",
      approvalId: approval.approvalId,
      strategyCursorRef: "cursor://1",
      strategyCursorHash: "ch1",
      createdAt: now,
      hash: "cth:1",
      actionSnapshot: action,
    };

    const seed = await (await persistence.beginUnitOfWork(baseRun.runId)).commit({
      expectedRevision: 0,
      expectedLeaseEpoch: 0,
      runCreate: { ...baseRun, revision: 0 },
      events: [],
      toolCalls: prepared.toolCalls.map((t) => ({ ...t, status: "succeeded" as const })),
      idempotency: prepared.idempotency,
      approvals: [approval],
      continuation,
    });
    expect(seed.ok).toBe(true);

    const run = await persistence.getRun(baseRun.runId);
    expect(run).toBeDefined();

    const deps = {
      persistence,
      lease: new InMemoryLease(),
      hooks: new HookRunner(),
      registry,
      toolAllowlist: ["workspace.write"] as const,
      requireApprovalTools: ["workspace.write"] as const,
    };

    const result = await resumeApprovedToolCall(deps, {
      run: run!,
      ownerId: "owner-1",
      correlationId: "c-resume",
      commandExpectedRevision: run!.revision,
      commandLeaseEpoch: run!.leaseEpoch,
    });

    expect(result).not.toBeNull();
    expect(result?.ok).toBe(true);
    if (!result || !result.ok) return;

    const consumed = await persistence.getApproval(approval.approvalId);
    expect(consumed?.status).toBe("consumed");
    expect(consumed?.consumedByToolCallId).toBeUndefined();
    expect(consumed?.consumedByToolCallIds).toBeUndefined();

    expect(await persistence.getContinuation(baseRun.runId)).toBeUndefined();
    expect(result.revision).toBeGreaterThan(run!.revision);

    const again = await resumeApprovedToolCall(deps, {
      run: (await persistence.getRun(baseRun.runId))!,
      ownerId: "owner-1",
      correlationId: "c-resume-2",
      commandExpectedRevision: result.revision,
      commandLeaseEpoch: result.leaseEpoch,
    });
    expect(again).toBeNull();
  });
});
