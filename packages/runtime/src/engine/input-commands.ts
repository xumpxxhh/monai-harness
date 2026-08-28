import {
  CONTRACTS_SCHEMA_VERSION,
  type EventCandidate,
  type Observation,
  type Run,
} from "@monai/contracts";
import type { HarnessCommand, PersistencePort } from "@monai/ports";

import { applyCommit } from "../commit/apply-commit.js";
import { assertCommandTenant } from "./tenant-guard.js";
import type { HandleResult } from "./types.js";

export type SubmitInputPayload = {
  inputId: string;
  value: unknown;
};

function eventBase(
  run: Pick<Run, "tenantId" | "sessionId" | "runId">,
  args: {
    eventId: string;
    eventType: string;
    expectedRevision: number;
    correlationId: string;
    stepId?: string;
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
    occurredAt: new Date().toISOString(),
    correlationId: args.correlationId,
    producer: { type: "engine", id: "runtime" },
    hash: args.eventId,
    expectedRevision: args.expectedRevision,
    payload: args.payload ?? {},
  };
}

/**
 * User input command: record Observation candidate event + wake to queued.
 * Fact reduction happens on next leased execute_turn (design 03 §6.2).
 */
export async function handleSubmitInput(
  persistence: PersistencePort,
  command: HarnessCommand,
): Promise<HandleResult> {
  const runId = command.runId;
  if (!runId) {
    return { ok: false, code: "validation", message: "submit_input requires runId" };
  }
  if (command.expectedRevision === undefined) {
    return { ok: false, code: "validation", message: "submit_input requires expectedRevision" };
  }

  const payload = command.payload as SubmitInputPayload | undefined;
  if (!payload?.inputId) {
    return { ok: false, code: "validation", message: "submit_input payload.inputId required" };
  }

  const run = await persistence.getRun(runId);
  if (!run) {
    return { ok: false, code: "fatal", message: "run not found" };
  }
  const tenantFailure = assertCommandTenant(run, command);
  if (tenantFailure) return tenantFailure;
  if (run.status !== "awaiting_input") {
    return {
      ok: false,
      code: "validation",
      message: `submit_input invalid status: ${run.status}`,
    };
  }
  if (run.revision !== command.expectedRevision) {
    return { ok: false, code: "conflict", message: "expectedRevision mismatch" };
  }

  const continuation = await persistence.getContinuation(runId);
  if (!continuation || continuation.kind !== "input") {
    return { ok: false, code: "validation", message: "no input continuation" };
  }
  if (continuation.deadline && Date.parse(continuation.deadline) <= Date.now()) {
    return { ok: false, code: "validation", message: "input deadline expired" };
  }

  const correlationId = command.correlationId ?? command.commandId;
  const now = new Date().toISOString();
  const observation: Observation = {
    schemaVersion: CONTRACTS_SCHEMA_VERSION,
    observationId: `obs-input-${payload.inputId}`,
    tenantId: run.tenantId,
    sessionId: run.sessionId,
    runId: run.runId,
    stepId: continuation.stepId,
    source: {
      kind: "user",
      sourceId: payload.inputId,
      principalId: command.actor?.principalId,
    },
    observedAt: now,
    data: { inputId: payload.inputId, value: payload.value },
    hash: `oh:input:${payload.inputId}`,
  };

  const uow = await persistence.beginUnitOfWork(runId);
  const result = await applyCommit(uow, {
    expectedRevision: run.revision,
    expectedLeaseEpoch: run.leaseEpoch,
    runPatch: { status: "queued" },
    events: [
      eventBase(run, {
        eventId: `evt-obs-input-${payload.inputId}`,
        eventType: "observation.recorded",
        expectedRevision: run.revision,
        correlationId,
        stepId: continuation.stepId,
        payload: { observation },
      }),
      eventBase(run, {
        eventId: `evt-status-queued-input-${runId}-${run.revision}`,
        eventType: "run.status_changed",
        expectedRevision: run.revision,
        correlationId,
        payload: { from: "awaiting_input", to: "queued" },
      }),
    ],
  });

  if (!result.ok) {
    return { ok: false, code: result.code, message: result.message };
  }
  const saved = await persistence.getRun(runId);
  if (!saved) {
    return { ok: false, code: "fatal", message: "run missing after submit_input" };
  }
  return {
    ok: true,
    run: saved,
    revision: result.revision,
    leaseEpoch: result.leaseEpoch,
  };
}
