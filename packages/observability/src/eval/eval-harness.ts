import { buildCreateRunCommand } from "@monai/api";
import { CONTRACTS_SCHEMA_VERSION, type AcceptanceCheck } from "@monai/contracts";
import type { HarnessCommand, PersistencePort } from "@monai/ports";
import { InMemoryLease } from "@monai/lease-memory";
import { StubModelPort } from "@monai/model-stub";
import { InMemoryPersistence } from "@monai/persistence-memory";
import { InMemoryQueue } from "@monai/queue-memory";
import { wireWorkspaceGenericPack, type WireWorkspaceGenericResult } from "@monai/delivery";
import { InMemoryWorkspace } from "@monai/workspace-memory";
import { Engine, InMemoryManifestStore } from "@monai/runtime";
import type { ApprovalRecord, Continuation } from "@monai/contracts";
import type { ModelPort } from "@monai/ports";
import { CompensationScanner, OutboxDispatcher, Scheduler, ToolDispatcher } from "@monai/delivery";
import { computeRunMetrics } from "../metrics/compute-metrics.js";

export type EvalCaseResult = {
  caseId: string;
  suiteId: string;
  ok: boolean;
  message?: string;
};

export type CreateEvalContextOptions = {
  requireApprovalTools?: readonly string[];
  acceptanceChecks?: readonly AcceptanceCheck[];
  workspaceFiles?: Record<string, string>;
  leaseTtlMs?: number;
  model?: ModelPort;
};

export type EvalCaseDefinition = {
  caseId: string;
  setup?: CreateEvalContextOptions;
  run: (ctx: EvalContext, meta: { repetition: number }) => Promise<void>;
};

export type EvalSuiteDefinition = {
  suiteId: string;
  /** design 08 threshold expression for reporting */
  threshold: string;
  minPassRate: number;
  /** design 08 §5.1 per-case repetitions; default 1 */
  repetitions?: number;
  context?: CreateEvalContextOptions;
  cases: EvalCaseDefinition[];
};

export type EvalContext = {
  persistence: InMemoryPersistence;
  lease: InMemoryLease;
  queue: InMemoryQueue;
  engine: Engine;
  dispatcher: OutboxDispatcher;
  scheduler: Scheduler;
  compensation: CompensationScanner;
  tools: ToolDispatcher;
  workspace: InMemoryWorkspace;
  pack: WireWorkspaceGenericResult;
  manifestStore: InMemoryManifestStore;
  /** Lease owner used by Scheduler.acquire_lease (default scheduler). */
  leaseOwnerId: string;
};

export type EvalSuiteResult = {
  suiteId: string;
  total: number;
  passed: number;
  passRate: number;
  threshold: string;
  minPassRate: number;
  ok: boolean;
  cases: EvalCaseResult[];
};

export function cmd(
  partial: Partial<HarnessCommand> & Pick<HarnessCommand, "commandType" | "commandId">,
): HarnessCommand {
  return {
    schemaVersion: CONTRACTS_SCHEMA_VERSION,
    tenantId: "t1",
    issuedAt: new Date().toISOString(),
    ...partial,
  };
}

const DEFAULT_WORKSPACE_FILES: Record<string, string> = {
  "/readme.md": "hello workspace",
  "/notes/search-me.md": "retrievable workspace notes",
};

export const GOLDEN_FINISH_GATE: AcceptanceCheck[] = [
  {
    checkId: "finish.allowed",
    validatorRef: { validatorId: "core.finish_gate", version: "0.1.0" },
    inputSelector: {
      selectorVersion: "1",
      selectorType: "state_ref",
      selector: "/cursor",
      schemaRef: "schema://run-state-cursor",
      required: false,
    },
    required: true,
  },
];

export const GOLDEN_FACTS_PRESENT_CHECKS: AcceptanceCheck[] = [
  ...GOLDEN_FINISH_GATE,
  {
    checkId: "facts.present",
    validatorRef: { validatorId: "core.state_last_fact", version: "0.1.0" },
    inputSelector: {
      selectorVersion: "1",
      selectorType: "json_pointer",
      selector: "/lastFactId",
      schemaRef: "schema://run-state-last-fact",
      required: true,
    },
    required: true,
  },
];

export function createEvalContext(options?: CreateEvalContextOptions): EvalContext {
  const persistence = new InMemoryPersistence();
  const lease = new InMemoryLease();
  const queue = new InMemoryQueue();
  const workspace = new InMemoryWorkspace(options?.workspaceFiles ?? DEFAULT_WORKSPACE_FILES);
  const pack = wireWorkspaceGenericPack({ workspace, tenantId: "t1" });
  const manifestStore = new InMemoryManifestStore();
  const engine = new Engine({
    persistence,
    lease,
    model: options?.model ?? new StubModelPort(),
    hooks: pack.hookRunner,
    registry: pack.registry,
    manifestStore,
    toolAllowlist: pack.toolAllowlist,
    requireApprovalTools: options?.requireApprovalTools ?? pack.requireApprovalTools,
    acceptanceChecks: options?.acceptanceChecks,
    leaseTtlMs: options?.leaseTtlMs,
  });
  const dispatcher = new OutboxDispatcher({ outbox: persistence, queue });
  const scheduler = new Scheduler({ queue, engine });
  const compensation = new CompensationScanner({
    store: persistence,
    queue,
    createdStaleMs: 0,
  });
  const tools = new ToolDispatcher({
    outbox: persistence,
    persistence,
    engine,
    invoker: pack.invoker,
  });
  return {
    persistence,
    lease,
    queue,
    engine,
    dispatcher,
    scheduler,
    compensation,
    tools,
    workspace,
    pack,
    manifestStore,
    leaseOwnerId: "scheduler",
  };
}

export async function acquireLease(ctx: EvalContext, runId: string, ownerId = ctx.leaseOwnerId) {
  const run = await ctx.persistence.getRun(runId);
  if (!run) throw new Error("run missing");
  const result = await ctx.engine.handle(
    cmd({
      commandType: "acquire_lease",
      commandId: `lease-${runId}-${run.revision}`,
      runId,
      expectedRevision: run.revision,
      actor: { principalId: ownerId },
    }),
  );
  if (!result.ok) throw new Error(result.message ?? "acquire_lease failed");
  return result;
}

export async function patchApprovalForEval(
  ctx: EvalContext,
  approvalId: string,
  patch: Partial<Pick<ApprovalRecord, "expiresAt" | "status">>,
) {
  const approval = await ctx.persistence.getApproval(approvalId);
  if (!approval) throw new Error("approval missing");
  const run = await ctx.persistence.getRun(approval.runId);
  if (!run) throw new Error("run missing");
  const uow = await ctx.persistence.beginUnitOfWork(approval.runId);
  const result = await uow.commit({
    expectedRevision: run.revision,
    expectedLeaseEpoch: run.leaseEpoch,
    approvals: [{ ...approval, ...patch, revision: approval.revision + 1 }],
    events: [],
  });
  if (!result.ok) throw new Error(result.message ?? "patch approval failed");
}

export async function patchContinuationForEval(
  ctx: EvalContext,
  runId: string,
  patch: Partial<Continuation>,
) {
  const continuation = await ctx.persistence.getContinuation(runId);
  if (!continuation) throw new Error("continuation missing");
  const run = await ctx.persistence.getRun(runId);
  if (!run) throw new Error("run missing");
  const uow = await ctx.persistence.beginUnitOfWork(runId);
  const result = await uow.commit({
    expectedRevision: run.revision,
    expectedLeaseEpoch: run.leaseEpoch,
    continuation: { ...continuation, ...patch },
    events: [],
  });
  if (!result.ok) throw new Error(result.message ?? "patch continuation failed");
}

export async function bootstrapRunning(
  ctx: EvalContext,
  runId: string,
  goal: string,
): Promise<void> {
  const created = await ctx.engine.handle(
    buildCreateRunCommand({
      tenantId: "t1",
      commandId: `create-${runId}`,
      runId,
      sessionId: "s1",
      agentDefinitionId: "agent",
      agentVersion: "1",
      executionManifestRef: "manifest://m1",
      packVersions: [{ packId: "core", version: "0.1.0" }],
      goal,
      strategy: { type: "light", version: "1" },
    }),
  );
  if (!created.ok) throw new Error(created.message ?? "create failed");
  const dispatched = await ctx.dispatcher.tick();
  if (dispatched <= 0) throw new Error("outbox dispatch produced no rows");
  const scheduled = await ctx.scheduler.tick();
  if (scheduled <= 0) throw new Error("scheduler produced no lease");
  const run = await ctx.persistence.getRun(runId);
  if (run?.status !== "running") {
    throw new Error(`expected running, got ${run?.status}`);
  }
}

export async function executeTurn(ctx: EvalContext, runId: string): Promise<void> {
  const run = await ctx.persistence.getRun(runId);
  if (!run) throw new Error("run missing");
  const turn = await ctx.engine.handle(
    cmd({
      commandType: "execute_turn",
      commandId: `turn-${runId}-${run.revision}`,
      runId,
      expectedRevision: run.revision,
      leaseEpoch: run.leaseEpoch,
      actor: { principalId: ctx.leaseOwnerId },
    }),
  );
  if (!turn.ok) throw new Error(turn.message ?? "execute_turn failed");
}

export async function dispatchPrepared(ctx: EvalContext, runId: string): Promise<void> {
  const n = await ctx.tools.tick();
  if (n <= 0) throw new Error("tool dispatcher produced no work");
  const events = await ctx.persistence.listEvents(runId);
  if (!events.some((e) => e.eventType === "tool.succeeded")) {
    throw new Error("expected tool.succeeded after dispatch");
  }
}

async function assertEvent(ctx: EvalContext, runId: string, eventType: string): Promise<void> {
  const events = await ctx.persistence.listEvents(runId);
  if (!events.some((e) => e.eventType === eventType)) {
    throw new Error(`missing ${eventType}`);
  }
}

/** design 08 §5.1 Golden 主路径：读取、检索、Artifact、Fact/State、acceptanceChecks、finish × 5. */
export const GOLDEN_REPETITIONS = 5;

export const GOLDEN_EVAL_SUITE: EvalSuiteDefinition = {
  suiteId: "golden-main-paths",
  threshold: "design 08 Golden 6×5=30 @ 90%; required acceptanceChecks must not be skipped",
  minPassRate: 0.9,
  repetitions: GOLDEN_REPETITIONS,
  context: { acceptanceChecks: GOLDEN_FINISH_GATE, requireApprovalTools: [] },
  cases: [
    {
      caseId: "golden-read",
      run: async (ctx, { repetition }) => {
        const runId = `eval-golden-read-${repetition}`;
        await bootstrapRunning(ctx, runId, "please workspace-read");
        await executeTurn(ctx, runId);
        await dispatchPrepared(ctx, runId);
        const state = await ctx.persistence.getState(runId);
        if (!state?.facts[0]?.summary.includes("read")) {
          throw new Error(`expected read fact, got ${state?.facts[0]?.summary}`);
        }
      },
    },
    {
      caseId: "golden-search",
      run: async (ctx, { repetition }) => {
        const runId = `eval-golden-search-${repetition}`;
        await bootstrapRunning(ctx, runId, "please workspace-search");
        await executeTurn(ctx, runId);
        await dispatchPrepared(ctx, runId);
        const state = await ctx.persistence.getState(runId);
        if (!state?.facts[0]?.summary.includes("search")) {
          throw new Error(`expected search fact, got ${state?.facts[0]?.summary}`);
        }
      },
    },
    {
      caseId: "golden-artifact",
      run: async (ctx, { repetition }) => {
        const runId = `eval-golden-artifact-${repetition}`;
        await bootstrapRunning(ctx, runId, "please write artifact");
        await executeTurn(ctx, runId);
        await dispatchPrepared(ctx, runId);
        const state = await ctx.persistence.getState(runId);
        const summary = state?.facts[0]?.summary ?? "";
        if (!summary.includes("artifact")) {
          throw new Error(`expected artifact fact, got ${summary}`);
        }
      },
    },
    {
      caseId: "golden-fact-state",
      run: async (ctx, { repetition }) => {
        const runId = `eval-golden-fact-${repetition}`;
        await bootstrapRunning(ctx, runId, "hello world");
        await executeTurn(ctx, runId);
        await dispatchPrepared(ctx, runId);
        await assertEvent(ctx, runId, "fact.accepted");
        await assertEvent(ctx, runId, "state.reduced");
        const state = await ctx.persistence.getState(runId);
        if (!state?.lastFactId) throw new Error("state.lastFactId missing");
        if (state.cursor.stepCount < 1) throw new Error("state cursor not advanced");
      },
    },
    {
      caseId: "golden-acceptance-checks",
      setup: {
        acceptanceChecks: GOLDEN_FACTS_PRESENT_CHECKS,
        requireApprovalTools: [],
      },
      run: async (ctx, { repetition }) => {
        const runId = `eval-golden-acc-${repetition}`;
        await bootstrapRunning(ctx, runId, "acceptance-check path");
        await executeTurn(ctx, runId);
        await dispatchPrepared(ctx, runId);
        await executeTurn(ctx, runId);
        const run = await ctx.persistence.getRun(runId);
        if (run?.status !== "succeeded") {
          throw new Error(`expected succeeded after checks, got ${run?.status}`);
        }
        const finishPayload = (await ctx.persistence.listEvents(runId))
          .filter((e) => e.eventType === "action.accepted")
          .at(-1)?.payload as
          | { acceptanceChecks?: Array<{ checkId: string; decision: string }> }
          | undefined;
        const checks = finishPayload?.acceptanceChecks;
        if (!checks?.some((c) => c.checkId === "facts.present" && c.decision === "pass")) {
          throw new Error("required facts.present check was skipped or did not pass");
        }
        if (!checks.some((c) => c.checkId === "finish.allowed" && c.decision === "pass")) {
          throw new Error("required finish.allowed check was skipped");
        }
      },
    },
    {
      caseId: "golden-finish",
      run: async (ctx, { repetition }) => {
        const runId = `eval-golden-finish-${repetition}`;
        await bootstrapRunning(ctx, runId, "please finish");
        await executeTurn(ctx, runId);
        const run = await ctx.persistence.getRun(runId);
        if (run?.status !== "succeeded") {
          throw new Error(`expected succeeded, got ${run?.status}`);
        }
        const accepted = (await ctx.persistence.listEvents(runId)).find(
          (e) => e.eventType === "action.accepted",
        );
        const checks = (accepted?.payload as { acceptanceChecks?: Array<{ checkId: string }> } | undefined)
          ?.acceptanceChecks;
        if (!checks?.some((c) => c.checkId === "finish.allowed")) {
          throw new Error("required finish.allowed check was skipped");
        }
      },
    },
  ],
};

export class EvalHarness {
  async runSuite(suite: EvalSuiteDefinition): Promise<EvalSuiteResult> {
    const cases: EvalCaseResult[] = [];
    const repetitions = suite.repetitions ?? 1;
    for (const evalCase of suite.cases) {
      for (let repetition = 1; repetition <= repetitions; repetition += 1) {
        const ctx = createEvalContext({ ...suite.context, ...evalCase.setup });
        const caseId = repetitions > 1 ? `${evalCase.caseId}#${repetition}` : evalCase.caseId;
        try {
          await evalCase.run(ctx, { repetition });
          cases.push({ caseId, suiteId: suite.suiteId, ok: true });
        } catch (err) {
          cases.push({
            caseId,
            suiteId: suite.suiteId,
            ok: false,
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }
    const passed = cases.filter((c) => c.ok).length;
    const passRate = cases.length > 0 ? passed / cases.length : 0;
    return {
      suiteId: suite.suiteId,
      total: cases.length,
      passed,
      passRate,
      threshold: suite.threshold,
      minPassRate: suite.minPassRate,
      ok: passRate >= suite.minPassRate,
      cases,
    };
  }

  async runAll(suites: EvalSuiteDefinition[]): Promise<EvalSuiteResult[]> {
    const results: EvalSuiteResult[] = [];
    for (const suite of suites) {
      results.push(await this.runSuite(suite));
    }
    return results;
  }
}

/** Metrics helper for observability over arbitrary persistence. */
export async function metricsForRun(persistence: PersistencePort, runId: string) {
  const run = await persistence.getRun(runId);
  if (!run) return undefined;
  const events = await persistence.listEvents(runId);
  return computeRunMetrics(events, run);
}
