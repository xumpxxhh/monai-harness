import { pathToFileURL } from "node:url";

import { buildCreateRunCommand } from "@monai/api";

import { bootstrap } from "../bootstrap/container.js";
import { loadConfig } from "../config/env.js";
import {
  attachPreviewPrinter,
  createCliIo,
  runAgentLoop,
  type AgentLoopOutcome,
  type CliIo,
} from "./demo-shared.js";
import {
  buildSessionGoal,
  extractAssistantReply,
  SessionTranscript,
} from "./session-transcript.js";
import {
  buildSessionRunId,
  SessionDemoObserver,
} from "../observer/session-demo-observer.js";
import { DeliveryLoops } from "../workers/delivery-loops.js";
import { TurnDriver } from "../workers/turn-driver.js";

function printSessionBanner(sessionId: string): void {
  console.log("");
  console.log("══════════════════════════════════════════════");
  console.log("  Monai Harness · Session CLI Demo");
  console.log("  多轮对话（同一 sessionId，每条消息 = 新 Run）");
  console.log("══════════════════════════════════════════════");
  console.log(`Session ${sessionId} started. Type /exit to quit.`);
  console.log("");
}

export async function runSessionCliDemo(
  runtime: Awaited<ReturnType<typeof bootstrap>>,
  loops: DeliveryLoops,
  turnDriver: TurnDriver,
  options: { cli?: CliIo; sessionId?: string } = {},
): Promise<void> {
  const cli = options.cli ?? createCliIo();
  const ownsCli = !options.cli;
  const sessionId = options.sessionId ?? `cli-session-${Date.now()}`;
  const transcript = new SessionTranscript();
  const sessionObserver = new SessionDemoObserver({ sessionId, runtime });

  printSessionBanner(sessionId);
  await sessionObserver.start();
  console.log(`[demo-session] observer recording → ${sessionObserver.getArchiveDir()}`);

  let turnIndex = 0;

  try {
    while (true) {
      if (!cli.isTty) {
        console.log("[demo-session] non-TTY: nothing to read, exiting.");
        break;
      }

      const message = (await cli.question("> ")).trim();
      if (!message) continue;
      if (message === "/exit" || message === "/quit") break;

      turnIndex += 1;
      const userMessage = message;
      const goal = buildSessionGoal(transcript.getTurns(), userMessage);
      const runId = buildSessionRunId(sessionId, turnIndex);
      const executionManifestRef = `manifest://cli-session-demo/${sessionId}/${runId}`;

      transcript.addUser(userMessage, runId);
      await sessionObserver.appendTranscriptTurn({
        role: "user",
        content: userMessage,
        runId,
      });

      console.log(`\n[demo-session] runId=${runId} goal=${userMessage}`);

      const runObserver = sessionObserver.createRunObserver(runId, goal);
      await runObserver.start();

      const created = await runtime.engine.handle(
        buildCreateRunCommand({
          tenantId: "t1",
          commandId: `create-${runId}`,
          runId,
          sessionId,
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
      console.log(
        `[demo-session] created revision=${created.revision} status=${created.run.status}`,
      );
      await runObserver.onRunCreated(created.revision, created.run.status);

      const unsubscribe = attachPreviewPrinter(runtime, runId);
      let outcome: AgentLoopOutcome = "unknown";

      try {
        try {
          outcome = await runAgentLoop(runtime, loops, turnDriver, runId, cli, runObserver, {
            autoFinalize: false,
          });
        } catch (err) {
          await runObserver.finalize("failed");
          throw err;
        }

        const events = await runtime.persistence.listEvents(runId);
        const assistantReply = extractAssistantReply(events);
        transcript.addAssistant(assistantReply, runId);
        await sessionObserver.appendTranscriptTurn({
          role: "assistant",
          content: assistantReply,
          runId,
        });

        const runSummary = await runObserver.finalize(outcome);
        await sessionObserver.recordRunSummary(runSummary);

        console.log(`\nAssistant: ${assistantReply}`);
        console.log(`[demo-session] run outcome=${outcome} archive=${runSummary.archiveDir}\n`);
      } finally {
        unsubscribe();
        await runObserver.stop();
      }
    }
  } finally {
    const summary = await sessionObserver.finalize();
    console.log(`[demo-session] session archive: ${summary.archiveDir}`);
    console.log(
      `[demo-session] session summary: turns=${summary.turnCount} runs=${summary.runIds.length}`,
    );
    if (ownsCli) cli.close();
  }
}

async function main(): Promise<void> {
  const config = loadConfig();
  console.log(
    `[harness][demo-session] starting driver=${config.persistenceDriver} model=${config.modelDriver}`,
  );
  const runtime = await bootstrap(config);
  const turnDriver = new TurnDriver(runtime, { autoExecute: false });
  const loops = new DeliveryLoops(runtime, config.loopIntervalMs, turnDriver);
  try {
    await runSessionCliDemo(runtime, loops, turnDriver);
    console.log("[harness] demo-session complete");
  } finally {
    await runtime.close();
  }
}

const invokedAsMain =
  typeof process.argv[1] === "string" &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedAsMain) {
  main().catch((err) => {
    console.error("[harness][demo-session] fatal", err);
    process.exitCode = 1;
  });
}
