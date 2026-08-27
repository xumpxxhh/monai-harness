import {
  CONTRACTS_SCHEMA_VERSION,
  createEmptyRunState,
  type EventEnvelope,
  type Observation,
  type RunState,
  type ToolCallRecord,
} from "@monai/contracts";

import { reduce, validateObservationToFact } from "../state/reducer.js";

function observationFromPayload(event: EventEnvelope): Observation | undefined {
  const payload = event.payload as
    | { observation?: Observation; observationId?: string }
    | undefined;
  if (payload?.observation) {
    return payload.observation;
  }
  return undefined;
}

function reduceUserInput(
  previous: RunState,
  observation: Observation,
  factId: string,
): RunState {
  const summary =
    typeof observation.data === "object" &&
    observation.data &&
    "value" in (observation.data as object)
      ? String((observation.data as { value: unknown }).value)
      : "user input";

  return {
    ...previous,
    facts: [
      ...previous.facts,
      {
        factId,
        factType: "user.input",
        summary,
        data: observation.data,
      },
    ],
    lastFactId: factId,
    cursor: { stepCount: previous.cursor.stepCount + 1 },
  };
}

export type ReplayEventsArgs = {
  events: EventEnvelope[];
  toolCalls?: ToolCallRecord[];
  initialState?: RunState;
  /** Inclusive lower bound on Event sequence (default 1). */
  fromSequence?: number;
};

/**
 * Pure Event → State replay through Reducer (design 03 §11.2 step 4–5).
 * Expects observation.recorded payloads to carry full Observation when possible.
 */
export function replayEvents(args: ReplayEventsArgs): RunState {
  let state = args.initialState
    ? JSON.parse(JSON.stringify(args.initialState)) as RunState
    : createEmptyRunState();
  const observations = new Map<string, Observation>();
  const toolCallMap = new Map((args.toolCalls ?? []).map((t) => [t.toolCallId, t]));
  const fromSequence = args.fromSequence ?? 1;

  for (const event of args.events) {
    if (event.sequence < fromSequence) continue;

    if (event.eventType === "observation.recorded") {
      const obs = observationFromPayload(event);
      if (obs) {
        observations.set(obs.observationId, obs);
      }
      continue;
    }

    if (event.eventType !== "fact.accepted") continue;

    const payload = event.payload as { factId?: string; observationId?: string } | undefined;
    const observationId =
      payload?.observationId ??
      (event.toolCallId ? `obs-${event.toolCallId}` : undefined);
    if (!observationId) continue;

    let observation = observations.get(observationId);
    if (!observation && event.toolCallId) {
      const toolCall = toolCallMap.get(event.toolCallId);
      if (toolCall?.status === "succeeded") {
        observation = {
          schemaVersion: CONTRACTS_SCHEMA_VERSION,
          observationId,
          tenantId: toolCall.tenantId,
          sessionId: toolCall.sessionId,
          runId: toolCall.runId,
          stepId: toolCall.stepId,
          source: {
            kind: "tool",
            sourceId: toolCall.toolCallId,
            version: toolCall.toolVersion,
          },
          observedAt: toolCall.completedAt ?? toolCall.preparedAt,
          data: {},
          hash: toolCall.resultHash ?? `obs-hash-${observationId}`,
        };
      }
    }
    if (!observation) continue;

    if (observation.source.kind === "user") {
      const factId = payload?.factId ?? `fact-input-${observationId}`;
      state = reduceUserInput(state, observation, factId);
      continue;
    }

    const validated = validateObservationToFact(observation, {
      authorizationDecisionRef: event.toolCallId
        ? `tool:${event.toolCallId}`
        : "replay:observation",
    });
    if (validated.accepted) {
      state = reduce(state, validated.fact);
    }
  }

  return state;
}
