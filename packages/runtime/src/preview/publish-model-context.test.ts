import { describe, expect, it, vi } from "vitest";

import type { ModelDecision } from "@monai/ports";

import { PreviewHub } from "./preview-hub.js";
import { publishModelContext } from "./publish-model-context.js";

describe("publishModelContext", () => {
  it("publishes wire request and model response without messages", () => {
    const hub = new PreviewHub();
    const listener = vi.fn();
    hub.subscribeAll(listener);

    const response: ModelDecision = {
      content: "正在读取",
      calls: [{ name: "workspace_read", arguments: { path: "/readme.md" } }],
      reasoning: "need file",
      target: "gpt-4o",
      finishReason: "tool_calls",
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    };

    publishModelContext(hub, {
      runId: "run-1",
      stepId: "step-1",
      modelCallId: "mc-1",
      contextHash: "hash-1",
      status: "committed",
      request: {
        url: "https://api.example/v1/chat/completions",
        body: {
          model: "gpt-4o",
          stream: true,
          messages: [{ role: "user", content: "hi" }],
          tools: [],
        },
      },
      response,
    });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]![0]).toEqual({
      type: "model_context",
      runId: "run-1",
      stepId: "step-1",
      modelCallId: "mc-1",
      contextHash: "hash-1",
      status: "committed",
      request: {
        url: "https://api.example/v1/chat/completions",
        body: {
          model: "gpt-4o",
          stream: true,
          messages: [{ role: "user", content: "hi" }],
          tools: [],
        },
      },
      response,
    });
    expect(listener.mock.calls[0]![0]).not.toHaveProperty("messages");
  });

  it("publishes failed status with reason and optional request only", () => {
    const hub = new PreviewHub();
    const listener = vi.fn();
    hub.subscribeAll(listener);

    publishModelContext(hub, {
      runId: "run-1",
      stepId: "step-1",
      modelCallId: "mc-1",
      contextHash: "hash-1",
      status: "failed",
      request: { url: "https://api.example/v1/chat/completions", body: { model: "x" } },
      reason: "OpenAI model HTTP 401 error",
    });

    expect(listener.mock.calls[0]![0]).toMatchObject({
      type: "model_context",
      status: "failed",
      reason: "OpenAI model HTTP 401 error",
      request: { url: "https://api.example/v1/chat/completions", body: { model: "x" } },
    });
    expect(listener.mock.calls[0]![0]).not.toHaveProperty("response");
  });
});
