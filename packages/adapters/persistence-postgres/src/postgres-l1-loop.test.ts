import { CONTRACTS_SCHEMA_VERSION } from "@monai/contracts";
import {
  CompensationScanner,
  OutboxDispatcher,
  Scheduler,
} from "@monai/delivery";
import { applyLeaseSchema, PostgresLease, truncateLeases } from "@monai/lease-postgres";
import type { HarnessCommand } from "@monai/ports";
import { applyQueueSchema, PostgresQueue, truncateQueue } from "@monai/queue-postgres";
import { Engine } from "@monai/runtime";
import type pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { truncateAll } from "./apply-schema.js";
import { PostgresPersistence } from "./postgres-persistence.js";
import { startTestPostgres, type TestPgHandle } from "./postgres-persistence.test-utils.js";

function createCmd(runId: string, commandId: string): HarnessCommand {
  return {
    schemaVersion: CONTRACTS_SCHEMA_VERSION,
    commandId,
    commandType: "create_run",
    tenantId: "tenant-1",
    runId,
    payload: {
      runId,
      sessionId: "session-1",
      agentDefinitionId: "agent",
      agentVersion: "1",
      executionManifestRef: "manifest-1",
      packVersions: [],
      goal: "goal",
      strategy: { type: "light", version: "1" },
      budgets: {},
    },
    issuedAt: new Date().toISOString(),
    correlationId: commandId,
  };
}

async function countActiveQueueMessages(pool: pg.Pool): Promise<number> {
  const result = await pool.query<{ n: number }>(
    `SELECT count(*)::int AS n
     FROM queue_messages
     WHERE status IN ('ready', 'leased')`,
  );
  return result.rows[0]?.n ?? 0;
}

/**
 * L1 CreateRun→running on full postgres adapters (persistence + queue + lease).
 * Same scenarios as delivery `create-run-loop.test.ts` (memory) and prior P9d L1-on-PG
 * (which still used in-memory queue/lease).
 */
describe("Postgres L1 CreateRun loop (persistence+queue+lease)", () => {
  let handle: TestPgHandle;
  let store: PostgresPersistence;

  beforeAll(async () => {
    handle = await startTestPostgres();
    store = new PostgresPersistence(handle.pool);
    await store.applySchema();
    await applyQueueSchema(handle.pool);
    await applyLeaseSchema(handle.pool);
  });

  afterAll(async () => {
    await handle.stop();
  });

  beforeEach(async () => {
    await truncateAll(handle.pool);
    await truncateQueue(handle.pool);
    await truncateLeases(handle.pool);
  });

  function buildHarness() {
    const lease = new PostgresLease(handle.pool);
    const queue = new PostgresQueue(handle.pool);
    const engine = new Engine({ persistence: store, lease });
    const dispatcher = new OutboxDispatcher({ outbox: store, queue });
    const scheduler = new Scheduler({ queue, engine });
    const compensation = new CompensationScanner({
      store,
      queue,
      createdStaleMs: 0,
    });
    return { engine, dispatcher, scheduler, compensation, queue, lease };
  }

  it("reaches running with created → queued → lease_acquired events", async () => {
    const { engine, dispatcher, scheduler, lease } = buildHarness();
    const created = await engine.handle(createCmd("run-main", "cmd-main"));
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.run.status).toBe("created");

    expect(await dispatcher.tick()).toBeGreaterThan(0);
    expect(await scheduler.tick()).toBeGreaterThan(0);

    const run = await store.getRun("run-main");
    expect(run?.status).toBe("running");
    expect(run?.leaseEpoch).toBe(1);

    const bound = await lease.get("run-main");
    expect(bound?.leaseEpoch).toBe(1);
    expect(bound?.ownerId).toBeTruthy();

    const types = (await store.listEvents("run-main")).map((e) => e.eventType);
    expect(types).toEqual(["run.created", "run.queued", "run.lease_acquired"]);
  });

  it("dedupes dual outbox/queue delivery", async () => {
    const { engine, dispatcher, scheduler, queue } = buildHarness();
    await engine.handle(createCmd("run-dup", "cmd-dup"));

    await dispatcher.tick();
    const outbox = (await store.listOutbox())[0]!;
    await queue.enqueue({
      runId: "run-dup",
      revision: 1,
      messageType: "queue_run",
      dedupeKey: outbox.message.dedupeKey,
      payload: outbox.message.payload,
    });
    expect(await countActiveQueueMessages(handle.pool)).toBe(1);

    await scheduler.tick();
    await scheduler.tick();

    const run = await store.getRun("run-dup");
    expect(run?.status).toBe("running");
    const events = await store.listEvents("run-dup");
    expect(events.filter((e) => e.eventType === "run.queued")).toHaveLength(1);
    expect(events.filter((e) => e.eventType === "run.lease_acquired")).toHaveLength(1);
  });

  it("compensation rebuilds queue signal for unpublished outbox", async () => {
    const { engine, dispatcher, scheduler, compensation } = buildHarness();
    await engine.handle(createCmd("run-comp", "cmd-comp"));

    expect((await store.listOutbox())[0]?.status).toBe("pending");
    expect(await countActiveQueueMessages(handle.pool)).toBe(0);

    await compensation.tick();
    expect(await countActiveQueueMessages(handle.pool)).toBe(1);

    await dispatcher.tick();
    await scheduler.tick();

    const run = await store.getRun("run-comp");
    expect(run?.status).toBe("running");
    const types = (await store.listEvents("run-comp")).map((e) => e.eventType);
    expect(types).toEqual(["run.created", "run.queued", "run.lease_acquired"]);
  });
});
