export { PersistenceEventStream } from "./event-stream/persistence-event-stream.js";
export {
  aggregateMetrics,
  computeRunMetrics,
  type AggregateMetrics,
  type RunMetricsSnapshot,
} from "./metrics/compute-metrics.js";
export {
  average,
  computeRunTiming,
  percentile,
  timingEvent,
  type RunTimingMetrics,
} from "./metrics/compute-run-timing.js";
export { MVP_METRIC_GAPS, MVP_TIMING_METRICS_IMPLEMENTED, type MvpMetricGap } from "./metrics/mvp-gaps.js";
export {
  EvalHarness,
  GOLDEN_EVAL_SUITE,
  GOLDEN_FACTS_PRESENT_CHECKS,
  GOLDEN_FINISH_GATE,
  GOLDEN_REPETITIONS,
  acquireLease,
  bootstrapRunning,
  cmd,
  createEvalContext,
  dispatchPrepared,
  executeTurn,
  metricsForRun,
  patchApprovalForEval,
  patchContinuationForEval,
  type CreateEvalContextOptions,
  type EvalCaseDefinition,
  type EvalCaseResult,
  type EvalContext,
  type EvalSuiteDefinition,
  type EvalSuiteResult,
} from "./eval/eval-harness.js";
export {
  APPROVAL_EVAL_SUITE,
  APPROVAL_REPETITIONS,
  FULL_MVP_EVAL_SUITES,
  IDEMPOTENCY_EVAL_SUITE,
  IDEMPOTENCY_REPETITIONS,
  RECOVERY_EVAL_SUITE,
  RECOVERY_REPETITIONS,
  MVP_EVAL_SUITES,
  SECURITY_EVAL_SUITE,
  SECURITY_REPETITIONS,
} from "./eval/eval-control-suites.js";

export const PACKAGE_NAME = "@monai/observability" as const;
