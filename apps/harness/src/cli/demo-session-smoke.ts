import { pathToFileURL } from "node:url";

import { bootstrap } from "../bootstrap/container.js";
import { loadConfig } from "../config/env.js";
import { createScriptedCliIo } from "./demo-shared.js";
import { runSessionCliDemo } from "./demo-session.js";
import { DeliveryLoops } from "../workers/delivery-loops.js";
import { TurnDriver } from "../workers/turn-driver.js";

/**
 * Non-interactive Session smoke (rounds 1–2 from 0023-real-model-e2e.md).
 * Override messages: HARNESS_SMOKE_MESSAGES="msg1||msg2||/exit"
 */
async function main(): Promise<void> {
  const config = loadConfig();
  if (config.modelDriver !== "openai") {
    console.error(
      `[harness][demo-session-smoke] MODEL_DRIVER=${config.modelDriver}; set MODEL_DRIVER=openai for real-model E2E`,
    );
    process.exitCode = 1;
    return;
  }

  const raw = process.env.HARNESS_SMOKE_MESSAGES?.trim();
  const messages = raw
    ? raw.split("||").map((s) => s.trim()).filter(Boolean)
    : [
        "列出工作区根目录下的文件和文件夹",
        "把「hello e2e」写入 /notes/e2e-smoke.md",
        "/exit",
      ];

  console.log(
    `[harness][demo-session-smoke] starting driver=${config.persistenceDriver} model=${config.modelDriver}`,
  );
  console.log(`[harness][demo-session-smoke] messages=${JSON.stringify(messages)}`);

  const runtime = await bootstrap(config);
  const turnDriver = new TurnDriver(runtime, { autoExecute: false });
  const loops = new DeliveryLoops(runtime, config.loopIntervalMs, turnDriver);
  const cli = createScriptedCliIo(messages);

  try {
    await runSessionCliDemo(runtime, loops, turnDriver, {
      cli,
      sessionId: `cli-smoke-${Date.now()}`,
    });
    console.log("[harness] demo-session-smoke complete");
  } finally {
    await runtime.close();
  }
}

const isDirect =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirect) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
