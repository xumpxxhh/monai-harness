import {
  CONTRACTS_SCHEMA_VERSION,
  type Action,
  type ApprovalRecord,
  type Checkpoint,
  type Continuation,
  type EventCandidate,
  type Run,
  type RunState,
} from "@monai/contracts";
import type { CommitPlan, LeasePort, PersistencePort, IdempotencyPort } from "@monai/ports";

import { applyCommit } from "../commit/apply-commit.js";
import { actionDigestMeta, computeActionDigest } from "../control/action-digest.js";
import { computeStateHash } from "../recovery/state-hash.js";
import { prepareToolCalls } from "../execution/prepare-tool-calls.js";
import { normalizeToolCallAction, getToolCallInvocations } from "../model/normalize-action.js";
import type { ExtensionRegistry } from "../extension/extension-registry.js";
import type { HookRunner } from "../hooks/hook-runner.js";
import {
  DEFAULT_REQUIRE_APPROVAL_TOOLS,
  DEFAULT_TOOL_ALLOWLIST,
  evaluatePolicy,
} from "../policy/evaluate-policy.js";
import type { HandleResult } from "./types.js";

function eventBase(
  run: Pick<Run, "tenantId" | "sessionId" | "runId">,
  args: {
    eventId: string;
    eventType: string;
    expectedRevision: number;
    correlationId: string;
    stepId?: string;
    toolCallId?: string;
    approvalId?: string;
    payload?: unknown;
  },
): EventCandidate {
  return {
    schemaVersion: CONTRACTS_SCHEMA_VERSION,
    eventId: args.eventId,
    eventType: args.eventType,
    tenantId: run.tenantId,
    sessionId: run.sessionId,
    runId: run.runId,
    stepId: args.stepId,
    toolCallId: args.toolCallId,
    approvalId: args.approvalId,
    occurredAt: new Date().toISOString(),
    correlationId: args.correlationId,
    producer: { type: "engine", id: "runtime" },
    hash: args.eventId,
    expectedRevision: args.expectedRevision,
    payload: args.payload ?? {},
  };
}

function stable(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value ?? null);
}

export function buildApprovalWaitArtifacts(args: {
  run: Run;
  stepId: string;
  action: Action;
  policyVersion: string;
  policyReason: string;
  state: RunState | undefined;
  ttlMs?: number;
}): {
  approval: ApprovalRecord;
  checkpoint: Checkpoint;
  continuation: Continuation;
} {
  const now = new Date().toISOString();
  const ttlMs = args.ttlMs ?? 3_600_000;
  const digest = computeActionDigest(args.action);
  const meta = actionDigestMeta();
  const approvalId = `apr-${args.run.runId}-${args.action.actionId}`;
  const continuationId = `cont-${args.run.runId}-${args.action.actionId}`;
  const cursorRef = `cursor:${args.run.runId}:${args.stepId}`;
  const cursorHash = `ch:${args.stepId}`;

  const approval: ApprovalRecord = {
    schemaVersion: CONTRACTS_SCHEMA_VERSION,
    approvalId,
    tenantId: args.run.tenantId,
    sessionId: args.run.sessionId,
    runId: args.run.runId,
    stepId: args.stepId,
    actionId: args.action.actionId,
    requestKind: "policy_required",
    actionDigest: digest,
    ...meta,
    resourceScope: args.action.resourceScope,
    toolRef: args.action.toolId
      ? { toolId: args.action.toolId, version: "0.1.0" }
      : undefined,
    riskLevel: "high",
    evaluatedPolicyVersions: [
      {
        policyId: "policy.stub",
        version: args.policyVersion,
        digest: `pd:${args.policyVersion}`,
      },
    ],
    executionManifestRef: args.run.executionManifestRef,
    requestedAt: now,
    expiresAt: new Date(Date.now() + ttlMs).toISOString(),
    status: "pending",
    revision: 0,
    actionSnapshot: args.action,
  };

  const continuation: Continuation = {
    schemaVersion: CONTRACTS_SCHEMA_VERSION,
    continuationId,
    tenantId: args.run.tenantId,
    sessionId: args.run.sessionId,
    runId: args.run.runId,
    kind: "approval",
    stepId: args.stepId,
    actionId: args.action.actionId,
    resumePhase: "gating_after_approval",
    approvalId,
    strategyCursorRef: cursorRef,
    strategyCursorHash: cursorHash,
    createdAt: now,
    hash: `cth:${continuationId}`,
    actionSnapshot: args.action,
  };

  const checkpoint: Checkpoint = {
    schemaVersion: CONTRACTS_SCHEMA_VERSION,
    checkpointId: `cp-${args.run.runId}-${args.stepId}`,
    runId: args.run.runId,
    executionManifestRef: args.run.executionManifestRef,
    revision: 0,
    sequence: 0,
    stateRef: `state:${args.run.runId}`,
    stateHash: computeStateHash(args.state),
    strategy: {
      type: args.run.strategy.type,
      version: args.run.strategy.version,
      cursorRef,
      cursorHash,
    },
    activeStepRef: args.stepId,
    continuationRef: continuationId,
    createdAt: now,
    hash: `cph:${args.stepId}`,
  };

  return { approval, checkpoint, continuation };
}

export function buildInputWaitArtifacts(args: {
  run: Run;
  stepId: string;
  action: Action;
  state: RunState | undefined;
  deadlineMs?: number;
}): {
  checkpoint: Checkpoint;
  continuation: Continuation;
} {
  const now = new Date().toISOString();
  const continuationId = `cont-input-${args.run.runId}-${args.action.actionId}`;
  const cursorRef = `cursor:${args.run.runId}:${args.stepId}`;
  const cursorHash = `ch:${args.stepId}`;
  const deadline = new Date(Date.now() + (args.deadlineMs ?? 3_600_000)).toISOString();

  const continuation: Continuation = {
    schemaVersion: CONTRACTS_SCHEMA_VERSION,
    continuationId,
    tenantId: args.run.tenantId,
    sessionId: args.run.sessionId,
    runId: args.run.runId,
    kind: "input",
    stepId: args.stepId,
    actionId: args.action.actionId,
    resumePhase: "awaiting_input",
    inputSchemaRef: "schema://ask_user/text",
    deadline,
    strategyCursorRef: cursorRef,
    strategyCursorHash: cursorHash,
    createdAt: now,
    hash: `cth:${continuationId}`,
    actionSnapshot: args.action,
    inputPrompt:
      typeof args.action.arguments === "object" &&
      args.action.arguments &&
      "prompt" in (args.action.arguments as object)
        ? String((args.action.arguments as { prompt?: unknown }).prompt ?? "input required")
        : "input required",
  };

  const checkpoint: Checkpoint = {
    schemaVersion: CONTRACTS_SCHEMA_VERSION,
    checkpointId: `cp-${args.run.runId}-${args.stepId}`,
    runId: args.run.runId,
    executionManifestRef: args.run.executionManifestRef,
    revision: 0,
    sequence: 0,
    stateRef: `state:${args.run.runId}`,
    stateHash: computeStateHash(args.state),
    strategy: {
      type: args.run.strategy.type,
      version: args.run.strategy.version,
      cursorRef,
      cursorHash,
    },
    activeStepRef: args.stepId,
    continuationRef: continuationId,
    createdAt: now,
    hash: `cph:${args.stepId}`,
  };

  return { checkpoint, continuation };
}

export type ResumeDeps = {
  persistence: PersistencePort & Partial<IdempotencyPort>;
  lease: LeasePort;
  hooks: HookRunner;
  toolAllowlist?: readonly string[];
  requireApprovalTools?: readonly string[];
  registry?: ExtensionRegistry;
};

/**
 * After approval → queued → acquire_lease → running:
 * re-check Policy + PreToolCall, then consume Approval + prepare Tool in one UoW.
 */
export async function resumeApprovedToolCall(
  deps: ResumeDeps,
  args: {
    run: Run;
    ownerId: string;
    correlationId: string;
    commandExpectedRevision: number;
    commandLeaseEpoch: number;
  },
): Promise<HandleResult | null> {
  const { run } = args;
  const continuation = await deps.persistence.getContinuation(run.runId);
  if (!continuation || continuation.kind !== "approval" || !continuation.approvalId) {
    return null;
  }

  const approval = await deps.persistence.getApproval(continuation.approvalId);
  if (!approval || approval.status !== "approved") {
    return null;
  }

  const action = normalizeToolCallAction(
    (continuation.actionSnapshot ?? approval.actionSnapshot) as Action,
  );
  if (!action || action.type !== "tool.call" || getToolCallInvocations(action).length === 0) {
    return {
      ok: false,
      code: "validation",
      message: "approved continuation missing tool.call action",
    };
  }

  const digest = computeActionDigest(action);
  if (digest !== approval.actionDigest) {
    return { ok: false, code: "validation", message: "actionDigest mismatch on resume" };
  }
  if (Date.parse(approval.expiresAt) <= Date.now()) {
    return { ok: false, code: "validation", message: "approval expired on resume" };
  }

  const toolAllowlist = deps.toolAllowlist ?? DEFAULT_TOOL_ALLOWLIST;
  const requireApprovalTools = deps.requireApprovalTools ?? DEFAULT_REQUIRE_APPROVAL_TOOLS;
  const policy = evaluatePolicy({ action, toolAllowlist, requireApprovalTools });
  if (policy.decision === "deny" || policy.actionDecision === "all_deny") {
    return {
      ok: false,
      code: "validation",
      message: `policy deny on resume: ${policy.reason}`,
    };
  }

  const stepId = continuation.stepId;
  const rev = run.revision;
  const preTool = await deps.hooks.invoke("PreToolCall", {
    tenantId: run.tenantId,
    sessionId: run.sessionId,
    runId: run.runId,
    stepId,
    context: { goal: run.goal },
    action,
  });

  if (preTool.failed || preTool.vetoed) {
    // PreToolCall veto must NOT consume ApprovalRecord
    return {
      ok: false,
      code: "validation",
      message: preTool.failureReason ?? preTool.vetoReason ?? "PreToolCall veto on resume",
    };
  }

  // Approval already granted — prepare every non-denied invocation (require_approval is satisfied).
  const invocations = getToolCallInvocations(action);
  const allowedIndices = invocations
    .map((_, index) => index)
    .filter((index) => {
      const result = policy.callResults?.find((r) => r.callIndex === index);
      return result?.decision !== "deny";
    });
  const prepared = await prepareToolCalls({
    run,
    stepId,
    action,
    correlationId: args.correlationId,
    expectedRevision: rev,
    callIndices: allowedIndices,
    persistence: deps.persistence,
    registry: deps.registry,
    eventBase,
  });

  if (!prepared.ok) {
    return { ok: false, code: prepared.code, message: prepared.message };
  }
  if (prepared.toolCalls.length === 0) {
    const saved = await deps.persistence.getRun(run.runId);
    if (!saved) return { ok: false, code: "fatal", message: "run missing" };
    return {
      ok: true,
      run: saved,
      revision: saved.revision,
      leaseEpoch: saved.leaseEpoch,
      idempotent: true,
    };
  }

  const now = new Date().toISOString();
  const toolCallIds = prepared.toolCalls.map((t) => t.toolCallId);

  const consumed: ApprovalRecord = {
    ...approval,
    status: "consumed",
    consumedAt: now,
    consumedByToolCallId: toolCallIds[0],
    consumedByToolCallIds: toolCallIds,
    revision: approval.revision + 1,
  };

  const events: EventCandidate[] = [
    eventBase(run, {
      eventId: `evt-policy-resume-${stepId}`,
      eventType: "policy.evaluated",
      expectedRevision: rev,
      correlationId: args.correlationId,
      stepId,
      payload: {
        decision: policy.decision,
        policyVersion: policy.policyVersion,
        reason: policy.reason,
        actionDecision: policy.actionDecision,
        callResults: policy.callResults,
        resume: true,
      },
    }),
    eventBase(run, {
      eventId: `evt-action-acc-${stepId}`,
      eventType: "action.accepted",
      expectedRevision: rev,
      correlationId: args.correlationId,
      stepId,
      payload: { actionId: action.actionId },
    }),
    eventBase(run, {
      eventId: `evt-hook-inv-PreToolCall-${stepId}`,
      eventType: "hook.invoked",
      expectedRevision: rev,
      correlationId: args.correlationId,
      stepId,
      payload: { hookPoint: "PreToolCall", resume: true },
    }),
    eventBase(run, {
      eventId: `evt-approval-consumed-${approval.approvalId}`,
      eventType: "approval.consumed",
      expectedRevision: rev,
      correlationId: args.correlationId,
      stepId,
      approvalId: approval.approvalId,
      toolCallId: toolCallIds[0],
      payload: { toolCallIds },
    }),
    ...prepared.events,
  ];

  const plan: CommitPlan = {
    expectedRevision: args.commandExpectedRevision,
    expectedLeaseEpoch: args.commandLeaseEpoch,
    events,
    toolCalls: prepared.toolCalls,
    approvals: [consumed],
    outbox: prepared.outbox,
    idempotency: prepared.idempotency.length > 0 ? prepared.idempotency : undefined,
    clearContinuation: true,
  };

  const uow = await deps.persistence.beginUnitOfWork(run.runId);
  const result = await applyCommit(uow, plan);
  if (!result.ok) {
    return { ok: false, code: result.code, message: result.message };
  }
  const saved = await deps.persistence.getRun(run.runId);
  if (!saved) {
    return { ok: false, code: "fatal", message: "run missing after resume prepare" };
  }
  return {
    ok: true,
    run: saved,
    revision: result.revision,
    leaseEpoch: result.leaseEpoch,
  };
}

export async function resumeAfterInput(
  deps: ResumeDeps,
  args: {
    run: Run;
    correlationId: string;
    commandExpectedRevision: number;
    commandLeaseEpoch: number;
  },
): Promise<HandleResult | null> {
  const { run } = args;
  const continuation = await deps.persistence.getContinuation(run.runId);
  if (!continuation || continuation.kind !== "input") {
    return null;
  }

  const events = await deps.persistence.listEvents(run.runId);
  const lastObs = [...events].reverse().find((e) => e.eventType === "observation.recorded");
  if (!lastObs) {
    return null;
  }

  const observation = (lastObs.payload as { observation?: { observationId?: string; data?: unknown } })
    ?.observation;
  const observationId = observation?.observationId ?? lastObs.eventId;
  const summary =
    typeof observation?.data === "object" &&
    observation?.data &&
    "value" in (observation.data as object)
      ? String((observation.data as { value: unknown }).value)
      : "user input";

  const now = new Date().toISOString();
  const factId = `fact-input-${observationId}`;
  const state = (await deps.persistence.getState(run.runId)) ?? {
    schemaVersion: CONTRACTS_SCHEMA_VERSION,
    facts: [],
    cursor: { stepCount: 0 },
  };
  const nextState: RunState = {
    ...state,
    facts: [
      ...state.facts,
      {
        factId,
        factType: "user.input",
        summary,
        data: observation?.data,
      },
    ],
    lastFactId: factId,
    cursor: { stepCount: state.cursor.stepCount + 1 },
  };

  const stepId = continuation.stepId;
  const rev = args.commandExpectedRevision;
  const uow = await deps.persistence.beginUnitOfWork(run.runId);
  const result = await applyCommit(uow, {
    expectedRevision: rev,
    expectedLeaseEpoch: args.commandLeaseEpoch,
    clearContinuation: true,
    state: nextState,
    stateHash: computeStateHash(nextState),
    events: [
      eventBase(run, {
        eventId: `evt-fact-input-${observationId}`,
        eventType: "fact.accepted",
        expectedRevision: rev,
        correlationId: args.correlationId,
        stepId,
        payload: { factId, observationId },
      }),
      eventBase(run, {
        eventId: `evt-state-${observationId}`,
        eventType: "state.reduced",
        expectedRevision: rev,
        correlationId: args.correlationId,
        stepId,
        payload: { factId },
      }),
      eventBase(run, {
        eventId: `evt-step-ok-${stepId}`,
        eventType: "step.completed",
        expectedRevision: rev,
        correlationId: args.correlationId,
        stepId,
      }),
    ],
  });

  if (!result.ok) {
    return { ok: false, code: result.code, message: result.message };
  }
  const saved = await deps.persistence.getRun(run.runId);
  if (!saved) {
    return { ok: false, code: "fatal", message: "run missing after input resume" };
  }
  return {
    ok: true,
    run: saved,
    revision: result.revision,
    leaseEpoch: result.leaseEpoch,
  };
}
