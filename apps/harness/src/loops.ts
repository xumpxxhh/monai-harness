import type { HarnessRuntime } from "./bootstrap.js";

/**
 * In-process delivery loops: outbox → queue → scheduler; compensation; tool dispatch.
 */
export class DeliveryLoops {
  private readonly runtime: HarnessRuntime;
  private readonly intervalMs: number;
  private timer: ReturnType<typeof setInterval> | undefined;
  private ticking = false;

  constructor(runtime: HarnessRuntime, intervalMs: number) {
    this.runtime = runtime;
    this.intervalMs = intervalMs;
  }

  /** One full tick of all delivery roles (usable in demo without keep-alive). */
  async tickOnce(): Promise<{
    compensation: number;
    outbox: number;
    scheduler: number;
    tools: number;
  }> {
    const compensation = await this.runtime.compensation.tick();
    const outbox = await this.runtime.dispatcher.tick();
    const scheduler = await this.runtime.scheduler.tick();
    const tools = await this.runtime.toolDispatcher.tick();
    return { compensation, outbox, scheduler, tools };
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
