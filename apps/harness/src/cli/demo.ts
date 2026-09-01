import { pathToFileURL } from "node:url";

import { buildCreateRunCommand } from "@monai/api";

import { bootstrap, type HarnessRuntime } from "../bootstrap/container.js";
import { loadConfig } from "../config/env.js";
import { DemoRunObserver } from "../observer/demo-run-observer.js";
import { DeliveryLoops } from "../workers/delivery-loops.js";
import { TurnDriver } from "../workers/turn-driver.js";
import {
  attachPreviewPrinter,
  createCliIo,
  runAgentLoop,
  type CliIo,
} from "./demo-shared.js";

const DEFAULT_GOAL =
  "请先用 ask_user 向我确认任务范围，再列出可用 workspace 文件，最后用 finish 总结。";

function printBanner(): void {
  console.log("");
  console.log("══════════════════════════════════════════════");
  console.log("  Monai Harness · Interactive CLI Demo");
  console.log("  Shell 人机交互（Preview / ask_user / approval）");
  console.log("══════════════════════════════════════════════");
  console.log("");
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

    const observer = new DemoRunObserver({ runId, goal, runtime });
    await observer.start();
    console.log(`[demo] observer recording → ${observer.getArchiveDir()}`);

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
    await observer.onRunCreated(created.revision, created.run.status);

    const unsubscribe = attachPreviewPrinter(runtime, runId);

    try {
      await runAgentLoop(runtime, loops, turnDriver, runId, cli, observer);

      if (cli.isTty) {
        const again = (await cli.question("再开一轮新 Run？(y/N) "))
          .trim()
          .toLowerCase();
        if (again === "y" || again === "yes") {
          unsubscribe();
          if (ownsCli) {
            await runInteractiveCliDemo(runtime, loops, turnDriver, { cli });
            return;
          }
        }
      }
    } finally {
      unsubscribe();
      await observer.stop();
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
  const driver = turnDriver ?? new TurnDriver(runtime, { autoExecute: false });
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

const invokedAsMain =
  typeof process.argv[1] === "string" &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedAsMain) {
  main().catch((err) => {
    console.error("[harness][demo] fatal", err);
    process.exitCode = 1;
  });
}
