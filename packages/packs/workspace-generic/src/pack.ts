import type { PackContributionDefinition } from "@monai/pack-sdk";

import {
  WORKSPACE_GENERIC_HOOKS,
  WORKSPACE_GENERIC_MANIFEST,
  workspaceGenericToolHandlers,
} from "./manifest.js";

export function createWorkspaceGenericPack(): PackContributionDefinition {
  const {
    "synthetic_write_high_reconcile": reconcileHandler,
    ...manifestTools
  } = workspaceGenericToolHandlers;

  return {
    manifest: WORKSPACE_GENERIC_MANIFEST,
    tools: {
      ...manifestTools,
      "synthetic_write_high_reconcile": reconcileHandler,
    },
    hooks: WORKSPACE_GENERIC_HOOKS,
  };
}
