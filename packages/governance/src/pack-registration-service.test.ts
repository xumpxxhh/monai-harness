import { CONTRACTS_SCHEMA_VERSION } from "@monai/contracts";
import type { PackContributionDefinition } from "@monai/pack-sdk";
import { describe, expect, it } from "vitest";

import { ExtensionRegistry } from "@monai/runtime";

import { InMemoryGovernanceEventStore } from "./in-memory-governance-store.js";
import { PackRegistrationService } from "./pack-registration-service.js";

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
      permissionsRequested: ["workspace.read"],
      tools: [
        {
          toolId: "workspace.read",
          version: "0.1.0",
          effectContract: baseContract,
        },
      ],
      hooks: [],
    },
    tools: { "workspace.read": stubHandler() },
    hooks: [],
    ...overrides,
  };
}

describe("InMemoryGovernanceEventStore", () => {
  it("assigns strictly increasing sequence per stream", async () => {
    const store = new InMemoryGovernanceEventStore();
    const base = {
      schemaVersion: CONTRACTS_SCHEMA_VERSION,
      tenantId: "t1",
      governanceStreamId: "pack-registry",
      occurredAt: new Date().toISOString(),
      correlationId: "c1",
      producer: { type: "governance", id: "test" },
      hash: "h1",
    };
    const first = await store.append("t1", "pack-registry", {
      ...base,
      eventId: "e1",
      eventType: "pack.registered",
      hash: "h1",
    });
    const second = await store.append("t1", "pack-registry", {
      ...base,
      eventId: "e2",
      eventType: "pack.registration_rejected",
      correlationId: "c2",
      hash: "h2",
    });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.event.sequence).toBe(first.event.sequence + 1);
    expect((await store.list("t1", "pack-registry")).length).toBe(2);
  });
});

describe("PackRegistrationService", () => {
  it("appends pack.registered for active registration", async () => {
    const store = new InMemoryGovernanceEventStore();
    const registry = new ExtensionRegistry();
    const service = new PackRegistrationService({ registry, governanceStore: store });
    const result = service.register({ tenantId: "t1", contribution: validContribution() });
    expect(result.status).toBe("active");
    await expect.poll(async () => (await store.list("t1", "pack-registry")).length).toBe(1);
    const events = await store.list("t1", "pack-registry");
    expect(events.some((e) => e.eventType === "pack.registered")).toBe(true);
  });

  it("appends pack.registration_rejected without silently downgrading", async () => {
    const store = new InMemoryGovernanceEventStore();
    const registry = new ExtensionRegistry();
    const service = new PackRegistrationService({ registry, governanceStore: store });
    const result = service.register({
      tenantId: "t1",
      contribution: validContribution({
        manifest: {
          ...validContribution().manifest,
          tools: [
            {
              toolId: "sandbox.exec",
              version: "0.1.0",
              effectContract: { ...baseContract, sideEffectProfile: "write_high" },
            },
          ],
        },
        tools: { "sandbox.exec": stubHandler() },
      }),
    });
    expect(result.status).toBe("rejected");
    expect(registry.getToolAllowlist()).not.toContain("sandbox.exec");
    await expect.poll(async () => (await store.list("t1", "pack-registry")).length).toBe(1);
    const events = await store.list("t1", "pack-registry");
    expect(events.some((e) => e.eventType === "pack.registration_rejected")).toBe(true);
  });
});
