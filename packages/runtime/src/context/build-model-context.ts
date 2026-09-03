import type {
  ContextCompressionRecord,
  ContextProjectionPolicy,
  EventCandidate,
  ExecutionManifest,
  ModelMessage,
  ModelPolicy,
  Run,
  RunState,
} from "@monai/contracts";
import { resolveContextProjectionPolicy } from "@monai/contracts";
import type { ContextContribution } from "@monai/pack-sdk";
import type { ModelPort, PersistencePort } from "@monai/ports";

import { buildContext, type ContextBuildResult } from "./build-context.js";
import {
  ensureDialogueCompression,
  planDialogueCompression,
} from "./compress-dialogue.js";
import { projectModelMessages } from "./project-messages.js";
import { projectSessionDialogue } from "./project-session-dialogue.js";

export type BuildModelContextInput = {
  run: Run;
  stepId: string;
  state: RunState;
  toolAllowlist: readonly string[];
  /** Frozen ExecutionManifest — Pack tool argHints / effect profiles. */
  manifest?: ExecutionManifest;
  hookContributions?: ContextContribution[];
  modelPolicy?: ModelPolicy;
  persistence: PersistencePort;
  model: ModelPort;
  systemPrompt: string;
  projectionPolicy?: ContextProjectionPolicy;
  memoryEnabled?: boolean;
};

export type BuildModelContextResult = {
  buildResult: ContextBuildResult;
  messages: ModelMessage[];
  compression?: ContextCompressionRecord;
  compressionEvents: EventCandidate[];
  priorRunIds: string[];
};

export async function buildModelContext(
  input: BuildModelContextInput,
  eventBase: (
    run: Pick<Run, "tenantId" | "sessionId" | "runId">,
    args: {
      eventId: string;
      eventType: string;
      expectedRevision: number;
      correlationId: string;
      stepId?: string;
      payload?: unknown;
    },
  ) => EventCandidate,
  correlationId: string,
  expectedRevision: number,
): Promise<BuildModelContextResult> {
  const policy = resolveContextProjectionPolicy(input.projectionPolicy);
  const currentEvents = await input.persistence.listEvents(input.run.runId);

  const sessionDialogue = await projectSessionDialogue({
    currentRun: input.run,
    currentEvents,
    persistence: input.persistence,
    maxToolContentChars: policy.maxToolContentChars,
  });

  const plan = planDialogueCompression({
    turns: sessionDialogue.turns,
    policy,
  });

  const sessionRuns = await input.persistence.listRuns({
    tenantId: input.run.tenantId,
    sessionId: input.run.sessionId,
    limit: 100,
  });
  const cachedEvents = [];
  for (const sessionRun of sessionRuns) {
    const events = await input.persistence.listEvents(sessionRun.runId);
    cachedEvents.push(...events);
  }

  const compressionResult = await ensureDialogueCompression({
    plan,
    cachedEvents,
    model: input.model,
    modelPolicy: input.modelPolicy,
  });

  const buildResult = buildContext({
    run: input.run,
    stepId: input.stepId,
    state: input.state,
    toolAllowlist: input.toolAllowlist,
    manifest: input.manifest,
    hookContributions: input.hookContributions,
    modelPolicy: input.modelPolicy,
    projectionPolicy: policy,
    dialogueSource: {
      runId: input.run.runId,
      fromSequence: currentEvents[0]?.sequence ?? 1,
      toSequence: currentEvents[currentEvents.length - 1]?.sequence ?? 1,
      sessionId: input.run.sessionId,
      priorRunIds: sessionDialogue.priorRunIds,
    },
    compressionRef: compressionResult.compression?.compressionId,
    memoryEnabled: input.memoryEnabled ?? false,
  });

  const projected = projectModelMessages({
    systemPrompt: input.systemPrompt,
    sections: buildResult.sections,
    recentTurns: plan.recentTurns,
    compression: compressionResult.compression,
  });

  buildResult.record.messagesHash = projected.messagesHash;

  const compressionEvents: EventCandidate[] = [];
  if (compressionResult.isNew && compressionResult.compression) {
    compressionEvents.push(
      eventBase(input.run, {
        eventId: `evt-ctx-sum-req-${input.stepId}`,
        eventType: "context.summary_requested",
        expectedRevision,
        correlationId,
        stepId: input.stepId,
        payload: {
          compressionId: compressionResult.compression.compressionId,
          sourceEventRanges: compressionResult.compression.sourceEventRanges,
        },
      }),
      eventBase(input.run, {
        eventId: `evt-ctx-sum-${input.stepId}`,
        eventType: "context.summary_created",
        expectedRevision,
        correlationId,
        stepId: input.stepId,
        payload: { record: compressionResult.compression },
      }),
    );
  }

  return {
    buildResult,
    messages: projected.messages,
    compression: compressionResult.compression,
    compressionEvents,
    priorRunIds: sessionDialogue.priorRunIds,
  };
}
