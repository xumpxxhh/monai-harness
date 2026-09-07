import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { resolve, sep } from "node:path";

import type { SandboxExecRequest, SandboxExecResult, SandboxPort } from "@monai/ports";

const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_BYTES = 64_000;

export type SubprocessSandboxOptions = {
  /** Absolute root; cwd must resolve under this directory. */
  sandboxRoot: string;
  /**
   * Allowed argv[0] basenames only (no path separators), e.g. `node`, `node.exe`.
   * Empty → fail closed on every exec.
   */
  allowedBinaries: readonly string[];
  defaultTimeoutMs?: number;
  defaultMaxStdoutBytes?: number;
  defaultMaxStderrBytes?: number;
  /** Extra process.env keys to forward (beyond a minimal platform set). */
  envAllowlist?: readonly string[];
};

function hasPathSep(value: string): boolean {
  return value.includes("/") || value.includes("\\") || value.includes("\0");
}

function normalizeBinaryName(name: string): string {
  return process.platform === "win32" ? name.toLowerCase() : name;
}

function isUnderRoot(root: string, candidate: string): boolean {
  const resolvedRoot = resolve(root);
  const resolvedCandidate = resolve(candidate);
  const prefix = resolvedRoot.endsWith(sep) ? resolvedRoot : resolvedRoot + sep;
  return resolvedCandidate === resolvedRoot || resolvedCandidate.startsWith(prefix);
}

function buildEnv(
  requestEnv: Record<string, string> | undefined,
  envAllowlist: readonly string[],
): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  const baseKeys =
    process.platform === "win32"
      ? ["SystemRoot", "SYSTEMROOT", "PATH", "Path", "PATHEXT", "TEMP", "TMP", "USERPROFILE"]
      : ["PATH", "HOME", "TMPDIR", "LANG"];
  for (const key of [...baseKeys, ...envAllowlist]) {
    const v = process.env[key];
    if (v !== undefined) out[key] = v;
  }
  if (requestEnv) {
    for (const [key, value] of Object.entries(requestEnv)) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
        throw new Error(`sandbox env key rejected: ${key}`);
      }
      out[key] = value;
    }
  }
  return out;
}

function decodeBounded(buf: Buffer, maxBytes: number): { text: string; truncated: boolean } {
  const truncated = buf.length > maxBytes;
  const slice = truncated ? buf.subarray(0, maxBytes) : buf;
  return { text: slice.toString("utf8"), truncated };
}

function killProcessTree(pid: number): void {
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(pid), "/t", "/f"], {
      shell: false,
      stdio: "ignore",
      windowsHide: true,
    }).unref();
    return;
  }
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    /* already exited */
  }
}

/**
 * Process-level SandboxPort (opt-in). Not full isolation (no cgroup/netns).
 */
export class SubprocessSandbox implements SandboxPort {
  private readonly sandboxRoot: string;
  private readonly allowed: Set<string>;
  private readonly defaultTimeoutMs: number;
  private readonly defaultMaxStdoutBytes: number;
  private readonly defaultMaxStderrBytes: number;
  private readonly envAllowlist: readonly string[];

  constructor(options: SubprocessSandboxOptions) {
    this.sandboxRoot = resolve(options.sandboxRoot);
    mkdirSync(this.sandboxRoot, { recursive: true });
    this.allowed = new Set(
      options.allowedBinaries.map((b) => normalizeBinaryName(b.trim())).filter(Boolean),
    );
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.defaultMaxStdoutBytes = options.defaultMaxStdoutBytes ?? DEFAULT_MAX_BYTES;
    this.defaultMaxStderrBytes = options.defaultMaxStderrBytes ?? DEFAULT_MAX_BYTES;
    this.envAllowlist = options.envAllowlist ?? [];
  }

  getSandboxRoot(): string {
    return this.sandboxRoot;
  }

  async exec(request: SandboxExecRequest): Promise<SandboxExecResult> {
    if (this.allowed.size === 0) {
      throw new Error("sandbox allowedBinaries is empty (fail closed)");
    }
    if (!Array.isArray(request.argv) || request.argv.length === 0) {
      throw new Error("sandbox argv must be a non-empty array");
    }
    const binary = request.argv[0]!;
    if (hasPathSep(binary)) {
      throw new Error("sandbox argv[0] must be a bare binary name (no path separators)");
    }
    if (!this.allowed.has(normalizeBinaryName(binary))) {
      throw new Error(`sandbox binary not allowed: ${binary}`);
    }

    const cwd = resolve(this.sandboxRoot, request.cwd ?? ".");
    if (!isUnderRoot(this.sandboxRoot, cwd)) {
      throw new Error("sandbox cwd escapes sandboxRoot");
    }

    const timeoutMs = request.timeoutMs ?? this.defaultTimeoutMs;
    const maxStdout = request.maxStdoutBytes ?? this.defaultMaxStdoutBytes;
    const maxStderr = request.maxStderrBytes ?? this.defaultMaxStderrBytes;
    if (!(timeoutMs > 0) || !(maxStdout > 0) || !(maxStderr > 0)) {
      throw new Error("sandbox limits must be positive");
    }

    const env = buildEnv(request.env, this.envAllowlist);
    const args = request.argv.slice(1);

    return await new Promise<SandboxExecResult>((resolvePromise, rejectPromise) => {
      let settled = false;
      let timedOut = false;
      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      let stdoutLen = 0;
      let stderrLen = 0;

      const child = spawn(binary, args, {
        cwd,
        env,
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });

      const timer = setTimeout(() => {
        timedOut = true;
        if (child.pid !== undefined) killProcessTree(child.pid);
      }, timeoutMs);

      child.stdout?.on("data", (chunk: Buffer) => {
        stdoutChunks.push(chunk);
        stdoutLen += chunk.length;
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        stderrChunks.push(chunk);
        stderrLen += chunk.length;
      });

      child.on("error", (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        rejectPromise(err);
      });

      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const stdoutDec = decodeBounded(Buffer.concat(stdoutChunks, stdoutLen), maxStdout);
        const stderrDec = decodeBounded(Buffer.concat(stderrChunks, stderrLen), maxStderr);
        resolvePromise({
          exitCode: timedOut ? null : code,
          stdout: stdoutDec.text,
          stderr: stderrDec.text,
          timedOut,
          truncated: stdoutDec.truncated || stderrDec.truncated,
        });
      });
    });
  }
}

/** Parse comma-separated binary allowlist; blank → empty (fail closed). */
export function parseAllowedBinaries(raw: string | undefined): string[] {
  if (raw === undefined || raw.trim() === "") return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
