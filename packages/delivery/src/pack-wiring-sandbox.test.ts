import { SANDBOX_EXEC_DISABLED_MESSAGE } from "@monai/sandbox-stub";
import { describe, expect, it } from "vitest";

import { wireWorkspaceGenericPack } from "./pack-wiring.js";

describe("wireWorkspaceGenericPack sandbox (EDR-014)", () => {
  it("injects rejecting sandbox and never allowlists sandbox.exec", async () => {
    const pack = wireWorkspaceGenericPack({ tenantId: "t1" });
    expect(pack.toolAllowlist).not.toContain("sandbox.exec");
    expect(pack.registry.getToolAllowlist()).not.toContain("sandbox.exec");
    await expect(pack.sandbox.exec({ cmd: "id" })).rejects.toThrow(SANDBOX_EXEC_DISABLED_MESSAGE);
  });
});
