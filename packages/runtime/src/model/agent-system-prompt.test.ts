import { CONTRACTS_SCHEMA_VERSION, type PackToolDefinition } from "@monai/contracts";
import { describe, expect, it } from "vitest";

import { buildAgentSystemPrompt } from "./agent-system-prompt.js";

const baseEffect = {
  schemaVersion: CONTRACTS_SCHEMA_VERSION,
  sideEffectProfile: "read" as const,
  deliverySemantics: "at_most_once" as const,
  idempotencyScope: "run" as const,
  reconcileSupported: false,
  timeoutMs: 5_000,
};

function def(partial: Partial<PackToolDefinition> & Pick<PackToolDefinition, "toolId">): PackToolDefinition {
  return {
    version: "0.1.0",
    effectContract: baseEffect,
    ...partial,
  };
}

describe("buildAgentSystemPrompt", () => {
  it("includes Pack systemPrompt when tool is allowlisted", () => {
    const prompt = buildAgentSystemPrompt({
      toolAllowlist: ["workspace.read", "knowledge.search"],
      toolDefs: [
        def({
          toolId: "knowledge.search",
          systemPrompt: [
            "Knowledge base (knowledge.search):",
            "1. Before answering factual questions that need external docs, call knowledge.search with a specific query.",
            "4. If grounding.empty is true, say no relevant knowledge was found; do not guess.",
            "3. Cite sourceId or title in your answer, e.g. [intro.md].",
          ].join("\n"),
        }),
      ],
    });
    expect(prompt).toContain("knowledge.search");
    expect(prompt).toContain("grounding.empty");
    expect(prompt).toContain("sourceId");
  });

  it("omits Pack systemPrompt when tool is not allowlisted", () => {
    const prompt = buildAgentSystemPrompt({
      toolAllowlist: ["workspace.read"],
      toolDefs: [
        def({
          toolId: "knowledge.search",
          systemPrompt: "Knowledge base (knowledge.search):\nshould not appear",
        }),
      ],
    });
    expect(prompt).not.toContain("Knowledge base");
  });

  it("includes workspace.write rules from Pack defs", () => {
    const prompt = buildAgentSystemPrompt({
      toolAllowlist: ["workspace.read", "workspace.write"],
      toolDefs: [
        def({
          toolId: "workspace.write",
          effectContract: { ...baseEffect, sideEffectProfile: "write_low" },
          systemPrompt: [
            "Workspace write (workspace.write):",
            "1. Write UTF-8 text to an absolute path under / (e.g. /notes/out.md). path and content are required.",
          ].join("\n"),
        }),
      ],
    });
    expect(prompt).toContain("workspace.write");
    expect(prompt).toContain("path and content are required");
  });
});
