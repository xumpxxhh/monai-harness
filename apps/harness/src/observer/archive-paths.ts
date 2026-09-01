import { resolve } from "node:path";

import { harnessRootDir } from "../config/env.js";

/** Monorepo root (`monai-harness/`). */
export function repoRootDir(): string {
  return resolve(harnessRootDir(), "..", "..");
}

/** `temp/demo-runs/<iso-stamp>_<runId>/` under repo root. */
export function demoRunArchiveDir(runId: string, startedAt = new Date()): string {
  const stamp = startedAt.toISOString().replace(/[:.]/g, "-");
  return resolve(repoRootDir(), "temp", "demo-runs", `${stamp}_${runId}`);
}

/** `temp/demo-sessions/<sessionId>/` under repo root. */
export function sessionDemoArchiveDir(sessionId: string): string {
  return resolve(repoRootDir(), "temp", "demo-sessions", sessionId);
}
