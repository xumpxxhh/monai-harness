import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { truncateQueue } from "./apply-schema.js";
import { PostgresQueue } from "./postgres-queue.js";
import { startTestPostgres, type TestPgHandle } from "./postgres-queue.test-utils.js";

describe("PostgresQueue", () => {
  let pgHandle: TestPgHandle;
  let queue: PostgresQueue;

  beforeAll(async () => {
    pgHandle = await startTestPostgres();
    queue = new PostgresQueue(pgHandle.pool);
    await queue.applySchema();
  }, 90_000);

  afterAll(async () => {
    await pgHandle.stop();
  });

  beforeEach(async () => {
    await truncateQueue(pgHandle.pool);
  });

  it("enqueues idempotently on dedupeKey", async () => {
    await queue.enqueue({
      runId: "run-1",
      revision: 1,
      messageType: "queue_run",
      dedupeKey: "dk-1",
      payload: { n: 1 },
    });
    await queue.enqueue({
      runId: "run-1",
      revision: 1,
      messageType: "queue_run",
      dedupeKey: "dk-1",
      payload: { n: 2 },
    });
    const leased = await queue.lease(10, "owner-a");
    expect(leased).toHaveLength(1);
    expect(leased[0]?.dedupeKey).toBe("dk-1");
    expect(leased[0]?.payload).toEqual({ n: 1 });
  });

  it("leases exclusively under SKIP LOCKED (dual consumer)", async () => {
    await queue.enqueue({
      runId: "run-a",
      revision: 0,
      messageType: "queue_run",
      dedupeKey: "dual-a",
    });
    await queue.enqueue({
      runId: "run-b",
      revision: 0,
      messageType: "queue_run",
      dedupeKey: "dual-b",
    });

    const [batchA, batchB] = await Promise.all([
      queue.lease(10, "owner-a"),
      queue.lease(10, "owner-b"),
    ]);
    const ids = [...batchA, ...batchB].map((m) => m.messageId).sort();
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });

  it("nack returns message to ready", async () => {
    await queue.enqueue({
      runId: "run-nack",
      revision: 2,
      messageType: "queue_run",
      dedupeKey: "nack-1",
    });
    const [msg] = await queue.lease(1, "owner-a");
    expect(msg).toBeDefined();
    await queue.nack(msg!.messageId);
    const again = await queue.lease(1, "owner-b");
    expect(again).toHaveLength(1);
    expect(again[0]?.dedupeKey).toBe("nack-1");
  });

  it("ack removes message from ready pool", async () => {
    await queue.enqueue({
      runId: "run-ack",
      revision: 0,
      messageType: "queue_run",
      dedupeKey: "ack-1",
    });
    const [msg] = await queue.lease(1, "owner-a");
    await queue.ack(msg!.messageId);
    expect(await queue.lease(1, "owner-b")).toHaveLength(0);
  });
});
