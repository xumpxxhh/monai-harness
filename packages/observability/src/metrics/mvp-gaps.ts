/**
 * MVP metrics not yet derivable from Event-only replay in this phase.
 * See design 07 §4.2 for full catalog.
 */
export const MVP_METRIC_GAPS = [
  "non-terminal age (requires live Run snapshot at window end)",
  "tool redundancy rate (requires RedundancyDecision records)",
  "intervention rate (requires governance / operator audit projection)",
  "recovery success rate (requires injected fault metadata)",
  "outcome_unknown unresolved age (requires reconcile deadline contract)",
  "Knowledge miss rate (requires knowledgeSelections projection)",
  "memory error suggestion rate (requires MemoryContributionRecord)",
] as const;

export type MvpMetricGap = (typeof MVP_METRIC_GAPS)[number];

/** Time metrics closed in P9c (Event-replay derivable). */
export const MVP_TIMING_METRICS_IMPLEMENTED = [
  "queue latency",
  "active execution time",
  "awaiting time",
  "total wall time",
] as const;

/** Model and Context metrics closed in M1 (Event-replay derivable with usage & static price table). */
export const MVP_MODEL_METRICS_IMPLEMENTED = [
  "Token / cost (input/output/total tokens + price table USD accounting + unknown breakdown)",
  "Context overflow rate (hardMaxTokens step.failed / build attempts)",
  "Context truncation rate (truncations recorded in context.built)",
] as const;
