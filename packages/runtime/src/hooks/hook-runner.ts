import type { HookHandler, HookPoint, HookResult } from "@monai/pack-sdk";

export type HookInvocation = {
  hookPoint: HookPoint;
  handlerId: string;
  result: HookResult;
};

export type HookRunnerResult = {
  invocations: HookInvocation[];
  vetoed: boolean;
  vetoReason?: string;
  failed: boolean;
  failureReason?: string;
  merged: HookResult;
};

/**
 * In-process HookRunner. Handlers return candidates only.
 */
export class HookRunner {
  private readonly handlers = new Map<HookPoint, Array<{ id: string; handler: HookHandler }>>();

  register(hookPoint: HookPoint, id: string, handler: HookHandler): void {
    const list = this.handlers.get(hookPoint) ?? [];
    list.push({ id, handler });
    this.handlers.set(hookPoint, list);
  }

  async invoke(
    hookPoint: HookPoint,
    input: Omit<Parameters<HookHandler>[0], "hookPoint">,
  ): Promise<HookRunnerResult> {
    const list = this.handlers.get(hookPoint) ?? [];
    const invocations: HookInvocation[] = [];
    const merged: HookResult = {
      contextContributions: [],
      observations: [],
    };

    for (const { id, handler } of list) {
      const result = await handler({ ...input, hookPoint });
      invocations.push({ hookPoint, handlerId: id, result });

      if (result.failed) {
        return {
          invocations,
          vetoed: false,
          failed: true,
          failureReason: result.failureReason ?? `hook failed: ${id}`,
          merged,
        };
      }
      if (result.veto) {
        return {
          invocations,
          vetoed: true,
          vetoReason: result.vetoReason ?? `hook vetoed: ${id}`,
          failed: false,
          merged,
        };
      }
      if (result.contextContributions?.length) {
        merged.contextContributions!.push(...result.contextContributions);
      }
      if (result.observations?.length) {
        merged.observations!.push(...result.observations);
      }
    }

    return {
      invocations,
      vetoed: false,
      failed: false,
      merged,
    };
  }
}
