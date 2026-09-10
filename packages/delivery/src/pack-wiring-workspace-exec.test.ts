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

  it("timeout failure error uses summary and keeps stdout in data", async () => {
    const root = mkdtempSync(join(tmpdir(), "monai-wire-wsexec-to-"));
    const shell = {
      getWorkspaceRoot: () => root,
      exec: async () => ({
        exitCode: null as number | null,
        stdout: "npm notice partial",
        stderr: "still running",
        timedOut: true,
        truncated: false,
        cwd: root,
      }),
    };
    const handler = workspaceGenericToolHandlers["workspace_exec"]!;
    const handled = await handler({
      toolId: "workspace_exec",
      toolCallId: "tc-ws-timeout",
      arguments: { command: "npm install --no-audit", timeout_ms: 1000 },
      executionContext: {
        tenantId: "t1",
        sessionId: "s1",
        runId: "r1",
        executionManifestRef: "manifest://test",
        effectivePermissions: ["workspace_exec"],
        ports: { workspaceShell: shell },
      },
    });
    expect(handled.ok).toBe(false);
    expect(handled.error).toMatch(/^workspace_exec timed out:/);
    expect(handled.error).toContain("npm install");
    expect(handled.error).toContain("still running");
    expect(handled.error).toContain("npm notice partial");
    expect(handled.data).toMatchObject({
      stdout: "npm notice partial",
      stderr: "still running",
      timedOut: true,
      cwd: root,
    });
  });

  it("exit failure error embeds stderr/stdout for the model", async () => {
    const root = mkdtempSync(join(tmpdir(), "monai-wire-wsexec-exit-"));
    const shell = {
      getWorkspaceRoot: () => root,
      exec: async () => ({
        exitCode: 1,
        stdout: "\n> app@0.1.0 build\n> tsc -b && vite build\n\n",
        stderr: "error TS2307: Cannot find module 'react'\n",
        timedOut: false,
        truncated: false,
        cwd: root,
      }),
    };
    const handler = workspaceGenericToolHandlers["workspace_exec"]!;
    const handled = await handler({
      toolId: "workspace_exec",
      toolCallId: "tc-ws-exit",
      arguments: { command: "npm run build" },
      executionContext: {
        tenantId: "t1",
        sessionId: "s1",
        runId: "r1",
        executionManifestRef: "manifest://test",
        effectivePermissions: ["workspace_exec"],
        ports: { workspaceShell: shell },
      },
    });
    expect(handled.ok).toBe(false);
    expect(handled.error).toContain("workspace_exec exit=1");
    expect(handled.error).toContain("error TS2307");
    expect(handled.data).toMatchObject({
      exitCode: 1,
      stderr: "error TS2307: Cannot find module 'react'\n",
    });
  });

  it("rejects cwd escape from workspace root", async () => {
    const root = mkdtempSync(join(tmpdir(), "monai-wire-wsexec-esc-"));
    const shell = new BashWorkspaceShell({ workspaceRoot: root });
    await expect(shell.exec({ command: "pwd", cwd: ".." })).rejects.toThrow(/escapes/);
  });
});
