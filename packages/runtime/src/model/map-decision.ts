import { ACTION_TYPES, type ActionType } from "@monai/contracts";
import type { ModelDecision, ModelFunctionCall } from "@monai/ports";

import { hydrateModelAction } from "./hydrate-action.js";
import { isControlFunctionName } from "./function-catalog.js";

export type MapDecisionContext = {
  lastFactId?: string;
  hasUnresolvedTools: boolean;
};

export type MapDecisionSuccess = {
  ok: true;
  action: unknown;
};

export type MapDecisionFailure = {
  ok: false;
  reason: string;
};

export type MapDecisionResult = MapDecisionSuccess | MapDecisionFailure;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function displayTextOf(decision: ModelDecision): string | undefined {
  const text = decision.content?.trim();
  return text ? text : undefined;
}

function callArguments(call: ModelFunctionCall): Record<string, unknown> {
  const rec = asRecord(call.arguments);
  return rec ? { ...rec } : {};
}

function isActionShaped(value: unknown): boolean {
  const rec = asRecord(value);
  if (!rec) return false;
  return typeof rec.type === "string" && (ACTION_TYPES as readonly string[]).includes(rec.type);
}

function asModelDecision(value: unknown): ModelDecision | undefined {
  const rec = asRecord(value);
  if (!rec) return undefined;
  if (Array.isArray(rec.calls)) {
    return {
      content: typeof rec.content === "string" ? rec.content : undefined,
      calls: rec.calls as ModelFunctionCall[],
    };
  }
  if (typeof rec.content === "string" && rec.type === undefined && rec.rawAction === undefined) {
    return { content: rec.content, calls: [] };
  }
  return undefined;
}

function mapControlCall(call: ModelFunctionCall, displayText?: string): unknown {
  const name = call.name;
  const args = callArguments(call);

  if (name === "spawn_child") {
    const goal = typeof args.goal === "string" ? args.goal : displayText ?? "";
    return {
      type: "spawn_child" satisfies ActionType,
      displayText,
      arguments: args,
      childSpec: {
        goal,
        ...(typeof args.inputRef === "string" ? { inputRef: args.inputRef } : {}),
        delegationScope: args.delegationScope ?? {},
        ...(args.strategy !== undefined ? { strategy: args.strategy } : {}),
      },
    };
  }

  return {
    type: name,
    displayText,
    arguments: Object.keys(args).length > 0 ? args : undefined,
  };
}

/**
 * Map a vendor-neutral ModelDecision to an unhydrated Action candidate.
 * Control XOR domain batch; substantive content-only maps to implicit finish when tools are resolved.
 */
export function mapModelDecisionToAction(
  decision: ModelDecision,
  ctx: MapDecisionContext,
): MapDecisionResult {
  const calls = decision.calls ?? [];
  const displayText = displayTextOf(decision);

  if (calls.length === 0) {
    if (ctx.hasUnresolvedTools) {
      return {
        ok: false,
        reason: "incomplete decision: content-only reply requires no unresolved tools",
      };
    }
    if (!displayText) {
      return {
        ok: false,
        reason: "incomplete decision: empty reply with no function calls",
      };
    }
    return {
      ok: true,
      action: {
        type: "finish" satisfies ActionType,
        displayText,
        arguments: { summary: displayText },
      },
    };
  }

  const controlCalls = calls.filter((c) => c.name && isControlFunctionName(c.name));
  const domainCalls = calls.filter((c) => c.name && !isControlFunctionName(c.name));

  if (controlCalls.length > 0 && domainCalls.length > 0) {
    return { ok: false, reason: "control and domain function calls cannot be mixed" };
  }
  if (controlCalls.length > 1) {
    return { ok: false, reason: "expected exactly one control function call" };
  }
  if (controlCalls.length === 1) {
    const call = controlCalls[0]!;
    if (!call.name || typeof call.name !== "string") {
      return { ok: false, reason: "function call missing name" };
    }
    return { ok: true, action: mapControlCall(call, displayText) };
  }

  if (domainCalls.length === 0) {
    return { ok: false, reason: "function call missing name" };
  }

  for (const call of domainCalls) {
    if (!call.name || typeof call.name !== "string") {
      return { ok: false, reason: "function call missing name" };
    }
  }

  return {
    ok: true,
    action: {
      type: "tool.call" satisfies ActionType,
      calls: domainCalls.map((call) => ({
        toolId: call.name!,
        arguments: call.arguments,
      })),
      displayText,
    },
  };
}

export type ResolveModelActionResult =
  | {
      ok: true;
      candidate: unknown;
      usage?: ModelDecision["usage"];
      reasoning?: string;
      content?: string;
    }
  | {
      ok: false;
      reason: string;
      usage?: ModelDecision["usage"];
      reasoning?: string;
      content?: string;
    };

function envelopeMeta(value: unknown): Pick<ModelDecision, "usage" | "reasoning" | "content"> {
  const rec = asRecord(value);
  if (!rec) return {};
  return {
    usage: rec.usage as ModelDecision["usage"],
    reasoning: typeof rec.reasoning === "string" ? rec.reasoning : undefined,
    content: typeof rec.content === "string" ? rec.content : undefined,
  };
}

/**
 * Accept ModelDecision, legacy `{ rawAction }`, or Action-shaped eval stubs.
 */
export function resolveModelActionCandidate(
  modelResult: unknown,
  ctx: MapDecisionContext,
): ResolveModelActionResult {
  const meta = envelopeMeta(modelResult);
  if (!modelResult || typeof modelResult !== "object") {
    return { ok: false, reason: "empty model result", ...meta };
  }

  const rec = asRecord(modelResult)!;
  const inner = rec.rawAction !== undefined ? rec.rawAction : modelResult;

  if (isActionShaped(inner)) {
    return { ok: true, candidate: hydrateModelAction(inner), ...meta };
  }

  const decision = asModelDecision(modelResult) ?? asModelDecision(inner);
  if (!decision) {
    return { ok: false, reason: "unrecognized model result", ...meta };
  }

  const mapped = mapModelDecisionToAction(decision, ctx);
  if (!mapped.ok) {
    return { ok: false, reason: mapped.reason, ...meta };
  }
  return {
    ok: true,
    candidate: hydrateModelAction(mapped.action),
    ...meta,
    content: decision.content ?? meta.content,
  };
}
