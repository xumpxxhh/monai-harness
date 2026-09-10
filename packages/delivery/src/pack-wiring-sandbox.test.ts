import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SubprocessSandbox } from "@monai/sandbox-subprocess";
import { RejectingSandbox, SANDBOX_EXEC_DISABLED_MESSAGE } from "@monai/sandbox-stub";
import { describe, expect, it } from "vitest";

import { wireWorkspaceGenericPack } from "./pack-wiring.js";

describe("wireWorkspaceGenericPack sandbox (EDR-014)", () => {
  it("injects rejecting sandbox and never allowlists sandbox_exec by default", async () => {
    const pack = wireWorkspaceGenericPack({ tenantId: "t1" });
    expect(pack.toolAllowlist).not.toContain("sandbox_exec");
    expect(pack.registry.getToolAllowlist()).not.toContain("sandbox_exec");
    await expect(pack.sandbox.exec({ argv: ["id"] })).rejects.toThrow(SANDBOX_EXEC_DISABLED_MESSAGE);
  });

  it("fail-closes when enableSandboxExec with RejectingSandbox", () => {
    expect(() =>
      wireWorkspaceGenericPack({
        tenantId: "t1",
        enableSandboxExec: true,
        sandbox: new RejectingSandbox(),
      }),
    ).toThrow(/executable SandboxPort/);
  });

  it("opt-in registers sandbox_exec and can run allowlisted node", async () => {
    const sandbox = new SubprocessSandbox({
      sandboxRoot: mkdtempSync(join(tmpdir(), "monai-wire-sandbox-")),
      allowedBinaries: process.platform === "win32" ? ["node", "node.exe"] : ["node"],
    });
    const pack = wireWorkspaceGenericPack({
      tenantId: "t1",
      enableSandboxExec: true,
      sandbox,
    });
    expect(pack.toolAllowlist).toContain("sandbox_exec");
    expect(pack.registry.getToolAllowlist()).toContain("sandbox_exec");
    const result = await pack.sandbox.exec({
      argv: ["node", "-e", "process.stdout.write('wire-ok')"],
      timeoutMs: 10_000,
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("wire-ok");
  });
});
