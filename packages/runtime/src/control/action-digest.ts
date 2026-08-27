import type { Action } from "@monai/contracts";

const CANONICALIZATION_VERSION = "action-canon/0.1.0";
const DIGEST_ALGORITHM = "stable-json/sha256-lite";

function stable(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(",")}}`;
  }
  return String(value);
}

/**
 * MVP actionDigest (design 01 §8.1 subset).
 * Stable over action identity fields used for Approval binding.
 */
export function computeActionDigest(action: Action): string {
  const payload = {
    actionId: action.actionId,
    type: action.type,
    toolId: action.toolId ?? null,
    arguments: action.arguments ?? null,
    resourceScope: action.resourceScope ?? null,
    idempotencyKey: action.idempotencyKey ?? null,
  };
  return `ad:${stable(payload)}`;
}

export function actionDigestMeta() {
  return {
    canonicalizationVersion: CANONICALIZATION_VERSION,
    actionSchemaVersion: "1",
    digestAlgorithm: DIGEST_ALGORITHM,
  };
}
