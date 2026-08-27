import type { ContextContribution } from "@monai/pack-sdk";
import type { Run, RunState } from "@monai/contracts";

export type TurnContext = {
  tenantId: string;
  sessionId: string;
  runId: string;
  stepId: string;
  goal: string;
  state: RunState;
  toolAllowlist: readonly string[];
  hookContributions: ContextContribution[];
};

/**
 * Context Builder — budgeted view for Model; not durable truth.
 */
export function buildContext(input: {
  run: Run;
  stepId: string;
  state: RunState;
  toolAllowlist: readonly string[];
  hookContributions?: ContextContribution[];
}): TurnContext {
  return {
    tenantId: input.run.tenantId,
    sessionId: input.run.sessionId,
    runId: input.run.runId,
    stepId: input.stepId,
    goal: input.run.goal,
    state: input.state,
    toolAllowlist: input.toolAllowlist,
    hookContributions: input.hookContributions ?? [],
  };
}
