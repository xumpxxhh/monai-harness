import { EvalHarness, MVP_EVAL_SUITES } from "@monai/observability";

import { bootstrap } from "./bootstrap.js";
import { loadConfig } from "./config.js";
import { runCreateRunToExecuteTurnDemo } from "./demo.js";
import { DeliveryLoops } from "./loops.js";

/**
 * MVP deployable harness.
 * P8b: bootstrap DI + PERSISTENCE_DRIVER + delivery loops + CreateRun→execute_turn.
 * P8c: HTTP/SSE (EDR-007 still Deferred).
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
  const loops = new DeliveryLoops(runtime, config.loopIntervalMs);

  try {
    await runCreateRunToExecuteTurnDemo(runtime, loops);

    if (config.mode === "serve") {
      loops.start();
      console.log(
        `[harness] serve mode: delivery loops every ${config.loopIntervalMs}ms (HTTP deferred to P8c)`,
      );
      await waitForSignal();
      console.log("[harness] shutting down…");
      loops.stop();
    } else {
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
