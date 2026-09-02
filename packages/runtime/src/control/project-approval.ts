import type { Action, ApprovalRecord, EventEnvelope } from "@monai/contracts";

import { getToolCallInvocations } from "../model/normalize-action.js";

export type ApprovalDisplayLine = {
  label: string;
  value: string;
};

export type ApprovalDisplayInput = {
  goal: string;
  action: Action;
  approval: ApprovalRecord;
  policyReason?: string;
  reasoning?: string;
  modelDisplay?: string;
};

const MAX_LINE_CHARS = 160;

function truncate(text: string, max = MAX_LINE_CHARS): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  if (!oneLine) return "";
  return oneLine.length <= max ? oneLine : `${oneLine.slice(0, max - 1)}…`;
}

function isGenericToolPrep(text: string): boolean {
  return /^准备调用\s+\S+/.test(text.trim());
}

function resolveAgentIntent(input: {
  action: Action;
  reasoning?: string;
  modelDisplay?: string;
}): string | undefined {
  const display = input.action.displayText?.trim() || input.modelDisplay?.trim();
  if (display && !isGenericToolPrep(display)) {
    return display;
  }
  if (input.reasoning?.trim()) {
    return input.reasoning.trim();
  }
  if (display) {
    return display;
  }
  return undefined;
}

function formatToolArguments(args: unknown): string | undefined {
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    return undefined;
  }
  const record = args as Record<string, unknown>;
  if (Object.keys(record).length === 0) {
    return undefined;
  }
  return truncate(JSON.stringify(record));
}

/**
 * Extract model/policy context for the step that triggered approval.
 */
export function extractApprovalStepContext(
  events: readonly EventEnvelope[],
  stepId: string,
): Pick<ApprovalDisplayInput, "policyReason" | "reasoning" | "modelDisplay"> {
  let policyReason: string | undefined;
  let reasoning: string | undefined;
  let modelDisplay: string | undefined;

  for (const event of events) {
    if (event.stepId !== stepId || !event.payload || typeof event.payload !== "object") {
      continue;
    }
    const payload = event.payload as Record<string, unknown>;

    if (event.eventType === "policy.evaluated" && typeof payload.reason === "string") {
      policyReason = payload.reason;
    }
    if (event.eventType === "model.responded") {
      if (typeof payload.reasoning === "string" && payload.reasoning.trim()) {
        reasoning = payload.reasoning.trim();
      }
      if (typeof payload.display === "string" && payload.display.trim()) {
        modelDisplay = payload.display.trim();
      }
    }
  }

  return { policyReason, reasoning, modelDisplay };
}

/**
 * Project approval wait state into user-facing CLI lines.
 */
export function projectApprovalDisplay(input: ApprovalDisplayInput): ApprovalDisplayLine[] {
  const lines: ApprovalDisplayLine[] = [];

  lines.push({ label: "任务", value: truncate(input.goal) });

  const intent = resolveAgentIntent({
    action: input.action,
    reasoning: input.reasoning,
    modelDisplay: input.modelDisplay,
  });
  if (intent) {
    lines.push({ label: "调用原因", value: truncate(intent) });
  }

  if (input.policyReason?.trim()) {
    lines.push({ label: "审批原因", value: truncate(input.policyReason) });
  }

  const invocations = getToolCallInvocations(input.action);
  if (invocations.length === 0 && input.action.toolId) {
    lines.push({ label: "工具", value: input.action.toolId });
    const argsSummary = formatToolArguments(input.action.arguments);
    if (argsSummary) {
      lines.push({ label: "参数", value: argsSummary });
    }
  } else {
    for (const [index, invocation] of invocations.entries()) {
      const toolLabel = invocations.length > 1 ? `工具 ${index + 1}` : "工具";
      lines.push({ label: toolLabel, value: invocation.toolId });
      const argsSummary = formatToolArguments(invocation.arguments);
      if (argsSummary) {
        lines.push({ label: "参数", value: argsSummary });
      }
    }
  }

  lines.push({ label: "风险", value: input.approval.riskLevel });

  return lines;
}
