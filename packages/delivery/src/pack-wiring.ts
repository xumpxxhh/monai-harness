import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolCallRecord } from "@monai/contracts";
import { PackRegistrationService } from "@monai/governance";
import { createWorkspaceGenericPack, KNOWLEDGE_SEARCH_ALLOWLIST_ENTRY, WORKSPACE_GENERIC_REQUIRE_APPROVAL, WORKSPACE_GENERIC_TOOL_ALLOWLIST } from "@monai/pack-workspace-generic";
import type { GovernanceEventStorePort, ObjectStorePort, SandboxPort, WorkspacePort } from "@monai/ports";
import type { KnowledgeSearchClient } from "@monai/knowledge-http";
import type { ExecutionContext } from "@monai/pack-sdk";
import { FsObjectStore } from "@monai/objectstore-fs";
import {
  ExtensionRegistry,
  HookRunner,
  ToolInvoker,
  buildToolInvokerFromRegistry,
  LEGACY_ECHO_HANDLER,
} from "@monai/runtime";
import { RejectingSandbox } from "@monai/sandbox-stub";
import { IsolatedSyntheticSink } from "@monai/synthetic-sink";

export type WireWorkspaceGenericOptions = {
  workspace?: WorkspacePort;
  tenantId?: string;
  /** When set, enables `knowledge.search` in allowlist and injects ports.knowledge (EDR-016). */
  knowledgeSearch?: KnowledgeSearchClient;
  /** When set, Pack registration is audited to GovernanceEvent (P9c). */
  governanceStore?: GovernanceEventStorePort;
  /** Defaults to FsObjectStore under os.tmpdir (Eval/L1). Harness injects configured root. */
  objectStore?: ObjectStorePort;
  /** Defaults to RejectingSandbox (EDR-014). */
  sandbox?: SandboxPort;
};

export type WireWorkspaceGenericResult = {
  registry: ExtensionRegistry;
  invoker: ToolInvoker;
  hookRunner: HookRunner;
  synthetic: IsolatedSyntheticSink;
  objectStore: ObjectStorePort;
  sandbox: SandboxPort;
  toolAllowlist: readonly string[];
  requireApprovalTools: readonly string[];
  packRegistration?: PackRegistrationService;
};

function defaultFsObjectStore(tenantId: string): FsObjectStore {
  const safeTenant = tenantId.replace(/[/\\]/g, "_") || "t1";
  return new FsObjectStore({
    rootDir: mkdtempSync(join(tmpdir(), "monai-objectstore-")),
    tenantId: safeTenant,
  });
}

export function wireWorkspaceGenericPack(
  options: WireWorkspaceGenericOptions = {},
): WireWorkspaceGenericResult {
  const tenantId = options.tenantId ?? "t1";
  const registry = new ExtensionRegistry();
  const hookRunner = new HookRunner();
  const synthetic = new IsolatedSyntheticSink();
  const objectStore = options.objectStore ?? defaultFsObjectStore(tenantId);
  const sandbox = options.sandbox ?? new RejectingSandbox();
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
      objectStore,
      sandbox,
      telemetry: synthetic,
      ...(options.knowledgeSearch ? { knowledge: options.knowledgeSearch } : {}),
    },
  });

  const invoker = buildToolInvokerFromRegistry(registry, {
    extraHandlers: { echo: LEGACY_ECHO_HANDLER },
    buildExecutionContext,
  });

  const toolAllowlist = options.knowledgeSearch
    ? [...WORKSPACE_GENERIC_TOOL_ALLOWLIST, KNOWLEDGE_SEARCH_ALLOWLIST_ENTRY]
    : WORKSPACE_GENERIC_TOOL_ALLOWLIST;

  return {
    registry,
    invoker,
    hookRunner,
    synthetic,
    objectStore,
    sandbox,
    toolAllowlist,
    requireApprovalTools: WORKSPACE_GENERIC_REQUIRE_APPROVAL,
    packRegistration,
  };
}
