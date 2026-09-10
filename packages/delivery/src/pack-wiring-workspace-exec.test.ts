import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BashWorkspaceShell,
  workspaceGenericToolHandlers,
} from "@monai/pack-workspace-generic";
import { describe, expect, it } from "vitest";

import { wireWorkspaceGenericPack } from "./pack-wiring.js";

describe("wireWorkspaceGenericPack workspace_exec (EDR-014)", () => {
  it("never allowlists workspace_exec by default", () => {
    const pack = wireWorkspaceGenericPack({ tenantId: "t1" });
    expect(pack.toolAllowlist).not.toContain("workspace_exec");
    expect(pack.registry.getToolAllowlist()).not.toContain("workspace_exec");
  });

  it("fail-closes when enableWorkspaceExec without WorkspaceShellPort", () => {
    expect(() =>
      wireWorkspaceGenericPack({
        tenantId: "t1",
        enableWorkspaceExec: true,
      }),
    ).toThrow(/WorkspaceShellPort/);
  });

  it("opt-in registers workspace_exec and can run bash in workspace root", async () => {
    const root = mkdtempSync(join(tmpdir(), "monai-wire-wsexec-"));
    writeFileSync(join(root, "hello.txt"), "hello-workspace-exec\n", "utf8");
    const shell = new BashWorkspaceShell({ workspaceRoot: root, shellBinary: "bash" });
    const pack = wireWorkspaceGenericPack({
      tenantId: "t1",
      enableWorkspaceExec: true,
      workspaceShell: shell,
    });
    expect(pack.toolAllowlist).toContain("workspace_exec");
    expect(pack.registry.getToolAllowlist()).toContain("workspace_exec");

    const result = await shell.exec({
      command: "cat hello.txt",
      timeoutMs: 15_000,
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("hello-workspace-exec");
    expect(result.cwd).toBe(root);

    const handler = workspaceGenericToolHandlers["workspace_exec"]!;
    const handled = await handler({
      toolId: "workspace_exec",
      toolCallId: "tc-ws-exec",
      arguments: { command: "cat hello.txt" },
      executionContext: {
        tenantId: "t1",
        sessionId: "s1",
        runId: "r1",
        executionManifestRef: "manifest://test",
        effectivePermissions: ["workspace_exec"],
        ports: { workspaceShell: shell },
      },
    });
    expect(handled.ok).toBe(true);
    expect((handled.data as { stdout: string }).stdout).toContain("hello-workspace-exec");
  });

  it("rejects cwd escape from workspace root", async () => {
    const root = mkdtempSync(join(tmpdir(), "monai-wire-wsexec-esc-"));
    const shell = new BashWorkspaceShell({ workspaceRoot: root });
    await expect(shell.exec({ command: "pwd", cwd: ".." })).rejects.toThrow(/escapes/);
  });
});
