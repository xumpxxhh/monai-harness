import type { ToolCallRecord } from "@monai/contracts";
import {
  createWorkspaceGenericPack,
  WORKSPACE_GENERIC_REQUIRE_APPROVAL,
  WORKSPACE_GENERIC_TOOL_ALLOWLIST,
} from "@monai/pack-workspace-generic";
import type { ExecutionContext } from "@monai/pack-sdk";
import type { WorkspacePort } from "@monai/ports";
import { IsolatedSyntheticSink } from "@monai/synthetic-sink";

import { ExtensionRegistry } from "../extension/extension-registry.js";
import { buildToolInvokerFromRegistry, LEGACY_ECHO_HANDLER } from "../extension/wire-pack.js";
import { HookRunner } from "../hooks/hook-runner.js";
import { ToolInvoker } from "../execution/tool-invoker.js";

export type WireTestWorkspacePackOptions = {
  workspace?: WorkspacePort;
  tenantId?: string;
};

export type WireTestWorkspacePackResult = {
  registry: ExtensionRegistry;
  invoker: ToolInvoker;
  hookRunner: HookRunner;
  synthetic: IsolatedSyntheticSink;
  artifacts: Map<string, { markdown: string; hash: string }>;
  toolAllowlist: readonly string[];
  requireApprovalTools: readonly string[];
};

/** Test-only Pack wiring; production uses `@monai/delivery` wireWorkspaceGenericPack. */
export function wireTestWorkspacePack(
  options: WireTestWorkspacePackOptions = {},
): WireTestWorkspacePackResult {
  const tenantId = options.tenantId ?? "t1";
  const registry = new ExtensionRegistry();
  const hookRunner = new HookRunner();
  const synthetic = new IsolatedSyntheticSink();
  const artifacts = new Map<string, { markdown: string; hash: string }>();
  const contribution = createWorkspaceGenericPack();

  const registration = registry.register({ tenantId, contribution });
  if (registration.status === "rejected") {
    throw new Error(
      `workspace-generic pack registration rejected: ${registration.contributions
        .map((c) => c.reasonCodes.join(","))
        .join(";")}`,
    );
  }

  registry.wireHooks(hookRunner);

  const buildExecutionContext = (toolCall: ToolCallRecord): ExecutionContext => ({
    tenantId: toolCall.tenantId,
    sessionId: toolCall.sessionId,
    runId: toolCall.runId,
    stepId: toolCall.stepId,
    executionManifestRef: toolCall.executionManifestRef,
    effectivePermissions: [],
    leaseEpoch: toolCall.dispatchLeaseEpoch,
    ports: {
      workspace: options.workspace,
      objectStore: artifacts,
      telemetry: synthetic,
    },
  });

  const invoker = buildToolInvokerFromRegistry(registry, {
    extraHandlers: { echo: LEGACY_ECHO_HANDLER },
    buildExecutionContext,
  });

  return {
    registry,
    invoker,
    hookRunner,
    synthetic,
    artifacts,
    toolAllowlist: WORKSPACE_GENERIC_TOOL_ALLOWLIST,
    requireApprovalTools: WORKSPACE_GENERIC_REQUIRE_APPROVAL,
  };
}
