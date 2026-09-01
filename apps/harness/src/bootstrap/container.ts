import {
  CompensationScanner,
  OutboxDispatcher,
  Scheduler,
  ToolDispatcher,
  wireWorkspaceGenericPack,
  type CompensationStore,
} from "@monai/delivery";
import { InMemoryGovernanceEventStore } from "@monai/governance";
import { InMemoryLease } from "@monai/lease-memory";
import { OpenAiModelPort } from "@monai/model-openai";
import { StubModelPort } from "@monai/model-stub";
import { InMemoryPersistence } from "@monai/persistence-memory";
import {
  createPostgresPersistence,
  type PostgresPersistence,
} from "@monai/persistence-postgres";
import type {
  IdempotencyPort,
  LeasePort,
  ModelPort,
  OutboxPort,
  PersistencePort,
  QueuePort,
  SecretPort,
} from "@monai/ports";
import { mkdir } from "node:fs/promises";

import { InMemoryQueue } from "@monai/queue-memory";
import { Engine, InMemoryManifestStore, PreviewHub } from "@monai/runtime";
import { EnvSecretPort } from "@monai/secret-env";

import type { HarnessConfig } from "../config/env.js";
import { FsWorkspace } from "../workspace/fs-workspace.js";

export type PersistenceBundle = PersistencePort &
  OutboxPort &
  IdempotencyPort &
  CompensationStore & {
    close?: () => Promise<void>;
  };

export type HarnessRuntime = {
  config: HarnessConfig;
  persistence: PersistenceBundle;
  lease: LeasePort;
  queue: QueuePort;
  engine: Engine;
  previewHub: PreviewHub;
  dispatcher: OutboxDispatcher;
  scheduler: Scheduler;
  compensation: CompensationScanner;
  toolDispatcher: ToolDispatcher;
  ownerId: string;
  close: () => Promise<void>;
};

export async function buildPersistence(config: HarnessConfig): Promise<PersistenceBundle> {
  if (config.persistenceDriver === "postgres") {
    const store: PostgresPersistence = await createPostgresPersistence(config.databaseUrl);
    return store;
  }
  return new InMemoryPersistence();
}

/**
 * Bootstrap DI: config → adapters → Pack → Engine → delivery (EDR-002/014).
 */
export async function bootstrap(config: HarnessConfig): Promise<HarnessRuntime> {
  const ownerId = "harness-worker";
  const persistence = await buildPersistence(config);
  const lease: LeasePort = new InMemoryLease();
  const queue: QueuePort = new InMemoryQueue();
  await mkdir(config.workspaceDir, { recursive: true });
  const workspace = new FsWorkspace(config.workspaceDir);
  console.log(`[harness] workspace: ${workspace.getRootDir()}`);

  const governanceStore = config.roles.governance
    ? new InMemoryGovernanceEventStore()
    : undefined;
  const pack = wireWorkspaceGenericPack({ workspace, tenantId: "t1", governanceStore });
  const manifestStore = new InMemoryManifestStore();

  const secretPort: SecretPort = new EnvSecretPort();
  const model: ModelPort =
    config.modelDriver === "openai"
      ? new OpenAiModelPort({
          secretPort,
          baseUrl: config.openaiBaseUrl,
          defaultModel: config.openaiModel,
          responseFormatMode: config.openaiResponseFormat,
          authHeaderName: config.openaiAuthHeader,
        })
      : new StubModelPort();

  const previewHub = new PreviewHub();

  const engine = new Engine({
    persistence,
    lease,
    model,
    modelPolicy:
      config.modelDriver === "openai" && config.openaiModel
        ? {
            version: "1.0.0",
            resolvedTarget: config.openaiModel,
            digest: `digest:model-policy:${config.openaiModel}`,
          }
        : undefined,
    hooks: pack.hookRunner,
    registry: pack.registry,
    manifestStore,
    toolAllowlist: pack.toolAllowlist,
    requireApprovalTools: pack.requireApprovalTools,
    previewHub,
  });

  const dispatcher = new OutboxDispatcher({ outbox: persistence, queue });
  const scheduler = new Scheduler({ queue, engine, ownerId });
  const compensation = new CompensationScanner({
    store: persistence,
    queue,
    createdStaleMs: 5_000,
  });
  const toolDispatcher = new ToolDispatcher({
    outbox: persistence,
    persistence,
    engine,
    invoker: pack.invoker,
    ownerId: `${ownerId}-tools`,
  });

  return {
    config,
    persistence,
    lease,
    queue,
    engine,
    previewHub,
    dispatcher,
    scheduler,
    compensation,
    toolDispatcher,
    ownerId,
    close: async () => {
      if (typeof persistence.close === "function") {
        await persistence.close();
      }
    },
  };
}
