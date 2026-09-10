import type { ModelDecision } from "@monai/ports";

import type { PreviewHub } from "./preview-hub.js";

export type ModelContextStatus = "committed" | "invalid" | "failed";

export type ModelWireRequest = {
  url: string;
  body: unknown;
};

export function publishModelContext(
  hub: PreviewHub | undefined,
  input: {
    runId: string;
    stepId: string;
    modelCallId: string;
    contextHash: string;
    status: ModelContextStatus;
    request?: ModelWireRequest;
    response?: ModelDecision;
    reason?: string;
  },
): void {
  hub?.publish({
    type: "model_context",
    runId: input.runId,
    stepId: input.stepId,
    modelCallId: input.modelCallId,
    contextHash: input.contextHash,
    status: input.status,
    ...(input.request ? { request: input.request } : {}),
    ...(input.response ? { response: input.response } : {}),
    ...(input.reason ? { reason: input.reason } : {}),
  });
}
