import { spawn } from "node:child_process";
import { resolve, sep } from "node:path";

import type {
  WorkspaceShellExecRequest,
  WorkspaceShellExecResult,
  WorkspaceShellPort,
} from "@monai/ports";

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_BYTES = 256_000;

export type BashWorkspaceShellOptions = {
  /** Absolute workspace root; process cwd must stay under this directory. */
  workspaceRoot: string;
  /**
   * Shell binary basename or absolute path.
   * Default `bash` (Git Bash / WSL / Unix). Override with WORKSPACE_EXEC_SHELL.
   */
  shellBinary?: string;
  /** Args before the command string. Default `["-lc"]` for bash. */
  shellArgs?: readonly string[];
  defaultTimeoutMs?: number;
  defaultMaxStdoutBytes?: number;
  defaultMaxStderrBytes?: number;
};

function isUnderRoot(root: string, candidate: string): boolean {
  const resolvedRoot = resolve(root);
  const resolvedCandidate = resolve(candidate);
  const prefix = resolvedRoot.endsWith(sep) ? resolvedRoot : resolvedRoot + sep;
  return resolvedCandidate === resolvedRoot || resolvedCandidate.startsWith(prefix);
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

function buildEnv(): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  const baseKeys =
    process.platform === "win32"
      ? ["SystemRoot", "SYSTEMROOT", "PATH", "Path", "PATHEXT", "TEMP", "TMP", "USERPROFILE", "HOME"]
      : ["PATH", "HOME", "TMPDIR", "LANG", "USER"];
  for (const key of baseKeys) {
    const v = process.env[key];
    if (v !== undefined) out[key] = v;
  }
  // Prefer file/pipe-friendly tool output (npm/tsc often hide details when they think TTY).
  out.CI = out.CI ?? "1";
  out.NO_COLOR = out.NO_COLOR ?? "1";
  out.FORCE_COLOR = "0";
  out.NPM_CONFIG_COLOR = "false";
  return out;
}

/**
 * Wrap a user command so stdout/stderr land in a workspace-local log file, then
 * replay to the shell pipes.
 *
 * Why the complexity:
 * 1) WSL's Windows `bash.exe` mangles `$?` / `$var` in CreateProcess argv (often
 *    forces `$?` → `0`), so the real script is base64-decoded inside bash.
 * 2) Win32 node/npm children under WSL often do not write to inherited pipes;
 *    redirecting to a cwd-relative log file then `cat` recovers the output.
 * 3) A subshell keeps a user `exit` from skipping the replay/`exit $ec` trailer.
 */
export function wrapCommandForCapture(command: string): string {
  const inner = [
    "set +e",
    `( ${command} ) >.monai-ws-exec-$$.log 2>&1`,
    "ec=$?",
    "cat .monai-ws-exec-$$.log",
    "rm -f .monai-ws-exec-$$.log",
    "exit $ec",
  ].join("; ");
  const b64 = Buffer.from(inner, "utf8").toString("base64");
  // Linux/Git Bash: base64 -d; macOS: base64 -D
  return `echo ${b64} | (base64 -d 2>/dev/null || base64 -D) | bash`;
}

/**
 * Run bash (or configured shell) with cwd fixed under the workspace root.
 * Opt-in only — used by workspace_exec.
 */
export class BashWorkspaceShell implements WorkspaceShellPort {
  private readonly workspaceRoot: string;
  private readonly shellBinary: string;
  private readonly shellArgs: readonly string[];
  private readonly defaultTimeoutMs: number;
  private readonly defaultMaxStdoutBytes: number;
  private readonly defaultMaxStderrBytes: number;

  constructor(options: BashWorkspaceShellOptions) {
    this.workspaceRoot = resolve(options.workspaceRoot);
    this.shellBinary = (options.shellBinary ?? "bash").trim() || "bash";
    this.shellArgs = options.shellArgs ?? ["-lc"];
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.defaultMaxStdoutBytes = options.defaultMaxStdoutBytes ?? DEFAULT_MAX_BYTES;
    this.defaultMaxStderrBytes = options.defaultMaxStderrBytes ?? DEFAULT_MAX_BYTES;
  }

  getWorkspaceRoot(): string {
    return this.workspaceRoot;
  }

  async exec(request: WorkspaceShellExecRequest): Promise<WorkspaceShellExecResult> {
    const command = request.command?.trim() ?? "";
    if (!command) {
      throw new Error("workspace_exec command must be a non-empty string");
    }
    if (command.includes("\0")) {
      throw new Error("workspace_exec command rejects NUL");
    }

    const cwd = resolve(this.workspaceRoot, request.cwd ?? ".");
    if (!isUnderRoot(this.workspaceRoot, cwd)) {
      throw new Error("workspace_exec cwd escapes workspace root");
    }

    const timeoutMs = request.timeoutMs ?? this.defaultTimeoutMs;
    const maxStdout = request.maxStdoutBytes ?? this.defaultMaxStdoutBytes;
    const maxStderr = request.maxStderrBytes ?? this.defaultMaxStderrBytes;
    if (!(timeoutMs > 0) || !(maxStdout > 0) || !(maxStderr > 0)) {
      throw new Error("workspace_exec limits must be positive");
    }

    const wrapped = wrapCommandForCapture(command);
    const argv = [...this.shellArgs, wrapped];
    const env = buildEnv();

    return await new Promise<WorkspaceShellExecResult>((resolvePromise, rejectPromise) => {
      let settled = false;
      let timedOut = false;
      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      let stdoutLen = 0;
      let stderrLen = 0;

      const child = spawn(this.shellBinary, argv, {
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
          cwd,
        });
      });
    });
  }
}
