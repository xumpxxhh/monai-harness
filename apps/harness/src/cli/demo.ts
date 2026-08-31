import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { pathToFileURL } from "node:url";

import {
  buildApprovalDecisionCommand,
  buildCreateRunCommand,
  buildSubmitInputCommand,
} from "@monai/api";
import { CONTRACTS_SCHEMA_VERSION, type Action, type Continuation } from "@monai/contracts";
import { projectActionForUser, type ModelPreviewEvent } from "@monai/runtime";

import { bootstrap, type HarnessRuntime } from "../bootstrap/container.js";
import { loadConfig } from "../config/env.js";
import { DeliveryLoops } from "../workers/delivery-loops.js";
import { TurnDriver } from "../workers/turn-driver.js";

const DEFAULT_GOAL =
  "请先用 ask_user 向我确认任务范围，再列出可用 workspace 文件，最后用 finish 总结。";

const TERMINAL_STATUSES = new Set(["succeeded", "failed", "cancelled"]);

type CliIo = {
  question: (prompt: string) => Promise<string>;
  close: () => void;
  isTty: boolean;
};

function createCliIo(): CliIo {
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

function printBanner(): void {
  console.log("");
  console.log("══════════════════════════════════════════════");
  console.log("  Monai Harness · Interactive CLI Demo");
  console.log("  Shell 人机交互（Preview / ask_user / approval）");
  console.log("══════════════════════════════════════════════");
  console.log("");
}

function attachPreviewPrinter(runtime: HarnessRuntime, runId: string): () => void {
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
    // submit_input / approval → queued without outbox; lease explicitly.
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

async function ensureRunning(
  loops: DeliveryLoops,
  runtime: HarnessRuntime,
  runId: string,
): Promise<void> {
  const status = await driveUntil(
    loops,
    runtime,
    runId,
    (s) => s === "running" || TERMINAL_STATUSES.has(s ?? "") || s === "awaiting_input" || s === "awaiting_approval",
  );
  if (status !== "running" && status !== "awaiting_input" && status !== "awaiting_approval" && !TERMINAL_STATUSES.has(status ?? "")) {
    throw new Error(`expected running (or wait/terminal), got status=${status ?? "missing"}`);
  }
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

async function handleAwaitingInput(
  runtime: HarnessRuntime,
  cli: CliIo,
  runId: string,
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
}

async function handleAwaitingApproval(
  runtime: HarnessRuntime,
  cli: CliIo,
  runId: string,
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
}

async function printRunSummary(runtime: HarnessRuntime, runId: string): Promise<void> {
  const run = await runtime.persistence.getRun(runId);
  const events = await runtime.persistence.listEvents(runId);
  const toolCalls = await runtime.persistence.listToolCalls(runId);
  const state = await runtime.persistence.getState(runId);

  console.log("\n──────────── run summary ────────────");
  console.log(`status: ${run?.status ?? "missing"}  revision: ${run?.revision ?? "-"}`);
  console.log(`events: ${events.map((e) => e.eventType).join(" → ")}`);
  if (toolCalls.length > 0) {
    console.log(
      `tools: ${toolCalls.map((t) => `${t.toolId}/${t.status}`).join(", ")}`,
    );
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

/**
 * Interactive Shell demo: CreateRun → turn loop with Preview / ask_user / approval.
 */
export async function runInteractiveCliDemo(
  runtime: HarnessRuntime,
  loops: DeliveryLoops,
  turnDriver: TurnDriver,
  options: { goal?: string; cli?: CliIo } = {},
): Promise<void> {
  const cli = options.cli ?? createCliIo();
  const ownsCli = !options.cli;
  printBanner();

  try {
    let goal = options.goal?.trim();
    if (!goal) {
      if (cli.isTty) {
        const typed = (
          await cli.question(
            `目标 (Goal) [回车用默认]\n  默认: ${DEFAULT_GOAL}\n> `,
          )
        ).trim();
        goal = typed || DEFAULT_GOAL;
      } else {
        goal = DEFAULT_GOAL;
        console.log(`[demo] non-TTY: using default goal: ${goal}`);
      }
    }

    const runId = `cli-${Date.now()}`;
    const executionManifestRef = `manifest://cli-demo/${runId}`;
    console.log(
      `[demo] driver=${runtime.config.persistenceDriver} model=${runtime.config.modelDriver}` +
        (runtime.config.openaiModel ? `/${runtime.config.openaiModel}` : "") +
        ` runId=${runId}`,
    );
    console.log(`[demo] goal: ${goal}`);

    const created = await runtime.engine.handle(
      buildCreateRunCommand({
        tenantId: "t1",
        commandId: `create-${runId}`,
        runId,
        sessionId: `cli-session-${Date.now()}`,
        agentDefinitionId: "agent",
        agentVersion: "1",
        executionManifestRef,
        packVersions: [{ packId: "workspace-generic", version: "0.1.0" }],
        goal,
        strategy: { type: "light", version: "1" },
      }),
    );
    if (!created.ok) {
      throw new Error(`create_run failed: ${created.message ?? created.code}`);
    }
    console.log(`[demo] created revision=${created.revision} status=${created.run.status}`);

    const unsubscribe = attachPreviewPrinter(runtime, runId);

    try {
      await ensureRunning(loops, runtime, runId);

      let stagnantTurns = 0;
      const MAX_STAGNANT = 3;

      // Main interaction loop
      for (let step = 0; step < 64; step += 1) {
        await loops.tickOnce();
        let run = await runtime.persistence.getRun(runId);
        if (!run) throw new Error("run disappeared");

        if (TERMINAL_STATUSES.has(run.status)) {
          await printRunSummary(runtime, runId);
          break;
        }

        if (run.status === "awaiting_input") {
          stagnantTurns = 0;
          await handleAwaitingInput(runtime, cli, runId);
          await ensureRunning(loops, runtime, runId);
          continue;
        }

        if (run.status === "awaiting_approval") {
          stagnantTurns = 0;
          await handleAwaitingApproval(runtime, cli, runId);
          await ensureRunning(loops, runtime, runId);
          continue;
        }

        if (run.status === "running") {
          const revBefore = run.revision;
          const eventsBefore = (await runtime.persistence.listEvents(runId)).length;
          console.log(`\n[demo] execute_turn (rev=${run.revision} leaseEpoch=${run.leaseEpoch})…`);
          const turn = await turnDriver.executeTurn(runId);
          if (!turn.ok) {
            throw new Error(`execute_turn failed: ${turn.message ?? turn.code}`);
          }
          run = turn.run;
          console.log(`[demo] turn ok → status=${run.status} revision=${run.revision}`);

          const events = await runtime.persistence.listEvents(runId);
          const recentFailed = events
            .slice(eventsBefore)
            .some((e) => e.eventType === "step.failed");
          const progressed =
            run.status !== "running" ||
            (events.length > eventsBefore &&
              events.slice(eventsBefore).some((e) =>
                [
                  "action.accepted",
                  "tool.prepared",
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
              await printRunSummary(runtime, runId);
              break;
            }
          } else if (run.revision > revBefore) {
            stagnantTurns = 0;
          }

          if (TERMINAL_STATUSES.has(run.status)) {
            await printRunSummary(runtime, runId);
            break;
          }
          if (run.status === "awaiting_input") {
            await handleAwaitingInput(runtime, cli, runId);
            await ensureRunning(loops, runtime, runId);
            continue;
          }
          if (run.status === "awaiting_approval") {
            await handleAwaitingApproval(runtime, cli, runId);
            await ensureRunning(loops, runtime, runId);
            continue;
          }
          // tool.call prepared → outbox/queue will advance; keep ticking
          continue;
        }

        // created / queued / paused / waiting_child — keep delivering
        if (run.status === "queued" || run.status === "created") {
          await ensureRunning(loops, runtime, runId);
          continue;
        }

        console.log(`[demo] idle on status=${run.status}; ticking…`);
        await loops.tickOnce();
      }

      if (cli.isTty) {
        const again = (
          await cli.question("再开一轮新 Run？(y/N) ")
        )
          .trim()
          .toLowerCase();
        if (again === "y" || again === "yes") {
          unsubscribe();
          if (ownsCli) {
            // Re-enter with same IO
            await runInteractiveCliDemo(runtime, loops, turnDriver, { cli });
            return;
          }
        }
      }
    } finally {
      unsubscribe();
    }
  } finally {
    if (ownsCli) cli.close();
  }
}

/** @deprecated Prefer {@link runInteractiveCliDemo}. Kept for callers expecting the old name. */
export async function runCreateRunToExecuteTurnDemo(
  runtime: HarnessRuntime,
  loops: DeliveryLoops,
  turnDriver?: TurnDriver,
): Promise<void> {
  const driver =
    turnDriver ??
    new TurnDriver(runtime, { autoExecute: false });
  await runInteractiveCliDemo(runtime, loops, driver);
}

async function main(): Promise<void> {
  const config = loadConfig();
  console.log(
    `[harness][demo] starting driver=${config.persistenceDriver} model=${config.modelDriver}`,
  );
  const runtime = await bootstrap(config);
  const turnDriver = new TurnDriver(runtime, { autoExecute: false });
  const loops = new DeliveryLoops(runtime, config.loopIntervalMs, turnDriver);
  try {
    await runInteractiveCliDemo(runtime, loops, turnDriver);
    console.log("[harness] demo complete");
  } finally {
    await runtime.close();
  }
}

// ESM direct-entry: `node dist/cli/demo.js` / `pnpm demo`
const invokedAsMain =
  typeof process.argv[1] === "string" &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedAsMain) {
  main().catch((err) => {
    console.error("[harness][demo] fatal", err);
    process.exitCode = 1;
  });
}
