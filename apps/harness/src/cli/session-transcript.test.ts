import { CONTRACTS_SCHEMA_VERSION } from "@monai/contracts";
import { describe, expect, it } from "vitest";

import {
  buildSessionGoal,
  extractAssistantReply,
  SessionTranscript,
} from "./session-transcript.js";

describe("buildSessionGoal", () => {
  it("returns the user message when transcript is empty", () => {
    expect(buildSessionGoal([], "列出工作区文件")).toBe("列出工作区文件");
  });

  it("includes prior turns before the current user message", () => {
    const transcript = new SessionTranscript();
    transcript.addUser("列出工作区文件", "run-1");
    transcript.addAssistant("包含 notes 和 readme.md", "run-1");

    const goal = buildSessionGoal(transcript.getTurns(), "写入 summary.md");
    expect(goal).toContain("Prior turns:");
    expect(goal).toContain("User: 列出工作区文件");
    expect(goal).toContain("Assistant: 包含 notes 和 readme.md");
    expect(goal).toContain("Current user message: 写入 summary.md");
  });
});

describe("extractAssistantReply", () => {
  it("prefers finish action displayText", () => {
    const events = [
      {
        eventType: "action.accepted",
        payload: {
          action: {
            schemaVersion: CONTRACTS_SCHEMA_VERSION,
            actionId: "a1",
            type: "finish",
            displayText: "工作区已列出。",
          },
        },
      },
    ];
    expect(extractAssistantReply(events)).toBe("工作区已列出。");
  });

  it("falls back to finish summary argument", () => {
    const events = [
      {
        eventType: "action.proposed",
        payload: {
          action: {
            schemaVersion: CONTRACTS_SCHEMA_VERSION,
            actionId: "a2",
            type: "finish",
            arguments: { summary: "Done." },
          },
        },
      },
    ];
    expect(extractAssistantReply(events)).toBe("Done.");
  });

  it("falls back to model.responded display", () => {
    const events = [
      {
        eventType: "model.responded",
        payload: { display: "partial reply" },
      },
    ];
    expect(extractAssistantReply(events)).toBe("partial reply");
  });
});
