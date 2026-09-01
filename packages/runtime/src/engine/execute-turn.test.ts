import { CONTRACTS_SCHEMA_VERSION } from "@monai/contracts";
import type { HarnessCommand } from "@monai/ports";
import { InMemoryLease } from "@monai/lease-memory";
import { InMemoryPersistence } from "@monai/persistence-memory";
import { StubModelPort } from "@monai/model-stub";
import { describe, expect, it } from "vitest";

import { Engine } from "./engine.js";
import { HookRunner } from "../hooks/hook-runner.js";
import { applyCommit } from "../commit/apply-commit.js";

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

  it("ask-user path waits for input", async () => {
    const persistence = new InMemoryPersistence();
    const lease = new InMemoryLease();
    const ownerId = "worker-1";
    const engine = new Engine({
      persistence,
      lease,
      model: new StubModelPort(),
      hooks: new HookRunner(),
    });

    const running = await toRunning(engine, "r-ask", "please ask-user first", ownerId);
    expect(running.ok).toBe(true);
    if (!running.ok) return;

    const turn = await engine.handle(
      cmd({
        commandType: "execute_turn",
        commandId: "turn-ask",
        runId: "r-ask",
        expectedRevision: running.revision,
        leaseEpoch: running.leaseEpoch,
        actor: { principalId: ownerId },
      }),
    );
    expect(turn.ok).toBe(true);
    if (!turn.ok) return;
    expect(turn.run.status).toBe("awaiting_input");
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

  it("fails step when maxSteps budget is exceeded without calling model", async () => {
    const persistence = new InMemoryPersistence();
    const lease = new InMemoryLease();
    const ownerId = "worker-1";
    let modelCalled = false;
    const model = {
      async completeStructured() {
        modelCalled = true;
        return { type: "noop", noopId: "n-1" };
      },
    };

    const engine = new Engine({
      persistence,
      lease,
      model,
      hooks: new HookRunner(),
    });

    const created = await engine.handle(
      cmd({
        commandType: "create_run",
        commandId: "create-budget-test",
        payload: {
          runId: "r-budget",
          sessionId: "s1",
          agentDefinitionId: "agent",
          agentVersion: "1",
          executionManifestRef: "manifest://m1",
          packVersions: [{ packId: "core", version: "0.1.0" }],
          goal: "budget test",
          strategy: { type: "light", version: "1" },
          budgets: { maxSteps: 1 },
        },
      }),
    );
    expect(created.ok).toBe(true);

    const queued = await engine.handle(
      cmd({
        commandType: "queue_run",
        commandId: "queue-budget-test",
        runId: "r-budget",
        expectedRevision: created.revision,
      }),
    );
    expect(queued.ok).toBe(true);

    const running = await engine.handle(
      cmd({
        commandType: "acquire_lease",
        commandId: "lease-budget-test",
        runId: "r-budget",
        expectedRevision: queued.revision,
        actor: { principalId: ownerId },
      }),
    );
    expect(running.ok).toBe(true);

    // Pre-populate state with 1 step taken
    const uow = await persistence.beginUnitOfWork("r-budget");
    const commitRes = await applyCommit(uow, {
      expectedRevision: running.revision,
      expectedLeaseEpoch: running.leaseEpoch,
      runPatch: {},
      events: [],
      state: {
        schemaVersion: "1.0.0",
        facts: [],
        cursor: { stepCount: 1 },
      },
    });
    expect(commitRes.ok).toBe(true);
    const updatedRevision = (commitRes as { revision: number }).revision;

    const turn = await engine.handle(
      cmd({
        commandType: "execute_turn",
        commandId: "turn-budget",
        runId: "r-budget",
        expectedRevision: updatedRevision,
        leaseEpoch: running.leaseEpoch,
        actor: { principalId: ownerId },
      }),
    );
    expect(turn.ok).toBe(true);
    expect(modelCalled).toBe(false);

    const events = await persistence.listEvents("r-budget");
    const failEvt = events.find((e) => e.eventType === "step.failed");
    expect(failEvt).toBeDefined();
    expect((failEvt?.payload as { reason?: string })?.reason).toContain("budget exceeded");
  });

  it("retries fallback target when primary model target fails", async () => {
    const persistence = new InMemoryPersistence();
    const lease = new InMemoryLease();
    const ownerId = "worker-1";
    const calls: string[] = [];

    const model = {
      async completeStructured(input: { modelPolicy?: { resolvedTarget?: string } }) {
        const target = input.modelPolicy?.resolvedTarget ?? "unknown";
        calls.push(target);
        if (target === "primary-err") {
          throw new Error("Primary target timeout");
        }
        return {
          rawAction: { type: "noop" },
          usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
        };
      },
    };

    const engine = new Engine({
      persistence,
      lease,
      model,
      hooks: new HookRunner(),
      modelPolicy: {
        version: "1.0.0",
        resolvedTarget: "primary-err",
        fallbackTarget: "backup-model",
      },
    });

    const running = await toRunning(engine, "r-fallback", "test fallback", ownerId);
    expect(running.ok).toBe(true);

    const turn = await engine.handle(
      cmd({
        commandType: "execute_turn",
        commandId: "turn-fallback",
        runId: "r-fallback",
        expectedRevision: running.revision,
        leaseEpoch: running.leaseEpoch,
        actor: { principalId: ownerId },
      }),
    );
    expect(turn.ok).toBe(true);
    expect(calls).toEqual(["primary-err", "backup-model"]);

    const events = await persistence.listEvents("r-fallback");
    const calledEvts = events.filter((e) => e.eventType === "model.called");
    expect(calledEvts.length).toBe(2);
    expect((calledEvts[0].payload as { target?: string }).target).toBe("primary-err");
    expect((calledEvts[1].payload as { target?: string }).target).toBe("backup-model");
  });
});
