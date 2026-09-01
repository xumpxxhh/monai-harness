import { appendFile, mkdir, writeFile } from "node:fs/promises";

import type { EventEnvelope, Run, ToolCallRecord } from "@monai/contracts";
import {
  computeRunMetrics,
  computeRunTiming,
  type RunMetricsSnapshot,
  type RunTimingMetrics,
} from "@monai/observability";
import type { ModelPreviewEvent } from "@monai/runtime";

import type { HarnessRuntime } from "../bootstrap/container.js";
import type { HarnessConfig } from "../config/env.js";
import { demoRunArchiveDir } from "./archive-paths.js";

export type ObserverPhase =
  | "demo"
  | "delivery"
  | "turn"
  | "preview"
  | "cli"
  | "persistence";

export type TimelineEntry = {
  seq: number;
  ts: string;
  phase: ObserverPhase;
  kind: string;
  runId: string;
  data?: unknown;
};

type PreviewBuffer = {
  stepId: string;
  reasoning: string;
  display: string;
  startedAt: string;
};

export type DemoRunObserverOptions = {
  runId: string;
  goal: string;
  runtime: HarnessRuntime;
  archiveDir?: string;
  startedAt?: Date;
};

export type DemoRunArchiveSummary = {
  runId: string;
  goal: string;
  archiveDir: string;
  outcome: Run["status"] | "aborted" | "unknown";
  startedAt: string;
  endedAt: string;
  timelineEntries: number;
  eventCount: number;
  toolCallCount: number;
  metrics: RunMetricsSnapshot;
  timing: RunTimingMetrics;
};

/**
 * Records demo / delivery / turn / preview / CLI activity into structured files under `temp/`.
 */
export class DemoRunObserver {
  private readonly runId: string;
  private readonly goal: string;
  private readonly runtime: HarnessRuntime;
  private readonly config: HarnessConfig;
  private readonly archiveDir: string;
  private readonly startedAt: Date;

  private seq = 0;
  private lastEventSequence = 0;
  private finalized = false;
  private unsubscribePreview: (() => void) | undefined;

  private readonly previewBuffers = new Map<string, PreviewBuffer>();
  private readonly phases: Record<string, TimelineEntry[]> = {};

  constructor(options: DemoRunObserverOptions) {
    this.runId = options.runId;
    this.goal = options.goal;
    this.runtime = options.runtime;
    this.config = options.runtime.config;
    this.startedAt = options.startedAt ?? new Date();
    this.archiveDir = options.archiveDir ?? demoRunArchiveDir(this.runId, this.startedAt);
  }

  getArchiveDir(): string {
    return this.archiveDir;
  }

  async start(): Promise<void> {
    await mkdir(this.archiveDir, { recursive: true });
    await mkdir(`${this.archiveDir}/preview`, { recursive: true });
    await mkdir(`${this.archiveDir}/final`, { recursive: true });

    await writeFile(
      `${this.archiveDir}/manifest.json`,
      JSON.stringify(
        {
          schemaVersion: "demo-run-observer/1.0.0",
          runId: this.runId,
          goal: this.goal,
          startedAt: this.startedAt.toISOString(),
          archiveDir: this.archiveDir,
          harness: {
            mode: this.config.mode,
            persistenceDriver: this.config.persistenceDriver,
            modelDriver: this.config.modelDriver,
            openaiModel: this.config.openaiModel,
            workspaceDir: this.config.workspaceDir,
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    this.unsubscribePreview = this.runtime.previewHub.subscribe(this.runId, (event) => {
      void this.onPreview(event);
    });

    await this.record("demo", "observer.started", { archiveDir: this.archiveDir });
  }

  async stop(): Promise<void> {
    this.unsubscribePreview?.();
    this.unsubscribePreview = undefined;
  }

  async record(phase: ObserverPhase, kind: string, data?: unknown): Promise<void> {
    const entry: TimelineEntry = {
      seq: ++this.seq,
      ts: new Date().toISOString(),
      phase,
      kind,
      runId: this.runId,
      ...(data !== undefined ? { data } : {}),
    };

    const bucket = this.phases[phase] ?? [];
    bucket.push(entry);
    this.phases[phase] = bucket;

    await appendFile(
      `${this.archiveDir}/timeline.jsonl`,
      `${JSON.stringify(entry)}\n`,
      "utf8",
    );
  }

  async syncPersistence(label: string): Promise<EventEnvelope[]> {
    const events = await this.runtime.persistence.listEvents(this.runId);
    const fresh = events.filter((e) => e.sequence > this.lastEventSequence);
    if (fresh.length > 0) {
      this.lastEventSequence = events[events.length - 1]!.sequence;
      for (const event of fresh) {
        await this.record("persistence", "event.committed", {
          label,
          sequence: event.sequence,
          eventType: event.eventType,
          stepId: event.stepId,
          toolCallId: event.toolCallId,
          approvalId: event.approvalId,
          payload: event.payload,
        });
      }
    }
    return events;
  }

  async onLoopTick(result: {
    compensation: number;
    outbox: number;
    scheduler: number;
    tools: number;
    turns: number;
  }): Promise<void> {
    await this.record("delivery", "loops.tick", result);
    await this.syncPersistence("loops.tick");
  }

  async onDrainTools(pendingBefore: number, pendingAfter: number): Promise<void> {
    await this.record("delivery", "tools.drain", { pendingBefore, pendingAfter });
    await this.syncPersistence("tools.drain");
  }

  async onTurnStart(run: Run): Promise<void> {
    await this.record("turn", "execute_turn.start", {
      revision: run.revision,
      leaseEpoch: run.leaseEpoch,
      status: run.status,
    });
  }

  async onTurnEnd(
    result: { ok: true; run: Run } | { ok: false; code: string; message?: string },
  ): Promise<void> {
    if (result.ok) {
      await this.record("turn", "execute_turn.ok", {
        revision: result.run.revision,
        status: result.run.status,
      });
    } else {
      await this.record("turn", "execute_turn.failed", {
        code: result.code,
        message: result.message,
      });
    }
    await this.syncPersistence("execute_turn");
  }

  async onUserInput(prompt: string, answer: string): Promise<void> {
    await this.record("cli", "ask_user.submitted", { prompt, answer });
    await this.syncPersistence("ask_user");
  }

  async onApproval(summary: string, approved: boolean, toolId: string): Promise<void> {
    await this.record("cli", "approval.decision", { summary, approved, toolId });
    await this.syncPersistence("approval");
  }

  async onRunCreated(revision: number, status: Run["status"]): Promise<void> {
    await this.record("demo", "run.created", { revision, status });
    await this.syncPersistence("run.created");
  }

  private async onPreview(event: ModelPreviewEvent): Promise<void> {
    if (event.runId !== this.runId) return;

    switch (event.type) {
      case "preview_start": {
        this.previewBuffers.set(event.modelCallId, {
          stepId: event.stepId,
          reasoning: "",
          display: "",
          startedAt: new Date().toISOString(),
        });
        await this.record("preview", "model.start", {
          modelCallId: event.modelCallId,
          stepId: event.stepId,
        });
        break;
      }
      case "delta": {
        const buf = this.previewBuffers.get(event.modelCallId);
        if (!buf) return;
        if (event.channel === "reasoning") {
          buf.reasoning += event.text;
        } else if (event.channel === "display") {
          buf.display += event.text;
        }
        break;
      }
      case "preview_committed":
      case "preview_invalid": {
        const buf = this.previewBuffers.get(event.modelCallId);
        const payload = {
          modelCallId: event.modelCallId,
          stepId: event.stepId,
          reasoning: buf?.reasoning ?? "",
          display: buf?.display ?? "",
          ...(event.type === "preview_committed"
            ? { actionDisplay: event.display }
            : { invalidReason: event.reason }),
        };
        await writeFile(
          `${this.archiveDir}/preview/${event.modelCallId}.json`,
          JSON.stringify(payload, null, 2),
          "utf8",
        );
        await this.record("preview", event.type, payload);
        this.previewBuffers.delete(event.modelCallId);
        break;
      }
    }
  }

  async finalize(outcome: Run["status"] | "aborted" | "unknown" = "unknown"): Promise<DemoRunArchiveSummary> {
    if (this.finalized) {
      throw new Error("DemoRunObserver already finalized");
    }
    this.finalized = true;
    await this.stop();

    const endedAt = new Date();
    const run = (await this.runtime.persistence.getRun(this.runId)) ?? undefined;
    const events = await this.runtime.persistence.listEvents(this.runId);
    const toolCalls = await this.runtime.persistence.listToolCalls(this.runId);
    const state = await this.runtime.persistence.getState(this.runId);

    const resolvedOutcome = run?.status ?? outcome;
    const metrics = run
      ? computeRunMetrics(events, run)
      : {
          runId: this.runId,
          terminal: true,
          succeeded: false,
          policyEvaluated: 0,
          policyDenied: 0,
          approvalRequested: false,
          actionAccepted: false,
          toolDispatched: 0,
          toolRetryDispatches: 0,
          outcomeUnknown: 0,
          leaseTakeovers: 0,
        };
    const timing = run
      ? computeRunTiming(events, run)
      : {
          runId: this.runId,
          queueLatencyMs: 0,
          activeExecutionMs: 0,
          awaitingMs: 0,
          totalWallMs: null,
        };

    const summary: DemoRunArchiveSummary = {
      runId: this.runId,
      goal: this.goal,
      archiveDir: this.archiveDir,
      outcome: resolvedOutcome,
      startedAt: this.startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      timelineEntries: this.seq,
      eventCount: events.length,
      toolCallCount: toolCalls.length,
      metrics,
      timing,
    };

    await writeFile(
      `${this.archiveDir}/final/run.json`,
      JSON.stringify(run ?? null, null, 2),
      "utf8",
    );
    await writeFile(
      `${this.archiveDir}/final/events.json`,
      JSON.stringify(events, null, 2),
      "utf8",
    );
    await writeFile(
      `${this.archiveDir}/final/tool-calls.json`,
      JSON.stringify(toolCalls, null, 2),
      "utf8",
    );
    await writeFile(
      `${this.archiveDir}/final/state.json`,
      JSON.stringify(state ?? null, null, 2),
      "utf8",
    );
    await writeFile(
      `${this.archiveDir}/final/phases.json`,
      JSON.stringify(this.phases, null, 2),
      "utf8",
    );
    await writeFile(
      `${this.archiveDir}/final/summary.json`,
      JSON.stringify(summary, null, 2),
      "utf8",
    );

    return summary;
  }
}

export async function countPendingTools(
  runtime: HarnessRuntime,
  runId: string,
): Promise<number> {
  const calls = await runtime.persistence.listToolCalls(runId);
  return calls.filter((c) => c.status === "prepared" || c.status === "dispatched").length;
}

export type { ToolCallRecord };
