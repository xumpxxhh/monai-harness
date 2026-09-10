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
      calls: [{ toolId: "workspace_list", arguments: { path: "/" } }],
      displayText: "Listing workspace",
    };

    // Mirrors prepare-tool-calls: toolCallId on envelope, not in payload.
    const events: EventEnvelope[] = [
      baseEvent({
        eventId: "e1",
        eventType: "tool.call_prepared",
        sequence: 1,
        stepId: "step-1",
        toolCallId: "tc-1",
        payload: { toolId: "workspace_list", callIndex: 0 },
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
            // Production uses toolCallId as sourceId for provenance.
            source: { kind: "tool", sourceId: "tc-1" },
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

    const assistant = turns.find((t) => t.role === "assistant");
    expect(assistant?.content).toBe("Listing workspace");
    expect(assistant?.toolCalls?.[0]?.id).toBe("tc-1");
    expect(assistant?.toolCalls?.[0]?.name).toBe("workspace_list");

    const tool = turns.find((t) => t.role === "tool");
    expect(tool?.toolCallId).toBe("tc-1");
    expect(tool?.toolName).toBe("workspace_list");
    expect(assistant?.toolCalls?.[0]?.id).toBe(tool?.toolCallId);
  });

  it("projects model.responded.reasoning onto the assistant DialogueTurn", () => {
    const action: Action = {
      schemaVersion: CONTRACTS_SCHEMA_VERSION,
      actionId: "act-r1",
      type: "tool.call",
      calls: [{ toolId: "workspace_list", arguments: { path: "/" } }],
      displayText: "Listing",
    };
    const events: EventEnvelope[] = [
      baseEvent({
        eventId: "r-prep",
        eventType: "tool.call_prepared",
        sequence: 1,
        stepId: "step-r",
        toolCallId: "tc-r",
        payload: { toolId: "workspace_list", callIndex: 0 },
      }),
      baseEvent({
        eventId: "r-resp",
        eventType: "model.responded",
        sequence: 2,
        stepId: "step-r",
        payload: {
          display: "Listing",
          reasoning: "Need to inspect workspace root before writing files.",
        },
      }),
      baseEvent({
        eventId: "r-act",
        eventType: "action.proposed",
        sequence: 3,
        stepId: "step-r",
        payload: { action },
      }),
    ];

    const turns = projectDialogueFromEvents({ run, events });
    const assistant = turns.find((t) => t.role === "assistant");
    expect(assistant?.reasoning).toBe("Need to inspect workspace root before writing files.");
  });

  it("aligns multiple same-toolId calls with prepared call ids by order", () => {
    const action: Action = {
      schemaVersion: CONTRACTS_SCHEMA_VERSION,
      actionId: "act-2",
      type: "tool.call",
      calls: [
        { toolId: "sandbox_exec", arguments: { argv: ["echo", "a"] } },
        { toolId: "sandbox_exec", arguments: { argv: ["echo", "b"] } },
      ],
    };

    const events: EventEnvelope[] = [
      baseEvent({
        eventId: "p1",
        eventType: "tool.call_prepared",
        sequence: 1,
        stepId: "step-2",
        toolCallId: "tc-a",
        payload: { toolId: "sandbox_exec", callIndex: 0 },
      }),
      baseEvent({
        eventId: "p2",
        eventType: "tool.call_prepared",
        sequence: 2,
        stepId: "step-2",
        toolCallId: "tc-b",
        payload: { toolId: "sandbox_exec", callIndex: 1 },
      }),
      baseEvent({
        eventId: "a1",
        eventType: "action.proposed",
        sequence: 3,
        stepId: "step-2",
        payload: { action },
      }),
      baseEvent({
        eventId: "o1",
        eventType: "observation.recorded",
        sequence: 4,
        stepId: "step-2",
        toolCallId: "tc-a",
        payload: {
          observation: {
            schemaVersion: CONTRACTS_SCHEMA_VERSION,
            observationId: "obs-a",
            tenantId: "t1",
            sessionId: "s1",
            runId: "run-1",
            stepId: "step-2",
            source: { kind: "tool", sourceId: "tc-a" },
            observedAt: new Date().toISOString(),
            data: { ok: false },
            hash: "oh-a",
          },
        },
      }),
      baseEvent({
        eventId: "o2",
        eventType: "observation.recorded",
        sequence: 5,
        stepId: "step-2",
        toolCallId: "tc-b",
        payload: {
          observation: {
            schemaVersion: CONTRACTS_SCHEMA_VERSION,
            observationId: "obs-b",
            tenantId: "t1",
            sessionId: "s1",
            runId: "run-1",
            stepId: "step-2",
            source: { kind: "tool", sourceId: "tc-b" },
            observedAt: new Date().toISOString(),
            data: { ok: false },
            hash: "oh-b",
          },
        },
      }),
    ];

    const turns = projectDialogueFromEvents({ run, events });
    const assistant = turns.find((t) => t.role === "assistant" && t.stepId === "step-2");
    expect(assistant?.toolCalls?.map((c) => c.id)).toEqual(["tc-a", "tc-b"]);
    const toolTurns = turns.filter((t) => t.role === "tool");
    expect(toolTurns.map((t) => t.toolCallId)).toEqual(["tc-a", "tc-b"]);
    expect(toolTurns.map((t) => t.toolName)).toEqual(["sandbox_exec", "sandbox_exec"]);
  });

  it("projects finish as content-only (no control toolCalls in ModelView)", () => {
    const action: Action = {
      schemaVersion: CONTRACTS_SCHEMA_VERSION,
      actionId: "act-finish",
      type: "finish",
      displayText: "任务完成，已列出工具。",
    };

    const events: EventEnvelope[] = [
      baseEvent({
        eventId: "e-finish",
        eventType: "action.proposed",
        sequence: 1,
        stepId: "step-finish",
        payload: { action },
      }),
      baseEvent({
        eventId: "e-display",
        eventType: "model.responded",
        sequence: 2,
        stepId: "step-finish",
        payload: { display: "任务完成，已列出工具。" },
      }),
    ];

    const turns = projectDialogueFromEvents({ run, events });
    const assistant = turns.find((t) => t.role === "assistant" && t.stepId === "step-finish");
    expect(assistant?.content).toBe("任务完成，已列出工具。");
    expect(assistant?.toolCalls).toBeUndefined();
  });
});
