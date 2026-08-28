import { EvalHarness, MVP_EVAL_SUITES } from "@monai/observability";

import { bootstrap } from "./bootstrap.js";
import { loadConfig } from "./config.js";
import { runCreateRunToExecuteTurnDemo } from "./demo.js";
import { startHttpServer } from "./http-server.js";
import { DeliveryLoops } from "./loops.js";
import { TurnDriver } from "./turn-driver.js";

/**
 * MVP deployable harness.
 * P8b: bootstrap DI + PERSISTENCE_DRIVER + delivery loops.
 * P8c: HTTP/SSE via Hono (EDR-007 Accepted).
 */
async function main(): Promise<void> {
  const config = loadConfig();
  console.log(
    `[harness] monai-harness starting driver=${config.persistenceDriver} mode=${config.mode} port=${config.port}`,
  );
  console.log(
    `[harness][edr-014] flags dag=${config.featureFlags.enableDag} spawn=${config.featureFlags.enableSpawnChild} memory=${config.featureFlags.enableMemory} sandbox=${config.featureFlags.enableSandboxExec} realWriteHigh=${config.featureFlags.enableRealWriteHigh}`,
  );

  if (config.runEvalOnStart) {
    const harness = new EvalHarness();
    const results = await harness.runAll(MVP_EVAL_SUITES);
    for (const result of results) {
      console.log(
        `[harness][eval] ${result.suiteId}: ${result.passed}/${result.total} (${(result.passRate * 100).toFixed(0)}%) ${result.ok ? "PASS" : "FAIL"}`,
      );
      if (!result.ok) {
        for (const c of result.cases.filter((x) => !x.ok)) {
          console.log(`  - ${c.caseId}: ${c.message ?? "failed"}`);
        }
        process.exitCode = 1;
        return;
      }
    }
  }

  const runtime = await bootstrap(config);
  const turnDriver = new TurnDriver(runtime, { autoExecute: config.autoExecuteTurn });
  const loops = new DeliveryLoops(runtime, config.loopIntervalMs, turnDriver);
  let http: { close: () => Promise<void> } | undefined;

  try {
    if (config.mode === "serve") {
      loops.start();
      http = startHttpServer(runtime, config.port, config.corsOrigins, turnDriver);
      console.log(
        `[harness] serve: HTTP :${config.port} + delivery loops every ${config.loopIntervalMs}ms autoTurn=${config.autoExecuteTurn}`,
      );
      await waitForSignal();
      console.log("[harness] shutting down…");
      loops.stop();
      await http.close();
    } else {
      await runCreateRunToExecuteTurnDemo(runtime, loops);
      console.log("[harness] demo complete");
    }
  } finally {
    await runtime.close();
  }
}

function waitForSignal(): Promise<void> {
  return new Promise((resolve) => {
    const onStop = () => {
      process.off("SIGINT", onStop);
      process.off("SIGTERM", onStop);
      resolve();
    };
    process.on("SIGINT", onStop);
    process.on("SIGTERM", onStop);
  });
}

main().catch((err) => {
  console.error("[harness] fatal", err);
  process.exitCode = 1;
});
