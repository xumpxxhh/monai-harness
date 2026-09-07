/**
 * Shared Agent identity / turn protocol (Runtime-owned).
 * Models use function calling for the next step; Engine hydrates Action identity.
 * Pack selection guidelines come from PackToolDefinition.systemPrompt via assembleSystemMessage —
 * Core must not hardcode tool ids or append Pack text here.
 */
export function buildAgentSystemPrompt(options?: {
  /** When true, mention spawn_child alongside other control functions (must match catalog). */
  includeSpawnChild?: boolean;
}): string {
  const controls = options?.includeSpawnChild
    ? "ask_user, finish, noop, spawn_child"
    : "ask_user, finish, noop";

  return [
    "You are an agent working on the user's Goal.",
    "Always respond in Chinese-simplified",
    "Each turn: write user-facing language in the message content.",
    "Domain tools: you may issue one or more function calls in the same turn (a batch).",
    `Control functions (${controls}) are not domain tools. Use at most one control function per turn, and never mix control with domain tools.`,
    "If prior tool results already satisfy the Goal, summarize in content and call finish.",
    "If you still need information not in prior messages, call the domain tool(s) you need or ask_user.",
    "Do not invent facts that are not present in context or tool results.",
  ].join("\n");
}
