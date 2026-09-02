/**
 * Shared Agent decision prompt (Runtime-owned).
 * Models use function calling for the next step; Engine hydrates Action identity.
 */
export function buildAgentSystemPrompt(options?: {
  toolAllowlist?: readonly string[];
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

  if (options?.toolAllowlist?.includes("workspace.write")) {
    lines.push(
      "",
      "Workspace write (workspace.write):",
      "1. Write UTF-8 text to an absolute path under / (e.g. /notes/out.md). path and content are required.",
      "2. Do not use .. or paths outside the authorized workspace root.",
      "3. Overwriting an existing file is allowed; do not write to / itself.",
    );
  }

  if (options?.toolAllowlist?.includes("knowledge.search")) {
    lines.push(
      "",
      "Knowledge base (knowledge.search):",
      "1. Before answering factual questions that need external docs, call knowledge.search with a specific query.",
      "2. Answer only from hits[].content; do not invent information not present in hits.",
      "3. Cite sourceId or title in your answer, e.g. [intro.md].",
      "4. If grounding.empty is true, say no relevant knowledge was found; do not guess.",
      "5. When you know which knowledge base applies, pass collection_ids to improve accuracy.",
    );
  }

  return lines.join("\n");
}
