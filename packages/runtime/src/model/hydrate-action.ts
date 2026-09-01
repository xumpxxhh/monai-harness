import { randomUUID } from "node:crypto";

import { CONTRACTS_SCHEMA_VERSION } from "@monai/contracts";

import { lookupToolContract, requiresIdempotencyKey } from "../execution/lookup-tool-contract.js";

function stable(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stable(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stable(record[key])}`).join(",")}}`;
}

/**
 * Hydrate model JSON into an Action candidate before schema validation.
 * Runtime owns schemaVersion / actionId / optional idempotencyKey.
 */
export function hydrateModelAction(raw: unknown): unknown {
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

  if (
    obj.type === "tool.call" &&
    typeof obj.toolId === "string" &&
    (typeof obj.idempotencyKey !== "string" || !obj.idempotencyKey.trim())
  ) {
    const contract = lookupToolContract(obj.toolId);
    if (contract && requiresIdempotencyKey(contract)) {
      obj.idempotencyKey = `ik:${obj.toolId}:${stable(obj.arguments)}`;
    }
  }

  return obj;
}
