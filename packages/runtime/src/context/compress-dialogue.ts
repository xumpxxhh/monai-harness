import crypto from "node:crypto";

import type {
  ContextCompressionRecord,
  ContextProjectionPolicy,
  DialogueTurn,
  EventEnvelope,
} from "@monai/contracts";
import type { ModelDecision, ModelPort } from "@monai/ports";

import {
  dialogueSourceRangeHash,
  estimateDialogueTokens,
} from "./project-dialogue.js";

function sha256(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function compressionFromEvent(event: EventEnvelope): ContextCompressionRecord | undefined {
  if (event.eventType !== "context.summary_created") return undefined;
  const payload = event.payload as { record?: ContextCompressionRecord } | undefined;
  return payload?.record;
}

export function findCachedCompression(
  events: readonly EventEnvelope[],
  rangeHash: string,
): ContextCompressionRecord | undefined {
  for (const event of events) {
    const record = compressionFromEvent(event);
    if (!record) continue;
    const hash = dialogueSourceRangeHash(record.sourceEventRanges);
    if (hash === rangeHash) return record;
  }
  return undefined;
}

function formatTurnForSummary(turn: DialogueTurn): string {
  if (turn.role === "tool") {
    return `tool(${turn.toolName ?? "unknown"}): ${turn.content ?? ""}`;
  }
  if (turn.role === "assistant") {
    const calls = turn.toolCalls?.map((c) => c.name).join(", ") ?? "";
    return `assistant: ${turn.content ?? ""}${calls ? ` [calls: ${calls}]` : ""}`;
  }
  return `user: ${turn.content ?? ""}`;
}

export function summarizeDialogueDeterministic(turns: readonly DialogueTurn[]): string {
  const lines = turns.map((turn, index) => `${index + 1}. ${formatTurnForSummary(turn)}`);
  return [
    "Compressed dialogue history (deterministic summary):",
    ...lines,
  ].join("\n");
}

const SUMMARIZER_SYSTEM_PROMPT = [
  "You compress agent dialogue history for the next reasoning step.",
  "Preserve: user goals, tools invoked, key tool results, decisions, and unfinished work.",
  "Do not invent facts. Use concise bullet points.",
].join("\n");

export async function summarizeDialogueWithModel(input: {
  turns: readonly DialogueTurn[];
  model: ModelPort;
  modelPolicy?: unknown;
}): Promise<{ summaryText: string; modelCallId: string }> {
  const transcript = input.turns.map(formatTurnForSummary).join("\n");
  const modelCallId = `summary-${Date.now()}`;

  const result = (await input.model.completeStructured({
    context: { transcript, purpose: "dialogue_compression" },
    systemPrompt: SUMMARIZER_SYSTEM_PROMPT,
    modelPolicy: input.modelPolicy,
    messages: [
      { role: "system", content: SUMMARIZER_SYSTEM_PROMPT },
      {
        role: "user",
        content: `Summarize the following dialogue history:\n\n${transcript}`,
      },
    ],
  })) as ModelDecision;

  const summaryText =
    typeof result.content === "string" && result.content.trim()
      ? result.content.trim()
      : summarizeDialogueDeterministic(input.turns);

  return { summaryText, modelCallId };
}

export type CompressionPlan = {
  historyTurns: DialogueTurn[];
  recentTurns: DialogueTurn[];
  sourceEventRanges: Array<{ runId: string; fromSequence: number; toSequence: number }>;
  rangeHash: string;
  needsCompression: boolean;
};

export function planDialogueCompression(input: {
  turns: readonly DialogueTurn[];
  policy: ContextProjectionPolicy;
}): CompressionPlan {
  const turns = [...input.turns];
  const totalTokens = estimateDialogueTokens(turns);
  const needsCompression =
    turns.length > input.policy.recentTurnCount ||
    totalTokens > input.policy.compressThreshold;

  if (!needsCompression || turns.length === 0) {
    return {
      historyTurns: [],
      recentTurns: turns,
      sourceEventRanges: [],
      rangeHash: "",
      needsCompression: false,
    };
  }

  let recentStart = Math.max(0, turns.length - input.policy.recentTurnCount);
  while (recentStart > 0 && estimateDialogueTokens(turns.slice(recentStart)) > input.policy.recentTokenBudget) {
    recentStart -= 1;
  }

  const historyTurns = turns.slice(0, recentStart);
  const recentTurns = turns.slice(recentStart);

  const rangeByRun = new Map<string, { from: number; to: number }>();
  for (const turn of historyTurns) {
    const from = turn.sequenceRange.from;
    const to = turn.sequenceRange.to;
    const existing = rangeByRun.get(turn.runId);
    if (!existing) {
      rangeByRun.set(turn.runId, { from, to });
    } else {
      existing.from = Math.min(existing.from, from);
      existing.to = Math.max(existing.to, to);
    }
  }

  const sourceEventRanges = [...rangeByRun.entries()].map(([runId, range]) => ({
    runId,
    fromSequence: range.from > 0 ? range.from : 1,
    toSequence: range.to > 0 ? range.to : 1,
  }));

  const rangeHash = dialogueSourceRangeHash(sourceEventRanges);

  return {
    historyTurns,
    recentTurns,
    sourceEventRanges,
    rangeHash,
    needsCompression: historyTurns.length > 0,
  };
}

export type EnsureCompressionResult = {
  compression?: ContextCompressionRecord;
  isNew: boolean;
};

export async function ensureDialogueCompression(input: {
  plan: CompressionPlan;
  cachedEvents: readonly EventEnvelope[];
  model: ModelPort;
  modelPolicy?: unknown;
}): Promise<EnsureCompressionResult> {
  if (!input.plan.needsCompression || input.plan.historyTurns.length === 0) {
    return { isNew: false };
  }

  const cached = findCachedCompression(input.cachedEvents, input.plan.rangeHash);
  if (cached) {
    return { compression: cached, isNew: false };
  }

  const { summaryText, modelCallId } = await summarizeDialogueWithModel({
    turns: input.plan.historyTurns,
    model: input.model,
    modelPolicy: input.modelPolicy,
  });

  const compressionId = `cmp-${input.plan.rangeHash.slice(0, 16)}`;
  const record: ContextCompressionRecord = {
    compressionId,
    summaryHash: sha256(summaryText),
    summaryText,
    sourceRunIds: [...new Set(input.plan.historyTurns.map((t) => t.runId))],
    sourceEventRanges: input.plan.sourceEventRanges,
    summarizerModelCallId: modelCallId,
    createdAt: new Date().toISOString(),
  };

  return { compression: record, isNew: true };
}
