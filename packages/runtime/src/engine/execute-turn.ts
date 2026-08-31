import {
  CONTRACTS_SCHEMA_VERSION,
  PRICE_TABLE_STATIC_VERSION,
  actionSchema,
  createEmptyRunState,
  type AcceptanceCheck,
  type Action,
  type ApprovalRecord,
  type Checkpoint,
  type Continuation,
  type EventCandidate,
  type IdempotencyRecord,
  type ModelPolicy,
  type ModelUsage,
  type OutboxRecord,
  type Run,
  type RunState,
  type ToolCallRecord,
} from "@monai/contracts";
import type { IdempotencyPort, ModelPort, PersistencePort, LeasePort, HarnessCommand } from "@monai/ports";

import { buildContext } from "../context/build-context.js";
import { checkRunBudget } from "../control/budget-guard.js";
import { projectActionForUser } from "../control/project-action.js";
import type { HookRunner } from "../hooks/hook-runner.js";
import type { PreviewHub } from "../preview/preview-hub.js";
import {
  DEFAULT_REQUIRE_APPROVAL_TOOLS,
  DEFAULT_TOOL_ALLOWLIST,
  evaluatePolicy,
  type PolicyEvaluation,
} from "../policy/evaluate-policy.js";
import { applyCommit } from "../commit/apply-commit.js";
import {
  evaluateAcceptanceChecks,
  requiredAcceptanceChecksPassed,
} from "../control/acceptance-checks.js";
import { lookupToolContract, requiresIdempotencyKey } from "../execution/lookup-tool-contract.js";
import type { ExtensionRegistry } from "../extension/extension-registry.js";
import {
  buildApprovalWaitArtifacts,
  buildInputWaitArtifacts,
  resumeAfterInput,
  resumeApprovedToolCall,
} from "./wait-and-resume.js";
import { assertCommandTenant } from "./tenant-guard.js";
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

function inputHash(action: Action): string {
  return `ih:${action.toolId}:${action.idempotencyKey ?? ""}:${stable(action.arguments)}`;
}

function stable(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value ?? null);
}

export type ExecuteTurnDeps = {
  persistence: PersistencePort & Partial<IdempotencyPort>;
  lease: LeasePort;
  model: ModelPort;
  hooks: HookRunner;
  toolAllowlist?: readonly string[];
  requireApprovalTools?: readonly string[];
  acceptanceChecks?: readonly AcceptanceCheck[];
  registry?: ExtensionRegistry;
  modelPolicy?: ModelPolicy;
  /** Optional in-process preview fan-out (token UX; not Event Log). */
  previewHub?: PreviewHub;
};

/**
 * Light-loop execute_turn: Hook → Context → Model → Policy →
 * (tool.call → PreToolCall → prepared+outbox | noop/finish).
 * Model/Hook IO happen BEFORE open UoW (EDR-003).
 */
export async function handleExecuteTurn(
  deps: ExecuteTurnDeps,
  command: HarnessCommand,
): Promise<HandleResult> {
  const runId = command.runId;
  if (!runId) {
    return { ok: false, code: "validation", message: "execute_turn requires runId" };
  }
  if (command.expectedRevision === undefined) {
    return { ok: false, code: "validation", message: "execute_turn requires expectedRevision" };
  }
  if (command.leaseEpoch === undefined) {
    return { ok: false, code: "validation", message: "execute_turn requires leaseEpoch" };
  }

  const ownerId = command.actor?.principalId ?? "worker";
  const run = await deps.persistence.getRun(runId);
  if (!run) {
    return { ok: false, code: "fatal", message: "run not found" };
  }
  const tenantFailure = assertCommandTenant(run, command);
  if (tenantFailure) return tenantFailure;

  if (run.status !== "running") {
    return {
      ok: false,
      code: "validation",
      message: `execute_turn invalid status: ${run.status}`,
    };
  }

  if (run.revision !== command.expectedRevision) {
    return { ok: false, code: "conflict", message: "expectedRevision mismatch" };
  }
  if (run.leaseEpoch !== command.leaseEpoch) {
    return { ok: false, code: "lease_lost", message: "leaseEpoch mismatch" };
  }

  const leaseOk = await deps.lease.validate(runId, ownerId, run.leaseEpoch);
  if (!leaseOk) {
    return { ok: false, code: "lease_lost", message: "lease invalid or expired" };
  }

  const correlationId = command.correlationId ?? command.commandId;

  const resumedApproval = await resumeApprovedToolCall(deps, {
    run,
    ownerId,
    correlationId,
    commandExpectedRevision: run.revision,
    commandLeaseEpoch: run.leaseEpoch,
  });
  if (resumedApproval) {
    return resumedApproval;
  }

  const resumedInput = await resumeAfterInput(deps, {
    run,
    correlationId,
    commandExpectedRevision: run.revision,
    commandLeaseEpoch: run.leaseEpoch,
  });
  if (resumedInput) {
    return resumedInput;
  }

  const state = (await deps.persistence.getState(runId)) ?? createEmptyRunState();
  const stepId = `step-${run.runId}-${run.revision + 1}`;
  const toolAllowlist = deps.toolAllowlist ?? DEFAULT_TOOL_ALLOWLIST;
  const requireApprovalTools = deps.requireApprovalTools ?? DEFAULT_REQUIRE_APPROVAL_TOOLS;
  const rev = run.revision;

  // 1. Budget check before calling model (design 03 §4.3 / §5.1)
  const budgetCheck = checkRunBudget(run, state);
  if (budgetCheck.exceeded) {
    return commitStepFailed(deps, run, {
      stepId,
      correlationId,
      expectedRevision: rev,
      expectedLeaseEpoch: run.leaseEpoch,
      reason: budgetCheck.reason,
      prefixEvents: [],
    });
  }

  const pre = await deps.hooks.invoke("PreReasoning", {
    tenantId: run.tenantId,
    sessionId: run.sessionId,
    runId: run.runId,
    stepId,
    context: { goal: run.goal, state },
  });

  if (pre.failed || pre.vetoed) {
    return commitStepFailed(deps, run, {
      stepId,
      correlationId,
      expectedRevision: rev,
      expectedLeaseEpoch: run.leaseEpoch,
      reason: pre.failureReason ?? pre.vetoReason ?? "PreReasoning failed",
      prefixEvents: hookEvents(run, stepId, rev, correlationId, "PreReasoning", pre),
    });
  }

  // 2. Context Builder with priority & budget (design 05 §3)
  const resolvedModelPolicy: ModelPolicy = deps.modelPolicy ?? {
    version: "1.0.0",
    resolvedTarget: "stub",
    digest: "digest:model-policy:default",
  };

  const buildResult = buildContext({
    run,
    stepId,
    state,
    toolAllowlist,
    hookContributions: pre.merged.contextContributions,
    modelPolicy: resolvedModelPolicy,
  });

  if (buildResult.overflow) {
    return commitStepFailed(deps, run, {
      stepId,
      correlationId,
      expectedRevision: rev,
      expectedLeaseEpoch: run.leaseEpoch,
      reason: buildResult.overflowReason ?? "Context budget hardMaxTokens overflow",
      prefixEvents: [...hookEvents(run, stepId, rev, correlationId, "PreReasoning", pre)],
    });
  }

  const context = buildResult.context;
  const contextEvent = eventBase(run, {
    eventId: `evt-ctx-${stepId}`,
    eventType: "context.built",
    expectedRevision: rev,
    correlationId,
    stepId,
    payload: {
      record: buildResult.record,
      contextHash: buildResult.contextHash,
      totalTokens: buildResult.totalTokens,
      truncations: buildResult.truncations,
    },
  });

  // 3. Model Policy targets loop (support fallback and attempts)
  const targetsToTry: string[] = [resolvedModelPolicy.resolvedTarget];
  if (
    resolvedModelPolicy.fallbackTarget &&
    resolvedModelPolicy.fallbackTarget !== resolvedModelPolicy.resolvedTarget
  ) {
    targetsToTry.push(resolvedModelPolicy.fallbackTarget);
  }

  let attempt = 0;
  let parsedAction: Action | undefined;
  let lastModelError: string | undefined;
  const modelEvents: EventCandidate[] = [];

  for (const target of targetsToTry) {
    attempt++;
    const modelCallId = `mc-${stepId}-${attempt}`;
    const startCallTime = Date.now();

    modelEvents.push(
      eventBase(run, {
        eventId: `evt-model-call-${stepId}-${attempt}`,
        eventType: "model.called",
        expectedRevision: rev,
        correlationId,
        stepId,
        payload: {
          modelCallId,
          stepId,
          attempt,
          target,
          modelPolicyVersion: resolvedModelPolicy.version,
          priceTableVersion: PRICE_TABLE_STATIC_VERSION,
          contextHash: buildResult.contextHash,
        },
      }),
    );

    let modelResult: unknown;
    let callFailed = false;
    let modelReasoning: string | undefined;
    let modelDisplay: string | undefined;

    deps.previewHub?.publish({
      type: "preview_start",
      runId: run.runId,
      stepId,
      modelCallId,
    });

    try {
      const modelInput = {
        context,
        schema: { type: "Action" },
        modelPolicy: {
          ...resolvedModelPolicy,
          resolvedTarget: target,
        },
      };

      if (typeof deps.model.completeStructuredStream === "function") {
        for await (const chunk of deps.model.completeStructuredStream(modelInput)) {
          if (chunk.kind === "delta") {
            deps.previewHub?.publish({
              type: "delta",
              runId: run.runId,
              stepId,
              modelCallId,
              channel: chunk.channel,
              text: chunk.text,
            });
            if (chunk.channel === "reasoning") {
              modelReasoning = (modelReasoning ?? "") + chunk.text;
            }
          } else if (chunk.kind === "done") {
            modelResult = chunk.result;
            if (chunk.result.reasoning) {
              modelReasoning = chunk.result.reasoning;
            }
          }
        }
      } else {
        modelResult = await deps.model.completeStructured(modelInput);
      }
    } catch (err) {
      callFailed = true;
      lastModelError = err instanceof Error ? err.message : "model call failed";
      deps.previewHub?.publish({
        type: "preview_invalid",
        runId: run.runId,
        stepId,
        modelCallId,
        reason: lastModelError,
      });
    }

    const latencyMs = Date.now() - startCallTime;

    let candidateAction: unknown = modelResult;
    let usage: ModelUsage = {
      inputTokens: buildResult.totalTokens,
      outputTokens: 30,
      totalTokens: buildResult.totalTokens + 30,
    };

    if (
      modelResult &&
      typeof modelResult === "object" &&
      "rawAction" in (modelResult as Record<string, unknown>)
    ) {
      const wrapped = modelResult as {
        rawAction: unknown;
        usage?: ModelUsage;
        reasoning?: string;
      };
      candidateAction = wrapped.rawAction;
      if (wrapped.usage) {
        usage = wrapped.usage;
      }
      if (wrapped.reasoning) {
        modelReasoning = wrapped.reasoning;
      }
    }

    const preParse = !callFailed ? actionSchema.safeParse(candidateAction) : null;
    if (preParse?.success) {
      modelDisplay = projectActionForUser(preParse.data);
    }

    modelEvents.push(
      eventBase(run, {
        eventId: `evt-model-resp-${stepId}-${attempt}`,
        eventType: "model.responded",
        expectedRevision: rev,
        correlationId,
        stepId,
        payload: {
          modelCallId,
          stepId,
          attempt,
          target,
          usage,
          priceTableVersion: PRICE_TABLE_STATIC_VERSION,
          latencyMs,
          failed: callFailed,
          ...(modelReasoning ? { reasoning: modelReasoning } : {}),
          ...(modelDisplay ? { display: modelDisplay } : {}),
        },
      }),
    );

    if (callFailed) {
      continue;
    }

    const parsed = preParse ?? actionSchema.safeParse(candidateAction);
    if (!parsed.success) {
      lastModelError = `invalid Action: ${parsed.error.message}`;
      deps.previewHub?.publish({
        type: "preview_invalid",
        runId: run.runId,
        stepId,
        modelCallId,
        reason: lastModelError,
      });
      continue;
    }

    parsedAction = parsed.data;
    deps.previewHub?.publish({
      type: "preview_committed",
      runId: run.runId,
      stepId,
      modelCallId,
      display: modelDisplay ?? projectActionForUser(parsedAction),
    });
    break;
  }

  if (!parsedAction) {
    return commitStepFailed(deps, run, {
      stepId,
      correlationId,
      expectedRevision: rev,
      expectedLeaseEpoch: run.leaseEpoch,
      reason: lastModelError ?? "all model targets failed",
      prefixEvents: [
        ...hookEvents(run, stepId, rev, correlationId, "PreReasoning", pre),
        contextEvent,
        ...modelEvents,
      ],
    });
  }

  const action: Action = parsedAction;

  const post = await deps.hooks.invoke("PostReasoning", {
    tenantId: run.tenantId,
    sessionId: run.sessionId,
    runId: run.runId,
    stepId,
    context,
    action,
  });

  if (post.failed || post.vetoed) {
    return commitStepFailed(deps, run, {
      stepId,
      correlationId,
      expectedRevision: rev,
      expectedLeaseEpoch: run.leaseEpoch,
      reason: post.failureReason ?? post.vetoReason ?? "PostReasoning failed",
      prefixEvents: [
        ...hookEvents(run, stepId, rev, correlationId, "PreReasoning", pre),
        contextEvent,
        ...modelEvents,
        eventBase(run, {
          eventId: `evt-action-prop-${stepId}`,
          eventType: "action.proposed",
          expectedRevision: rev,
          correlationId,
          stepId,
          payload: { action },
        }),
        ...hookEvents(run, stepId, rev, correlationId, "PostReasoning", post),
      ],
    });
  }

  const policy = evaluatePolicy({
    action,
    toolAllowlist,
    requireApprovalTools,
  });

  let preToolEvents: EventCandidate[] = [];
  if (policy.decision === "allow" && action.type === "tool.call") {
    const preTool = await deps.hooks.invoke("PreToolCall", {
      tenantId: run.tenantId,
      sessionId: run.sessionId,
      runId: run.runId,
      stepId,
      context,
      action,
    });
    preToolEvents = hookEvents(run, stepId, rev, correlationId, "PreToolCall", preTool);
    if (preTool.failed || preTool.vetoed) {
      return commitStepFailed(deps, run, {
        stepId,
        correlationId,
        expectedRevision: rev,
        expectedLeaseEpoch: run.leaseEpoch,
        reason: preTool.failureReason ?? preTool.vetoReason ?? "PreToolCall veto",
        prefixEvents: [
          ...hookEvents(run, stepId, rev, correlationId, "PreReasoning", pre),
          contextEvent,
          ...modelEvents,
          eventBase(run, {
            eventId: `evt-action-prop-${stepId}`,
            eventType: "action.proposed",
            expectedRevision: rev,
            correlationId,
            stepId,
            payload: { action },
          }),
          ...hookEvents(run, stepId, rev, correlationId, "PostReasoning", post),
          eventBase(run, {
            eventId: `evt-policy-${stepId}`,
            eventType: "policy.evaluated",
            expectedRevision: rev,
            correlationId,
            stepId,
            payload: {
              decision: policy.decision,
              policyVersion: policy.policyVersion,
              reason: policy.reason,
              inputSummary: policy.inputSummary,
            },
          }),
          eventBase(run, {
            eventId: `evt-action-acc-${stepId}`,
            eventType: "action.accepted",
            expectedRevision: rev,
            correlationId,
            stepId,
            payload: { actionId: action.actionId },
          }),
          ...preToolEvents,
        ],
      });
    }
  }

  return commitTurn(deps, run, {
    stepId,
    correlationId,
    expectedRevision: rev,
    expectedLeaseEpoch: run.leaseEpoch,
    ownerId,
    action,
    policy,
    state,
    preEvents: hookEvents(run, stepId, rev, correlationId, "PreReasoning", pre),
    postEvents: hookEvents(run, stepId, rev, correlationId, "PostReasoning", post),
    preToolEvents,
    contextEvent,
    modelEvents,
  });
}

function hookEvents(
  run: Run,
  stepId: string,
  expectedRevision: number,
  correlationId: string,
  hookPoint: string,
  result: {
    invocations: Array<{
      handlerId: string;
      result: { veto?: boolean; failed?: boolean; contextContributions?: unknown[] };
    }>;
    vetoed: boolean;
    failed: boolean;
  },
): EventCandidate[] {
  const events: EventCandidate[] = [
    eventBase(run, {
      eventId: `evt-hook-inv-${hookPoint}-${stepId}`,
      eventType: "hook.invoked",
      expectedRevision,
      correlationId,
      stepId,
      payload: { hookPoint, handlers: result.invocations.map((i) => i.handlerId) },
    }),
  ];
  if (result.failed) {
    events.push(
      eventBase(run, {
        eventId: `evt-hook-fail-${hookPoint}-${stepId}`,
        eventType: "hook.failed",
        expectedRevision,
        correlationId,
        stepId,
        payload: { hookPoint },
      }),
    );
  } else if (result.vetoed) {
    events.push(
      eventBase(run, {
        eventId: `evt-hook-veto-${hookPoint}-${stepId}`,
        eventType: "hook.vetoed",
        expectedRevision,
        correlationId,
        stepId,
        payload: { hookPoint },
      }),
    );
  } else if (result.invocations.some((i) => i.result.contextContributions?.length)) {
    events.push(
      eventBase(run, {
        eventId: `evt-hook-ctx-${hookPoint}-${stepId}`,
        eventType: "hook.context_contributed",
        expectedRevision,
        correlationId,
        stepId,
        payload: { hookPoint },
      }),
    );
  }
  return events;
}

async function commitStepFailed(
  deps: ExecuteTurnDeps,
  run: Run,
  args: {
    stepId: string;
    correlationId: string;
    expectedRevision: number;
    expectedLeaseEpoch: number;
    reason: string;
    prefixEvents: EventCandidate[];
  },
): Promise<HandleResult> {
  const events = [
    eventBase(run, {
      eventId: `evt-step-start-${args.stepId}`,
      eventType: "step.started",
      expectedRevision: args.expectedRevision,
      correlationId: args.correlationId,
      stepId: args.stepId,
    }),
    ...args.prefixEvents,
    eventBase(run, {
      eventId: `evt-step-fail-${args.stepId}`,
      eventType: "step.failed",
      expectedRevision: args.expectedRevision,
      correlationId: args.correlationId,
      stepId: args.stepId,
      payload: { reason: args.reason },
    }),
  ];

  const uow = await deps.persistence.beginUnitOfWork(run.runId);
  const result = await applyCommit(uow, {
    expectedRevision: args.expectedRevision,
    expectedLeaseEpoch: args.expectedLeaseEpoch,
    events,
  });
  if (!result.ok) {
    return { ok: false, code: result.code, message: result.message };
  }
  const saved = await deps.persistence.getRun(run.runId);
  if (!saved) {
    return { ok: false, code: "fatal", message: "run missing after step.failed" };
  }
  return {
    ok: true,
    run: saved,
    revision: result.revision,
    leaseEpoch: result.leaseEpoch,
  };
}

async function commitTurn(
  deps: ExecuteTurnDeps,
  run: Run,
  args: {
    stepId: string;
    correlationId: string;
    expectedRevision: number;
    expectedLeaseEpoch: number;
    ownerId: string;
    action: Action;
    policy: PolicyEvaluation;
    state: ReturnType<typeof createEmptyRunState>;
    preEvents: EventCandidate[];
    postEvents: EventCandidate[];
    preToolEvents: EventCandidate[];
    contextEvent?: EventCandidate;
    modelEvents?: EventCandidate[];
  },
): Promise<HandleResult> {
  const { stepId, correlationId, action, policy } = args;
  const rev = args.expectedRevision;

  const contextEvt =
    args.contextEvent ??
    eventBase(run, {
      eventId: `evt-ctx-${stepId}`,
      eventType: "context.built",
      expectedRevision: rev,
      correlationId,
      stepId,
    });

  const modelEvts =
    args.modelEvents && args.modelEvents.length > 0
      ? args.modelEvents
      : [
          eventBase(run, {
            eventId: `evt-model-call-${stepId}`,
            eventType: "model.called",
            expectedRevision: rev,
            correlationId,
            stepId,
          }),
          eventBase(run, {
            eventId: `evt-model-resp-${stepId}`,
            eventType: "model.responded",
            expectedRevision: rev,
            correlationId,
            stepId,
            payload: { actionId: action.actionId },
          }),
        ];

  const events: EventCandidate[] = [
    eventBase(run, {
      eventId: `evt-step-start-${stepId}`,
      eventType: "step.started",
      expectedRevision: rev,
      correlationId,
      stepId,
    }),
    ...args.preEvents,
    contextEvt,
    ...modelEvts,
    eventBase(run, {
      eventId: `evt-action-prop-${stepId}`,
      eventType: "action.proposed",
      expectedRevision: rev,
      correlationId,
      stepId,
      payload: { action },
    }),
    ...args.postEvents,
    eventBase(run, {
      eventId: `evt-policy-${stepId}`,
      eventType: "policy.evaluated",
      expectedRevision: rev,
      correlationId,
      stepId,
      payload: {
        decision: policy.decision,
        policyVersion: policy.policyVersion,
        reason: policy.reason,
        inputSummary: policy.inputSummary,
      },
    }),
  ];

  let runPatch: Partial<Run> | undefined;
  let toolCalls: ToolCallRecord[] | undefined;
  let outbox: OutboxRecord[] | undefined;
  let idempotency: IdempotencyRecord[] | undefined;
  let approvals: ApprovalRecord[] | undefined;
  let checkpoint: Checkpoint | undefined;
  let continuation: Continuation | undefined;
  let releaseLeaseAfter = false;
  let commitState: RunState | undefined;

  if (policy.decision === "deny") {
    events.push(
      eventBase(run, {
        eventId: `evt-policy-deny-${stepId}`,
        eventType: "policy.denied",
        expectedRevision: rev,
        correlationId,
        stepId,
        payload: { reason: policy.reason },
      }),
      eventBase(run, {
        eventId: `evt-action-rej-${stepId}`,
        eventType: "action.rejected",
        expectedRevision: rev,
        correlationId,
        stepId,
        payload: { actionId: action.actionId, reason: policy.reason },
      }),
      eventBase(run, {
        eventId: `evt-step-fail-${stepId}`,
        eventType: "step.failed",
        expectedRevision: rev,
        correlationId,
        stepId,
        payload: { reason: policy.reason },
      }),
    );
  } else if (policy.decision === "require_approval" && action.type === "tool.call") {
    const wait = buildApprovalWaitArtifacts({
      run,
      stepId,
      action,
      policyVersion: policy.policyVersion,
      policyReason: policy.reason,
      state: args.state,
    });
    approvals = [wait.approval];
    checkpoint = wait.checkpoint;
    continuation = wait.continuation;
    commitState = args.state;
    runPatch = { status: "awaiting_approval" };
    releaseLeaseAfter = true;
    events.push(
      eventBase(run, {
        eventId: `evt-approval-req-${wait.approval.approvalId}`,
        eventType: "approval.requested",
        expectedRevision: rev,
        correlationId,
        stepId,
        approvalId: wait.approval.approvalId,
        payload: {
          actionId: action.actionId,
          actionDigest: wait.approval.actionDigest,
          expiresAt: wait.approval.expiresAt,
        },
      }),
      eventBase(run, {
        eventId: `evt-checkpoint-${wait.checkpoint.checkpointId}`,
        eventType: "checkpoint.saved",
        expectedRevision: rev,
        correlationId,
        stepId,
        payload: {
          checkpointId: wait.checkpoint.checkpointId,
          continuationId: wait.continuation.continuationId,
          stateHash: wait.checkpoint.stateHash,
        },
      }),
      eventBase(run, {
        eventId: `evt-status-await-apr-${stepId}`,
        eventType: "run.status_changed",
        expectedRevision: rev,
        correlationId,
        stepId,
        payload: { from: "running", to: "awaiting_approval" },
      }),
      eventBase(run, {
        eventId: `evt-lease-lost-${stepId}`,
        eventType: "run.lease_lost",
        expectedRevision: rev,
        correlationId,
        stepId,
        payload: { reason: "awaiting_approval" },
      }),
    );
  } else if (action.type === "ask_user") {
    const wait = buildInputWaitArtifacts({
      run,
      stepId,
      action,
      state: args.state,
    });
    checkpoint = wait.checkpoint;
    continuation = wait.continuation;
    commitState = args.state;
    runPatch = { status: "awaiting_input" };
    releaseLeaseAfter = true;
    events.push(
      eventBase(run, {
        eventId: `evt-action-acc-${stepId}`,
        eventType: "action.accepted",
        expectedRevision: rev,
        correlationId,
        stepId,
        payload: { actionId: action.actionId },
      }),
      eventBase(run, {
        eventId: `evt-checkpoint-${wait.checkpoint.checkpointId}`,
        eventType: "checkpoint.saved",
        expectedRevision: rev,
        correlationId,
        stepId,
        payload: {
          checkpointId: wait.checkpoint.checkpointId,
          continuationId: wait.continuation.continuationId,
          stateHash: wait.checkpoint.stateHash,
        },
      }),
      eventBase(run, {
        eventId: `evt-status-await-input-${stepId}`,
        eventType: "run.status_changed",
        expectedRevision: rev,
        correlationId,
        stepId,
        payload: { from: "running", to: "awaiting_input" },
      }),
      eventBase(run, {
        eventId: `evt-lease-lost-input-${stepId}`,
        eventType: "run.lease_lost",
        expectedRevision: rev,
        correlationId,
        stepId,
        payload: { reason: "awaiting_input" },
      }),
    );
  } else if (action.type === "finish") {
    const acceptanceResults = evaluateAcceptanceChecks(
      args.state,
      deps.acceptanceChecks ?? [],
    );
    const existingCalls = await deps.persistence.listToolCalls(run.runId);
    const unresolved = existingCalls.filter(
      (call) =>
        call.status === "prepared" ||
        call.status === "dispatched" ||
        call.status === "outcome_unknown",
    );
    const checksOk = requiredAcceptanceChecksPassed(acceptanceResults);
    if (!checksOk || unresolved.length > 0) {
      const reason = !checksOk
        ? "required acceptanceChecks did not pass"
        : "finish blocked: unresolved tool calls";
      events.push(
        eventBase(run, {
          eventId: `evt-action-rej-${stepId}`,
          eventType: "action.rejected",
          expectedRevision: rev,
          correlationId,
          stepId,
          payload: {
            actionId: action.actionId,
            reason,
            acceptanceChecks: acceptanceResults,
          },
        }),
        eventBase(run, {
          eventId: `evt-step-fail-${stepId}`,
          eventType: "step.failed",
          expectedRevision: rev,
          correlationId,
          stepId,
          payload: { reason },
        }),
      );
    } else {
      events.push(
        eventBase(run, {
          eventId: `evt-action-acc-${stepId}`,
          eventType: "action.accepted",
          expectedRevision: rev,
          correlationId,
          stepId,
          payload: {
            actionId: action.actionId,
            acceptanceChecks: acceptanceResults,
          },
        }),
      );
      const onEnd = await deps.hooks.invoke("OnRunEnd", {
        tenantId: run.tenantId,
        sessionId: run.sessionId,
        runId: run.runId,
        stepId,
        context: { goal: run.goal },
        action,
      });
      events.push(...hookEvents(run, stepId, rev, correlationId, "OnRunEnd", onEnd));
      if (onEnd.failed || onEnd.vetoed) {
        events.push(
          eventBase(run, {
            eventId: `evt-step-fail-${stepId}`,
            eventType: "step.failed",
            expectedRevision: rev,
            correlationId,
            stepId,
            payload: {
              reason: onEnd.failureReason ?? onEnd.vetoReason ?? "OnRunEnd blocked succeed",
            },
          }),
        );
      } else {
        events.push(
          eventBase(run, {
            eventId: `evt-step-ok-${stepId}`,
            eventType: "step.completed",
            expectedRevision: rev,
            correlationId,
            stepId,
          }),
          eventBase(run, {
            eventId: `evt-run-completed-${stepId}`,
            eventType: "run.completed",
            expectedRevision: rev,
            correlationId,
            stepId,
          }),
        );
        runPatch = { status: "succeeded" };
      }
    }
  } else {
    events.push(
      eventBase(run, {
        eventId: `evt-action-acc-${stepId}`,
        eventType: "action.accepted",
        expectedRevision: rev,
        correlationId,
        stepId,
        payload: { actionId: action.actionId },
      }),
    );

    if (action.type === "tool.call") {
      events.push(...args.preToolEvents);
      const toolId = action.toolId;
      if (!toolId) {
        events.push(
          eventBase(run, {
            eventId: `evt-step-fail-${stepId}`,
            eventType: "step.failed",
            expectedRevision: rev,
            correlationId,
            stepId,
            payload: { reason: "tool.call missing toolId" },
          }),
        );
      } else {
        const contract = lookupToolContract(toolId, deps.registry);
        if (!contract) {
          events.push(
            eventBase(run, {
              eventId: `evt-step-fail-${stepId}`,
              eventType: "step.failed",
              expectedRevision: rev,
              correlationId,
              stepId,
              payload: { reason: `unknown tool contract: ${toolId}` },
            }),
          );
        } else if (requiresIdempotencyKey(contract) && !action.idempotencyKey) {
          events.push(
            eventBase(run, {
              eventId: `evt-step-fail-${stepId}`,
              eventType: "step.failed",
              expectedRevision: rev,
              correlationId,
              stepId,
              payload: { reason: "idempotencyKey required for side-effect tool" },
            }),
          );
        } else {
          const existingCalls = await deps.persistence.listToolCalls(run.runId);
          const unknown = existingCalls.find(
            (t) => t.toolId === toolId && t.status === "outcome_unknown",
          );
          if (unknown && unknown.idempotencyKey !== action.idempotencyKey) {
            return {
              ok: false,
              code: "validation",
              message:
                "cannot blind-retry outcome_unknown with a new idempotency key; use reconcile_tool",
            };
          }

          const hash = inputHash(action);
          if (action.idempotencyKey && deps.persistence.get) {
            const existing = await deps.persistence.get(
              "tool_call",
              run.tenantId,
              action.idempotencyKey,
            );
            if (existing) {
              if (existing.requestHash !== hash) {
                return {
                  ok: false,
                  code: "conflict",
                  message: "tool_call idempotency requestHash mismatch",
                };
              }
              const saved = await deps.persistence.getRun(run.runId);
              if (!saved) {
                return { ok: false, code: "fatal", message: "run missing" };
              }
              return {
                ok: true,
                run: saved,
                revision: saved.revision,
                leaseEpoch: saved.leaseEpoch,
                idempotent: true,
              };
            }
          }

          const now = new Date().toISOString();
          const toolCallId = `tc-${action.actionId}`;
          const postPrepareRevision = rev + 1;
          const toolCall: ToolCallRecord = {
            schemaVersion: CONTRACTS_SCHEMA_VERSION,
            toolCallId,
            tenantId: run.tenantId,
            sessionId: run.sessionId,
            runId: run.runId,
            stepId,
            actionId: action.actionId,
            toolId,
            toolVersion: "0.1.0",
            executionManifestRef: run.executionManifestRef,
            inputHash: hash,
            arguments: action.arguments,
            resourceScope: action.resourceScope,
            idempotencyKey: action.idempotencyKey,
            idempotencyScope: contract.idempotencyScope,
            deliverySemantics: contract.deliverySemantics,
            sideEffectProfile: contract.sideEffectProfile,
            status: "prepared",
            attempt: 1,
            preparedAt: now,
            dispatchLeaseEpoch: run.leaseEpoch,
            revision: 0,
            reconcileSupported: contract.reconcileSupported,
          };

          toolCalls = [toolCall];
          events.push(
            eventBase(run, {
              eventId: `evt-tool-prep-${toolCallId}`,
              eventType: "tool.call_prepared",
              expectedRevision: rev,
              correlationId,
              stepId,
              toolCallId,
              payload: { toolId, idempotencyKey: action.idempotencyKey },
            }),
          );

          if (action.idempotencyKey) {
            idempotency = [
              {
                schemaVersion: CONTRACTS_SCHEMA_VERSION,
                idempotencyRecordId: `idem-tc-${toolCallId}`,
                namespace: "tool_call",
                tenantId: run.tenantId,
                key: action.idempotencyKey,
                dedupeKey: action.idempotencyKey,
                requestHash: hash,
                ownerRef: {
                  ownerType: "tool_call",
                  runId: run.runId,
                  stepId,
                  toolCallId,
                },
                resultRef: {
                  resultType: "tool_result",
                  runId: run.runId,
                  toolCallId,
                },
                status: "completed",
                revision: 0,
                createdAt: now,
                updatedAt: now,
                expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
                completedAt: now,
              },
            ];
          }

          outbox = [
            {
              schemaVersion: CONTRACTS_SCHEMA_VERSION,
              outboxRecordId: `ob-dispatch-${toolCallId}`,
              message: {
                messageType: "dispatch_tool",
                tenantId: run.tenantId,
                aggregateRef: {
                  aggregateType: "tool_call",
                  aggregateId: toolCallId,
                  revision: postPrepareRevision,
                },
                dedupeKey: `dispatch_tool:${toolCallId}`,
                payloadHash: `dispatch_tool:${toolCallId}`,
                availableAt: now,
                payload: {
                  runId: run.runId,
                  toolCallId,
                  revision: postPrepareRevision,
                  leaseEpoch: run.leaseEpoch,
                  tenantId: run.tenantId,
                },
              },
              status: "pending",
              publishAttempts: 0,
              revision: 0,
              createdAt: now,
              updatedAt: now,
              expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
            },
          ];
        }
      }
    } else if (action.type === "noop") {
      events.push(
        eventBase(run, {
          eventId: `evt-step-ok-${stepId}`,
          eventType: "step.completed",
          expectedRevision: rev,
          correlationId,
          stepId,
        }),
      );
    }
  }

  const uow = await deps.persistence.beginUnitOfWork(run.runId);
  const result = await applyCommit(uow, {
    expectedRevision: rev,
    expectedLeaseEpoch: args.expectedLeaseEpoch,
    events,
    runPatch,
    toolCalls,
    outbox,
    idempotency,
    approvals,
    checkpoint,
    continuation,
    state: commitState,
  });

  if (!result.ok) {
    return { ok: false, code: result.code, message: result.message };
  }

  if (releaseLeaseAfter) {
    await deps.lease.release(run.runId, args.ownerId, args.expectedLeaseEpoch);
  }

  const saved = await deps.persistence.getRun(run.runId);
  if (!saved) {
    return { ok: false, code: "fatal", message: "run missing after execute_turn" };
  }
  return {
    ok: true,
    run: saved,
    revision: result.revision,
    leaseEpoch: result.leaseEpoch,
  };
}
