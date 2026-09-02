import {
  type ModelPolicy,
  type ModelUsage,
} from "@monai/contracts";
import type {
  ModelCompleteInput,
  ModelDecision,
  ModelFunctionCall,
  ModelFunctionDef,
  ModelPort,
  ModelStreamChunk,
  SecretPort,
} from "@monai/ports";

export type ResponseFormatMode = "json_object" | "none";

export interface OpenAiModelPortOptions {
  secretPort: SecretPort;
  secretRef?: string;
  baseUrl?: string;
  defaultModel?: string;
  responseFormatMode?: ResponseFormatMode;
  headers?: Record<string, string>;
  authHeaderName?: string;
  customFetch?: typeof fetch;
}

/** @deprecated Use ModelDecision. Kept as a type alias for existing imports. */
export type ModelCallStructuredResult = ModelDecision;

/** Resolve chat completions URL whether baseUrl is root, /v1, or already full. */
export function resolveChatCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (/\/chat\/completions$/i.test(trimmed)) {
    return trimmed;
  }
  return `${trimmed}/chat/completions`;
}

export type SplitThinkContent = {
  reasoning?: string;
  text: string;
};

/** Isolate <think> blocks from user-visible content. */
export function splitThinkContent(content: string): SplitThinkContent {
  const thinkBlocks: string[] = [];
  const text = content
    .replace(/<think>([\s\S]*?)<\/think>/gi, (_m, inner: string) => {
      thinkBlocks.push(String(inner).trim());
      return "\n";
    })
    .trim();
  const reasoning = thinkBlocks.length > 0 ? thinkBlocks.join("\n\n") : undefined;
  return { reasoning, text };
}

export function toOpenAiTools(defs: readonly ModelFunctionDef[]): unknown[] {
  return defs.map((def) => ({
    type: "function",
    function: {
      name: def.name,
      description: def.description,
      parameters: def.parameters ?? { type: "object", properties: {} },
    },
  }));
}

function catalogDefs(input: ModelCompleteInput): ModelFunctionDef[] {
  return [...(input.controlFunctions ?? []), ...(input.domainTools ?? [])];
}

function buildUserPrompt(context: unknown): string {
  const contextObj = context as {
    goal?: string;
    toolAllowlist?: readonly string[];
    sections?: Array<{ kind: string; text?: string }>;
  } | undefined;

  let userPrompt = `Goal: ${contextObj?.goal ?? "Execute current step"}\n`;
  if (contextObj?.sections) {
    userPrompt += "\nContext Sections:\n";
    for (const section of contextObj.sections) {
      if (section.text) {
        userPrompt += `[${section.kind}]\n${section.text}\n\n`;
      }
    }
  } else if (contextObj?.toolAllowlist) {
    userPrompt += `Available Tools: [${contextObj.toolAllowlist.join(", ")}]\n`;
  }
  return userPrompt;
}

type ChatToolCall = {
  index?: number;
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string };
};

type ChatMessage = {
  content?: string | null;
  reasoning?: string;
  reasoning_content?: string;
  tool_calls?: ChatToolCall[];
};

function parseArgumentsJson(name: string, raw: string | undefined): unknown {
  const text = raw?.trim() ?? "";
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`Failed to parse tool arguments for ${name}: ${text}`);
  }
}

function callsFromToolCalls(toolCalls: ChatToolCall[] | undefined): ModelFunctionCall[] {
  if (!toolCalls?.length) return [];
  return toolCalls
    .filter((call) => call.function?.name)
    .map((call) => ({
      name: call.function!.name!,
      arguments: parseArgumentsJson(call.function!.name!, call.function?.arguments),
    }));
}

type AccToolCall = { name: string; arguments: string };

function callsFromAccumulator(acc: Map<number, AccToolCall>): ModelFunctionCall[] {
  return [...acc.entries()]
    .sort((a, b) => a[0] - b[0])
    .filter(([, call]) => call.name)
    .map(([, call]) => ({
      name: call.name,
      arguments: parseArgumentsJson(call.name, call.arguments),
    }));
}

/**
 * OpenAiModelPort — OpenAI-compatible transport adapter.
 * Translates canonical function defs to Chat Completions `tools`; returns ModelDecision.
 */
export class OpenAiModelPort implements ModelPort {
  private readonly secretPort: SecretPort;
  private readonly secretRef: string;
  private readonly baseUrl: string;
  private readonly defaultModel: string;
  private readonly responseFormatMode: ResponseFormatMode;
  private readonly extraHeaders: Record<string, string>;
  private readonly authHeaderName: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OpenAiModelPortOptions) {
    this.secretPort = options.secretPort;
    this.secretRef = options.secretRef ?? "OPENAI_API_KEY";
    this.baseUrl = options.baseUrl ?? "https://api.openai.com/v1";
    this.defaultModel = options.defaultModel ?? "gpt-4o-mini";
    this.responseFormatMode = options.responseFormatMode ?? "none";
    this.extraHeaders = options.headers ?? {};
    this.authHeaderName = options.authHeaderName ?? "Authorization";
    this.fetchImpl = options.customFetch ?? globalThis.fetch;
  }

  async completeStructured(input: ModelCompleteInput): Promise<ModelDecision> {
    let result: ModelDecision | undefined;
    for await (const chunk of this.completeStructuredStream(input)) {
      if (chunk.kind === "done") {
        result = chunk.result;
      }
    }
    if (!result) {
      throw new Error("OpenAI model stream ended without done chunk");
    }
    return result;
  }

  async *completeStructuredStream(input: ModelCompleteInput): AsyncIterable<ModelStreamChunk> {
    const policy = input.modelPolicy as ModelPolicy | undefined;
    const targetModel =
      policy?.resolvedTarget && policy.resolvedTarget !== "stub"
        ? policy.resolvedTarget
        : this.defaultModel;

    const lease = await this.secretPort.lease(this.secretRef);
    const apiKey = lease.value;

    const startTime = Date.now();
    const url = resolveChatCompletionsUrl(this.baseUrl);
    const defs = catalogDefs(input);

    const requestBody: Record<string, unknown> = {
      model: targetModel,
      stream: true,
      messages: [
        { role: "system", content: input.systemPrompt },
        { role: "user", content: buildUserPrompt(input.context) },
      ],
      temperature: policy?.temperature ?? 0.0,
      max_tokens: policy?.maxTokens ?? 1024,
    };
    if (defs.length > 0) {
      requestBody.tools = toOpenAiTools(defs);
      requestBody.tool_choice = "auto";
    } else if (this.responseFormatMode === "json_object") {
      requestBody.response_format = { type: "json_object" };
    }

    yield { kind: "request", url, body: requestBody };

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...this.extraHeaders,
    };
    if (this.authHeaderName.toLowerCase() === "authorization") {
      headers.Authorization = `Bearer ${apiKey}`;
    } else {
      headers[this.authHeaderName] = apiKey;
    }

    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: "POST",
        headers,
        body: JSON.stringify(requestBody),
      });
    } catch (networkErr) {
      throw new Error(
        `OpenAI model request failed (network error): ${
          networkErr instanceof Error ? networkErr.message : String(networkErr)
        }`,
      );
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`OpenAI model HTTP ${res.status} error: ${errText}`);
    }

    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("text/event-stream") && res.body) {
      const json = (await res.json()) as {
        choices?: Array<{
          message?: ChatMessage;
          finish_reason?: string;
        }>;
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
          total_tokens?: number;
        };
      };
      const choice = json.choices?.[0];
      const message = choice?.message;
      const rawContent = message?.content ?? "";
      const split = splitThinkContent(rawContent);
      const msgReasoning = message?.reasoning ?? message?.reasoning_content;
      const reasoning = [msgReasoning, split.reasoning].filter(Boolean).join("\n\n") || undefined;
      if (reasoning) {
        yield { kind: "delta", channel: "reasoning", text: reasoning };
      }
      if (split.text) {
        yield { kind: "delta", channel: "display", text: split.text };
      }
      const calls = callsFromToolCalls(message?.tool_calls);
      const usage: ModelUsage = {
        inputTokens: json.usage?.prompt_tokens ?? 0,
        outputTokens: json.usage?.completion_tokens ?? 0,
        totalTokens: json.usage?.total_tokens ?? 0,
      };
      yield {
        kind: "done",
        result: {
          content: split.text || undefined,
          calls,
          usage,
          target: targetModel,
          finishReason: choice?.finish_reason,
          latencyMs: Date.now() - startTime,
          reasoning,
        },
      };
      return;
    }

    let contentBuf = "";
    let reasoningBuf = "";
    let lastEmittedDisplay = "";
    let finishReason: string | undefined;
    let usage: ModelUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
    const toolAcc = new Map<number, AccToolCall>();

    const reader = res.body?.getReader();
    if (!reader) {
      throw new Error("OpenAI model returned empty body");
    }
    const decoder = new TextDecoder();
    let lineBuf = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      lineBuf += decoder.decode(value, { stream: true });
      const lines = lineBuf.split("\n");
      lineBuf = lines.pop() ?? "";

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line || line.startsWith(":")) continue;
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") continue;

        let parsed: {
          choices?: Array<{
            delta?: ChatMessage & { content?: string; tool_calls?: ChatToolCall[] };
            finish_reason?: string | null;
          }>;
          usage?: {
            prompt_tokens?: number;
            completion_tokens?: number;
            total_tokens?: number;
          };
        };
        try {
          parsed = JSON.parse(data) as typeof parsed;
        } catch {
          continue;
        }

        if (parsed.usage) {
          usage = {
            inputTokens: parsed.usage.prompt_tokens ?? usage.inputTokens,
            outputTokens: parsed.usage.completion_tokens ?? usage.outputTokens,
            totalTokens: parsed.usage.total_tokens ?? usage.totalTokens,
          };
        }

        const choice = parsed.choices?.[0];
        if (choice?.finish_reason) finishReason = choice.finish_reason;
        const delta = choice?.delta;
        if (!delta) continue;

        const rDelta = delta.reasoning ?? delta.reasoning_content;
        if (rDelta) {
          reasoningBuf += rDelta;
          yield { kind: "delta", channel: "reasoning", text: rDelta };
        }

        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0;
            const cur = toolAcc.get(idx) ?? { name: "", arguments: "" };
            if (tc.function?.name) cur.name += tc.function.name;
            if (tc.function?.arguments) cur.arguments += tc.function.arguments;
            toolAcc.set(idx, cur);
          }
        }

        if (delta.content) {
          contentBuf += delta.content;
          const split = splitThinkContent(contentBuf);
          if (split.text.length > lastEmittedDisplay.length) {
            const incr = split.text.slice(lastEmittedDisplay.length);
            lastEmittedDisplay = split.text;
            if (incr) {
              yield { kind: "delta", channel: "display", text: incr };
            }
          }
        }
      }
    }

    const split = splitThinkContent(contentBuf);
    if (split.reasoning && !reasoningBuf.includes(split.reasoning)) {
      reasoningBuf = reasoningBuf ? `${reasoningBuf}\n\n${split.reasoning}` : split.reasoning;
      yield { kind: "delta", channel: "reasoning", text: split.reasoning };
    }

    const calls = callsFromAccumulator(toolAcc);
    yield {
      kind: "done",
      result: {
        content: split.text || undefined,
        calls,
        usage,
        target: targetModel,
        finishReason,
        latencyMs: Date.now() - startTime,
        reasoning: reasoningBuf || split.reasoning,
      },
    };
  }
}
