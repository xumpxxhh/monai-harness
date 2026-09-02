import { CONTRACTS_SCHEMA_VERSION } from "@monai/contracts";
import type { HarnessCommand, ModelPort } from "@monai/ports";
import { StubModelPort } from "@monai/model-stub";
import { workspaceGenericToolHandlers } from "@monai/pack-workspace-generic";
import type { ExecutionContext } from "@monai/pack-sdk";
import { InMemoryWorkspace } from "@monai/workspace-memory";
import { describe, expect, it } from "vitest";

import { createPackTestFixtures, toRunning as bootToRunning } from "./test-pack-fixtures.js";

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

describe("P4 tool chain", () => {
  it("echo: prepared → dispatch → succeeded → fact", async () => {
    const { persistence, engine, tools, ownerId } = createPackTestFixtures({
      requireApprovalTools: [],
    });

    const running = await bootToRunning(engine, cmd, "r-echo", "hello world", ownerId);
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
    const workspace = new InMemoryWorkspace({ "/readme.md": "hello workspace" });
    const { persistence, engine, tools, ownerId } = createPackTestFixtures({
      workspace,
      requireApprovalTools: [],
    });

    const running = await bootToRunning(engine, cmd, "r-ws", "please workspace-read", ownerId);
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

  it("workspace.write via prepared/dispatch", async () => {
    const workspace = new InMemoryWorkspace({ "/readme.md": "hello workspace" });
    const { persistence, engine, tools, ownerId } = createPackTestFixtures({
      workspace,
      requireApprovalTools: [],
    });

    const running = await bootToRunning(engine, cmd, "r-ws-write", "please workspace-write", ownerId);
    expect(running.ok).toBe(true);
    if (!running.ok) return;

    const turn = await engine.handle(
      cmd({
        commandType: "execute_turn",
        commandId: "turn-ws-write",
        runId: "r-ws-write",
        expectedRevision: running.revision,
        leaseEpoch: running.leaseEpoch,
        actor: { principalId: ownerId },
      }),
    );
    expect(turn.ok).toBe(true);
    await tools.tick();
    const types = (await persistence.listEvents("r-ws-write")).map((e) => e.eventType);
    expect(types).toContain("tool.call_prepared");
    expect(types).toContain("tool.succeeded");
    const state = await persistence.getState("r-ws-write");
    expect(state?.facts[0]?.summary).toContain("wrote");
    const written = (await workspace.read("/notes/out.md")) as { content: string };
    expect(written.content).toBe("written by stub");
  });

  it("synthetic timeout → unknown → reconcile; blocks blind new-key retry", async () => {
    const { persistence, engine, tools, pack, ownerId } = createPackTestFixtures({
      requireApprovalTools: [],
    });
    pack.synthetic.setTimeoutNextWrite(true);

    const running = await bootToRunning(engine, cmd, "r-syn", "do synthetic write", ownerId);
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
    expect(pack.synthetic.effectCount("synthetic://demo/resource")).toBe(1);

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
    expect(pack.synthetic.effectCount("synthetic://demo/resource")).toBe(1);
  });

  it("batch workspace.read: two paths, both succeed then one step.completed", async () => {
    const workspace = new InMemoryWorkspace({
      "/readme.md": "# readme",
      "/notes/search-me.md": "# notes",
    });
    const batchModel: ModelPort = {
      completeStructured: async () => ({
        calls: [
          { name: "workspace.read", arguments: { path: "/readme.md" } },
          { name: "workspace.read", arguments: { path: "/notes/search-me.md" } },
        ],
      }),
    };
    const { persistence, engine, tools, ownerId } = createPackTestFixtures({
      workspace,
      requireApprovalTools: [],
      model: batchModel,
    });

    const running = await bootToRunning(engine, cmd, "r-ws-batch", "batch read", ownerId);
    expect(running.ok).toBe(true);
    if (!running.ok) return;

    const turn = await engine.handle(
      cmd({
        commandType: "execute_turn",
        commandId: "turn-ws-batch",
        runId: "r-ws-batch",
        expectedRevision: running.revision,
        leaseEpoch: running.leaseEpoch,
        actor: { principalId: ownerId },
      }),
    );
    expect(turn.ok).toBe(true);
    if (!turn.ok) return;
    expect((await persistence.listToolCalls("r-ws-batch"))).toHaveLength(2);

    expect(await tools.tick()).toBe(2);
    const types = (await persistence.listEvents("r-ws-batch")).map((e) => e.eventType);
    expect(types.filter((t) => t === "tool.succeeded")).toHaveLength(2);
    expect(types.filter((t) => t === "state.reduced")).toHaveLength(2);
    expect(types).toContain("step.completed");
    expect((await persistence.listToolCalls("r-ws-batch")).every((t) => t.status === "succeeded")).toBe(
      true,
    );
  });

  it("batch echo: two prepared, step completes after both succeed", async () => {
    const batchModel: ModelPort = {
      completeStructured: async () => ({
        calls: [
          { name: "echo", arguments: { text: "a" } },
          { name: "echo", arguments: { text: "b" } },
        ],
      }),
    };
    const { persistence, engine, tools, ownerId } = createPackTestFixtures({
      requireApprovalTools: [],
      model: batchModel,
    });

    const running = await bootToRunning(engine, cmd, "r-batch", "batch echo", ownerId);
    expect(running.ok).toBe(true);
    if (!running.ok) return;

    const turn = await engine.handle(
      cmd({
        commandType: "execute_turn",
        commandId: "turn-batch",
        runId: "r-batch",
        expectedRevision: running.revision,
        leaseEpoch: running.leaseEpoch,
        actor: { principalId: ownerId },
      }),
    );
    expect(turn.ok).toBe(true);
    if (!turn.ok) return;

    const prepared = (await persistence.listToolCalls("r-batch")).filter(
      (t) => t.status === "prepared",
    );
    expect(prepared).toHaveLength(2);
    expect((await persistence.listOutbox()).filter((o) => o.message.messageType === "dispatch_tool")).toHaveLength(2);

    expect(await tools.tick()).toBe(2);
    const types = (await persistence.listEvents("r-batch")).map((e) => e.eventType);
    expect(types.filter((t) => t === "tool.succeeded")).toHaveLength(2);
    expect(types).toContain("step.completed");
    expect(types.filter((t) => t === "step.completed")).toHaveLength(1);
  });

  it("same tool_call idempotency key is idempotent", async () => {
    const fixedAction = {
      schemaVersion: CONTRACTS_SCHEMA_VERSION,
      actionId: "act-fixed",
      type: "tool.call" as const,
      toolId: "artifact.write_markdown",
      arguments: { markdown: "# hi" },
      idempotencyKey: "art-stable-key",
    };
    const { persistence, engine, ownerId } = createPackTestFixtures({
      requireApprovalTools: [],
      model: new StubModelPort({ fixedAction }),
    });

    const running = await bootToRunning(engine, cmd, "r-idem", "artifact once", ownerId);
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

describe("workspace.write handler", () => {
  function writeInput(
    args: Record<string, unknown>,
    workspace?: InMemoryWorkspace,
  ) {
    return {
      toolId: "workspace.write",
      arguments: args,
      executionContext: {
        tenantId: "t1",
        sessionId: "s1",
        runId: "r1",
        executionManifestRef: "m1",
        effectivePermissions: [],
        ports: workspace ? { workspace } : {},
      } as ExecutionContext,
      toolCallId: "tc-write",
    };
  }

  it("writes a file and returns path + chars", async () => {
    const workspace = new InMemoryWorkspace();
    const result = await workspaceGenericToolHandlers["workspace.write"]!(
      writeInput({ path: "/notes/out.md", content: "hello" }, workspace),
    );
    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({ path: "/notes/out.md", summary: "wrote /notes/out.md" });
    const written = (await workspace.read("/notes/out.md")) as { content: string };
    expect(written.content).toBe("hello");
  });

  it("rejects missing path or content", async () => {
    const workspace = new InMemoryWorkspace();
    const missingPath = await workspaceGenericToolHandlers["workspace.write"]!(
      writeInput({ content: "x" }, workspace),
    );
    expect(missingPath.ok).toBe(false);
    expect(missingPath.error).toMatch(/path is required/);

    const missingContent = await workspaceGenericToolHandlers["workspace.write"]!(
      writeInput({ path: "/a.md" }, workspace),
    );
    expect(missingContent.ok).toBe(false);
    expect(missingContent.error).toMatch(/content is required/);
  });

  it("rejects path escape and root path", async () => {
    const workspace = new InMemoryWorkspace();
    await expect(
      workspaceGenericToolHandlers["workspace.write"]!(
        writeInput({ path: "/../secret", content: "x" }, workspace),
      ),
    ).rejects.toThrow(/path escape/);

    const root = await workspaceGenericToolHandlers["workspace.write"]!(
      writeInput({ path: "/", content: "x" }, workspace),
    );
    expect(root.ok).toBe(false);
    expect(root.error).toMatch(/file path/);
  });
});
