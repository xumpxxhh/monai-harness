import { describe, expect, it } from "vitest";

import { assertCommandTenant } from "./tenant-guard.js";

describe("assertCommandTenant", () => {
  it("returns authorization failure on tenant mismatch", () => {
    const failure = assertCommandTenant({ tenantId: "t1" }, { tenantId: "t2" });
    expect(failure).toEqual({
      ok: false,
      code: "authorization",
      message: "tenant mismatch: command=t2 run=t1",
    });
  });

  it("returns null when tenants match", () => {
    expect(assertCommandTenant({ tenantId: "t1" }, { tenantId: "t1" })).toBeNull();
  });
});
