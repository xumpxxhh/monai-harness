import type { ExecutionManifest } from "@monai/contracts";
import type { ExecutionManifestStorePort } from "@monai/ports";

import { buildExecutionManifest, type BuildExecutionManifestInput } from "./build-manifest.js";

export type FreezeExecutionManifestInput = Omit<BuildExecutionManifestInput, "manifestId"> & {
  executionManifestRef: string;
};

export type FreezeExecutionManifestResult =
  | { ok: true; manifest: ExecutionManifest; hash: string }
  | { ok: false; code: "conflict" | "fatal"; message: string };

/** Resolve + persist immutable Execution Manifest at CreateRun (P9a2). */
export async function freezeExecutionManifest(
  store: ExecutionManifestStorePort,
  input: FreezeExecutionManifestInput,
): Promise<FreezeExecutionManifestResult> {
  const manifest = buildExecutionManifest({
    ...input,
    manifestId: input.executionManifestRef,
  });

  const existing = await store.get(input.executionManifestRef);
  if (existing) {
    if (existing.hash !== manifest.hash) {
      return {
        ok: false,
        code: "conflict",
        message: "execution manifest ref already bound to a different hash",
      };
    }
    return { ok: true, manifest, hash: manifest.hash };
  }

  try {
    await store.put(input.executionManifestRef, manifest, manifest.hash);
  } catch (err) {
    return {
      ok: false,
      code: "conflict",
      message: err instanceof Error ? err.message : "manifest put failed",
    };
  }

  return { ok: true, manifest, hash: manifest.hash };
}
