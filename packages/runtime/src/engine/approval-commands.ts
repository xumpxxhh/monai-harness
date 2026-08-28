import {
  CONTRACTS_SCHEMA_VERSION,
  type ApprovalRecord,
  type EventCandidate,
  type Run,
} from "@monai/contracts";
import type { HarnessCommand, PersistencePort } from "@monai/ports";

import { applyCommit } from "../commit/apply-commit.js";
import { assertCommandTenant } from "./tenant-guard.js";
import type { HandleResult } from "./types.js";

export type ApprovalDecisionPayload = {
  approvalId: string;
  decision: "approved" | "rejected";
  reason?: string;
};

function eventBase(
  run: Pick<Run, "tenantId" | "sessionId" | "runId">,
  args: {
    eventId: string;
    eventType: string;
    expectedRevision: number;
    correlationId: string;
    stepId?: string;
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
    approvalId: args.approvalId,
    occurredAt: new Date().toISOString(),
    correlationId: args.correlationId,
    producer: { type: "engine", id: "runtime" },
    hash: args.eventId,
    expectedRevision: args.expectedRevision,
    payload: args.payload ?? {},
  };
}

/**
 * Approval Gate candidate → Engine wakes to queued (or fails on reject).
 * Does NOT resume to running; Scheduler must acquire_lease afterwards.
 */
export async function handleApprovalDecision(
  persistence: PersistencePort,
  command: HarnessCommand,
): Promise<HandleResult> {
  const runId = command.runId;
  if (!runId) {
    return { ok: false, code: "validation", message: "approval_decision requires runId" };
  }
  if (command.expectedRevision === undefined) {
    return {
      ok: false,
      code: "validation",
      message: "approval_decision requires expectedRevision",
    };
  }

  const payload = command.payload as ApprovalDecisionPayload | undefined;
  if (!payload?.approvalId || (payload.decision !== "approved" && payload.decision !== "rejected")) {
    return {
      ok: false,
      code: "validation",
      message: "approval_decision payload.approvalId and decision required",
    };
  }

  const run = await persistence.getRun(runId);
  if (!run) {
    return { ok: false, code: "fatal", message: "run not found" };
  }
  const tenantFailure = assertCommandTenant(run, command);
  if (tenantFailure) return tenantFailure;
  if (run.status !== "awaiting_approval") {
    return {
      ok: false,
      code: "validation",
      message: `approval_decision invalid status: ${run.status}`,
    };
  }
  if (run.revision !== command.expectedRevision) {
    return { ok: false, code: "conflict", message: "expectedRevision mismatch" };
  }

  const approval = await persistence.getApproval(payload.approvalId);
  if (!approval || approval.runId !== runId) {
    return { ok: false, code: "validation", message: "approval not found for run" };
  }
  if (approval.status !== "pending") {
    return {
      ok: false,
      code: "validation",
      message: `approval not pending: ${approval.status}`,
    };
  }
  if (Date.parse(approval.expiresAt) <= Date.now()) {
    return { ok: false, code: "validation", message: "approval expired" };
  }

  const now = new Date().toISOString();
  const correlationId = command.correlationId ?? command.commandId;
  const principalId = command.actor?.principalId ?? "approver";

  if (payload.decision === "approved") {
    const next: ApprovalRecord = {
      ...approval,
      status: "approved",
      approver: {
        principalId,
        tenantId: command.tenantId,
        authContextRef: command.actor?.authContextRef,
        decidedAt: now,
      },
      decisionReason: payload.reason,
      revision: approval.revision + 1,
    };

    const uow = await persistence.beginUnitOfWork(runId);
    const result = await applyCommit(uow, {
      expectedRevision: run.revision,
      expectedLeaseEpoch: run.leaseEpoch,
      runPatch: { status: "queued" },
      approvals: [next],
      events: [
        eventBase(run, {
          eventId: `evt-approval-ok-${approval.approvalId}`,
          eventType: "approval.approved",
          expectedRevision: run.revision,
          correlationId,
          stepId: approval.stepId,
          approvalId: approval.approvalId,
          payload: { principalId },
        }),
        eventBase(run, {
          eventId: `evt-status-queued-${runId}-${run.revision}`,
          eventType: "run.status_changed",
          expectedRevision: run.revision,
          correlationId,
          payload: { from: "awaiting_approval", to: "queued" },
        }),
      ],
    });

    if (!result.ok) {
      return { ok: false, code: result.code, message: result.message };
    }
    const saved = await persistence.getRun(runId);
    if (!saved) {
      return { ok: false, code: "fatal", message: "run missing after approval" };
    }
    return {
      ok: true,
      run: saved,
      revision: result.revision,
      leaseEpoch: result.leaseEpoch,
    };
  }

  const next: ApprovalRecord = {
    ...approval,
    status: "rejected",
    approver: {
      principalId,
      tenantId: command.tenantId,
      authContextRef: command.actor?.authContextRef,
      decidedAt: now,
    },
    decisionReason: payload.reason ?? "rejected",
    revision: approval.revision + 1,
  };

  const uow = await persistence.beginUnitOfWork(runId);
  const result = await applyCommit(uow, {
    expectedRevision: run.revision,
    expectedLeaseEpoch: run.leaseEpoch,
    runPatch: { status: "failed" },
    approvals: [next],
    clearContinuation: true,
    events: [
      eventBase(run, {
        eventId: `evt-approval-rej-${approval.approvalId}`,
        eventType: "approval.rejected",
        expectedRevision: run.revision,
        correlationId,
        stepId: approval.stepId,
        approvalId: approval.approvalId,
        payload: { reason: payload.reason ?? "rejected" },
      }),
      eventBase(run, {
        eventId: `evt-run-failed-${runId}-${run.revision}`,
        eventType: "run.failed",
        expectedRevision: run.revision,
        correlationId,
        payload: { reason: "approval_rejected" },
      }),
      eventBase(run, {
        eventId: `evt-status-failed-${runId}-${run.revision}`,
        eventType: "run.status_changed",
        expectedRevision: run.revision,
        correlationId,
        payload: { from: "awaiting_approval", to: "failed" },
      }),
    ],
  });

  if (!result.ok) {
    return { ok: false, code: result.code, message: result.message };
  }
  const saved = await persistence.getRun(runId);
  if (!saved) {
    return { ok: false, code: "fatal", message: "run missing after rejection" };
  }
  return {
    ok: true,
    run: saved,
    revision: result.revision,
    leaseEpoch: result.leaseEpoch,
  };
}
