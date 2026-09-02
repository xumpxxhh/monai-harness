import { describe, expect, it } from "vitest";

import { buildAgentSystemPrompt } from "./agent-system-prompt.js";

describe("buildAgentSystemPrompt", () => {
  it("includes knowledge rules when knowledge.search is allowlisted", () => {
    const prompt = buildAgentSystemPrompt({
      toolAllowlist: ["workspace.read", "knowledge.search"],
    });
    expect(prompt).toContain("knowledge.search");
    expect(prompt).toContain("grounding.empty");
    expect(prompt).toContain("sourceId");
  });

  it("omits knowledge rules when tool is not allowlisted", () => {
    const prompt = buildAgentSystemPrompt({ toolAllowlist: ["workspace.read"] });
    expect(prompt).not.toContain("Knowledge base");
  });

  it("includes workspace.write rules when allowlisted", () => {
    const prompt = buildAgentSystemPrompt({
      toolAllowlist: ["workspace.read", "workspace.write"],
    });
    expect(prompt).toContain("workspace.write");
    expect(prompt).toContain("path and content are required");
  });
});
