import { describe, expect, it } from "vitest";
import { CONTRACTS_SCHEMA_VERSION, type DialogueTurn } from "@monai/contracts";
import type { ContextCompressionRecord } from "@monai/contracts";

import { projectModelMessages, assistantMessageFromAction } from "./project-messages.js";

describe("projectModelMessages", () => {
  const recentTurns: DialogueTurn[] = [
    {
      turnId: "u1",
      runId: "run-1",
      role: "user",
      content: "hello",
      sourceEventIds: [],
      sequenceRange: { from: 0, to: 0 },
    },
    {
      turnId: "a1",
      runId: "run-1",
      stepId: "step-1",
      role: "assistant",
      content: "Hi",
      reasoning: "Greet then echo.",
      toolCalls: [{ id: "tc-1", name: "echo", arguments: { text: "hello" } }],
      sourceEventIds: ["e1"],
      sequenceRange: { from: 1, to: 1 },
    },
    {
      turnId: "t1",
      runId: "run-1",
      stepId: "step-1",
      role: "tool",
      content: '{"echoed":"hello"}',
      toolCallId: "tc-1",
      toolName: "echo",
      sourceEventIds: ["e2"],
      sequenceRange: { from: 2, to: 2 },
    },
  ];

  it("builds multi-message wire format with layered system prompt", () => {
    const compression: ContextCompressionRecord = {
      compressionId: "cmp-1",
      summaryHash: "hash",
      summaryText: "Earlier user asked hello.",
      sourceRunIds: ["run-0"],
      sourceEventRanges: [{ runId: "run-0", fromSequence: 1, toSequence: 5 }],
      createdAt: new Date().toISOString(),
    };

    const result = projectModelMessages({
      identity: "You are an agent.",
      sections: [
        {
          kind: "safety_boundary",
          text: "Environment:\n- tenantId: t1",
          hash: "h1",
          tokenCount: 1,
        },
        {
          kind: "tools",
          text: "Available Tools:\n- echo | Echo text as a fact",
          hash: "h2",
          tokenCount: 1,
        },
      ],
      toolAllowlist: ["demo_pack_only"],
      toolDefs: [
        {
          toolId: "demo_pack_only",
          version: "0.1.0",
          systemPrompt: "Demo pack_only rules:\nPrefer this tool for demo queries.",
          effectContract: {
            schemaVersion: CONTRACTS_SCHEMA_VERSION,
            sideEffectProfile: "read",
            deliverySemantics: "at_most_once",
            idempotencyScope: "run",
            reconcileSupported: false,
            timeoutMs: 5_000,
          },
        },
      ],
      recentTurns,
      compression,
    });

    const system = result.messages[0];
    expect(system?.role).toBe("system");
    const systemText = system?.content ?? "";
    const safetyIdx = systemText.indexOf("[safety_boundary]");
    const identityIdx = systemText.indexOf("You are an agent.");
    const toolsIdx = systemText.indexOf("[tools]");
    const guideIdx = systemText.indexOf("Demo pack_only rules");
    expect(safetyIdx).toBeGreaterThanOrEqual(0);
    expect(identityIdx).toBeGreaterThan(safetyIdx);
    expect(toolsIdx).toBeGreaterThan(identityIdx);
    expect(guideIdx).toBeGreaterThan(toolsIdx);
    expect(result.layers.map((l) => l.kind)).toEqual([
      "safety",
      "identity",
      "catalog",
      "guidelines",
    ]);
    expect(result.messages.some((m) => m.content?.includes("history summary"))).toBe(true);
    expect(result.messages.filter((m) => m.role === "assistant")).toHaveLength(1);
    expect(result.messages.find((m) => m.role === "assistant")?.reasoning).toBe("Greet then echo.");
    expect(result.messages.filter((m) => m.role === "tool")).toHaveLength(1);
    expect(result.messagesHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("maps finish actions to content-only assistant messages", () => {
    const message = assistantMessageFromAction({
      type: "finish",
      actionId: "act-1",
      displayText: "All done.",
      schemaVersion: "0.1.0",
    });
    expect(message).toEqual({ role: "assistant", content: "All done." });
  });
});
