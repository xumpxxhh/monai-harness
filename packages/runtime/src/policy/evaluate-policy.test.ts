import { CONTRACTS_SCHEMA_VERSION, type Action } from "@monai/contracts";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_REQUIRE_APPROVAL_TOOLS,
  DEFAULT_TOOL_ALLOWLIST,
  evaluatePolicy,
} from "./evaluate-policy.js";

function action(partial: Partial<Action> & Pick<Action, "type" | "actionId">): Action {
  return {
    schemaVersion: CONTRACTS_SCHEMA_VERSION,
    ...partial,
  };
}

describe("evaluatePolicy", () => {
  it("allows noop and finish", () => {
    expect(
      evaluatePolicy({
        action: action({ actionId: "a1", type: "noop" }),
        toolAllowlist: DEFAULT_TOOL_ALLOWLIST,
      }).decision,
    ).toBe("allow");
    expect(
      evaluatePolicy({
        action: action({ actionId: "a2", type: "finish" }),
        toolAllowlist: DEFAULT_TOOL_ALLOWLIST,
      }).decision,
    ).toBe("allow");
  });

  it("denies tool not on allowlist", () => {
    const result = evaluatePolicy({
      action: action({ actionId: "a3", type: "tool.call", toolId: "forbidden.tool" }),
      toolAllowlist: DEFAULT_TOOL_ALLOWLIST,
    });
    expect(result.decision).toBe("deny");
    expect(result.reason).toContain("allowlist");
  });

  it("requires approval for listed tools", () => {
    const result = evaluatePolicy({
      action: action({
        actionId: "a4",
        type: "tool.call",
        toolId: "risky.write",
        idempotencyKey: "k1",
      }),
      toolAllowlist: DEFAULT_TOOL_ALLOWLIST,
      requireApprovalTools: DEFAULT_REQUIRE_APPROVAL_TOOLS,
    });
    expect(result.decision).toBe("require_approval");
  });

  it("allows readonly echo", () => {
    const result = evaluatePolicy({
      action: action({ actionId: "a5", type: "tool.call", toolId: "echo" }),
      toolAllowlist: DEFAULT_TOOL_ALLOWLIST,
    });
    expect(result.decision).toBe("allow");
  });

  it("denies spawn_child in MVP", () => {
    const result = evaluatePolicy({
      action: action({
        actionId: "a6",
        type: "spawn_child",
        childSpec: { goal: "x", delegationScope: {} },
      }),
      toolAllowlist: DEFAULT_TOOL_ALLOWLIST,
    });
    expect(result.decision).toBe("deny");
  });

  it("allows ask_user (Engine waits for input)", () => {
    const result = evaluatePolicy({
      action: action({ actionId: "a7", type: "ask_user", arguments: { prompt: "x" } }),
      toolAllowlist: DEFAULT_TOOL_ALLOWLIST,
    });
    expect(result.decision).toBe("allow");
  });
});
