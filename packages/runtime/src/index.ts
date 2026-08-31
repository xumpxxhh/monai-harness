export { applyCommit, type ApplyCommitOptions } from "./commit/apply-commit.js";
export { orderEventCandidates } from "./ordering/order-events.js";
export { Engine, queueDedupeKey, type CreateRunPayload, type EngineDeps } from "./engine/engine.js";
export { assertCommandTenant } from "./engine/tenant-guard.js";
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
export { ToolInvoker, createToolInvokerFromHandlers, type ToolInvokerDeps, type ToolInvokeResult } from "./execution/tool-invoker.js";
export { lookupToolContract, TOOL_CATALOG, requiresIdempotencyKey } from "./execution/lookup-tool-contract.js";
export { ExtensionRegistry, type RegisterPackInput } from "./extension/extension-registry.js";
export { buildToolInvokerFromRegistry, LEGACY_ECHO_HANDLER } from "./extension/wire-pack.js";
export { EDR014_DISABLED_TOOL_IDS, isEdr014DisabledTool } from "./extension/edr014.js";
export { computeActionDigest, actionDigestMeta } from "./control/action-digest.js";
export { projectActionForUser } from "./control/project-action.js";
export { PreviewHub, type ModelPreviewEvent, type PreviewListener } from "./preview/preview-hub.js";
export {
  RecoveryService,
  selectValidCheckpoint,
  type RecoveryResult,
  type RecoverySuccess,
  type ToolInventory,
} from "./recovery/recovery-service.js";
export { replayEvents, type ReplayEventsArgs } from "./recovery/replay-events.js";
export { computeStateHash } from "./recovery/state-hash.js";
export { computeManifestHash, finalizeExecutionManifest } from "./manifest/manifest-hash.js";
export { buildExecutionManifest, type BuildExecutionManifestInput } from "./manifest/build-manifest.js";
export { freezeExecutionManifest, type FreezeExecutionManifestInput } from "./manifest/freeze-manifest.js";
export {
  resolveRunExecutionPolicy,
  type ResolvedExecutionPolicy,
  type ExecutionPolicyFallback,
} from "./manifest/resolve-manifest.js";
export { InMemoryManifestStore } from "./manifest/memory-manifest-store.js";

export const PACKAGE_NAME = "@monai/runtime" as const;
