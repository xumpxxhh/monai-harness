import type { ExtensionRegistry } from "../extension/extension-registry.js";
import { TOOL_CATALOG } from "./tool-catalog.js";
import type { ToolEffectContract } from "@monai/contracts";

export function lookupToolContract(
  toolId: string,
  registry?: ExtensionRegistry,
): ToolEffectContract | undefined {
  return registry?.lookupToolContract(toolId) ?? TOOL_CATALOG[toolId];
}

export { TOOL_CATALOG, requiresIdempotencyKey } from "./tool-catalog.js";
