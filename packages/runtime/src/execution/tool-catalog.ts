import {
  CONTRACTS_SCHEMA_VERSION,
  type ToolEffectContract,
} from "@monai/contracts";

const base = (partial: Omit<ToolEffectContract, "schemaVersion">): ToolEffectContract => ({
  schemaVersion: CONTRACTS_SCHEMA_VERSION,
  ...partial,
});

/** MVP tool effect contracts (design 08 §2.4–2.5). */
export const TOOL_CATALOG: Record<string, ToolEffectContract> = {
  echo: base({
    sideEffectProfile: "none",
    deliverySemantics: "at_most_once",
    idempotencyScope: "run",
    reconcileSupported: false,
    timeoutMs: 5_000,
  }),
  "workspace.list": base({
    sideEffectProfile: "read",
    deliverySemantics: "at_most_once",
    idempotencyScope: "run",
    reconcileSupported: false,
    timeoutMs: 5_000,
  }),
  "workspace.read": base({
    sideEffectProfile: "read",
    deliverySemantics: "at_most_once",
    idempotencyScope: "run",
    reconcileSupported: false,
    timeoutMs: 5_000,
  }),
  "workspace.search": base({
    sideEffectProfile: "read",
    deliverySemantics: "at_most_once",
    idempotencyScope: "run",
    reconcileSupported: false,
    timeoutMs: 5_000,
  }),
  "knowledge.search": base({
    sideEffectProfile: "read",
    deliverySemantics: "at_most_once",
    idempotencyScope: "run",
    reconcileSupported: false,
    timeoutMs: 60_000,
  }),
  "workspace.write": base({
    sideEffectProfile: "write_low",
    deliverySemantics: "at_most_once",
    idempotencyScope: "run",
    reconcileSupported: false,
    timeoutMs: 5_000,
  }),
  "artifact.write_markdown": base({
    sideEffectProfile: "write_low",
    deliverySemantics: "at_most_once",
    idempotencyScope: "run",
    reconcileSupported: false,
    timeoutMs: 5_000,
  }),
  "artifact.validate": base({
    sideEffectProfile: "read",
    deliverySemantics: "at_most_once",
    idempotencyScope: "run",
    reconcileSupported: false,
    timeoutMs: 5_000,
  }),
  "synthetic.write_high": base({
    sideEffectProfile: "write_high",
    deliverySemantics: "at_most_once",
    idempotencyScope: "resource",
    reconcileSupported: true,
    timeoutMs: 5_000,
  }),
};

export function lookupToolContract(toolId: string): ToolEffectContract | undefined {
  return TOOL_CATALOG[toolId];
}

export function requiresIdempotencyKey(contract: ToolEffectContract): boolean {
  return contract.sideEffectProfile !== "none" && contract.sideEffectProfile !== "read";
}
