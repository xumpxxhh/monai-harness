import { describe, expect, it } from "vitest";
import { EnvSecretPort } from "@monai/secret-env";
import {
  extractClosedDisplayText,
  normalizeRawAction,
  OpenAiModelPort,
  resolveChatCompletionsUrl,
  splitModelOutput,
} from "./openai-model.js";

describe("resolveChatCompletionsUrl", () => {
  it("appends chat/completions to base /v1", () => {
    expect(resolveChatCompletionsUrl("https://api.dots.ai/v1")).toBe(
      "https://api.dots.ai/v1/chat/completions",
    );
  });

  it("keeps full chat/completions URL", () => {
    expect(resolveChatCompletionsUrl("https://api.dots.ai/v1/chat/completions")).toBe(
      "https://api.dots.ai/v1/chat/completions",
    );
  });
});

describe("splitModelOutput", () => {
  it("preserves think blocks and extracts JSON", () => {
    const split = splitModelOutput(
      `<think>plan first</think>\n\`\`\`json\n{"type":"noop","actionId":"a1","schemaVersion":"1"}\n\`\`\``,
    );
    expect(split.reasoning).toContain("plan first");
    expect(JSON.parse(split.jsonText)).toMatchObject({ type: "noop" });
  });

  it("extracts JSON from surrounding prose", () => {
    const split = splitModelOutput(`Here is the action:\n{"type":"finish","actionId":"a1","schemaVersion":"1"}\nThanks`);
    expect(JSON.parse(split.jsonText).type).toBe("finish");
    expect(split.reasoning).toContain("Here is the action");
  });
});

describe("extractClosedDisplayText", () => {
  it("extracts closed displayText from partial JSON", () => {
    expect(extractClosedDisplayText(`{"type":"ask_user","displayText":"确认继续？","actionId":`)).toBe(
      "确认继续？",
    );
  });

  it("returns undefined while string is open", () => {
    expect(extractClosedDisplayText(`{"displayText":"确认`)).toBeUndefined();
  });
});

describe("normalizeRawAction", () => {
  it("fills schemaVersion and actionId when omitted", () => {
    const normalized = normalizeRawAction({ type: "noop" }) as {
      schemaVersion: string;
      actionId: string;
      type: string;
    };
    expect(normalized.type).toBe("noop");
    expect(normalized.schemaVersion).toBe("0.1.0");
    expect(normalized.actionId.length).toBeGreaterThan(0);
  });

  it("preserves existing identity fields", () => {
    const normalized = normalizeRawAction({
      schemaVersion: "0.1.0",
      actionId: "act-keep",
      type: "finish",
    }) as { actionId: string };
    expect(normalized.actionId).toBe("act-keep");
  });
});

describe("OpenAiModelPort", () => {
  const secretPort = new EnvSecretPort({
    envMap: { OPENAI_API_KEY: "sk-mock-key-12345" },
  });

  it("streams SSE, keeps JSON off display channel, emits displayText + reasoning", async () => {
    let capturedUrl = "";
    let capturedBody: Record<string, unknown> = {};

    const mockFetch: typeof fetch = async (url, init) => {
      capturedUrl = String(url);
      capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;

      const chunks = [
        `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: "thinking…" } }] })}\n\n`,
        `data: ${JSON.stringify({
          choices: [
            {
              delta: {
                content:
                  '{"schemaVersion":"1.0.0","actionId":"act-1","type":"tool.call","toolId":"workspace.read","displayText":"正在读取",',
              },
            },
          ],
        })}\n\n`,
        `data: ${JSON.stringify({
          choices: [
            {
              delta: {
                content: '"arguments":{"path":"hello.txt"}}',
              },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        })}\n\n`,
        "data: [DONE]\n\n",
      ];

      const encoder = new TextEncoder();
      let i = 0;
      const stream = new ReadableStream({
        pull(controller) {
          if (i >= chunks.length) {
            controller.close();
            return;
          }
          controller.enqueue(encoder.encode(chunks[i]!));
          i += 1;
        },
      });

      return new Response(stream, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    };

    const port = new OpenAiModelPort({
      secretPort,
      baseUrl: "https://api.dots.ai/v1",
      customFetch: mockFetch,
    });

    const deltas: Array<{ channel: string; text: string }> = [];
    let doneResult: unknown;

    for await (const chunk of port.completeStructuredStream({
      context: { goal: "read hello.txt", toolAllowlist: ["workspace.read"] },
      schema: { type: "Action" },
      modelPolicy: { version: "1.0.0", resolvedTarget: "gpt-4o" },
    })) {
      if (chunk.kind === "delta") {
        deltas.push({ channel: chunk.channel, text: chunk.text });
        expect(chunk.text).not.toMatch(/\{\s*"type"/);
      } else {
        doneResult = chunk.result;
      }
    }

    expect(capturedUrl).toBe("https://api.dots.ai/v1/chat/completions");
    expect(capturedBody.stream).toBe(true);
    expect(capturedBody.response_format).toEqual({ type: "json_object" });
    const system = (capturedBody.messages as Array<{ role: string; content: string }>)[0]!.content;
    expect(system).toContain("tool.call");
    expect(system).toContain("ask_user");
    expect(system).toContain("spawn_child");
    expect(system).toContain("displayText");
    expect(system).not.toContain("userMessage");

    expect(deltas.some((d) => d.channel === "reasoning" && d.text.includes("thinking"))).toBe(true);
    expect(deltas.some((d) => d.channel === "display" && d.text.includes("正在读取"))).toBe(true);
    expect(deltas.every((d) => d.channel === "reasoning" || d.channel === "display")).toBe(true);

    expect(doneResult).toMatchObject({
      target: "gpt-4o",
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      rawAction: {
        type: "tool.call",
        toolId: "workspace.read",
        displayText: "正在读取",
      },
    });
  });

  it("omits response_format when mode is none", async () => {
    let capturedBody: Record<string, unknown> = {};
    const mockFetch: typeof fetch = async (_url, init) => {
      capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  schemaVersion: "1.0.0",
                  actionId: "a1",
                  type: "noop",
                }),
              },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };

    const port = new OpenAiModelPort({
      secretPort,
      responseFormatMode: "none",
      customFetch: mockFetch,
    });

    await port.completeStructured({
      context: { goal: "noop" },
      schema: { type: "Action" },
    });

    expect(capturedBody.response_format).toBeUndefined();
  });

  it("handles HTTP error properly", async () => {
    const mockFetch: typeof fetch = async () => {
      return new Response("Invalid API key", { status: 401 });
    };

    const port = new OpenAiModelPort({
      secretPort,
      customFetch: mockFetch,
    });

    await expect(
      port.completeStructured({
        context: { goal: "test" },
        schema: { type: "Action" },
      }),
    ).rejects.toThrow("OpenAI model HTTP 401 error: Invalid API key");
  });
});
