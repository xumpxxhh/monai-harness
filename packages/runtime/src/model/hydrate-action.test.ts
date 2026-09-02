import { describe, expect, it } from "vitest";

import { buildAgentSystemPrompt } from "./agent-system-prompt.js";
import { hydrateModelAction } from "./hydrate-action.js";
import {
  buildModelFunctionCatalog,
  isControlFunctionName,
} from "./function-catalog.js";
import { mapModelDecisionToAction, resolveModelActionCandidate } from "./map-decision.js";

describe("buildAgentSystemPrompt", () => {
  it("describes function calling and control vs domain exclusivity", () => {
    const prompt = buildAgentSystemPrompt();
    expect(prompt).toContain("ask_user");
    expect(prompt).toContain("finish");
    expect(prompt).toContain("one or more function calls");
    expect(prompt).not.toContain("schemaVersion");
    expect(prompt).not.toContain("userMessage");
  });
});

describe("buildModelFunctionCatalog", () => {
  it("splits reserved control functions from allowlisted domain tools", () => {
    const catalog = buildModelFunctionCatalog({
      toolAllowlist: ["workspace.read", "echo", "ask_user"],
    });
    expect(catalog.controlFunctions.map((d) => d.name)).toEqual([
      "ask_user",
      "finish",
      "noop",
    ]);
    expect(catalog.domainTools.map((d) => d.name)).toEqual(["workspace.read", "echo"]);
    expect(catalog.controlFunctions.every((d) => d.kind === "control")).toBe(true);
    expect(catalog.domainTools.every((d) => d.kind === "domain")).toBe(true);
  });

  it("requires path and content for workspace.write", () => {
    const catalog = buildModelFunctionCatalog({
      toolAllowlist: ["workspace.write"],
    });
    const def = catalog.domainTools[0];
    expect(def?.name).toBe("workspace.write");
    expect(def?.parameters).toMatchObject({ required: ["path", "content"] });
  });

  it("includes spawn_child only when enabled", () => {
    const off = buildModelFunctionCatalog({ toolAllowlist: [] });
    expect(off.controlFunctions.some((d) => d.name === "spawn_child")).toBe(false);
    const on = buildModelFunctionCatalog({ toolAllowlist: [], includeSpawnChild: true });
    expect(on.controlFunctions.some((d) => d.name === "spawn_child")).toBe(true);
  });
});

describe("mapModelDecisionToAction", () => {
  const ready = { lastFactId: "f1", hasUnresolvedTools: false };
  const empty = { lastFactId: undefined, hasUnresolvedTools: false };

  it("maps content-only to finish when facts exist and tools are resolved", () => {
    const mapped = mapModelDecisionToAction(
      { content: "总结如下。", calls: [] },
      ready,
    );
    expect(mapped.ok).toBe(true);
    if (!mapped.ok) return;
    expect(mapped.action).toMatchObject({
      type: "finish",
      displayText: "总结如下。",
      arguments: { summary: "总结如下。" },
    });
  });

  it("maps content-only to implicit finish without facts when tools are resolved", () => {
    const mapped = mapModelDecisionToAction({ content: "工具列表如下。", calls: [] }, empty);
    expect(mapped.ok).toBe(true);
    if (!mapped.ok) return;
    expect(mapped.action).toMatchObject({
      type: "finish",
      displayText: "工具列表如下。",
      arguments: { summary: "工具列表如下。" },
    });
  });

  it("rejects empty content-only with no function calls", () => {
    const mapped = mapModelDecisionToAction({ content: "  ", calls: [] }, empty);
    expect(mapped.ok).toBe(false);
    if (mapped.ok) return;
    expect(mapped.reason).toContain("empty reply");
  });

  it("rejects content-only when tools are unresolved", () => {
    const mapped = mapModelDecisionToAction(
      { content: "还在跑", calls: [] },
      { lastFactId: "f1", hasUnresolvedTools: true },
    );
    expect(mapped.ok).toBe(false);
  });

  it("maps a control function", () => {
    const mapped = mapModelDecisionToAction(
      {
        content: "确认范围？",
        calls: [{ name: "ask_user", arguments: { prompt: "确认范围？" } }],
      },
      empty,
    );
    expect(mapped.ok).toBe(true);
    if (!mapped.ok) return;
    expect(mapped.action).toMatchObject({
      type: "ask_user",
      displayText: "确认范围？",
    });
  });

  it("maps explicit finish without requiring facts", () => {
    const mapped = mapModelDecisionToAction(
      { calls: [{ name: "finish", arguments: { summary: "done" } }] },
      empty,
    );
    expect(mapped.ok).toBe(true);
    if (!mapped.ok) return;
    expect(mapped.action).toMatchObject({ type: "finish" });
  });

  it("maps a single domain tool into calls batch", () => {
    const mapped = mapModelDecisionToAction(
      {
        content: "正在读取",
        calls: [{ name: "workspace.read", arguments: { path: "/readme.md" } }],
      },
      empty,
    );
    expect(mapped.ok).toBe(true);
    if (!mapped.ok) return;
    expect(mapped.action).toMatchObject({
      type: "tool.call",
      calls: [{ toolId: "workspace.read", arguments: { path: "/readme.md" } }],
      displayText: "正在读取",
    });
  });

  it("maps multiple domain tools into one batch action", () => {
    const mapped = mapModelDecisionToAction(
      {
        calls: [
          { name: "workspace.read", arguments: { path: "/a" } },
          { name: "workspace.read", arguments: { path: "/b" } },
        ],
      },
      empty,
    );
    expect(mapped.ok).toBe(true);
    if (!mapped.ok) return;
    expect(mapped.action).toMatchObject({
      type: "tool.call",
      calls: [
        { toolId: "workspace.read", arguments: { path: "/a" } },
        { toolId: "workspace.read", arguments: { path: "/b" } },
      ],
    });
  });

  it("rejects mixed control and domain calls", () => {
    const mapped = mapModelDecisionToAction(
      {
        calls: [
          { name: "workspace.read", arguments: { path: "/a" } },
          { name: "finish", arguments: { summary: "done" } },
        ],
      },
      empty,
    );
    expect(mapped.ok).toBe(false);
    if (mapped.ok) return;
    expect(mapped.reason).toContain("mixed");
  });

  it("maps unknown names as tool.call so Policy can deny", () => {
    const mapped = mapModelDecisionToAction(
      { calls: [{ name: "forbidden.tool", arguments: {} }] },
      empty,
    );
    expect(mapped.ok).toBe(true);
    if (!mapped.ok) return;
    expect(mapped.action).toMatchObject({
      type: "tool.call",
      calls: [{ toolId: "forbidden.tool", arguments: {} }],
    });
  });

  it("treats reserved names as control even if they look like tools", () => {
    expect(isControlFunctionName("finish")).toBe(true);
  });
});

describe("resolveModelActionCandidate", () => {
  it("hydrates Action-shaped eval stubs", () => {
    const resolved = resolveModelActionCandidate(
      { type: "noop" },
      { hasUnresolvedTools: false },
    );
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.candidate).toMatchObject({ type: "noop", schemaVersion: "0.1.0" });
  });

  it("maps ModelDecision and hydrates identity", () => {
    const resolved = resolveModelActionCandidate(
      {
        content: "读文件",
        calls: [{ name: "workspace.read", arguments: { path: "/x" } }],
        usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
      },
      { hasUnresolvedTools: false },
    );
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.candidate).toMatchObject({
      type: "tool.call",
      calls: [{ toolId: "workspace.read", arguments: { path: "/x" } }],
      displayText: "读文件",
    });
    expect((resolved.candidate as { actionId: string }).actionId.startsWith("act-")).toBe(true);
    expect(resolved.usage?.totalTokens).toBe(3);
  });
});

describe("hydrateModelAction", () => {
  it("stamps schemaVersion and a fresh actionId", () => {
    const hydrated = hydrateModelAction({ type: "noop" }) as {
      schemaVersion: string;
      actionId: string;
      type: string;
    };
    expect(hydrated.type).toBe("noop");
    expect(hydrated.schemaVersion).toBe("0.1.0");
    expect(hydrated.actionId.startsWith("act-")).toBe(true);
  });

  it("overwrites model-supplied identity fields", () => {
    const hydrated = hydrateModelAction({
      schemaVersion: "9.9.9",
      actionId: "act-from-model",
      type: "finish",
      displayText: "done",
    }) as {
      schemaVersion: string;
      actionId: string;
      arguments?: { summary?: string };
      displayText: string;
    };
    expect(hydrated.schemaVersion).toBe("0.1.0");
    expect(hydrated.actionId).not.toBe("act-from-model");
    expect(hydrated.displayText).toBe("done");
    expect(hydrated.arguments?.summary).toBe("done");
  });

  it("mirrors displayText into ask_user arguments.prompt", () => {
    const hydrated = hydrateModelAction({
      type: "ask_user",
      displayText: "确认？",
    }) as { arguments?: { prompt?: string } };
    expect(hydrated.arguments?.prompt).toBe("确认？");
  });

  it("normalizes legacy toolId into calls[]", () => {
    const hydrated = hydrateModelAction({
      type: "tool.call",
      toolId: "workspace.list",
      arguments: { path: "/" },
    }) as { calls?: Array<{ toolId: string }> };
    expect(hydrated.calls?.[0]?.toolId).toBe("workspace.list");
  });

  it("derives idempotencyKey for write tools when missing", () => {
    const hydrated = hydrateModelAction({
      type: "tool.call",
      toolId: "artifact.write_markdown",
      arguments: { markdown: "# hi" },
    }) as { calls?: Array<{ idempotencyKey?: string }> };
    expect(hydrated.calls?.[0]?.idempotencyKey).toContain("artifact.write_markdown");
  });

  it("derives idempotencyKey for workspace.write", () => {
    const hydrated = hydrateModelAction({
      type: "tool.call",
      toolId: "workspace.write",
      arguments: { path: "/notes/out.md", content: "hi" },
    }) as { calls?: Array<{ toolId?: string; idempotencyKey?: string }> };
    expect(hydrated.calls?.[0]?.toolId).toBe("workspace.write");
    expect(hydrated.calls?.[0]?.idempotencyKey).toContain("workspace.write");
  });

  it("does not invent idempotencyKey for read tools", () => {
    const hydrated = hydrateModelAction({
      type: "tool.call",
      toolId: "workspace.list",
      arguments: { path: "/" },
    }) as { calls?: Array<{ idempotencyKey?: string }> };
    expect(hydrated.calls?.[0]?.idempotencyKey).toBeUndefined();
  });
});
