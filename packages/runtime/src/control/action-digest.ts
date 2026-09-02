import type { Action } from "@monai/contracts";

import { getToolCallInvocations, normalizeToolCallAction } from "../model/normalize-action.js";

const CANONICALIZATION_VERSION = "action-canon/0.2.0";
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

function canonicalCalls(action: Action) {
  const invocations = getToolCallInvocations(normalizeToolCallAction(action));
  return [...invocations]
    .map((inv) => ({
      toolId: inv.toolId,
      arguments: inv.arguments ?? null,
      resourceScope: inv.resourceScope ?? null,
      idempotencyKey: inv.idempotencyKey ?? null,
    }))
    .sort((a, b) => {
      const ka = `${a.toolId}:${stable(a.arguments)}`;
      const kb = `${b.toolId}:${stable(b.arguments)}`;
      return ka.localeCompare(kb);
    });
}

/**
 * MVP actionDigest (design 01 §8.1 subset).
 * Stable over action identity fields used for Approval binding.
 */
export function computeActionDigest(action: Action): string {
  const normalized = normalizeToolCallAction(action);
  const payload =
    normalized.type === "tool.call"
      ? {
          type: normalized.type,
          calls: canonicalCalls(normalized),
          atomic: normalized.atomic ?? false,
        }
      : {
          type: normalized.type,
          toolId: normalized.toolId ?? null,
          arguments: normalized.arguments ?? null,
          resourceScope: normalized.resourceScope ?? null,
          idempotencyKey: normalized.idempotencyKey ?? null,
          childSpec: normalized.childSpec ?? null,
        };
  return `ad:${stable(payload)}`;
}

export function actionDigestMeta() {
  return {
    canonicalizationVersion: CANONICALIZATION_VERSION,
    actionSchemaVersion: "2",
    digestAlgorithm: DIGEST_ALGORITHM,
  };
}
