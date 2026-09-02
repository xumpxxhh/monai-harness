import type { Action, ToolCallInvocation } from "@monai/contracts";

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

function hydrateInvocationKeys(inv: ToolCallInvocation): ToolCallInvocation {
  const next = { ...inv };
  const contract = lookupToolContract(next.toolId);
  if (
    contract &&
    requiresIdempotencyKey(contract) &&
    (typeof next.idempotencyKey !== "string" || !next.idempotencyKey.trim())
  ) {
    next.idempotencyKey = `ik:${next.toolId}:${stable(next.arguments)}`;
  }
  return next;
}

/**
 * Normalize tool.call to authoritative `calls[]` (N=1 legacy toolId lifted).
 */
export function normalizeToolCallAction(action: Action): Action {
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

  calls = dedupeInvocations(calls.map(hydrateInvocationKeys));

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

export function getToolCallInvocations(action: Action): ToolCallInvocation[] {
  if (action.type !== "tool.call") return [];
  const normalized = normalizeToolCallAction(action);
  return normalized.calls ?? [];
}
