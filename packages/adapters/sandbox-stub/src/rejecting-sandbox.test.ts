import { describe, expect, it } from "vitest";

import { RejectingSandbox, SANDBOX_EXEC_DISABLED_MESSAGE } from "./rejecting-sandbox.js";

describe("RejectingSandbox", () => {
  it("rejects any exec call", async () => {
    const sandbox = new RejectingSandbox();
    await expect(sandbox.exec({ argv: ["echo", "hi"] })).rejects.toThrow(SANDBOX_EXEC_DISABLED_MESSAGE);
    await expect(sandbox.exec({ argv: ["id"] })).rejects.toThrow(/EDR-014/);
  });
});
