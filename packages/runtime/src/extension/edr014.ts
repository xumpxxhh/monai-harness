/** MVP-disabled capabilities (EDR-014). Registry must reject these at registration. */
export const EDR014_DISABLED_TOOL_IDS = [
  "sandbox.exec",
  "sandbox.run",
  "memory.read",
  "memory.write",
  "memory.promote",
] as const;

export const EDR014_DISABLED_PERMISSIONS = [
  "sandbox.exec",
  "memory.read",
  "memory.write",
  "memory.promote",
  "real.write_high",
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
  if (toolId.startsWith("workspace.")) {
    return sideEffectProfile === "read" ? ["workspace.read"] : ["workspace.read", "workspace.write"];
  }
  if (toolId.startsWith("artifact.")) {
    return ["artifact.write"];
  }
  if (toolId.startsWith("synthetic.")) {
    return ["synthetic.write_high"];
  }
  if (sideEffectProfile === "read") return ["workspace.read"];
  if (sideEffectProfile === "write_low") return ["workspace.write"];
  if (sideEffectProfile === "write_high") return ["synthetic.write_high"];
  return [];
}
