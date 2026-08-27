import type { Action, PolicyDecision } from "@monai/contracts";

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

export type PolicyEvaluation = {
  decision: PolicyDecision;
  policyVersion: string;
  reason: string;
  inputSummary: {
    actionType: string;
    toolId?: string;
    actionId: string;
  };
};

const READONLY_TOOLS = new Set(["echo", "workspace.read"]);

export function isReadonlyTool(toolId: string): boolean {
  return READONLY_TOOLS.has(toolId);
}

/**
 * Deterministic Policy evaluator (L0-pure).
 * Returns allow | deny | require_approval — never writes State or Events.
 */
export function evaluatePolicy(input: PolicyRuleInput): PolicyEvaluation {
  const policyVersion = input.policyVersion ?? "policy.stub/0.1.0";
  const { action } = input;
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
    const toolId = action.toolId;
    if (!toolId) {
      return {
        decision: "deny",
        policyVersion,
        reason: "tool.call requires toolId",
        inputSummary,
      };
    }
    if (input.deniedTools?.includes(toolId)) {
      return {
        decision: "deny",
        policyVersion,
        reason: `tool explicitly denied: ${toolId}`,
        inputSummary,
      };
    }
    if (!input.toolAllowlist.includes(toolId)) {
      return {
        decision: "deny",
        policyVersion,
        reason: `tool not in allowlist: ${toolId}`,
        inputSummary,
      };
    }
    if (input.requireApprovalTools?.includes(toolId)) {
      return {
        decision: "require_approval",
        policyVersion,
        reason: `tool requires approval: ${toolId}`,
        inputSummary,
      };
    }
    return {
      decision: "allow",
      policyVersion,
      reason: `tool allowed: ${toolId}`,
      inputSummary,
    };
  }

  return {
    decision: "deny",
    policyVersion,
    reason: `unknown action type: ${(action as Action).type}`,
    inputSummary,
  };
}

/** Default MVP allowlist for light loop demos. */
export const DEFAULT_TOOL_ALLOWLIST = [
  "echo",
  "workspace.list",
  "workspace.read",
  "workspace.search",
  "workspace.write",
  "artifact.write_markdown",
  "synthetic.write_high",
  "risky.write",
] as const;

export const DEFAULT_REQUIRE_APPROVAL_TOOLS = ["risky.write", "synthetic.write_high"] as const;
