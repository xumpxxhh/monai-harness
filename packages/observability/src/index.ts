export { PersistenceEventStream } from "./event-stream/persistence-event-stream.js";
export {
  aggregateMetrics,
  computeRunMetrics,
  type AggregateMetrics,
  type RunMetricsSnapshot,
} from "./metrics/compute-metrics.js";
export { MVP_METRIC_GAPS, type MvpMetricGap } from "./metrics/mvp-gaps.js";
export {
  EvalHarness,
  GOLDEN_EVAL_SUITE,
  GOLDEN_FACTS_PRESENT_CHECKS,
  GOLDEN_FINISH_GATE,
  GOLDEN_REPETITIONS,
  MVP_EVAL_SUITES,
  bootstrapRunning,
  createEvalContext,
  dispatchPrepared,
  executeTurn,
  metricsForRun,
  type CreateEvalContextOptions,
  type EvalCaseDefinition,
  type EvalCaseResult,
  type EvalContext,
  type EvalSuiteDefinition,
  type EvalSuiteResult,
} from "./eval/eval-harness.js";

export const PACKAGE_NAME = "@monai/observability" as const;
