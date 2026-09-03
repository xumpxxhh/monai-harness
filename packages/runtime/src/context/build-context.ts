import crypto from "node:crypto";
import type { ContextContribution } from "@monai/pack-sdk";
import {
  CONTRACTS_SCHEMA_VERSION,
  type ContextBudget,
  type ContextBuildRecord,
  type ContextBuildTruncation,
  type ContextDialogueSource,
  type ContextProjectionPolicy,
  type ContextSection,
  type ContextSectionKind,
  type ExecutionManifest,
  type ModelPolicy,
  type Run,
  type RunState,
} from "@monai/contracts";

export interface BuildContextInput {
  run: Run;
  stepId: string;
  state: RunState;
  manifest?: ExecutionManifest;
  toolAllowlist: readonly string[];
  hookContributions?: ContextContribution[];
  budget?: ContextBudget;
  modelPolicy?: ModelPolicy;
  projectionPolicy?: ContextProjectionPolicy;
  dialogueSource?: ContextDialogueSource;
  compressionRef?: string;
  memoryEnabled?: boolean;
}

export interface TurnContext {
  tenantId: string;
  sessionId: string;
  runId: string;
  stepId: string;
  goal: string;
  state: RunState;
  toolAllowlist: readonly string[];
  hookContributions: ContextContribution[];
  sections: ContextSection[];
  contextHash: string;
  totalTokens: number;
}

export interface ContextBuildResult {
  context: TurnContext;
  record: ContextBuildRecord;
  sections: ContextSection[];
  truncations: ContextBuildTruncation[];
  totalTokens: number;
  contextHash: string;
  overflow: boolean;
  overflowReason?: string;
}

function estimateTokens(text: string): number {
  if (!text) return 0;
  // Rough estimate: ~4 chars per token for English/code, ~1.5 for CJK
  return Math.ceil(text.length / 3.5);
}

function sha256(content: string): string {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}

/** Core stub arg hint only; Pack tools use PackToolDefinition.argHint via manifest.tools. */
const CORE_TOOL_ARG_HINTS: Record<string, string> = {
  echo: 'args: {"text":"..."}',
};

function formatToolsSection(
  toolAllowlist: readonly string[],
  manifest?: ExecutionManifest,
): string {
  const effectById = new Map<string, string>();
  const hintById = new Map<string, string>();
  for (const tool of manifest?.tools ?? []) {
    effectById.set(tool.toolId, tool.effectContract.sideEffectProfile);
    if (typeof tool.argHint === "string" && tool.argHint.trim()) {
      hintById.set(tool.toolId, tool.argHint.trim());
    }
  }

  const lines = toolAllowlist.map((toolId) => {
    const effect = effectById.get(toolId);
    const hint = hintById.get(toolId) ?? CORE_TOOL_ARG_HINTS[toolId];
    const parts = [toolId];
    if (effect) parts.push(`effect=${effect}`);
    if (hint) parts.push(hint);
    return `- ${parts.join(" | ")}`;
  });

  return `Available Tools:\n${lines.join("\n")}`;
}

function formatFactData(data: unknown): string {
  if (data === null || data === undefined) return "";
  if (typeof data !== "object") return `   ${String(data)}`;

  const obj = data as Record<string, unknown>;

  if (Array.isArray(obj.entries)) {
    const path = typeof obj.path === "string" ? obj.path : "/";
    const entries = obj.entries as Array<{ name?: string; path?: string; kind?: string }>;
    const listed = entries
      .map((e) => `   - ${e.kind ?? "entry"}: ${e.path ?? e.name ?? "?"}`)
      .join("\n");
    return `   path: ${path}\n${listed || "   (empty)"}`;
  }

  if (typeof obj.content === "string") {
    const pathLine = typeof obj.path === "string" ? `   path: ${obj.path}\n` : "";
    const content =
      obj.content.length > 500 ? `${obj.content.slice(0, 500)}…` : obj.content;
    const indented = content
      .split("\n")
      .map((line) => `   ${line}`)
      .join("\n");
    return `${pathLine}   content:\n${indented}`;
  }

  if (Array.isArray(obj.hits)) {
    const query = typeof obj.query === "string" ? obj.query : "";
    const hits = obj.hits as Array<Record<string, unknown>>;
    const isKnowledgeHit =
      hits.length > 0 &&
      (typeof hits[0]?.sourceId === "string" || typeof hits[0]?.content === "string");

    if (isKnowledgeHit) {
      const listed = hits
        .slice(0, 6)
        .map((h) => {
          const sourceId = String(h.sourceId ?? h.title ?? "?");
          const title = typeof h.title === "string" && h.title !== sourceId ? ` (${h.title})` : "";
          const content =
            typeof h.content === "string"
              ? h.content.length > 120
                ? `${h.content.slice(0, 120)}…`
                : h.content
              : "";
          return `   - [${sourceId}]${title}${content ? `: ${content}` : ""}`;
        })
        .join("\n");
      const grounding =
        typeof obj.grounding === "object" && obj.grounding !== null
          ? (obj.grounding as { empty?: boolean })
          : undefined;
      const emptyLine =
        grounding?.empty === true ? "\n   (grounding.empty — no usable hits)" : "";
      return `   query: ${query}\n${listed || "   (no hits)"}${emptyLine}`;
    }

    const workspaceHits = hits as Array<{ path?: string; snippet?: string }>;
    const listed = workspaceHits
      .slice(0, 8)
      .map((h) => `   - ${h.path ?? "?"}${h.snippet ? `: ${String(h.snippet).slice(0, 80)}` : ""}`)
      .join("\n");
    return `   query: ${query}\n${listed || "   (no hits)"}`;
  }

  const json = JSON.stringify(data, null, 2);
  const capped = json.length > 800 ? `${json.slice(0, 800)}…` : json;
  return capped
    .split("\n")
    .map((line) => `   ${line}`)
    .join("\n");
}

/** Model-facing projection of accepted facts (schema data stays intact in State). */
export function formatRecentFacts(facts: RunState["facts"]): string {
  const recent = facts.slice(-20);
  if (recent.length === 0) return "";

  const blocks = recent.map((fact, idx) => {
    const header = `${idx + 1}. [${fact.factType}] ${fact.summary}`;
    const body = formatFactData(fact.data);
    return body ? `${header}\n${body}` : header;
  });

  return [
    "Recent Facts (already observed — do not re-call the same tool with the same arguments):",
    ...blocks,
  ].join("\n");
}

/**
 * Context Builder — design 05 §3 assembly, section priority & budget truncation.
 */
export function buildContext(input: BuildContextInput): ContextBuildResult {
  const run = input.run;
  const stepId = input.stepId;
  const state = input.state;
  const toolAllowlist = input.toolAllowlist;
  const hookContributions = input.hookContributions ?? [];

  const maxTotalTokens =
    input.budget?.maxTotalTokens ??
    input.projectionPolicy?.maxTotalTokens ??
    (typeof (run.budgets as { maxTokens?: number } | undefined)?.maxTokens === "number"
      ? (run.budgets as { maxTokens?: number }).maxTokens!
      : 8192);

  const hardMaxTokens = input.budget?.hardMaxTokens ?? maxTotalTokens;

  // Assemble candidate sections by priority (design 05 §3.3)
  // Priority 1: safety_boundary (never truncated)
  const safetyText = `Safety Boundary: Tenant ${run.tenantId}. Respect sandbox isolation and tool allowlist.`;
  const safetySection: ContextSection = {
    kind: "safety_boundary",
    text: safetyText,
    hash: sha256(safetyText),
    tokenCount: estimateTokens(safetyText),
  };

  // Priority 2: user_input
  const userText = `Goal / User Input: ${run.goal}`;
  const userSection: ContextSection = {
    kind: "user_input",
    text: userText,
    hash: sha256(userText),
    tokenCount: estimateTokens(userText),
  };

  // Priority 3: state_summary
  const stateText = `Current State Summary:\n- Step count: ${state.cursor?.stepCount ?? 0}\n- Facts count: ${state.facts?.length ?? 0}\n- Last fact ID: ${state.lastFactId ?? "none"}`;
  const stateSection: ContextSection = {
    kind: "state_summary",
    text: stateText,
    hash: sha256(stateText),
    tokenCount: estimateTokens(stateText),
  };

  // Priority 4: tools
  const toolsText = formatToolsSection(toolAllowlist, input.manifest);
  const toolsSection: ContextSection = {
    kind: "tools",
    text: toolsText,
    hash: sha256(toolsText),
    tokenCount: estimateTokens(toolsText),
  };

  // Priority 5: skills (if any hook contribution is skill guide)
  const skillContribs = hookContributions.filter(
    (c) => c.sourceId?.toLowerCase().includes("skill") || c.priority === 5,
  );
  const skillText = skillContribs.length > 0 ? `Skill Guides: ${JSON.stringify(skillContribs)}` : "";
  const skillSection: ContextSection | null = skillText
    ? {
        kind: "skills",
        text: skillText,
        hash: sha256(skillText),
        tokenCount: estimateTokens(skillText),
      }
    : null;

  // Priority 6: knowledge (for this slice: empty)
  const knowledgeSection: ContextSection | null = null;

  // Priority 7: recent_events (readable projection of accepted facts)
  const recentEventsText = formatRecentFacts(state.facts ?? []);
  const recentEventsSection: ContextSection | null = recentEventsText
    ? {
        kind: "recent_events",
        text: recentEventsText,
        hash: sha256(recentEventsText),
        tokenCount: estimateTokens(recentEventsText),
      }
    : null;

  // Priority 8: memory (MVP closed)
  const memorySection: ContextSection | null = null;

  // Priority 9: history
  const historyText = "";
  const historySection: ContextSection | null = null;

  // List of all candidate sections in ascending order of truncation priority (low priority truncated first)
  const truncatableSections: Array<{
    section: ContextSection;
    canTruncate: boolean;
  }> = [];

  // Low priority first for truncation:
  if (historySection) truncatableSections.push({ section: historySection, canTruncate: true });
  if (memorySection) truncatableSections.push({ section: memorySection, canTruncate: true });
  if (recentEventsSection) truncatableSections.push({ section: recentEventsSection, canTruncate: true });
  if (knowledgeSection) truncatableSections.push({ section: knowledgeSection, canTruncate: true });
  if (skillSection) truncatableSections.push({ section: skillSection, canTruncate: true });
  if (toolsSection) truncatableSections.push({ section: toolsSection, canTruncate: false }); // keep tools
  if (stateSection) truncatableSections.push({ section: stateSection, canTruncate: false });
  if (userSection) truncatableSections.push({ section: userSection, canTruncate: false });
  if (safetySection) truncatableSections.push({ section: safetySection, canTruncate: false });

  // Compute total tokens
  let currentTokens =
    safetySection.tokenCount +
    userSection.tokenCount +
    stateSection.tokenCount +
    toolsSection.tokenCount +
    (skillSection?.tokenCount ?? 0) +
    (recentEventsSection?.tokenCount ?? 0);

  const truncations: ContextBuildTruncation[] = [];
  const activeSections: ContextSection[] = [safetySection, userSection, stateSection, toolsSection];
  if (skillSection) activeSections.push(skillSection);
  if (recentEventsSection) activeSections.push(recentEventsSection);

  // If exceeding maxTotalTokens, perform truncation from lowest priority
  if (currentTokens > maxTotalTokens) {
    for (const item of truncatableSections) {
      if (currentTokens <= maxTotalTokens) break;
      if (!item.canTruncate) continue;

      const idx = activeSections.findIndex((s) => s.kind === item.section.kind);
      if (idx >= 0) {
        const removed = activeSections.splice(idx, 1)[0];
        currentTokens -= removed.tokenCount;
        truncations.push({
          sectionKind: removed.kind,
          originalTokens: removed.tokenCount,
          truncatedTokens: removed.tokenCount,
          reason: `truncated due to ContextBudget limit ${maxTotalTokens}`,
        });
      }
    }
  }

  // Check hardMaxTokens overflow
  let overflow = false;
  let overflowReason: string | undefined;
  if (currentTokens > hardMaxTokens) {
    overflow = true;
    overflowReason = `Context token count ${currentTokens} exceeds hardMaxTokens limit ${hardMaxTokens}`;
  }

  const allSectionsContent = activeSections.map((s) => `${s.kind}:${s.hash}`).join("|");
  const contextHash = sha256(allSectionsContent);

  const modelPolicy = input.modelPolicy ?? {
    version: "1.0.0",
    resolvedTarget: "stub",
    digest: "digest:model-policy:default",
  };

  const record: ContextBuildRecord = {
    schemaVersion: CONTRACTS_SCHEMA_VERSION,
    contextBuildId: `ctx-${stepId}-${Date.now()}`,
    runId: run.runId,
    stepId,
    executionManifestRef: input.manifest?.manifestId ?? run.executionManifestRef,
    executionManifestHash: input.manifest?.hash ?? "hash:manifest:default",
    agentDefinition: input.manifest?.agentDefinition ?? {
      agentDefinitionId: run.agentDefinitionId,
      version: run.agentVersion,
      digest: `digest:${run.agentDefinitionId}@${run.agentVersion}`,
    },
    packVersions: input.manifest?.packVersions ?? run.packVersions.map((p) => ({
      packId: p.packId,
      version: p.version,
      digest: `digest:${p.packId}@${p.version}`,
    })),
    modelPolicy: {
      version: modelPolicy.version,
      resolvedTarget: modelPolicy.resolvedTarget,
      digest: modelPolicy.digest ?? sha256(`${modelPolicy.version}:${modelPolicy.resolvedTarget}`),
    },
    strategy: input.manifest?.strategy ?? {
      type: run.strategy.type,
      version: run.strategy.version,
    },
    contextBuilder: {
      version: "0.1.0",
      digest: "digest:context-builder:0.1.0",
    },
    stateHash: sha256(JSON.stringify(state)),
    selectedTools: toolAllowlist.map((toolId) => ({
      toolId,
      version: "0.1.0",
      digest: `digest:tool:${toolId}`,
    })),
    contextHash,
    totalTokens: currentTokens,
    truncations,
    projectionPolicy: input.projectionPolicy,
    dialogueSource: input.dialogueSource,
    compressionRef: input.compressionRef,
    memoryContributions: [],
    memoryEnabled: input.memoryEnabled ?? false,
    createdAt: new Date().toISOString(),
  };

  const turnContext: TurnContext = {
    tenantId: run.tenantId,
    sessionId: run.sessionId,
    runId: run.runId,
    stepId,
    goal: run.goal,
    state,
    toolAllowlist,
    hookContributions,
    sections: activeSections,
    contextHash,
    totalTokens: currentTokens,
  };

  return {
    context: turnContext,
    record,
    sections: activeSections,
    truncations,
    totalTokens: currentTokens,
    contextHash,
    overflow,
    overflowReason,
  };
}
