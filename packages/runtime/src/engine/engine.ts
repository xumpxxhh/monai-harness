import {
  CONTRACTS_SCHEMA_VERSION,
  createInitialRun,
  type AcceptanceCheck,
  type EventCandidate,
  type IdempotencyRecord,
  type ModelPolicy,
  type OutboxRecord,
  type Run,
} from "@monai/contracts";
import type {
  HarnessCommand,
  IdempotencyPort,
  ExecutionManifestStorePort,
  LeasePort,
  ModelPort,
  PersistencePort,
} from "@monai/ports";

import { applyCommit } from "../commit/apply-commit.js";
import type { ExtensionRegistry } from "../extension/extension-registry.js";
import { HookRunner } from "../hooks/hook-runner.js";
import { freezeExecutionManifest } from "../manifest/freeze-manifest.js";
import { resolveRunExecutionPolicy } from "../manifest/resolve-manifest.js";
import { RecoveryService } from "../recovery/recovery-service.js";
import { handleApprovalDecision } from "./approval-commands.js";
import {
  handleCancelRun,
  handlePauseRun,
  handleResumeRun,
} from "./control-commands.js";
import { handleExecuteTurn } from "./execute-turn.js";
import { handleSubmitInput } from "./input-commands.js";
import {
  handleReconcileTool,
  handleToolDispatchTerminal,
} from "./tool-commands.js";
import { assertCommandTenant } from "./tenant-guard.js";
import type { HandleResult } from "./types.js";

export type CreateRunPayload = {
  runId: string;
  sessionId: string;
  agentDefinitionId: string;
  agentVersion: string;
  executionManifestRef: string;
  packVersions: Array<{ packId: string; version: string }>;
  goal: string;
  strategy: { type: "light" | "dag"; version: string };
  budgets?: Record<string, unknown>;
  inputRef?: string;
  /** Agent Definition acceptance checks copied into frozen manifest (P9a2). */
  acceptanceChecks?: readonly AcceptanceCheck[];
};

export type EngineDeps = {
  persistence: PersistencePort & IdempotencyPort;
  lease: LeasePort;
  /** Required for execute_turn (P3). */
  model?: ModelPort;
  hooks?: HookRunner;
  toolAllowlist?: readonly string[];
  requireApprovalTools?: readonly string[];
  /** Agent Definition required acceptanceChecks; empty means finish is ungated. */
  acceptanceChecks?: readonly AcceptanceCheck[];
  /** Model policy specification (target, fallback, maxRetries). */
  modelPolicy?: ModelPolicy;
  /** Default lease TTL when acquire_lease succeeds. */
  leaseTtlMs?: number;
  /** Registered Pack contracts (P9a); falls back to TOOL_CATALOG when unset. */
  registry?: ExtensionRegistry;
  /** Immutable manifest store; CreateRun freezes manifest when set with registry (P9a2). */
  manifestStore?: ExecutionManifestStorePort;
};

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

function isManifestPolicyFailure(
  value: Awaited<ReturnType<typeof resolveRunExecutionPolicy>>,
): value is { ok: false; code: "fatal"; message: string } {
  return "ok" in value && value.ok === false;
}

function queueDedupeKey(runId: string, postCreateRevision: number): string {
  return `queue_run:${runId}:${postCreateRevision}`;
}

/**
 * Engine: create_run / queue_run / acquire_lease / execute_turn.
 * Unique mutable submit path via Persistence CommitPlan.
 */
export class Engine {
  private readonly persistence: PersistencePort & IdempotencyPort;
  private readonly lease: LeasePort;
  private readonly model: ModelPort | undefined;
  private readonly hooks: HookRunner;
  private readonly toolAllowlist: readonly string[] | undefined;
  private readonly requireApprovalTools: readonly string[] | undefined;
  private readonly acceptanceChecks: readonly AcceptanceCheck[] | undefined;
  private readonly leaseTtlMs: number;
  private readonly registry: ExtensionRegistry | undefined;
  private readonly manifestStore: ExecutionManifestStorePort | undefined;
  private readonly modelPolicy: ModelPolicy | undefined;

  constructor(deps: EngineDeps) {
    this.persistence = deps.persistence;
    this.lease = deps.lease;
    this.model = deps.model;
    this.hooks = deps.hooks ?? new HookRunner();
    this.toolAllowlist = deps.toolAllowlist;
    this.requireApprovalTools = deps.requireApprovalTools;
    this.acceptanceChecks = deps.acceptanceChecks;
    this.leaseTtlMs = deps.leaseTtlMs ?? 30_000;
    this.registry = deps.registry;
    this.manifestStore = deps.manifestStore;
    this.modelPolicy = deps.modelPolicy;
  }

  async handle(command: HarnessCommand): Promise<HandleResult> {
    switch (command.commandType) {
      case "create_run":
        return this.handleCreateRun(command);
      case "queue_run":
        return this.handleQueueRun(command);
      case "acquire_lease":
        return this.handleAcquireLease(command);
      case "execute_turn":
        return this.handleExecuteTurnCommand(command);
      case "tool_dispatch_result":
        return handleToolDispatchTerminal(this.persistence, command);
      case "reconcile_tool":
        return handleReconcileTool(this.persistence, command);
      case "approval_decision":
        return handleApprovalDecision(this.persistence, command);
      case "submit_input":
        return handleSubmitInput(this.persistence, command);
      case "pause_run":
        return handlePauseRun(this.persistence, this.lease, command);
      case "resume_run":
        return handleResumeRun(this.persistence, command);
      case "cancel_run":
        return handleCancelRun(this.persistence, this.lease, command);
      default:
        return {
          ok: false,
          code: "validation",
          message: `commandType not implemented: ${command.commandType}`,
        };
    }
  }

  private async handleExecuteTurnCommand(command: HarnessCommand): Promise<HandleResult> {
    if (!this.model) {
      return {
        ok: false,
        code: "validation",
        message: "execute_turn requires EngineDeps.model",
      };
    }

    const runId = command.runId;
    if (!runId) {
      return { ok: false, code: "validation", message: "execute_turn requires runId" };
    }
    const run = await this.persistence.getRun(runId);
    if (!run) {
      return { ok: false, code: "fatal", message: "run not found" };
    }

    const policy = await resolveRunExecutionPolicy(this.manifestStore, run, {
      toolAllowlist: this.toolAllowlist,
      requireApprovalTools: this.requireApprovalTools,
      acceptanceChecks: this.acceptanceChecks,
    });
    if (isManifestPolicyFailure(policy)) {
      return policy;
    }
    const resolved = policy;

    return handleExecuteTurn(
      {
        persistence: this.persistence,
        lease: this.lease,
        model: this.model,
        hooks: this.hooks,
        toolAllowlist: resolved.toolAllowlist,
        requireApprovalTools: resolved.requireApprovalTools,
        acceptanceChecks: resolved.acceptanceChecks,
        registry: this.registry,
        modelPolicy: resolved.modelPolicy ?? this.modelPolicy,
      },
      command,
    );
  }

  private async handleCreateRun(command: HarnessCommand): Promise<HandleResult> {
    const payload = command.payload as CreateRunPayload | undefined;
    if (!payload?.runId) {
      return { ok: false, code: "validation", message: "create_run payload.runId required" };
    }

    const dedupeKey = `create_run:${command.tenantId}:${command.commandId}`;
    const existingIdem = await this.persistence.get("create_run", command.tenantId, dedupeKey);
    if (existingIdem?.resultRef?.runId) {
      const run = await this.persistence.getRun(existingIdem.resultRef.runId);
      if (run) {
        return {
          ok: true,
          run,
          revision: run.revision,
          leaseEpoch: run.leaseEpoch,
          idempotent: true,
        };
      }
    }

    let executionManifestHash: string | undefined;
    if (this.manifestStore && this.registry) {
      const effectiveAllowlist = this.toolAllowlist ?? this.registry.getToolAllowlist();
      const frozen = await freezeExecutionManifest(this.manifestStore, {
        executionManifestRef: payload.executionManifestRef,
        tenantId: command.tenantId,
        agentDefinitionId: payload.agentDefinitionId,
        agentVersion: payload.agentVersion,
        packVersions: payload.packVersions,
        strategy: payload.strategy,
        registry: this.registry,
        toolAllowlist: effectiveAllowlist,
        requireApprovalTools: this.requireApprovalTools,
        acceptanceChecks: payload.acceptanceChecks ?? this.acceptanceChecks,
        budgets: payload.budgets,
      });
      if (!frozen.ok) {
        return { ok: false, code: frozen.code, message: frozen.message };
      }
      executionManifestHash = frozen.hash;
    }

    const run = createInitialRun({
      runId: payload.runId,
      tenantId: command.tenantId,
      sessionId: payload.sessionId,
      agentDefinitionId: payload.agentDefinitionId,
      agentVersion: payload.agentVersion,
      executionManifestRef: payload.executionManifestRef,
      executionManifestHash,
      packVersions: payload.packVersions,
      goal: payload.goal,
      strategy: payload.strategy,
      budgets: payload.budgets ?? {},
      inputRef: payload.inputRef,
    });

    const postCreateRevision = 1;
    const correlationId = command.correlationId ?? command.commandId;
    const now = new Date().toISOString();

    const idempotency: IdempotencyRecord = {
      schemaVersion: CONTRACTS_SCHEMA_VERSION,
      idempotencyRecordId: `idem-${command.commandId}`,
      namespace: "create_run",
      tenantId: command.tenantId,
      key: command.commandId,
      dedupeKey,
      requestHash: command.commandId,
      ownerRef: { ownerType: "run", runId: run.runId },
      resultRef: { resultType: "run", runId: run.runId },
      status: "completed",
      revision: 0,
      createdAt: now,
      updatedAt: now,
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      completedAt: now,
    };

    const outbox: OutboxRecord = {
      schemaVersion: CONTRACTS_SCHEMA_VERSION,
      outboxRecordId: `ob-${run.runId}-${postCreateRevision}`,
      message: {
        messageType: "queue_run",
        tenantId: command.tenantId,
        aggregateRef: {
          aggregateType: "run",
          aggregateId: run.runId,
          revision: postCreateRevision,
        },
        dedupeKey: queueDedupeKey(run.runId, postCreateRevision),
        payloadHash: queueDedupeKey(run.runId, postCreateRevision),
        availableAt: now,
        payload: {
          runId: run.runId,
          revision: postCreateRevision,
          messageType: "queue_run",
          tenantId: command.tenantId,
        },
      },
      status: "pending",
      publishAttempts: 0,
      revision: 0,
      createdAt: now,
      updatedAt: now,
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    };

    const uow = await this.persistence.beginUnitOfWork(run.runId);
    const result = await applyCommit(uow, {
      expectedRevision: 0,
      expectedLeaseEpoch: 0,
      runCreate: run,
      events: [
        eventBase(run, {
          eventId: `evt-created-${run.runId}`,
          eventType: "run.created",
          expectedRevision: 0,
          correlationId,
        }),
      ],
      idempotency: [idempotency],
      outbox: [outbox],
    });

    if (!result.ok) {
      return { ok: false, code: result.code, message: result.message };
    }

    const saved = await this.persistence.getRun(run.runId);
    if (!saved) {
      return { ok: false, code: "fatal", message: "run missing after create" };
    }
    return {
      ok: true,
      run: saved,
      revision: result.revision,
      leaseEpoch: result.leaseEpoch,
    };
  }

  private async handleQueueRun(command: HarnessCommand): Promise<HandleResult> {
    const runId = command.runId;
    if (!runId) {
      return { ok: false, code: "validation", message: "queue_run requires runId" };
    }
    if (command.expectedRevision === undefined) {
      return { ok: false, code: "validation", message: "queue_run requires expectedRevision" };
    }

    const run = await this.persistence.getRun(runId);
    if (!run) {
      return { ok: false, code: "fatal", message: "run not found" };
    }
    const tenantFailure = assertCommandTenant(run, command);
    if (tenantFailure) return tenantFailure;

    if (run.revision > command.expectedRevision) {
      return {
        ok: true,
        run,
        revision: run.revision,
        leaseEpoch: run.leaseEpoch,
        idempotent: true,
      };
    }

    if (run.status === "queued" || run.status === "running") {
      return {
        ok: true,
        run,
        revision: run.revision,
        leaseEpoch: run.leaseEpoch,
        idempotent: true,
      };
    }

    if (run.status !== "created") {
      return {
        ok: false,
        code: "validation",
        message: `queue_run invalid status: ${run.status}`,
      };
    }

    if (run.revision !== command.expectedRevision) {
      return { ok: false, code: "conflict", message: "expectedRevision mismatch" };
    }

    const correlationId = command.correlationId ?? command.commandId;
    const uow = await this.persistence.beginUnitOfWork(runId);
    const result = await applyCommit(uow, {
      expectedRevision: run.revision,
      expectedLeaseEpoch: run.leaseEpoch,
      runPatch: { status: "queued" },
      events: [
        eventBase(run, {
          eventId: `evt-queued-${runId}-${run.revision}`,
          eventType: "run.queued",
          expectedRevision: run.revision,
          correlationId,
        }),
      ],
    });

    if (!result.ok) {
      return { ok: false, code: result.code, message: result.message };
    }

    const saved = await this.persistence.getRun(runId);
    if (!saved) {
      return { ok: false, code: "fatal", message: "run missing after queue" };
    }
    return {
      ok: true,
      run: saved,
      revision: result.revision,
      leaseEpoch: result.leaseEpoch,
    };
  }

  private async handleAcquireLease(command: HarnessCommand): Promise<HandleResult> {
    const runId = command.runId;
    if (!runId) {
      return { ok: false, code: "validation", message: "acquire_lease requires runId" };
    }
    if (command.expectedRevision === undefined) {
      return { ok: false, code: "validation", message: "acquire_lease requires expectedRevision" };
    }

    const ownerId = command.actor?.principalId ?? "scheduler";
    const run = await this.persistence.getRun(runId);
    if (!run) {
      return { ok: false, code: "fatal", message: "run not found" };
    }
    const tenantFailure = assertCommandTenant(run, command);
    if (tenantFailure) return tenantFailure;

    if (run.status === "running" && run.revision >= command.expectedRevision) {
      return {
        ok: true,
        run,
        revision: run.revision,
        leaseEpoch: run.leaseEpoch,
        idempotent: true,
      };
    }

    if (run.status !== "queued") {
      return {
        ok: false,
        code: "validation",
        message: `acquire_lease invalid status: ${run.status}`,
      };
    }

    if (run.revision !== command.expectedRevision) {
      return { ok: false, code: "conflict", message: "expectedRevision mismatch" };
    }

    const newEpoch = run.leaseEpoch + 1;
    const correlationId = command.correlationId ?? command.commandId;
    const uow = await this.persistence.beginUnitOfWork(runId);
    const result = await applyCommit(uow, {
      expectedRevision: run.revision,
      expectedLeaseEpoch: run.leaseEpoch,
      runPatch: { status: "running", leaseEpoch: newEpoch },
      events: [
        eventBase(run, {
          eventId: `evt-lease-${runId}-${run.revision}`,
          eventType: "run.lease_acquired",
          expectedRevision: run.revision,
          correlationId,
          payload: { leaseEpoch: newEpoch, ownerId },
        }),
      ],
    });

    if (!result.ok) {
      return { ok: false, code: result.code, message: result.message };
    }

    await this.lease.bind(runId, ownerId, newEpoch, this.leaseTtlMs);

    const recovery = new RecoveryService({
      persistence: this.persistence,
      lease: this.lease,
      manifestStore: this.manifestStore,
    });
    const recovered = await recovery.recover(runId);
    if (!recovered.ok) {
      return { ok: false, code: recovered.code, message: recovered.message };
    }

    const saved = await this.persistence.getRun(runId);
    if (!saved) {
      return { ok: false, code: "fatal", message: "run missing after acquire_lease" };
    }
    return {
      ok: true,
      run: saved,
      revision: result.revision,
      leaseEpoch: result.leaseEpoch,
    };
  }
}

export { queueDedupeKey };
