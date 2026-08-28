import { describe, expect, it } from "vitest";

import type { HarnessRuntime } from "./bootstrap.js";
import { allHarnessRolesEnabled, type HarnessRoles } from "./config.js";
import { DeliveryLoops } from "./loops.js";
import type { TurnDriver } from "./turn-driver.js";

function stubRuntime(roles: HarnessRoles): { runtime: HarnessRuntime; calls: string[] } {
  const calls: string[] = [];
  const runtime = {
    config: { roles },
    compensation: {
      tick: async () => {
        calls.push("compensation");
        return 1;
      },
    },
    dispatcher: {
      tick: async () => {
        calls.push("dispatcher");
        return 1;
      },
    },
    scheduler: {
      tick: async () => {
        calls.push("scheduler");
        return 1;
      },
    },
    toolDispatcher: {
      tick: async () => {
        calls.push("tools");
        return 1;
      },
    },
  } as unknown as HarnessRuntime;
  return { runtime, calls };
}

function stubTurnDriver(calls: string[]): TurnDriver {
  return {
    tickAuto: async () => {
      calls.push("worker");
      return 1;
    },
  } as unknown as TurnDriver;
}

describe("DeliveryLoops role switches", () => {
  it("ticks every delivery role when all are enabled", async () => {
    const { runtime, calls } = stubRuntime(allHarnessRolesEnabled());
    const loops = new DeliveryLoops(runtime, 1_000, stubTurnDriver(calls));
    const counts = await loops.tickOnce();
    expect(calls).toEqual(["compensation", "dispatcher", "scheduler", "worker", "tools"]);
    expect(counts).toEqual({ compensation: 1, outbox: 1, scheduler: 1, tools: 1, turns: 1 });
  });

  it("api-only skips dispatcher, scheduler, and worker ticks", async () => {
    const { runtime, calls } = stubRuntime({
      api: true,
      dispatcher: false,
      scheduler: false,
      worker: false,
      observability: false,
      governance: false,
    });
    const loops = new DeliveryLoops(runtime, 1_000, stubTurnDriver(calls));
    const counts = await loops.tickOnce();
    expect(calls).toEqual([]);
    expect(counts).toEqual({ compensation: 0, outbox: 0, scheduler: 0, tools: 0, turns: 0 });
  });

  it("dispatcher-only does not run scheduler or worker", async () => {
    const { runtime, calls } = stubRuntime({
      api: false,
      dispatcher: true,
      scheduler: false,
      worker: false,
      observability: false,
      governance: false,
    });
    const loops = new DeliveryLoops(runtime, 1_000, stubTurnDriver(calls));
    await loops.tickOnce();
    expect(calls).toEqual(["dispatcher", "tools"]);
  });
});
