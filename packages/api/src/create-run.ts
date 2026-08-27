import { CONTRACTS_SCHEMA_VERSION } from "@monai/contracts";
import type { HarnessCommand } from "@monai/ports";
import type { CreateRunPayload } from "@monai/runtime";

export type BuildCreateRunCommandInput = CreateRunPayload & {
  tenantId: string;
  commandId: string;
  correlationId?: string;
  principalId?: string;
};

/**
 * Build a create_run HarnessCommand (HTTP maps Idempotency-Key → commandId).
 */
export function buildCreateRunCommand(input: BuildCreateRunCommandInput): HarnessCommand {
  const {
    tenantId,
    commandId,
    correlationId,
    principalId,
    ...payload
  } = input;

  return {
    schemaVersion: CONTRACTS_SCHEMA_VERSION,
    commandId,
    commandType: "create_run",
    tenantId,
    runId: payload.runId,
    actor: principalId ? { principalId } : undefined,
    payload,
    issuedAt: new Date().toISOString(),
    correlationId: correlationId ?? commandId,
  };
}
