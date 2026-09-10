import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { BashWorkspaceShell, wrapCommandForCapture } from "./bash-workspace-shell.js";

describe("wrapCommandForCapture", () => {
  it("base64-wraps an inner script that logs then replays output", () => {
    const wrapped = wrapCommandForCapture("npm run build");
    expect(wrapped).toMatch(/^echo [A-Za-z0-9+/=]+ \| \(base64/);
    const b64 = wrapped.split(" ")[1]!;
    const inner = Buffer.from(b64, "base64").toString("utf8");
    expect(inner).toContain("( npm run build ) >.monai-ws-exec-$$.log 2>&1");
    expect(inner).toContain("ec=$?");
    expect(inner).toContain("cat .monai-ws-exec-$$.log");
    expect(inner).toContain("exit $ec");
  });
});

describe("BashWorkspaceShell capture", () => {
  it("captures combined stdout/stderr from a failing command", async () => {
    const root = mkdtempSync(join(tmpdir(), "monai-ws-capture-"));
    writeFileSync(join(root, "keep.txt"), "x\n", "utf8");
    const shell = new BashWorkspaceShell({ workspaceRoot: root, shellBinary: "bash" });
    const result = await shell.exec({
      command: "echo OUT_OK; echo ERR_FAIL >&2; exit 7",
      timeoutMs: 15_000,
    });
    expect(result.exitCode).toBe(7);
    // Merged into stdout via 2>&1 file redirect.
    expect(result.stdout).toContain("OUT_OK");
    expect(result.stdout).toContain("ERR_FAIL");
  });
});
