import type { ToolCallRecord } from "@monai/contracts";
import { PackRegistrationService } from "@monai/governance";
import { createWorkspaceGenericPack, WORKSPACE_GENERIC_REQUIRE_APPROVAL, WORKSPACE_GENERIC_TOOL_ALLOWLIST } from "@monai/pack-workspace-generic";
import type { GovernanceEventStorePort, WorkspacePort } from "@monai/ports";
import type { ExecutionContext } from "@monai/pack-sdk";
import {
  ExtensionRegistry,
  HookRunner,
  ToolInvoker,
  buildToolInvokerFromRegistry,
  LEGACY_ECHO_HANDLER,
} from "@monai/runtime";
import { IsolatedSyntheticSink } from "@monai/synthetic-sink";

export type WireWorkspaceGenericOptions = {
  workspace?: WorkspacePort;
  tenantId?: string;
  /** When set, Pack registration is audited to GovernanceEvent (P9c). */
  governanceStore?: GovernanceEventStorePort;
};

export type WireWorkspaceGenericResult = {
  registry: ExtensionRegistry;
  invoker: ToolInvoker;
  hookRunner: HookRunner;
  synthetic: IsolatedSyntheticSink;
  artifacts: Map<string, { markdown: string; hash: string }>;
  toolAllowlist: readonly string[];
  requireApprovalTools: readonly string[];
  packRegistration?: PackRegistrationService;
};

export function wireWorkspaceGenericPack(
  options: WireWorkspaceGenericOptions = {},
): WireWorkspaceGenericResult {
  const tenantId = options.tenantId ?? "t1";
  const registry = new ExtensionRegistry();
  const hookRunner = new HookRunner();
  const synthetic = new IsolatedSyntheticSink();
  const artifacts = new Map<string, { markdown: string; hash: string }>();
  const contribution = createWorkspaceGenericPack();

  let packRegistration: PackRegistrationService | undefined;
  const registration = options.governanceStore
    ? (() => {
        packRegistration = new PackRegistrationService({
          registry,
          governanceStore: options.governanceStore,
        });
        return packRegistration.register({ tenantId, contribution });
      })()
    : registry.register({ tenantId, contribution });
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
    packRegistration,
  };
}
