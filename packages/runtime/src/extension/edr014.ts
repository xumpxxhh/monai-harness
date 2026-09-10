/** MVP-disabled capabilities (EDR-014). Registry must reject these at registration. */
export const EDR014_DISABLED_TOOL_IDS = [
  "sandbox_exec",
  "sandbox_run",
  "workspace_exec",
  "memory_read",
  "memory_write",
  "memory_promote",
] as const;

export const EDR014_DISABLED_PERMISSIONS = [
  "sandbox_exec",
  "workspace_exec",
  "memory_read",
  "memory_write",
  "memory_promote",
  "real_write_high",
] as const;

export function isEdr014DisabledTool(toolId: string): boolean {
  return (EDR014_DISABLED_TOOL_IDS as readonly string[]).includes(toolId);
}

export function isEdr014DisabledPermission(permission: string): boolean {
  return (EDR014_DISABLED_PERMISSIONS as readonly string[]).includes(permission);
}

/** Map sideEffectProfile to minimum permission tokens declared on Pack manifest. */
export function requiredPermissionsForTool(
  toolId: string,
  sideEffectProfile: "none" | "read" | "write_low" | "write_high",
): string[] {
  if (toolId === "sandbox_exec" || toolId.startsWith("sandbox_")) {
    return ["sandbox_exec"];
  }
  if (toolId === "workspace_exec") {
    return ["workspace_exec"];
  }
  if (toolId.startsWith("workspace_")) {
    return sideEffectProfile === "read" ? ["workspace_read"] : ["workspace_read", "workspace_write"];
  }
  if (toolId.startsWith("artifact_")) {
    return ["artifact_write"];
  }
  if (toolId.startsWith("synthetic_")) {
    return ["synthetic_write_high"];
  }
  if (toolId === "knowledge_search") {
    return ["knowledge_read"];
  }
  if (sideEffectProfile === "read") return ["workspace_read"];
  if (sideEffectProfile === "write_low") return ["workspace_write"];
  if (sideEffectProfile === "write_high") return ["synthetic_write_high"];
  return [];
}
