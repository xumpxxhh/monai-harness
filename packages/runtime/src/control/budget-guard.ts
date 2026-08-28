import type { Run, RunState } from "@monai/contracts";

export interface BudgetExceededResult {
  exceeded: true;
  reason: string;
  budgetKind: "maxSteps" | "maxTokens" | "maxCost" | "maxWallTime";
}

export interface BudgetCheckOk {
  exceeded: false;
}

export type BudgetCheckResult = BudgetCheckOk | BudgetExceededResult;

export function checkRunBudget(
  run: Pick<Run, "createdAt" | "budgets">,
  state: RunState,
  options?: {
    now?: string | Date;
    tokensUsed?: number;
    costUsed?: number;
  },
): BudgetCheckResult {
  const budgets = run.budgets as
    | {
        maxSteps?: number;
        maxTokens?: number;
        maxCost?: number;
        maxWallTime?: number;
      }
    | undefined;

  if (!budgets) {
    return { exceeded: false };
  }

  // 1. maxSteps
  if (typeof budgets.maxSteps === "number" && budgets.maxSteps > 0) {
    const currentSteps =
      state.cursor?.stepCount ??
      (state as unknown as { counters?: { steps?: number } }).counters?.steps ??
      0;
    if (currentSteps >= budgets.maxSteps) {
      return {
        exceeded: true,
        budgetKind: "maxSteps",
        reason: `budget exceeded: maxSteps limit ${budgets.maxSteps} reached (current: ${currentSteps})`,
      };
    }
  }

  // 2. maxTokens
  if (typeof budgets.maxTokens === "number" && budgets.maxTokens > 0) {
    const currentTokens = options?.tokensUsed ?? 0;
    if (currentTokens >= budgets.maxTokens) {
      return {
        exceeded: true,
        budgetKind: "maxTokens",
        reason: `budget exceeded: maxTokens limit ${budgets.maxTokens} reached (current: ${currentTokens})`,
      };
    }
  }

  // 3. maxCost
  if (typeof budgets.maxCost === "number" && budgets.maxCost > 0) {
    const currentCost = options?.costUsed ?? 0;
    if (currentCost >= budgets.maxCost) {
      return {
        exceeded: true,
        budgetKind: "maxCost",
        reason: `budget exceeded: maxCost limit ${budgets.maxCost} reached (current: ${currentCost})`,
      };
    }
  }

  // 4. maxWallTime (seconds)
  if (typeof budgets.maxWallTime === "number" && budgets.maxWallTime > 0) {
    const createdAtMs = new Date(run.createdAt).getTime();
    const nowMs = options?.now ? new Date(options.now).getTime() : Date.now();
    const elapsedMs = Math.max(0, nowMs - createdAtMs);
    const maxWallTimeMs = budgets.maxWallTime > 100000 ? budgets.maxWallTime : budgets.maxWallTime * 1000;
    if (elapsedMs >= maxWallTimeMs) {
      return {
        exceeded: true,
        budgetKind: "maxWallTime",
        reason: `budget exceeded: maxWallTime limit ${budgets.maxWallTime}s reached (elapsed: ${(elapsedMs / 1000).toFixed(1)}s)`,
      };
    }
  }

  return { exceeded: false };
}
