import type { ToolCallRecord } from "@monai/contracts";
import type { ExecutionContext, ToolHandler } from "@monai/pack-sdk";

import { ToolInvoker } from "../execution/tool-invoker.js";
import type { ExtensionRegistry } from "./extension-registry.js";

export function buildToolInvokerFromRegistry(
  registry: ExtensionRegistry,
  options?: {
    extraHandlers?: Record<string, ToolHandler>;
    buildExecutionContext?: (toolCall: ToolCallRecord) => ExecutionContext;
  },
): ToolInvoker {
  const handlers: Record<string, ToolHandler> = { ...(options?.extraHandlers ?? {}) };
  for (const toolId of registry.getToolAllowlist()) {
    const handler = registry.getToolHandler(toolId);
    if (handler) handlers[toolId] = handler;
  }

  const reconcileHandlers: Record<string, ToolHandler> = {};
  const reconcile = registry.getReconcileHandler("synthetic.write_high");
  if (reconcile) {
    reconcileHandlers["synthetic.write_high"] = reconcile;
  }

  return new ToolInvoker({
    handlers,
    reconcileHandlers,
    buildExecutionContext: options?.buildExecutionContext,
  });
}

/** Legacy echo handler for Golden / model-stub paths (not part of workspace-generic manifest). */
export const LEGACY_ECHO_HANDLER: ToolHandler = (input) => ({
  ok: true,
  data: {
    toolId: "echo",
    text: String((input.arguments as Record<string, unknown>).text ?? ""),
    summary: String((input.arguments as Record<string, unknown>).text ?? ""),
  },
  resultHash: input.executionContext.runId,
});
