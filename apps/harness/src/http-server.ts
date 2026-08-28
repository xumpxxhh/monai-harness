import { serve } from "@hono/node-server";
import { createHttpApp } from "@monai/api";

import type { HarnessRuntime } from "./bootstrap.js";
import type { TurnDriver } from "./turn-driver.js";

export type HttpServerHandle = {
  port: number;
  close: () => Promise<void>;
};

function jsonHandleResult(result: Awaited<ReturnType<TurnDriver["executeTurn"]>>): Response {
  if (!result.ok) {
    const status =
      result.code === "validation"
        ? 400
        : result.code === "conflict"
          ? 409
          : result.code === "lease_lost"
            ? 409
            : 500;
    return Response.json(
      { ok: false, code: result.code, message: result.message, httpStatus: status },
      { status },
    );
  }
  return Response.json({
    ok: true,
    run: result.run,
    revision: result.revision,
    leaseEpoch: result.leaseEpoch,
    idempotent: result.idempotent,
  });
}

/**
 * Bind Hono REST/SSE app + harness-only console routes (EDR-007 + app layer).
 */
export function startHttpServer(
  runtime: HarnessRuntime,
  port: number,
  corsOrigins: string[] | undefined,
  turnDriver: TurnDriver,
): HttpServerHandle {
  const app = createHttpApp({
    engine: runtime.engine,
    persistence: runtime.persistence,
    defaultTenantId: "t1",
    corsOrigins,
  });

  /** Harness-only: manual execute_turn (not in @monai/api). */
  app.post("/v1/runs/:runId/turn", async (c) => {
    const runId = c.req.param("runId");
    turnDriver.forget(runId);
    return jsonHandleResult(await turnDriver.executeTurn(runId));
  });

  const server = serve({ fetch: app.fetch, port });
  return {
    port,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
