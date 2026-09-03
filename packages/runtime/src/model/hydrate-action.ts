import { randomUUID } from "node:crypto";

import { CONTRACTS_SCHEMA_VERSION } from "@monai/contracts";

import { normalizeToolCallAction, type ToolContractLookup } from "./normalize-action.js";

/**
 * Hydrate model JSON into an Action candidate before schema validation.
 * Runtime owns schemaVersion / actionId / per-invocation idempotencyKey.
 */
export function hydrateModelAction(
  raw: unknown,
  lookup?: ToolContractLookup,
): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;

  const obj = { ...(raw as Record<string, unknown>) };
  delete obj.schemaVersion;
  delete obj.actionId;
  obj.schemaVersion = CONTRACTS_SCHEMA_VERSION;
  obj.actionId = `act-${randomUUID()}`;

  const displayText =
    typeof obj.displayText === "string" && obj.displayText.trim()
      ? obj.displayText.trim()
      : undefined;

  if (obj.type === "ask_user" && displayText) {
    const args =
      obj.arguments && typeof obj.arguments === "object" && !Array.isArray(obj.arguments)
        ? { ...(obj.arguments as Record<string, unknown>) }
        : {};
    if (typeof args.prompt !== "string" || !args.prompt.trim()) {
      args.prompt = displayText;
    }
    obj.arguments = args;
  }

  if (obj.type === "finish" && displayText) {
    const args =
      obj.arguments && typeof obj.arguments === "object" && !Array.isArray(obj.arguments)
        ? { ...(obj.arguments as Record<string, unknown>) }
        : {};
    if (typeof args.summary !== "string" || !args.summary.trim()) {
      args.summary = displayText;
    }
    obj.arguments = args;
  }

  if (obj.type === "tool.call") {
    return normalizeToolCallAction(
      obj as Parameters<typeof normalizeToolCallAction>[0],
      lookup,
    );
  }

  return obj;
}
