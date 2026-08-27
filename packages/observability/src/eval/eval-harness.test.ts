import { describe, expect, it } from "vitest";

import { EvalHarness, GOLDEN_EVAL_SUITE, GOLDEN_REPETITIONS, MVP_EVAL_SUITES } from "./eval-harness.js";

describe("EvalHarness MVP suites", () => {
  it("runs golden 6×5 plus approval / idempotency subsets", async () => {
    const harness = new EvalHarness();
    const results = await harness.runAll(MVP_EVAL_SUITES);
    expect(results.length).toBe(3);

    const golden = results.find((r) => r.suiteId === GOLDEN_EVAL_SUITE.suiteId);
    expect(golden).toBeDefined();
    expect(golden?.total).toBe(GOLDEN_EVAL_SUITE.cases.length * GOLDEN_REPETITIONS);
    expect(golden?.total).toBe(30);
    expect(golden?.minPassRate).toBe(0.9);

    for (const result of results) {
      expect(result.ok, result.cases.filter((c) => !c.ok).map((c) => `${c.caseId}: ${c.message}`).join("; ")).toBe(
        true,
      );
      expect(result.passRate).toBeGreaterThanOrEqual(result.minPassRate);
    }
  });
});
