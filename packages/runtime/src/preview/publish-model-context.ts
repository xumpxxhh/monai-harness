import type { Action, ModelMessage } from "@monai/contracts";

import { assistantMessageFromAction } from "../context/project-messages.js";
import type { PreviewHub } from "./preview-hub.js";

export type ModelContextStatus = "committed" | "invalid" | "failed";

export function buildModelContextMessages(input: {
  messages: readonly ModelMessage[];
  action?: Action;
  display?: string;
  reasoning?: string;
}): ModelMessage[] {
  const response =
    input.action !== undefined
      ? assistantMessageFromAction(input.action, input.display, input.reasoning)
      : input.display?.trim() || input.reasoning?.trim()
        ? {
            role: "assistant" as const,
            ...(input.display?.trim() ? { content: input.display.trim() } : {}),
            ...(input.reasoning?.trim() ? { reasoning: input.reasoning.trim() } : {}),
          }
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
      reasoning: input.reasoning,
    }),
    status: input.status,
    ...(input.reasoning ? { reasoning: input.reasoning } : {}),
    ...(input.reason ? { reason: input.reason } : {}),
  });
}
