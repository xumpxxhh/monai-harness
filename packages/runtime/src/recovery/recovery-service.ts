import {
  CONTRACTS_SCHEMA_VERSION,
  type Checkpoint,
  type Continuation,
  type ErrorCategory,
  type EventEnvelope,
  type Run,
  type RunState,
  type ToolCallRecord,
} from "@monai/contracts";
import type { LeasePort, PersistencePort } from "@monai/ports";

import { applyCommit } from "../commit/apply-commit.js";
import { computeStateHash } from "./state-hash.js";
import { replayEvents } from "./replay-events.js";

export type ToolInventory = {
  prepared: ToolCallRecord[];
  dispatched: ToolCallRecord[];
  outcomeUnknown: ToolCallRecord[];
};

export type RecoverySuccess = {
  ok: true;
  state: RunState;
  stateHash: string;
  strategyCursor: Checkpoint["strategy"] | undefined;
  continuation: Continuation | undefined;
  toolInventory: ToolInventory;
  usedCheckpoint: Checkpoint | undefined;
  replayMode: "full" | "checkpoint";
};

export type RecoveryFailure = {
  ok: false;
  code: ErrorCategory;
  message: string;
};

export type RecoveryResult = RecoverySuccess | RecoveryFailure;

export type StateSnapshotPort = {
  getStateSnapshot(stateRef: string): Promise<RunState | undefined>;
};

export type RecoveryServiceDeps = {
  persistence: PersistencePort & Partial<StateSnapshotPort>;
  lease?: LeasePort;
};

function eventTailSequence(events: EventEnvelope[]): number {
  if (events.length === 0) return 0;
  return events[events.length - 1]!.sequence;
}

/** Select latest Checkpoint that is consistent with Run revision and Event tail (design 03 §11.2 step 3). */
export function selectValidCheckpoint(
  checkpoint: Checkpoint | undefined,
  run: Run,
  events: EventEnvelope[],
): Checkpoint | undefined {
  if (!checkpoint) return undefined;
  const tail = eventTailSequence(events);
  if (checkpoint.revision > run.revision) return undefined;
  if (checkpoint.sequence > tail) return undefined;
  if (checkpoint.sequence > 0 && !events.some((e) => e.sequence === checkpoint.sequence)) {
    return undefined;
  }
  return checkpoint;
}

function buildToolInventory(toolCalls: ToolCallRecord[]): ToolInventory {
  return {
    prepared: toolCalls.filter((t) => t.status === "prepared"),
    dispatched: toolCalls.filter((t) => t.status === "dispatched"),
    outcomeUnknown: toolCalls.filter((t) => t.status === "outcome_unknown"),
  };
}

function verifyManifest(run: Run): RecoveryFailure | undefined {
  if (!run.executionManifestRef || run.executionManifestRef.length === 0) {
    return { ok: false, code: "fatal", message: "execution manifest ref missing" };
  }
  return undefined;
}

/**
 * RecoveryService: Checkpoint selection + Event replay + State hash verification (P6).
 */
export class RecoveryService {
  private readonly persistence: PersistencePort & Partial<StateSnapshotPort>;
  private readonly lease: LeasePort | undefined;

  constructor(deps: RecoveryServiceDeps) {
    this.persistence = deps.persistence;
    this.lease = deps.lease;
  }

  async recover(runId: string): Promise<RecoveryResult> {
    const run = await this.persistence.getRun(runId);
    if (!run) {
      return { ok: false, code: "fatal", message: "run not found" };
    }

    const manifestErr = verifyManifest(run);
    if (manifestErr) return manifestErr;

    const events = await this.persistence.listEvents(runId);
    const toolCalls = await this.persistence.listToolCalls(runId);
    const checkpoint = selectValidCheckpoint(
      await this.persistence.getLatestCheckpoint(runId),
      run,
      events,
    );
    const persisted = await this.persistence.getState(runId);

    const fullState = replayEvents({ events, toolCalls, fromSequence: 1 });
    const fullHash = computeStateHash(fullState);

    let acceleratedState = fullState;
    let replayMode: "full" | "checkpoint" = "full";
    let usedCheckpoint: Checkpoint | undefined;

    if (checkpoint && checkpoint.sequence > 0) {
      const snapshot = this.persistence.getStateSnapshot
        ? await this.persistence.getStateSnapshot(checkpoint.stateRef)
        : undefined;
      if (snapshot && computeStateHash(snapshot) === checkpoint.stateHash) {
        acceleratedState = replayEvents({
          events,
          toolCalls,
          initialState: snapshot,
          fromSequence: checkpoint.sequence + 1,
        });
        replayMode = "checkpoint";
        usedCheckpoint = checkpoint;
      }
    }

    const acceleratedHash = computeStateHash(acceleratedState);
    if (fullHash !== acceleratedHash) {
      return {
        ok: false,
        code: "fatal",
        message: "checkpoint-accelerated replay hash mismatch with full replay",
      };
    }

    if (persisted && computeStateHash(persisted) !== fullHash) {
      return {
        ok: false,
        code: "fatal",
        message: "replayed state hash mismatch with persisted projection",
      };
    }

    const continuation = await this.persistence.getContinuation(runId);
    const waiting =
      run.status === "awaiting_approval" ||
      run.status === "awaiting_input" ||
      run.status === "waiting_child" ||
      run.status === "paused";

    return {
      ok: true,
      state: acceleratedState,
      stateHash: fullHash,
      strategyCursor: checkpoint?.strategy,
      continuation: waiting ? continuation : undefined,
      toolInventory: buildToolInventory(toolCalls),
      usedCheckpoint,
      replayMode,
    };
  }

  /**
   * If Run is still `running` but lease metadata is missing/expired, yield to `queued`
   * (design 03 §11.2 step 8).
   */
  async yieldStaleRunningRun(runId: string): Promise<RecoveryResult | RecoveryFailure> {
    const run = await this.persistence.getRun(runId);
    if (!run) {
      return { ok: false, code: "fatal", message: "run not found" };
    }
    if (run.status !== "running") {
      return this.recover(runId);
    }

    let leaseValid = false;
    if (this.lease) {
      const record = await this.lease.get(runId);
      leaseValid =
        record !== undefined &&
        record.leaseEpoch === run.leaseEpoch &&
        Date.parse(record.expiresAt) > Date.now();
    }

    if (leaseValid) {
      return this.recover(runId);
    }

    const correlationId = `yield-stale-${runId}-${run.revision}`;
    const uow = await this.persistence.beginUnitOfWork(runId);
    const result = await applyCommit(uow, {
      expectedRevision: run.revision,
      expectedLeaseEpoch: run.leaseEpoch,
      runPatch: { status: "queued" },
      events: [
        {
          schemaVersion: CONTRACTS_SCHEMA_VERSION,
          eventId: `evt-yield-${runId}-${run.revision}`,
          eventType: "run.status_changed",
          tenantId: run.tenantId,
          sessionId: run.sessionId,
          runId: run.runId,
          occurredAt: new Date().toISOString(),
          correlationId,
          producer: { type: "engine", id: "recovery" },
          hash: `evt-yield-${runId}-${run.revision}`,
          expectedRevision: run.revision,
          payload: { from: "running", to: "queued", reason: "lease_expired" },
        },
        {
          schemaVersion: CONTRACTS_SCHEMA_VERSION,
          eventId: `evt-lease-lost-yield-${runId}-${run.revision}`,
          eventType: "run.lease_lost",
          tenantId: run.tenantId,
          sessionId: run.sessionId,
          runId: run.runId,
          occurredAt: new Date().toISOString(),
          correlationId,
          producer: { type: "engine", id: "recovery" },
          hash: `evt-lease-lost-yield-${runId}-${run.revision}`,
          expectedRevision: run.revision,
          payload: { reason: "lease_expired_yield" },
        },
      ],
    });

    if (!result.ok) {
      return { ok: false, code: result.code, message: result.message ?? "yield failed" };
    }

    return this.recover(runId);
  }
}
