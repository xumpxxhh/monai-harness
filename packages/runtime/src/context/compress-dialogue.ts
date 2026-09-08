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

/** Build per-run event ranges from ordered dialogue turns (stable for rangeHash). */
export function rangesFromTurns(
  turns: readonly DialogueTurn[],
): Array<{ runId: string; fromSequence: number; toSequence: number }> {
  const rangeByRun = new Map<string, { from: number; to: number }>();
  for (const turn of turns) {
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

  return [...rangeByRun.entries()].map(([runId, range]) => ({
    runId,
    fromSequence: range.from > 0 ? range.from : 1,
    toSequence: range.to > 0 ? range.to : 1,
  }));
}

export type PrefixCompressionMatch = {
  record: ContextCompressionRecord;
  /** Number of DialogueTurn messages covered by the matched prefix. */
  coveredTurnCount: number;
};

/**
 * Find the longest proper prefix of `historyTurns` (at complete-turn-group boundaries)
 * that already has a cached `context.summary_created` record.
 */
export function findLongestPrefixCompression(
  historyTurns: readonly DialogueTurn[],
  cachedEvents: readonly EventEnvelope[],
): PrefixCompressionMatch | undefined {
  const groups = groupCompleteTurns(historyTurns);
  if (groups.length < 2) return undefined;

  let best: PrefixCompressionMatch | undefined;

  // Proper prefixes only (exclude full history — that is exact-match reuse).
  for (let g = 0; g < groups.length - 1; g += 1) {
    const prefixTurns = flattenGroups(groups.slice(0, g + 1));
    const hash = dialogueSourceRangeHash(rangesFromTurns(prefixTurns));
    const cached = findCachedCompression(cachedEvents, hash);
    if (cached) {
      best = { record: cached, coveredTurnCount: prefixTurns.length };
    }
  }

  return best;
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

export function summarizeDialogueDeterministic(
  turns: readonly DialogueTurn[],
  options?: { priorSummary?: string },
): string {
  const lines = turns.map((turn, index) => `${index + 1}. ${formatTurnForSummary(turn)}`);
  if (options?.priorSummary?.trim()) {
    return [
      "Compressed dialogue history (deterministic summary, incremental):",
      "Prior summary:",
      options.priorSummary.trim(),
      "Incremental turns:",
      ...lines,
    ].join("\n");
  }
  return ["Compressed dialogue history (deterministic summary):", ...lines].join("\n");
}

const SUMMARIZER_SYSTEM_PROMPT = [
  "You compress agent dialogue history for the next reasoning step.",
  "Preserve: user goals, tools invoked, key tool results, decisions, and unfinished work.",
  "Do not invent facts. Use concise bullet points.",
].join("\n");

const INCREMENTAL_SUMMARIZER_SYSTEM_PROMPT = [
  "You update an existing compressed agent dialogue summary with incremental turns.",
  "Merge the prior summary with the new turns; preserve goals, tools, key results, decisions, and unfinished work.",
  "Do not invent facts. Use concise bullet points. Output only the updated summary.",
].join("\n");

export async function summarizeDialogueWithModel(input: {
  turns: readonly DialogueTurn[];
  model: ModelPort;
  modelPolicy?: unknown;
  priorSummary?: string;
}): Promise<{ summaryText: string; modelCallId: string }> {
  const transcript = input.turns.map(formatTurnForSummary).join("\n");
  const modelCallId = `summary-${Date.now()}`;
  const priorSummary = input.priorSummary?.trim();
  const systemPrompt = priorSummary ? INCREMENTAL_SUMMARIZER_SYSTEM_PROMPT : SUMMARIZER_SYSTEM_PROMPT;
  const userContent = priorSummary
    ? [
        "Update the existing session summary with the incremental dialogue below. Do not invent facts.",
        "",
        "Existing summary:",
        priorSummary,
        "",
        "Incremental dialogue:",
        transcript,
      ].join("\n")
    : `Summarize the following dialogue history:\n\n${transcript}`;

  const result = (await input.model.completeStructured({
    context: {
      transcript,
      purpose: priorSummary ? "dialogue_compression_incremental" : "dialogue_compression",
      ...(priorSummary ? { priorSummary } : {}),
    },
    systemPrompt,
    modelPolicy: input.modelPolicy,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
    ],
  })) as ModelDecision;

  const summaryText =
    typeof result.content === "string" && result.content.trim()
      ? result.content.trim()
      : summarizeDialogueDeterministic(input.turns, { priorSummary });

  return { summaryText, modelCallId };
}

export type CompleteTurnGroup = {
  /** `stepId` when present; otherwise message-level `turnId` (user/goal). */
  key: string;
  turns: DialogueTurn[];
};

/**
 * Group DialogueTurn messages into complete execution rounds.
 * Same `stepId` (assistant + tools) stays atomic; messages without stepId are singleton groups.
 */
export function groupCompleteTurns(turns: readonly DialogueTurn[]): CompleteTurnGroup[] {
  const groups: CompleteTurnGroup[] = [];
  const byStepId = new Map<string, CompleteTurnGroup>();

  for (const turn of turns) {
    const stepId = turn.stepId?.trim();
    if (stepId) {
      let group = byStepId.get(stepId);
      if (!group) {
        group = { key: stepId, turns: [] };
        byStepId.set(stepId, group);
        groups.push(group);
      }
      group.turns.push(turn);
      continue;
    }
    groups.push({ key: turn.turnId, turns: [turn] });
  }

  return groups;
}

function flattenGroups(groups: readonly CompleteTurnGroup[]): DialogueTurn[] {
  return groups.flatMap((g) => g.turns);
}

export type CompressionPlan = {
  historyTurns: DialogueTurn[];
  recentTurns: DialogueTurn[];
  sourceEventRanges: Array<{ runId: string; fromSequence: number; toSequence: number }>;
  rangeHash: string;
  needsCompression: boolean;
};

/**
 * Plan history vs recent split. `recentTurnCount` counts **complete turn groups**
 * (stepId rounds), not individual DialogueTurn messages.
 */
export function planDialogueCompression(input: {
  turns: readonly DialogueTurn[];
  policy: ContextProjectionPolicy;
}): CompressionPlan {
  const turns = [...input.turns];
  const groups = groupCompleteTurns(turns);
  const totalTokens = estimateDialogueTokens(turns);
  const needsCompression =
    groups.length > input.policy.recentTurnCount ||
    totalTokens > input.policy.compressThreshold;

  if (!needsCompression || groups.length === 0) {
    return {
      historyTurns: [],
      recentTurns: turns,
      sourceEventRanges: [],
      rangeHash: "",
      needsCompression: false,
    };
  }

  let recentStart = Math.max(0, groups.length - input.policy.recentTurnCount);
  while (
    recentStart > 0 &&
    estimateDialogueTokens(flattenGroups(groups.slice(recentStart))) > input.policy.recentTokenBudget
  ) {
    recentStart -= 1;
  }

  const historyTurns = flattenGroups(groups.slice(0, recentStart));
  const recentTurns = flattenGroups(groups.slice(recentStart));
  const sourceEventRanges = rangesFromTurns(historyTurns);
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

  const exact = findCachedCompression(input.cachedEvents, input.plan.rangeHash);
  if (exact) {
    return { compression: exact, isNew: false };
  }

  const historyTurns = input.plan.historyTurns;
  const prefix = findLongestPrefixCompression(historyTurns, input.cachedEvents);

  let summaryText: string;
  let modelCallId: string;
  let parentCompressionId: string | undefined;

  if (prefix && prefix.coveredTurnCount < historyTurns.length) {
    const deltaTurns = historyTurns.slice(prefix.coveredTurnCount);
    const summarized = await summarizeDialogueWithModel({
      turns: deltaTurns,
      priorSummary: prefix.record.summaryText,
      model: input.model,
      modelPolicy: input.modelPolicy,
    });
    summaryText = summarized.summaryText;
    modelCallId = summarized.modelCallId;
    parentCompressionId = prefix.record.compressionId;
  } else {
    const summarized = await summarizeDialogueWithModel({
      turns: historyTurns,
      model: input.model,
      modelPolicy: input.modelPolicy,
    });
    summaryText = summarized.summaryText;
    modelCallId = summarized.modelCallId;
  }

  const compressionId = `cmp-${input.plan.rangeHash.slice(0, 16)}`;
  const record: ContextCompressionRecord = {
    compressionId,
    summaryHash: sha256(summaryText),
    summaryText,
    sourceRunIds: [...new Set(historyTurns.map((t) => t.runId))],
    sourceEventRanges: input.plan.sourceEventRanges,
    ...(parentCompressionId ? { parentCompressionId } : {}),
    summarizerModelCallId: modelCallId,
    createdAt: new Date().toISOString(),
  };

  return { compression: record, isNew: true };
}
