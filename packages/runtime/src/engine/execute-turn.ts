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

import { buildModelContext } from "../context/build-model-context.js";
import { checkRunBudget } from "../control/budget-guard.js";
import { projectActionForUser } from "../control/project-action.js";
import type { HookRunner } from "../hooks/hook-runner.js";
import type { PreviewHub } from "../preview/preview-hub.js";
import { publishModelContext } from "../preview/publish-model-context.js";
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
import { prepareToolCalls } from "../execution/prepare-tool-calls.js";
import type { ExtensionRegistry } from "../extension/extension-registry.js";
import { buildAgentSystemPrompt } from "../model/agent-system-prompt.js";
import { buildModelFunctionCatalog } from "../model/function-catalog.js";
import { resolveModelActionCandidate } from "../model/map-decision.js";
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

function stable(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value ?? null);
}

async function tryIdempotentPreparedRetry(
  persistence: PersistencePort & Partial<IdempotencyPort>,
  run: Run,
  existingToolCalls: ToolCallRecord[],
): Promise<HandleResult | null> {
  const prepared = existingToolCalls.filter((call) => call.status === "prepared");
  if (prepared.length === 0) {
    return null;
  }
  if (!persistence.get) {
    return null;
  }
  for (const call of prepared) {
    if (!call.idempotencyKey) {
      return null;
    }
    const existing = await persistence.get("tool_call", run.tenantId, call.idempotencyKey);
    if (!existing) {
      return null;
    }
  }
  return {
    ok: true,
    run,
    revision: run.revision,
    leaseEpoch: run.leaseEpoch,
    idempotent: true,
  };
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
  const existingToolCalls = await deps.persistence.listToolCalls(runId);
  const hasUnresolvedTools = existingToolCalls.some(
    (call) =>
      call.status === "prepared" ||
      call.status === "dispatched" ||
      call.status === "outcome_unknown",
  );
  const hasDispatched = existingToolCalls.some((call) => call.status === "dispatched");
  const hasPrepared = existingToolCalls.some((call) => call.status === "prepared");
  const functionCatalog = buildModelFunctionCatalog({ toolAllowlist });

  const idempotentRetry = await tryIdempotentPreparedRetry(
    deps.persistence,
    run,
    existingToolCalls,
  );
  if (idempotentRetry) {
    return idempotentRetry;
  }

  if (hasDispatched || hasPrepared) {
    return {
      ok: true,
      run,
      revision: run.revision,
      leaseEpoch: run.leaseEpoch,
    };
  }

  // outcome_unknown alone: allow model so prepare can reject blind retries.

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

  const systemPrompt = buildAgentSystemPrompt({ toolAllowlist });
  const modelContextResult = await buildModelContext(
    {
      run,
      stepId,
      state,
      toolAllowlist,
      hookContributions: pre.merged.contextContributions,
      modelPolicy: resolvedModelPolicy,
      persistence: deps.persistence,
      model: deps.model,
      systemPrompt,
    },
    eventBase,
    correlationId,
    rev,
  );
  const buildResult = modelContextResult.buildResult;
  const modelMessages = modelContextResult.messages;
  const compressionEvents = modelContextResult.compressionEvents;

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
        messages: modelMessages,
        controlFunctions: functionCatalog.controlFunctions,
        domainTools: functionCatalog.domainTools,
        systemPrompt,
        modelPolicy: {
          ...resolvedModelPolicy,
          resolvedTarget: target,
        },
      };

      deps.previewHub?.publish({
        type: "model_input",
        runId: run.runId,
        stepId,
        modelCallId,
        input: modelInput,
      });

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
            } else if (chunk.channel === "display") {
              modelDisplay = (modelDisplay ?? "") + chunk.text;
            }
          } else if (chunk.kind === "done") {
            modelResult = chunk.result;
            if (chunk.result.reasoning) {
              modelReasoning = chunk.result.reasoning;
            }
            if (chunk.result.content?.trim()) {
              modelDisplay = chunk.result.content.trim();
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
      publishModelContext(deps.previewHub, {
        runId: run.runId,
        stepId,
        modelCallId,
        contextHash: buildResult.contextHash,
        messages: modelMessages,
        status: "failed",
        display: modelDisplay,
        reasoning: modelReasoning,
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

    let mapFailed: string | undefined;
    if (!callFailed) {
      const resolved = resolveModelActionCandidate(modelResult, {
        lastFactId: state.lastFactId,
        hasUnresolvedTools,
      });
      if (resolved.usage) {
        usage = resolved.usage;
      }
      if (resolved.reasoning) {
        modelReasoning = resolved.reasoning;
      }
      if (resolved.content?.trim()) {
        modelDisplay = resolved.content.trim();
      }
      if (resolved.ok) {
        candidateAction = resolved.candidate;
      } else {
        mapFailed = resolved.reason;
      }
    }

    const preParse =
      !callFailed && !mapFailed ? actionSchema.safeParse(candidateAction) : null;
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

    if (mapFailed) {
      lastModelError = mapFailed;
      deps.previewHub?.publish({
        type: "preview_invalid",
        runId: run.runId,
        stepId,
        modelCallId,
        reason: lastModelError,
      });
      publishModelContext(deps.previewHub, {
        runId: run.runId,
        stepId,
        modelCallId,
        contextHash: buildResult.contextHash,
        messages: modelMessages,
        status: "invalid",
        display: modelDisplay,
        reasoning: modelReasoning,
        reason: lastModelError,
      });
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
      publishModelContext(deps.previewHub, {
        runId: run.runId,
        stepId,
        modelCallId,
        contextHash: buildResult.contextHash,
        messages: modelMessages,
        status: "invalid",
        display: modelDisplay,
        reasoning: modelReasoning,
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
    publishModelContext(deps.previewHub, {
      runId: run.runId,
      stepId,
      modelCallId,
      contextHash: buildResult.contextHash,
      messages: modelMessages,
      status: "committed",
      action: parsedAction,
      display: modelDisplay ?? projectActionForUser(parsedAction),
      reasoning: modelReasoning,
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
    compressionEvents,
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
    compressionEvents?: EventCandidate[];
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
    ...(args.compressionEvents ?? []),
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
        actionDecision: policy.actionDecision,
        callResults: policy.callResults,
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
      const allowedIndices =
        policy.allowedCallIndices ??
        (action.calls?.map((_, index) => index) ?? (action.toolId ? [0] : []));

      if (allowedIndices.length === 0) {
        events.push(
          eventBase(run, {
            eventId: `evt-step-fail-${stepId}`,
            eventType: "step.failed",
            expectedRevision: rev,
            correlationId,
            stepId,
            payload: { reason: "no allowed tool invocations in batch" },
          }),
        );
      } else {
        const prepared = await prepareToolCalls({
          run,
          stepId,
          action,
          correlationId,
          expectedRevision: rev,
          callIndices: allowedIndices,
          persistence: deps.persistence,
          registry: deps.registry,
          eventBase,
        });

        if (!prepared.ok) {
          return {
            ok: false,
            code: prepared.code,
            message: prepared.message,
          };
        }
        if (prepared.toolCalls.length === 0) {
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
        } else {
          toolCalls = prepared.toolCalls;
          outbox = prepared.outbox;
          idempotency = prepared.idempotency.length > 0 ? prepared.idempotency : undefined;
          events.push(...prepared.events);
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
