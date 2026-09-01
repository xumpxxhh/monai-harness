import type { Action, EventEnvelope } from "@monai/contracts";

export type SessionTurn = {
  role: "user" | "assistant";
  content: string;
  runId?: string;
};

export class SessionTranscript {
  private readonly turns: SessionTurn[] = [];

  getTurns(): readonly SessionTurn[] {
    return this.turns;
  }

  addUser(content: string, runId?: string): void {
    this.turns.push({ role: "user", content, runId });
  }

  addAssistant(content: string, runId?: string): void {
    this.turns.push({ role: "assistant", content, runId });
  }
}

/** Compose a Run goal that carries prior session dialogue. */
export function buildSessionGoal(transcript: readonly SessionTurn[], userMessage: string): string {
  const message = userMessage.trim();
  if (transcript.length === 0) return message;

  const history = transcript
    .map((turn) => `${turn.role === "user" ? "User" : "Assistant"}: ${turn.content}`)
    .join("\n");

  return [
    "You are continuing a multi-turn session. Prior turns:",
    history,
    "",
    `Current user message: ${message}`,
  ].join("\n");
}

function actionFromEventPayload(payload: unknown): Action | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const action = (payload as { action?: Action }).action;
  return action;
}

/** Extract the assistant-facing reply from committed run events. */
export function extractAssistantReply(events: readonly EventEnvelope[]): string {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i]!;
    if (event.eventType !== "action.proposed" && event.eventType !== "action.accepted") {
      continue;
    }
    const action = actionFromEventPayload(event.payload);
    if (action?.type !== "finish") continue;

    if (action.displayText?.trim()) return action.displayText.trim();
    const args = action.arguments as { summary?: unknown } | undefined;
    if (typeof args?.summary === "string" && args.summary.trim()) {
      return args.summary.trim();
    }
    return "Task complete.";
  }

  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i]!;
    if (event.eventType !== "model.responded") continue;
    const payload = event.payload as { display?: unknown } | undefined;
    if (typeof payload?.display === "string" && payload.display.trim()) {
      return payload.display.trim();
    }
  }

  return "No assistant reply recorded.";
}
