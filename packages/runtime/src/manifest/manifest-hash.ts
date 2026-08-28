import { createHash } from "crypto";

import type { ExecutionManifest } from "@monai/contracts";

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
}

/** Deterministic content hash for an Execution Manifest (excludes `hash` field). */
export function computeManifestHash(manifest: Omit<ExecutionManifest, "hash">): string {
  const digest = createHash("sha256").update(stableStringify(manifest)).digest("hex");
  return `sha256:${digest}`;
}

export function finalizeExecutionManifest(
  draft: Omit<ExecutionManifest, "hash">,
): ExecutionManifest {
  const hash = computeManifestHash(draft);
  return { ...draft, hash };
}
