import type { SchemaVersion } from "@monai/contracts";

export const HARNESS_COMMAND_TYPES = [
  "create_run",
  "queue_run",
  "acquire_lease",
  "release_lease",
  "yield_run",
  "execute_turn",
  "submit_input",
  "approval_decision",
  "pause_run",
  "resume_run",
  "cancel_run",
  "tool_dispatch_result",
  "reconcile_tool",
] as const;

export type HarnessCommandType = (typeof HARNESS_COMMAND_TYPES)[number];

/**
 * Unified command envelope (EDR-012).
 * API / Scheduler / Worker enter Engine only through this shape.
 */
export type HarnessCommand = {
  schemaVersion: SchemaVersion;
  commandId: string;
  commandType: HarnessCommandType | `governance_${string}`;
  tenantId: string;
  runId?: string;
  expectedRevision?: number;
  leaseEpoch?: number;
  actor?: {
    principalId: string;
    authContextRef?: string;
  };
  payload?: unknown;
  payloadRef?: string;
  issuedAt: string;
  correlationId?: string;
};
