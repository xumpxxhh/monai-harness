import crypto from "node:crypto";

import type { Action, ToolCallInvocation, ToolEffectContract } from "@monai/contracts";

import { lookupToolContract, requiresIdempotencyKey } from "../execution/lookup-tool-contract.js";

export type ToolContractLookup = (toolId: string) => ToolEffectContract | undefined;

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

function sha256Hex(text: string): string {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * Postgres btree unique indexes reject oversized keys (~2704 bytes).
 * Keep stored idempotency / dedupe keys compact.
 */
export function compactIdempotencyKey(raw: string): string {
  if (Buffer.byteLength(raw, "utf8") <= 1024) return raw;
  return `ikh:${sha256Hex(raw)}`;
}

function deriveIdempotencyKey(toolId: string, args: unknown): string {
  return compactIdempotencyKey(`ik:${toolId}:${sha256Hex(stable(args))}`);
}

function invocationKey(inv: ToolCallInvocation): string {
  return `${inv.toolId}:${stable(inv.arguments ?? null)}`;
}

function dedupeInvocations(calls: ToolCallInvocation[]): ToolCallInvocation[] {
  const seen = new Set<string>();
  const out: ToolCallInvocation[] = [];
  for (const call of calls) {
    const key = invocationKey(call);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(call);
  }
  return out;
}

function hydrateInvocationKeys(
  inv: ToolCallInvocation,
  lookup: ToolContractLookup,
): ToolCallInvocation {
  const next = { ...inv };
  const contract = lookup(next.toolId);
  if (
    contract &&
    requiresIdempotencyKey(contract) &&
    (typeof next.idempotencyKey !== "string" || !next.idempotencyKey.trim())
  ) {
    next.idempotencyKey = deriveIdempotencyKey(next.toolId, next.arguments);
  } else if (typeof next.idempotencyKey === "string" && next.idempotencyKey.trim()) {
    next.idempotencyKey = compactIdempotencyKey(next.idempotencyKey.trim());
  }
  return next;
}

/**
 * Normalize tool.call to authoritative `calls[]` (N=1 legacy toolId lifted).
 * Pass lookup when Pack Registry is available so write_low tools get idempotency keys.
 */
export function normalizeToolCallAction(
  action: Action,
  lookup: ToolContractLookup = lookupToolContract,
): Action {
  if (action.type !== "tool.call") return action;

  let calls: ToolCallInvocation[] = [];
  if (Array.isArray(action.calls) && action.calls.length > 0) {
    calls = action.calls.map((c) => ({ ...c }));
  } else if (typeof action.toolId === "string" && action.toolId) {
    calls = [
      {
        toolId: action.toolId,
        arguments: action.arguments,
        resourceScope: action.resourceScope,
        idempotencyKey: action.idempotencyKey,
      },
    ];
  }

  calls = dedupeInvocations(calls.map((c) => hydrateInvocationKeys(c, lookup)));

  const first = calls[0];
  return {
    ...action,
    calls,
    toolId: first?.toolId,
    arguments: first?.arguments,
    resourceScope: first?.resourceScope,
    idempotencyKey: first?.idempotencyKey,
  };
}

export function getToolCallInvocations(
  action: Action,
  lookup?: ToolContractLookup,
): ToolCallInvocation[] {
  if (action.type !== "tool.call") return [];
  const normalized = normalizeToolCallAction(action, lookup);
  return normalized.calls ?? [];
}
