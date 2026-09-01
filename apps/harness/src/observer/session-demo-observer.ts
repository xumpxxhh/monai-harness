import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { Run } from "@monai/contracts";

import type { HarnessRuntime } from "../bootstrap/container.js";
import type { SessionTurn } from "../cli/session-transcript.js";
import { sessionDemoArchiveDir } from "./archive-paths.js";
import { DemoRunObserver, type DemoRunArchiveSummary } from "./demo-run-observer.js";

export type SessionDemoObserverOptions = {
  sessionId: string;
  runtime: HarnessRuntime;
  archiveDir?: string;
  startedAt?: Date;
};

export type SessionDemoSummary = {
  sessionId: string;
  archiveDir: string;
  startedAt: string;
  endedAt: string;
  turnCount: number;
  runIds: string[];
  runs: DemoRunArchiveSummary[];
};

/**
 * Session-level observer: transcript + per-run DemoRunObserver archives.
 */
export class SessionDemoObserver {
  private readonly sessionId: string;
  private readonly runtime: HarnessRuntime;
  private readonly archiveDir: string;
  private readonly startedAt: Date;
  private readonly runSummaries: DemoRunArchiveSummary[] = [];
  private readonly runIds: string[] = [];
  private finalized = false;

  constructor(options: SessionDemoObserverOptions) {
    this.sessionId = options.sessionId;
    this.runtime = options.runtime;
    this.startedAt = options.startedAt ?? new Date();
    this.archiveDir = options.archiveDir ?? sessionDemoArchiveDir(this.sessionId);
  }

  getArchiveDir(): string {
    return this.archiveDir;
  }

  async start(): Promise<void> {
    await mkdir(this.archiveDir, { recursive: true });
    await mkdir(resolve(this.archiveDir, "runs"), { recursive: true });
    await writeFile(
      resolve(this.archiveDir, "session.json"),
      JSON.stringify(
        {
          schemaVersion: "session-demo-observer/1.0.0",
          sessionId: this.sessionId,
          startedAt: this.startedAt.toISOString(),
          archiveDir: this.archiveDir,
          harness: {
            mode: this.runtime.config.mode,
            persistenceDriver: this.runtime.config.persistenceDriver,
            modelDriver: this.runtime.config.modelDriver,
            openaiModel: this.runtime.config.openaiModel,
            workspaceDir: this.runtime.config.workspaceDir,
          },
        },
        null,
        2,
      ),
      "utf8",
    );
  }

  createRunObserver(runId: string, goal: string): DemoRunObserver {
    const archiveDir = resolve(this.archiveDir, "runs", runId);
    return new DemoRunObserver({
      runId,
      goal,
      runtime: this.runtime,
      archiveDir,
      startedAt: new Date(),
    });
  }

  async appendTranscriptTurn(turn: SessionTurn): Promise<void> {
    await appendFile(
      resolve(this.archiveDir, "transcript.jsonl"),
      `${JSON.stringify({ ts: new Date().toISOString(), ...turn })}\n`,
      "utf8",
    );
  }

  async recordRunSummary(summary: DemoRunArchiveSummary): Promise<void> {
    this.runSummaries.push(summary);
    if (!this.runIds.includes(summary.runId)) {
      this.runIds.push(summary.runId);
    }
  }

  async finalize(): Promise<SessionDemoSummary> {
    if (this.finalized) {
      throw new Error("SessionDemoObserver already finalized");
    }
    this.finalized = true;

    const endedAt = new Date();
    const summary: SessionDemoSummary = {
      sessionId: this.sessionId,
      archiveDir: this.archiveDir,
      startedAt: this.startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      turnCount: this.runSummaries.length,
      runIds: [...this.runIds],
      runs: [...this.runSummaries],
    };

    await writeFile(resolve(this.archiveDir, "session-summary.json"), JSON.stringify(summary, null, 2), "utf8");
    return summary;
  }
}

export function buildSessionRunId(sessionId: string, turnIndex: number): string {
  const short = sessionId.replace(/^cli-session-/, "s");
  return `cli-${short}-${turnIndex}-${Date.now()}`;
}

export type { Run };
