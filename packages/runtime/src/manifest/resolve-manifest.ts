import {
  executionManifestSchema,
  type AcceptanceCheck,
  type ExecutionManifest,
  type Run,
} from "@monai/contracts";
import type { ExecutionManifestStorePort } from "@monai/ports";

import {
  DEFAULT_REQUIRE_APPROVAL_TOOLS,
  DEFAULT_TOOL_ALLOWLIST,
} from "../policy/evaluate-policy.js";

export type ResolvedExecutionPolicy = {
  toolAllowlist: readonly string[];
  requireApprovalTools: readonly string[];
  acceptanceChecks: readonly AcceptanceCheck[];
  manifest?: ExecutionManifest;
};

export type ExecutionPolicyFallback = {
  toolAllowlist?: readonly string[];
  requireApprovalTools?: readonly string[];
  acceptanceChecks?: readonly AcceptanceCheck[];
};

export async function resolveRunExecutionPolicy(
  store: ExecutionManifestStorePort | undefined,
  run: Run,
  fallback: ExecutionPolicyFallback,
): Promise<ResolvedExecutionPolicy | { ok: false; code: "fatal"; message: string }> {
  if (!run.executionManifestHash) {
    return {
      toolAllowlist: fallback.toolAllowlist ?? DEFAULT_TOOL_ALLOWLIST,
      requireApprovalTools: fallback.requireApprovalTools ?? DEFAULT_REQUIRE_APPROVAL_TOOLS,
      acceptanceChecks: fallback.acceptanceChecks ?? [],
    };
  }

  if (!store) {
    return {
      ok: false,
      code: "fatal",
      message: "run has executionManifestHash but no manifest store configured",
    };
  }

  const stored = await store.get(run.executionManifestRef);
  if (!stored) {
    return {
      ok: false,
      code: "fatal",
      message: `execution manifest not found: ${run.executionManifestRef}`,
    };
  }

  if (stored.hash !== run.executionManifestHash) {
    return {
      ok: false,
      code: "fatal",
      message: "execution manifest hash mismatch with run",
    };
  }

  const parsed = executionManifestSchema.safeParse(stored.content);
  if (!parsed.success) {
    return { ok: false, code: "fatal", message: "execution manifest content invalid" };
  }

  if (parsed.data.hash !== run.executionManifestHash) {
    return {
      ok: false,
      code: "fatal",
      message: "execution manifest embedded hash mismatch",
    };
  }

  return {
    toolAllowlist: parsed.data.toolAllowlist,
    requireApprovalTools: parsed.data.requireApprovalTools,
    acceptanceChecks: parsed.data.acceptanceChecks,
    manifest: parsed.data,
  };
}
