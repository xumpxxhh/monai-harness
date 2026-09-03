import type { DialogueTurn, EventEnvelope, Run } from "@monai/contracts";
import type { PersistencePort } from "@monai/ports";

import { projectDialogueFromEvents } from "./project-dialogue.js";

export type SessionDialogueInput = {
  currentRun: Run;
  currentEvents: readonly EventEnvelope[];
  persistence: PersistencePort;
  maxToolContentChars?: number;
};

export type SessionDialogueResult = {
  turns: DialogueTurn[];
  priorRunIds: string[];
};

/**
 * Merge dialogue from prior session runs (by createdAt) with the current run.
 */
export async function projectSessionDialogue(
  input: SessionDialogueInput,
): Promise<SessionDialogueResult> {
  const priorRuns = (
    await input.persistence.listRuns({
      tenantId: input.currentRun.tenantId,
      sessionId: input.currentRun.sessionId,
      limit: 100,
    })
  )
    .filter((run) => run.runId !== input.currentRun.runId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const priorRunIds = priorRuns.map((run) => run.runId);
  const turns: DialogueTurn[] = [];

  const maxToolContentChars = input.maxToolContentChars;

  for (const run of priorRuns) {
    const events = await input.persistence.listEvents(run.runId);
    turns.push(...projectDialogueFromEvents({ run, events, maxToolContentChars }));
  }

  turns.push(
    ...projectDialogueFromEvents({
      run: input.currentRun,
      events: input.currentEvents,
      maxToolContentChars,
    }),
  );

  return { turns, priorRunIds };
}
