import { randomUUID } from "node:crypto";

import {
  ACTION_TYPES,
  CONTRACTS_SCHEMA_VERSION,
  type ModelPolicy,
  type ModelUsage,
} from "@monai/contracts";
import type { ModelPort, ModelStreamChunk, SecretPort } from "@monai/ports";

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

export interface ModelCallStructuredResult {
  rawAction: unknown;
  usage: ModelUsage;
  target: string;
  finishReason?: string;
  latencyMs: number;
  reasoning?: string;
}

/** Resolve chat completions URL whether baseUrl is root, /v1, or already full. */
export function resolveChatCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (/\/chat\/completions$/i.test(trimmed)) {
    return trimmed;
  }
  return `${trimmed}/chat/completions`;
}

export type SplitModelOutput = {
  reasoning?: string;
  jsonText: string;
};

/**
 * Split model output into reasoning (preserved for UX) and JSON Action text.
 * Does not discard thinking — isolates it so Action parse stays clean.
 */
export function splitModelOutput(content: string): SplitModelOutput {
  const thinkBlocks: string[] = [];
  let rest = content.replace(/<think>([\s\S]*?)<\/think>/gi, (_m, inner: string) => {
    thinkBlocks.push(inner.trim());
    return "\n";
  });

  rest = rest.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();

  const firstBrace = rest.indexOf("{");
  const lastBrace = rest.lastIndexOf("}");
  let jsonText = rest;
  let preamble = "";
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    preamble = rest.slice(0, firstBrace).trim();
    jsonText = rest.slice(firstBrace, lastBrace + 1);
  }

  const reasoningParts = [...thinkBlocks];
  if (preamble) reasoningParts.push(preamble);
  const reasoning = reasoningParts.length > 0 ? reasoningParts.join("\n\n") : undefined;

  return { reasoning, jsonText };
}

/** Extract a closed JSON string value for `"displayText"` from partial JSON buffer. */
export function extractClosedDisplayText(partialJson: string): string | undefined {
  const key = `"displayText"`;
  const keyIdx = partialJson.indexOf(key);
  if (keyIdx < 0) return undefined;
  let i = keyIdx + key.length;
  while (i < partialJson.length && /[\s:]/.test(partialJson[i]!)) i += 1;
  if (partialJson[i] !== `"`) return undefined;
  i += 1;
  let out = "";
  while (i < partialJson.length) {
    const ch = partialJson[i]!;
    if (ch === "\\") {
      const next = partialJson[i + 1];
      if (next === undefined) return undefined;
      if (next === "n") out += "\n";
      else if (next === "t") out += "\t";
      else if (next === "r") out += "\r";
      else if (next === '"' || next === "\\") out += next;
      else out += next;
      i += 2;
      continue;
    }
    if (ch === `"`) return out;
    out += ch;
    i += 1;
  }
  return undefined;
}

function buildSystemPrompt(): string {
  const types = ACTION_TYPES.join(" | ");
  return [
    "You are an autonomous AI Agent in the Monai runtime.",
    "You must output a single valid JSON object representing an Action matching the Action schema.",
    "Do NOT wrap with markdown backticks or output extra prose outside the JSON object.",
    `Allowed action types: ${types}.`,
    "Required fields on every Action:",
    `  - schemaVersion: always "${CONTRACTS_SCHEMA_VERSION}"`,
    "  - actionId: a unique string id for this decision (e.g. act-1)",
    "  - type: one of the allowed action types",
    "Field guide:",
    "- tool.call: require toolId and arguments; set idempotencyKey for side-effecting tools.",
    "- ask_user: put the question in displayText (or arguments.prompt).",
    "- finish: put the closing note in displayText (or arguments.summary).",
    "- spawn_child: require childSpec.goal (Policy may still deny in MVP).",
    "- noop: no tool call.",
    "Optional displayText: natural language shown to the end user (Agent → user). Never treat it as a user-sent message.",
    "Machine fields (type, toolId, arguments, …) drive execution; displayText is display-only.",
    "Example:",
    `{"schemaVersion":"${CONTRACTS_SCHEMA_VERSION}","actionId":"act-1","type":"ask_user","displayText":"请确认范围？","arguments":{"prompt":"请确认范围？"}}`,
  ].join("\n");
}

/**
 * Fill identity fields models often omit so Action schema validation can pass.
 */
export function normalizeRawAction(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const obj = { ...(raw as Record<string, unknown>) };
  if (typeof obj.schemaVersion !== "string" || !obj.schemaVersion.trim()) {
    obj.schemaVersion = CONTRACTS_SCHEMA_VERSION;
  }
  if (typeof obj.actionId !== "string" || !obj.actionId.trim()) {
    obj.actionId = `act-${randomUUID()}`;
  }
  return obj;
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

type ChatMessage = {
  content?: string;
  reasoning?: string;
  reasoning_content?: string;
};

/**
 * OpenAiModelPort — OpenAI-compatible structured model adapter (design 02 §7, 06 §3).
 * Fetches API credentials at runtime via SecretPort lease; never writes state or performs tools.
 * Streaming yields reasoning/display deltas only; raw JSON content stays internal until done.
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
    this.responseFormatMode = options.responseFormatMode ?? "json_object";
    this.extraHeaders = options.headers ?? {};
    this.authHeaderName = options.authHeaderName ?? "Authorization";
    this.fetchImpl = options.customFetch ?? globalThis.fetch;
  }

  async completeStructured(input: {
    context: unknown;
    schema: unknown;
    modelPolicy?: unknown;
  }): Promise<ModelCallStructuredResult> {
    let result: ModelCallStructuredResult | undefined;
    for await (const chunk of this.completeStructuredStream(input)) {
      if (chunk.kind === "done") {
        result = {
          rawAction: chunk.result.rawAction,
          usage: chunk.result.usage ?? { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
          target: chunk.result.target ?? this.defaultModel,
          finishReason: chunk.result.finishReason,
          latencyMs: chunk.result.latencyMs ?? 0,
          reasoning: chunk.result.reasoning,
        };
      }
    }
    if (!result) {
      throw new Error("OpenAI model stream ended without done chunk");
    }
    return result;
  }

  async *completeStructuredStream(input: {
    context: unknown;
    schema: unknown;
    modelPolicy?: unknown;
  }): AsyncIterable<ModelStreamChunk> {
    const policy = input.modelPolicy as ModelPolicy | undefined;
    const targetModel =
      policy?.resolvedTarget && policy.resolvedTarget !== "stub"
        ? policy.resolvedTarget
        : this.defaultModel;

    const lease = await this.secretPort.lease(this.secretRef);
    const apiKey = lease.value;

    const startTime = Date.now();
    const url = resolveChatCompletionsUrl(this.baseUrl);

    const requestBody: Record<string, unknown> = {
      model: targetModel,
      stream: true,
      messages: [
        { role: "system", content: buildSystemPrompt() },
        { role: "user", content: buildUserPrompt(input.context) },
      ],
      temperature: policy?.temperature ?? 0.0,
      max_tokens: policy?.maxTokens ?? 1024,
    };
    if (this.responseFormatMode === "json_object") {
      requestBody.response_format = { type: "json_object" };
    }

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
    // Non-streaming fallback (some gateways ignore stream:true)
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
      const content = message?.content ?? "";
      const msgReasoning = message?.reasoning ?? message?.reasoning_content;
      const split = splitModelOutput(content);
      const reasoning = [msgReasoning, split.reasoning].filter(Boolean).join("\n\n") || undefined;
      if (reasoning) {
        yield { kind: "delta", channel: "reasoning", text: reasoning };
      }
      const display = extractClosedDisplayText(split.jsonText);
      if (display) {
        yield { kind: "delta", channel: "display", text: display };
      }
      let rawAction: unknown;
      try {
        rawAction = normalizeRawAction(JSON.parse(split.jsonText));
      } catch {
        throw new Error(`Failed to parse model JSON content: ${split.jsonText}`);
      }
      const usage: ModelUsage = {
        inputTokens: json.usage?.prompt_tokens ?? 0,
        outputTokens: json.usage?.completion_tokens ?? 0,
        totalTokens: json.usage?.total_tokens ?? 0,
      };
      yield {
        kind: "done",
        result: {
          rawAction,
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
            delta?: ChatMessage & { content?: string };
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

        if (delta.content) {
          // Buffer JSON content; do not yield as user-visible content.
          const beforeThink = contentBuf;
          contentBuf += delta.content;

          // Stream <think> increments if present in content stream
          const thinkMatch = contentBuf.match(/<think>([\s\S]*?)(?:<\/think>|$)/i);
          if (thinkMatch && !beforeThink.includes("<think>")) {
            // start of think — ignore for content buffering UX; split at end
          }

          const closed = extractClosedDisplayText(contentBuf);
          if (closed !== undefined && closed.length > lastEmittedDisplay.length) {
            const incr = closed.slice(lastEmittedDisplay.length);
            lastEmittedDisplay = closed;
            if (incr) {
              yield { kind: "delta", channel: "display", text: incr };
            }
          }
        }
      }
    }

    const split = splitModelOutput(contentBuf);
    const thinkFromContent = split.reasoning;
    if (thinkFromContent && !reasoningBuf.includes(thinkFromContent)) {
      const extra = thinkFromContent;
      reasoningBuf = reasoningBuf ? `${reasoningBuf}\n\n${extra}` : extra;
      yield { kind: "delta", channel: "reasoning", text: extra };
    }

    if (!split.jsonText.trim()) {
      throw new Error("OpenAI model returned empty content in stream");
    }

    let rawAction: unknown;
    try {
      rawAction = normalizeRawAction(JSON.parse(split.jsonText));
    } catch {
      throw new Error(`Failed to parse model JSON content: ${split.jsonText}`);
    }

    if (
      lastEmittedDisplay === "" &&
      rawAction &&
      typeof rawAction === "object" &&
      "displayText" in (rawAction as Record<string, unknown>) &&
      typeof (rawAction as { displayText?: unknown }).displayText === "string"
    ) {
      const full = (rawAction as { displayText: string }).displayText;
      yield { kind: "delta", channel: "display", text: full };
    }

    yield {
      kind: "done",
      result: {
        rawAction,
        usage,
        target: targetModel,
        finishReason,
        latencyMs: Date.now() - startTime,
        reasoning: reasoningBuf || split.reasoning,
      },
    };
  }
}
