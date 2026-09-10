/**
 * Wire-safe toolId / permission token for OpenAI-compatible function.name.
 * Underscore namespaces only — no dots (DeepSeek / OpenAI / Anthropic reject `.`).
 */
export const WIRE_TOOL_ID_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/;

export function isValidWireToolId(toolId: string): boolean {
  return WIRE_TOOL_ID_PATTERN.test(toolId);
}
