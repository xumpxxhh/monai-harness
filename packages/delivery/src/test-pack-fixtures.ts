import type { HarnessCommand } from "@monai/ports";
import { InMemoryLease } from "@monai/lease-memory";
import type { ModelPort } from "@monai/ports";
import { StubModelPort } from "@monai/model-stub";
import { InMemoryPersistence } from "@monai/persistence-memory";
import { wireWorkspaceGenericPack, type WireWorkspaceGenericResult } from "./pack-wiring.js";
import type { WorkspacePort } from "@monai/ports";
import { Engine, InMemoryManifestStore } from "@monai/runtime";

import { ToolDispatcher } from "./tool-dispatcher.js";

export type PackTestFixtures = {
  persistence: InMemoryPersistence;
  lease: InMemoryLease;
  engine: Engine;
  tools: ToolDispatcher;
  pack: WireWorkspaceGenericResult;
  manifestStore: InMemoryManifestStore;
  ownerId: string;
};

export function createPackTestFixtures(options?: {
  workspace?: WorkspacePort;
  requireApprovalTools?: readonly string[];
  model?: ModelPort;
}): PackTestFixtures {
  const persistence = new InMemoryPersistence();
  const lease = new InMemoryLease();
  const ownerId = "worker-1";
  const pack = wireWorkspaceGenericPack({ workspace: options?.workspace, tenantId: "t1" });
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
  });
  const tools = new ToolDispatcher({
    outbox: persistence,
    persistence,
    engine,
    invoker: pack.invoker,
  });
  return { persistence, lease, engine, tools, pack, manifestStore, ownerId };
}

export async function toRunning(
  engine: Engine,
  cmd: (partial: Partial<HarnessCommand> & Pick<HarnessCommand, "commandType" | "commandId">) => HarnessCommand,
  runId: string,
  goal: string,
  ownerId: string,
) {
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
        packVersions: [{ packId: "com.monai.pack.workspace-generic", version: "0.1.0" }],
        goal,
        strategy: { type: "light", version: "1" },
      },
    }),
  );
  if (!created.ok) return created;

  const queued = await engine.handle(
    cmd({
      commandType: "queue_run",
      commandId: `queue-${runId}`,
      runId,
      expectedRevision: created.revision,
    }),
  );
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
