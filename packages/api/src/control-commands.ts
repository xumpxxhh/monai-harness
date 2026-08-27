import { CONTRACTS_SCHEMA_VERSION } from "@monai/contracts";
import type { HarnessCommand } from "@monai/ports";

export type BuildControlCommandInput = {
  tenantId: string;
  commandId: string;
  runId: string;
  expectedRevision: number;
  principalId?: string;
  correlationId?: string;
};

function controlCommand(
  commandType: "pause_run" | "resume_run" | "cancel_run",
  input: BuildControlCommandInput,
): HarnessCommand {
  return {
    schemaVersion: CONTRACTS_SCHEMA_VERSION,
    commandId: input.commandId,
    commandType,
    tenantId: input.tenantId,
    runId: input.runId,
    expectedRevision: input.expectedRevision,
    actor: input.principalId ? { principalId: input.principalId } : undefined,
    issuedAt: new Date().toISOString(),
    correlationId: input.correlationId ?? input.commandId,
  };
}

export function buildPauseRunCommand(input: BuildControlCommandInput): HarnessCommand {
  return controlCommand("pause_run", input);
}

export function buildResumeRunCommand(input: BuildControlCommandInput): HarnessCommand {
  return controlCommand("resume_run", input);
}

export function buildCancelRunCommand(input: BuildControlCommandInput): HarnessCommand {
  return controlCommand("cancel_run", input);
}
