import { CONTRACTS_SCHEMA_VERSION } from "@monai/contracts";
import { buildCreateRunCommand } from "@monai/api";
import type { HarnessCommand } from "@monai/ports";

import type { HarnessRuntime } from "./bootstrap.js";
import { DeliveryLoops } from "./loops.js";

/**
 * P8b exit path: CreateRun → outbox/queue/scheduler → running → execute_turn.
 */
export async function runCreateRunToExecuteTurnDemo(
  runtime: HarnessRuntime,
  loops: DeliveryLoops,
): Promise<void> {
  const runId = `p8b-${Date.now()}`;
  const driver = runtime.config.persistenceDriver;
  console.log(`[harness][demo] driver=${driver} runId=${runId}`);

  const created = await runtime.engine.handle(
    buildCreateRunCommand({
      tenantId: "t1",
      commandId: `create-${runId}`,
      runId,
      sessionId: "s1",
      agentDefinitionId: "agent",
      agentVersion: "1",
      executionManifestRef: "manifest://p8b",
      packVersions: [{ packId: "core", version: "0.1.0" }],
      goal: "hello world",
      strategy: { type: "light", version: "1" },
    }),
  );
  if (!created.ok) {
    throw new Error(`create_run failed: ${created.message ?? created.code}`);
  }
  console.log(`[harness][demo] created revision=${created.revision} status=${created.run.status}`);

  // Drive delivery until running (outbox → queue → queue_run → acquire_lease).
  let running = await runtime.persistence.getRun(runId);
  for (let i = 0; i < 8 && running?.status !== "running"; i += 1) {
    const ticks = await loops.tickOnce();
    console.log(
      `[harness][demo] tick ${i + 1}: compensation=${ticks.compensation} outbox=${ticks.outbox} scheduler=${ticks.scheduler}`,
    );
    running = await runtime.persistence.getRun(runId);
  }

  if (!running || running.status !== "running") {
    throw new Error(
      `expected running, got status=${running?.status ?? "missing"} revision=${running?.revision}`,
    );
  }
  console.log(
    `[harness][demo] running revision=${running.revision} leaseEpoch=${running.leaseEpoch}`,
  );

  const turnCmd: HarnessCommand = {
    schemaVersion: CONTRACTS_SCHEMA_VERSION,
    commandId: `turn-${runId}`,
    commandType: "execute_turn",
    tenantId: running.tenantId,
    runId,
    expectedRevision: running.revision,
    leaseEpoch: running.leaseEpoch,
    issuedAt: new Date().toISOString(),
    actor: { principalId: runtime.ownerId },
  };
  const turn = await runtime.engine.handle(turnCmd);
  if (!turn.ok) {
    throw new Error(`execute_turn failed: ${turn.message ?? turn.code}`);
  }

  const events = await runtime.persistence.listEvents(runId);
  const types = events.map((e) => e.eventType);
  console.log(
    `[harness][demo] execute_turn ok revision=${turn.revision} status=${turn.run.status}`,
  );
  console.log(`[harness][demo] events: ${types.join(" → ")}`);

  const toolCalls = await runtime.persistence.listToolCalls(runId);
  if (toolCalls.length > 0) {
    console.log(
      `[harness][demo] prepared toolCalls=${toolCalls.length} first=${toolCalls[0]?.toolId}/${toolCalls[0]?.status}`,
    );
  }
}
