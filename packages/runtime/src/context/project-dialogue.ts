import crypto from "node:crypto";

import type {
  Action,
  DialogueTurn,
  EventEnvelope,
  ModelMessageToolCall,
  Observation,
  Run,
} from "@monai/contracts";

import { getToolCallInvocations } from "../model/normalize-action.js";

const MAX_TOOL_CONTENT_CHARS = 8_000;

function sha256(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function capToolContent(data: unknown): string {
  const json = JSON.stringify(data ?? null);
  if (json.length <= MAX_TOOL_CONTENT_CHARS) return json;
  return `${json.slice(0, MAX_TOOL_CONTENT_CHARS)}…`;
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

function controlCallName(action: Action): string | undefined {
  switch (action.type) {
    case "ask_user":
      return "ask_user";
    case "finish":
      return "finish";
    case "noop":
      return "noop";
    case "spawn_child":
      return "spawn_child";
    default:
      return undefined;
  }
}

function actionToToolCalls(
  action: Action,
  prepared: Array<{ toolCallId: string; toolId: string }>,
): ModelMessageToolCall[] {
  if (action.type === "tool.call") {
    const invocations = getToolCallInvocations(action);
    return invocations.map((inv, index) => {
      const match =
        prepared.find((p) => p.toolId === inv.toolId) ?? prepared[index];
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

  const controlName = controlCallName(action);
  if (!controlName) return [];

  return [
    {
      id: `ctrl-${action.actionId}`,
      type: "function",
      function: {
        name: controlName,
        arguments: JSON.stringify(controlArguments(action)),
      },
    },
  ];
}

function controlArguments(action: Action): unknown {
  switch (action.type) {
    case "ask_user":
      return { prompt: action.displayText ?? "" };
    case "finish":
      return { summary: action.displayText ?? "" };
    case "noop":
      return {};
    case "spawn_child":
      return action.childSpec ?? {};
    default:
      return {};
  }
}

function assistantContent(action: Action | undefined, display?: string): string | undefined {
  if (display?.trim()) return display.trim();
  if (action?.displayText?.trim()) return action.displayText.trim();
  if (action?.type === "finish" && action.displayText?.trim()) {
    return action.displayText.trim();
  }
  return undefined;
}

/**
 * Project committed Events into canonical dialogue turns for one Run.
 */
export function projectDialogueFromEvents(input: {
  run: Run;
  events: readonly EventEnvelope[];
}): DialogueTurn[] {
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
  for (const event of sorted) {
    if (event.eventType !== "tool.call_prepared" || !event.stepId) continue;
    const payload = event.payload as { toolCallId?: string; toolId?: string } | undefined;
    if (!payload?.toolCallId || !payload.toolId) continue;
    const bucket = preparedByStep.get(event.stepId) ?? [];
    bucket.push({ toolCallId: payload.toolCallId, toolId: payload.toolId });
    preparedByStep.set(event.stepId, bucket);
  }

  const assistantByStep = new Set<string>();

  for (const event of sorted) {
    if (event.eventType === "action.proposed" && event.stepId) {
      if (assistantByStep.has(event.stepId)) continue;
      assistantByStep.add(event.stepId);

      const action = actionFromPayload(event.payload);
      const responded = sorted.find(
        (e) => e.eventType === "model.responded" && e.stepId === event.stepId,
      );
      const display =
        responded &&
        typeof responded.payload === "object" &&
        responded.payload &&
        "display" in responded.payload
          ? String((responded.payload as { display?: unknown }).display ?? "")
          : undefined;

      const toolCalls = action ? actionToToolCalls(action, preparedByStep.get(event.stepId) ?? []) : [];
      const content = assistantContent(action, display);

      turns.push({
        turnId: `turn-asst-${event.stepId}`,
        runId: input.run.runId,
        stepId: event.stepId,
        role: "assistant",
        content,
        toolCalls: toolCalls.map((tc) => ({
          id: tc.id,
          name: tc.function.name,
          arguments: JSON.parse(tc.function.arguments || "{}") as unknown,
        })),
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
        turns.push({
          turnId: `turn-tool-${observation.observationId}`,
          runId: input.run.runId,
          stepId: event.stepId,
          role: "tool",
          content: capToolContent(observation.data),
          toolCallId: event.toolCallId,
          toolName: observation.source.sourceId,
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
