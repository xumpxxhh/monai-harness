import {
  CompensationScanner,
  OutboxDispatcher,
  Scheduler,
  ToolDispatcher,
  wireWorkspaceGenericPack,
  type CompensationStore,
} from "@monai/delivery";
import { InMemoryGovernanceEventStore } from "@monai/governance";
import { HttpKnowledgeSearchClient } from "@monai/knowledge-http";
import { InMemoryLease } from "@monai/lease-memory";
import { createPostgresLease } from "@monai/lease-postgres";
import { OpenAiModelPort } from "@monai/model-openai";
import { StubModelPort } from "@monai/model-stub";
import { FsObjectStore } from "@monai/objectstore-fs";
import { InMemoryPersistence } from "@monai/persistence-memory";
import {
  createPostgresPersistence,
  type PostgresPersistence,
} from "@monai/persistence-postgres";
import type {
  IdempotencyPort,
  LeasePort,
  ModelPort,
  ObjectStorePort,
  OutboxPort,
  PersistencePort,
  QueuePort,
  SandboxPort,
  SecretPort,
} from "@monai/ports";
import { mkdir } from "node:fs/promises";

import { InMemoryQueue } from "@monai/queue-memory";
import { createPostgresQueue } from "@monai/queue-postgres";
import { Engine, InMemoryManifestStore, PreviewHub } from "@monai/runtime";
import { RejectingSandbox } from "@monai/sandbox-stub";
import { EnvSecretPort } from "@monai/secret-env";

import type { HarnessConfig } from "../config/env.js";
import { FsWorkspace } from "../workspace/fs-workspace.js";

export type PersistenceBundle = PersistencePort &
  OutboxPort &
  IdempotencyPort &
  CompensationStore & {
    close?: () => Promise<void>;
  };

type ClosablePort = { close?: () => Promise<void> };

export type HarnessRuntime = {
  config: HarnessConfig;
  persistence: PersistenceBundle;
  lease: LeasePort;
  queue: QueuePort;
  objectStore: ObjectStorePort;
  sandbox: SandboxPort;
  engine: Engine;
  previewHub: PreviewHub;
  dispatcher: OutboxDispatcher;
  scheduler: Scheduler;
  compensation: CompensationScanner;
  toolDispatcher: ToolDispatcher;
  ownerId: string;
  close: () => Promise<void>;
};

const HARNESS_TENANT_ID = "t1";

export async function buildPersistence(config: HarnessConfig): Promise<PersistenceBundle> {
  if (config.persistenceDriver === "postgres") {
    const store: PostgresPersistence = await createPostgresPersistence(config.databaseUrl);
    return store;
  }
  return new InMemoryPersistence();
}

export async function buildQueue(config: HarnessConfig): Promise<QueuePort & ClosablePort> {
  if (config.queueDriver === "postgres") {
    return createPostgresQueue(config.databaseUrl);
  }
  return new InMemoryQueue();
}

export async function buildLease(config: HarnessConfig): Promise<LeasePort & ClosablePort> {
  if (config.leaseDriver === "postgres") {
    return createPostgresLease(config.databaseUrl);
  }
  return new InMemoryLease();
}

/**
 * Bootstrap DI: config → adapters → Pack → Engine → delivery (EDR-002/014).
 */
export async function bootstrap(config: HarnessConfig): Promise<HarnessRuntime> {
  const ownerId = "harness-worker";
  const persistence = await buildPersistence(config);
  const lease = await buildLease(config);
  const queue = await buildQueue(config);
  await mkdir(config.workspaceDir, { recursive: true });
  await mkdir(config.objectStoreDir, { recursive: true });
  const workspace = new FsWorkspace(config.workspaceDir);
  const objectStore = new FsObjectStore({
    rootDir: config.objectStoreDir,
    tenantId: HARNESS_TENANT_ID,
  });
  const sandbox = new RejectingSandbox();
  console.log(`[harness] workspace: ${workspace.getRootDir()}`);
  console.log(`[harness] objectStore: ${objectStore.getTenantRoot()}`);
  console.log(
    `[harness] drivers persistence=${config.persistenceDriver} queue=${config.queueDriver} lease=${config.leaseDriver}`,
  );

  const governanceStore = config.roles.governance
    ? new InMemoryGovernanceEventStore()
    : undefined;
  const pack = wireWorkspaceGenericPack({
    workspace,
    tenantId: HARNESS_TENANT_ID,
    governanceStore,
    sandbox,
    objectStore,
    knowledgeSearch: config.knowledgeBaseUrl
      ? new HttpKnowledgeSearchClient({
          baseUrl: config.knowledgeBaseUrl,
          defaultCollectionIds: config.knowledgeCollectionIds,
          defaultTopK: config.knowledgeTopK,
          timeoutMs: config.knowledgeTimeoutMs,
        })
      : undefined,
  });
  if (pack.toolAllowlist.includes("sandbox.exec")) {
    throw new Error("[harness][edr-014] sandbox.exec must not appear on tool allowlist");
  }
  if (config.knowledgeBaseUrl) {
    console.log(
      `[harness] knowledge.search enabled base=${config.knowledgeBaseUrl} collections=${config.knowledgeCollectionIds.length}`,
    );
  }
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
    leaseTtlMs: 300_000,
    modelPolicy:
      config.modelDriver === "openai" && config.openaiModel
        ? {
            version: "1.0.0",
            resolvedTarget: config.openaiModel,
            digest: `digest:model-policy:${config.openaiModel}`,
            ...(config.openaiMaxTokens !== undefined
              ? { maxTokens: config.openaiMaxTokens }
              : {}),
          }
        : undefined,
    projectionPolicy: config.contextProjectionPolicy,
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
    objectStore,
    sandbox,
    engine,
    previewHub,
    dispatcher,
    scheduler,
    compensation,
    toolDispatcher,
    ownerId,
    close: async () => {
      if (typeof queue.close === "function") {
        await queue.close();
      }
      if (typeof lease.close === "function") {
        await lease.close();
      }
      if (typeof persistence.close === "function") {
        await persistence.close();
      }
    },
  };
}
