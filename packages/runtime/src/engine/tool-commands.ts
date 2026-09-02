import {
  CONTRACTS_SCHEMA_VERSION,
  createEmptyRunState,
  type EventCandidate,
  type Observation,
  type Run,
  type RunState,
  type ToolCallRecord,
} from "@monai/contracts";
import type { HarnessCommand, PersistencePort } from "@monai/ports";

import { applyCommit } from "../commit/apply-commit.js";
import { inspectActionBatchSiblings } from "../execution/prepare-tool-calls.js";
import { reduce, validateObservationToFact } from "../state/reducer.js";
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
    occurredAt: new Date().toISOString(),
    correlationId: args.correlationId,
    producer: { type: "engine", id: "runtime" },
    hash: args.eventId,
    expectedRevision: args.expectedRevision,
    payload: args.payload ?? {},
  };
}

async function appendStepTerminalIfBatchReady(
  persistence: PersistencePort,
  run: Run,
  pendingTool: ToolCallRecord,
  events: EventCandidate[],
  correlationId: string,
  revision: number,
  nextState?: RunState,
): Promise<void> {
  const siblings = await persistence.listToolCalls(run.runId);
  const merged = siblings.map((t) =>
    t.toolCallId === pendingTool.toolCallId ? pendingTool : t,
  );
  const batch = inspectActionBatchSiblings(merged, pendingTool.actionId);
  if (!batch.allTerminal) {
    return;
  }

  if (batch.stepShouldFail) {
    const reason =
      merged.find((t) => t.actionId === pendingTool.actionId && t.status === "failed")?.error ??
      "tool batch failed";
    events.push(
      eventBase(run, {
        eventId: `evt-step-fail-${pendingTool.stepId}-batch`,
        eventType: "step.failed",
        expectedRevision: revision,
        correlationId,
        stepId: pendingTool.stepId,
        payload: { reason },
      }),
    );
    return;
  }

  if (batch.stepShouldComplete) {
    events.push(
      eventBase(run, {
        eventId: `evt-step-ok-${pendingTool.stepId}`,
        eventType: "step.completed",
        expectedRevision: revision,
        correlationId,
        stepId: pendingTool.stepId,
        payload: nextState
          ? {
              lastFactId: nextState.lastFactId,
              stepCount: nextState.cursor.stepCount,
            }
          : undefined,
      }),
    );
  }
}

export type ToolDispatchResultPayload = {
  toolCallId: string;
  /** accepted → dispatched; then terminal outcome. */
  phase: "accepted" | "succeeded" | "failed" | "outcome_unknown";
  data?: unknown;
  resultRef?: string;
  resultHash?: string;
  error?: string;
};

export type ReconcileToolPayload = {
  toolCallId: string;
  data?: unknown;
  resultRef?: string;
  resultHash?: string;
  error?: string;
  ok: boolean;
};

/**
 * Commit tool.dispatched (accepted phase).
 */
export async function handleToolDispatchAccepted(
  persistence: PersistencePort,
  command: HarnessCommand,
): Promise<HandleResult> {
  const payload = command.payload as ToolDispatchResultPayload | undefined;
  if (!payload?.toolCallId) {
    return { ok: false, code: "validation", message: "toolCallId required" };
  }
  const runId = command.runId;
  if (!runId) {
    return { ok: false, code: "validation", message: "runId required" };
  }

  const run = await persistence.getRun(runId);
  const toolCall = await persistence.getToolCall(payload.toolCallId);
  if (!run || !toolCall) {
    return { ok: false, code: "fatal", message: "run or toolCall not found" };
  }
  const tenantFailure = assertCommandTenant(run, command);
  if (tenantFailure) return tenantFailure;
  if (toolCall.status === "dispatched" || toolCall.status === "succeeded" || toolCall.status === "failed") {
    return {
      ok: true,
      run,
      revision: run.revision,
      leaseEpoch: run.leaseEpoch,
      idempotent: true,
    };
  }
  if (toolCall.status !== "prepared") {
    return {
      ok: false,
      code: "validation",
      message: `accepted invalid status: ${toolCall.status}`,
    };
  }
  if (command.expectedRevision !== undefined && command.expectedRevision !== run.revision) {
    return { ok: false, code: "conflict", message: "expectedRevision mismatch" };
  }
  if (command.leaseEpoch !== undefined && command.leaseEpoch !== toolCall.dispatchLeaseEpoch) {
    return { ok: false, code: "lease_lost", message: "dispatch leaseEpoch mismatch" };
  }

  const now = new Date().toISOString();
  const next: ToolCallRecord = {
    ...toolCall,
    status: "dispatched",
    dispatchedAt: now,
    revision: toolCall.revision + 1,
  };
  const correlationId = command.correlationId ?? command.commandId;
  const uow = await persistence.beginUnitOfWork(runId);
  const result = await applyCommit(uow, {
    expectedRevision: run.revision,
    expectedLeaseEpoch: run.leaseEpoch,
    toolCalls: [next],
    events: [
      eventBase(run, {
        eventId: `evt-tool-disp-${toolCall.toolCallId}`,
        eventType: "tool.dispatched",
        expectedRevision: run.revision,
        correlationId,
        stepId: toolCall.stepId,
        toolCallId: toolCall.toolCallId,
      }),
    ],
  });
  if (!result.ok) {
    return { ok: false, code: result.code, message: result.message };
  }
  const saved = await persistence.getRun(runId);
  if (!saved) {
    return { ok: false, code: "fatal", message: "run missing after tool.dispatched" };
  }
  return {
    ok: true,
    run: saved,
    revision: result.revision,
    leaseEpoch: result.leaseEpoch,
  };
}

/**
 * Commit terminal tool outcome + Observation → Fact → Reducer → step.completed|failed.
 */
export async function handleToolDispatchTerminal(
  persistence: PersistencePort,
  command: HarnessCommand,
): Promise<HandleResult> {
  const payload = command.payload as ToolDispatchResultPayload | undefined;
  if (!payload?.toolCallId || !payload.phase) {
    return { ok: false, code: "validation", message: "toolCallId and phase required" };
  }
  if (payload.phase === "accepted") {
    return handleToolDispatchAccepted(persistence, command);
  }

  const runId = command.runId;
  if (!runId) {
    return { ok: false, code: "validation", message: "runId required" };
  }

  const run = await persistence.getRun(runId);
  const toolCall = await persistence.getToolCall(payload.toolCallId);
  if (!run || !toolCall) {
    return { ok: false, code: "fatal", message: "run or toolCall not found" };
  }
  const tenantFailure = assertCommandTenant(run, command);
  if (tenantFailure) return tenantFailure;

  if (
    toolCall.status === "succeeded" ||
    toolCall.status === "failed" ||
    (toolCall.status === "outcome_unknown" && payload.phase === "outcome_unknown")
  ) {
    return {
      ok: true,
      run,
      revision: run.revision,
      leaseEpoch: run.leaseEpoch,
      idempotent: true,
    };
  }

  if (toolCall.status !== "dispatched" && toolCall.status !== "prepared") {
    return {
      ok: false,
      code: "validation",
      message: `terminal invalid status: ${toolCall.status}`,
    };
  }

  if (command.expectedRevision !== undefined && command.expectedRevision !== run.revision) {
    return { ok: false, code: "conflict", message: "expectedRevision mismatch" };
  }

  const correlationId = command.correlationId ?? command.commandId;
  const now = new Date().toISOString();
  const events: EventCandidate[] = [];
  let nextTool: ToolCallRecord = { ...toolCall };

  // Ensure dispatched event exists if jumping from prepared (dispatcher may coalesce).
  if (toolCall.status === "prepared") {
    nextTool = {
      ...nextTool,
      status: "dispatched",
      dispatchedAt: now,
      revision: nextTool.revision + 1,
    };
    events.push(
      eventBase(run, {
        eventId: `evt-tool-disp-${toolCall.toolCallId}`,
        eventType: "tool.dispatched",
        expectedRevision: run.revision,
        correlationId,
        stepId: toolCall.stepId,
        toolCallId: toolCall.toolCallId,
      }),
    );
  }

  let nextState: RunState | undefined;
  const priorState = (await persistence.getState(runId)) ?? createEmptyRunState();

  if (payload.phase === "outcome_unknown") {
    nextTool = {
      ...nextTool,
      status: "outcome_unknown",
      error: payload.error ?? "outcome_unknown",
      revision: nextTool.revision + 1,
    };
    events.push(
      eventBase(run, {
        eventId: `evt-tool-unk-${toolCall.toolCallId}`,
        eventType: "tool.outcome_unknown",
        expectedRevision: run.revision,
        correlationId,
        stepId: toolCall.stepId,
        toolCallId: toolCall.toolCallId,
        payload: { error: nextTool.error },
      }),
    );
  } else if (payload.phase === "failed") {
    nextTool = {
      ...nextTool,
      status: "failed",
      completedAt: now,
      error: payload.error ?? "tool failed",
      revision: nextTool.revision + 1,
    };
    events.push(
      eventBase(run, {
        eventId: `evt-tool-fail-${toolCall.toolCallId}`,
        eventType: "tool.failed",
        expectedRevision: run.revision,
        correlationId,
        stepId: toolCall.stepId,
        toolCallId: toolCall.toolCallId,
        payload: { error: nextTool.error },
      }),
    );
    await appendStepTerminalIfBatchReady(
      persistence,
      run,
      nextTool,
      events,
      correlationId,
      run.revision,
    );
  } else {
    // succeeded
    const observationId = `obs-${toolCall.toolCallId}`;
    const observation: Observation = {
      schemaVersion: CONTRACTS_SCHEMA_VERSION,
      observationId,
      tenantId: run.tenantId,
      sessionId: run.sessionId,
      runId: run.runId,
      stepId: toolCall.stepId,
      source: {
        kind: "tool",
        sourceId: toolCall.toolCallId,
        version: toolCall.toolVersion,
      },
      observedAt: now,
      data: payload.data ?? {},
      hash: payload.resultHash ?? `obs-hash-${observationId}`,
      declaredSchemaRef: `tool.${toolCall.toolId}.result/0.1.0`,
    };
    nextTool = {
      ...nextTool,
      status: "succeeded",
      completedAt: now,
      resultObservationId: observationId,
      resultRef: payload.resultRef,
      resultHash: payload.resultHash,
      revision: nextTool.revision + 1,
    };
    events.push(
      eventBase(run, {
        eventId: `evt-tool-ok-${toolCall.toolCallId}`,
        eventType: "tool.succeeded",
        expectedRevision: run.revision,
        correlationId,
        stepId: toolCall.stepId,
        toolCallId: toolCall.toolCallId,
      }),
      eventBase(run, {
        eventId: `evt-obs-${observationId}`,
        eventType: "observation.recorded",
        expectedRevision: run.revision,
        correlationId,
        stepId: toolCall.stepId,
        toolCallId: toolCall.toolCallId,
        payload: { observationId, observation },
      }),
    );
    const validated = validateObservationToFact(observation, {
      authorizationDecisionRef: `tool:${toolCall.toolCallId}`,
    });
    if (validated.accepted) {
      nextState = reduce(priorState, validated.fact);
      events.push(
        eventBase(run, {
          eventId: `evt-fact-${validated.fact.factId}`,
          eventType: "fact.accepted",
          expectedRevision: run.revision,
          correlationId,
          stepId: toolCall.stepId,
          toolCallId: toolCall.toolCallId,
        }),
        eventBase(run, {
          eventId: `evt-state-${toolCall.toolCallId}-tool`,
          eventType: "state.reduced",
          expectedRevision: run.revision,
          correlationId,
          stepId: toolCall.stepId,
          payload: {
            lastFactId: nextState.lastFactId,
            stepCount: nextState.cursor.stepCount,
          },
        }),
      );
      await appendStepTerminalIfBatchReady(
        persistence,
        run,
        nextTool,
        events,
        correlationId,
        run.revision,
        nextState,
      );
    } else {
      events.push(
        eventBase(run, {
          eventId: `evt-fact-rej-${observationId}`,
          eventType: "fact.rejected",
          expectedRevision: run.revision,
          correlationId,
          stepId: toolCall.stepId,
          payload: { reason: validated.reason },
        }),
        eventBase(run, {
          eventId: `evt-step-fail-${toolCall.stepId}-fact`,
          eventType: "step.failed",
          expectedRevision: run.revision,
          correlationId,
          stepId: toolCall.stepId,
          payload: { reason: validated.reason },
        }),
      );
    }
  }

  const uow = await persistence.beginUnitOfWork(runId);
  const result = await applyCommit(uow, {
    expectedRevision: run.revision,
    expectedLeaseEpoch: run.leaseEpoch,
    toolCalls: [nextTool],
    events,
    state: nextState,
  });
  if (!result.ok) {
    return { ok: false, code: result.code, message: result.message };
  }
  const saved = await persistence.getRun(runId);
  if (!saved) {
    return { ok: false, code: "fatal", message: "run missing after tool terminal" };
  }
  return {
    ok: true,
    run: saved,
    revision: result.revision,
    leaseEpoch: result.leaseEpoch,
  };
}

export async function handleReconcileTool(
  persistence: PersistencePort,
  command: HarnessCommand,
): Promise<HandleResult> {
  const payload = command.payload as ReconcileToolPayload | undefined;
  if (!payload?.toolCallId) {
    return { ok: false, code: "validation", message: "reconcile_tool requires toolCallId" };
  }
  const runId = command.runId;
  if (!runId) {
    return { ok: false, code: "validation", message: "runId required" };
  }

  const run = await persistence.getRun(runId);
  const toolCall = await persistence.getToolCall(payload.toolCallId);
  if (!run || !toolCall) {
    return { ok: false, code: "fatal", message: "run or toolCall not found" };
  }
  const tenantFailure = assertCommandTenant(run, command);
  if (tenantFailure) return tenantFailure;
  if (toolCall.status !== "outcome_unknown") {
    if (toolCall.status === "succeeded" || toolCall.status === "failed") {
      return {
        ok: true,
        run,
        revision: run.revision,
        leaseEpoch: run.leaseEpoch,
        idempotent: true,
      };
    }
    return {
      ok: false,
      code: "validation",
      message: `reconcile invalid status: ${toolCall.status}`,
    };
  }

  if (command.expectedRevision !== undefined && command.expectedRevision !== run.revision) {
    return { ok: false, code: "conflict", message: "expectedRevision mismatch" };
  }

  const correlationId = command.correlationId ?? command.commandId;
  const now = new Date().toISOString();
  const events: EventCandidate[] = [
    eventBase(run, {
      eventId: `evt-tool-rec-${toolCall.toolCallId}`,
      eventType: "tool.reconciled",
      expectedRevision: run.revision,
      correlationId,
      stepId: toolCall.stepId,
      toolCallId: toolCall.toolCallId,
      payload: { ok: payload.ok },
    }),
  ];

  let nextState: RunState | undefined;
  const priorState = (await persistence.getState(runId)) ?? createEmptyRunState();
  let nextTool: ToolCallRecord;

  if (!payload.ok) {
    nextTool = {
      ...toolCall,
      status: "failed",
      completedAt: now,
      error: payload.error ?? "reconcile failed",
      revision: toolCall.revision + 1,
    };
    events.push(
      eventBase(run, {
        eventId: `evt-tool-fail-${toolCall.toolCallId}-rec`,
        eventType: "tool.failed",
        expectedRevision: run.revision,
        correlationId,
        stepId: toolCall.stepId,
        toolCallId: toolCall.toolCallId,
      }),
    );
    await appendStepTerminalIfBatchReady(
      persistence,
      run,
      nextTool,
      events,
      correlationId,
      run.revision,
    );
  } else {
    const observationId = `obs-rec-${toolCall.toolCallId}`;
    const observation: Observation = {
      schemaVersion: CONTRACTS_SCHEMA_VERSION,
      observationId,
      tenantId: run.tenantId,
      sessionId: run.sessionId,
      runId: run.runId,
      stepId: toolCall.stepId,
      source: {
        kind: "tool",
        sourceId: toolCall.toolCallId,
        version: toolCall.toolVersion,
      },
      observedAt: now,
      data: payload.data ?? {},
      hash: payload.resultHash ?? `obs-hash-${observationId}`,
    };
    nextTool = {
      ...toolCall,
      status: "succeeded",
      completedAt: now,
      resultObservationId: observationId,
      resultRef: payload.resultRef,
      resultHash: payload.resultHash,
      revision: toolCall.revision + 1,
    };
    events.push(
      eventBase(run, {
        eventId: `evt-tool-ok-${toolCall.toolCallId}-rec`,
        eventType: "tool.succeeded",
        expectedRevision: run.revision,
        correlationId,
        stepId: toolCall.stepId,
        toolCallId: toolCall.toolCallId,
      }),
      eventBase(run, {
        eventId: `evt-obs-${observationId}`,
        eventType: "observation.recorded",
        expectedRevision: run.revision,
        correlationId,
        stepId: toolCall.stepId,
        toolCallId: toolCall.toolCallId,
        payload: { observationId, observation },
      }),
    );
    const validated = validateObservationToFact(observation, {
      authorizationDecisionRef: `reconcile:${toolCall.toolCallId}`,
    });
    if (validated.accepted) {
      nextState = reduce(priorState, validated.fact);
      events.push(
        eventBase(run, {
          eventId: `evt-fact-${validated.fact.factId}`,
          eventType: "fact.accepted",
          expectedRevision: run.revision,
          correlationId,
          stepId: toolCall.stepId,
        }),
        eventBase(run, {
          eventId: `evt-state-${toolCall.toolCallId}-rec`,
          eventType: "state.reduced",
          expectedRevision: run.revision,
          correlationId,
          stepId: toolCall.stepId,
          payload: {
            lastFactId: nextState.lastFactId,
            stepCount: nextState.cursor.stepCount,
          },
        }),
      );
      await appendStepTerminalIfBatchReady(
        persistence,
        run,
        nextTool,
        events,
        correlationId,
        run.revision,
        nextState,
      );
    }
  }

  const uow = await persistence.beginUnitOfWork(runId);
  const result = await applyCommit(uow, {
    expectedRevision: run.revision,
    expectedLeaseEpoch: run.leaseEpoch,
    toolCalls: [nextTool],
    events,
    state: nextState,
  });
  if (!result.ok) {
    return { ok: false, code: result.code, message: result.message };
  }
  const saved = await persistence.getRun(runId);
  if (!saved) {
    return { ok: false, code: "fatal", message: "run missing after reconcile" };
  }
  return {
    ok: true,
    run: saved,
    revision: result.revision,
    leaseEpoch: result.leaseEpoch,
  };
}
