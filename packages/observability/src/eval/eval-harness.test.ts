import { describe, expect, it } from "vitest";

import {
  APPROVAL_EVAL_SUITE,
  APPROVAL_REPETITIONS,
  FULL_MVP_EVAL_SUITES,
  IDEMPOTENCY_EVAL_SUITE,
  IDEMPOTENCY_REPETITIONS,
  MVP_EVAL_SUITES,
  RECOVERY_EVAL_SUITE,
  RECOVERY_REPETITIONS,
  SECURITY_EVAL_SUITE,
  SECURITY_REPETITIONS,
} from "./eval-control-suites.js";
import { EvalHarness, GOLDEN_EVAL_SUITE, GOLDEN_REPETITIONS } from "./eval-harness.js";

describe("EvalHarness MVP suites", () => {
  it("runs design 08 control matrix: golden 6×5, recovery 8×5, approval 6×1, idempotency 6×5", async () => {
    const harness = new EvalHarness();
    const results = await harness.runAll(MVP_EVAL_SUITES);
    expect(results.length).toBe(4);

    const golden = results.find((r) => r.suiteId === GOLDEN_EVAL_SUITE.suiteId);
    expect(golden?.total).toBe(GOLDEN_EVAL_SUITE.cases.length * GOLDEN_REPETITIONS);
    expect(golden?.total).toBe(30);

    const recovery = results.find((r) => r.suiteId === RECOVERY_EVAL_SUITE.suiteId);
    expect(recovery?.total).toBe(RECOVERY_EVAL_SUITE.cases.length * RECOVERY_REPETITIONS);
    expect(recovery?.total).toBe(40);
    expect(recovery?.minPassRate).toBe(0.95);

    const approval = results.find((r) => r.suiteId === APPROVAL_EVAL_SUITE.suiteId);
    expect(approval?.total).toBe(APPROVAL_EVAL_SUITE.cases.length * APPROVAL_REPETITIONS);
    expect(approval?.total).toBe(6);

    const idempotency = results.find((r) => r.suiteId === IDEMPOTENCY_EVAL_SUITE.suiteId);
    expect(idempotency?.total).toBe(IDEMPOTENCY_EVAL_SUITE.cases.length * IDEMPOTENCY_REPETITIONS);
    expect(idempotency?.total).toBe(30);

    for (const result of results) {
      expect(
        result.ok,
        result.cases.filter((c) => !c.ok).map((c) => `${c.caseId}: ${c.message}`).join("; "),
      ).toBe(true);
      expect(result.passRate).toBeGreaterThanOrEqual(result.minPassRate);
    }
  });

  it("runs design 08 security matrix: 8×1 @ 100%", async () => {
    const harness = new EvalHarness();
    const result = await harness.runSuite(SECURITY_EVAL_SUITE);
    expect(result.total).toBe(SECURITY_EVAL_SUITE.cases.length * SECURITY_REPETITIONS);
    expect(result.total).toBe(8);
    expect(
      result.ok,
      result.cases.filter((c) => !c.ok).map((c) => `${c.caseId}: ${c.message}`).join("; "),
    ).toBe(true);
    expect(result.passRate).toBe(1);
  });

  it("runs full design 08 matrix: 106 control + 8 security = 114", async () => {
    const harness = new EvalHarness();
    const results = await harness.runAll(FULL_MVP_EVAL_SUITES);
    expect(results.length).toBe(5);
    const total = results.reduce((sum, r) => sum + r.total, 0);
    expect(total).toBe(114);
    for (const result of results) {
      expect(
        result.ok,
        result.cases.filter((c) => !c.ok).map((c) => `${c.caseId}: ${c.message}`).join("; "),
      ).toBe(true);
    }
  });
});
