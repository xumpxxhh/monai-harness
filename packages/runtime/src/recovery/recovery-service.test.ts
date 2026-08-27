import { CONTRACTS_SCHEMA_VERSION } from "@monai/contracts";
import type { HarnessCommand } from "@monai/ports";
import { InMemoryLease } from "@monai/lease-memory";
import { StubModelPort } from "@monai/model-stub";
import { InMemoryPersistence } from "@monai/persistence-memory";
import {
  computeStateHash,
  Engine,
  HookRunner,
  ToolInvoker,
} from "../index.js";
import { RecoveryService } from "./recovery-service.js";
import { replayEvents } from "./replay-events.js";
import { describe, expect, it } from "vitest";

function cmd(
  partial: Partial<HarnessCommand> & Pick<HarnessCommand, "commandType" | "commandId">,
): HarnessCommand {
  return {
    schemaVersion: CONTRACTS_SCHEMA_VERSION,
    tenantId: "t1",
    issuedAt: new Date().toISOString(),
    ...partial,
  };
}

async function toRunning(engine: Engine, runId: string, goal: string, ownerId: string) {
  const created = await engine.handle(
    cmd({
      commandType: "create_run",
      commandId: `create-${runId}`,
      payload: {
        runId,
        sessionId: "s1",
        agentDefinitionId: "agent",
        agentVersion: "1",
        executionManifestRef: "manifest://m1",
        packVersions: [{ packId: "core", version: "0.1.0" }],
        goal,
        strategy: { type: "light", version: "1" },
      },
    }),
  );
  expect(created.ok).toBe(true);
  if (!created.ok) return created;

  const queued = await engine.handle(
    cmd({
      commandType: "queue_run",
      commandId: `queue-${runId}`,
      runId,
      expectedRevision: created.revision,
    }),
  );
  expect(queued.ok).toBe(true);
  if (!queued.ok) return queued;

  return engine.handle(
    cmd({
      commandType: "acquire_lease",
      commandId: `lease-${runId}`,
      runId,
      expectedRevision: queued.revision,
      actor: { principalId: ownerId },
    }),
  );
}

async function dispatchEchoSuccess(
  engine: Engine,
  persistence: InMemoryPersistence,
  invoker: ToolInvoker,
  args: {
    runId: string;
    revision: number;
    leaseEpoch: number;
    toolCallId: string;
  },
) {
  const accepted = await engine.handle(
    cmd({
      commandType: "tool_dispatch_result",
      commandId: `accept-${args.toolCallId}`,
      runId: args.runId,
      expectedRevision: args.revision,
      leaseEpoch: args.leaseEpoch,
      payload: { toolCallId: args.toolCallId, phase: "accepted" },
    }),
  );
  expect(accepted.ok).toBe(true);
  if (!accepted.ok) return accepted;

  const record = await persistence.getToolCall(args.toolCallId);
  expect(record).toBeDefined();
  const outcome = await invoker.invoke(record!);

  return engine.handle(
    cmd({
      commandType: "tool_dispatch_result",
      commandId: `term-${args.toolCallId}`,
      runId: args.runId,
      expectedRevision: accepted.revision,
      leaseEpoch: args.leaseEpoch,
      payload: {
        toolCallId: args.toolCallId,
        phase: "succeeded",
        data: outcome.ok ? outcome.data : {},
        resultHash: outcome.ok ? outcome.resultHash : undefined,
      },
    }),
  );
}

describe("P6 RecoveryService", () => {
  it("full replay matches persisted state after tool chain", async () => {
    const persistence = new InMemoryPersistence();
    const lease = new InMemoryLease();
    const invoker = new ToolInvoker();
    const ownerId = "worker-1";
    const engine = new Engine({
      persistence,
      lease,
      model: new StubModelPort(),
      hooks: new HookRunner(),
      requireApprovalTools: [],
    });

    const running = await toRunning(engine, "r-rec-echo", "hello world", ownerId);
    expect(running.ok).toBe(true);
    if (!running.ok) return;

    const turn = await engine.handle(
      cmd({
        commandType: "execute_turn",
        commandId: "turn-1",
        runId: "r-rec-echo",
        expectedRevision: running.revision,
        leaseEpoch: running.leaseEpoch,
        actor: { principalId: ownerId },
      }),
    );
    expect(turn.ok).toBe(true);
    if (!turn.ok) return;

    const toolCall = (await persistence.listToolCalls("r-rec-echo"))[0]!;
    const dispatched = await dispatchEchoSuccess(engine, persistence, invoker, {
      runId: "r-rec-echo",
      revision: turn.revision,
      leaseEpoch: running.leaseEpoch,
      toolCallId: toolCall.toolCallId,
    });
    expect(dispatched.ok).toBe(true);

    const recovery = new RecoveryService({ persistence, lease });
    const result = await recovery.recover("r-rec-echo");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const persisted = await persistence.getState("r-rec-echo");
    expect(result.stateHash).toBe(computeStateHash(persisted));
    expect(result.replayMode).toBe("full");
    expect(result.toolInventory.prepared).toHaveLength(0);
  });

  it("checkpoint-accelerated replay hash matches full replay after approval wait", async () => {
    const persistence = new InMemoryPersistence();
    const lease = new InMemoryLease();
    const ownerId = "worker-1";
    const engine = new Engine({
      persistence,
      lease,
      model: new StubModelPort(),
      hooks: new HookRunner(),
    });

    const running = await toRunning(engine, "r-rec-cp", "synthetic high", ownerId);
    expect(running.ok).toBe(true);
    if (!running.ok) return;

    const waitTurn = await engine.handle(
      cmd({
        commandType: "execute_turn",
        commandId: "turn-wait",
        runId: "r-rec-cp",
        expectedRevision: running.revision,
        leaseEpoch: running.leaseEpoch,
        actor: { principalId: ownerId },
      }),
    );
    expect(waitTurn.ok).toBe(true);
    if (!waitTurn.ok) return;
    expect(waitTurn.run.status).toBe("awaiting_approval");

    const cp = await persistence.getLatestCheckpoint("r-rec-cp");
    expect(cp).toBeDefined();
    expect(cp!.sequence).toBeGreaterThan(0);

    const events = await persistence.listEvents("r-rec-cp");
    const toolCalls = await persistence.listToolCalls("r-rec-cp");
    const snapshot = cp ? await persistence.getStateSnapshot(cp.stateRef) : undefined;
    expect(snapshot).toBeDefined();

    const fullHash = computeStateHash(replayEvents({ events, toolCalls, fromSequence: 1 }));
    const acceleratedHash = computeStateHash(
      replayEvents({
        events,
        toolCalls,
        initialState: snapshot,
        fromSequence: cp!.sequence + 1,
      }),
    );
    expect(acceleratedHash).toBe(fullHash);

    const recovery = new RecoveryService({ persistence, lease });
    const recovered = await recovery.recover("r-rec-cp");
    expect(recovered.ok).toBe(true);
    if (!recovered.ok) return;
    expect(recovered.replayMode).toBe("checkpoint");
    expect(recovered.continuation?.kind).toBe("approval");
  });

  it("late dispatch with stale leaseEpoch is rejected", async () => {
    const persistence = new InMemoryPersistence();
    const lease = new InMemoryLease();
    const ownerId = "worker-1";
    const engine = new Engine({
      persistence,
      lease,
      model: new StubModelPort(),
      hooks: new HookRunner(),
      requireApprovalTools: [],
    });

    const running = await toRunning(engine, "r-stale-dispatch", "hello world", ownerId);
    expect(running.ok).toBe(true);
    if (!running.ok) return;

    const turn = await engine.handle(
      cmd({
        commandType: "execute_turn",
        commandId: "turn-stale",
        runId: "r-stale-dispatch",
        expectedRevision: running.revision,
        leaseEpoch: running.leaseEpoch,
        actor: { principalId: ownerId },
      }),
    );
    expect(turn.ok).toBe(true);
    if (!turn.ok) return;

    const toolCall = (await persistence.listToolCalls("r-stale-dispatch"))[0]!;
    const stale = await engine.handle(
      cmd({
        commandType: "tool_dispatch_result",
        commandId: "stale-dispatch",
        runId: "r-stale-dispatch",
        expectedRevision: turn.revision,
        leaseEpoch: running.leaseEpoch - 1,
        payload: { toolCallId: toolCall.toolCallId, phase: "accepted" },
      }),
    );
    expect(stale.ok).toBe(false);
    if (stale.ok) return;
    expect(stale.code).toBe("lease_lost");
  });

  it("yieldStaleRunningRun moves running → queued when lease expired", async () => {
    const persistence = new InMemoryPersistence();
    const lease = new InMemoryLease();
    const ownerId = "worker-1";
    const engine = new Engine({
      persistence,
      lease,
      model: new StubModelPort(),
      hooks: new HookRunner(),
      requireApprovalTools: [],
      leaseTtlMs: 5,
    });

    const running = await toRunning(engine, "r-yield", "hello", ownerId);
    expect(running.ok).toBe(true);
    if (!running.ok) return;

    await new Promise((r) => setTimeout(r, 15));

    const recovery = new RecoveryService({ persistence, lease });
    const yielded = await recovery.yieldStaleRunningRun("r-yield");
    expect(yielded.ok).toBe(true);
    if (!yielded.ok) return;

    const run = await persistence.getRun("r-yield");
    expect(run?.status).toBe("queued");
  });
});
