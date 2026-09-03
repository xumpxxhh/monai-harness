import {
  CONTRACTS_SCHEMA_VERSION,
  type ToolEffectContract,
} from "@monai/contracts";

const base = (partial: Omit<ToolEffectContract, "schemaVersion">): ToolEffectContract => ({
  schemaVersion: CONTRACTS_SCHEMA_VERSION,
  ...partial,
});

/**
 * Core-only tool effect contracts (non-Pack stubs).
 * Pack tools must come from ExtensionRegistry / ExecutionManifest — never hardcode here.
 */
export const TOOL_CATALOG: Record<string, ToolEffectContract> = {
  echo: base({
    sideEffectProfile: "none",
    deliverySemantics: "at_most_once",
    idempotencyScope: "run",
    reconcileSupported: false,
    timeoutMs: 5_000,
  }),
  "risky.write": base({
    sideEffectProfile: "write_high",
    deliverySemantics: "at_most_once",
    idempotencyScope: "run",
    reconcileSupported: false,
    timeoutMs: 5_000,
  }),
};

export function lookupToolContract(toolId: string): ToolEffectContract | undefined {
  return TOOL_CATALOG[toolId];
}

export function requiresIdempotencyKey(contract: ToolEffectContract): boolean {
  return contract.sideEffectProfile !== "none" && contract.sideEffectProfile !== "read";
}
