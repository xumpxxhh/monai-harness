import { CONTRACTS_SCHEMA_VERSION } from "@monai/contracts";
import type { HarnessCommand } from "@monai/ports";
import { InMemoryLease } from "@monai/lease-memory";
import { InMemoryPersistence } from "@monai/persistence-memory";
import { StubModelPort } from "@monai/model-stub";
import { describe, expect, it } from "vitest";

import { Engine } from "./engine.js";
import { HookRunner } from "../hooks/hook-runner.js";

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

describe("execute_turn light loop", () => {
  it("echo prepares tool.call (dispatch is P4 ToolDispatcher)", async () => {
    const persistence = new InMemoryPersistence();
    const lease = new InMemoryLease();
    const ownerId = "worker-1";
    const engine = new Engine({
      persistence,
      lease,
      model: new StubModelPort(),
      hooks: new HookRunner(),
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
    expect(turn.run.status).toBe("running");

    const events = await persistence.listEvents("r-echo");
    const types = events.map((e) => e.eventType);
    expect(types).toContain("policy.evaluated");
    expect(types).toContain("action.accepted");
    expect(types).toContain("tool.call_prepared");
    expect((await persistence.listToolCalls("r-echo"))[0]?.status).toBe("prepared");
  });

  it("deny path commits policy.denied", async () => {
    const persistence = new InMemoryPersistence();
    const lease = new InMemoryLease();
    const ownerId = "worker-1";
    const engine = new Engine({
      persistence,
      lease,
      model: new StubModelPort(),
      hooks: new HookRunner(),
    });

    const running = await toRunning(engine, "r-deny", "please deny-me", ownerId);
    expect(running.ok).toBe(true);
    if (!running.ok) return;

    const turn = await engine.handle(
      cmd({
        commandType: "execute_turn",
        commandId: "turn-deny",
        runId: "r-deny",
        expectedRevision: running.revision,
        leaseEpoch: running.leaseEpoch,
        actor: { principalId: ownerId },
      }),
    );
    expect(turn.ok).toBe(true);
    if (!turn.ok) return;

    const types = (await persistence.listEvents("r-deny")).map((e) => e.eventType);
    expect(types).toContain("policy.evaluated");
    expect(types).toContain("policy.denied");
    expect(types).toContain("step.failed");
  });

  it("finish path marks run succeeded", async () => {
    const persistence = new InMemoryPersistence();
    const lease = new InMemoryLease();
    const ownerId = "worker-1";
    const engine = new Engine({
      persistence,
      lease,
      model: new StubModelPort(),
      hooks: new HookRunner(),
    });

    const running = await toRunning(engine, "r-finish", "please finish", ownerId);
    expect(running.ok).toBe(true);
    if (!running.ok) return;

    const turn = await engine.handle(
      cmd({
        commandType: "execute_turn",
        commandId: "turn-finish",
        runId: "r-finish",
        expectedRevision: running.revision,
        leaseEpoch: running.leaseEpoch,
        actor: { principalId: ownerId },
      }),
    );
    expect(turn.ok).toBe(true);
    if (!turn.ok) return;
    expect(turn.run.status).toBe("succeeded");
  });

  it("required acceptanceChecks block finish until lastFactId exists", async () => {
    const persistence = new InMemoryPersistence();
    const lease = new InMemoryLease();
    const ownerId = "worker-1";
    const engine = new Engine({
      persistence,
      lease,
      model: new StubModelPort(),
      hooks: new HookRunner(),
      acceptanceChecks: [
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
      ],
    });

    const running = await toRunning(engine, "r-acc", "please finish", ownerId);
    expect(running.ok).toBe(true);
    if (!running.ok) return;

    const turn = await engine.handle(
      cmd({
        commandType: "execute_turn",
        commandId: "turn-acc",
        runId: "r-acc",
        expectedRevision: running.revision,
        leaseEpoch: running.leaseEpoch,
        actor: { principalId: ownerId },
      }),
    );
    expect(turn.ok).toBe(true);
    if (!turn.ok) return;
    expect(turn.run.status).toBe("running");
    const types = (await persistence.listEvents("r-acc")).map((e) => e.eventType);
    expect(types).toContain("action.rejected");
    const rejected = (await persistence.listEvents("r-acc")).find(
      (e) => e.eventType === "action.rejected",
    );
    expect(rejected?.payload).toMatchObject({
      reason: "required acceptanceChecks did not pass",
    });
  });
});
