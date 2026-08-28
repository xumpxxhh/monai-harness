import { describe, expect, it } from "vitest";
import { createEmptyRunState, createInitialRun } from "@monai/contracts";
import { buildContext } from "./build-context.js";

describe("buildContext", () => {
  const run = createInitialRun({
    runId: "run-ctx-test",
    tenantId: "tenant-test",
    sessionId: "session-test",
    agentDefinitionId: "agent-default",
    agentVersion: "1.0.0",
    executionManifestRef: "man-test",
    packVersions: [{ packId: "pack-test", version: "1.0.0" }],
    goal: "perform task with context builder",
    strategy: { type: "light", version: "1.0.0" },
  });

  const state = createEmptyRunState();

  it("builds context with prioritized sections and creates ContextBuildRecord", () => {
    const result = buildContext({
      run,
      stepId: "step-1",
      state,
      toolAllowlist: ["workspace.read", "workspace.write"],
    });

    expect(result.overflow).toBe(false);
    expect(result.sections.length).toBeGreaterThanOrEqual(4);
    expect(result.record.runId).toBe(run.runId);
    expect(result.record.stepId).toBe("step-1");
    expect(result.record.contextHash).toBeDefined();
    expect(result.record.selectedTools.map((t) => t.toolId)).toEqual([
      "workspace.read",
      "workspace.write",
    ]);
  });

  it("truncates low priority sections when exceeding maxTotalTokens", () => {
    const stateWithFacts = {
      ...state,
      facts: [
        {
          factId: "f-1",
          factType: "observation",
          summary: "a".repeat(400),
        },
      ],
    };

    const result = buildContext({
      run,
      stepId: "step-1",
      state: stateWithFacts,
      toolAllowlist: ["workspace.read"],
      budget: {
        maxTotalTokens: 50, // very low budget to force truncation of recent_events
      },
    });

    expect(result.truncations.length).toBeGreaterThan(0);
    expect(result.truncations.some((t) => t.sectionKind === "recent_events")).toBe(true);
  });

  it("detects overflow when hardMaxTokens is exceeded", () => {
    const result = buildContext({
      run,
      stepId: "step-1",
      state,
      toolAllowlist: ["workspace.read"],
      budget: {
        maxTotalTokens: 5,
        hardMaxTokens: 5, // Impossible to fit even safety + user input
      },
    });

    expect(result.overflow).toBe(true);
    expect(result.overflowReason).toBeDefined();
  });
});
