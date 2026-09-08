import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolCallRecord } from "@monai/contracts";
import { PackRegistrationService } from "@monai/governance";
import {
  createWorkspaceGenericPack,
  KNOWLEDGE_SEARCH_ALLOWLIST_ENTRY,
  SANDBOX_EXEC_ALLOWLIST_ENTRY,
  WORKSPACE_EXEC_ALLOWLIST_ENTRY,
  WORKSPACE_GENERIC_REQUIRE_APPROVAL,
  WORKSPACE_GENERIC_TOOL_ALLOWLIST,
} from "@monai/pack-workspace-generic";
import type {
  GovernanceEventStorePort,
  ObjectStorePort,
  SandboxPort,
  WorkspacePort,
  WorkspaceShellPort,
} from "@monai/ports";
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
  /**
   * Opt-in sandbox.exec (0025). Requires a non-RejectingSandbox implementation.
   * Appends allowlist entry and Registry allowEdr014Tools.
   */
  enableSandboxExec?: boolean;
  /**
   * Opt-in workspace.exec (bash in workspace root). Requires WorkspaceShellPort.
   * Appends allowlist entry and Registry allowEdr014Tools.
   */
  enableWorkspaceExec?: boolean;
  /** Injected when enableWorkspaceExec is true. */
  workspaceShell?: WorkspaceShellPort;
};

export type WireWorkspaceGenericResult = {
  registry: ExtensionRegistry;
  invoker: ToolInvoker;
  hookRunner: HookRunner;
  synthetic: IsolatedSyntheticSink;
  objectStore: ObjectStorePort;
  sandbox: SandboxPort;
  workspaceShell?: WorkspaceShellPort;
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
  const enableSandboxExec = options.enableSandboxExec === true;
  const enableWorkspaceExec = options.enableWorkspaceExec === true;
  const workspaceShell = options.workspaceShell;

  if (enableSandboxExec && sandbox instanceof RejectingSandbox) {
    throw new Error(
      "enableSandboxExec requires an executable SandboxPort (got RejectingSandbox)",
    );
  }
  if (enableWorkspaceExec && !workspaceShell) {
    throw new Error("enableWorkspaceExec requires a WorkspaceShellPort");
  }

  const contribution = createWorkspaceGenericPack();
  const edrAllow: string[] = [];
  if (enableSandboxExec) edrAllow.push(SANDBOX_EXEC_ALLOWLIST_ENTRY);
  if (enableWorkspaceExec) edrAllow.push(WORKSPACE_EXEC_ALLOWLIST_ENTRY);
  const registerInput = {
    tenantId,
    contribution,
    ...(edrAllow.length > 0 ? { allowEdr014Tools: edrAllow } : {}),
  };

  let packRegistration: PackRegistrationService | undefined;
  const registration = options.governanceStore
    ? (() => {
        packRegistration = new PackRegistrationService({
          registry,
          governanceStore: options.governanceStore,
        });
        return packRegistration.register(registerInput);
      })()
    : registry.register(registerInput);
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
      ...(enableWorkspaceExec && workspaceShell ? { workspaceShell } : {}),
    },
  });

  const invoker = buildToolInvokerFromRegistry(registry, {
    extraHandlers: { echo: LEGACY_ECHO_HANDLER },
    buildExecutionContext,
  });

  const toolAllowlist = [
    ...WORKSPACE_GENERIC_TOOL_ALLOWLIST,
    ...(options.knowledgeSearch ? [KNOWLEDGE_SEARCH_ALLOWLIST_ENTRY] : []),
    ...(enableSandboxExec ? [SANDBOX_EXEC_ALLOWLIST_ENTRY] : []),
    ...(enableWorkspaceExec ? [WORKSPACE_EXEC_ALLOWLIST_ENTRY] : []),
  ];

  return {
    registry,
    invoker,
    hookRunner,
    synthetic,
    objectStore,
    sandbox,
    ...(workspaceShell ? { workspaceShell } : {}),
    toolAllowlist,
    requireApprovalTools: WORKSPACE_GENERIC_REQUIRE_APPROVAL,
    packRegistration,
  };
}
