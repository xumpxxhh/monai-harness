import type { RunState } from "@monai/contracts";

function stable(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value ?? null);
}

/** Deterministic state hash for Checkpoint binding and recovery verification. */
export function computeStateHash(state: RunState | undefined): string {
  return `sh:${stable(state ?? { facts: [], cursor: { stepCount: 0 } })}`;
}
