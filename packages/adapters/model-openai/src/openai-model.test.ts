import { describe, expect, it } from "vitest";
import { EnvSecretPort } from "@monai/secret-env";
import {
  OpenAiModelPort,
  resolveChatCompletionsUrl,
  splitThinkContent,
  toOpenAiTools,
} from "./openai-model.js";

const TEST_SYSTEM_PROMPT = "You are an agent. Call at most one function per turn.";

const SAMPLE_DEFS = [
  {
    name: "workspace.read",
    description: "Read a file",
    parameters: { type: "object", properties: { path: { type: "string" } } },
    kind: "domain" as const,
  },
  {
    name: "finish",
    description: "Finish the run",
    parameters: { type: "object", properties: {} },
    kind: "control" as const,
  },
];

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

describe("splitThinkContent", () => {
  it("preserves think blocks and returns remaining text", () => {
    const split = splitThinkContent(`<think>plan first</think>\n正在读取`);
    expect(split.reasoning).toContain("plan first");
    expect(split.text).toBe("正在读取");
  });
});

describe("toOpenAiTools", () => {
  it("wraps canonical defs in OpenAI tools shape", () => {
    expect(toOpenAiTools(SAMPLE_DEFS)).toEqual([
      {
        type: "function",
        function: {
          name: "workspace.read",
          description: "Read a file",
          parameters: { type: "object", properties: { path: { type: "string" } } },
        },
      },
      {
        type: "function",
        function: {
          name: "finish",
          description: "Finish the run",
          parameters: { type: "object", properties: {} },
        },
      },
    ]);
  });
});

describe("OpenAiModelPort", () => {
  const secretPort = new EnvSecretPort({
    envMap: { OPENAI_API_KEY: "sk-mock-key-12345" },
  });

  it("streams SSE, sends tools, and keeps JSON off display channel", async () => {
    let capturedUrl = "";
    let capturedBody: Record<string, unknown> = {};

    const mockFetch: typeof fetch = async (url, init) => {
      capturedUrl = String(url);
      capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;

      const chunks = [
        `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: "thinking…" } }] })}\n\n`,
        `data: ${JSON.stringify({
          choices: [{ delta: { content: "正在读取" } }],
        })}\n\n`,
        `data: ${JSON.stringify({
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: "call_1",
                    type: "function",
                    function: { name: "workspace.read", arguments: "" },
                  },
                ],
              },
            },
          ],
        })}\n\n`,
        `data: ${JSON.stringify({
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    function: { arguments: '{"path":"hello.txt"}' },
                  },
                ],
              },
              finish_reason: "tool_calls",
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
      domainTools: [SAMPLE_DEFS[0]!],
      controlFunctions: [SAMPLE_DEFS[1]!],
      systemPrompt: TEST_SYSTEM_PROMPT,
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
    expect(capturedBody.response_format).toBeUndefined();
    expect(capturedBody.tool_choice).toBe("auto");
    expect(capturedBody.parallel_tool_calls).toBeUndefined();
    expect(capturedBody.tools).toEqual(
      toOpenAiTools([SAMPLE_DEFS[1]!, SAMPLE_DEFS[0]!]),
    );
    const system = (capturedBody.messages as Array<{ role: string; content: string }>)[0]!.content;
    expect(system).toBe(TEST_SYSTEM_PROMPT);

    expect(deltas.some((d) => d.channel === "reasoning" && d.text.includes("thinking"))).toBe(true);
    expect(deltas.some((d) => d.channel === "display" && d.text.includes("正在读取"))).toBe(true);
    expect(deltas.every((d) => d.channel === "reasoning" || d.channel === "display")).toBe(true);

    expect(doneResult).toMatchObject({
      target: "gpt-4o",
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      content: "正在读取",
      calls: [{ name: "workspace.read", arguments: { path: "hello.txt" } }],
    });
  });

  it("omits tools wrapping and response_format when catalog is empty and mode is none", async () => {
    let capturedBody: Record<string, unknown> = {};
    const mockFetch: typeof fetch = async (_url, init) => {
      capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: "ok",
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
      systemPrompt: TEST_SYSTEM_PROMPT,
    });

    expect(capturedBody.response_format).toBeUndefined();
    expect(capturedBody.tools).toBeUndefined();
    expect((capturedBody.messages as Array<{ content: string }>)[0]!.content).toBe(TEST_SYSTEM_PROMPT);
  });

  it("uses runtime-projected messages when provided", async () => {
    let capturedBody: Record<string, unknown> = {};
    const mockFetch: typeof fetch = async (_url, init) => {
      capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };

    const port = new OpenAiModelPort({ secretPort, customFetch: mockFetch });
    await port.completeStructured({
      context: { goal: "ignored when messages set" },
      systemPrompt: TEST_SYSTEM_PROMPT,
      messages: [
        { role: "system", content: "sys" },
        { role: "user", content: "hello" },
        { role: "assistant", content: "hi", toolCalls: [{ id: "tc-1", type: "function", function: { name: "echo", arguments: "{}" } }] },
        { role: "tool", content: "{}", toolCallId: "tc-1" },
      ],
    });

    const messages = capturedBody.messages as Array<{ role: string }>;
    expect(messages).toHaveLength(4);
    expect(messages.map((m) => m.role)).toEqual(["system", "user", "assistant", "tool"]);
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
        systemPrompt: TEST_SYSTEM_PROMPT,
      }),
    ).rejects.toThrow("OpenAI model HTTP 401 error: Invalid API key");
  });
});
