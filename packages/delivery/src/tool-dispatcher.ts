import { CONTRACTS_SCHEMA_VERSION } from "@monai/contracts";
import type { OutboxPort, PersistencePort } from "@monai/ports";
import type { Engine, ToolInvoker } from "@monai/runtime";

/**
 * Claims dispatch_tool outbox rows, invokes tools outside any UoW,
 * and submits tool_dispatch_result commands to Engine.
 */
export class ToolDispatcher {
  private readonly outbox: OutboxPort;
  private readonly persistence: PersistencePort;
  private readonly engine: Engine;
  private readonly invoker: ToolInvoker;
  private readonly ownerId: string;

  constructor(deps: {
    outbox: OutboxPort;
    persistence: PersistencePort;
    engine: Engine;
    invoker: ToolInvoker;
    ownerId?: string;
  }) {
    this.outbox = deps.outbox;
    this.persistence = deps.persistence;
    this.engine = deps.engine;
    this.invoker = deps.invoker;
    this.ownerId = deps.ownerId ?? "tool-dispatcher";
  }

  async tick(limit = 10): Promise<number> {
    const claimed = await this.outbox.claim(limit, this.ownerId, 30_000);
    let handled = 0;
    for (const record of claimed) {
      if (record.message.messageType !== "dispatch_tool") {
        await this.outbox.markFailed(record.outboxRecordId, "not_dispatch_tool");
        continue;
      }
      const payload = record.message.payload as {
        runId: string;
        toolCallId: string;
        revision: number;
        leaseEpoch: number;
        tenantId: string;
      };

      const accepted = await this.engine.handle({
        schemaVersion: CONTRACTS_SCHEMA_VERSION,
        commandId: `td-accept-${record.outboxRecordId}`,
        commandType: "tool_dispatch_result",
        tenantId: payload.tenantId,
        runId: payload.runId,
        expectedRevision: payload.revision,
        leaseEpoch: payload.leaseEpoch,
        issuedAt: new Date().toISOString(),
        payload: {
          toolCallId: payload.toolCallId,
          phase: "accepted",
        },
      });
      if (!accepted.ok) {
        await this.outbox.markFailed(record.outboxRecordId, accepted.message ?? accepted.code);
        continue;
      }

      const toolCall = await this.persistence.getToolCall(payload.toolCallId);
      if (!toolCall) {
        await this.outbox.markFailed(record.outboxRecordId, "toolCall missing");
        continue;
      }

      const outcome = await this.invoker.invoke(toolCall);
      const terminal = await this.engine.handle({
        schemaVersion: CONTRACTS_SCHEMA_VERSION,
        commandId: `td-term-${record.outboxRecordId}`,
        commandType: "tool_dispatch_result",
        tenantId: payload.tenantId,
        runId: payload.runId,
        expectedRevision: accepted.revision,
        leaseEpoch: payload.leaseEpoch,
        issuedAt: new Date().toISOString(),
        payload: outcome.ok
          ? {
              toolCallId: payload.toolCallId,
              phase: "succeeded",
              data: outcome.data,
              resultRef: outcome.resultRef,
              resultHash: outcome.resultHash,
            }
          : outcome.unknown
            ? {
                toolCallId: payload.toolCallId,
                phase: "outcome_unknown",
                error: outcome.error,
              }
            : {
                toolCallId: payload.toolCallId,
                phase: "failed",
                error: outcome.error,
              },
      });

      if (!terminal.ok) {
        await this.outbox.markFailed(record.outboxRecordId, terminal.message ?? terminal.code);
        continue;
      }
      await this.outbox.markPublished(record.outboxRecordId);
      handled += 1;
    }
    return handled;
  }

  /** Reconcile a single outcome_unknown tool call (IO outside UoW). */
  async reconcile(input: {
    tenantId: string;
    runId: string;
    toolCallId: string;
    expectedRevision: number;
    leaseEpoch?: number;
  }): Promise<{ ok: boolean; message?: string }> {
    const toolCall = await this.persistence.getToolCall(input.toolCallId);
    if (!toolCall) {
      return { ok: false, message: "toolCall not found" };
    }
    const outcome = await this.invoker.reconcile(toolCall);
    const result = await this.engine.handle({
      schemaVersion: CONTRACTS_SCHEMA_VERSION,
      commandId: `reconcile-${input.toolCallId}-${Date.now()}`,
      commandType: "reconcile_tool",
      tenantId: input.tenantId,
      runId: input.runId,
      expectedRevision: input.expectedRevision,
      leaseEpoch: input.leaseEpoch,
      issuedAt: new Date().toISOString(),
      payload: {
        toolCallId: input.toolCallId,
        ok: outcome.ok,
        data: outcome.ok ? outcome.data : undefined,
        resultRef: outcome.ok ? outcome.resultRef : undefined,
        resultHash: outcome.ok ? outcome.resultHash : undefined,
        error: outcome.ok ? undefined : outcome.error,
      },
    });
    return result.ok ? { ok: true } : { ok: false, message: result.message ?? result.code };
  }
}
