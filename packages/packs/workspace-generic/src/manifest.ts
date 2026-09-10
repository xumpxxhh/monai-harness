import { createHash } from "node:crypto";
import { CONTRACTS_SCHEMA_VERSION, type PackManifest } from "@monai/contracts";
import type {
  ObjectStorePort,
  SandboxPort,
  WorkspacePort,
  WorkspaceShellPort,
} from "@monai/ports";
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
export const KNOWLEDGE_SEARCH_TOOL_ID = "knowledge_search" as const;

/** Tool id for opt-in sandbox_exec (0025 / EDR-014). Not in default allowlist. */
export const SANDBOX_EXEC_TOOL_ID = "sandbox_exec" as const;

/** Tool id for opt-in workspace_exec (bash in workspace root / EDR-014). Not in default allowlist. */
export const WORKSPACE_EXEC_TOOL_ID = "workspace_exec" as const;

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

function sandboxPort(ctx: ExecutionContext): SandboxPort | undefined {
  const port = ctx.ports?.sandbox as SandboxPort | undefined;
  if (!port || typeof port.exec !== "function") return undefined;
  return port;
}

function workspaceShellPort(ctx: ExecutionContext): WorkspaceShellPort | undefined {
  const port = ctx.ports?.workspaceShell as WorkspaceShellPort | undefined;
  if (!port || typeof port.exec !== "function") return undefined;
  return port;
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
  "workspace_list": async (input) => {
    const ws = workspacePort(input.executionContext);
    if (!ws) return { ok: false, error: "workspace not configured" };
    const args = input.arguments as Record<string, unknown>;
    const path = String(args.path ?? "/");
    rejectPathEscape(path);
    const entries = await ws.list(path);
    return { ok: true, data: { path, entries, summary: `list ${path}` } };
  },
  "workspace_read": async (input) => {
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
  "workspace_search": async (input) => {
    const ws = workspacePort(input.executionContext);
    if (!ws) return { ok: false, error: "workspace not configured" };
    const args = input.arguments as Record<string, unknown>;
    const query = capOutput(String(args.query ?? ""));
    const hits = await ws.search(query);
    return { ok: true, data: { query, hits, summary: `search ${query}` } };
  },
  "workspace_write": async (input) => {
    const ws = workspacePort(input.executionContext);
    if (!ws) return { ok: false, error: "workspace not configured" };
    const args = input.arguments as Record<string, unknown>;
    const path = String(args.path ?? "").trim();
    if (!path) {
      return { ok: false, error: "path is required" };
    }
    const virtual = path.replace(/\\/g, "/");
    if (virtual === "/") {
      return { ok: false, error: "workspace_write requires a file path, not /" };
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
  "workspace_edit": async (input) => {
    const ws = workspacePort(input.executionContext);
    if (!ws) return { ok: false, error: "workspace not configured" };
    const args = input.arguments as Record<string, unknown>;
    const path = String(args.path ?? "").trim();
    if (!path) {
      return { ok: false, error: "path is required" };
    }
    const virtual = path.replace(/\\/g, "/");
    if (virtual === "/") {
      return { ok: false, error: "workspace_edit requires a file path, not /" };
    }
    rejectPathEscape(path);

    if (args.old_string === undefined && args.oldString === undefined) {
      return { ok: false, error: "old_string is required" };
    }
    if (args.new_string === undefined && args.newString === undefined) {
      return { ok: false, error: "new_string is required" };
    }
    const oldString = String(args.old_string ?? args.oldString ?? "");
    const newString = String(args.new_string ?? args.newString ?? "");
    if (!oldString) {
      return { ok: false, error: "old_string must be non-empty" };
    }
    if (oldString === newString) {
      return { ok: false, error: "old_string and new_string are identical" };
    }
    const replaceAllRaw = args.replace_all ?? args.replaceAll;
    const replaceAll =
      replaceAllRaw === true ||
      replaceAllRaw === 1 ||
      (typeof replaceAllRaw === "string" &&
        ["1", "true", "yes", "on"].includes(replaceAllRaw.trim().toLowerCase()));

    let raw: unknown;
    try {
      raw = await ws.read(path);
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
    const before =
      typeof raw === "string"
        ? raw
        : raw && typeof raw === "object" && "content" in raw
          ? String((raw as { content: unknown }).content ?? "")
          : null;
    if (before === null) {
      return { ok: false, error: "workspace read returned unexpected shape" };
    }

    let occurrences = 0;
    let searchFrom = 0;
    while (true) {
      const idx = before.indexOf(oldString, searchFrom);
      if (idx < 0) break;
      occurrences += 1;
      searchFrom = idx + oldString.length;
    }
    if (occurrences === 0) {
      return {
        ok: false,
        error: "old_string not found in file (edit requires an exact match)",
      };
    }
    if (!replaceAll && occurrences > 1) {
      return {
        ok: false,
        error: `old_string matched ${occurrences} times; provide more context or set replace_all=true`,
      };
    }

    const after = replaceAll
      ? before.split(oldString).join(newString)
      : before.replace(oldString, newString);
    const content = capOutput(after);
    await ws.write(path, content);
    return {
      ok: true,
      data: {
        path,
        replacements: replaceAll ? occurrences : 1,
        charsBefore: before.length,
        charsAfter: content.length,
        summary: `edited ${path} (${replaceAll ? occurrences : 1} replacement${(replaceAll ? occurrences : 1) === 1 ? "" : "s"})`,
      },
    };
  },
  "workspace_delete": async (input) => {
    const ws = workspacePort(input.executionContext);
    if (!ws) return { ok: false, error: "workspace not configured" };
    const args = input.arguments as Record<string, unknown>;
    const path = String(args.path ?? "").trim();
    if (!path) {
      return { ok: false, error: "path is required" };
    }
    const virtual = path.replace(/\\/g, "/");
    if (virtual === "/" || virtual === "") {
      return { ok: false, error: "workspace_delete must not target /" };
    }
    rejectPathEscape(path);
    try {
      const result = await ws.delete(path);
      const kind = result?.kind === "directory" ? "directory" : "file";
      return {
        ok: true,
        data: {
          path,
          kind,
          summary:
            kind === "directory"
              ? `deleted directory ${path} (recursive)`
              : `deleted ${path}`,
        },
      };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
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
  [SANDBOX_EXEC_TOOL_ID]: async (input) => {
    const sandbox = sandboxPort(input.executionContext);
    if (!sandbox) {
      return { ok: false, error: "sandbox not configured" };
    }
    const args = input.arguments as Record<string, unknown>;
    const argvRaw = args.argv ?? args.command;
    if (!Array.isArray(argvRaw) || argvRaw.length === 0) {
      return { ok: false, error: "argv must be a non-empty array of strings" };
    }
    const argv = argvRaw.map((part) => String(part));
    const cwd = args.cwd !== undefined ? String(args.cwd) : undefined;
    const timeoutRaw = args.timeout_ms ?? args.timeoutMs;
    const timeoutMs =
      timeoutRaw !== undefined && timeoutRaw !== null ? Number(timeoutRaw) : undefined;
    try {
      const result = await sandbox.exec({
        argv,
        cwd,
        timeoutMs: Number.isFinite(timeoutMs) && timeoutMs! > 0 ? timeoutMs : undefined,
      });
      const summary = result.timedOut
        ? `sandbox_exec timed out: ${argv[0]}`
        : result.truncated
          ? `sandbox_exec truncated: ${argv[0]} exit=${result.exitCode}`
          : `sandbox_exec ${argv[0]} exit=${result.exitCode}`;
      if (result.timedOut || result.truncated) {
        return {
          ok: false,
          error: result.timedOut
            ? "sandbox exec timed out"
            : "sandbox exec output truncated",
          data: { ...result, summary },
        };
      }
      if (result.exitCode !== 0) {
        return {
          ok: false,
          error: `sandbox exec exit ${result.exitCode}`,
          data: { ...result, summary },
        };
      }
      return {
        ok: true,
        data: { ...result, summary },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "sandbox exec failed";
      return { ok: false, error: message };
    }
  },
  [WORKSPACE_EXEC_TOOL_ID]: async (input) => {
    const shell = workspaceShellPort(input.executionContext);
    if (!shell) {
      return { ok: false, error: "workspace shell not configured (enable FEATURE_ENABLE_WORKSPACE_EXEC)" };
    }
    const args = input.arguments as Record<string, unknown>;
    const command = String(args.command ?? args.cmd ?? "").trim();
    if (!command) {
      return { ok: false, error: "command must be a non-empty string" };
    }
    const cwd = args.cwd !== undefined ? String(args.cwd) : undefined;
    if (cwd !== undefined) {
      rejectPathEscape(cwd);
    }
    const timeoutRaw = args.timeout_ms ?? args.timeoutMs;
    const timeoutMs =
      timeoutRaw !== undefined && timeoutRaw !== null ? Number(timeoutRaw) : undefined;
    try {
      const result = await shell.exec({
        command,
        cwd,
        timeoutMs: Number.isFinite(timeoutMs) && timeoutMs! > 0 ? timeoutMs : undefined,
      });
      const preview = command.length > 80 ? `${command.slice(0, 77)}...` : command;
      const summary = result.timedOut
        ? `workspace_exec timed out: ${preview}`
        : result.truncated
          ? `workspace_exec truncated: exit=${result.exitCode}`
          : `workspace_exec exit=${result.exitCode}`;
      if (result.timedOut || result.truncated) {
        return {
          ok: false,
          error: result.timedOut
            ? "workspace exec timed out"
            : "workspace exec output truncated",
          data: { ...result, summary },
        };
      }
      if (result.exitCode !== 0) {
        return {
          ok: false,
          error: `workspace exec exit ${result.exitCode}`,
          data: { ...result, summary },
        };
      }
      return {
        ok: true,
        data: {
          exitCode: result.exitCode,
          stdout: capOutput(result.stdout),
          stderr: capOutput(result.stderr),
          timedOut: result.timedOut,
          truncated: result.truncated,
          cwd: result.cwd,
          summary,
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "workspace exec failed";
      return { ok: false, error: message };
    }
  },
  "artifact_write_markdown": async (input) => {
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
  "artifact_validate": async (input) => {
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
  "synthetic_write_high": async (input) => {
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
        error: "synthetic_write_high requires idempotencyKey",
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
  "synthetic_write_high_reconcile": async (input: ToolHandlerInput) => {
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

const sandboxContract = {
  schemaVersion: CONTRACTS_SCHEMA_VERSION,
  deliverySemantics: "at_most_once" as const,
  idempotencyScope: "run" as const,
  timeoutMs: 30_000,
};

export const WORKSPACE_GENERIC_MANIFEST = {
  schemaVersion: CONTRACTS_SCHEMA_VERSION,
  packId: "com.monai.pack.workspace-generic",
  version: "0.1.0",
  coreContractRange: ">=0.1.0 <1.0.0",
  permissionsRequested: [
    "workspace_read",
    "workspace_write",
    "workspace_exec",
    "artifact_write",
    "synthetic_write_high",
    "knowledge_read",
    "sandbox_exec",
  ],
  tools: [
    {
      toolId: "workspace_list",
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
      toolId: "workspace_read",
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
      toolId: "workspace_search",
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
      toolId: "workspace_write",
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
        "Workspace write (workspace_write):",
        "Prefer workspace_write when creating a new file or intentionally replacing the entire contents.",
        "For surgical in-place changes to an existing file, prefer workspace_edit.",
        "Overwriting an existing file is intentional; do not invent paths outside the authorized workspace.",
      ].join("\n"),
      effectContract: {
        ...baseContract,
        sideEffectProfile: "write_low" as const,
        reconcileSupported: false,
      },
    },
    {
      toolId: "workspace_edit",
      version: "0.1.0",
      description:
        "Edit an existing UTF-8 workspace file by exact string replacement. Path must be absolute under / (e.g. /notes/out.md). Fails if old_string is missing or matches multiple times unless replace_all is true.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Absolute workspace file path starting with /" },
          old_string: {
            type: "string",
            description: "Exact text to find (include enough surrounding context for uniqueness)",
          },
          new_string: {
            type: "string",
            description: "Replacement text (may be empty to delete the matched span)",
          },
          replace_all: {
            type: "boolean",
            description: "When true, replace every occurrence; default false (requires a unique match)",
          },
        },
        required: ["path", "old_string", "new_string"],
        additionalProperties: true,
      },
      argHint: "Surgically edit an existing workspace file",
      systemPrompt: [
        "Workspace edit (workspace_edit):",
        "Use workspace_edit for precise in-place edits of an existing file.",
        "old_string must match the file exactly (including whitespace); enlarge context until the match is unique, or set replace_all=true.",
        "Prefer workspace_write only when creating a new file or replacing the whole file is intentional.",
      ].join("\n"),
      effectContract: {
        ...baseContract,
        sideEffectProfile: "write_low" as const,
        reconcileSupported: false,
      },
    },
    {
      toolId: "workspace_delete",
      version: "0.1.0",
      requireApproval: true,
      description:
        "Delete a file or directory in the authorized workspace. Path must be absolute under / (e.g. /notes/out.md or /notes/tmp). Directories are removed recursively. Must not target /. Requires approval.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Absolute workspace file or directory path starting with /",
          },
        },
        required: ["path"],
        additionalProperties: true,
      },
      argHint: "Delete a workspace file or directory (requires approval)",
      systemPrompt: [
        "Workspace delete (workspace_delete):",
        "Use workspace_delete when the user clearly wants a file or directory removed.",
        "Directories are deleted recursively (all contents). Never target /.",
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
        "Knowledge base (knowledge_search):",
        "Before answering factual questions that need external docs, call knowledge_search with a specific query.",
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
      toolId: SANDBOX_EXEC_TOOL_ID,
      version: "0.1.0",
      defaultEnabled: false,
      requireApproval: true,
      description:
        "Run an allowlisted binary as argv (no shell) inside the sandbox root. Requires approval. Opt-in only.",
      parameters: {
        type: "object",
        properties: {
          argv: {
            type: "array",
            items: { type: "string" },
            description: "Command argv; argv[0] must be an allowlisted bare binary name",
            minItems: 1,
          },
          cwd: {
            type: "string",
            description: "Optional relative cwd under the sandbox root",
          },
          timeout_ms: {
            type: "integer",
            minimum: 1,
            description: "Optional wall-clock timeout in ms",
          },
        },
        required: ["argv"],
        additionalProperties: true,
      },
      argHint: "Run an allowlisted sandbox command (requires approval)",
      systemPrompt: [
        "Sandbox exec (sandbox_exec):",
        "Only use when the user explicitly needs a controlled command run.",
        "Pass argv as a string array; never invent shell metacharacters or unlisted binaries.",
        "Requires approval; prefer workspace tools for normal file work.",
      ].join("\n"),
      effectContract: {
        ...sandboxContract,
        sideEffectProfile: "write_high" as const,
        reconcileSupported: false,
      },
    },
    {
      toolId: WORKSPACE_EXEC_TOOL_ID,
      version: "0.1.0",
      defaultEnabled: false,
      requireApproval: true,
      description:
        "Run a bash command string with cwd fixed to the authorized workspace root (or a relative subdir). Requires approval. Opt-in only. Prefer workspace.* tools for normal file work.",
      parameters: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description: "Bash command passed to `bash -lc` (e.g. `ls -la` or `wc -c notes/*.md`)",
          },
          cwd: {
            type: "string",
            description: "Optional relative cwd under the workspace root (default .)",
          },
          timeout_ms: {
            type: "integer",
            minimum: 1,
            description: "Optional wall-clock timeout in ms (default 30000)",
          },
        },
        required: ["command"],
        additionalProperties: true,
      },
      argHint: "Run a bash command in the workspace (requires approval)",
      systemPrompt: [
        "Workspace exec (workspace_exec):",
        "Use when the user needs a shell command whose cwd must be the agent workspace (unlike sandbox_exec).",
        "Pass a single command string; it runs via bash -lc under the workspace root.",
        "Requires approval. Prefer workspace_list/read/write/search for ordinary file tasks.",
        "Do not use for host-wide administration; stay within the workspace tree.",
      ].join("\n"),
      effectContract: {
        ...sandboxContract,
        sideEffectProfile: "write_high" as const,
        reconcileSupported: false,
      },
    },
    {
      toolId: "artifact_write_markdown",
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
      toolId: "artifact_validate",
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
      toolId: "synthetic_write_high",
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

/** Appended at wiring time when sandbox_exec opt-in is enabled (0025). */
export const SANDBOX_EXEC_ALLOWLIST_ENTRY = SANDBOX_EXEC_TOOL_ID;

/** Appended at wiring time when workspace_exec opt-in is enabled (EDR-014). */
export const WORKSPACE_EXEC_ALLOWLIST_ENTRY = WORKSPACE_EXEC_TOOL_ID;

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
