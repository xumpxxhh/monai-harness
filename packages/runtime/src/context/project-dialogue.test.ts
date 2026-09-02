import { describe, expect, it } from "vitest";
import {
  CONTRACTS_SCHEMA_VERSION,
  createInitialRun,
  type Action,
  type EventEnvelope,
} from "@monai/contracts";

import { projectDialogueFromEvents } from "./project-dialogue.js";

function baseEvent(
  partial: Partial<EventEnvelope> & Pick<EventEnvelope, "eventId" | "eventType" | "sequence">,
): EventEnvelope {
  return {
    schemaVersion: CONTRACTS_SCHEMA_VERSION,
    tenantId: "t1",
    sessionId: "s1",
    runId: "run-1",
    occurredAt: new Date().toISOString(),
    correlationId: "corr-1",
    producer: { type: "engine", id: "engine" },
    hash: `hash-${partial.eventId}`,
    expectedRevision: 1,
    recordedAt: new Date().toISOString(),
    ...partial,
  };
}

describe("projectDialogueFromEvents", () => {
  const run = createInitialRun({
    runId: "run-1",
    tenantId: "t1",
    sessionId: "s1",
    agentDefinitionId: "agent",
    agentVersion: "1",
    executionManifestRef: "man-1",
    packVersions: [{ packId: "pack", version: "1" }],
    goal: "list workspace files",
    strategy: { type: "light", version: "1" },
  });

  it("starts with user goal and projects assistant + tool turns", () => {
    const action: Action = {
      schemaVersion: CONTRACTS_SCHEMA_VERSION,
      actionId: "act-1",
      type: "tool.call",
      calls: [{ toolId: "workspace.list", arguments: { path: "/" } }],
      displayText: "Listing workspace",
    };

    const events: EventEnvelope[] = [
      baseEvent({
        eventId: "e1",
        eventType: "tool.call_prepared",
        sequence: 1,
        stepId: "step-1",
        toolCallId: "tc-1",
        payload: { toolCallId: "tc-1", toolId: "workspace.list" },
      }),
      baseEvent({
        eventId: "e2",
        eventType: "model.responded",
        sequence: 2,
        stepId: "step-1",
        payload: { display: "Listing workspace" },
      }),
      baseEvent({
        eventId: "e3",
        eventType: "action.proposed",
        sequence: 3,
        stepId: "step-1",
        payload: { action },
      }),
      baseEvent({
        eventId: "e4",
        eventType: "observation.recorded",
        sequence: 4,
        stepId: "step-1",
        toolCallId: "tc-1",
        payload: {
          observation: {
            schemaVersion: CONTRACTS_SCHEMA_VERSION,
            observationId: "obs-1",
            tenantId: "t1",
            sessionId: "s1",
            runId: "run-1",
            stepId: "step-1",
            source: { kind: "tool", sourceId: "workspace.list" },
            observedAt: new Date().toISOString(),
            data: { path: "/", entries: [] },
            hash: "oh-1",
          },
        },
      }),
    ];

    const turns = projectDialogueFromEvents({ run, events });
    expect(turns[0]?.role).toBe("user");
    expect(turns[0]?.content).toBe("list workspace files");
    expect(turns.some((t) => t.role === "assistant" && t.content === "Listing workspace")).toBe(true);
    expect(turns.some((t) => t.role === "tool" && t.toolCallId === "tc-1")).toBe(true);
  });
});
