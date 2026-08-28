import {
  PRICE_TABLE_STATIC_VERSION,
  STATIC_PRICE_TABLE,
  type EventEnvelope,
  type ModelUsage,
  type PriceTableEntry,
} from "@monai/contracts";

export interface ModelCallMetricsSnapshot {
  modelCallsCount: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  totalCostUsd: number;
  unknownCostCalls: number;
  failedCallsCount: number;
}

export interface ContextMetricsSnapshot {
  contextBuildAttempts: number;
  contextOverflows: number;
  contextTruncations: number;
  contextOverflowRate: number | null;
  contextTruncationRate: number | null;
}

export interface RunModelAndContextMetrics {
  runId: string;
  model: ModelCallMetricsSnapshot;
  context: ContextMetricsSnapshot;
}

/**
 * Compute Token usage, Cost, and Context overflow metrics from committed Events (design 07 §4.2).
 */
export function computeModelAndContextMetrics(
  events: EventEnvelope[],
  runId: string,
  priceTable: Record<string, PriceTableEntry> = STATIC_PRICE_TABLE,
): RunModelAndContextMetrics {
  let modelCallsCount = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let totalTokens = 0;
  let totalCostUsd = 0;
  let unknownCostCalls = 0;
  let failedCallsCount = 0;

  let contextBuildAttempts = 0;
  let contextOverflows = 0;
  let contextTruncations = 0;

  for (const event of events) {
    if (event.eventType === "model.called") {
      modelCallsCount += 1;
    } else if (event.eventType === "model.responded") {
      const payload = event.payload as
        | {
            target?: string;
            usage?: ModelUsage;
            failed?: boolean;
          }
        | undefined;

      if (payload?.failed) {
        failedCallsCount += 1;
      }

      const usage = payload?.usage;
      if (usage) {
        const inTok = usage.inputTokens ?? 0;
        const outTok = usage.outputTokens ?? 0;
        const totTok = usage.totalTokens ?? (inTok + outTok);

        inputTokens += inTok;
        outputTokens += outTok;
        totalTokens += totTok;

        const target = payload?.target ?? "stub";
        const price = priceTable[target];
        if (price && price.currency === "USD") {
          const inCost = (inTok / 1_000_000) * price.inputPerMillion;
          const outCost = (outTok / 1_000_000) * price.outputPerMillion;
          totalCostUsd += inCost + outCost;
        } else {
          unknownCostCalls += 1;
        }
      }
    } else if (event.eventType === "context.built") {
      contextBuildAttempts += 1;
      const payload = event.payload as
        | {
            truncations?: unknown[];
          }
        | undefined;
      if (payload?.truncations && payload.truncations.length > 0) {
        contextTruncations += 1;
      }
    } else if (event.eventType === "step.failed") {
      const payload = event.payload as { reason?: string } | undefined;
      const reason = payload?.reason ?? "";
      if (reason.toLowerCase().includes("overflow") || reason.includes("hardMaxTokens")) {
        contextBuildAttempts += 1;
        contextOverflows += 1;
      }
    }
  }

  const contextOverflowRate =
    contextBuildAttempts > 0 ? contextOverflows / contextBuildAttempts : null;
  const contextTruncationRate =
    contextBuildAttempts > 0 ? contextTruncations / contextBuildAttempts : null;

  return {
    runId,
    model: {
      modelCallsCount,
      inputTokens,
      outputTokens,
      totalTokens,
      totalCostUsd: Number(totalCostUsd.toFixed(6)),
      unknownCostCalls,
      failedCallsCount,
    },
    context: {
      contextBuildAttempts,
      contextOverflows,
      contextTruncations,
      contextOverflowRate,
      contextTruncationRate,
    },
  };
}
