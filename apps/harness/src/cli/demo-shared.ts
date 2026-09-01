import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import {
  buildApprovalDecisionCommand,
  buildSubmitInputCommand,
} from "@monai/api";
import { CONTRACTS_SCHEMA_VERSION, type Action, type Continuation, type Run } from "@monai/contracts";
import { projectActionForUser, type ModelPreviewEvent } from "@monai/runtime";

import type { HarnessRuntime } from "../bootstrap/container.js";
import { countPendingTools, DemoRunObserver } from "../observer/demo-run-observer.js";
import type { DeliveryLoops } from "../workers/delivery-loops.js";
import type { TurnDriver } from "../workers/turn-driver.js";

export const TERMINAL_STATUSES = new Set(["succeeded", "failed", "cancelled"]);

export type CliIo = {
  question: (prompt: string) => Promise<string>;
  close: () => void;
  isTty: boolean;
};

export type AgentLoopOutcome = Run["status"] | "aborted" | "unknown";

export function createCliIo(): CliIo {
  const isTty = Boolean(input.isTTY && output.isTTY);
  if (!isTty) {
    return {
      isTty: false,
      question: async () => "",
      close: () => undefined,
    };
  }
  const rl = createInterface({ input, output, terminal: true });
  return {
    isTty: true,
    question: (prompt) => rl.question(prompt),
    close: () => rl.close(),
  };
}

export function attachPreviewPrinter(runtime: HarnessRuntime, runId: string): () => void {
  let reasoningOpen = false;
  let displayOpen = false;

  const closeReasoning = () => {
    if (reasoningOpen) {
      process.stdout.write("\n");
      reasoningOpen = false;
    }
  };
  const closeDisplay = () => {
    if (displayOpen) {
      process.stdout.write("\n");
      displayOpen = false;
    }
  };

  return runtime.previewHub.subscribe(runId, (event: ModelPreviewEvent) => {
    if (event.runId !== runId) return;

    switch (event.type) {
      case "preview_start":
        closeReasoning();
        closeDisplay();
        console.log(`\n[preview] model call ${event.modelCallId} …`);
        break;
      case "delta":
        if (event.channel === "reasoning") {
          if (!reasoningOpen) {
            process.stdout.write("[thinking] ");
            reasoningOpen = true;
          }
          process.stdout.write(event.text);
        } else if (event.channel === "display") {
          closeReasoning();
          if (!displayOpen) {
            process.stdout.write("[agent] ");
            displayOpen = true;
          }
          process.stdout.write(event.text);
        }
        break;
      case "preview_committed":
        closeReasoning();
        closeDisplay();
        console.log(`[action] ${event.display}`);
        break;
      case "preview_invalid":
        closeReasoning();
        closeDisplay();
        console.log(`[preview] invalid: ${event.reason}`);
        break;
    }
  });
}

async function acquireLeaseIfQueued(
  runtime: HarnessRuntime,
  runId: string,
): Promise<string | undefined> {
  const run = await runtime.persistence.getRun(runId);
  if (!run || run.status !== "queued") return run?.status;

  const acquired = await runtime.engine.handle({
    schemaVersion: CONTRACTS_SCHEMA_VERSION,
    commandId: `lease-${runId}-${run.revision}-${Date.now()}`,
    commandType: "acquire_lease",
    tenantId: run.tenantId,
    runId,
    expectedRevision: run.revision,
    actor: { principalId: runtime.ownerId },
    issuedAt: new Date().toISOString(),
  });
  if (!acquired.ok) {
    throw new Error(`acquire_lease failed: ${acquired.message ?? acquired.code}`);
  }
  return acquired.run.status;
}

async function driveUntil(
  loops: DeliveryLoops,
  runtime: HarnessRuntime,
  runId: string,
  predicate: (status: string | undefined) => boolean,
  maxTicks = 24,
): Promise<string | undefined> {
  let run = await runtime.persistence.getRun(runId);
  for (let i = 0; i < maxTicks && !predicate(run?.status); i += 1) {
    if (run?.status === "queued") {
      await acquireLeaseIfQueued(runtime, runId);
      run = await runtime.persistence.getRun(runId);
      continue;
    }
    await loops.tickOnce();
    run = await runtime.persistence.getRun(runId);
  }
  return run?.status;
}

export async function ensureRunning(
  loops: DeliveryLoops,
  runtime: HarnessRuntime,
  runId: string,
): Promise<void> {
  const status = await driveUntil(
    loops,
    runtime,
    runId,
    (s) =>
      s === "running" ||
      TERMINAL_STATUSES.has(s ?? "") ||
      s === "awaiting_input" ||
      s === "awaiting_approval",
  );
  if (
    status !== "running" &&
    status !== "awaiting_input" &&
    status !== "awaiting_approval" &&
    !TERMINAL_STATUSES.has(status ?? "")
  ) {
    throw new Error(`expected running (or wait/terminal), got status=${status ?? "missing"}`);
  }
}

const PENDING_TOOL_STATUSES = new Set(["prepared", "dispatched"]);

export async function drainPendingTools(
  loops: DeliveryLoops,
  runtime: HarnessRuntime,
  runId: string,
  maxTicks = 32,
  observer?: DemoRunObserver,
): Promise<void> {
  const pendingBefore = await countPendingTools(runtime, runId);
  for (let i = 0; i < maxTicks; i += 1) {
    const pending = await countPendingTools(runtime, runId);
    if (pending === 0) {
      if (observer && pendingBefore > 0) {
        await observer.onDrainTools(pendingBefore, 0);
      }
      return;
    }
    await loops.tickOnce();
  }
  const pendingAfter = await countPendingTools(runtime, runId);
  if (observer) {
    await observer.onDrainTools(pendingBefore, pendingAfter);
  }
  if (pendingAfter > 0) {
    const calls = await runtime.persistence.listToolCalls(runId);
    const leftover = calls.filter((c) => PENDING_TOOL_STATUSES.has(c.status));
    console.log(
      `[demo] warning: ${leftover.length} tool call(s) still pending after drain: ${leftover
        .map((c) => `${c.toolId}/${c.status}`)
        .join(", ")}`,
    );
  }
}

function stableArgsKey(value: unknown): string {
  if (value === undefined) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** Fingerprint = toolId + arguments (same tool, different args are distinct). */
function lastPreparedToolFingerprint(
  events: Array<{ eventType: string; toolCallId?: string; payload?: unknown }>,
  fromIndex: number,
  toolCalls: Array<{ toolCallId: string; toolId: string; arguments?: unknown }>,
): string | undefined {
  for (let i = events.length - 1; i >= fromIndex; i -= 1) {
    const e = events[i]!;
    if (e.eventType !== "tool.call_prepared") continue;
    const payload = e.payload as { toolId?: unknown } | undefined;
    const toolId = typeof payload?.toolId === "string" ? payload.toolId : undefined;
    if (!toolId) continue;

    const call = e.toolCallId
      ? toolCalls.find((c) => c.toolCallId === e.toolCallId)
      : undefined;
    const argsKey = stableArgsKey(call?.arguments ?? null);
    return `${toolId}:${argsKey}`;
  }
  return undefined;
}

function askUserPromptText(continuation: Continuation): string {
  if (continuation.actionSnapshot) {
    const projected = projectActionForUser(continuation.actionSnapshot);
    if (projected && projected !== "需要您的输入") return projected;
  }
  if (continuation.inputPrompt?.trim()) return continuation.inputPrompt.trim();
  const args = continuation.actionSnapshot?.arguments as { prompt?: unknown } | undefined;
  if (typeof args?.prompt === "string" && args.prompt.trim()) return args.prompt.trim();
  return "Agent 需要您的输入";
}

export async function handleAwaitingInput(
  runtime: HarnessRuntime,
  cli: CliIo,
  runId: string,
  observer?: DemoRunObserver,
): Promise<void> {
  const run = await runtime.persistence.getRun(runId);
  if (!run || run.status !== "awaiting_input") return;

  const continuation = await runtime.persistence.getContinuation(runId);
  if (!continuation || continuation.kind !== "input") {
    throw new Error("awaiting_input but no input continuation");
  }

  const prompt = askUserPromptText(continuation);
  console.log("\n┌─ ask_user ─────────────────────────────────");
  console.log(`│ ${prompt}`);
  console.log("└────────────────────────────────────────────");

  if (!cli.isTty) {
    throw new Error("awaiting_input requires an interactive TTY");
  }

  const answer = (await cli.question("[you] ")).trim();
  if (!answer) {
    console.log("[demo] empty input ignored; please provide a reply.");
    return;
  }

  const inputId = `input-${Date.now()}`;
  const result = await runtime.engine.handle(
    buildSubmitInputCommand({
      tenantId: run.tenantId,
      commandId: `submit-${inputId}`,
      runId,
      expectedRevision: run.revision,
      inputId,
      value: answer,
      principalId: "cli-user",
    }),
  );
  if (!result.ok) {
    throw new Error(`submit_input failed: ${result.message ?? result.code}`);
  }
  console.log(`[demo] submitted input → status=${result.run.status}`);
  await observer?.onUserInput(prompt, answer);
}

export async function handleAwaitingApproval(
  runtime: HarnessRuntime,
  cli: CliIo,
  runId: string,
  observer?: DemoRunObserver,
): Promise<void> {
  const run = await runtime.persistence.getRun(runId);
  if (!run || run.status !== "awaiting_approval") return;

  const continuation = await runtime.persistence.getContinuation(runId);
  const approvalId = continuation?.approvalId;
  if (!approvalId) {
    throw new Error("awaiting_approval but no approvalId on continuation");
  }

  const approval = await runtime.persistence.getApproval(approvalId);
  const action: Action | undefined =
    approval?.actionSnapshot ?? continuation?.actionSnapshot;
  const summary = action ? projectActionForUser(action) : `approval ${approvalId}`;
  const toolId = action?.toolId ?? approval?.toolRef?.toolId ?? "tool";

  console.log("\n┌─ approval ─────────────────────────────────");
  console.log(`│ tool: ${toolId}`);
  console.log(`│ risk: ${approval?.riskLevel ?? "unknown"}`);
  console.log(`│ ${summary}`);
  console.log("└────────────────────────────────────────────");

  if (!cli.isTty) {
    throw new Error("awaiting_approval requires an interactive TTY");
  }

  const raw = (await cli.question("[approval] approve? (y/N) ")).trim().toLowerCase();
  const approved = raw === "y" || raw === "yes";

  const result = await runtime.engine.handle(
    buildApprovalDecisionCommand({
      tenantId: run.tenantId,
      commandId: `approval-${approvalId}-${Date.now()}`,
      runId,
      expectedRevision: run.revision,
      approvalId,
      decision: approved ? "approved" : "rejected",
      reason: approved ? "cli user approved" : "cli user rejected",
      principalId: "cli-user",
    }),
  );
  if (!result.ok) {
    throw new Error(`approval_decision failed: ${result.message ?? result.code}`);
  }
  console.log(
    `[demo] approval ${approved ? "approved" : "rejected"} → status=${result.run.status}`,
  );
  await observer?.onApproval(summary, approved, toolId);
}

export async function printRunSummary(runtime: HarnessRuntime, runId: string): Promise<void> {
  const run = await runtime.persistence.getRun(runId);
  const events = await runtime.persistence.listEvents(runId);
  const toolCalls = await runtime.persistence.listToolCalls(runId);
  const state = await runtime.persistence.getState(runId);

  console.log("\n──────────── run summary ────────────");
  console.log(`status: ${run?.status ?? "missing"}  revision: ${run?.revision ?? "-"}`);
  console.log(`events: ${events.map((e) => e.eventType).join(" → ")}`);
  if (toolCalls.length > 0) {
    console.log(`tools: ${toolCalls.map((t) => `${t.toolId}/${t.status}`).join(", ")}`);
  }
  const facts = state?.facts ?? [];
  if (facts.length > 0) {
    console.log("facts:");
    for (const fact of facts.slice(-5)) {
      console.log(`  - ${fact.summary}`);
    }
  }
  console.log("─────────────────────────────────────\n");
}

export async function finishDemoRun(
  runtime: HarnessRuntime,
  runId: string,
  observer: DemoRunObserver,
  outcome: AgentLoopOutcome = "unknown",
  options: { printSummary?: boolean } = {},
): Promise<void> {
  if (options.printSummary !== false) {
    await printRunSummary(runtime, runId);
  }
  const summary = await observer.finalize(outcome);
  console.log(`[demo] observer archive: ${summary.archiveDir}`);
  console.log(
    `[demo] observer summary: outcome=${summary.outcome} events=${summary.eventCount} tools=${summary.toolCallCount} timeline=${summary.timelineEntries}`,
  );
}

/**
 * Main agent loop for a single Run: delivery ticks → execute_turn → tool drain.
 */
export async function runAgentLoop(
  runtime: HarnessRuntime,
  loops: DeliveryLoops,
  turnDriver: TurnDriver,
  runId: string,
  cli: CliIo,
  observer: DemoRunObserver,
  options: { autoFinalize?: boolean; printSummary?: boolean } = {},
): Promise<AgentLoopOutcome> {
  const autoFinalize = options.autoFinalize ?? true;
  const printSummary = options.printSummary ?? true;

  const maybeFinish = async (outcome: AgentLoopOutcome): Promise<AgentLoopOutcome> => {
    if (autoFinalize) {
      await finishDemoRun(runtime, runId, observer, outcome, { printSummary });
    }
    return outcome;
  };
  await ensureRunning(loops, runtime, runId);

  let runOutcome: AgentLoopOutcome = "unknown";
  let stagnantTurns = 0;
  const MAX_STAGNANT = 3;
  /** Same toolId+arguments fingerprint repeated without finish. */
  let lastToolFingerprint: string | undefined;
  let sameToolStreak = 0;
  const MAX_SAME_TOOL = 2;

  for (let step = 0; step < 64; step += 1) {
    const tick = await loops.tickOnce();
    await observer.onLoopTick(tick);
    await drainPendingTools(loops, runtime, runId, 32, observer);
    let run = await runtime.persistence.getRun(runId);
    if (!run) throw new Error("run disappeared");

    if (TERMINAL_STATUSES.has(run.status)) {
      runOutcome = run.status;
      return await maybeFinish(runOutcome);
    }

    if (run.status === "awaiting_input") {
      stagnantTurns = 0;
      sameToolStreak = 0;
      lastToolFingerprint = undefined;
      await handleAwaitingInput(runtime, cli, runId, observer);
      await ensureRunning(loops, runtime, runId);
      continue;
    }

    if (run.status === "awaiting_approval") {
      stagnantTurns = 0;
      sameToolStreak = 0;
      lastToolFingerprint = undefined;
      await handleAwaitingApproval(runtime, cli, runId, observer);
      await ensureRunning(loops, runtime, runId);
      continue;
    }

    if (run.status === "running") {
      const revBefore = run.revision;
      const eventsBefore = (await runtime.persistence.listEvents(runId)).length;
      console.log(`\n[demo] execute_turn (rev=${run.revision} leaseEpoch=${run.leaseEpoch})…`);
      await observer.onTurnStart(run);
      const turn = await turnDriver.executeTurn(runId);
      await observer.onTurnEnd(turn);
      if (!turn.ok) {
        throw new Error(`execute_turn failed: ${turn.message ?? turn.code}`);
      }
      run = turn.run;
      console.log(`[demo] turn ok → status=${run.status} revision=${run.revision}`);

      const events = await runtime.persistence.listEvents(runId);
      const toolCalls = await runtime.persistence.listToolCalls(runId);
      const fingerprint = lastPreparedToolFingerprint(events, eventsBefore, toolCalls);
      if (fingerprint) {
        if (fingerprint === lastToolFingerprint) {
          sameToolStreak += 1;
        } else {
          lastToolFingerprint = fingerprint;
          sameToolStreak = 1;
        }
        if (sameToolStreak >= MAX_SAME_TOOL) {
          console.log(
            `[demo] aborting: model repeated identical tool.call ${fingerprint} ${sameToolStreak} times without finish`,
          );
          runOutcome = "aborted";
          return await maybeFinish(runOutcome);
        }
      } else if (run.status !== "running") {
        sameToolStreak = 0;
        lastToolFingerprint = undefined;
      }

      const recentFailed = events
        .slice(eventsBefore)
        .some((e) => e.eventType === "step.failed");
      const progressed =
        run.status !== "running" ||
        (events.length > eventsBefore &&
          events.slice(eventsBefore).some((e) =>
            [
              "action.accepted",
              "tool.call_prepared",
              "observation.recorded",
              "run.status_changed",
            ].includes(e.eventType),
          ));

      if (recentFailed && !progressed) {
        stagnantTurns += 1;
        const lastFail = [...events].reverse().find((e) => e.eventType === "step.failed");
        const reason =
          lastFail &&
          typeof lastFail.payload === "object" &&
          lastFail.payload &&
          "reason" in lastFail.payload
            ? String((lastFail.payload as { reason?: unknown }).reason)
            : "step.failed";
        console.log(`[demo] turn made no progress (${stagnantTurns}/${MAX_STAGNANT}): ${reason}`);
        if (stagnantTurns >= MAX_STAGNANT) {
          console.log("[demo] aborting after repeated step failures");
          runOutcome = "aborted";
          return await maybeFinish(runOutcome);
        }
      } else if (run.revision > revBefore) {
        stagnantTurns = 0;
      }

      await drainPendingTools(loops, runtime, runId, 32, observer);
      run = (await runtime.persistence.getRun(runId)) ?? run;

      if (TERMINAL_STATUSES.has(run.status)) {
        runOutcome = run.status;
        return await maybeFinish(runOutcome);
      }
      if (run.status === "awaiting_input") {
        await handleAwaitingInput(runtime, cli, runId, observer);
        await ensureRunning(loops, runtime, runId);
        continue;
      }
      if (run.status === "awaiting_approval") {
        await handleAwaitingApproval(runtime, cli, runId, observer);
        await ensureRunning(loops, runtime, runId);
        continue;
      }
      continue;
    }

    if (run.status === "queued" || run.status === "created") {
      await ensureRunning(loops, runtime, runId);
      continue;
    }

    console.log(`[demo] idle on status=${run.status}; ticking…`);
    await loops.tickOnce();
  }

  const run = await runtime.persistence.getRun(runId);
  if (run && TERMINAL_STATUSES.has(run.status)) {
    runOutcome = run.status;
  }
  return await maybeFinish(runOutcome);
}
