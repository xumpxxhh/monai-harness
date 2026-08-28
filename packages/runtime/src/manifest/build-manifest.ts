import {
  CONTRACTS_SCHEMA_VERSION,
  executionManifestSchema,
  type AcceptanceCheck,
  type ExecutionManifest,
  type PackToolDefinition,
} from "@monai/contracts";

import type { ExtensionRegistry } from "../extension/extension-registry.js";
import { finalizeExecutionManifest } from "./manifest-hash.js";

export type BuildExecutionManifestInput = {
  manifestId: string;
  tenantId: string;
  agentDefinitionId: string;
  agentVersion: string;
  agentDigest?: string;
  packVersions: Array<{ packId: string; version: string; digest?: string }>;
  strategy: { type: "light" | "dag"; version: string };
  registry: ExtensionRegistry;
  /** Effective tool allowlist including legacy extras (e.g. echo). */
  toolAllowlist: readonly string[];
  requireApprovalTools?: readonly string[];
  acceptanceChecks?: readonly AcceptanceCheck[];
  budgets?: Record<string, unknown>;
};

function collectPackTools(registry: ExtensionRegistry, toolAllowlist: readonly string[]): PackToolDefinition[] {
  const tools: PackToolDefinition[] = [];
  for (const toolId of toolAllowlist) {
    const contract = registry.lookupToolContract(toolId);
    if (!contract) continue;
    tools.push({
      toolId,
      version: "0.1.0",
      effectContract: contract,
    });
  }
  return tools;
}

export function buildExecutionManifest(input: BuildExecutionManifestInput): ExecutionManifest {
  const now = new Date().toISOString();
  const draft = {
    schemaVersion: CONTRACTS_SCHEMA_VERSION,
    manifestId: input.manifestId,
    createdAt: now,
    eventOrderingVersion: "1",
    agentDefinition: {
      agentDefinitionId: input.agentDefinitionId,
      version: input.agentVersion,
      digest: input.agentDigest ?? `digest:${input.agentDefinitionId}@${input.agentVersion}`,
    },
    packVersions: input.packVersions.map((pack) => ({
      packId: pack.packId,
      version: pack.version,
      digest: pack.digest ?? `digest:${pack.packId}@${pack.version}`,
    })),
    tools: collectPackTools(input.registry, input.toolAllowlist),
    hooks: undefined,
    strategy: {
      type: input.strategy.type,
      version: input.strategy.version,
      digest: `digest:strategy:${input.strategy.type}@${input.strategy.version}`,
    },
    toolAllowlist: [...input.toolAllowlist],
    requireApprovalTools: [...(input.requireApprovalTools ?? [])],
    acceptanceChecks: [...(input.acceptanceChecks ?? [])],
    budgets: input.budgets,
    coreContractVersion: CONTRACTS_SCHEMA_VERSION,
  };

  const manifest = finalizeExecutionManifest(draft);
  return executionManifestSchema.parse(manifest);
}
