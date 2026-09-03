import type { PackToolDefinition } from "@monai/contracts";
import type { ModelFunctionDef } from "@monai/ports";

export const CONTROL_FUNCTION_NAMES = ["ask_user", "finish", "noop", "spawn_child"] as const;

export type ControlFunctionName = (typeof CONTROL_FUNCTION_NAMES)[number];

export function isControlFunctionName(name: string): name is ControlFunctionName {
  return (CONTROL_FUNCTION_NAMES as readonly string[]).includes(name);
}

const EMPTY_OBJECT_SCHEMA = {
  type: "object",
  properties: {},
  additionalProperties: false,
} as const;

/** Core-only domain stubs (non-Pack). Pack tools come from toolDefs. */
const CORE_DOMAIN_TOOL_DEFS: Record<string, Pick<ModelFunctionDef, "description" | "parameters">> = {
  echo: {
    description: "Echo text back as a fact. Use for simple passthrough.",
    parameters: {
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
      additionalProperties: true,
    },
  },
  "risky.write": {
    description: "Write that requires approval in MVP.",
    parameters: {
      type: "object",
      additionalProperties: true,
    },
  },
};

const CONTROL_DEFS: Record<Exclude<ControlFunctionName, "spawn_child">, ModelFunctionDef> = {
  ask_user: {
    name: "ask_user",
    kind: "control",
    description: "Ask the user a question and wait. Do not combine with domain tools.",
    parameters: {
      type: "object",
      properties: { prompt: { type: "string", description: "Question shown to the user" } },
      required: ["prompt"],
      additionalProperties: true,
    },
  },
  finish: {
    name: "finish",
    kind: "control",
    description: "End the run with a final summary. Do not combine with domain tools.",
    parameters: {
      type: "object",
      properties: { summary: { type: "string" } },
      additionalProperties: true,
    },
  },
  noop: {
    name: "noop",
    kind: "control",
    description: "Skip this step without finishing the run. Do not combine with domain tools.",
    parameters: EMPTY_OBJECT_SCHEMA,
  },
};

const SPAWN_CHILD_DEF: ModelFunctionDef = {
  name: "spawn_child",
  kind: "control",
  description: "Delegate a child run. Do not combine with domain tools.",
  parameters: {
    type: "object",
    properties: {
      goal: { type: "string" },
      inputRef: { type: "string" },
      delegationScope: {},
      strategy: {},
    },
    required: ["goal"],
    additionalProperties: true,
  },
};

export type BuildModelFunctionCatalogInput = {
  toolAllowlist: readonly string[];
  /** Pack / Manifest tool definitions (source of truth for Pack tools). */
  toolDefs?: readonly PackToolDefinition[];
  /** MVP default false (EDR-014 / spawn_child disabled). */
  includeSpawnChild?: boolean;
};

export type ModelFunctionCatalog = {
  controlFunctions: ModelFunctionDef[];
  domainTools: ModelFunctionDef[];
};

/**
 * Runtime-owned vendor-neutral catalog. Adapters translate these defs to provider tools.
 * Pack tool description/parameters come from toolDefs; Core only hardcodes echo / risky.write.
 */
export function buildModelFunctionCatalog(
  input: BuildModelFunctionCatalogInput,
): ModelFunctionCatalog {
  const controlFunctions: ModelFunctionDef[] = [
    CONTROL_DEFS.ask_user,
    CONTROL_DEFS.finish,
    CONTROL_DEFS.noop,
  ];
  if (input.includeSpawnChild) {
    controlFunctions.push(SPAWN_CHILD_DEF);
  }

  const defsById = new Map<string, PackToolDefinition>();
  for (const def of input.toolDefs ?? []) {
    defsById.set(def.toolId, def);
  }

  const reserved = new Set<string>(CONTROL_FUNCTION_NAMES);
  const domainTools: ModelFunctionDef[] = [];
  for (const toolId of input.toolAllowlist) {
    if (reserved.has(toolId)) continue;
    const packDef = defsById.get(toolId);
    const core = CORE_DOMAIN_TOOL_DEFS[toolId];
    domainTools.push({
      name: toolId,
      kind: "domain",
      description:
        (typeof packDef?.description === "string" && packDef.description) ||
        core?.description ||
        `Domain tool ${toolId}.`,
      parameters:
        packDef?.parameters ??
        core?.parameters ??
        { type: "object", additionalProperties: true },
    });
  }

  return { controlFunctions, domainTools };
}
