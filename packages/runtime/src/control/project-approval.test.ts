import { describe, expect, it } from "vitest";
import { CONTRACTS_SCHEMA_VERSION, type Action, type ApprovalRecord } from "@monai/contracts";

import {
  extractApprovalStepContext,
  projectApprovalDisplay,
} from "./project-approval.js";

function action(partial: Partial<Action> & Pick<Action, "type" | "actionId">): Action {
  return {
    schemaVersion: CONTRACTS_SCHEMA_VERSION,
    ...partial,
  } as Action;
}

function approval(partial: Partial<ApprovalRecord> = {}): ApprovalRecord {
  return {
    schemaVersion: CONTRACTS_SCHEMA_VERSION,
    approvalId: "apr-1",
    tenantId: "t1",
    sessionId: "s1",
    runId: "run-1",
    stepId: "step-1",
    actionId: "act-1",
    requestKind: "policy_required",
    actionDigest: "digest",
    canonicalizationVersion: "1",
    actionSchemaVersion: CONTRACTS_SCHEMA_VERSION,
    digestAlgorithm: "sha256",
    riskLevel: "high",
    evaluatedPolicyVersions: [],
    executionManifestRef: "manifest-1",
    requestedAt: new Date().toISOString(),
    expiresAt: new Date().toISOString(),
    status: "pending",
    revision: 0,
    ...partial,
  };
}

describe("projectApprovalDisplay", () => {
  it("shows goal, intent, policy reason, tool args, and risk", () => {
    const lines = projectApprovalDisplay({
      goal: "写入高风险资源",
      action: action({
        actionId: "act-1",
        type: "tool.call",
        displayText: "准备调用 synthetic.write_high",
        calls: [
          {
            toolId: "synthetic.write_high",
            arguments: { resourceKey: "demo-key", payload: { mode: "test" } },
          },
        ],
      }),
      approval: approval(),
      policyReason: "tool requires approval: synthetic.write_high",
      reasoning: "用户要求执行高副作用写入，需要先获得审批。",
    });

    expect(lines.map((line) => line.label)).toEqual([
      "任务",
      "调用原因",
      "审批原因",
      "工具",
      "参数",
      "风险",
    ]);
    expect(lines.find((line) => line.label === "调用原因")?.value).toContain("高副作用");
    expect(lines.find((line) => line.label === "参数")?.value).toContain("demo-key");
  });

  it("prefers non-generic displayText over reasoning", () => {
    const lines = projectApprovalDisplay({
      goal: "test",
      action: action({
        actionId: "act-1",
        type: "tool.call",
        displayText: "需要写入测试环境的配置",
        calls: [{ toolId: "synthetic.write_high", arguments: {} }],
      }),
      approval: approval(),
      reasoning: "fallback reasoning",
    });

    expect(lines.find((line) => line.label === "调用原因")?.value).toBe("需要写入测试环境的配置");
  });
});

describe("extractApprovalStepContext", () => {
  it("reads policy and model fields from step events", () => {
    const context = extractApprovalStepContext(
      [
        {
          schemaVersion: CONTRACTS_SCHEMA_VERSION,
          eventId: "e1",
          eventType: "model.responded",
          tenantId: "t1",
          sessionId: "s1",
          runId: "run-1",
          stepId: "step-1",
          occurredAt: new Date().toISOString(),
          correlationId: "c1",
          producer: { type: "engine", id: "runtime" },
          hash: "h1",
          expectedRevision: 1,
          sequence: 1,
          recordedAt: new Date().toISOString(),
          payload: {
            reasoning: "需要先审批",
            display: "准备调用 synthetic.write_high",
          },
        },
        {
          schemaVersion: CONTRACTS_SCHEMA_VERSION,
          eventId: "e2",
          eventType: "policy.evaluated",
          tenantId: "t1",
          sessionId: "s1",
          runId: "run-1",
          stepId: "step-1",
          occurredAt: new Date().toISOString(),
          correlationId: "c1",
          producer: { type: "engine", id: "runtime" },
          hash: "h2",
          expectedRevision: 1,
          sequence: 2,
          recordedAt: new Date().toISOString(),
          payload: { reason: "tool requires approval: synthetic.write_high" },
        },
      ],
      "step-1",
    );

    expect(context.reasoning).toBe("需要先审批");
    expect(context.policyReason).toContain("synthetic.write_high");
  });
});
