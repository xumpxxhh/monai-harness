import { describe, expect, it } from "vitest";
import { createEmptyRunState, createInitialRun } from "@monai/contracts";
import { buildContext, formatRecentFacts } from "./build-context.js";

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
    const toolsSection = result.sections.find((s) => s.kind === "tools");
    expect(toolsSection?.text).toContain("workspace.read");
    expect(toolsSection?.text).toContain('args: {"path":"/file.md"}');
    expect(toolsSection?.text).toContain("workspace.write");
    expect(toolsSection?.text).toContain('args: {"path":"/file.md","content":"..."}');
  });

  it("formats workspace.list facts in recent_events for the model", () => {
    const stateWithList = {
      ...state,
      facts: [
        {
          factId: "f-list",
          factType: "tool.result",
          summary: "list /",
          data: {
            path: "/",
            entries: [
              { kind: "directory", name: "notes", path: "/notes" },
              { kind: "file", name: "readme.md", path: "/readme.md" },
            ],
            summary: "list /",
          },
        },
      ],
    };

    const result = buildContext({
      run,
      stepId: "step-2",
      state: stateWithList,
      toolAllowlist: ["workspace.list", "workspace.read"],
    });

    const recent = result.sections.find((s) => s.kind === "recent_events");
    expect(recent?.text).toContain("Recent Facts");
    expect(recent?.text).toContain("do not re-call");
    expect(recent?.text).toContain("/notes");
    expect(recent?.text).toContain("/readme.md");
    expect(recent?.text).not.toMatch(/Recent Facts: \[\{/);
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

  it("formats knowledge search hits with sourceId and content preview", () => {
    const stateWithKnowledge = {
      ...state,
      facts: [
        {
          factId: "f-kb",
          factType: "tool.result",
          summary: "knowledge search test",
          data: {
            query: "什么是知识库",
            hits: [
              {
                sourceId: "intro.md",
                title: "RAG 入门",
                content: "知识库是用于存储与检索的结构化资料。",
              },
            ],
            grounding: { empty: false },
          },
        },
      ],
    };

    const result = buildContext({
      run,
      stepId: "step-kb",
      state: stateWithKnowledge,
      toolAllowlist: ["knowledge.search"],
    });

    const recent = result.sections.find((s) => s.kind === "recent_events");
    expect(recent?.text).toContain("[intro.md]");
    expect(recent?.text).toContain("知识库");
  });
});

describe("formatRecentFacts", () => {
  it("returns empty string for no facts", () => {
    expect(formatRecentFacts([])).toBe("");
  });

  it("projects list entries instead of raw JSON blob", () => {
    const text = formatRecentFacts([
      {
        factId: "f1",
        factType: "tool.result",
        summary: "list /",
        data: {
          path: "/",
          entries: [{ kind: "file", name: "a.md", path: "/a.md" }],
        },
      },
    ]);
    expect(text).toContain("path: /");
    expect(text).toContain("file: /a.md");
  });
});
