import { buildCreateRunCommand } from "@monai/api";
import { CONTRACTS_SCHEMA_VERSION, type Action } from "@monai/contracts";
import { StubModelPort } from "@monai/model-stub";
import type { ModelPort } from "@monai/ports";
import { RecoveryService, computeStateHash } from "@monai/runtime";

import {
  acquireLease,
  bootstrapRunning,
  cmd,
  createEvalContext,
  dispatchPrepared,
  executeTurn,
  patchApprovalForEval,
  patchContinuationForEval,
  GOLDEN_EVAL_SUITE,
  type EvalCaseDefinition,
  type EvalContext,
  type EvalSuiteDefinition,
} from "./eval-harness.js";
import { SECURITY_EVAL_SUITE } from "./eval-security-suites.js";

export const RECOVERY_REPETITIONS = 5;
export const APPROVAL_REPETITIONS = 1;
export const IDEMPOTENCY_REPETITIONS = 5;

async function dispatchEchoSuccess(
  ctx: EvalContext,
  runId: string,
  revision: number,
  leaseEpoch: number,
  toolCallId: string,
) {
  const accepted = await ctx.engine.handle(
    cmd({
      commandType: "tool_dispatch_result",
      commandId: `accept-${toolCallId}`,
      runId,
      expectedRevision: revision,
      leaseEpoch,
      payload: { toolCallId, phase: "accepted" },
    }),
  );
  if (!accepted.ok) throw new Error(accepted.message ?? "dispatch accept failed");

  const record = await ctx.persistence.getToolCall(toolCallId);
  if (!record) throw new Error("tool call missing");
  const outcome = await ctx.pack.invoker.invoke(record);

  const terminal = await ctx.engine.handle(
    cmd({
      commandType: "tool_dispatch_result",
      commandId: `term-${toolCallId}`,
      runId,
      expectedRevision: accepted.revision,
      leaseEpoch,
      payload: {
        toolCallId,
        phase: "succeeded",
        data: outcome.ok ? outcome.data : {},
        resultHash: outcome.ok ? outcome.resultHash : undefined,
      },
    }),
  );
  if (!terminal.ok) throw new Error(terminal.message ?? "dispatch terminal failed");
}

function assertPreparedBeforeDispatch(events: Array<{ eventType: string }>) {
  const preparedIdx = events.findIndex((e) => e.eventType === "tool.call_prepared");
  const dispatchedIdx = events.findIndex((e) => e.eventType === "tool.dispatched");
  if (preparedIdx < 0 || dispatchedIdx < 0) {
    throw new Error("expected tool.call_prepared and tool.dispatched");
  }
  if (preparedIdx > dispatchedIdx) {
    throw new Error("tool.call_prepared must precede tool.dispatched");
  }
}

const RECOVERY_CASES: EvalCaseDefinition[] = [
  {
    caseId: "recovery-full-replay-hash",
    run: async (ctx, { repetition }) => {
      const runId = `eval-rec-full-${repetition}`;
      await bootstrapRunning(ctx, runId, "hello world");
      await executeTurn(ctx, runId);
      const toolCall = (await ctx.persistence.listToolCalls(runId))[0];
      if (!toolCall) throw new Error("tool call missing");
      const run = await ctx.persistence.getRun(runId);
      if (!run) throw new Error("run missing");
      await dispatchEchoSuccess(ctx, runId, run.revision, run.leaseEpoch, toolCall.toolCallId);

      const recovery = new RecoveryService({
        persistence: ctx.persistence,
        lease: ctx.lease,
        manifestStore: ctx.manifestStore,
      });
      const result = await recovery.recover(runId);
      if (!result.ok) throw new Error(result.message ?? "recovery failed");
      const persisted = await ctx.persistence.getState(runId);
      if (result.stateHash !== computeStateHash(persisted)) {
        throw new Error("recovery stateHash mismatch");
      }
      if (result.replayMode !== "full") throw new Error(`expected full replay, got ${result.replayMode}`);
    },
  },
  {
    caseId: "recovery-checkpoint-accelerated",
    run: async (ctx, { repetition }) => {
      const runId = `eval-rec-cp-${repetition}`;
      await bootstrapRunning(ctx, runId, "synthetic high");
      await executeTurn(ctx, runId);
      const run = await ctx.persistence.getRun(runId);
      if (run?.status !== "awaiting_approval") {
        throw new Error(`expected awaiting_approval, got ${run?.status}`);
      }
      const cp = await ctx.persistence.getLatestCheckpoint(runId);
      if (!cp?.stateHash) throw new Error("checkpoint missing");

      const recovery = new RecoveryService({
        persistence: ctx.persistence,
        lease: ctx.lease,
        manifestStore: ctx.manifestStore,
      });
      const result = await recovery.recover(runId);
      if (!result.ok) throw new Error(result.message ?? "recovery failed");
      if (result.replayMode !== "checkpoint") {
        throw new Error(`expected checkpoint replay, got ${result.replayMode}`);
      }
      if (result.continuation?.kind !== "approval") {
        throw new Error("expected approval continuation");
      }
    },
  },
  {
    caseId: "recovery-stale-lease-dispatch",
    run: async (ctx, { repetition }) => {
      const runId = `eval-rec-stale-${repetition}`;
      await bootstrapRunning(ctx, runId, "hello world");
      await executeTurn(ctx, runId);
      const run = await ctx.persistence.getRun(runId);
      const toolCall = (await ctx.persistence.listToolCalls(runId))[0];
      if (!run || !toolCall) throw new Error("run or tool call missing");

      const stale = await ctx.engine.handle(
        cmd({
          commandType: "tool_dispatch_result",
          commandId: `stale-${toolCall.toolCallId}`,
          runId,
          expectedRevision: run.revision,
          leaseEpoch: run.leaseEpoch - 1,
          payload: { toolCallId: toolCall.toolCallId, phase: "accepted" },
        }),
      );
      if (stale.ok) throw new Error("expected stale lease dispatch to fail");
      if (stale.code !== "lease_lost") throw new Error(`expected lease_lost, got ${stale.code}`);
    },
  },
  {
    caseId: "recovery-yield-stale-running",
    setup: { leaseTtlMs: 5 },
    run: async (ctx, { repetition }) => {
      const runId = `eval-rec-yield-${repetition}`;
      await bootstrapRunning(ctx, runId, "hello");
      await new Promise((r) => setTimeout(r, 15));

      const recovery = new RecoveryService({
        persistence: ctx.persistence,
        lease: ctx.lease,
        manifestStore: ctx.manifestStore,
      });
      const yielded = await recovery.yieldStaleRunningRun(runId);
      if (!yielded.ok) throw new Error(yielded.message ?? "yield failed");
      const run = await ctx.persistence.getRun(runId);
      if (run?.status !== "queued") throw new Error(`expected queued after yield, got ${run?.status}`);
    },
  },
  {
    caseId: "recovery-outbox-queue-dedupe",
    run: async (ctx, { repetition }) => {
      const runId = `eval-rec-dup-${repetition}`;
      const created = await ctx.engine.handle(
        buildCreateRunCommand({
          tenantId: "t1",
          commandId: `create-dup-${repetition}`,
          runId,
          sessionId: "s1",
          agentDefinitionId: "agent",
          agentVersion: "1",
          executionManifestRef: "manifest://m1",
          packVersions: [],
          goal: "dup",
          strategy: { type: "light", version: "1" },
        }),
      );
      if (!created.ok) throw new Error("create failed");

      await ctx.dispatcher.tick();
      const outbox = ctx.persistence.listOutbox()[0];
      if (!outbox) throw new Error("outbox missing");
      await ctx.queue.enqueue({
        runId,
        revision: 1,
        messageType: "queue_run",
        dedupeKey: outbox.message.dedupeKey,
        payload: outbox.message.payload,
      });
      await ctx.scheduler.tick();
      await ctx.scheduler.tick();

      const events = await ctx.persistence.listEvents(runId);
      if (events.filter((e) => e.eventType === "run.queued").length !== 1) {
        throw new Error("duplicate queue_run must not duplicate run.queued");
      }
      const run = await ctx.persistence.getRun(runId);
      if (run?.status !== "running") throw new Error(`expected running, got ${run?.status}`);
    },
  },
  {
    caseId: "recovery-compensation-rebuilds-queue",
    run: async (ctx, { repetition }) => {
      const runId = `eval-rec-comp-${repetition}`;
      const created = await ctx.engine.handle(
        buildCreateRunCommand({
          tenantId: "t1",
          commandId: `create-comp-${repetition}`,
          runId,
          sessionId: "s1",
          agentDefinitionId: "agent",
          agentVersion: "1",
          executionManifestRef: "manifest://m1",
          packVersions: [],
          goal: "comp",
          strategy: { type: "light", version: "1" },
        }),
      );
      if (!created.ok) throw new Error("create failed");
      if (ctx.persistence.listOutbox()[0]?.status !== "pending") {
        throw new Error("expected pending outbox");
      }
      if (ctx.queue.size() !== 0) throw new Error("queue should start empty");

      await ctx.compensation.tick();
      if (ctx.queue.size() !== 1) throw new Error("compensation must enqueue queue signal");

      await ctx.dispatcher.tick();
      await ctx.scheduler.tick();
      const run = await ctx.persistence.getRun(runId);
      if (run?.status !== "running") throw new Error(`expected running, got ${run?.status}`);
    },
  },
  {
    caseId: "recovery-tool-timeout-reconcile",
    setup: { requireApprovalTools: [] },
    run: async (ctx, { repetition }) => {
      const runId = `eval-rec-reconcile-${repetition}`;
      ctx.pack.synthetic.setTimeoutNextWrite(true);
      await bootstrapRunning(ctx, runId, "synthetic high");
      await executeTurn(ctx, runId);
      if ((await ctx.tools.tick()) !== 1) throw new Error("expected one dispatch");

      const unknown = (await ctx.persistence.listToolCalls(runId))[0];
      if (unknown?.status !== "outcome_unknown") {
        throw new Error(`expected outcome_unknown, got ${unknown?.status}`);
      }
      const before = ctx.pack.synthetic.effectCount("synthetic://demo/resource");
      if (before !== 1) throw new Error("expected exactly one side effect before reconcile");

      const run = await ctx.persistence.getRun(runId);
      if (!run) throw new Error("run missing");
      const rec = await ctx.tools.reconcile({
        tenantId: "t1",
        runId,
        toolCallId: unknown.toolCallId,
        expectedRevision: run.revision,
        leaseEpoch: run.leaseEpoch,
      });
      if (!rec.ok) throw new Error("reconcile failed");
      if ((await ctx.persistence.getToolCall(unknown.toolCallId))?.status !== "succeeded") {
        throw new Error("expected succeeded after reconcile");
      }
      if (ctx.pack.synthetic.effectCount("synthetic://demo/resource") !== 1) {
        throw new Error("reconcile must not duplicate side effects");
      }
    },
  },
  {
    caseId: "recovery-prepared-before-dispatch",
    run: async (ctx, { repetition }) => {
      const runId = `eval-rec-prep-${repetition}`;
      await bootstrapRunning(ctx, runId, "hello world");
      await executeTurn(ctx, runId);
      await ctx.tools.tick();
      assertPreparedBeforeDispatch(await ctx.persistence.listEvents(runId));
    },
  },
];

const APPROVAL_CASES: EvalCaseDefinition[] = [
  {
    caseId: "approval-approve-wake-queued",
    run: async (ctx, { repetition }) => {
      const runId = `eval-apr-ok-${repetition}`;
      await bootstrapRunning(ctx, runId, "synthetic high");
      await executeTurn(ctx, runId);
      const run = await ctx.persistence.getRun(runId);
      if (run?.status !== "awaiting_approval") {
        throw new Error(`expected awaiting_approval, got ${run?.status}`);
      }
      const approval = (await ctx.persistence.listApprovals(runId))[0];
      if (!approval) throw new Error("approval missing");
      const decide = await ctx.engine.handle(
        cmd({
          commandType: "approval_decision",
          commandId: "approve-eval",
          runId,
          expectedRevision: run.revision,
          payload: { approvalId: approval.approvalId, decision: "approved" },
        }),
      );
      if (!decide.ok) throw new Error(decide.message ?? "approve failed");
      if (decide.run.status !== "queued") throw new Error("approve must wake to queued only");
    },
  },
  {
    caseId: "approval-reject-failed",
    run: async (ctx, { repetition }) => {
      const runId = `eval-apr-rej-${repetition}`;
      await bootstrapRunning(ctx, runId, "synthetic high");
      await executeTurn(ctx, runId);
      const run = await ctx.persistence.getRun(runId);
      const approval = (await ctx.persistence.listApprovals(runId))[0];
      if (!run || !approval) throw new Error("run or approval missing");
      const rejected = await ctx.engine.handle(
        cmd({
          commandType: "approval_decision",
          commandId: "reject-eval",
          runId,
          expectedRevision: run.revision,
          payload: { approvalId: approval.approvalId, decision: "rejected", reason: "nope" },
        }),
      );
      if (!rejected.ok) throw new Error(rejected.message ?? "reject failed");
      if (rejected.run.status !== "failed") throw new Error("reject must fail run");
    },
  },
  {
    caseId: "approval-expired-decision",
    run: async (ctx, { repetition }) => {
      const runId = `eval-apr-exp-${repetition}`;
      await bootstrapRunning(ctx, runId, "synthetic high");
      await executeTurn(ctx, runId);
      const run = await ctx.persistence.getRun(runId);
      const approval = (await ctx.persistence.listApprovals(runId))[0];
      if (!run || !approval) throw new Error("run or approval missing");
      await patchApprovalForEval(ctx, approval.approvalId, {
        expiresAt: new Date(Date.now() - 1_000).toISOString(),
      });
      const runAfter = await ctx.persistence.getRun(runId);
      if (!runAfter) throw new Error("run missing after patch");
      const expired = await ctx.engine.handle(
        cmd({
          commandType: "approval_decision",
          commandId: "expired-eval",
          runId,
          expectedRevision: runAfter.revision,
          payload: { approvalId: approval.approvalId, decision: "approved" },
        }),
      );
      if (expired.ok) throw new Error("expired approval must reject decision");
      if (!expired.message?.includes("expired")) throw new Error("expected expired message");
    },
  },
  {
    caseId: "approval-revoked-not-pending",
    run: async (ctx, { repetition }) => {
      const runId = `eval-apr-rev-${repetition}`;
      await bootstrapRunning(ctx, runId, "synthetic high");
      await executeTurn(ctx, runId);
      const run = await ctx.persistence.getRun(runId);
      const approval = (await ctx.persistence.listApprovals(runId))[0];
      if (!run || !approval) throw new Error("run or approval missing");
      await patchApprovalForEval(ctx, approval.approvalId, { status: "revoked" });
      const runAfter = await ctx.persistence.getRun(runId);
      if (!runAfter) throw new Error("run missing after patch");
      const revoked = await ctx.engine.handle(
        cmd({
          commandType: "approval_decision",
          commandId: "revoked-eval",
          runId,
          expectedRevision: runAfter.revision,
          payload: { approvalId: approval.approvalId, decision: "approved" },
        }),
      );
      if (revoked.ok) throw new Error("revoked approval must reject decision");
      if (!revoked.message?.includes("not pending")) throw new Error("expected not pending message");
    },
  },
  {
    caseId: "approval-digest-mismatch-resume",
    run: async (ctx, { repetition }) => {
      const runId = `eval-apr-dig-${repetition}`;
      await bootstrapRunning(ctx, runId, "synthetic high");
      await executeTurn(ctx, runId);
      const run = await ctx.persistence.getRun(runId);
      const approval = (await ctx.persistence.listApprovals(runId))[0];
      if (!run || !approval) throw new Error("run or approval missing");
      const approved = await ctx.engine.handle(
        cmd({
          commandType: "approval_decision",
          commandId: "approve-dig",
          runId,
          expectedRevision: run.revision,
          payload: { approvalId: approval.approvalId, decision: "approved" },
        }),
      );
      if (!approved.ok) throw new Error(approved.message ?? "approve failed");
      const leased = await acquireLease(ctx, runId);

      const continuation = await ctx.persistence.getContinuation(runId);
      const action = continuation?.actionSnapshot;
      if (!action || action.type !== "tool.call") throw new Error("continuation action missing");
      await patchContinuationForEval(ctx, runId, {
        actionSnapshot: {
          ...action,
          arguments: { ...(action.arguments as Record<string, unknown>), tampered: true },
        },
      });

      const runAfter = await ctx.persistence.getRun(runId);
      if (!runAfter) throw new Error("run missing after patch");
      const resume = await ctx.engine.handle(
        cmd({
          commandType: "execute_turn",
          commandId: "turn-digest",
          runId,
          expectedRevision: runAfter.revision,
          leaseEpoch: leased.leaseEpoch,
          actor: { principalId: ctx.leaseOwnerId },
        }),
      );
      if (resume.ok) throw new Error("digest mismatch must fail resume");
      if (!resume.message?.includes("actionDigest")) throw new Error("expected actionDigest mismatch");
    },
  },
  {
    caseId: "approval-single-consume",
    run: async (ctx, { repetition }) => {
      const runId = `eval-apr-consume-${repetition}`;
      await bootstrapRunning(ctx, runId, "synthetic high");
      await executeTurn(ctx, runId);
      let run = await ctx.persistence.getRun(runId);
      const approval = (await ctx.persistence.listApprovals(runId))[0];
      if (!run || !approval) throw new Error("run or approval missing");
      const approved = await ctx.engine.handle(
        cmd({
          commandType: "approval_decision",
          commandId: "approve-consume",
          runId,
          expectedRevision: run.revision,
          payload: { approvalId: approval.approvalId, decision: "approved" },
        }),
      );
      if (!approved.ok) throw new Error(approved.message ?? "approve failed");
      const leased = await acquireLease(ctx, runId);
      const resume = await ctx.engine.handle(
        cmd({
          commandType: "execute_turn",
          commandId: "turn-consume",
          runId,
          expectedRevision: leased.revision,
          leaseEpoch: leased.leaseEpoch,
          actor: { principalId: ctx.leaseOwnerId },
        }),
      );
      if (!resume.ok) throw new Error(resume.message ?? "resume failed");
      const consumed = await ctx.persistence.getApproval(approval.approvalId);
      if (consumed?.status !== "consumed") throw new Error("approval must be consumed");
      const types = (await ctx.persistence.listEvents(runId)).map((e) => e.eventType);
      if (!types.includes("approval.consumed")) throw new Error("missing approval.consumed");
      await ctx.tools.tick();
    },
  },
];

class ConflictingIdempotencyModel implements ModelPort {
  private callCount = 0;

  async completeStructured(): Promise<Action> {
    this.callCount += 1;
    return {
      schemaVersion: CONTRACTS_SCHEMA_VERSION,
      actionId: `act-conflict-${this.callCount}`,
      type: "tool.call",
      toolId: "artifact.write_markdown",
      arguments: { markdown: `# v${this.callCount}` },
      idempotencyKey: "stable-conflict-key",
    };
  }
}

const IDEMPOTENCY_CASES: EvalCaseDefinition[] = [
  {
    caseId: "idempotency-create-run-same-key",
    run: async (ctx, { repetition }) => {
      const command = buildCreateRunCommand({
        tenantId: "t1",
        commandId: `idem-create-${repetition}`,
        runId: `eval-idem-create-${repetition}`,
        sessionId: "s1",
        agentDefinitionId: "agent",
        agentVersion: "1",
        executionManifestRef: "manifest://m1",
        packVersions: [],
        goal: "goal",
        strategy: { type: "light", version: "1" },
      });
      const first = await ctx.engine.handle(command);
      const second = await ctx.engine.handle(command);
      if (!first.ok || !second.ok) throw new Error("create_run failed");
      if (!second.idempotent) throw new Error("expected idempotent second create");
      if (first.run.runId !== second.run.runId) throw new Error("idempotent create must return same runId");
    },
  },
  {
    caseId: "idempotency-request-hash-conflict",
    setup: { model: new ConflictingIdempotencyModel() },
    run: async (ctx, { repetition }) => {
      const runId = `eval-idem-conflict-${repetition}`;
      await bootstrapRunning(ctx, runId, "artifact conflict");
      await executeTurn(ctx, runId);
      const run = await ctx.persistence.getRun(runId);
      if (!run) throw new Error("run missing");
      const conflict = await ctx.engine.handle(
        cmd({
          commandType: "execute_turn",
          commandId: "turn-conflict",
          runId,
          expectedRevision: run.revision,
          leaseEpoch: run.leaseEpoch,
          actor: { principalId: ctx.leaseOwnerId },
        }),
      );
      if (conflict.ok) throw new Error("expected idempotency hash conflict");
      if (conflict.code !== "conflict") throw new Error(`expected conflict, got ${conflict.code}`);
    },
  },
  {
    caseId: "idempotency-prepared-before-dispatch",
    run: async (ctx, { repetition }) => {
      const runId = `eval-idem-prep-${repetition}`;
      await bootstrapRunning(ctx, runId, "hello world");
      await executeTurn(ctx, runId);
      await ctx.tools.tick();
      assertPreparedBeforeDispatch(await ctx.persistence.listEvents(runId));
    },
  },
  {
    caseId: "idempotency-tool-same-key-redispatch",
    run: async (ctx, { repetition }) => {
      const fixedAction: Action = {
        schemaVersion: CONTRACTS_SCHEMA_VERSION,
        actionId: "act-stable",
        type: "tool.call",
        toolId: "artifact.write_markdown",
        arguments: { markdown: "# stable" },
        idempotencyKey: `art-stable-${repetition}`,
      };
      const local = createEvalContext({ model: new StubModelPort({ fixedAction }), requireApprovalTools: [] });
      const runId = `eval-idem-tool-${repetition}`;
      await bootstrapRunning(local, runId, "artifact once");
      await executeTurn(local, runId);
      const run = await local.persistence.getRun(runId);
      if (!run) throw new Error("run missing");
      const second = await local.engine.handle(
        cmd({
          commandType: "execute_turn",
          commandId: "turn-idem-2",
          runId,
          expectedRevision: run.revision,
          leaseEpoch: run.leaseEpoch,
          actor: { principalId: local.leaseOwnerId },
        }),
      );
      if (!second.ok) throw new Error(second.message ?? "second turn failed");
      if (!second.idempotent) throw new Error("expected idempotent second prepared");
      if ((await local.persistence.listToolCalls(runId)).length !== 1) {
        throw new Error("same idempotency key must not create duplicate tool calls");
      }
    },
  },
  {
    caseId: "idempotency-outcome-unknown-no-blind-retry",
    setup: { requireApprovalTools: [] },
    run: async (ctx, { repetition }) => {
      const runId = `eval-idem-unknown-${repetition}`;
      ctx.pack.synthetic.setTimeoutNextWrite(true);
      await bootstrapRunning(ctx, runId, "synthetic high");
      await executeTurn(ctx, runId);
      await ctx.tools.tick();
      const run = await ctx.persistence.getRun(runId);
      if (!run) throw new Error("run missing");
      const blind = await ctx.engine.handle(
        cmd({
          commandType: "execute_turn",
          commandId: "turn-blind",
          runId,
          expectedRevision: run.revision,
          leaseEpoch: run.leaseEpoch,
          actor: { principalId: ctx.leaseOwnerId },
        }),
      );
      if (blind.ok) throw new Error("blind retry after outcome_unknown must fail");
      if (!blind.message?.match(/blind-retry|reconcile_tool/)) {
        throw new Error("expected blind-retry guard message");
      }
    },
  },
  {
    caseId: "idempotency-reconcile-authoritative",
    setup: { requireApprovalTools: [] },
    run: async (ctx, { repetition }) => {
      const runId = `eval-idem-reconcile-${repetition}`;
      ctx.pack.synthetic.setTimeoutNextWrite(true);
      await bootstrapRunning(ctx, runId, "synthetic high");
      await executeTurn(ctx, runId);
      await ctx.tools.tick();
      const unknown = (await ctx.persistence.listToolCalls(runId))[0];
      const run = await ctx.persistence.getRun(runId);
      if (!unknown || !run) throw new Error("unknown tool or run missing");
      const rec = await ctx.tools.reconcile({
        tenantId: "t1",
        runId,
        toolCallId: unknown.toolCallId,
        expectedRevision: run.revision,
        leaseEpoch: run.leaseEpoch,
      });
      if (!rec.ok) throw new Error("reconcile failed");
      if ((await ctx.persistence.getToolCall(unknown.toolCallId))?.status !== "succeeded") {
        throw new Error("expected succeeded after reconcile");
      }
      if (ctx.pack.synthetic.effectCount("synthetic://demo/resource") !== 1) {
        throw new Error("authoritative reconcile must preserve single side effect");
      }
    },
  },
];

export const RECOVERY_EVAL_SUITE: EvalSuiteDefinition = {
  suiteId: "recovery-fault-injection",
  threshold: "design 08 recovery 8×5 @ >=95%; duplicate side effects 0",
  minPassRate: 0.95,
  repetitions: RECOVERY_REPETITIONS,
  cases: RECOVERY_CASES,
};

export const APPROVAL_EVAL_SUITE: EvalSuiteDefinition = {
  suiteId: "approval-lifecycle",
  threshold: "design 08 approval 6×1 @ 100%",
  minPassRate: 1,
  repetitions: APPROVAL_REPETITIONS,
  cases: APPROVAL_CASES,
};

export const IDEMPOTENCY_EVAL_SUITE: EvalSuiteDefinition = {
  suiteId: "idempotency-unknown-outcome",
  threshold: "design 08 idempotency 6×5 @ 100%",
  minPassRate: 1,
  repetitions: IDEMPOTENCY_REPETITIONS,
  cases: IDEMPOTENCY_CASES,
};

/** Full design 08 MVP matrix (golden + control plane). */
export const MVP_EVAL_SUITES: EvalSuiteDefinition[] = [
  GOLDEN_EVAL_SUITE,
  RECOVERY_EVAL_SUITE,
  APPROVAL_EVAL_SUITE,
  IDEMPOTENCY_EVAL_SUITE,
];

export { SECURITY_EVAL_SUITE, SECURITY_REPETITIONS } from "./eval-security-suites.js";

/** Golden + control plane + security (design 08 full matrix). */
export const FULL_MVP_EVAL_SUITES: EvalSuiteDefinition[] = [
  ...MVP_EVAL_SUITES,
  SECURITY_EVAL_SUITE,
];
