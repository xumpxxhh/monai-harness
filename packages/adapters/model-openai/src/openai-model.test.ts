import { describe, expect, it } from "vitest";
import { EnvSecretPort } from "@monai/secret-env";
import { OpenAiModelPort } from "./openai-model.js";

describe("OpenAiModelPort", () => {
  const secretPort = new EnvSecretPort({
    envMap: { OPENAI_API_KEY: "sk-mock-key-12345" },
  });

  it("calls customFetch and parses structured response and usage", async () => {
    let capturedUrl = "";
    let capturedAuth = "";
    let capturedBody: unknown;

    const mockFetch: typeof fetch = async (url, init) => {
      capturedUrl = String(url);
      capturedAuth = String((init?.headers as Record<string, string>)?.Authorization);
      capturedBody = JSON.parse(String(init?.body));

      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  actionId: "act-1",
                  type: "tool.call",
                  toolId: "workspace.read",
                  arguments: { path: "hello.txt" },
                }),
              },
              finish_reason: "stop",
            },
          ],
          usage: {
            prompt_tokens: 150,
            completion_tokens: 45,
            total_tokens: 195,
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };

    const port = new OpenAiModelPort({
      secretPort,
      customFetch: mockFetch,
    });

    const result = await port.completeStructured({
      context: {
        goal: "read hello.txt",
        toolAllowlist: ["workspace.read"],
      },
      schema: { type: "Action" },
      modelPolicy: {
        version: "1.0.0",
        resolvedTarget: "gpt-4o",
      },
    });

    expect(capturedUrl).toBe("https://api.openai.com/v1/chat/completions");
    expect(capturedAuth).toBe("Bearer sk-mock-key-12345");
    expect((capturedBody as { model?: string }).model).toBe("gpt-4o");

    expect(result.target).toBe("gpt-4o");
    expect(result.usage).toEqual({
      inputTokens: 150,
      outputTokens: 45,
      totalTokens: 195,
    });
    expect(result.finishReason).toBe("stop");
    expect(result.rawAction).toMatchObject({
      actionId: "act-1",
      type: "tool.call",
      toolId: "workspace.read",
    });
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
