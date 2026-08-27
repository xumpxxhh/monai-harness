import {
  CONTRACTS_SCHEMA_VERSION,
  type Observation,
} from "@monai/contracts";
import type { Action } from "@monai/contracts";

/**
 * P3 readonly tool stub — no prepared/dispatch (P4).
 * Invoked only for allowlisted readonly tools after Policy allow.
 */
export async function invokeReadonlyTool(input: {
  action: Action;
  tenantId: string;
  sessionId: string;
  runId: string;
  stepId: string;
}): Promise<Observation> {
  const toolId = input.action.toolId ?? "unknown";
  const args = (input.action.arguments ?? {}) as Record<string, unknown>;
  const text =
    toolId === "echo"
      ? String(args.text ?? "")
      : toolId === "workspace.read"
        ? JSON.stringify({ path: args.path ?? "/", stub: true })
        : JSON.stringify(args);

  const observationId = `obs-${input.action.actionId}`;
  return {
    schemaVersion: CONTRACTS_SCHEMA_VERSION,
    observationId,
    tenantId: input.tenantId,
    sessionId: input.sessionId,
    runId: input.runId,
    stepId: input.stepId,
    source: {
      kind: "tool",
      sourceId: `readonly:${toolId}:${input.action.actionId}`,
      version: "stub/0.1.0",
    },
    observedAt: new Date().toISOString(),
    data: {
      toolId,
      summary: text.slice(0, 200),
      text,
    },
    hash: `obs-hash-${observationId}`,
    declaredSchemaRef: `tool.${toolId}.result/0.1.0`,
  };
}
