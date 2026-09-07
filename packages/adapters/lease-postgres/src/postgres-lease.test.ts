import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { truncateLeases } from "./apply-schema.js";
import { PostgresLease } from "./postgres-lease.js";
import { startTestPostgres, type TestPgHandle } from "./postgres-lease.test-utils.js";

describe("PostgresLease", () => {
  let pgHandle: TestPgHandle;
  let lease: PostgresLease;

  beforeAll(async () => {
    pgHandle = await startTestPostgres();
    lease = new PostgresLease(pgHandle.pool);
    await lease.applySchema();
  }, 90_000);

  afterAll(async () => {
    await pgHandle.stop();
  });

  beforeEach(async () => {
    await truncateLeases(pgHandle.pool);
  });

  it("bind then validate for matching owner/epoch", async () => {
    await lease.bind("run-1", "owner-a", 1, 60_000);
    expect(await lease.validate("run-1", "owner-a", 1)).toBe(true);
    expect(await lease.validate("run-1", "owner-b", 1)).toBe(false);
    expect(await lease.validate("run-1", "owner-a", 2)).toBe(false);
  });

  it("rejects heartbeat from stale owner", async () => {
    await lease.bind("run-2", "owner-a", 1, 60_000);
    await expect(lease.heartbeat("run-2", "owner-b", 1)).rejects.toThrow(/heartbeat rejected/);
  });

  it("release clears lease for matching owner/epoch only", async () => {
    await lease.bind("run-3", "owner-a", 2, 60_000);
    await lease.release("run-3", "owner-b", 2);
    expect(await lease.get("run-3")).toBeDefined();
    await lease.release("run-3", "owner-a", 2);
    expect(await lease.get("run-3")).toBeUndefined();
  });

  it("bind overwrite transfers ownership on new epoch", async () => {
    await lease.bind("run-4", "owner-a", 1, 60_000);
    await lease.bind("run-4", "owner-b", 2, 60_000);
    expect(await lease.validate("run-4", "owner-a", 1)).toBe(false);
    expect(await lease.validate("run-4", "owner-b", 2)).toBe(true);
  });
});
