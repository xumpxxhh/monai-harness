import { describe, expect, it } from "vitest";

import { createToolInvokerFromHandlers } from "./tool-invoker.js";

describe("ToolInvoker failure data", () => {
  it("forwards handler data on ok:false invoke", async () => {
    const invoker = createToolInvokerFromHandlers({
      workspace_exec: async () => ({
        ok: false,
        error: "workspace_exec timed out: npm install",
        data: {
          stdout: "partial log",
          stderr: "",
          timedOut: true,
          truncated: false,
          cwd: "/projects/x",
          exitCode: null,
          summary: "workspace_exec timed out: npm install",
        },
      }),
    });

    const outcome = await invoker.invoke({
      schemaVersion: "0.1.0",
      toolCallId: "tc-1",
      tenantId: "t1",
      sessionId: "s1",
      runId: "r1",
      stepId: "step-1",
      toolId: "workspace_exec",
      toolVersion: "0.1.0",
      arguments: { command: "npm install" },
      status: "dispatched",
      revision: 1,
      executionManifestRef: "manifest://m1",
      idempotencyKey: "ik-1",
      createdAt: new Date().toISOString(),
    } as never);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error).toContain("timed out");
    expect(outcome.data).toMatchObject({
      stdout: "partial log",
      timedOut: true,
      cwd: "/projects/x",
    });
  });

  it("forwards handler data on ok:false reconcile", async () => {
    const invoker = createToolInvokerFromHandlers(
      {},
      {
        reconcileHandlers: {
          workspace_exec: async () => ({
            ok: false,
            error: "still timed out",
            data: { stdout: "after kill", timedOut: true },
          }),
        },
      },
    );

    const outcome = await invoker.reconcile({
      schemaVersion: "0.1.0",
      toolCallId: "tc-2",
      tenantId: "t1",
      sessionId: "s1",
      runId: "r1",
      stepId: "step-1",
      toolId: "workspace_exec",
      toolVersion: "0.1.0",
      arguments: {},
      status: "outcome_unknown",
      revision: 1,
      executionManifestRef: "manifest://m1",
      idempotencyKey: "ik-2",
      createdAt: new Date().toISOString(),
    } as never);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.data).toMatchObject({ stdout: "after kill", timedOut: true });
  });
});
