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

const DOMAIN_TOOL_DEFS: Record<string, Pick<ModelFunctionDef, "description" | "parameters">> = {
  echo: {
    description: "Echo text back as a fact. Use for simple passthrough.",
    parameters: {
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
      additionalProperties: true,
    },
  },
  "workspace.list": {
    description: "List workspace entries under a path (default \"/\").",
    parameters: {
      type: "object",
      properties: { path: { type: "string" } },
      additionalProperties: true,
    },
  },
  "workspace.read": {
    description: "Read a workspace file by path.",
    parameters: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
      additionalProperties: true,
    },
  },
  "workspace.search": {
    description: "Search workspace files for a query string.",
    parameters: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
      additionalProperties: true,
    },
  },
  "knowledge.search": {
    description:
      "Search enterprise knowledge bases for document snippets. Returns full content and sourceId for citations. When grounding.empty is true, do not invent facts.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Natural-language search query; be specific",
        },
        collection_ids: {
          type: "array",
          items: { type: "string" },
          description: "Optional knowledge base ids (kb-…). Pass when the domain is known.",
        },
        top_k: {
          type: "integer",
          minimum: 1,
          maximum: 20,
          description: "Optional max hits (default 8)",
        },
      },
      required: ["query"],
      additionalProperties: true,
    },
  },
  "workspace.write": {
    description: "Write a workspace file (low side-effect).",
    parameters: {
      type: "object",
      properties: { path: { type: "string" }, content: { type: "string" } },
      additionalProperties: true,
    },
  },
  "artifact.write_markdown": {
    description: "Write a markdown artifact.",
    parameters: {
      type: "object",
      properties: { markdown: { type: "string" } },
      required: ["markdown"],
      additionalProperties: true,
    },
  },
  "artifact.validate": {
    description: "Validate an artifact by artifactId or ref.",
    parameters: {
      type: "object",
      properties: { artifactId: { type: "string" }, ref: { type: "string" } },
      additionalProperties: true,
    },
  },
  "synthetic.write_high": {
    description: "High side-effect synthetic write (requires approval in MVP).",
    parameters: {
      type: "object",
      properties: {
        resourceKey: { type: "string" },
        payload: { type: "object" },
      },
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
  /** MVP default false (EDR-014 / spawn_child disabled). */
  includeSpawnChild?: boolean;
};

export type ModelFunctionCatalog = {
  controlFunctions: ModelFunctionDef[];
  domainTools: ModelFunctionDef[];
};

/**
 * Runtime-owned vendor-neutral catalog. Adapters translate these defs to provider tools.
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

  const reserved = new Set<string>(CONTROL_FUNCTION_NAMES);
  const domainTools: ModelFunctionDef[] = [];
  for (const toolId of input.toolAllowlist) {
    if (reserved.has(toolId)) continue;
    const known = DOMAIN_TOOL_DEFS[toolId];
    domainTools.push({
      name: toolId,
      kind: "domain",
      description: known?.description ?? `Domain tool ${toolId}.`,
      parameters: known?.parameters ?? { type: "object", additionalProperties: true },
    });
  }

  return { controlFunctions, domainTools };
}
