import { describe, expect, it } from "vitest";
import {
  CONTRACTS_SCHEMA_VERSION,
  DEFAULT_CONTEXT_PROJECTION_POLICY,
  type DialogueTurn,
  type EventEnvelope,
} from "@monai/contracts";
import { StubModelPort } from "@monai/model-stub";
import type { ModelCompleteInput, ModelPort } from "@monai/ports";

import {
  buildCompressionMaterial,
  ensureDialogueCompression,
  extractCompressionAnchors,
  findCachedCompression,
  findLongestPrefixCompression,
  formatTurnForSummary,
  groupCompleteTurns,
  isUsableDialogueSummary,
  planDialogueCompression,
  rangesFromTurns,
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

function summaryEvent(
  record: {
    compressionId: string;
    summaryHash: string;
    summaryText: string;
    sourceRunIds: string[];
    sourceEventRanges: Array<{ runId: string; fromSequence: number; toSequence: number }>;
    createdAt: string;
    parentCompressionId?: string;
  },
): EventEnvelope {
  return {
    schemaVersion: CONTRACTS_SCHEMA_VERSION,
    eventId: `evt-${record.compressionId}`,
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
  };
}

/** ModelPort that records calls and returns empty content so deterministic fallback runs. */
function recordingModel(): ModelPort & { calls: ModelCompleteInput[] } {
  const calls: ModelCompleteInput[] = [];
  return {
    calls,
    async completeStructured(input: ModelCompleteInput) {
      calls.push(input);
      return { content: "", calls: [] };
    },
  };
}

function fixedContentModel(content: string, toolCalls: Array<{ name: string; arguments: unknown }> = []): ModelPort {
  return {
    async completeStructured() {
      return { content, calls: toolCalls };
    },
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
    expect(plan.historyGroupCount).toBe(3);
    expect(plan.recentGroupCount).toBe(2);
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

  it("shrinks recent complete-turn groups when over recentTokenBudget (mid-run)", () => {
    const bulky = "x".repeat(8_000);
    const turns: DialogueTurn[] = [
      turn(1, "user", "goal for pulse-board build"),
      turn(2, "assistant", "a", { stepId: "s1", turnId: "a1" }),
      { ...turn(3, "tool", bulky, { stepId: "s1", turnId: "t1" }), toolName: "workspace.exec" },
      turn(4, "assistant", "b", { stepId: "s2", turnId: "a2" }),
      { ...turn(5, "tool", bulky, { stepId: "s2", turnId: "t2" }), toolName: "workspace.exec" },
      turn(6, "assistant", "c", { stepId: "s3", turnId: "a3" }),
      { ...turn(7, "tool", bulky, { stepId: "s3", turnId: "t3" }), toolName: "workspace.exec" },
      turn(8, "user", "continue"),
    ];
    const plan = planDialogueCompression({
      turns,
      policy: {
        ...DEFAULT_CONTEXT_PROJECTION_POLICY,
        recentTurnCount: 4,
        recentTokenBudget: 500,
        compressThreshold: 100,
      },
    });
    expect(plan.needsCompression).toBe(true);
    // Budget forces fewer than the requested 4 recent groups; never empty tip.
    expect(plan.recentGroupCount).toBeGreaterThanOrEqual(1);
    expect(plan.recentGroupCount).toBeLessThan(4);
    expect(plan.historyGroupCount).toBeGreaterThan(0);
    expect(plan.recentTurns.length).toBeGreaterThan(0);
  });

  it("reuses cached compression by range hash", () => {
    const ranges = [{ runId: "run-1", fromSequence: 1, toSequence: 5 }];
    const hash = dialogueSourceRangeHash(ranges);
    const record = {
      compressionId: "cmp-1",
      summaryHash: "abc",
      summaryText: "cached summary for range-hash reuse path",
      sourceRunIds: ["run-1"],
      sourceEventRanges: ranges,
      createdAt: new Date().toISOString(),
    };

    const cached = findCachedCompression([summaryEvent(record)], hash);

    expect(cached?.summaryText).toBe("cached summary for range-hash reuse path");
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

  it("findLongestPrefixCompression matches at complete-group boundaries", () => {
    const history = [
      turn(1, "user", "a"),
      turn(2, "user", "b"),
      turn(3, "user", "c"),
      turn(4, "user", "d"),
    ];
    const prefixTurns = history.slice(0, 2);
    const ranges = rangesFromTurns(prefixTurns);
    const record = {
      compressionId: "cmp-prefix",
      summaryHash: "h",
      summaryText: "prior summary text covering early dialogue turns",
      sourceRunIds: ["run-1"],
      sourceEventRanges: ranges,
      createdAt: new Date().toISOString(),
    };

    const match = findLongestPrefixCompression(history, [summaryEvent(record)]);
    expect(match?.coveredTurnCount).toBe(2);
    expect(match?.record.summaryText).toBe("prior summary text covering early dialogue turns");
  });

  it("exact rangeHash hit reuses without calling the model", async () => {
    const turns = Array.from({ length: 5 }, (_, i) => turn(i + 1, "user", `msg-${i}`));
    const plan = planDialogueCompression({
      turns,
      policy: { ...DEFAULT_CONTEXT_PROJECTION_POLICY, recentTurnCount: 2 },
    });
    const record = {
      compressionId: "cmp-exact",
      summaryHash: "h",
      summaryText: "exact cached summary for full history range",
      sourceRunIds: ["run-1"],
      sourceEventRanges: plan.sourceEventRanges,
      createdAt: new Date().toISOString(),
    };
    const model = recordingModel();
    const result = await ensureDialogueCompression({
      plan,
      cachedEvents: [summaryEvent(record)],
      model,
    });

    expect(result.isNew).toBe(false);
    expect(result.compression?.summaryText).toBe("exact cached summary for full history range");
    expect(model.calls).toHaveLength(0);
  });

  it("extends prior summary with delta turns only (incremental path)", async () => {
    // 6 user turns, recentTurnCount=2 → history = first 4
    const allTurns = Array.from({ length: 6 }, (_, i) => turn(i + 1, "user", `msg-${i}`));
    const plan = planDialogueCompression({
      turns: allTurns,
      policy: { ...DEFAULT_CONTEXT_PROJECTION_POLICY, recentTurnCount: 2 },
    });
    expect(plan.historyTurns).toHaveLength(4);

    const prefixTurns = plan.historyTurns.slice(0, 2);
    const priorRecord = {
      compressionId: "cmp-old",
      summaryHash: "h",
      summaryText: "PRIOR_SUMMARY_MARKER covering early session goals",
      sourceRunIds: ["run-1"],
      sourceEventRanges: rangesFromTurns(prefixTurns),
      createdAt: new Date().toISOString(),
    };

    const model = recordingModel();
    const result = await ensureDialogueCompression({
      plan,
      cachedEvents: [summaryEvent(priorRecord)],
      model,
    });

    expect(result.isNew).toBe(true);
    expect(result.compression?.parentCompressionId).toBe("cmp-old");
    expect(result.compression?.sourceEventRanges).toEqual(plan.sourceEventRanges);
    expect(model.calls).toHaveLength(1);

    const call = model.calls[0]!;
    const ctx = call.context as {
      purpose?: string;
      priorSummary?: string;
      transcript?: string;
      anchors?: { goals?: string[] };
    };
    expect(ctx.purpose).toBe("dialogue_compression_incremental");
    expect(ctx.priorSummary).toBe("PRIOR_SUMMARY_MARKER covering early session goals");
    // Delta transcript should be turns 3–4 (msg-2, msg-3), not early msg-0
    expect(ctx.transcript).toContain("msg-2");
    expect(ctx.transcript).toContain("msg-3");
    expect(ctx.transcript).not.toContain("msg-0");
    expect(ctx.transcript).not.toContain("msg-1");
    // Anchors still cover full history goals (first user turn), not delta-only
    expect(ctx.anchors?.goals?.[0]).toContain("msg-0");

    const userMsg = call.messages?.find((m) => m.role === "user")?.content ?? "";
    expect(userMsg).toContain("PRIOR_SUMMARY_MARKER covering early session goals");
    expect(userMsg).toContain("Session anchors");
    expect(userMsg).toContain("Incremental condensed transcript");
    expect(result.compression?.summaryText).toContain("PRIOR_SUMMARY_MARKER covering early session goals");
    expect(result.compression?.summaryText).toContain("Session anchors");
  });

  it("falls back to full history summarize when no prefix cache exists", async () => {
    const turns = Array.from({ length: 5 }, (_, i) => turn(i + 1, "user", `full-${i}`));
    const plan = planDialogueCompression({
      turns,
      policy: { ...DEFAULT_CONTEXT_PROJECTION_POLICY, recentTurnCount: 2 },
    });
    const model = recordingModel();
    const result = await ensureDialogueCompression({
      plan,
      cachedEvents: [],
      model,
    });

    expect(result.isNew).toBe(true);
    expect(result.compression?.parentCompressionId).toBeUndefined();
    expect(model.calls).toHaveLength(1);
    const ctx = model.calls[0]!.context as { purpose?: string; transcript?: string };
    expect(ctx.purpose).toBe("dialogue_compression");
    expect(ctx.transcript).toContain("full-0");
    expect(ctx.transcript).toContain("full-2");
  });

  it("incremental prefix does not cut mid stepId group", () => {
    const history = [
      turn(1, "user", "goal"),
      turn(2, "assistant", "a", { stepId: "s1", turnId: "asst-1" }),
      turn(3, "tool", "t", { stepId: "s1", turnId: "tool-1" }),
      turn(4, "user", "next"),
    ];
    // Cache only first user turn
    const prior = {
      compressionId: "cmp-u1",
      summaryHash: "h",
      summaryText: "goal only summary for first user turn prefix",
      sourceRunIds: ["run-1"],
      sourceEventRanges: rangesFromTurns([history[0]!]),
      createdAt: new Date().toISOString(),
    };
    const match = findLongestPrefixCompression(history, [summaryEvent(prior)]);
    expect(match?.coveredTurnCount).toBe(1);

    // Cache covering whole step group (user + asst + tool) — still a proper prefix before "next"
    const stepPrefix = history.slice(0, 3);
    const priorStep = {
      compressionId: "cmp-step",
      summaryHash: "h2",
      summaryText: "goal+step summary covering assistant and tool group",
      sourceRunIds: ["run-1"],
      sourceEventRanges: rangesFromTurns(stepPrefix),
      createdAt: new Date().toISOString(),
    };
    const matchStep = findLongestPrefixCompression(history, [
      summaryEvent(prior),
      summaryEvent(priorStep),
    ]);
    expect(matchStep?.coveredTurnCount).toBe(3);
    expect(matchStep?.record.compressionId).toBe("cmp-step");
  });

  it("isUsableDialogueSummary rejects tool XML and short echoes", () => {
    expect(
      isUsableDialogueSummary(
        `<dots_function_call>\n<invoke name="workspace.exec">\n<parameter name="command">npm run build</parameter>\n</invoke>\n</dots_function_call>`,
      ),
    ).toBe(false);
    expect(isUsableDialogueSummary("too short")).toBe(false);
    expect(
      isUsableDialogueSummary(
        "## Dialogue summary\n\n- Goal: install deps and build pulse-board\n- Pending: re-run npm run build after TS fixes",
      ),
    ).toBe(true);
  });

  it("rejects model tool-call summaries and falls back to deterministic", async () => {
    const turns = Array.from({ length: 5 }, (_, i) => turn(i + 1, "user", `poison-${i}`));
    const plan = planDialogueCompression({
      turns,
      policy: { ...DEFAULT_CONTEXT_PROJECTION_POLICY, recentTurnCount: 2 },
    });

    const result = await ensureDialogueCompression({
      plan,
      cachedEvents: [],
      model: fixedContentModel(
        `<dots_function_call>\n<invoke name="workspace.exec">\n<parameter name="command">cd projects/pulse-board && npm run build</parameter>\n</invoke>\n</dots_function_call>`,
      ),
    });

    expect(result.isNew).toBe(true);
    expect(result.compression?.summaryText).toContain("Compressed dialogue history");
    expect(result.compression?.summaryText).not.toContain("dots_function_call");
    expect(isUsableDialogueSummary(result.compression?.summaryText ?? "")).toBe(true);
  });

  it("rejects model decisions that emit tool calls even with prose content", async () => {
    const turns = Array.from({ length: 5 }, (_, i) => turn(i + 1, "user", `calls-${i}`));
    const plan = planDialogueCompression({
      turns,
      policy: { ...DEFAULT_CONTEXT_PROJECTION_POLICY, recentTurnCount: 2 },
    });

    const result = await ensureDialogueCompression({
      plan,
      cachedEvents: [],
      model: fixedContentModel(
        "## Dialogue summary\n\n- Goal: keep going with build fixes and verify npm run build succeeds.",
        [{ name: "workspace.exec", arguments: { command: "npm run build" } }],
      ),
    });

    expect(result.compression?.summaryText).toContain("Compressed dialogue history");
  });

  it("skips poisoned cached summaries for exact and prefix reuse", async () => {
    const turns = Array.from({ length: 6 }, (_, i) => turn(i + 1, "user", `cache-${i}`));
    const plan = planDialogueCompression({
      turns,
      policy: { ...DEFAULT_CONTEXT_PROJECTION_POLICY, recentTurnCount: 2 },
    });

    const poisonedExact = {
      compressionId: "cmp-poison-exact",
      summaryHash: "h",
      summaryText:
        `<dots_function_call>\n<invoke name="workspace.exec">\n<parameter name="command">npm run build</parameter>\n</invoke>\n</dots_function_call>`,
      sourceRunIds: ["run-1"],
      sourceEventRanges: plan.sourceEventRanges,
      createdAt: new Date().toISOString(),
    };
    const prefixTurns = plan.historyTurns.slice(0, 2);
    const poisonedPrefix = {
      compressionId: "cmp-poison-prefix",
      summaryHash: "h2",
      summaryText: `<tool_call>workspace.exec</tool_call> `.repeat(5),
      sourceRunIds: ["run-1"],
      sourceEventRanges: rangesFromTurns(prefixTurns),
      createdAt: new Date().toISOString(),
    };

    expect(findCachedCompression([summaryEvent(poisonedExact)], plan.rangeHash)).toBeUndefined();
    expect(
      findLongestPrefixCompression(plan.historyTurns, [summaryEvent(poisonedPrefix)]),
    ).toBeUndefined();

    const result = await ensureDialogueCompression({
      plan,
      cachedEvents: [summaryEvent(poisonedExact), summaryEvent(poisonedPrefix)],
      model: fixedContentModel(
        "## Dialogue summary\n\n- Goal: recover from poisoned cache and continue the coding task safely.",
      ),
    });

    expect(result.isNew).toBe(true);
    expect(result.compression?.parentCompressionId).toBeUndefined();
    expect(result.compression?.summaryText).toContain("recover from poisoned cache");
  });

  it("builds anchors with goals, constraints, paths, and errors (not tool-log only)", () => {
    const turns: DialogueTurn[] = [
      turn(
        1,
        "user",
        "在 /projects/pulse-board/ 完成构建。硬性约束：禁止 sandbox.exec；只用 workspace.exec。",
      ),
      {
        ...turn(2, "assistant", "准备调用 workspace.edit", { stepId: "s1", turnId: "a1" }),
        toolCalls: [
          {
            id: "c1",
            name: "workspace.edit",
            arguments: { path: "/projects/pulse-board/src/App.tsx" },
          },
        ],
      },
      {
        ...turn(
          3,
          "tool",
          JSON.stringify({
            path: "/projects/pulse-board/src/App.tsx",
            summary: "edited /projects/pulse-board/src/App.tsx (1 replacement)",
            replacements: 1,
          }),
          { stepId: "s1", turnId: "t1" },
        ),
        toolName: "workspace.edit",
      },
      {
        ...turn(4, "assistant", "build", { stepId: "s2", turnId: "a2" }),
        toolCalls: [
          {
            id: "c2",
            name: "workspace.exec",
            arguments: { command: "cd projects/pulse-board && npm run build" },
          },
        ],
      },
      {
        ...turn(
          5,
          "tool",
          JSON.stringify({
            exitCode: 1,
            stdout: "",
            stderr: "src/App.tsx(10,11): error TS6133: 'tasks' is declared but never used.",
          }),
          { stepId: "s2", turnId: "t2" },
        ),
        toolName: "workspace.exec",
      },
    ];

    const anchors = extractCompressionAnchors(turns, {
      stateFacts: ["checklist: install complete"],
    });
    expect(anchors.goals[0]).toContain("pulse-board");
    expect(anchors.constraints.some((c) => /禁止 sandbox\.exec|workspace\.exec/.test(c))).toBe(
      true,
    );
    expect(anchors.changedPaths.some((p) => p.includes("App.tsx"))).toBe(true);
    expect(anchors.confirmedFacts.some((f) => /edited|checklist/i.test(f))).toBe(true);
    expect(anchors.openErrors.some((e) => /TS6133|error/i.test(e))).toBe(true);
    expect(anchors.toolsUsed).toEqual(expect.arrayContaining(["workspace.edit", "workspace.exec"]));

    const formatted = formatTurnForSummary(turns[4]!);
    expect(formatted.length).toBeLessThan(800);
    expect(formatted).toContain("TS6133");
    expect(formatted).not.toContain("x".repeat(1000));

    const material = buildCompressionMaterial(turns.slice(3), {
      anchorTurns: turns,
      priorSummary: "PRIOR milestone covering install",
    });
    expect(material.material).toContain("Session anchors");
    expect(material.material).toContain("Hard constraints");
    expect(material.material).toContain("PRIOR milestone covering install");
    expect(material.transcript).toContain("workspace.exec");
    // Condensed transcript is delta-only; anchors still see the goal.
    expect(material.transcript).not.toContain("硬性约束");
    expect(material.anchors.goals[0]).toContain("pulse-board");
  });
});
