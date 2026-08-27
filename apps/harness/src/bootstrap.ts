import {
  CompensationScanner,
  OutboxDispatcher,
  Scheduler,
  ToolDispatcher,
  type CompensationStore,
} from "@monai/delivery";
import { InMemoryLease } from "@monai/lease-memory";
import { StubModelPort } from "@monai/model-stub";
import { InMemoryPersistence } from "@monai/persistence-memory";
import {
  createPostgresPersistence,
  type PostgresPersistence,
} from "@monai/persistence-postgres";
import type { IdempotencyPort, LeasePort, OutboxPort, PersistencePort, QueuePort } from "@monai/ports";
import { InMemoryQueue } from "@monai/queue-memory";
import { Engine, HookRunner, ToolInvoker } from "@monai/runtime";
import { IsolatedSyntheticSink } from "@monai/synthetic-sink";

import type { HarnessConfig } from "./config.js";

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
  dispatcher: OutboxDispatcher;
  scheduler: Scheduler;
  compensation: CompensationScanner;
  toolDispatcher: ToolDispatcher;
  ownerId: string;
  close: () => Promise<void>;
};

async function buildPersistence(config: HarnessConfig): Promise<PersistenceBundle> {
  if (config.persistenceDriver === "postgres") {
    const store: PostgresPersistence = await createPostgresPersistence(config.databaseUrl);
    return store;
  }
  return new InMemoryPersistence();
}

/**
 * Bootstrap DI: config → adapters → Engine → delivery (EDR-002/014).
 * HTTP is started by apps/harness via createHttpApp (EDR-007 Hono).
 */
export async function bootstrap(config: HarnessConfig): Promise<HarnessRuntime> {
  const ownerId = "harness-worker";
  const persistence = await buildPersistence(config);
  const lease: LeasePort = new InMemoryLease();
  const queue: QueuePort = new InMemoryQueue();
  const sink = new IsolatedSyntheticSink();
  const invoker = new ToolInvoker({ synthetic: sink });

  const engine = new Engine({
    persistence,
    lease,
    model: new StubModelPort(),
    hooks: new HookRunner(),
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
    invoker,
    ownerId: `${ownerId}-tools`,
  });

  return {
    config,
    persistence,
    lease,
    queue,
    engine,
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
