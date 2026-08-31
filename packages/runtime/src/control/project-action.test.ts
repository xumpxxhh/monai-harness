import { describe, expect, it } from "vitest";
import { CONTRACTS_SCHEMA_VERSION, type Action } from "@monai/contracts";

import { projectActionForUser } from "./project-action.js";

function action(partial: Partial<Action> & Pick<Action, "type" | "actionId">): Action {
  return {
    schemaVersion: CONTRACTS_SCHEMA_VERSION,
    ...partial,
  } as Action;
}

describe("projectActionForUser", () => {
  it("prefers displayText", () => {
    expect(
      projectActionForUser(
        action({ actionId: "a1", type: "tool.call", toolId: "echo", displayText: "正在读取文件" }),
      ),
    ).toBe("正在读取文件");
  });

  it("projects tool.call without displayText", () => {
    expect(
      projectActionForUser(action({ actionId: "a1", type: "tool.call", toolId: "workspace.read" })),
    ).toBe("准备调用 workspace.read");
  });

  it("projects ask_user from arguments.prompt", () => {
    expect(
      projectActionForUser(
        action({ actionId: "a1", type: "ask_user", arguments: { prompt: "确认继续？" } }),
      ),
    ).toBe("确认继续？");
  });

  it("projects finish / noop / spawn_child", () => {
    expect(projectActionForUser(action({ actionId: "a1", type: "finish" }))).toBe("任务已完成");
    expect(projectActionForUser(action({ actionId: "a1", type: "noop" }))).toBe("本步无需操作");
    expect(
      projectActionForUser(
        action({
          actionId: "a1",
          type: "spawn_child",
          childSpec: { goal: "子目标", delegationScope: {} },
        }),
      ),
    ).toBe("委派：子目标");
  });
});
