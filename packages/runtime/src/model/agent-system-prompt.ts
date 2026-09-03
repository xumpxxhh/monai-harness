import type { PackToolDefinition } from "@monai/contracts";

/**
 * Shared Agent decision prompt (Runtime-owned).
 * Models use function calling for the next step; Engine hydrates Action identity.
 * Pack-specific rules come from PackToolDefinition.systemPrompt — Core must not hardcode tool ids.
 */
export function buildAgentSystemPrompt(options?: {
  toolAllowlist?: readonly string[];
  toolDefs?: readonly PackToolDefinition[];
}): string {
  const lines = [
    "You are an agent working on the user's Goal.",
    "Each turn: write user-facing language in the message content.",
    "Domain tools: you may issue one or more function calls in the same turn (a batch).",
    "Control functions (ask_user, finish, noop, spawn_child) are not domain tools. Use exactly one control function per turn, and never mix control with domain tools.",
    "Read prior messages before choosing tools. Tool results appear as tool role messages; do not re-call the same tool with the same arguments.",
    "Calling the same tool with different arguments (e.g. workspace.read on different paths) is allowed when you still need that information.",
    "Each turn must either call domain tool(s), exactly one control function, or give a substantive answer in content (the runtime treats that as finish when no tools are pending).",
    "When you can answer from context (including listing available tools from the tools schema), put the answer in content; calling finish explicitly is optional.",
    "If prior tool results already satisfy the Goal, summarize in content and call finish.",
    "If you still need information not in prior messages, call the domain tool(s) you need or ask_user.",
  ];

  const allow = new Set(options?.toolAllowlist ?? []);
  for (const def of options?.toolDefs ?? []) {
    if (!allow.has(def.toolId)) continue;
    if (typeof def.systemPrompt === "string" && def.systemPrompt.trim()) {
      lines.push("", def.systemPrompt.trim());
    }
  }

  return lines.join("\n");
}
