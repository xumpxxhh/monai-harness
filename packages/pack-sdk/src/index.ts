import type { PackManifest } from "@monai/contracts";

/**
 * Pack-facing hook / tool handler types.
 *
 * Packs MUST NOT receive Persistence, Engine, Approval append, or arbitrary Secret clients.
 */

export const HOOK_POINTS = [
  "PreReasoning",
  "PostReasoning",
  "PreToolCall",
  "PostToolCall",
  "OnRunEnd",
] as const;

export type HookPoint = (typeof HOOK_POINTS)[number];

export type ContextContribution = {
  sourceId: string;
  priority?: number;
  ttlMs?: number;
  content: unknown;
};

export type HookObservationCandidate = {
  data: unknown;
  declaredSchemaRef?: string;
  hash?: string;
};

/**
 * Allowed Hook return surface (design 03 §5.2 / engineering 04).
 * Handlers return candidates only — Engine commits Events / State.
 */
export type HookResult = {
  veto?: boolean;
  vetoReason?: string;
  failed?: boolean;
  failureReason?: string;
  contextContributions?: ContextContribution[];
  observations?: HookObservationCandidate[];
};

export type HookHandlerInput = {
  hookPoint: HookPoint;
  tenantId: string;
  sessionId: string;
  runId: string;
  stepId: string;
  /** Opaque turn context; Packs must not assume Persistence access. */
  context: unknown;
  action?: unknown;
};

export type HookHandler = (input: HookHandlerInput) => Promise<HookResult> | HookResult;

/**
 * Capability-scoped ExecutionContext passed to Tool/Hook invocations (engineering 04 §4).
 * Ports are limited per-call.
 */
export type ExecutionContext = {
  tenantId: string;
  sessionId: string;
  runId: string;
  stepId?: string;
  executionManifestRef: string;
  principalRef?: { principalId: string; role?: string };
  effectivePermissions: readonly string[];
  resourceScope?: unknown;
  deadline?: string;
  leaseEpoch?: number;
  ports?: {
    workspace?: unknown;
    objectStore?: unknown;
    knowledge?: unknown;
    secretLease?: unknown;
    sandbox?: unknown;
    telemetry?: unknown;
  };
};

export type ToolHandlerInput = {
  toolId: string;
  arguments: unknown;
  executionContext: ExecutionContext;
  toolCallId: string;
  idempotencyKey?: string;
};

export type ToolHandlerResult = {
  ok: boolean;
  data?: unknown;
  error?: string;
  unknown?: boolean;
  resultRef?: string;
  resultHash?: string;
};

export type ToolHandler = (input: ToolHandlerInput) => Promise<ToolHandlerResult> | ToolHandlerResult;

export type PackHookRegistration = {
  hookPoint: HookPoint;
  handlerId: string;
  handler: HookHandler;
};

export type PackContributionDefinition = {
  manifest: PackManifest;
  tools?: Record<string, ToolHandler>;
  hooks?: PackHookRegistration[];
};

export const PACKAGE_NAME = "@monai/pack-sdk" as const;
