/**
 * MVP metrics not yet derivable from Event-only replay in this phase.
 * See design 07 §4.2 for full catalog.
 */
export const MVP_METRIC_GAPS = [
  "non-terminal age (requires live Run snapshot at window end)",
  "queue latency (requires paired run.queued → run.lease_acquired segments)",
  "active execution time (requires lease-valid running intervals)",
  "awaiting time (requires status interval reconstruction)",
  "total wall time (requires terminal Event pairing per Run)",
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
