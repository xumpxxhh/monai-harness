import type { Action, PolicyDecision, ToolCallInvocation } from "@monai/contracts";

import { getToolCallInvocations, normalizeToolCallAction } from "../model/normalize-action.js";

export type PolicyRuleInput = {
  action: Action;
  /** Agent tool allowlist; empty means only non-tool actions may pass. */
  toolAllowlist: readonly string[];
  /** Tools that require approval even when allowlisted. */
  requireApprovalTools?: readonly string[];
  /** Tools denied even if somehow listed (defense in depth). */
  deniedTools?: readonly string[];
  policyVersion?: string;
};

export type CallPolicyResult = {
  callIndex: number;
  toolId: string;
  decision: PolicyDecision;
  reason: string;
};

export type ActionBatchDecision =
  | "all_allow"
  | "partial"
  | "all_deny"
  | "require_approval";

export type PolicyEvaluation = {
  decision: PolicyDecision;
  policyVersion: string;
  reason: string;
  inputSummary: {
    actionType: string;
    toolId?: string;
    toolIds?: string[];
    actionId: string;
  };
  /** Present for tool.call batches. */
  actionDecision?: ActionBatchDecision;
  callResults?: CallPolicyResult[];
  /** Indices into normalized calls[] that may be prepared. */
  allowedCallIndices?: number[];
};

const READONLY_TOOLS = new Set(["echo", "workspace.read"]);

export function isReadonlyTool(toolId: string): boolean {
  return READONLY_TOOLS.has(toolId);
}

function evaluateSingleTool(
  toolId: string,
  input: PolicyRuleInput,
): { decision: PolicyDecision; reason: string } {
  if (input.deniedTools?.includes(toolId)) {
    return { decision: "deny", reason: `tool explicitly denied: ${toolId}` };
  }
  if (!input.toolAllowlist.includes(toolId)) {
    return { decision: "deny", reason: `tool not in allowlist: ${toolId}` };
  }
  if (input.requireApprovalTools?.includes(toolId)) {
    return { decision: "require_approval", reason: `tool requires approval: ${toolId}` };
  }
  return { decision: "allow", reason: `tool allowed: ${toolId}` };
}

function evaluateToolBatch(
  invocations: ToolCallInvocation[],
  input: PolicyRuleInput,
  policyVersion: string,
  baseSummary: PolicyEvaluation["inputSummary"],
): PolicyEvaluation {
  const callResults: CallPolicyResult[] = invocations.map((inv, callIndex) => {
    const { decision, reason } = evaluateSingleTool(inv.toolId, input);
    return { callIndex, toolId: inv.toolId, decision, reason };
  });

  const hasRequireApproval = callResults.some((r) => r.decision === "require_approval");
  const allowCount = callResults.filter((r) => r.decision === "allow").length;
  const denyCount = callResults.filter((r) => r.decision === "deny").length;

  let actionDecision: ActionBatchDecision;
  let decision: PolicyDecision;
  let reason: string;

  if (hasRequireApproval) {
    actionDecision = "require_approval";
    decision = "require_approval";
    const pending = callResults.find((r) => r.decision === "require_approval");
    reason = pending?.reason ?? "batch requires approval";
  } else if (allowCount === 0) {
    actionDecision = "all_deny";
    decision = "deny";
    reason = callResults.map((r) => r.reason).join("; ");
  } else if (denyCount === 0) {
    actionDecision = "all_allow";
    decision = "allow";
    reason = "all tools in batch allowed";
  } else {
    actionDecision = "partial";
    decision = "allow";
    reason = `partial allow: ${allowCount}/${callResults.length} tools`;
  }

  const allowedCallIndices = callResults
    .filter((r) => r.decision === "allow")
    .map((r) => r.callIndex);

  return {
    decision,
    policyVersion,
    reason,
    inputSummary: {
      ...baseSummary,
      toolIds: invocations.map((i) => i.toolId),
    },
    actionDecision,
    callResults,
    allowedCallIndices,
  };
}

/**
 * Deterministic Policy evaluator (L0-pure).
 * Returns allow | deny | require_approval — never writes State or Events.
 */
export function evaluatePolicy(input: PolicyRuleInput): PolicyEvaluation {
  const policyVersion = input.policyVersion ?? "policy.stub/0.1.0";
  const action = normalizeToolCallAction(input.action);
  const inputSummary = {
    actionType: action.type,
    toolId: action.toolId,
    actionId: action.actionId,
  };

  if (action.type === "spawn_child") {
    return {
      decision: "deny",
      policyVersion,
      reason: "spawn_child disabled in MVP (EDR-014)",
      inputSummary,
    };
  }

  if (action.type === "ask_user") {
    return {
      decision: "allow",
      policyVersion,
      reason: "ask_user allowed; Engine enters awaiting_input",
      inputSummary,
    };
  }

  if (action.type === "noop" || action.type === "finish") {
    return {
      decision: "allow",
      policyVersion,
      reason: `${action.type} allowed`,
      inputSummary,
    };
  }

  if (action.type === "tool.call") {
    const invocations = getToolCallInvocations(action);
    if (invocations.length === 0) {
      return {
        decision: "deny",
        policyVersion,
        reason: "tool.call requires at least one invocation",
        inputSummary,
        actionDecision: "all_deny",
        callResults: [],
        allowedCallIndices: [],
      };
    }
    if (invocations.length === 1) {
      const inv = invocations[0]!;
      const single = evaluateSingleTool(inv.toolId, input);
      const actionDecision: ActionBatchDecision =
        single.decision === "allow"
          ? "all_allow"
          : single.decision === "deny"
            ? "all_deny"
            : "require_approval";
      return {
        decision: single.decision,
        policyVersion,
        reason: single.reason,
        inputSummary: { ...inputSummary, toolId: inv.toolId, toolIds: [inv.toolId] },
        actionDecision,
        callResults: [
          {
            callIndex: 0,
            toolId: inv.toolId,
            decision: single.decision,
            reason: single.reason,
          },
        ],
        allowedCallIndices: single.decision === "allow" ? [0] : [],
      };
    }
    return evaluateToolBatch(invocations, input, policyVersion, inputSummary);
  }

  return {
    decision: "deny",
    policyVersion,
    reason: `unknown action type: ${(action as Action).type}`,
    inputSummary,
  };
}

/** Fallback when no Pack / Manifest is wired (Core stubs only). */
export const DEFAULT_TOOL_ALLOWLIST = ["echo", "risky.write"] as const;

export const DEFAULT_REQUIRE_APPROVAL_TOOLS = ["risky.write"] as const;
