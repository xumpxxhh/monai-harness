import type { ToolCallRecord } from "@monai/contracts";
import type { WorkspacePort } from "@monai/ports";
import {
  IsolatedSyntheticSink,
  SyntheticTimeoutError,
} from "@monai/synthetic-sink";

export type ToolInvokeSuccess = {
  ok: true;
  data: unknown;
  resultRef?: string;
  resultHash?: string;
};

export type ToolInvokeFailure = {
  ok: false;
  error: string;
  unknown?: boolean;
};

export type ToolInvokeResult = ToolInvokeSuccess | ToolInvokeFailure;

export type ToolInvokerDeps = {
  workspace?: WorkspacePort;
  synthetic?: IsolatedSyntheticSink;
  /** In-memory artifact store for artifact.write_markdown. */
  artifacts?: Map<string, { markdown: string; hash: string }>;
};

/**
 * In-process tool invoker (transaction-external).
 * Returns candidates only — Engine commits ToolCallRecord transitions.
 */
export class ToolInvoker {
  private readonly workspace?: WorkspacePort;
  private readonly synthetic: IsolatedSyntheticSink;
  private readonly artifacts: Map<string, { markdown: string; hash: string }>;

  constructor(deps: ToolInvokerDeps = {}) {
    this.workspace = deps.workspace;
    this.synthetic = deps.synthetic ?? new IsolatedSyntheticSink();
    this.artifacts = deps.artifacts ?? new Map();
  }

  getSynthetic(): IsolatedSyntheticSink {
    return this.synthetic;
  }

  async invoke(toolCall: ToolCallRecord): Promise<ToolInvokeResult> {
    const args = (toolCall.arguments ?? {}) as Record<string, unknown>;
    try {
      switch (toolCall.toolId) {
        case "echo":
          return {
            ok: true,
            data: { toolId: "echo", text: String(args.text ?? ""), summary: String(args.text ?? "") },
            resultHash: toolCall.inputHash,
          };
        case "workspace.list": {
          if (!this.workspace) return { ok: false, error: "workspace not configured" };
          const path = String(args.path ?? "/");
          const entries = await this.workspace.list(path);
          return { ok: true, data: { path, entries, summary: `list ${path}` } };
        }
        case "workspace.read": {
          if (!this.workspace) return { ok: false, error: "workspace not configured" };
          const path = String(args.path ?? "/");
          const content = await this.workspace.read(path);
          return { ok: true, data: { ...(content as object), summary: `read ${path}` } };
        }
        case "workspace.search": {
          if (!this.workspace) return { ok: false, error: "workspace not configured" };
          const query = String(args.query ?? "");
          const hits = await this.workspace.search(query);
          return { ok: true, data: { query, hits, summary: `search ${query}` } };
        }
        case "workspace.write": {
          if (!this.workspace) return { ok: false, error: "workspace not configured" };
          const path = String(args.path ?? "");
          await this.workspace.write(path, args.content ?? "");
          return { ok: true, data: { path, summary: `wrote ${path}` } };
        }
        case "artifact.write_markdown": {
          const markdown = String(args.markdown ?? args.content ?? "");
          const artifactId = `art-${toolCall.toolCallId}`;
          const hash = `sha256:${toolCall.inputHash}`;
          this.artifacts.set(artifactId, { markdown, hash });
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
        }
        case "synthetic.write_high": {
          const resourceKey = String(args.resourceKey ?? "");
          if (!resourceKey.startsWith("synthetic://")) {
            return { ok: false, error: "synthetic resourceKey must use synthetic:// prefix" };
          }
          if (!toolCall.idempotencyKey) {
            return { ok: false, error: "synthetic.write_high requires idempotencyKey" };
          }
          try {
            const result = await this.synthetic.write({
              resourceKey,
              payload: args.payload ?? {},
              idempotencyKey: toolCall.idempotencyKey,
            });
            return {
              ok: true,
              data: { ...result, summary: `synthetic ${resourceKey}#${result.effectCount}` },
              resultHash: result.payloadHash,
            };
          } catch (err) {
            if (err instanceof SyntheticTimeoutError) {
              return { ok: false, error: err.message, unknown: true };
            }
            throw err;
          }
        }
        default:
          return { ok: false, error: `unknown toolId: ${toolCall.toolId}` };
      }
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : "tool invoke failed",
      };
    }
  }

  async reconcile(toolCall: ToolCallRecord): Promise<ToolInvokeResult> {
    if (toolCall.toolId !== "synthetic.write_high") {
      return { ok: false, error: `reconcile not supported for ${toolCall.toolId}` };
    }
    const args = (toolCall.arguments ?? {}) as Record<string, unknown>;
    const resourceKey = String(args.resourceKey ?? "");
    if (!toolCall.idempotencyKey) {
      return { ok: false, error: "missing idempotencyKey for reconcile" };
    }
    const result = await this.synthetic.reconcile(resourceKey, toolCall.idempotencyKey);
    if (!result) {
      return { ok: false, error: "reconcile found no authoritative result" };
    }
    return {
      ok: true,
      data: { ...result, summary: `reconciled ${resourceKey}#${result.effectCount}` },
      resultHash: result.payloadHash,
    };
  }
}
