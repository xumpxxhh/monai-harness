import { createHash } from "node:crypto";
import { CONTRACTS_SCHEMA_VERSION, type PackManifest } from "@monai/contracts";
import type { ObjectStorePort, WorkspacePort } from "@monai/ports";
import {
  packDefaultAllowlist,
  packRequireApprovalTools,
  type ExecutionContext,
  type PackHookRegistration,
  type ToolHandler,
  type ToolHandlerInput,
} from "@monai/pack-sdk";
import {
  IsolatedSyntheticSink,
  SyntheticTimeoutError,
} from "@monai/synthetic-sink";

const MAX_OUTPUT_CHARS = 512_000;

/** Tool id for RAG HTTP retrieve-only search (EDR-016). Not in default allowlist. */
export const KNOWLEDGE_SEARCH_TOOL_ID = "knowledge.search" as const;

export type KnowledgeSearchClientPort = {
  search(input: {
    query: string;
    collectionIds?: readonly string[];
    topK?: number;
  }): Promise<{
    query: string;
    effectiveQuery?: string;
    traceId: string;
    hits: Array<{
      rank: number;
      collectionId: string;
      sourceId: string;
      title: string;
      content: string;
      score: number;
      scoreKind?: string;
    }>;
    grounding: {
      empty: boolean;
      chunksEmptyReason?: string;
    };
  }>;
};

function workspacePort(ctx: ExecutionContext): WorkspacePort | undefined {
  return ctx.ports?.workspace as WorkspacePort | undefined;
}

function knowledgeSearchPort(ctx: ExecutionContext): KnowledgeSearchClientPort | undefined {
  return ctx.ports?.knowledge as KnowledgeSearchClientPort | undefined;
}

function objectStore(ctx: ExecutionContext): ObjectStorePort {
  const store = ctx.ports?.objectStore as ObjectStorePort | undefined;
  if (!store || typeof store.put !== "function" || typeof store.get !== "function") {
    throw new Error("objectStore not configured");
  }
  return store;
}

function artifactObjectKey(artifactId: string): string {
  const id = artifactId.replace(/\\/g, "/");
  if (!id || id.includes("..") || id.includes("/") || id.includes("\0")) {
    throw new Error(`invalid artifactId: ${artifactId}`);
  }
  return `artifacts/${id}.md`;
}

function contentSha256(body: Uint8Array): string {
  return `sha256:${createHash("sha256").update(body).digest("hex")}`;
}

function syntheticSink(ctx: ExecutionContext): IsolatedSyntheticSink {
  const sink = ctx.ports?.telemetry as IsolatedSyntheticSink | undefined;
  if (!sink) {
    throw new Error("synthetic sink not configured");
  }
  return sink;
}

function rejectPathEscape(path: string): void {
  const normalized = path.replace(/\\/g, "/");
  if (normalized.includes("..") || normalized.includes("\0")) {
    throw new Error("path escape rejected");
  }
}

function rejectSecretMaterial(value: unknown): void {
  const text =
    typeof value === "string" ? value : JSON.stringify(value ?? null);
  if (/secret:\/\/|sk-live-[A-Za-z0-9]{8,}|AKIA[0-9A-Z]{16}/.test(text)) {
    throw new Error("secret material rejected");
  }
}

function capOutput(value: string): string {
  if (value.length > MAX_OUTPUT_CHARS) {
    throw new Error("output size limit exceeded");
  }
  return value;
}

export const workspaceGenericToolHandlers: Record<string, ToolHandler> = {
  "workspace.list": async (input) => {
    const ws = workspacePort(input.executionContext);
    if (!ws) return { ok: false, error: "workspace not configured" };
    const args = input.arguments as Record<string, unknown>;
    const path = String(args.path ?? "/");
    rejectPathEscape(path);
    const entries = await ws.list(path);
    return { ok: true, data: { path, entries, summary: `list ${path}` } };
  },
  "workspace.read": async (input) => {
    const ws = workspacePort(input.executionContext);
    if (!ws) return { ok: false, error: "workspace not configured" };
    const args = input.arguments as Record<string, unknown>;
    const path = String(args.path ?? "/");
    rejectPathEscape(path);
    const content = await ws.read(path);
    return {
      ok: true,
      data: { ...(content as object), summary: `read ${path}` },
    };
  },
  "workspace.search": async (input) => {
    const ws = workspacePort(input.executionContext);
    if (!ws) return { ok: false, error: "workspace not configured" };
    const args = input.arguments as Record<string, unknown>;
    const query = capOutput(String(args.query ?? ""));
    const hits = await ws.search(query);
    return { ok: true, data: { query, hits, summary: `search ${query}` } };
  },
  "workspace.write": async (input) => {
    const ws = workspacePort(input.executionContext);
    if (!ws) return { ok: false, error: "workspace not configured" };
    const args = input.arguments as Record<string, unknown>;
    const path = String(args.path ?? "").trim();
    if (!path) {
      return { ok: false, error: "path is required" };
    }
    const virtual = path.replace(/\\/g, "/");
    if (virtual === "/") {
      return { ok: false, error: "workspace.write requires a file path, not /" };
    }
    rejectPathEscape(path);
    if (args.content === undefined || args.content === null) {
      return { ok: false, error: "content is required" };
    }
    const content = capOutput(
      typeof args.content === "string" ? args.content : JSON.stringify(args.content),
    );
    await ws.write(path, content);
    return {
      ok: true,
      data: {
        path,
        chars: content.length,
        summary: `wrote ${path}`,
      },
    };
  },
  "workspace.delete": async (input) => {
    const ws = workspacePort(input.executionContext);
    if (!ws) return { ok: false, error: "workspace not configured" };
    const args = input.arguments as Record<string, unknown>;
    const path = String(args.path ?? "").trim();
    if (!path) {
      return { ok: false, error: "path is required" };
    }
    const virtual = path.replace(/\\/g, "/");
    if (virtual === "/") {
      return { ok: false, error: "workspace.delete requires a file path, not /" };
    }
    rejectPathEscape(path);
    try {
      await ws.delete(path);
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
    return {
      ok: true,
      data: {
        path,
        summary: `deleted ${path}`,
      },
    };
  },
  [KNOWLEDGE_SEARCH_TOOL_ID]: async (input) => {
    const client = knowledgeSearchPort(input.executionContext);
    if (!client) {
      return { ok: false, error: "knowledge search not configured" };
    }
    const args = input.arguments as Record<string, unknown>;
    const query = capOutput(String(args.query ?? "")).trim();
    if (!query) {
      return { ok: false, error: "query is required" };
    }
    const collectionIdsRaw = args.collection_ids ?? args.collectionIds;
    const collectionIds = Array.isArray(collectionIdsRaw)
      ? collectionIdsRaw.map((id) => String(id)).filter(Boolean)
      : undefined;
    const topKRaw = args.top_k ?? args.topK;
    const topK =
      topKRaw !== undefined && topKRaw !== null ? Number(topKRaw) : undefined;

    try {
      const result = await client.search({
        query,
        collectionIds,
        topK: Number.isFinite(topK) ? topK : undefined,
      });
      const hitCount = result.hits.length;
      const summary = result.grounding.empty
        ? `knowledge search "${query}" (no hits)`
        : `knowledge search "${query}" (${hitCount} hits)`;
      return {
        ok: true,
        data: {
          ...result,
          summary,
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "knowledge search failed";
      return { ok: false, error: message };
    }
  },
  "artifact.write_markdown": async (input) => {
    const args = input.arguments as Record<string, unknown>;
    const markdown = capOutput(String(args.markdown ?? args.content ?? ""));
    const artifactId = `art-${input.toolCallId}`;
    const body = new TextEncoder().encode(markdown);
    const hash = contentSha256(body);
    const key = artifactObjectKey(artifactId);
    try {
      await objectStore(input.executionContext).put(key, body, hash);
    } catch (err) {
      const message = err instanceof Error ? err.message : "artifact write failed";
      return { ok: false, error: message };
    }
    return {
      ok: true,
      data: {
        artifactId,
        ref: `artifact://${artifactId}`,
        hash,
        summary: `artifact ${artifactId}`,
      },
      resultRef: `artifact://${artifactId}`,
      resultHash: hash,
    };
  },
  "artifact.validate": async (input) => {
    const args = input.arguments as Record<string, unknown>;
    const artifactId = String(args.artifactId ?? args.ref ?? "").replace(
      /^artifact:\/\//,
      "",
    );
    if (!artifactId) {
      return { ok: false, error: "artifactId required" };
    }
    let key: string;
    try {
      key = artifactObjectKey(artifactId);
    } catch (err) {
      const message = err instanceof Error ? err.message : "invalid artifactId";
      return { ok: false, error: message };
    }
    const body = await objectStore(input.executionContext).get(key);
    if (!body) {
      return { ok: false, error: `artifact not found: ${artifactId}` };
    }
    const markdown = new TextDecoder().decode(body);
    const hash = contentSha256(body);
    const minLength = Number(args.minLength ?? 1);
    if (markdown.length < minLength) {
      return { ok: false, error: "artifact validation failed: too short" };
    }
    return {
      ok: true,
      data: {
        artifactId,
        valid: true,
        hash,
        summary: `validated ${artifactId}`,
      },
      resultHash: hash,
    };
  },
  "synthetic.write_high": async (input) => {
    const args = input.arguments as Record<string, unknown>;
    const resourceKey = String(args.resourceKey ?? "");
    if (!resourceKey.startsWith("synthetic://")) {
      return {
        ok: false,
        error: "synthetic resourceKey must use synthetic:// prefix",
      };
    }
    if (!input.idempotencyKey) {
      return {
        ok: false,
        error: "synthetic.write_high requires idempotencyKey",
      };
    }
    rejectSecretMaterial(args.payload ?? {});
    try {
      const result = await syntheticSink(input.executionContext).write({
        resourceKey,
        payload: args.payload ?? {},
        idempotencyKey: input.idempotencyKey,
      });
      return {
        ok: true,
        data: {
          ...result,
          summary: `synthetic ${resourceKey}#${result.effectCount}`,
        },
        resultHash: result.payloadHash,
      };
    } catch (err) {
      if (err instanceof SyntheticTimeoutError) {
        return { ok: false, error: err.message, unknown: true };
      }
      throw err;
    }
  },
  "synthetic.write_high.reconcile": async (input: ToolHandlerInput) => {
    const args = input.arguments as Record<string, unknown>;
    const resourceKey = String(args.resourceKey ?? "");
    if (!input.idempotencyKey) {
      return { ok: false, error: "missing idempotencyKey for reconcile" };
    }
    const result = await syntheticSink(input.executionContext).reconcile(
      resourceKey,
      input.idempotencyKey,
    );
    if (!result) {
      return { ok: false, error: "reconcile found no authoritative result" };
    }
    return {
      ok: true,
      data: {
        ...result,
        summary: `reconciled ${resourceKey}#${result.effectCount}`,
      },
      resultHash: result.payloadHash,
    };
  },
};

const baseContract = {
  schemaVersion: CONTRACTS_SCHEMA_VERSION,
  deliverySemantics: "at_most_once" as const,
  idempotencyScope: "run" as const,
  timeoutMs: 5_000,
};

const knowledgeContract = {
  schemaVersion: CONTRACTS_SCHEMA_VERSION,
  deliverySemantics: "at_most_once" as const,
  idempotencyScope: "run" as const,
  timeoutMs: 60_000,
};

export const WORKSPACE_GENERIC_MANIFEST = {
  schemaVersion: CONTRACTS_SCHEMA_VERSION,
  packId: "com.monai.pack.workspace-generic",
  version: "0.1.0",
  coreContractRange: ">=0.1.0 <1.0.0",
  permissionsRequested: [
    "workspace.read",
    "workspace.write",
    "artifact.write",
    "synthetic.write_high",
    "knowledge.read",
  ],
  tools: [
    {
      toolId: "workspace.list",
      version: "0.1.0",
      description: 'List workspace entries under a path (default "/").',
      parameters: {
        type: "object",
        properties: { path: { type: "string" } },
        additionalProperties: true,
      },
      argHint: "List entries under a workspace path",
      effectContract: {
        ...baseContract,
        sideEffectProfile: "read" as const,
        reconcileSupported: false,
      },
    },
    {
      toolId: "workspace.read",
      version: "0.1.0",
      description: "Read a workspace file by path.",
      parameters: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
        additionalProperties: true,
      },
      argHint: "Read a workspace file",
      effectContract: {
        ...baseContract,
        sideEffectProfile: "read" as const,
        reconcileSupported: false,
      },
    },
    {
      toolId: "workspace.search",
      version: "0.1.0",
      description: "Search workspace files for a query string.",
      parameters: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
        additionalProperties: true,
      },
      argHint: "Search workspace file contents",
      effectContract: {
        ...baseContract,
        sideEffectProfile: "read" as const,
        reconcileSupported: false,
      },
    },
    {
      toolId: "workspace.write",
      version: "0.1.0",
      description:
        "Write or overwrite a UTF-8 file in the authorized workspace. Path must be absolute under / (e.g. /notes/out.md).",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Absolute workspace path starting with /" },
          content: { type: "string", description: "File contents" },
        },
        required: ["path", "content"],
        additionalProperties: true,
      },
      argHint: "Create or overwrite a workspace file",
      systemPrompt: [
        "Workspace write (workspace.write):",
        "Prefer workspace.write when persisting text the user asked to save.",
        "Overwriting an existing file is intentional; do not invent paths outside the authorized workspace.",
      ].join("\n"),
      effectContract: {
        ...baseContract,
        sideEffectProfile: "write_low" as const,
        reconcileSupported: false,
      },
    },
    {
      toolId: "workspace.delete",
      version: "0.1.0",
      requireApproval: true,
      description:
        "Delete a UTF-8 file in the authorized workspace. Path must be absolute under / (e.g. /notes/out.md). Requires approval.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Absolute workspace file path starting with /" },
        },
        required: ["path"],
        additionalProperties: true,
      },
      argHint: "Delete a workspace file (requires approval)",
      systemPrompt: [
        "Workspace delete (workspace.delete):",
        "Use workspace.delete only when the user clearly wants a file removed.",
        "Prefer confirming intent when the target path is ambiguous.",
      ].join("\n"),
      effectContract: {
        ...baseContract,
        sideEffectProfile: "write_low" as const,
        reconcileSupported: false,
      },
    },
    {
      toolId: KNOWLEDGE_SEARCH_TOOL_ID,
      version: "0.1.0",
      defaultEnabled: false,
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
      argHint: "Search enterprise knowledge bases",
      systemPrompt: [
        "Knowledge base (knowledge.search):",
        "Before answering factual questions that need external docs, call knowledge.search with a specific query.",
        "Answer only from hits[].content; do not invent information not present in hits.",
        "Cite sourceId or title in your answer, e.g. [intro.md].",
        "If grounding.empty is true, say no relevant knowledge was found; do not guess.",
      ].join("\n"),
      effectContract: {
        ...knowledgeContract,
        sideEffectProfile: "read" as const,
        reconcileSupported: false,
      },
    },
    {
      toolId: "artifact.write_markdown",
      version: "0.1.0",
      description: "Write a markdown artifact.",
      parameters: {
        type: "object",
        properties: { markdown: { type: "string" } },
        required: ["markdown"],
        additionalProperties: true,
      },
      argHint: "Write a markdown artifact",
      effectContract: {
        ...baseContract,
        sideEffectProfile: "write_low" as const,
        reconcileSupported: false,
      },
    },
    {
      toolId: "artifact.validate",
      version: "0.1.0",
      description: "Validate an artifact by artifactId or ref.",
      parameters: {
        type: "object",
        properties: { artifactId: { type: "string" }, ref: { type: "string" } },
        additionalProperties: true,
      },
      argHint: "Validate an artifact by id or ref",
      effectContract: {
        ...baseContract,
        sideEffectProfile: "read" as const,
        reconcileSupported: false,
      },
    },
    {
      toolId: "synthetic.write_high",
      version: "0.1.0",
      requireApproval: true,
      description: "High side-effect synthetic write (requires approval in MVP).",
      parameters: {
        type: "object",
        properties: {
          resourceKey: { type: "string" },
          payload: { type: "object" },
        },
        additionalProperties: true,
      },
      argHint: "High side-effect synthetic write (requires approval)",
      effectContract: {
        ...baseContract,
        sideEffectProfile: "write_high" as const,
        idempotencyScope: "resource" as const,
        reconcileSupported: true,
      },
    },
  ],
  hooks: [
    {
      hookPoint: "PreReasoning" as const,
      handlerId: "wg.pre-reasoning",
      version: "0.1.0",
    },
    {
      hookPoint: "PostReasoning" as const,
      handlerId: "wg.post-reasoning",
      version: "0.1.0",
    },
    {
      hookPoint: "PreToolCall" as const,
      handlerId: "wg.pre-tool",
      version: "0.1.0",
    },
    {
      hookPoint: "PostToolCall" as const,
      handlerId: "wg.post-tool",
      version: "0.1.0",
    },
    {
      hookPoint: "OnRunEnd" as const,
      handlerId: "wg.on-run-end",
      version: "0.1.0",
    },
  ],
  digest: "sha256:workspace-generic-0.1.0",
} as const satisfies PackManifest;

/** Default allowlist: echo (Core stub) + Pack tools with defaultEnabled !== false. */
export const WORKSPACE_GENERIC_TOOL_ALLOWLIST = [
  "echo",
  ...packDefaultAllowlist(WORKSPACE_GENERIC_MANIFEST.tools),
] as const;

/** Appended at wiring time when RAG client is configured (EDR-016). */
export const KNOWLEDGE_SEARCH_ALLOWLIST_ENTRY = KNOWLEDGE_SEARCH_TOOL_ID;

export const WORKSPACE_GENERIC_REQUIRE_APPROVAL = packRequireApprovalTools(
  WORKSPACE_GENERIC_MANIFEST.tools,
) as readonly string[];

const noopObservation = { data: { pack: "workspace-generic", observed: true } };

export const WORKSPACE_GENERIC_HOOKS: PackHookRegistration[] = [
  {
    hookPoint: "PreReasoning",
    handlerId: "wg.pre-reasoning",
    handler: async () => ({ observations: [noopObservation] }),
  },
  {
    hookPoint: "PostReasoning",
    handlerId: "wg.post-reasoning",
    handler: async () => ({ observations: [noopObservation] }),
  },
  {
    hookPoint: "PreToolCall",
    handlerId: "wg.pre-tool",
    handler: async () => ({}),
  },
  {
    hookPoint: "PostToolCall",
    handlerId: "wg.post-tool",
    handler: async () => ({ observations: [noopObservation] }),
  },
  {
    hookPoint: "OnRunEnd",
    handlerId: "wg.on-run-end",
    handler: async () => ({ observations: [noopObservation] }),
  },
];
