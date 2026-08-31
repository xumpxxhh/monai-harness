import { CONTRACTS_SCHEMA_VERSION, type Run } from "@monai/contracts";
import type { HandleResult } from "@monai/runtime";

import type { HarnessRuntime } from "../bootstrap/container.js";

export type TurnDriverOptions = {
  /** When true, tickAuto runs execute_turn for running runs not yet turned this leaseEpoch. */
  autoExecute: boolean;
};

/**
 * App-layer turn orchestration (serve / web). Does not modify delivery Scheduler.
 */
export class TurnDriver {
  private readonly runtime: HarnessRuntime;
  private readonly autoExecute: boolean;
  /** runId → leaseEpoch already executed this acquisition. */
  private readonly turned = new Map<string, number>();

  constructor(runtime: HarnessRuntime, options: TurnDriverOptions) {
    this.runtime = runtime;
    this.autoExecute = options.autoExecute;
  }

  async executeTurn(runId: string): Promise<HandleResult> {
    const run = await this.runtime.persistence.getRun(runId);
    if (!run) {
      return { ok: false, code: "fatal", message: "run not found" };
    }
    if (run.status !== "running") {
      return {
        ok: false,
        code: "validation",
        message: `execute_turn requires status=running, got ${run.status}`,
      };
    }

    const result = await this.runtime.engine.handle({
      schemaVersion: CONTRACTS_SCHEMA_VERSION,
      commandId: `turn-${runId}-${run.revision}-${Date.now()}`,
      commandType: "execute_turn",
      tenantId: run.tenantId,
      runId,
      expectedRevision: run.revision,
      leaseEpoch: run.leaseEpoch,
      actor: { principalId: this.runtime.ownerId },
      issuedAt: new Date().toISOString(),
    });

    if (result.ok) {
      this.turned.set(runId, run.leaseEpoch);
    }
    return result;
  }

  /** After scheduler acquires lease: turn each running run once per leaseEpoch. */
  async tickAuto(): Promise<number> {
    if (!this.autoExecute) return 0;

    const runs = await this.runtime.persistence.listRuns({
      tenantId: "t1",
      status: "running",
      limit: 100,
    });

    let executed = 0;
    for (const run of runs) {
      if (this.turned.get(run.runId) === run.leaseEpoch) continue;
      const result = await this.executeTurn(run.runId);
      if (result.ok) executed += 1;
    }
    return executed;
  }

  forget(runId: string): void {
    this.turned.delete(runId);
  }

  markTurned(run: Pick<Run, "runId" | "leaseEpoch">): void {
    this.turned.set(run.runId, run.leaseEpoch);
  }
}
