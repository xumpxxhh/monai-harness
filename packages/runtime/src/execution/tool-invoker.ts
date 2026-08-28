import type { ToolCallRecord } from "@monai/contracts";
import type { ExecutionContext, ToolHandler, ToolHandlerInput } from "@monai/pack-sdk";

export type ToolInvokeSuccess = {
  ok: true;
  data: unknown;
  resultRef?: string;
  resultHash?: string;
};

export type ToolInvokeFailure = {
  ok: false;
  error: string;
  unknown?: boolean;
};

export type ToolInvokeResult = ToolInvokeSuccess | ToolInvokeFailure;

export type ToolInvokerDeps = {
  handlers: Record<string, ToolHandler>;
  reconcileHandlers?: Record<string, ToolHandler>;
  buildExecutionContext?: (toolCall: ToolCallRecord) => ExecutionContext;
};

function defaultContext(toolCall: ToolCallRecord): ExecutionContext {
  return {
    tenantId: toolCall.tenantId,
    sessionId: toolCall.sessionId,
    runId: toolCall.runId,
    stepId: toolCall.stepId,
    executionManifestRef: toolCall.executionManifestRef,
    effectivePermissions: [],
    leaseEpoch: toolCall.dispatchLeaseEpoch,
  };
}

/**
 * In-process tool invoker (transaction-external). Handlers injected by Pack wiring.
 */
export class ToolInvoker {
  private readonly handlers: Record<string, ToolHandler>;
  private readonly reconcileHandlers: Record<string, ToolHandler>;
  private readonly buildExecutionContext: (toolCall: ToolCallRecord) => ExecutionContext;

  constructor(deps: ToolInvokerDeps) {
    this.handlers = deps.handlers;
    this.reconcileHandlers = deps.reconcileHandlers ?? {};
    this.buildExecutionContext = deps.buildExecutionContext ?? defaultContext;
  }

  async invoke(toolCall: ToolCallRecord): Promise<ToolInvokeResult> {
    const handler = this.handlers[toolCall.toolId];
    if (!handler) {
      return { ok: false, error: `unknown toolId: ${toolCall.toolId}` };
    }
    const input: ToolHandlerInput = {
      toolId: toolCall.toolId,
      arguments: toolCall.arguments ?? {},
      executionContext: this.buildExecutionContext(toolCall),
      toolCallId: toolCall.toolCallId,
      idempotencyKey: toolCall.idempotencyKey,
    };
    try {
      const result = await handler(input);
      if (result.ok) {
        return {
          ok: true,
          data: result.data,
          resultRef: result.resultRef,
          resultHash: result.resultHash,
        };
      }
      return {
        ok: false,
        error: result.error ?? "tool handler failed",
        unknown: result.unknown,
      };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : "tool invoke failed",
      };
    }
  }

  async reconcile(toolCall: ToolCallRecord): Promise<ToolInvokeResult> {
    const handler = this.reconcileHandlers[toolCall.toolId];
    if (!handler) {
      return { ok: false, error: `reconcile not supported for ${toolCall.toolId}` };
    }
    const input: ToolHandlerInput = {
      toolId: toolCall.toolId,
      arguments: toolCall.arguments ?? {},
      executionContext: this.buildExecutionContext(toolCall),
      toolCallId: toolCall.toolCallId,
      idempotencyKey: toolCall.idempotencyKey,
    };
    try {
      const result = await handler(input);
      if (result.ok) {
        return {
          ok: true,
          data: result.data,
          resultRef: result.resultRef,
          resultHash: result.resultHash,
        };
      }
      return { ok: false, error: result.error ?? "reconcile failed" };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : "reconcile failed",
      };
    }
  }
}

export function createToolInvokerFromHandlers(
  handlers: Record<string, ToolHandler>,
  options?: {
    reconcileHandlers?: Record<string, ToolHandler>;
    buildExecutionContext?: (toolCall: ToolCallRecord) => ExecutionContext;
  },
): ToolInvoker {
  return new ToolInvoker({
    handlers,
    reconcileHandlers: options?.reconcileHandlers,
    buildExecutionContext: options?.buildExecutionContext,
  });
}
