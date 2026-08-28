import type { ExecutionManifestStorePort } from "@monai/ports";

type StoredManifest = { content: unknown; hash: string };

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** In-memory immutable Execution Manifest store (P9a2). */
export class InMemoryManifestStore implements ExecutionManifestStorePort {
  private readonly entries = new Map<string, StoredManifest>();

  async put(manifestId: string, content: unknown, hash: string): Promise<void> {
    const existing = this.entries.get(manifestId);
    if (existing && existing.hash !== hash) {
      throw new Error(`manifest ref ${manifestId} already bound to a different hash`);
    }
    if (!existing) {
      this.entries.set(manifestId, { content: clone(content), hash });
    }
  }

  async get(manifestId: string): Promise<{ content: unknown; hash: string } | undefined> {
    const row = this.entries.get(manifestId);
    if (!row) return undefined;
    return { content: clone(row.content), hash: row.hash };
  }
}
