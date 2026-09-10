import crypto from "node:crypto";

import type {
  Action,
  DialogueTurn,
  EventEnvelope,
  ModelMessageToolCall,
  Observation,
  Run,
} from "@monai/contracts";

import { DEFAULT_CONTEXT_PROJECTION_POLICY } from "@monai/contracts";

import { getToolCallInvocations } from "../model/normalize-action.js";

export const DEFAULT_MAX_TOOL_CONTENT_CHARS =
  DEFAULT_CONTEXT_PROJECTION_POLICY.maxToolContentChars ?? 8_000;

function sha256(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function capToolContent(data: unknown, maxChars: number): string {
  const json = JSON.stringify(data ?? null);
  if (json.length <= maxChars) return json;
  return `${json.slice(0, maxChars)}…`;
}

function observationFromPayload(payload: unknown): Observation | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const obs = (payload as { observation?: Observation }).observation;
  return obs;
}

function actionFromPayload(payload: unknown): Action | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  return (payload as { action?: Action }).action;
}

function actionToToolCalls(
  action: Action,
  prepared: Array<{ toolCallId: string; toolId: string }>,
): ModelMessageToolCall[] {
  // Domain tools only. Control actions (finish / ask_user / noop / …) stay content-only in
  // ModelView so history never carries orphan toolCalls without tool results. Audit Events
  // still store the full Action on action.proposed.
  if (action.type !== "tool.call") return [];

  const invocations = getToolCallInvocations(action);
  const used = new Set<number>();
  return invocations.map((inv, index) => {
    let matchIndex = -1;
    const byOrder = prepared[index];
    if (byOrder && byOrder.toolId === inv.toolId && !used.has(index)) {
      matchIndex = index;
    } else {
      matchIndex = prepared.findIndex((p, i) => p.toolId === inv.toolId && !used.has(i));
    }
    if (matchIndex >= 0) used.add(matchIndex);
    const match = matchIndex >= 0 ? prepared[matchIndex] : undefined;
    return {
      id: match?.toolCallId ?? `call-${index}`,
      type: "function" as const,
      function: {
        name: inv.toolId,
        arguments: JSON.stringify(inv.arguments ?? {}),
      },
    };
  });
}

function assistantContent(action: Action | undefined, display?: string): string | undefined {
  if (display?.trim()) return display.trim();
  if (action?.displayText?.trim()) return action.displayText.trim();
  return undefined;
}

/**
 * Project committed Events into canonical dialogue turns for one Run.
 */
export function projectDialogueFromEvents(input: {
  run: Run;
  events: readonly EventEnvelope[];
  maxToolContentChars?: number;
}): DialogueTurn[] {
  const maxToolContentChars = input.maxToolContentChars ?? DEFAULT_MAX_TOOL_CONTENT_CHARS;
  const turns: DialogueTurn[] = [];
  const sorted = [...input.events].sort((a, b) => a.sequence - b.sequence);

  turns.push({
    turnId: `turn-goal-${input.run.runId}`,
    runId: input.run.runId,
    role: "user",
    content: input.run.goal,
    sourceEventIds: [],
    sequenceRange: { from: 0, to: 0 },
  });

  const preparedByStep = new Map<string, Array<{ toolCallId: string; toolId: string }>>();
  const toolIdByCallId = new Map<string, string>();
  for (const event of sorted) {
    if (event.eventType !== "tool.call_prepared" || !event.stepId) continue;
    const payload = event.payload as { toolCallId?: string; toolId?: string } | undefined;
    // prepare-tool-calls puts toolCallId on the Event envelope; payload may omit it.
    const toolCallId = event.toolCallId ?? payload?.toolCallId;
    const toolId = payload?.toolId;
    if (!toolCallId || !toolId) continue;
    const bucket = preparedByStep.get(event.stepId) ?? [];
    bucket.push({ toolCallId, toolId });
    preparedByStep.set(event.stepId, bucket);
    toolIdByCallId.set(toolCallId, toolId);
  }

  const assistantByStep = new Set<string>();

  for (const event of sorted) {
    if (event.eventType === "action.proposed" && event.stepId) {
      if (assistantByStep.has(event.stepId)) continue;
      assistantByStep.add(event.stepId);

      const action = actionFromPayload(event.payload);
      // Prefer the latest model.responded for this step (retries may emit several).
      const responded = [...sorted]
        .reverse()
        .find((e) => e.eventType === "model.responded" && e.stepId === event.stepId);
      const respondedPayload =
        responded && typeof responded.payload === "object" && responded.payload
          ? (responded.payload as { display?: unknown; reasoning?: unknown })
          : undefined;
      const display =
        typeof respondedPayload?.display === "string" ? respondedPayload.display : undefined;
      const reasoning =
        typeof respondedPayload?.reasoning === "string" && respondedPayload.reasoning.trim()
          ? respondedPayload.reasoning.trim()
          : undefined;

      const toolCalls = action ? actionToToolCalls(action, preparedByStep.get(event.stepId) ?? []) : [];
      const content = assistantContent(action, display);
      const projectedCalls = toolCalls.map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: JSON.parse(tc.function.arguments || "{}") as unknown,
      }));

      turns.push({
        turnId: `turn-asst-${event.stepId}`,
        runId: input.run.runId,
        stepId: event.stepId,
        role: "assistant",
        content,
        ...(reasoning ? { reasoning } : {}),
        ...(projectedCalls.length > 0 ? { toolCalls: projectedCalls } : {}),
        sourceEventIds: [event.eventId, ...(responded ? [responded.eventId] : [])],
        sequenceRange: { from: event.sequence, to: responded?.sequence ?? event.sequence },
      });
    }

    if (event.eventType === "observation.recorded") {
      const observation = observationFromPayload(event.payload);
      if (!observation) continue;

      if (observation.source.kind === "user") {
        const data = observation.data as { value?: unknown } | undefined;
        const value =
          typeof data?.value === "string"
            ? data.value
            : data?.value !== undefined
              ? JSON.stringify(data.value)
              : "";
        turns.push({
          turnId: `turn-user-${observation.observationId}`,
          runId: input.run.runId,
          stepId: event.stepId,
          role: "user",
          content: value,
          sourceEventIds: [event.eventId],
          sequenceRange: { from: event.sequence, to: event.sequence },
        });
        continue;
      }

      if (observation.source.kind === "tool") {
        const toolCallId = event.toolCallId;
        const toolName =
          (toolCallId ? toolIdByCallId.get(toolCallId) : undefined) ??
          (typeof (observation.data as { toolId?: unknown } | undefined)?.toolId === "string"
            ? String((observation.data as { toolId: string }).toolId)
            : undefined) ??
          observation.source.sourceId;
        turns.push({
          turnId: `turn-tool-${observation.observationId}`,
          runId: input.run.runId,
          stepId: event.stepId,
          role: "tool",
          content: capToolContent(observation.data, maxToolContentChars),
          toolCallId,
          toolName,
          sourceEventIds: [event.eventId],
          sequenceRange: { from: event.sequence, to: event.sequence },
        });
      }
    }
  }

  return turns;
}

export function estimateDialogueTokens(turns: readonly DialogueTurn[]): number {
  let total = 0;
  for (const turn of turns) {
    total += Math.ceil((turn.content?.length ?? 0) / 4);
    total += Math.ceil((turn.reasoning?.length ?? 0) / 4);
    if (turn.toolCalls) {
      total += turn.toolCalls.length * 32;
    }
  }
  return total;
}

export function dialogueSourceRangeHash(
  ranges: Array<{ runId: string; fromSequence: number; toSequence: number }>,
): string {
  return sha256(JSON.stringify(ranges));
}
