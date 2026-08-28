import { CONTRACTS_SCHEMA_VERSION } from "@monai/contracts";
import type { HarnessCommand } from "@monai/ports";
import { StubModelPort } from "@monai/model-stub";
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
