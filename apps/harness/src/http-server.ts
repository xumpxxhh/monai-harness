import { serve } from "@hono/node-server";
import { createHttpApp } from "@monai/api";

import type { HarnessRuntime } from "./bootstrap.js";

export type HttpServerHandle = {
  port: number;
  close: () => Promise<void>;
};

/**
 * Bind Hono REST/SSE app to Node HTTP (EDR-007).
 */
export function startHttpServer(runtime: HarnessRuntime, port: number): HttpServerHandle {
  const app = createHttpApp({
    engine: runtime.engine,
    persistence: runtime.persistence,
    defaultTenantId: "t1",
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
