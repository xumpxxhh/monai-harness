import { CONTRACTS_SCHEMA_VERSION, type PackToolDefinition } from "@monai/contracts";
import { describe, expect, it } from "vitest";

import { buildAgentSystemPrompt } from "./agent-system-prompt.js";
import {
  assembleSystemMessage,
  collectPackGuidelines,
} from "./assemble-system-message.js";

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
  it("describes identity and control vs domain exclusivity", () => {
    const prompt = buildAgentSystemPrompt();
    expect(prompt).toContain("You are an agent");
    expect(prompt).toContain("ask_user");
    expect(prompt).toContain("finish");
    expect(prompt).toContain("never mix control with domain tools");
    expect(prompt).not.toContain("schemaVersion");
    expect(prompt).not.toContain("userMessage");
  });

  it("omits spawn_child by default and includes it when enabled", () => {
    expect(buildAgentSystemPrompt()).not.toContain("spawn_child");
    expect(buildAgentSystemPrompt({ includeSpawnChild: true })).toContain("spawn_child");
  });

  it("does not hardcode Pack tool ids", () => {
    const prompt = buildAgentSystemPrompt();
    expect(prompt).not.toContain("workspace.read");
    expect(prompt).not.toContain("knowledge.search");
  });
});

describe("collectPackGuidelines / assembleSystemMessage", () => {
  it("includes Pack systemPrompt when tool is allowlisted", () => {
    const guidelines = collectPackGuidelines(
      ["workspace.read", "knowledge.search"],
      [
        def({
          toolId: "knowledge.search",
          systemPrompt: [
            "Knowledge base (knowledge.search):",
            "If grounding.empty is true, say no relevant knowledge was found; do not guess.",
            "Cite sourceId or title in your answer, e.g. [intro.md].",
          ].join("\n"),
        }),
      ],
    );
    expect(guidelines).toContain("knowledge.search");
    expect(guidelines).toContain("grounding.empty");
    expect(guidelines).toContain("sourceId");
  });

  it("omits Pack systemPrompt when tool is not allowlisted", () => {
    const guidelines = collectPackGuidelines(
      ["workspace.read"],
      [
        def({
          toolId: "knowledge.search",
          systemPrompt: "Knowledge base (knowledge.search):\nshould not appear",
        }),
      ],
    );
    expect(guidelines).toBeUndefined();
  });

  it("orders layers: safety → identity → tools → guidelines", () => {
    const assembled = assembleSystemMessage({
      identity: "You are an agent working on the user's Goal.",
      sections: [
        {
          kind: "safety_boundary",
          text: "Environment:\n- tenantId: t1",
          hash: "h1",
          tokenCount: 1,
        },
        {
          kind: "tools",
          text: "Available Tools:\n- knowledge.search | Search enterprise knowledge bases",
          hash: "h2",
          tokenCount: 1,
        },
      ],
      toolAllowlist: ["knowledge.search"],
      toolDefs: [
        def({
          toolId: "knowledge.search",
          systemPrompt: "Knowledge base (knowledge.search):\nUse for external docs.",
        }),
      ],
    });

    expect(assembled.layers.map((l) => l.kind)).toEqual([
      "safety",
      "identity",
      "catalog",
      "guidelines",
    ]);
    const safetyIdx = assembled.text.indexOf("[safety_boundary]");
    const identityIdx = assembled.text.indexOf("You are an agent");
    const toolsIdx = assembled.text.indexOf("[tools]");
    const guideIdx = assembled.text.indexOf("Knowledge base");
    expect(safetyIdx).toBeGreaterThanOrEqual(0);
    expect(identityIdx).toBeGreaterThan(safetyIdx);
    expect(toolsIdx).toBeGreaterThan(identityIdx);
    expect(guideIdx).toBeGreaterThan(toolsIdx);
  });

  it("includes workspace.write guidelines from Pack defs", () => {
    const guidelines = collectPackGuidelines(
      ["workspace.read", "workspace.write"],
      [
        def({
          toolId: "workspace.write",
          effectContract: { ...baseEffect, sideEffectProfile: "write_low" },
          systemPrompt: [
            "Workspace write (workspace.write):",
            "Prefer workspace.write when persisting text the user asked to save.",
          ].join("\n"),
        }),
      ],
    );
    expect(guidelines).toContain("workspace.write");
    expect(guidelines).toContain("persisting text");
  });
});
