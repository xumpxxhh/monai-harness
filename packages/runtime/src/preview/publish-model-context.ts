import type { Action, ModelMessage } from "@monai/contracts";

import { assistantMessageFromAction } from "../context/project-messages.js";
import type { PreviewHub } from "./preview-hub.js";

export type ModelContextStatus = "committed" | "invalid" | "failed";

export function buildModelContextMessages(input: {
  messages: readonly ModelMessage[];
  action?: Action;
  display?: string;
}): ModelMessage[] {
  const response =
    input.action !== undefined
      ? assistantMessageFromAction(input.action, input.display)
      : input.display?.trim()
        ? { role: "assistant" as const, content: input.display.trim() }
        : undefined;

  return response ? [...input.messages, response] : [...input.messages];
}

export function publishModelContext(
  hub: PreviewHub | undefined,
  input: {
    runId: string;
    stepId: string;
    modelCallId: string;
    contextHash: string;
    messages: readonly ModelMessage[];
    status: ModelContextStatus;
    action?: Action;
    display?: string;
    reasoning?: string;
    reason?: string;
  },
): void {
  hub?.publish({
    type: "model_context",
    runId: input.runId,
    stepId: input.stepId,
    modelCallId: input.modelCallId,
    contextHash: input.contextHash,
    messages: buildModelContextMessages({
      messages: input.messages,
      action: input.action,
      display: input.display,
    }),
    status: input.status,
    ...(input.reasoning ? { reasoning: input.reasoning } : {}),
    ...(input.reason ? { reason: input.reason } : {}),
  });
}
