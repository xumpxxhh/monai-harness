export { createWorkspaceGenericPack } from "./pack.js";
export {
  WORKSPACE_GENERIC_HOOKS,
  WORKSPACE_GENERIC_MANIFEST,
  WORKSPACE_GENERIC_REQUIRE_APPROVAL,
  WORKSPACE_GENERIC_TOOL_ALLOWLIST,
  workspaceGenericToolHandlers,
} from "./manifest.js";

export const PACKAGE_NAME = "@monai/pack-workspace-generic" as const;
