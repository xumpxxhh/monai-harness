import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { SubprocessSandbox, parseAllowedBinaries } from "./subprocess-sandbox.js";

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), "monai-sandbox-"));
}

describe("parseAllowedBinaries", () => {
  it("returns empty for blank (fail closed)", () => {
    expect(parseAllowedBinaries(undefined)).toEqual([]);
    expect(parseAllowedBinaries("  ")).toEqual([]);
  });

  it("splits comma list", () => {
    expect(parseAllowedBinaries("node, python")).toEqual(["node", "python"]);
  });
});

describe("SubprocessSandbox", () => {
  it("fails closed when allowlist empty", async () => {
    const sandbox = new SubprocessSandbox({
      sandboxRoot: tempRoot(),
      allowedBinaries: [],
    });
    await expect(sandbox.exec({ argv: ["node", "-e", "1"] })).rejects.toThrow(/fail closed/);
  });

  it("rejects path separators in argv[0]", async () => {
    const sandbox = new SubprocessSandbox({
      sandboxRoot: tempRoot(),
      allowedBinaries: ["node"],
    });
    await expect(sandbox.exec({ argv: ["../node", "-e", "1"] })).rejects.toThrow(/bare binary/);
  });

  it("rejects binaries not on allowlist", async () => {
    const sandbox = new SubprocessSandbox({
      sandboxRoot: tempRoot(),
      allowedBinaries: ["node"],
    });
    await expect(sandbox.exec({ argv: ["python", "-c", "1"] })).rejects.toThrow(/not allowed/);
  });

  it("rejects cwd escape", async () => {
    const sandbox = new SubprocessSandbox({
      sandboxRoot: tempRoot(),
      allowedBinaries: ["node"],
    });
    await expect(
      sandbox.exec({ argv: ["node", "-e", "1"], cwd: ".." }),
    ).rejects.toThrow(/escapes sandboxRoot/);
  });

  it("runs allowed node -e and returns stdout", async () => {
    const sandbox = new SubprocessSandbox({
      sandboxRoot: tempRoot(),
      allowedBinaries: process.platform === "win32" ? ["node", "node.exe"] : ["node"],
    });
    const result = await sandbox.exec({
      argv: ["node", "-e", "process.stdout.write('ok-sandbox')"],
      timeoutMs: 10_000,
    });
    expect(result.timedOut).toBe(false);
    expect(result.truncated).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("ok-sandbox");
  });

  it("marks truncated when over maxStdoutBytes", async () => {
    const sandbox = new SubprocessSandbox({
      sandboxRoot: tempRoot(),
      allowedBinaries: process.platform === "win32" ? ["node", "node.exe"] : ["node"],
      defaultMaxStdoutBytes: 8,
    });
    const result = await sandbox.exec({
      argv: ["node", "-e", "process.stdout.write('0123456789ABCDEF')"],
      timeoutMs: 10_000,
    });
    expect(result.truncated).toBe(true);
    expect(result.stdout.length).toBeLessThanOrEqual(8);
  });

  it("marks timedOut when wall clock exceeded", async () => {
    const sandbox = new SubprocessSandbox({
      sandboxRoot: tempRoot(),
      allowedBinaries: process.platform === "win32" ? ["node", "node.exe"] : ["node"],
      defaultTimeoutMs: 200,
    });
    const result = await sandbox.exec({
      argv: [
        "node",
        "-e",
        "Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,5000)",
      ],
      timeoutMs: 200,
    });
    expect(result.timedOut).toBe(true);
    expect(result.exitCode).toBeNull();
  }, 15_000);
});
