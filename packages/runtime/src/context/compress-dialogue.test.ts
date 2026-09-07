import { describe, expect, it } from "vitest";
import {
  CONTRACTS_SCHEMA_VERSION,
  DEFAULT_CONTEXT_PROJECTION_POLICY,
  type DialogueTurn,
} from "@monai/contracts";
import { StubModelPort } from "@monai/model-stub";

import {
  ensureDialogueCompression,
  findCachedCompression,
  groupCompleteTurns,
  planDialogueCompression,
  summarizeDialogueDeterministic,
} from "./compress-dialogue.js";
import { dialogueSourceRangeHash } from "./project-dialogue.js";

function turn(
  index: number,
  role: DialogueTurn["role"],
  content: string,
  options?: { stepId?: string; turnId?: string },
): DialogueTurn {
  return {
    turnId: options?.turnId ?? `t-${index}`,
    runId: "run-1",
    role,
    content,
    ...(options?.stepId ? { stepId: options.stepId } : {}),
    sourceEventIds: [`e-${index}`],
    sequenceRange: { from: index, to: index },
  };
}

describe("compress-dialogue", () => {
  it("plans recent vs history split by complete-turn groups (user-only)", () => {
    const turns = Array.from({ length: 10 }, (_, i) => turn(i + 1, "user", `msg-${i}`));
    const plan = planDialogueCompression({
      turns,
      policy: { ...DEFAULT_CONTEXT_PROJECTION_POLICY, recentTurnCount: 3 },
    });
    expect(plan.needsCompression).toBe(true);
    expect(plan.recentTurns).toHaveLength(3);
    expect(plan.historyTurns).toHaveLength(7);
  });

  it("groups assistant + same stepId tools as one complete turn", () => {
    const turns = [
      turn(1, "user", "goal"),
      turn(2, "assistant", "call tools", { stepId: "step-a", turnId: "turn-asst-step-a" }),
      turn(3, "tool", "r1", { stepId: "step-a", turnId: "turn-tool-1" }),
      turn(4, "tool", "r2", { stepId: "step-a", turnId: "turn-tool-2" }),
      turn(5, "user", "next"),
    ];
    const groups = groupCompleteTurns(turns);
    expect(groups).toHaveLength(3);
    expect(groups[0]?.key).toBe("t-1");
    expect(groups[1]?.key).toBe("step-a");
    expect(groups[1]?.turns).toHaveLength(3);
    expect(groups[2]?.key).toBe("t-5");
  });

  it("does not split assistant from its tool results at the compression cut", () => {
    const turns: DialogueTurn[] = [
      turn(1, "user", "goal"),
      turn(2, "assistant", "pwd", { stepId: "step-1", turnId: "asst-1" }),
      turn(3, "tool", "pwd fail", { stepId: "step-1", turnId: "tool-1" }),
      turn(4, "assistant", "ls", { stepId: "step-2", turnId: "asst-2" }),
      turn(5, "tool", "ls fail", { stepId: "step-2", turnId: "tool-2" }),
      turn(6, "assistant", "node", { stepId: "step-3", turnId: "asst-3" }),
      turn(7, "tool", "node ok", { stepId: "step-3", turnId: "tool-3" }),
      turn(8, "user", "create file"),
    ];
    // 5 complete groups: goal, step-1, step-2, step-3, user → keep 2 recent
    const plan = planDialogueCompression({
      turns,
      policy: { ...DEFAULT_CONTEXT_PROJECTION_POLICY, recentTurnCount: 2 },
    });
    expect(plan.needsCompression).toBe(true);
    expect(plan.recentTurns[0]?.role).not.toBe("tool");
    expect(plan.recentTurns.map((t) => t.turnId)).toEqual(["asst-3", "tool-3", "t-8"]);
    expect(plan.historyTurns.map((t) => t.turnId)).toEqual([
      "t-1",
      "asst-1",
      "tool-1",
      "asst-2",
      "tool-2",
    ]);
    // step-2 assistant and tool stay together in history
    const histIds = plan.historyTurns.map((t) => t.turnId);
    expect(histIds.indexOf("asst-2")).toBeLessThan(histIds.indexOf("tool-2"));
  });

  it("reuses cached compression by range hash", () => {
    const ranges = [{ runId: "run-1", fromSequence: 1, toSequence: 5 }];
    const hash = dialogueSourceRangeHash(ranges);
    const record = {
      compressionId: "cmp-1",
      summaryHash: "abc",
      summaryText: "cached summary",
      sourceRunIds: ["run-1"],
      sourceEventRanges: ranges,
      createdAt: new Date().toISOString(),
    };

    const cached = findCachedCompression(
      [
        {
          schemaVersion: CONTRACTS_SCHEMA_VERSION,
          eventId: "evt-sum",
          eventType: "context.summary_created",
          tenantId: "t1",
          sessionId: "s1",
          runId: "run-1",
          occurredAt: new Date().toISOString(),
          correlationId: "c1",
          producer: { type: "engine", id: "engine" },
          hash: "h1",
          expectedRevision: 1,
          sequence: 1,
          recordedAt: new Date().toISOString(),
          payload: { record },
        },
      ],
      hash,
    );

    expect(cached?.summaryText).toBe("cached summary");
  });

  it("creates deterministic summary via stub model fallback", async () => {
    const history = [turn(1, "user", "read files"), turn(2, "assistant", "listing")];
    const plan = planDialogueCompression({
      turns: [...history, turn(3, "user", "continue")],
      policy: { ...DEFAULT_CONTEXT_PROJECTION_POLICY, recentTurnCount: 1 },
    });

    const result = await ensureDialogueCompression({
      plan,
      cachedEvents: [],
      model: new StubModelPort(),
    });

    expect(result.isNew).toBe(true);
    expect(result.compression?.summaryText).toContain("Compressed dialogue history");
    expect(summarizeDialogueDeterministic(history)).toContain("read files");
  });
});
