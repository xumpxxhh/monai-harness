import type { Run } from "@monai/contracts";
import type { HarnessCommand } from "@monai/ports";

import type { HandleFailure } from "./types.js";

/**
 * Rejects cross-tenant commands that target a run owned by another tenant.
 */
export function assertCommandTenant(
  run: Pick<Run, "tenantId">,
  command: Pick<HarnessCommand, "tenantId">,
): HandleFailure | null {
  if (command.tenantId !== run.tenantId) {
    return {
      ok: false,
      code: "authorization",
      message: `tenant mismatch: command=${command.tenantId} run=${run.tenantId}`,
    };
  }
  return null;
}
