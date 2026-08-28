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
  "Context overflow rate (requires ContextBuildRecord projection)",
  "Knowledge miss rate (requires knowledgeSelections projection)",
  "memory error suggestion rate (requires MemoryContributionRecord)",
  "Token / cost (requires model usage records + price table)",
] as const;

export type MvpMetricGap = (typeof MVP_METRIC_GAPS)[number];

/** Time metrics closed in P9c (Event-replay derivable). */
export const MVP_TIMING_METRICS_IMPLEMENTED = [
  "queue latency",
  "active execution time",
  "awaiting time",
  "total wall time",
] as const;
