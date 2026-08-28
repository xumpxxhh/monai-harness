import { describe, expect, it } from "vitest";
import { createEmptyRunState } from "@monai/contracts";
import { checkRunBudget } from "./budget-guard.js";

describe("checkRunBudget", () => {
  const baseRun = {
    createdAt: "2026-08-28T10:00:00.000Z",
    budgets: {},
  };

  it("passes when no budgets are defined", () => {
    const state = createEmptyRunState();
    const result = checkRunBudget(baseRun, state);
    expect(result.exceeded).toBe(false);
  });

  it("checks maxSteps budget correctly", () => {
    const run = {
      ...baseRun,
      budgets: { maxSteps: 5 },
    };
    const state = {
      ...createEmptyRunState(),
      cursor: { stepCount: 4 },
    };
    expect(checkRunBudget(run, state).exceeded).toBe(false);

    state.cursor.stepCount = 5;
    const exceeded = checkRunBudget(run, state);
    expect(exceeded.exceeded).toBe(true);
    if (exceeded.exceeded) {
      expect(exceeded.budgetKind).toBe("maxSteps");
    }
  });

  it("checks maxTokens and maxCost budgets", () => {
    const run = {
      ...baseRun,
      budgets: { maxTokens: 1000, maxCost: 0.5 },
    };
    const state = createEmptyRunState();

    expect(checkRunBudget(run, state, { tokensUsed: 999, costUsed: 0.4 }).exceeded).toBe(false);

    const tokenExceeded = checkRunBudget(run, state, { tokensUsed: 1000, costUsed: 0.4 });
    expect(tokenExceeded.exceeded).toBe(true);
    if (tokenExceeded.exceeded) {
      expect(tokenExceeded.budgetKind).toBe("maxTokens");
    }

    const costExceeded = checkRunBudget(run, state, { tokensUsed: 500, costUsed: 0.5 });
    expect(costExceeded.exceeded).toBe(true);
    if (costExceeded.exceeded) {
      expect(costExceeded.budgetKind).toBe("maxCost");
    }
  });

  it("checks maxWallTime budget", () => {
    const run = {
      createdAt: "2026-08-28T10:00:00.000Z",
      budgets: { maxWallTime: 60 }, // 60 seconds
    };
    const state = createEmptyRunState();

    // 30s elapsed
    expect(
      checkRunBudget(run, state, { now: "2026-08-28T10:00:30.000Z" }).exceeded,
    ).toBe(false);

    // 60s elapsed
    const wallExceeded = checkRunBudget(run, state, { now: "2026-08-28T10:01:00.000Z" });
    expect(wallExceeded.exceeded).toBe(true);
    if (wallExceeded.exceeded) {
      expect(wallExceeded.budgetKind).toBe("maxWallTime");
    }
  });
});
