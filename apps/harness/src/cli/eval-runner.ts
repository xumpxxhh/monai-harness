import { EvalHarness, MVP_EVAL_SUITES } from "@monai/observability";

import type { HarnessConfig } from "../config/env.js";

/**
 * Execute startup Eval gates if enabled by configuration and roles.
 * Returns true if eval passed (or was skipped), false if eval failed.
 */
export async function runStartupEval(config: HarnessConfig): Promise<boolean> {
  if (!config.runEvalOnStart) {
    return true;
  }

  if (!config.roles.observability) {
    console.log("[harness] skip eval (observability role off)");
    return true;
  }

  const harness = new EvalHarness();
  const results = await harness.runAll(MVP_EVAL_SUITES);
  for (const result of results) {
    console.log(
      `[harness][eval] ${result.suiteId}: ${result.passed}/${result.total} (${(result.passRate * 100).toFixed(0)}%) ${result.ok ? "PASS" : "FAIL"}`,
    );
    if (!result.ok) {
      for (const c of result.cases.filter((x) => !x.ok)) {
        console.log(`  - ${c.caseId}: ${c.message ?? "failed"}`);
      }
      return false;
    }
  }

  return true;
}
