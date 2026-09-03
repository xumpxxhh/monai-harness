import { CONTRACTS_SCHEMA_VERSION, createEmptyRunState, createInitialRun } from "@monai/contracts";
import type { PackContributionDefinition } from "@monai/pack-sdk";
import { describe, expect, it } from "vitest";

import { ExtensionRegistry } from "../extension/extension-registry.js";
import { buildExecutionManifest } from "../manifest/build-manifest.js";
import { buildAgentSystemPrompt } from "../model/agent-system-prompt.js";
import { buildModelFunctionCatalog } from "../model/function-catalog.js";
import { buildContext } from "../context/build-context.js";

/**
 * Pack tool SSOT: a Pack-only tool appears in catalog / prompt / context
 * without any Core DOMAIN_TOOL_DEFS / TOOL_CATALOG / prompt branch.
 */
describe("Pack tool SSOT", () => {
  const packOnlyToolId = "demo.pack_only";

  function registerPackOnly(): ExtensionRegistry {
    const registry = new ExtensionRegistry();
    const contribution: PackContributionDefinition = {
      manifest: {
        schemaVersion: CONTRACTS_SCHEMA_VERSION,
        packId: "com.monai.pack.demo-ssot",
        version: "0.1.0",
        coreContractRange: ">=0.1.0 <1.0.0",
        permissionsRequested: ["workspace.read"],
        tools: [
          {
            toolId: packOnlyToolId,
            version: "0.1.0",
            description: "Pack-owned demo tool for SSOT regression",
            parameters: {
              type: "object",
              properties: { q: { type: "string" } },
              required: ["q"],
              additionalProperties: false,
            },
            argHint: 'args: {"q":"..."} required',
            systemPrompt: "Demo pack_only rules:\n1. Always pass q.",
            effectContract: {
              schemaVersion: CONTRACTS_SCHEMA_VERSION,
              sideEffectProfile: "read",
              deliverySemantics: "at_most_once",
              idempotencyScope: "run",
              reconcileSupported: false,
              timeoutMs: 5_000,
            },
          },
        ],
      },
      tools: {
        [packOnlyToolId]: async () => ({ ok: true, data: { summary: "ok" } }),
      },
      hooks: [],
    };
    const result = registry.register({ tenantId: "t1", contribution });
    expect(result.status).toBe("active");
    return registry;
  }

  it("surfaces Pack-only tool in catalog, prompt, and context without Core hardcodes", () => {
    const registry = registerPackOnly();
    const toolDefs = registry.listToolDefinitions();
    const allowlist = [packOnlyToolId];

    const catalog = buildModelFunctionCatalog({ toolAllowlist: allowlist, toolDefs });
    expect(catalog.domainTools).toEqual([
      {
        name: packOnlyToolId,
        kind: "domain",
        description: "Pack-owned demo tool for SSOT regression",
        parameters: {
          type: "object",
          properties: { q: { type: "string" } },
          required: ["q"],
          additionalProperties: false,
        },
      },
    ]);

    const prompt = buildAgentSystemPrompt({ toolAllowlist: allowlist, toolDefs });
    expect(prompt).toContain("Demo pack_only rules");
    expect(prompt).toContain("Always pass q");

    const frozen = buildExecutionManifest({
      manifestId: "man-ssot",
      tenantId: "t1",
      agentDefinitionId: "agent",
      agentVersion: "1",
      packVersions: [{ packId: "com.monai.pack.demo-ssot", version: "0.1.0" }],
      strategy: { type: "light", version: "1" },
      registry,
      toolAllowlist: allowlist,
    });
    expect(frozen.tools[0]?.argHint).toContain('{"q":"..."}');
    expect(frozen.tools[0]?.description).toContain("SSOT");

    const run = createInitialRun({
      runId: "r-ssot",
      tenantId: "t1",
      sessionId: "s1",
      agentDefinitionId: "agent",
      agentVersion: "1",
      executionManifestRef: "man-ssot",
      packVersions: [{ packId: "com.monai.pack.demo-ssot", version: "0.1.0" }],
      goal: "demo",
      strategy: { type: "light", version: "1" },
    });
    const ctx = buildContext({
      run,
      stepId: "step-1",
      state: createEmptyRunState(),
      toolAllowlist: allowlist,
      manifest: frozen,
    });
    const toolsSection = ctx.sections.find((s) => s.kind === "tools");
    expect(toolsSection?.text).toContain(packOnlyToolId);
    expect(toolsSection?.text).toContain('args: {"q":"..."}');
  });
});
