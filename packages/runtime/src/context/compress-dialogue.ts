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

/** Tool / function-call markup that must never be treated as a reusable history summary. */
const TOOL_MARKUP_RE =
  /<\s*(?:\/\s*)?(?:dots_function_call|function_call|tool_call|invoke|parameter)\b/i;

const MIN_USABLE_SUMMARY_CHARS = 40;

/** Caps for summarizer input only (ModelView still uses policy.maxToolContentChars). */
const MAX_SUMMARY_TOOL_CONTENT_CHARS = 600;
const MAX_SUMMARY_USER_CHARS = 1_200;
const MAX_SUMMARY_ASSISTANT_CHARS = 400;
const MAX_BRIEF_ITEMS = 12;

const CONSTRAINT_HINT_RE =
  /禁止|不得|硬性|约束|must not|do not|don't|only use|only operate|严禁|不允许/i;
const ERROR_HINT_RE =
  /error|failed|failure|exception|ERR_|TS\d{3,5}|exit(?:ed)?(?:\s+with)?\s*(?:code\s*)?[1-9]|ENOENT|EACCES/i;
const SUCCESS_HINT_RE = /edited |wrote |created |installed |succeeded|ok\b|exit(?:ed)?(?:\s+with)?\s*(?:code\s*)?0\b/i;

/**
 * Reject poisoned or empty model summaries before they enter `context.summary_created`
 * or prefix-cache reuse (e.g. `<dots_function_call>…` echo from the summarizer).
 */
export function isUsableDialogueSummary(summaryText: string): boolean {
  const text = summaryText.trim();
  if (text.length < MIN_USABLE_SUMMARY_CHARS) return false;
  if (TOOL_MARKUP_RE.test(text)) return false;
  return true;
}

export function findCachedCompression(
  events: readonly EventEnvelope[],
  rangeHash: string,
): ContextCompressionRecord | undefined {
  for (const event of events) {
    const record = compressionFromEvent(event);
    if (!record) continue;
    if (!isUsableDialogueSummary(record.summaryText)) continue;
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

function truncateText(text: string, maxChars: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, maxChars)}…`;
}

function uniqueCap(items: Iterable<string>, max = MAX_BRIEF_ITEMS): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const value = item.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
    if (out.length >= max) break;
  }
  return out;
}

function collectPathsFromUnknown(value: unknown, out: Set<string>, depth = 0): void {
  if (depth > 4 || value == null) return;
  if (typeof value === "string") {
    if (value.length > 0 && value.length < 260) {
      const matches = value.match(
        /(?:(?:\/|\\)?(?:projects|workspace)(?:\/|\\)[^\s"'`;]+|[A-Za-z0-9_./\\-]+\.(?:tsx?|jsx?|json|css|md|js|mjs|cjs))/g,
      );
      if (matches) {
        for (const match of matches) out.add(match.replace(/\\/g, "/"));
      }
      if (
        (value.includes("/") || value.includes("\\") || /\.[a-zA-Z0-9]+$/.test(value)) &&
        !/\s{2,}/.test(value) &&
        (/^(?:\/|\\|[A-Za-z]:\\|projects\/|workspace\/|\.\/)/.test(value) ||
          /\.[a-zA-Z0-9]+$/.test(value))
      ) {
        out.add(value.replace(/\\/g, "/"));
      }
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 24)) collectPathsFromUnknown(item, out, depth + 1);
    return;
  }
  if (typeof value === "object") {
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (/path|file|target|cwd|dir/i.test(key) && typeof nested === "string" && nested.trim()) {
        out.add(nested.replace(/\\/g, "/"));
      } else {
        collectPathsFromUnknown(nested, out, depth + 1);
      }
    }
  }
}

function pickToolArgHighlights(args: unknown): string {
  if (!args || typeof args !== "object") return "";
  const record = args as Record<string, unknown>;
  const bits: string[] = [];
  for (const key of ["path", "command", "file", "cwd", "target", "timeout_ms"]) {
    const value = record[key];
    if (value === undefined || value === null || value === "") continue;
    const text = typeof value === "string" ? value : JSON.stringify(value);
    bits.push(`${key}=${truncateText(text, 160)}`);
  }
  return bits.join(", ");
}

function condenseToolContent(toolName: string | undefined, content: string): string {
  let text = content;
  try {
    const data = JSON.parse(content) as unknown;
    if (data && typeof data === "object") {
      const record = data as Record<string, unknown>;
      const bits: string[] = [];
      for (const key of [
        "path",
        "summary",
        "error",
        "message",
        "status",
        "exitCode",
        "charsAfter",
        "replacements",
        "stdout",
        "stderr",
      ]) {
        const value = record[key];
        if (value === undefined || value === null || value === "") continue;
        let rendered = typeof value === "string" ? value : JSON.stringify(value);
        if (key === "stdout" || key === "stderr") {
          const errLines = rendered
            .split(/\r?\n/)
            .filter((line) => ERROR_HINT_RE.test(line))
            .slice(0, 8);
          rendered = errLines.length > 0 ? errLines.join("\n") : truncateText(rendered, 240);
        }
        bits.push(`${key}=${rendered}`);
      }
      if (bits.length > 0) text = bits.join("; ");
    }
  } catch {
    // keep raw text
  }

  if (toolName) {
    return truncateText(`${toolName}: ${text}`, MAX_SUMMARY_TOOL_CONTENT_CHARS);
  }
  return truncateText(text, MAX_SUMMARY_TOOL_CONTENT_CHARS);
}

/** Compact one DialogueTurn for summarizer transcript (not ModelView). */
export function formatTurnForSummary(turn: DialogueTurn): string {
  if (turn.role === "tool") {
    return `tool(${turn.toolName ?? "unknown"}): ${condenseToolContent(undefined, turn.content ?? "")}`;
  }
  if (turn.role === "assistant") {
    const callBits =
      turn.toolCalls
        ?.map((call) => {
          const args = pickToolArgHighlights(call.arguments);
          return args ? `${call.name}(${args})` : call.name;
        })
        .join(", ") ?? "";
    const content = truncateText(turn.content ?? "", MAX_SUMMARY_ASSISTANT_CHARS);
    return `assistant: ${content}${callBits ? ` [calls: ${callBits}]` : ""}`;
  }
  return `user: ${truncateText(turn.content ?? "", MAX_SUMMARY_USER_CHARS)}`;
}

export type CompressionAnchors = {
  goals: string[];
  constraints: string[];
  changedPaths: string[];
  openErrors: string[];
  confirmedFacts: string[];
  toolsUsed: string[];
};

/**
 * Milestone-style anchors derived from dialogue (and optional reducer fact summaries).
 * Used so the summarizer is not fed a tool-call log alone.
 */
export function extractCompressionAnchors(
  turns: readonly DialogueTurn[],
  options?: { stateFacts?: readonly string[] },
): CompressionAnchors {
  const goals: string[] = [];
  const constraints: string[] = [];
  const paths = new Set<string>();
  const openErrors: string[] = [];
  const confirmedFacts: string[] = [];
  const tools = new Set<string>();
  const seenGoalByRun = new Set<string>();

  for (const fact of options?.stateFacts ?? []) {
    if (fact.trim()) confirmedFacts.push(truncateText(fact, 240));
  }

  for (const turn of turns) {
    if (turn.role === "user") {
      const content = (turn.content ?? "").trim();
      if (!content) continue;
      if (!seenGoalByRun.has(turn.runId)) {
        seenGoalByRun.add(turn.runId);
        goals.push(truncateText(content, 320));
      }
      for (const line of content.split(/\r?\n/)) {
        if (CONSTRAINT_HINT_RE.test(line)) {
          constraints.push(truncateText(line.replace(/^\s*[-*]\s*/, ""), 240));
        }
      }
      collectPathsFromUnknown(content, paths);
      continue;
    }

    if (turn.role === "assistant") {
      for (const call of turn.toolCalls ?? []) {
        tools.add(call.name);
        collectPathsFromUnknown(call.arguments, paths);
      }
      continue;
    }

    if (turn.role === "tool") {
      if (turn.toolName) tools.add(turn.toolName);
      const raw = turn.content ?? "";
      collectPathsFromUnknown(raw, paths);
      try {
        const data = JSON.parse(raw) as Record<string, unknown>;
        if (typeof data.summary === "string" && data.summary.trim()) {
          confirmedFacts.push(truncateText(data.summary, 240));
        }
        const exitCode = data.exitCode;
        const stderr = typeof data.stderr === "string" ? data.stderr : "";
        const stdout = typeof data.stdout === "string" ? data.stdout : "";
        const combined = `${stderr}\n${stdout}\n${typeof data.error === "string" ? data.error : ""}`;
        if (
          (typeof exitCode === "number" && exitCode !== 0) ||
          ERROR_HINT_RE.test(combined) ||
          ERROR_HINT_RE.test(raw)
        ) {
          const errText =
            stderr.trim() ||
            (typeof data.error === "string" ? data.error : "") ||
            combined
              .split(/\r?\n/)
              .filter((line) => ERROR_HINT_RE.test(line))
              .slice(0, 4)
              .join(" | ") ||
            truncateText(raw, 240);
          openErrors.push(
            truncateText(`${turn.toolName ?? "tool"}: ${errText}`, 280),
          );
        } else if (SUCCESS_HINT_RE.test(raw) || (typeof exitCode === "number" && exitCode === 0)) {
          if (typeof data.summary === "string" && data.summary.trim()) {
            // already added
          } else if (typeof data.path === "string") {
            confirmedFacts.push(truncateText(`${turn.toolName ?? "tool"} ok @ ${data.path}`, 240));
          }
        }
      } catch {
        if (ERROR_HINT_RE.test(raw)) {
          openErrors.push(truncateText(`${turn.toolName ?? "tool"}: ${raw}`, 280));
        } else if (SUCCESS_HINT_RE.test(raw)) {
          confirmedFacts.push(truncateText(`${turn.toolName ?? "tool"}: ${raw}`, 240));
        }
      }
    }
  }

  return {
    goals: uniqueCap(goals),
    constraints: uniqueCap(constraints),
    changedPaths: uniqueCap(paths),
    openErrors: uniqueCap(openErrors),
    confirmedFacts: uniqueCap(confirmedFacts),
    toolsUsed: uniqueCap(tools),
  };
}

export function formatCompressionAnchors(anchors: CompressionAnchors): string {
  const sections: string[] = ["## Session anchors"];
  const pushList = (title: string, items: readonly string[]) => {
    if (items.length === 0) return;
    sections.push(`### ${title}`);
    for (const item of items) sections.push(`- ${item}`);
  };
  pushList("Goals", anchors.goals);
  pushList("Hard constraints", anchors.constraints);
  pushList("Changed paths", anchors.changedPaths);
  pushList("Confirmed facts", anchors.confirmedFacts);
  pushList("Open errors", anchors.openErrors);
  pushList("Tools used", anchors.toolsUsed);
  return sections.join("\n");
}

export type CompressionMaterialOptions = {
  /** Turns used for milestone anchors (defaults to `turns`). Prefer full history on incremental path. */
  anchorTurns?: readonly DialogueTurn[];
  priorSummary?: string;
  stateFacts?: readonly string[];
  /** Label for the transcript block. */
  transcriptLabel?: string;
};

/**
 * Build summarizer input: milestone anchors + condensed transcript (+ optional prior summary).
 * Avoids feeding a truncated assistant/tool-only stream as the sole compression material.
 */
export function buildCompressionMaterial(
  turns: readonly DialogueTurn[],
  options?: CompressionMaterialOptions,
): { material: string; anchors: CompressionAnchors; transcript: string } {
  const anchorSource = options?.anchorTurns ?? turns;
  const anchors = extractCompressionAnchors(anchorSource, {
    stateFacts: options?.stateFacts,
  });
  const transcript = turns.map((turn, index) => `${index + 1}. ${formatTurnForSummary(turn)}`).join("\n");
  const parts: string[] = [formatCompressionAnchors(anchors)];

  if (options?.priorSummary?.trim()) {
    parts.push("", "## Prior summary", options.priorSummary.trim());
  }

  parts.push(
    "",
    `## ${options?.transcriptLabel ?? "Condensed transcript"}`,
    transcript || "(empty)",
  );

  return { material: parts.join("\n"), anchors, transcript };
}

export function summarizeDialogueDeterministic(
  turns: readonly DialogueTurn[],
  options?: CompressionMaterialOptions,
): string {
  const { material } = buildCompressionMaterial(turns, {
    ...options,
    transcriptLabel: options?.priorSummary?.trim()
      ? "Incremental condensed transcript"
      : "Condensed transcript",
  });
  const header = options?.priorSummary?.trim()
    ? "Compressed dialogue history (deterministic summary, incremental):"
    : "Compressed dialogue history (deterministic summary):";
  return [header, material].join("\n");
}

const SUMMARIZER_SYSTEM_PROMPT = [
  "You compress agent dialogue history for the next reasoning step.",
  "You receive session anchors (goals, constraints, paths, facts, errors) plus a condensed transcript.",
  "Write a milestone-style summary with these sections when applicable:",
  "Goal; Hard constraints; Confirmed facts; Changed paths; Open errors / blockers; Next steps.",
  "Do not invent facts. Prefer anchors over raw tool noise. Use concise bullet points.",
  "Output only plain summary prose. Never emit tool calls, XML tags, or function-call markup.",
].join("\n");

const INCREMENTAL_SUMMARIZER_SYSTEM_PROMPT = [
  "You update an existing compressed agent dialogue summary with incremental turns.",
  "You receive session anchors, the prior summary, and a condensed incremental transcript.",
  "Merge into a milestone-style summary: Goal; Hard constraints; Confirmed facts; Changed paths; Open errors / blockers; Next steps.",
  "Do not invent facts. Prefer anchors over raw tool noise. Output only the updated summary.",
  "Output only plain summary prose. Never emit tool calls, XML tags, or function-call markup.",
].join("\n");

export async function summarizeDialogueWithModel(input: {
  turns: readonly DialogueTurn[];
  model: ModelPort;
  modelPolicy?: unknown;
  priorSummary?: string;
  anchorTurns?: readonly DialogueTurn[];
  stateFacts?: readonly string[];
}): Promise<{ summaryText: string; modelCallId: string; usedDeterministicFallback: boolean }> {
  const priorSummary = input.priorSummary?.trim();
  const { material, transcript, anchors } = buildCompressionMaterial(input.turns, {
    priorSummary,
    anchorTurns: input.anchorTurns,
    stateFacts: input.stateFacts,
    transcriptLabel: priorSummary ? "Incremental condensed transcript" : "Condensed transcript",
  });
  const modelCallId = `summary-${Date.now()}`;
  const systemPrompt = priorSummary ? INCREMENTAL_SUMMARIZER_SYSTEM_PROMPT : SUMMARIZER_SYSTEM_PROMPT;
  const userContent = priorSummary
    ? [
        "Update the existing session summary using the anchors and incremental transcript below. Do not invent facts.",
        "",
        material,
      ].join("\n")
    : `Summarize the following session material into a milestone-style history summary:\n\n${material}`;

  const result = (await input.model.completeStructured({
    context: {
      transcript,
      anchors,
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

  const hasToolCalls = Array.isArray(result.calls) && result.calls.length > 0;
  const modelText =
    typeof result.content === "string" && result.content.trim() ? result.content.trim() : "";

  if (!hasToolCalls && isUsableDialogueSummary(modelText)) {
    return { summaryText: modelText, modelCallId, usedDeterministicFallback: false };
  }

  return {
    summaryText: summarizeDialogueDeterministic(input.turns, {
      priorSummary,
      anchorTurns: input.anchorTurns,
      stateFacts: input.stateFacts,
    }),
    modelCallId,
    usedDeterministicFallback: true,
  };
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
  /** Complete execution rounds (stepId groups) moved into history — not Run count. */
  historyGroupCount: number;
  /** Complete execution rounds kept as recent ModelView. */
  recentGroupCount: number;
};

/**
 * Plan history vs recent split.
 *
 * Compression unit is the **complete execution round** (`stepId` group) plus token
 * thresholds — not the Run. `sourceRunIds` / ranges are provenance only.
 * `recentTurnCount` counts complete turn groups, not individual DialogueTurn messages.
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
      historyGroupCount: 0,
      recentGroupCount: groups.length,
    };
  }

  // Start from last N complete rounds, then shrink recent while over token budget
  // so excess rounds move into history (same-Run long tasks must compress mid-run).
  // Always keep ≥1 recent group (fail-open for the live tip of the dialogue).
  let recentStart = Math.max(0, groups.length - input.policy.recentTurnCount);
  while (
    recentStart < groups.length - 1 &&
    estimateDialogueTokens(flattenGroups(groups.slice(recentStart))) >
      input.policy.recentTokenBudget
  ) {
    recentStart += 1;
  }

  const historyGroups = groups.slice(0, recentStart);
  const recentGroups = groups.slice(recentStart);
  const historyTurns = flattenGroups(historyGroups);
  const recentTurns = flattenGroups(recentGroups);
  const sourceEventRanges = rangesFromTurns(historyTurns);
  const rangeHash = dialogueSourceRangeHash(sourceEventRanges);

  return {
    historyTurns,
    recentTurns,
    sourceEventRanges,
    rangeHash,
    needsCompression: historyTurns.length > 0,
    historyGroupCount: historyGroups.length,
    recentGroupCount: recentGroups.length,
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
  /** Optional reducer fact summaries for compression anchors. */
  stateFacts?: readonly string[];
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
  const stateFacts = input.stateFacts;

  let summaryText: string;
  let modelCallId: string;
  let parentCompressionId: string | undefined;

  if (prefix && prefix.coveredTurnCount < historyTurns.length) {
    const deltaTurns = historyTurns.slice(prefix.coveredTurnCount);
    const summarized = await summarizeDialogueWithModel({
      turns: deltaTurns,
      // Anchors from full history so incremental path is not tool-delta-only.
      anchorTurns: historyTurns,
      priorSummary: prefix.record.summaryText,
      model: input.model,
      modelPolicy: input.modelPolicy,
      stateFacts,
    });
    summaryText = summarized.summaryText;
    modelCallId = summarized.modelCallId;
    parentCompressionId = prefix.record.compressionId;
  } else {
    const summarized = await summarizeDialogueWithModel({
      turns: historyTurns,
      anchorTurns: historyTurns,
      model: input.model,
      modelPolicy: input.modelPolicy,
      stateFacts,
    });
    summaryText = summarized.summaryText;
    modelCallId = summarized.modelCallId;
  }

  // Final gate: never persist unusable text into reusable compression records.
  if (!isUsableDialogueSummary(summaryText)) {
    summaryText = summarizeDialogueDeterministic(historyTurns, {
      anchorTurns: historyTurns,
      stateFacts,
    });
    parentCompressionId = undefined;
  }

  const compressionId = `cmp-${input.plan.rangeHash.slice(0, 16)}`;
  const record: ContextCompressionRecord = {
    compressionId,
    summaryHash: sha256(summaryText),
    summaryText,
    // Run ids are provenance only; compression unit was step-groups above.
    sourceRunIds: [...new Set(historyTurns.map((t) => t.runId))],
    sourceEventRanges: input.plan.sourceEventRanges,
    ...(parentCompressionId ? { parentCompressionId } : {}),
    summarizerModelCallId: modelCallId,
    createdAt: new Date().toISOString(),
  };

  return { compression: record, isNew: true };
}
