import { CONTRACTS_SCHEMA_VERSION } from "@monai/contracts";
import type { HarnessCommand } from "@monai/ports";
import { InMemoryLease } from "@monai/lease-memory";
import { StubModelPort } from "@monai/model-stub";
import { InMemoryPersistence } from "@monai/persistence-memory";
import { describe, expect, it } from "vitest";

import {
  Engine,
  InMemoryManifestStore,
  computeManifestHash,
  finalizeExecutionManifest,
} from "../index.js";
import { wireTestWorkspacePack } from "../test-helpers/wire-workspace-pack.js";

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

describe("P9a2 manifest hash", () => {
  it("computeManifestHash is stable for identical content", () => {
    const draft = {
      schemaVersion: CONTRACTS_SCHEMA_VERSION,
      manifestId: "manifest://m1",
      createdAt: "2026-01-01T00:00:00.000Z",
      eventOrderingVersion: "1",
      agentDefinition: {
        agentDefinitionId: "agent",
        version: "1",
        digest: "d1",
      },
      packVersions: [{ packId: "core", version: "0.1.0", digest: "p1" }],
      tools: [],
      strategy: { type: "light" as const, version: "1", digest: "s1" },
      toolAllowlist: ["echo"],
      requireApprovalTools: [],
      acceptanceChecks: [],
      coreContractVersion: CONTRACTS_SCHEMA_VERSION,
    };
    const a = computeManifestHash(draft);
    const b = computeManifestHash({ ...draft });
    expect(a).toBe(b);
    expect(a.startsWith("sha256:")).toBe(true);
    const finalized = finalizeExecutionManifest(draft);
    expect(finalized.hash).toBe(a);
  });
});

describe("P9a2 CreateRun manifest freeze", () => {
  it("freezes manifest at create and execute_turn reads frozen allowlist", async () => {
    const persistence = new InMemoryPersistence();
    const lease = new InMemoryLease();
    const manifestStore = new InMemoryManifestStore();
    const pack = wireTestWorkspacePack({ tenantId: "t1" });

    const engine = new Engine({
      persistence,
      lease,
      model: new StubModelPort(),
      hooks: pack.hookRunner,
      registry: pack.registry,
      manifestStore,
      toolAllowlist: pack.toolAllowlist,
      requireApprovalTools: pack.requireApprovalTools,
    });

    const created = await engine.handle(
      cmd({
        commandType: "create_run",
        commandId: "create-freeze",
        payload: {
          runId: "run-freeze",
          sessionId: "s1",
          agentDefinitionId: "agent",
          agentVersion: "1",
          executionManifestRef: "manifest://frozen-1",
          packVersions: [{ packId: "com.monai.pack.workspace-generic", version: "0.1.0" }],
          goal: "hello world",
          strategy: { type: "light", version: "1" },
        },
      }),
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.run.executionManifestHash).toBeDefined();

    const stored = await manifestStore.get("manifest://frozen-1");
    expect(stored?.hash).toBe(created.run.executionManifestHash);

    await engine.handle(
      cmd({
        commandType: "queue_run",
        commandId: "queue-freeze",
        runId: "run-freeze",
        expectedRevision: created.revision,
      }),
    );
    const leased = await engine.handle(
      cmd({
        commandType: "acquire_lease",
        commandId: "lease-freeze",
        runId: "run-freeze",
        expectedRevision: created.revision + 1,
        actor: { principalId: "worker" },
      }),
    );
    expect(leased.ok).toBe(true);
    if (!leased.ok) return;

    const widened = new Engine({
      persistence,
      lease,
      model: new StubModelPort({
        fixedAction: {
          schemaVersion: CONTRACTS_SCHEMA_VERSION,
          actionId: "act-forbidden",
          type: "tool.call",
          toolId: "forbidden.tool",
          arguments: { x: 1 },
        },
      }),
      hooks: pack.hookRunner,
      registry: pack.registry,
      manifestStore,
      toolAllowlist: [...pack.toolAllowlist, "forbidden.tool"],
      requireApprovalTools: [],
    });

    const turn = await widened.handle(
      cmd({
        commandType: "execute_turn",
        commandId: "turn-deny",
        runId: "run-freeze",
        expectedRevision: leased.revision,
        leaseEpoch: leased.leaseEpoch,
        actor: { principalId: "worker" },
      }),
    );
    expect(turn.ok).toBe(true);
    if (!turn.ok) return;

    const events = await persistence.listEvents("run-freeze");
    expect(events.some((e) => e.eventType === "policy.denied")).toBe(true);
    expect(events.some((e) => e.eventType === "tool.call_prepared")).toBe(false);
  });

  it("rejects conflicting manifest hash for same ref", async () => {
    const persistence = new InMemoryPersistence();
    const lease = new InMemoryLease();
    const manifestStore = new InMemoryManifestStore();
    const pack = wireTestWorkspacePack({ tenantId: "t1" });

    const engineA = new Engine({
      persistence,
      lease,
      model: new StubModelPort(),
      registry: pack.registry,
      manifestStore,
      toolAllowlist: pack.toolAllowlist,
      requireApprovalTools: [],
    });
    const first = await engineA.handle(
      cmd({
        commandType: "create_run",
        commandId: "create-a",
        payload: {
          runId: "run-a",
          sessionId: "s1",
          agentDefinitionId: "agent",
          agentVersion: "1",
          executionManifestRef: "manifest://shared",
          packVersions: [{ packId: "com.monai.pack.workspace-generic", version: "0.1.0" }],
          goal: "a",
          strategy: { type: "light", version: "1" },
        },
      }),
    );
    expect(first.ok).toBe(true);

    const engineB = new Engine({
      persistence,
      lease,
      model: new StubModelPort(),
      registry: pack.registry,
      manifestStore,
      toolAllowlist: ["echo"],
      requireApprovalTools: pack.requireApprovalTools,
    });
    const second = await engineB.handle(
      cmd({
        commandType: "create_run",
        commandId: "create-b",
        payload: {
          runId: "run-b",
          sessionId: "s1",
          agentDefinitionId: "agent",
          agentVersion: "1",
          executionManifestRef: "manifest://shared",
          packVersions: [{ packId: "com.monai.pack.workspace-generic", version: "0.1.0" }],
          goal: "b",
          strategy: { type: "light", version: "1" },
        },
      }),
    );
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.code).toBe("conflict");
  });
});
