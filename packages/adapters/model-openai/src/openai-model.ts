import type { ModelPolicy, ModelUsage } from "@monai/contracts";
import type { ModelPort, SecretPort } from "@monai/ports";

export interface OpenAiModelPortOptions {
  secretPort: SecretPort;
  secretRef?: string;
  baseUrl?: string;
  defaultModel?: string;
  customFetch?: typeof fetch;
}

export interface ModelCallStructuredResult {
  rawAction: unknown;
  usage: ModelUsage;
  target: string;
  finishReason?: string;
  latencyMs: number;
}

/**
 * OpenAiModelPort — OpenAI-compatible structured model adapter (design 02 §7, 06 §3).
 * Fetches API credentials at runtime via SecretPort lease; never writes state or performs tools.
 */
export class OpenAiModelPort implements ModelPort {
  private readonly secretPort: SecretPort;
  private readonly secretRef: string;
  private readonly baseUrl: string;
  private readonly defaultModel: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OpenAiModelPortOptions) {
    this.secretPort = options.secretPort;
    this.secretRef = options.secretRef ?? "OPENAI_API_KEY";
    this.baseUrl = options.baseUrl ?? "https://api.openai.com/v1";
    this.defaultModel = options.defaultModel ?? "gpt-4o-mini";
    this.fetchImpl = options.customFetch ?? globalThis.fetch;
  }

  async completeStructured(input: {
    context: unknown;
    schema: unknown;
    modelPolicy?: unknown;
  }): Promise<ModelCallStructuredResult> {
    const policy = input.modelPolicy as ModelPolicy | undefined;
    const targetModel = policy?.resolvedTarget ?? this.defaultModel;

    // 1. Fetch credential lease at the invocation boundary (design 06 §3)
    const lease = await this.secretPort.lease(this.secretRef);
    const apiKey = lease.value;

    // 2. Build system and user prompt from Context
    const contextObj = input.context as {
      goal?: string;
      toolAllowlist?: readonly string[];
      sections?: Array<{ kind: string; text?: string }>;
    } | undefined;

    const systemPrompt = [
      "You are an autonomous AI Agent in the Monai runtime.",
      "You must output a single valid JSON object representing an Action matching the Action schema.",
      "Do NOT wrap with markdown backticks ``` or output extra text.",
      "Allowed action types: 'tool.call' (with toolId, arguments), 'noop', or 'finish' (with summary).",
    ].join("\n");

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

    const startTime = Date.now();
    const url = `${this.baseUrl.replace(/\/+$/, "")}/chat/completions`;

    const requestBody = {
      model: targetModel,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
      temperature: policy?.temperature ?? 0.0,
      max_tokens: policy?.maxTokens ?? 1024,
    };

    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(requestBody),
      });
    } catch (networkErr) {
      throw new Error(
        `OpenAI model request failed (network error): ${
          networkErr instanceof Error ? networkErr.message : String(networkErr)
        }`,
      );
    }

    const latencyMs = Date.now() - startTime;

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`OpenAI model HTTP ${res.status} error: ${errText}`);
    }

    const json = (await res.json()) as {
      choices?: Array<{
        message?: { content?: string };
        finish_reason?: string;
      }>;
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
      };
    };

    const choice = json.choices?.[0];
    const content = choice?.message?.content;
    if (!content) {
      throw new Error("OpenAI model returned empty content in choices[0]");
    }

    let parsedAction: unknown;
    try {
      parsedAction = JSON.parse(content);
    } catch (parseErr) {
      throw new Error(`Failed to parse model JSON content: ${content}`);
    }

    const usage: ModelUsage = {
      inputTokens: json.usage?.prompt_tokens ?? 0,
      outputTokens: json.usage?.completion_tokens ?? 0,
      totalTokens: json.usage?.total_tokens ?? 0,
    };

    return {
      rawAction: parsedAction,
      usage,
      target: targetModel,
      finishReason: choice?.finish_reason,
      latencyMs,
    };
  }
}
