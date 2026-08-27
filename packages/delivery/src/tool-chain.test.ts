import { CONTRACTS_SCHEMA_VERSION } from "@monai/contracts";
import type { HarnessCommand } from "@monai/ports";
import { InMemoryLease } from "@monai/lease-memory";
import { StubModelPort } from "@monai/model-stub";
import { InMemoryPersistence } from "@monai/persistence-memory";
import { IsolatedSyntheticSink } from "@monai/synthetic-sink";
import { InMemoryWorkspace } from "@monai/workspace-memory";
import { Engine, HookRunner, ToolInvoker } from "@monai/runtime";
import { describe, expect, it } from "vitest";

import { ToolDispatcher } from "./tool-dispatcher.js";

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

describe("P4 tool chain", () => {
  it("echo: prepared → dispatch → succeeded → fact", async () => {
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
    const tools = new ToolDispatcher({
      outbox: persistence,
      persistence,
      engine,
      invoker: new ToolInvoker(),
    });

    const running = await toRunning(engine, "r-echo", "hello world", ownerId);
    expect(running.ok).toBe(true);
    if (!running.ok) return;

    const turn = await engine.handle(
      cmd({
        commandType: "execute_turn",
        commandId: "turn-1",
        runId: "r-echo",
        expectedRevision: running.revision,
        leaseEpoch: running.leaseEpoch,
        actor: { principalId: ownerId },
      }),
    );
    expect(turn.ok).toBe(true);
    if (!turn.ok) return;
    expect((await persistence.listEvents("r-echo")).map((e) => e.eventType)).toContain(
      "tool.call_prepared",
    );

    expect(await tools.tick()).toBeGreaterThan(0);
    const types = (await persistence.listEvents("r-echo")).map((e) => e.eventType);
    expect(types).toContain("tool.dispatched");
    expect(types).toContain("tool.succeeded");
    expect(types).toContain("fact.accepted");
    expect(types).toContain("step.completed");
  });

  it("workspace.read via prepared/dispatch", async () => {
    const persistence = new InMemoryPersistence();
    const lease = new InMemoryLease();
    const ownerId = "worker-1";
    const workspace = new InMemoryWorkspace({ "/readme.md": "hello workspace" });
    const engine = new Engine({
      persistence,
      lease,
      model: new StubModelPort(),
      hooks: new HookRunner(),
      requireApprovalTools: [],
    });
    const tools = new ToolDispatcher({
      outbox: persistence,
      persistence,
      engine,
      invoker: new ToolInvoker({ workspace }),
    });

    const running = await toRunning(engine, "r-ws", "please workspace-read", ownerId);
    expect(running.ok).toBe(true);
    if (!running.ok) return;

    const turn = await engine.handle(
      cmd({
        commandType: "execute_turn",
        commandId: "turn-ws",
        runId: "r-ws",
        expectedRevision: running.revision,
        leaseEpoch: running.leaseEpoch,
        actor: { principalId: ownerId },
      }),
    );
    expect(turn.ok).toBe(true);
    await tools.tick();
    const state = await persistence.getState("r-ws");
    expect(state?.facts[0]?.summary).toContain("read");
  });

  it("synthetic timeout → unknown → reconcile; blocks blind new-key retry", async () => {
    const persistence = new InMemoryPersistence();
    const lease = new InMemoryLease();
    const ownerId = "worker-1";
    const sink = new IsolatedSyntheticSink({ timeoutNextWrite: true });
    const engine = new Engine({
      persistence,
      lease,
      model: new StubModelPort(),
      hooks: new HookRunner(),
      requireApprovalTools: [],
    });
    const tools = new ToolDispatcher({
      outbox: persistence,
      persistence,
      engine,
      invoker: new ToolInvoker({ synthetic: sink }),
    });

    const running = await toRunning(engine, "r-syn", "do synthetic write", ownerId);
    expect(running.ok).toBe(true);
    if (!running.ok) return;

    const turn = await engine.handle(
      cmd({
        commandType: "execute_turn",
        commandId: "turn-syn",
        runId: "r-syn",
        expectedRevision: running.revision,
        leaseEpoch: running.leaseEpoch,
        actor: { principalId: ownerId },
      }),
    );
    expect(turn.ok).toBe(true);
    if (!turn.ok) return;

    expect(await tools.tick()).toBe(1);
    const unknown = (await persistence.listToolCalls("r-syn"))[0]!;
    expect(unknown.status).toBe("outcome_unknown");
    expect(sink.effectCount("synthetic://demo/resource")).toBe(1);

    const runNow = await persistence.getRun("r-syn");
    const blind = await engine.handle(
      cmd({
        commandType: "execute_turn",
        commandId: "turn-blind",
        runId: "r-syn",
        expectedRevision: runNow!.revision,
        leaseEpoch: runNow!.leaseEpoch,
        actor: { principalId: ownerId },
      }),
    );
    expect(blind.ok).toBe(false);
    if (!blind.ok) {
      expect(blind.message).toMatch(/blind-retry|reconcile_tool/);
    }

    const rec = await tools.reconcile({
      tenantId: "t1",
      runId: "r-syn",
      toolCallId: unknown.toolCallId,
      expectedRevision: (await persistence.getRun("r-syn"))!.revision,
      leaseEpoch: runNow!.leaseEpoch,
    });
    expect(rec.ok).toBe(true);
    expect((await persistence.getToolCall(unknown.toolCallId))?.status).toBe("succeeded");
    expect(sink.effectCount("synthetic://demo/resource")).toBe(1);
  });

  it("same tool_call idempotency key is idempotent", async () => {
    const persistence = new InMemoryPersistence();
    const lease = new InMemoryLease();
    const ownerId = "worker-1";
    const fixedAction = {
      schemaVersion: CONTRACTS_SCHEMA_VERSION,
      actionId: "act-fixed",
      type: "tool.call" as const,
      toolId: "artifact.write_markdown",
      arguments: { markdown: "# hi" },
      idempotencyKey: "art-stable-key",
    };
    const engine = new Engine({
      persistence,
      lease,
      model: new StubModelPort({ fixedAction }),
      hooks: new HookRunner(),
      requireApprovalTools: [],
    });

    const running = await toRunning(engine, "r-idem", "artifact once", ownerId);
    expect(running.ok).toBe(true);
    if (!running.ok) return;

    const t1 = await engine.handle(
      cmd({
        commandType: "execute_turn",
        commandId: "t1",
        runId: "r-idem",
        expectedRevision: running.revision,
        leaseEpoch: running.leaseEpoch,
        actor: { principalId: ownerId },
      }),
    );
    expect(t1.ok).toBe(true);
    if (!t1.ok) return;

    const t2 = await engine.handle(
      cmd({
        commandType: "execute_turn",
        commandId: "t2",
        runId: "r-idem",
        expectedRevision: t1.revision,
        leaseEpoch: t1.leaseEpoch,
        actor: { principalId: ownerId },
      }),
    );
    expect(t2.ok).toBe(true);
    if (!t2.ok) return;
    expect(t2.idempotent).toBe(true);
    expect((await persistence.listToolCalls("r-idem")).length).toBe(1);
  });
});
