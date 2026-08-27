import {
  CONTRACTS_SCHEMA_VERSION,
  type Action,
} from "@monai/contracts";
import type { ModelPort } from "@monai/ports";

export type StubModelOptions = {
  /**
   * Fixed Action override. When unset, chooses from context.goal markers:
   * - `deny-me` → tool.call forbidden.tool
   * - `approve-me` → tool.call risky.write
   * - `finish` → finish
   * - `acceptance` + state.lastFactId → finish, else echo
   * - `workspace-search` → workspace.search
   * - `workspace-read` → workspace.read
   * - `artifact` → artifact.write_markdown
   * - default → tool.call echo (readonly)
   */
  fixedAction?: Action;
};

type TurnContext = {
  goal?: string;
  runId?: string;
  stepId?: string;
  state?: { lastFactId?: string };
};

/**
 * Deterministic ModelPort stub for P3 / Golden paths.
 * No network, no secrets, no State writes.
 */
export class StubModelPort implements ModelPort {
  private readonly fixedAction?: Action;
  private callCount = 0;

  constructor(options: StubModelOptions = {}) {
    this.fixedAction = options.fixedAction;
  }

  async completeStructured(input: {
    context: unknown;
    schema: unknown;
    modelPolicy?: unknown;
  }): Promise<Action> {
    this.callCount += 1;
    if (this.fixedAction) {
      return structuredClone(this.fixedAction);
    }

    const ctx = (input.context ?? {}) as TurnContext;
    const goal = ctx.goal ?? "";
    const actionId = `act-${ctx.runId ?? "run"}-${ctx.stepId ?? this.callCount}`;
    const hasFact = Boolean(ctx.state?.lastFactId);

    if (goal.includes("deny-me")) {
      return {
        schemaVersion: CONTRACTS_SCHEMA_VERSION,
        actionId,
        type: "tool.call",
        toolId: "forbidden.tool",
        arguments: { goal },
      };
    }

    if (goal.includes("approve-me")) {
      return {
        schemaVersion: CONTRACTS_SCHEMA_VERSION,
        actionId,
        type: "tool.call",
        toolId: "risky.write",
        arguments: { goal },
        idempotencyKey: `risky-${actionId}`,
      };
    }

    if (goal.includes("ask-user")) {
      return {
        schemaVersion: CONTRACTS_SCHEMA_VERSION,
        actionId,
        type: "ask_user",
        arguments: { prompt: "Please confirm" },
      };
    }

    if (goal.includes("acceptance") && hasFact) {
      return {
        schemaVersion: CONTRACTS_SCHEMA_VERSION,
        actionId,
        type: "finish",
      };
    }

    if (goal.includes("finish")) {
      return {
        schemaVersion: CONTRACTS_SCHEMA_VERSION,
        actionId,
        type: "finish",
      };
    }

    if (goal.includes("noop")) {
      return {
        schemaVersion: CONTRACTS_SCHEMA_VERSION,
        actionId,
        type: "noop",
      };
    }

    if (goal.includes("synthetic")) {
      return {
        schemaVersion: CONTRACTS_SCHEMA_VERSION,
        actionId,
        type: "tool.call",
        toolId: "synthetic.write_high",
        arguments: {
          resourceKey: "synthetic://demo/resource",
          payload: { goal },
        },
        idempotencyKey: `syn-${actionId}`,
      };
    }

    if (goal.includes("workspace-search")) {
      return {
        schemaVersion: CONTRACTS_SCHEMA_VERSION,
        actionId,
        type: "tool.call",
        toolId: "workspace.search",
        arguments: { query: "workspace" },
      };
    }

    if (goal.includes("workspace-read")) {
      return {
        schemaVersion: CONTRACTS_SCHEMA_VERSION,
        actionId,
        type: "tool.call",
        toolId: "workspace.read",
        arguments: { path: "/readme.md" },
      };
    }

    if (goal.includes("artifact")) {
      return {
        schemaVersion: CONTRACTS_SCHEMA_VERSION,
        actionId,
        type: "tool.call",
        toolId: "artifact.write_markdown",
        arguments: { markdown: `# ${goal}` },
        idempotencyKey: `art-${actionId}`,
      };
    }

    return {
      schemaVersion: CONTRACTS_SCHEMA_VERSION,
      actionId,
      type: "tool.call",
      toolId: "echo",
      arguments: { text: goal },
    };
  }
}

export const PACKAGE_NAME = "@monai/model-stub" as const;
