import { describe, expect, it } from "vitest";
import type { ContextCompressionRecord, DialogueTurn } from "@monai/contracts";

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

  it("builds multi-message wire format with history summary", () => {
    const compression: ContextCompressionRecord = {
      compressionId: "cmp-1",
      summaryHash: "hash",
      summaryText: "Earlier user asked hello.",
      sourceRunIds: ["run-0"],
      sourceEventRanges: [{ runId: "run-0", fromSequence: 1, toSequence: 5 }],
      createdAt: new Date().toISOString(),
    };

    const result = projectModelMessages({
      systemPrompt: "You are an agent.",
      sections: [
        {
          kind: "safety_boundary",
          text: "Tenant t1",
          hash: "h1",
          tokenCount: 1,
        },
      ],
      recentTurns,
      compression,
    });

    expect(result.messages[0]?.role).toBe("system");
    expect(result.messages.some((m) => m.content?.includes("history summary"))).toBe(true);
    expect(result.messages.filter((m) => m.role === "assistant")).toHaveLength(1);
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
