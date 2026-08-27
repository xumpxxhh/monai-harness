export { applyCommit, type ApplyCommitOptions } from "./commit/apply-commit.js";
export { orderEventCandidates } from "./ordering/order-events.js";
export { Engine, queueDedupeKey, type CreateRunPayload, type EngineDeps } from "./engine/engine.js";
export type { HandleFailure, HandleResult, HandleSuccess } from "./engine/types.js";
export { HookRunner } from "./hooks/hook-runner.js";
export { buildContext, type TurnContext } from "./context/build-context.js";
export {
  DEFAULT_REQUIRE_APPROVAL_TOOLS,
  DEFAULT_TOOL_ALLOWLIST,
  evaluatePolicy,
  isReadonlyTool,
  type PolicyEvaluation,
  type PolicyRuleInput,
} from "./policy/evaluate-policy.js";
export {
  evaluateAcceptanceChecks,
  requiredAcceptanceChecksPassed,
  type AcceptanceCheckResult,
  type AcceptanceDecision,
} from "./control/acceptance-checks.js";
export {
  reduce,
  validateObservationToFact,
  type FactValidationResult,
} from "./state/reducer.js";
export { ToolInvoker, type ToolInvokerDeps, type ToolInvokeResult } from "./execution/tool-invoker.js";
export { lookupToolContract, TOOL_CATALOG } from "./execution/tool-catalog.js";
export { computeActionDigest, actionDigestMeta } from "./control/action-digest.js";
export {
  RecoveryService,
  selectValidCheckpoint,
  type RecoveryResult,
  type RecoverySuccess,
  type ToolInventory,
} from "./recovery/recovery-service.js";
export { replayEvents, type ReplayEventsArgs } from "./recovery/replay-events.js";
export { computeStateHash } from "./recovery/state-hash.js";

export const PACKAGE_NAME = "@monai/runtime" as const;
