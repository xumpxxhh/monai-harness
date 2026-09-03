import {
  CONTRACTS_SCHEMA_VERSION,
  packManifestSchema,
  type PackContributionRecord,
  type PackRegistrationResult,
  type PackToolDefinition,
  type ToolEffectContract,
} from "@monai/contracts";
import type { PackContributionDefinition, ToolHandler } from "@monai/pack-sdk";

import { HookRunner } from "../hooks/hook-runner.js";
import {
  isEdr014DisabledPermission,
  isEdr014DisabledTool,
  requiredPermissionsForTool,
} from "./edr014.js";

export type RegisterPackInput = {
  tenantId: string;
  contribution: PackContributionDefinition;
};

type RegisteredPack = {
  tenantId: string;
  contribution: PackContributionDefinition;
  result: PackRegistrationResult;
};

function stableDigest(value: unknown): string {
  return `digest:${JSON.stringify(value)}`;
}

/**
 * In-memory Extension Registry (P9a). Validates Pack manifests; does not persist.
 */
export class ExtensionRegistry {
  private readonly byPackKey = new Map<string, RegisteredPack>();
  private readonly toolDefinitions = new Map<string, PackToolDefinition>();
  private readonly toolHandlers = new Map<string, ToolHandler>();
  private readonly reconcileHandlers = new Map<string, ToolHandler>();

  register(input: RegisterPackInput): PackRegistrationResult {
    const parsed = packManifestSchema.safeParse(input.contribution.manifest);
    const contributions: PackContributionRecord[] = [];
    const now = new Date().toISOString();

    if (!parsed.success) {
      return {
        schemaVersion: CONTRACTS_SCHEMA_VERSION,
        registrationId: `reg-reject-${input.contribution.manifest.packId}`,
        tenantId: input.tenantId,
        packRef: {
          packId: input.contribution.manifest.packId,
          version: input.contribution.manifest.version,
        },
        manifestDigest: stableDigest(input.contribution.manifest),
        status: "rejected",
        resolvedDependencies: [],
        contributions: [
          {
            kind: "tool",
            id: input.contribution.manifest.packId,
            version: input.contribution.manifest.version,
            status: "rejected",
            reasonCodes: ["manifest_invalid"],
            effectivePermissions: [],
          },
        ],
        createdAt: now,
        hash: stableDigest({ status: "rejected", packId: input.contribution.manifest.packId }),
      };
    }

    const manifest = parsed.data;
    const permissionsRequested = new Set(manifest.permissionsRequested);
    let rejected = false;

    for (const permission of manifest.permissionsRequested) {
      if (isEdr014DisabledPermission(permission)) {
        rejected = true;
        contributions.push({
          kind: "tool",
          id: permission,
          version: manifest.version,
          status: "rejected",
          reasonCodes: ["edr014_disabled_permission"],
          effectivePermissions: [],
        });
      }
    }

    for (const tool of manifest.tools) {
      if (isEdr014DisabledTool(tool.toolId)) {
        rejected = true;
        contributions.push({
          kind: "tool",
          id: tool.toolId,
          version: tool.version,
          status: "rejected",
          reasonCodes: ["edr014_disabled_tool"],
          effectivePermissions: [],
        });
        continue;
      }

      const required = requiredPermissionsForTool(tool.toolId, tool.effectContract.sideEffectProfile);
      const missingPermission = required.find((p) => !permissionsRequested.has(p));
      if (missingPermission) {
        rejected = true;
        contributions.push({
          kind: "tool",
          id: tool.toolId,
          version: tool.version,
          status: "rejected",
          reasonCodes: ["permission_not_requested"],
          effectivePermissions: [],
        });
        continue;
      }

      const handler = input.contribution.tools?.[tool.toolId];
      if (!handler) {
        rejected = true;
        contributions.push({
          kind: "tool",
          id: tool.toolId,
          version: tool.version,
          status: "rejected",
          reasonCodes: ["handler_missing"],
          effectivePermissions: required,
        });
        continue;
      }

      if (this.toolDefinitions.has(tool.toolId)) {
        rejected = true;
        contributions.push({
          kind: "tool",
          id: tool.toolId,
          version: tool.version,
          status: "rejected",
          reasonCodes: ["tool_id_conflict"],
          effectivePermissions: required,
        });
        continue;
      }

      contributions.push({
        kind: "tool",
        id: tool.toolId,
        version: tool.version,
        status: "registered",
        reasonCodes: [],
        effectivePermissions: required,
      });
    }

    for (const hook of manifest.hooks ?? []) {
      const hookReg = input.contribution.hooks?.find((h) => h.handlerId === hook.handlerId);
      if (!hookReg) {
        rejected = true;
        contributions.push({
          kind: "hook",
          id: hook.handlerId,
          version: hook.version ?? manifest.version,
          status: "rejected",
          reasonCodes: ["handler_missing"],
          effectivePermissions: [],
        });
        continue;
      }
      contributions.push({
        kind: "hook",
        id: hook.handlerId,
        version: hook.version ?? manifest.version,
        status: "registered",
        reasonCodes: [],
        effectivePermissions: [],
      });
    }

    const hasRegisteredTool = contributions.some(
      (c) => c.kind === "tool" && c.status === "registered",
    );
    const status = rejected
      ? hasRegisteredTool
        ? "partial_rejected"
        : "rejected"
      : "active";

    const result: PackRegistrationResult = {
      schemaVersion: CONTRACTS_SCHEMA_VERSION,
      registrationId: `reg-${manifest.packId}-${manifest.version}`,
      tenantId: input.tenantId,
      packRef: { packId: manifest.packId, version: manifest.version },
      manifestDigest: manifest.digest ?? stableDigest(manifest),
      status,
      resolvedDependencies: [],
      contributions,
      createdAt: now,
      hash: stableDigest({ status, packId: manifest.packId, version: manifest.version }),
    };

    if (status === "rejected") {
      return result;
    }

    const packKey = `${input.tenantId}:${manifest.packId}:${manifest.version}`;
    this.byPackKey.set(packKey, { tenantId: input.tenantId, contribution: input.contribution, result });

    for (const tool of manifest.tools) {
      const record = contributions.find((c) => c.kind === "tool" && c.id === tool.toolId);
      if (record?.status !== "registered") continue;
      this.toolDefinitions.set(tool.toolId, tool);
      const handler = input.contribution.tools![tool.toolId]!;
      this.toolHandlers.set(tool.toolId, handler);
      if (tool.toolId === "synthetic.write_high") {
        const reconcile = input.contribution.tools?.["synthetic.write_high.reconcile"];
        if (reconcile) {
          this.reconcileHandlers.set("synthetic.write_high", reconcile);
        }
      }
    }

    return result;
  }

  getToolDefinition(toolId: string): PackToolDefinition | undefined {
    return this.toolDefinitions.get(toolId);
  }

  listToolDefinitions(): PackToolDefinition[] {
    return [...this.toolDefinitions.values()].sort((a, b) => a.toolId.localeCompare(b.toolId));
  }

  /** Registered tools with defaultEnabled !== false (excludes opt-in tools). */
  getDefaultAllowlist(): string[] {
    return this.listToolDefinitions()
      .filter((tool) => tool.defaultEnabled !== false)
      .map((tool) => tool.toolId);
  }

  lookupToolContract(toolId: string): ToolEffectContract | undefined {
    return this.toolDefinitions.get(toolId)?.effectContract;
  }

  getToolHandler(toolId: string): ToolHandler | undefined {
    return this.toolHandlers.get(toolId);
  }

  getReconcileHandler(toolId: string): ToolHandler | undefined {
    return this.reconcileHandlers.get(toolId);
  }

  getToolAllowlist(): string[] {
    return [...this.toolHandlers.keys()].sort();
  }

  wireHooks(hookRunner: HookRunner): void {
    for (const registered of this.byPackKey.values()) {
      for (const hook of registered.contribution.hooks ?? []) {
        hookRunner.register(hook.hookPoint, hook.handlerId, hook.handler);
      }
    }
  }
}
