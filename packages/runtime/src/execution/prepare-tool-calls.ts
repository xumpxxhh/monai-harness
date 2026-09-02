import {
  CONTRACTS_SCHEMA_VERSION,
  type Action,
  type EventCandidate,
  type IdempotencyRecord,
  type OutboxRecord,
  type Run,
  type ToolCallInvocation,
  type ToolCallRecord,
} from "@monai/contracts";
import type { IdempotencyPort, PersistencePort } from "@monai/ports";

import { lookupToolContract, requiresIdempotencyKey } from "./lookup-tool-contract.js";
import type { ExtensionRegistry } from "../extension/extension-registry.js";
import { getToolCallInvocations } from "../model/normalize-action.js";

function stable(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value ?? null);
}

export function invocationInputHash(inv: ToolCallInvocation): string {
  return `ih:${inv.toolId}:${inv.idempotencyKey ?? ""}:${stable(inv.arguments)}`;
}

export type PrepareToolCallsInput = {
  run: Run;
  stepId: string;
  action: Action;
  correlationId: string;
  expectedRevision: number;
  /** Indices into normalized calls[] to prepare. */
  callIndices: number[];
  persistence: PersistencePort & Partial<IdempotencyPort>;
  registry?: ExtensionRegistry;
  eventBase: (
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
  ) => EventCandidate;
};

export type PrepareToolCallsSuccess = {
  ok: true;
  toolCalls: ToolCallRecord[];
  outbox: OutboxRecord[];
  idempotency: IdempotencyRecord[];
  events: EventCandidate[];
};

export type PrepareToolCallsFailure = {
  ok: false;
  code: "validation" | "conflict" | "fatal";
  message: string;
};

export type PrepareToolCallsResult = PrepareToolCallsSuccess | PrepareToolCallsFailure;

/**
 * Build ToolCallRecord + Outbox rows for allowed invocations in a batch Action.
 */
export async function prepareToolCalls(
  input: PrepareToolCallsInput,
): Promise<PrepareToolCallsResult> {
  const invocations = getToolCallInvocations(input.action);
  if (invocations.length === 0) {
    return { ok: false, code: "validation", message: "tool.call has no invocations" };
  }

  const existingCalls = await input.persistence.listToolCalls(input.run.runId);
  const toolCalls: ToolCallRecord[] = [];
  const outbox: OutboxRecord[] = [];
  const idempotency: IdempotencyRecord[] = [];
  const events: EventCandidate[] = [];
  const now = new Date().toISOString();
  const postPrepareRevision = input.expectedRevision + 1;

  for (const callIndex of input.callIndices) {
    const inv = invocations[callIndex];
    if (!inv) {
      return { ok: false, code: "validation", message: `invalid call index: ${callIndex}` };
    }

    const contract = lookupToolContract(inv.toolId, input.registry);
    if (!contract) {
      return { ok: false, code: "validation", message: `unknown tool contract: ${inv.toolId}` };
    }
    if (requiresIdempotencyKey(contract) && !inv.idempotencyKey) {
      return {
        ok: false,
        code: "validation",
        message: `idempotencyKey required for side-effect tool: ${inv.toolId}`,
      };
    }

    const unknown = existingCalls.find(
      (t) => t.toolId === inv.toolId && t.status === "outcome_unknown",
    );
    if (unknown) {
      if (unknown.idempotencyKey !== inv.idempotencyKey) {
        return {
          ok: false,
          code: "validation",
          message:
            "cannot blind-retry outcome_unknown with a new idempotency key; use reconcile_tool",
        };
      }
      return {
        ok: false,
        code: "validation",
        message: "cannot blind-retry outcome_unknown; use reconcile_tool",
      };
    }

    const hash = invocationInputHash(inv);
    if (inv.idempotencyKey && input.persistence.get) {
      const existing = await input.persistence.get(
        "tool_call",
        input.run.tenantId,
        inv.idempotencyKey,
      );
      if (existing) {
        if (existing.requestHash !== hash) {
          return {
            ok: false,
            code: "conflict",
            message: "tool_call idempotency requestHash mismatch",
          };
        }
        continue;
      }
    }

    const toolCallId = `tc-${input.run.runId}-${input.action.actionId}-${callIndex}`;
    const toolCall: ToolCallRecord = {
      schemaVersion: CONTRACTS_SCHEMA_VERSION,
      toolCallId,
      tenantId: input.run.tenantId,
      sessionId: input.run.sessionId,
      runId: input.run.runId,
      stepId: input.stepId,
      actionId: input.action.actionId,
      toolId: inv.toolId,
      toolVersion: "0.1.0",
      executionManifestRef: input.run.executionManifestRef,
      inputHash: hash,
      arguments: inv.arguments,
      resourceScope: inv.resourceScope,
      idempotencyKey: inv.idempotencyKey,
      idempotencyScope: contract.idempotencyScope,
      deliverySemantics: contract.deliverySemantics,
      sideEffectProfile: contract.sideEffectProfile,
      status: "prepared",
      attempt: 1,
      preparedAt: now,
      dispatchLeaseEpoch: input.run.leaseEpoch,
      revision: 0,
      reconcileSupported: contract.reconcileSupported,
    };

    toolCalls.push(toolCall);
    events.push(
      input.eventBase(input.run, {
        eventId: `evt-tool-prep-${toolCallId}`,
        eventType: "tool.call_prepared",
        expectedRevision: input.expectedRevision,
        correlationId: input.correlationId,
        stepId: input.stepId,
        toolCallId,
        payload: { toolId: inv.toolId, idempotencyKey: inv.idempotencyKey, callIndex },
      }),
    );

    if (inv.idempotencyKey) {
      idempotency.push({
        schemaVersion: CONTRACTS_SCHEMA_VERSION,
        idempotencyRecordId: `idem-tc-${toolCallId}`,
        namespace: "tool_call",
        tenantId: input.run.tenantId,
        key: inv.idempotencyKey,
        dedupeKey: inv.idempotencyKey,
        requestHash: hash,
        ownerRef: {
          ownerType: "tool_call",
          runId: input.run.runId,
          stepId: input.stepId,
          toolCallId,
        },
        resultRef: {
          resultType: "tool_result",
          runId: input.run.runId,
          toolCallId,
        },
        status: "completed",
        revision: 0,
        createdAt: now,
        updatedAt: now,
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        completedAt: now,
      });
    }

    outbox.push({
      schemaVersion: CONTRACTS_SCHEMA_VERSION,
      outboxRecordId: `ob-dispatch-${toolCallId}`,
      message: {
        messageType: "dispatch_tool",
        tenantId: input.run.tenantId,
        aggregateRef: {
          aggregateType: "tool_call",
          aggregateId: toolCallId,
          revision: postPrepareRevision,
        },
        dedupeKey: `dispatch_tool:${toolCallId}`,
        payloadHash: `dispatch_tool:${toolCallId}`,
        availableAt: now,
        payload: {
          runId: input.run.runId,
          toolCallId,
          revision: postPrepareRevision,
          leaseEpoch: input.run.leaseEpoch,
          tenantId: input.run.tenantId,
        },
      },
      status: "pending",
      publishAttempts: 0,
      revision: 0,
      createdAt: now,
      updatedAt: now,
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
  }

  return { ok: true, toolCalls, outbox, idempotency, events };
}

export type ActionBatchSiblingStatus = {
  preparedCount: number;
  allTerminal: boolean;
  anyFailed: boolean;
  anyUnresolved: boolean;
  stepShouldComplete: boolean;
  stepShouldFail: boolean;
};

const TERMINAL = new Set(["succeeded", "failed"]);
const UNRESOLVED = new Set(["prepared", "dispatched", "outcome_unknown"]);

/**
 * Inspect siblings sharing actionId to decide step completion.
 */
export function inspectActionBatchSiblings(
  siblings: ToolCallRecord[],
  actionId: string,
): ActionBatchSiblingStatus {
  const batch = siblings.filter((t) => t.actionId === actionId);
  const preparedCount = batch.length;
  if (preparedCount === 0) {
    return {
      preparedCount: 0,
      allTerminal: true,
      anyFailed: false,
      anyUnresolved: false,
      stepShouldComplete: false,
      stepShouldFail: false,
    };
  }

  const anyUnresolved = batch.some((t) => UNRESOLVED.has(t.status));
  const anyFailed = batch.some((t) => t.status === "failed");
  const allTerminal = batch.every((t) => TERMINAL.has(t.status));

  return {
    preparedCount,
    allTerminal,
    anyFailed,
    anyUnresolved,
    stepShouldComplete: allTerminal && !anyFailed,
    stepShouldFail: allTerminal && anyFailed,
  };
}
