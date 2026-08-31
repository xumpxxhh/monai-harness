import { bootstrap } from "./bootstrap/container.js";
import { runCreateRunToExecuteTurnDemo } from "./cli/demo.js";
import { runStartupEval } from "./cli/eval-runner.js";
import { formatHarnessRoles, hasDeliveryRole, loadConfig } from "./config/env.js";
import { startHttpServer, type HttpServerHandle } from "./server/http-server.js";
import { DeliveryLoops } from "./workers/delivery-loops.js";
import { TurnDriver } from "./workers/turn-driver.js";

/**
 * MVP deployable harness.
 * P8b: bootstrap DI + PERSISTENCE_DRIVER + delivery loops.
 * P8c: HTTP/SSE via Hono (EDR-007 Accepted).
 * P9d: in-process role switches (api / dispatcher / scheduler / worker / observability / governance).
 */
async function main(): Promise<void> {
  const config = loadConfig();
  console.log(
    `[harness] monai-harness starting driver=${config.persistenceDriver} mode=${config.mode} port=${config.port}`,
  );
  console.log(`[harness] roles ${formatHarnessRoles(config.roles)}`);
  console.log(
    `[harness][edr-014] flags dag=${config.featureFlags.enableDag} spawn=${config.featureFlags.enableSpawnChild} memory=${config.featureFlags.enableMemory} sandbox=${config.featureFlags.enableSandboxExec} realWriteHigh=${config.featureFlags.enableRealWriteHigh}`,
  );

  const evalPassed = await runStartupEval(config);
  if (!evalPassed) {
    process.exitCode = 1;
    return;
  }

  const runtime = await bootstrap(config);
  const turnDriver = new TurnDriver(runtime, { autoExecute: config.autoExecuteTurn });
  const loops = new DeliveryLoops(runtime, config.loopIntervalMs, turnDriver);
  let http: HttpServerHandle | undefined;

  try {
    if (config.mode === "serve") {
      if (hasDeliveryRole(config.roles)) {
        loops.start();
      }
      if (config.roles.api) {
        http = startHttpServer(runtime, config.port, config.corsOrigins, turnDriver);
      }
      const httpLabel = config.roles.api ? `HTTP :${config.port}` : "no HTTP (api off)";
      const loopsLabel = hasDeliveryRole(config.roles)
        ? `delivery loops every ${config.loopIntervalMs}ms`
        : "no delivery loops";
      console.log(
        `[harness] serve: ${httpLabel} + ${loopsLabel} autoTurn=${config.autoExecuteTurn}`,
      );
      await waitForSignal();
      console.log("[harness] shutting down…");
      loops.stop();
      await http?.close();
    } else {
      await runCreateRunToExecuteTurnDemo(runtime, loops, turnDriver);
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
