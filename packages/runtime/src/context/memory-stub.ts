import type { MemoryItem, MemoryPort, MemoryRetrieveInput } from "@monai/ports";

/**
 * MVP MemoryPort — retrieval disabled (design 05 §7.2).
 */
export class DisabledMemoryPort implements MemoryPort {
  async retrieve(_input: MemoryRetrieveInput): Promise<MemoryItem[]> {
    return [];
  }
}
