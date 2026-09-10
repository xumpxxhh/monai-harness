import { describe, expect, it } from "vitest";

import { CONTRACTS_SCHEMA_VERSION } from "@monai/contracts";
import type { PackContributionDefinition } from "@monai/pack-sdk";

import { ExtensionRegistry } from "./extension-registry.js";

const baseContract = {
  schemaVersion: CONTRACTS_SCHEMA_VERSION,
  sideEffectProfile: "read" as const,
  deliverySemantics: "at_most_once" as const,
  idempotencyScope: "run" as const,
  reconcileSupported: false,
  timeoutMs: 5_000,
};

function stubHandler() {
  return async () => ({ ok: true, data: {} });
}

function validContribution(overrides?: Partial<PackContributionDefinition>): PackContributionDefinition {
  return {
    manifest: {
      schemaVersion: CONTRACTS_SCHEMA_VERSION,
      packId: "com.monai.pack.test",
      version: "0.1.0",
      coreContractRange: ">=0.1.0 <1.0.0",
      permissionsRequested: ["workspace_read", "workspace_write", "artifact_write", "synthetic_write_high"],
      tools: [
        {
          toolId: "workspace_read",
          version: "0.1.0",
          effectContract: baseContract,
        },
      ],
      hooks: [],
    },
    tools: {
      "workspace_read": stubHandler(),
    },
    hooks: [],
    ...overrides,
  };
}

describe("ExtensionRegistry", () => {
  it("rejects EDR-014 disabled tools when pack has no other tools", () => {
    const registry = new ExtensionRegistry();
    const contribution = validContribution({
      manifest: {
        ...validContribution().manifest,
        tools: [
          {
            toolId: "sandbox_exec",
            version: "0.1.0",
            effectContract: { ...baseContract, sideEffectProfile: "write_high" },
          },
        ],
      },
      tools: { "sandbox_exec": stubHandler() },
    });
    const result = registry.register({ tenantId: "t1", contribution });
    expect(result.status).toBe("rejected");
    expect(result.contributions.some((c) => c.reasonCodes.includes("edr014_disabled_tool"))).toBe(true);
  });

  it("allows sandbox_exec when allowEdr014Tools includes it", () => {
    const registry = new ExtensionRegistry();
    const contribution = validContribution({
      manifest: {
        ...validContribution().manifest,
        permissionsRequested: [
          ...validContribution().manifest.permissionsRequested,
          "sandbox_exec",
        ],
        tools: [
          {
            toolId: "sandbox_exec",
            version: "0.1.0",
            effectContract: { ...baseContract, sideEffectProfile: "write_high" },
          },
        ],
      },
      tools: { "sandbox_exec": stubHandler() },
    });
    const result = registry.register({
      tenantId: "t1",
      contribution,
      allowEdr014Tools: ["sandbox_exec"],
    });
    expect(result.status).toBe("active");
    expect(registry.getToolAllowlist()).toContain("sandbox_exec");
  });

  it("allows workspace_exec when allowEdr014Tools includes it", () => {
    const registry = new ExtensionRegistry();
    const contribution = validContribution({
      manifest: {
        ...validContribution().manifest,
        permissionsRequested: [
          ...validContribution().manifest.permissionsRequested,
          "workspace_exec",
        ],
        tools: [
          {
            toolId: "workspace_exec",
            version: "0.1.0",
            effectContract: { ...baseContract, sideEffectProfile: "write_high" },
          },
        ],
      },
      tools: { "workspace_exec": stubHandler() },
    });
    const result = registry.register({
      tenantId: "t1",
      contribution,
      allowEdr014Tools: ["workspace_exec"],
    });
    expect(result.status).toBe("active");
    expect(registry.getToolAllowlist()).toContain("workspace_exec");
  });

  it("keeps pack active when sandbox_exec is soft-disabled beside other tools", () => {
    const registry = new ExtensionRegistry();
    const contribution = validContribution({
      manifest: {
        ...validContribution().manifest,
        permissionsRequested: [
          ...validContribution().manifest.permissionsRequested,
          "sandbox_exec",
        ],
        tools: [
          ...validContribution().manifest.tools,
          {
            toolId: "sandbox_exec",
            version: "0.1.0",
            effectContract: { ...baseContract, sideEffectProfile: "write_high" },
          },
        ],
      },
      tools: {
        ...validContribution().tools,
        "sandbox_exec": stubHandler(),
      },
    });
    const result = registry.register({ tenantId: "t1", contribution });
    expect(result.status).toBe("active");
    expect(registry.getToolAllowlist()).not.toContain("sandbox_exec");
    expect(registry.getToolAllowlist()).toContain("workspace_read");
  });

  it("rejects missing handler", () => {
    const registry = new ExtensionRegistry();
    const contribution = validContribution({ tools: {} });
    const result = registry.register({ tenantId: "t1", contribution });
    expect(result.status).toBe("rejected");
    expect(result.contributions.some((c) => c.reasonCodes.includes("handler_missing"))).toBe(true);
  });

  it("rejects dotted toolId that fails wire name pattern", () => {
    const registry = new ExtensionRegistry();
    const contribution = validContribution({
      manifest: {
        ...validContribution().manifest,
        tools: [
          {
            toolId: "workspace.read",
            version: "0.1.0",
            effectContract: baseContract,
          },
        ],
      },
      tools: { "workspace.read": stubHandler() },
    });
    const result = registry.register({ tenantId: "t1", contribution });
    expect(result.status).toBe("rejected");
    expect(result.contributions.some((c) => c.reasonCodes.includes("invalid_tool_id"))).toBe(true);
  });

  it("registers valid pack and exposes allowlist", () => {
    const registry = new ExtensionRegistry();
    const result = registry.register({ tenantId: "t1", contribution: validContribution() });
    expect(result.status).toBe("active");
    expect(registry.getToolAllowlist()).toContain("workspace_read");
    expect(registry.lookupToolContract("workspace_read")).toBeDefined();
  });
});
