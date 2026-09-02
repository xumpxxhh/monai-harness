import type { Action } from "@monai/contracts";

import { getToolCallInvocations } from "../model/normalize-action.js";

/**
 * Project an Action into user-facing copy (never raw JSON).
 * Prefer displayText; fall back to type-specific summaries.
 */
export function projectActionForUser(action: Action): string {
  if (action.displayText?.trim()) {
    return action.displayText.trim();
  }

  const args = action.arguments as Record<string, unknown> | undefined;

  switch (action.type) {
    case "tool.call": {
      const invocations = getToolCallInvocations(action);
      if (invocations.length === 0) {
        return `准备调用 ${action.toolId ?? "tool"}`;
      }
      const ids = [...new Set(invocations.map((c) => c.toolId))];
      return `准备调用 ${ids.join(", ")}`;
    }
    case "ask_user": {
      const prompt = typeof args?.prompt === "string" ? args.prompt : undefined;
      return prompt?.trim() || "需要您的输入";
    }
    case "finish": {
      const summary = typeof args?.summary === "string" ? args.summary : undefined;
      return summary?.trim() || "任务已完成";
    }
    case "noop":
      return "本步无需操作";
    case "spawn_child":
      return `委派：${action.childSpec?.goal ?? "子任务"}`;
    default:
      return "已决定下一步动作";
  }
}
