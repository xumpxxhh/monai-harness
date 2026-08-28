import {
  CONTRACTS_SCHEMA_VERSION,
  type GovernanceEventCandidate,
  type PackRegistrationResult,
} from "@monai/contracts";
import type { GovernanceEventStorePort } from "@monai/ports";
import { ExtensionRegistry, type RegisterPackInput } from "@monai/runtime";

export type PackRegistrationServiceOptions = {
  registry: ExtensionRegistry;
  governanceStore: GovernanceEventStorePort;
  /** Default `pack-registry` stream per tenant. */
  governanceStreamId?: string;
};

/**
 * Records Pack registration outcomes to GovernanceEvent (P9c).
 * Does not write Run Event or mutate Run state.
 */
export class PackRegistrationService {
  private readonly registry: ExtensionRegistry;
  private readonly governanceStore: GovernanceEventStorePort;
  private readonly governanceStreamId: string;

  constructor(options: PackRegistrationServiceOptions) {
    this.registry = options.registry;
    this.governanceStore = options.governanceStore;
    this.governanceStreamId = options.governanceStreamId ?? "pack-registry";
  }

  register(input: RegisterPackInput): PackRegistrationResult {
    const result = this.registry.register(input);
    void this.recordRegistration(input.tenantId, result);
    return result;
  }

  getRegistry(): ExtensionRegistry {
    return this.registry;
  }

  private async recordRegistration(tenantId: string, result: PackRegistrationResult): Promise<void> {
    const eventType = result.status === "active" ? "pack.registered" : "pack.registration_rejected";
    const candidate: GovernanceEventCandidate = {
      schemaVersion: CONTRACTS_SCHEMA_VERSION,
      eventId: `gov-${result.registrationId}`,
      eventType,
      tenantId,
      governanceStreamId: this.governanceStreamId,
      occurredAt: result.createdAt,
      correlationId: result.registrationId,
      producer: { type: "governance", id: "pack-registration" },
      payload: { registration: result },
      hash: result.hash,
    };
    await this.governanceStore.append(tenantId, this.governanceStreamId, candidate);
  }
}
