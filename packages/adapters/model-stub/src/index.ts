import type { Action } from "@monai/contracts";
import type { ModelCompleteInput, ModelDecision, ModelPort } from "@monai/ports";

export type StubModelOptions = {
  /**
   * Fixed Action override (Engine still hydrates Action-shaped results).
   * When unset, chooses from context.goal markers via ModelDecision:
   * - `deny-me` → forbidden.tool
   * - `approve-me` → risky.write
   * - `finish` → finish
   * - `acceptance` + state.lastFactId → content-only (Engine fact-gates to finish)
   * - `workspace-search` → workspace.search
   * - `workspace-read` → workspace.read
   * - `artifact` → artifact.write_markdown
   * - default → echo
   */
  fixedAction?: Action;
};

type TurnContext = {
  goal?: string;
  runId?: string;
  stepId?: string;
  state?: { lastFactId?: string };
};

function decision(partial: Omit<ModelDecision, "calls"> & { calls?: ModelDecision["calls"] }): ModelDecision {
  return { calls: [], ...partial };
}

/**
 * Deterministic ModelPort stub for P3 / Golden paths.
 * Returns ModelDecision; Engine maps to Action. fixedAction remains Action-shaped.
 */
export class StubModelPort implements ModelPort {
  private readonly fixedAction?: Action;
  private callCount = 0;

  constructor(options: StubModelOptions = {}) {
    this.fixedAction = options.fixedAction;
  }

  async completeStructured(input: ModelCompleteInput): Promise<unknown> {
    void input.systemPrompt;
    this.callCount += 1;
    if (this.fixedAction) {
      return structuredClone(this.fixedAction);
    }

    const ctx = (input.context ?? {}) as TurnContext;
    const goal = ctx.goal ?? "";
    const hasFact = Boolean(ctx.state?.lastFactId);

    if (goal.includes("deny-me")) {
      return decision({ calls: [{ name: "forbidden.tool", arguments: { goal } }] });
    }

    if (goal.includes("approve-me")) {
      return decision({
        calls: [{ name: "risky.write", arguments: { goal } }],
      });
    }

    if (goal.includes("ask-user")) {
      return decision({
        content: "Please confirm",
        calls: [{ name: "ask_user", arguments: { prompt: "Please confirm" } }],
      });
    }

    if (goal.includes("acceptance") && hasFact) {
      return decision({ content: "Task complete.", calls: [] });
    }

    if (goal.includes("finish")) {
      return decision({
        content: "Task complete.",
        calls: [{ name: "finish", arguments: { summary: "Task complete." } }],
      });
    }

    if (goal.includes("noop")) {
      return decision({ calls: [{ name: "noop", arguments: {} }] });
    }

    if (goal.includes("synthetic")) {
      return decision({
        calls: [
          {
            name: "synthetic.write_high",
            arguments: { resourceKey: "synthetic://demo/resource", payload: { goal } },
          },
        ],
      });
    }

    if (goal.includes("workspace-search")) {
      return decision({
        calls: [{ name: "workspace.search", arguments: { query: "workspace" } }],
      });
    }

    if (goal.includes("workspace-read")) {
      return decision({
        calls: [{ name: "workspace.read", arguments: { path: "/readme.md" } }],
      });
    }

    if (goal.includes("artifact")) {
      return decision({
        calls: [{ name: "artifact.write_markdown", arguments: { markdown: `# ${goal}` } }],
      });
    }

    return decision({
      calls: [{ name: "echo", arguments: { text: goal } }],
    });
  }
}

export const PACKAGE_NAME = "@monai/model-stub" as const;
