import {
  CONTRACTS_SCHEMA_VERSION,
  type EventCandidate,
  type OutboxRecord,
  type Run,
  type RunStatus,
} from "@monai/contracts";
import type { HarnessCommand, LeasePort, PersistencePort } from "@monai/ports";

import { applyCommit } from "../commit/apply-commit.js";
import { assertCommandTenant } from "./tenant-guard.js";
import type { HandleResult } from "./types.js";

function queueDedupeKey(runId: string, postCreateRevision: number): string {
  return `queue_run:${runId}:${postCreateRevision}`;
}

const TERMINAL: ReadonlySet<RunStatus> = new Set(["succeeded", "failed", "cancelled"]);

const PAUSABLE: ReadonlySet<RunStatus> = new Set([
  "running",
  "queued",
  "awaiting_approval",
  "awaiting_input",
  "waiting_child",
]);

function eventBase(
  run: Pick<Run, "tenantId" | "sessionId" | "runId">,
  args: {
    eventId: string;
    eventType: string;
    expectedRevision: number;
    correlationId: string;
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
    occurredAt: new Date().toISOString(),
    correlationId: args.correlationId,
    producer: { type: "engine", id: "runtime" },
    hash: args.eventId,
    expectedRevision: args.expectedRevision,
    payload: args.payload ?? {},
  };
}

type RunCommandOk = { ok: true; runId: string; expectedRevision: number };
type RunCommandErr = Extract<HandleResult, { ok: false }>;

function requireRunCommand(
  command: HarnessCommand,
  label: string,
): RunCommandOk | RunCommandErr {
  if (!command.runId) {
    return { ok: false, code: "validation", message: `${label} requires runId` };
  }
  if (command.expectedRevision === undefined) {
    return { ok: false, code: "validation", message: `${label} requires expectedRevision` };
  }
  return { ok: true, runId: command.runId, expectedRevision: command.expectedRevision };
}

async function releaseLeaseIfHeld(
  lease: LeasePort | undefined,
  run: Run,
  ownerHint?: string,
): Promise<void> {
  if (!lease || run.status !== "running") return;
  const ownerId = ownerHint ?? "harness-worker";
  try {
    await lease.release(run.runId, ownerId, run.leaseEpoch);
  } catch {
    // Best-effort; Run truth is updated via CommitPlan regardless.
  }
}

/**
 * pause_run: active/waiting → paused (design 03). Does not go directly to running on resume.
 */
export async function handlePauseRun(
  persistence: PersistencePort,
  lease: LeasePort | undefined,
  command: HarnessCommand,
): Promise<HandleResult> {
  const req = requireRunCommand(command, "pause_run");
  if (!req.ok) return req;

  const run = await persistence.getRun(req.runId);
  if (!run) return { ok: false, code: "fatal", message: "run not found" };
  const tenantFailure = assertCommandTenant(run, command);
  if (tenantFailure) return tenantFailure;
  if (run.status === "paused") {
    return { ok: true, run, revision: run.revision, leaseEpoch: run.leaseEpoch, idempotent: true };
  }
  if (TERMINAL.has(run.status)) {
    return { ok: false, code: "validation", message: `cannot pause terminal status: ${run.status}` };
  }
  if (!PAUSABLE.has(run.status)) {
    return { ok: false, code: "validation", message: `cannot pause status: ${run.status}` };
  }
  if (run.revision !== req.expectedRevision) {
    return { ok: false, code: "conflict", message: "expectedRevision mismatch" };
  }

  await releaseLeaseIfHeld(lease, run, command.actor?.principalId);
  const correlationId = command.correlationId ?? command.commandId;
  const uow = await persistence.beginUnitOfWork(req.runId);
  const result = await applyCommit(uow, {
    expectedRevision: run.revision,
    expectedLeaseEpoch: run.leaseEpoch,
    runPatch: { status: "paused" },
    events: [
      eventBase(run, {
        eventId: `evt-paused-${req.runId}-${run.revision}`,
        eventType: "run.status_changed",
        expectedRevision: run.revision,
        correlationId,
        payload: { from: run.status, to: "paused" },
      }),
    ],
  });
  if (!result.ok) return { ok: false, code: result.code, message: result.message };
  const saved = await persistence.getRun(req.runId);
  if (!saved) return { ok: false, code: "fatal", message: "run missing after pause" };
  return { ok: true, run: saved, revision: result.revision, leaseEpoch: result.leaseEpoch };
}

/**
 * resume_run: paused → queued + outbox (never directly to running).
 */
export async function handleResumeRun(
  persistence: PersistencePort,
  command: HarnessCommand,
): Promise<HandleResult> {
  const req = requireRunCommand(command, "resume_run");
  if (!req.ok) return req;

  const run = await persistence.getRun(req.runId);
  if (!run) return { ok: false, code: "fatal", message: "run not found" };
  const tenantFailure = assertCommandTenant(run, command);
  if (tenantFailure) return tenantFailure;
  if (run.status === "queued" || run.status === "running") {
    return { ok: true, run, revision: run.revision, leaseEpoch: run.leaseEpoch, idempotent: true };
  }
  if (run.status !== "paused") {
    return { ok: false, code: "validation", message: `resume_run invalid status: ${run.status}` };
  }
  if (run.revision !== req.expectedRevision) {
    return { ok: false, code: "conflict", message: "expectedRevision mismatch" };
  }

  const correlationId = command.correlationId ?? command.commandId;
  const now = new Date().toISOString();
  const postRevision = run.revision + 1;
  const outbox: OutboxRecord = {
    schemaVersion: CONTRACTS_SCHEMA_VERSION,
    outboxRecordId: `ob-resume-${req.runId}-${postRevision}`,
    message: {
      messageType: "queue_run",
      tenantId: run.tenantId,
      aggregateRef: {
        aggregateType: "run",
        aggregateId: req.runId,
        revision: postRevision,
      },
      dedupeKey: queueDedupeKey(req.runId, postRevision),
      payloadHash: queueDedupeKey(req.runId, postRevision),
      availableAt: now,
      payload: {
        runId: req.runId,
        revision: postRevision,
        messageType: "queue_run",
        tenantId: run.tenantId,
      },
    },
    status: "pending",
    publishAttempts: 0,
    revision: 0,
    createdAt: now,
    updatedAt: now,
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
  };

  const uow = await persistence.beginUnitOfWork(req.runId);
  const result = await applyCommit(uow, {
    expectedRevision: run.revision,
    expectedLeaseEpoch: run.leaseEpoch,
    runPatch: { status: "queued" },
    events: [
      eventBase(run, {
        eventId: `evt-resume-queued-${req.runId}-${run.revision}`,
        eventType: "run.queued",
        expectedRevision: run.revision,
        correlationId,
        payload: { from: "paused", to: "queued" },
      }),
    ],
    outbox: [outbox],
  });
  if (!result.ok) return { ok: false, code: result.code, message: result.message };
  const saved = await persistence.getRun(req.runId);
  if (!saved) return { ok: false, code: "fatal", message: "run missing after resume" };
  return { ok: true, run: saved, revision: result.revision, leaseEpoch: result.leaseEpoch };
}

/**
 * cancel_run: non-terminal → cancelled.
 */
export async function handleCancelRun(
  persistence: PersistencePort,
  lease: LeasePort | undefined,
  command: HarnessCommand,
): Promise<HandleResult> {
  const req = requireRunCommand(command, "cancel_run");
  if (!req.ok) return req;

  const run = await persistence.getRun(req.runId);
  if (!run) return { ok: false, code: "fatal", message: "run not found" };
  const tenantFailure = assertCommandTenant(run, command);
  if (tenantFailure) return tenantFailure;
  if (run.status === "cancelled") {
    return { ok: true, run, revision: run.revision, leaseEpoch: run.leaseEpoch, idempotent: true };
  }
  if (TERMINAL.has(run.status)) {
    return { ok: false, code: "validation", message: `cannot cancel terminal status: ${run.status}` };
  }
  if (run.revision !== req.expectedRevision) {
    return { ok: false, code: "conflict", message: "expectedRevision mismatch" };
  }

  await releaseLeaseIfHeld(lease, run, command.actor?.principalId);
  const correlationId = command.correlationId ?? command.commandId;
  const uow = await persistence.beginUnitOfWork(req.runId);
  const result = await applyCommit(uow, {
    expectedRevision: run.revision,
    expectedLeaseEpoch: run.leaseEpoch,
    runPatch: { status: "cancelled" },
    events: [
      eventBase(run, {
        eventId: `evt-cancelled-${req.runId}-${run.revision}`,
        eventType: "run.cancelled",
        expectedRevision: run.revision,
        correlationId,
        payload: { from: run.status, to: "cancelled" },
      }),
    ],
  });
  if (!result.ok) return { ok: false, code: result.code, message: result.message };
  const saved = await persistence.getRun(req.runId);
  if (!saved) return { ok: false, code: "fatal", message: "run missing after cancel" };
  return { ok: true, run: saved, revision: result.revision, leaseEpoch: result.leaseEpoch };
}
