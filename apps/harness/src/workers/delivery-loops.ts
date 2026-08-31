import type { HarnessRuntime } from "../bootstrap/container.js";
import type { TurnDriver } from "./turn-driver.js";

/**
 * In-process delivery loops: outbox → queue → scheduler; compensation; tool dispatch; app turn driver.
 */
export class DeliveryLoops {
  private readonly runtime: HarnessRuntime;
  private readonly intervalMs: number;
  private readonly turnDriver: TurnDriver | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;
  private ticking = false;

  constructor(runtime: HarnessRuntime, intervalMs: number, turnDriver?: TurnDriver) {
    this.runtime = runtime;
    this.intervalMs = intervalMs;
    this.turnDriver = turnDriver;
  }

  /** One full tick of enabled delivery roles (usable in demo without keep-alive). */
  async tickOnce(): Promise<{
    compensation: number;
    outbox: number;
    scheduler: number;
    tools: number;
    turns: number;
  }> {
    const roles = this.runtime.config.roles;
    const compensation = roles.scheduler ? await this.runtime.compensation.tick() : 0;
    const outbox = roles.dispatcher ? await this.runtime.dispatcher.tick() : 0;
    const scheduler = roles.scheduler ? await this.runtime.scheduler.tick() : 0;
    const turns = roles.worker && this.turnDriver ? await this.turnDriver.tickAuto() : 0;
    const tools = roles.dispatcher ? await this.runtime.toolDispatcher.tick() : 0;
    return { compensation, outbox, scheduler, tools, turns };
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.safeTick();
    }, this.intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = undefined;
  }

  private async safeTick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      await this.tickOnce();
    } catch (err) {
      console.error("[harness][loops] tick failed", err);
    } finally {
      this.ticking = false;
    }
  }
}
