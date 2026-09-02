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
  planDialogueCompression,
  summarizeDialogueDeterministic,
} from "./compress-dialogue.js";
import { dialogueSourceRangeHash } from "./project-dialogue.js";

function turn(index: number, role: DialogueTurn["role"], content: string): DialogueTurn {
  return {
    turnId: `t-${index}`,
    runId: "run-1",
    role,
    content,
    sourceEventIds: [`e-${index}`],
    sequenceRange: { from: index, to: index },
  };
}

describe("compress-dialogue", () => {
  it("plans recent vs history split", () => {
    const turns = Array.from({ length: 10 }, (_, i) => turn(i + 1, "user", `msg-${i}`));
    const plan = planDialogueCompression({
      turns,
      policy: { ...DEFAULT_CONTEXT_PROJECTION_POLICY, recentTurnCount: 3 },
    });
    expect(plan.needsCompression).toBe(true);
    expect(plan.recentTurns).toHaveLength(3);
    expect(plan.historyTurns).toHaveLength(7);
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
