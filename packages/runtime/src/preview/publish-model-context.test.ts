import { describe, expect, it } from "vitest";

import { buildModelContextMessages } from "./publish-model-context.js";

describe("buildModelContextMessages", () => {
  const inputMessages = [
    { role: "user" as const, content: "write a file" },
    {
      role: "assistant" as const,
      content: "calling tool",
      toolCalls: [
        {
          id: "call-0",
          type: "function" as const,
          function: { name: "artifact.write_markdown", arguments: "{}" },
        },
      ],
    },
    { role: "tool" as const, content: '{"artifactId":"art-1"}', toolCallId: "call-0" },
  ];

  it("appends assistant response after tool result", () => {
    const messages = buildModelContextMessages({
      messages: inputMessages,
      action: {
        type: "finish",
        actionId: "act-1",
        displayText: "Done writing the file.",
        schemaVersion: "0.1.0",
      },
    });

    expect(messages).toHaveLength(4);
    expect(messages[3]).toEqual({
      role: "assistant",
      content: "Done writing the file.",
    });
  });

  it("keeps input-only messages when there is no response", () => {
    const messages = buildModelContextMessages({ messages: inputMessages });
    expect(messages).toEqual(inputMessages);
  });
});
