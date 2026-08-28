import { CONTRACTS_SCHEMA_VERSION } from "@monai/contracts";
import type { HarnessCommand } from "@monai/ports";

export type BuildApprovalDecisionCommandInput = {
  tenantId: string;
  commandId: string;
  runId: string;
  expectedRevision: number;
  approvalId: string;
  decision: "approved" | "rejected";
  reason?: string;
  principalId?: string;
  correlationId?: string;
};

/**
 * Build an approval_decision HarnessCommand (used by HTTP handlers and tests).
 */
export function buildApprovalDecisionCommand(
  input: BuildApprovalDecisionCommandInput,
): HarnessCommand {
  return {
    schemaVersion: CONTRACTS_SCHEMA_VERSION,
    commandId: input.commandId,
    commandType: "approval_decision",
    tenantId: input.tenantId,
    runId: input.runId,
    expectedRevision: input.expectedRevision,
    actor: input.principalId ? { principalId: input.principalId } : undefined,
    payload: {
      approvalId: input.approvalId,
      decision: input.decision,
      reason: input.reason,
    },
    issuedAt: new Date().toISOString(),
    correlationId: input.correlationId ?? input.commandId,
  };
}

export type BuildSubmitInputCommandInput = {
  tenantId: string;
  commandId: string;
  runId: string;
  expectedRevision: number;
  inputId: string;
  value: unknown;
  principalId?: string;
  correlationId?: string;
};

/**
 * Build a submit_input HarnessCommand (used by HTTP handlers and tests).
 */
export function buildSubmitInputCommand(input: BuildSubmitInputCommandInput): HarnessCommand {
  return {
    schemaVersion: CONTRACTS_SCHEMA_VERSION,
    commandId: input.commandId,
    commandType: "submit_input",
    tenantId: input.tenantId,
    runId: input.runId,
    expectedRevision: input.expectedRevision,
    actor: input.principalId ? { principalId: input.principalId } : undefined,
    payload: {
      inputId: input.inputId,
      value: input.value,
    },
    issuedAt: new Date().toISOString(),
    correlationId: input.correlationId ?? input.commandId,
  };
}
