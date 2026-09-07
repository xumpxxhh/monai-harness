import type { ContextSection, PackToolDefinition } from "@monai/contracts";

export type SystemPromptLayerKind =
  | "safety"
  | "identity"
  | "catalog"
  | "guidelines"
  | "skills"
  | "knowledge"
  | "memory";

export type SystemPromptLayer = {
  kind: SystemPromptLayerKind;
  text: string;
};

const SECTION_TO_LAYER: Record<string, SystemPromptLayerKind> = {
  safety_boundary: "safety",
  tools: "catalog",
  skills: "skills",
  knowledge: "knowledge",
  memory: "memory",
};

/** Pack guidelines for allowlisted tools that declare systemPrompt. */
export function collectPackGuidelines(
  toolAllowlist: readonly string[] | undefined,
  toolDefs: readonly PackToolDefinition[] | undefined,
): string | undefined {
  const allow = new Set(toolAllowlist ?? []);
  const blocks: string[] = [];
  for (const def of toolDefs ?? []) {
    if (!allow.has(def.toolId)) continue;
    if (typeof def.systemPrompt === "string" && def.systemPrompt.trim()) {
      blocks.push(def.systemPrompt.trim());
    }
  }
  if (blocks.length === 0) return undefined;
  return blocks.join("\n\n");
}

function sectionText(sections: readonly ContextSection[], kind: string): string | undefined {
  const section = sections.find((s) => s.kind === kind && s.text?.trim());
  return section?.text?.trim();
}

/**
 * Assemble the single system message: safety → identity → tools → Pack guidelines → skills/knowledge/memory.
 * Pack guidelines are not part of Core identity; they are allowlist-gated.
 */
export function assembleSystemMessage(input: {
  identity: string;
  sections: readonly ContextSection[];
  toolAllowlist?: readonly string[];
  toolDefs?: readonly PackToolDefinition[];
}): { text: string; layers: SystemPromptLayer[] } {
  const layers: SystemPromptLayer[] = [];

  const safety = sectionText(input.sections, "safety_boundary");
  if (safety) {
    layers.push({ kind: "safety", text: `[safety_boundary]\n${safety}` });
  }

  const identity = input.identity.trim();
  if (identity) {
    layers.push({ kind: "identity", text: identity });
  }

  const tools = sectionText(input.sections, "tools");
  if (tools) {
    layers.push({ kind: "catalog", text: `[tools]\n${tools}` });
  }

  const guidelines = collectPackGuidelines(input.toolAllowlist, input.toolDefs);
  if (guidelines) {
    layers.push({ kind: "guidelines", text: guidelines });
  }

  for (const kind of ["skills", "knowledge", "memory"] as const) {
    const text = sectionText(input.sections, kind);
    if (!text) continue;
    layers.push({
      kind: SECTION_TO_LAYER[kind]!,
      text: `[${kind}]\n${text}`,
    });
  }

  return {
    text: layers.map((l) => l.text).join("\n\n"),
    layers,
  };
}
