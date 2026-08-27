import type { EventEnvelope, Run } from "@monai/contracts";

export type RunMetricsSnapshot = {
  runId: string;
  terminal: boolean;
  succeeded: boolean;
  policyEvaluated: number;
  policyDenied: number;
  approvalRequested: boolean;
  actionAccepted: boolean;
  toolDispatched: number;
  toolRetryDispatches: number;
  outcomeUnknown: number;
  leaseTakeovers: number;
};

export type AggregateMetrics = {
  runs: number;
  terminalRuns: number;
  succeededRuns: number;
  taskSuccessRate: number | null;
  policyDenyRate: number | null;
  approvalRate: number | null;
  toolRetryRate: number | null;
  outcomeUnknownRate: number | null;
  leaseTakeoverCount: number;
  gaps: readonly string[];
};

function isTerminalStatus(status: Run["status"]): boolean {
  return status === "succeeded" || status === "failed" || status === "cancelled";
}

/**
 * Derive MVP metrics for one Run from committed Events (design 07 §4.2 subset).
 */
export function computeRunMetrics(events: EventEnvelope[], run: Run): RunMetricsSnapshot {
  let policyEvaluated = 0;
  let policyDenied = 0;
  let approvalRequested = false;
  let actionAccepted = false;
  let toolDispatched = 0;
  let toolRetryDispatches = 0;
  let outcomeUnknown = 0;
  let leaseTakeovers = 0;

  for (const event of events) {
    switch (event.eventType) {
      case "policy.evaluated":
        policyEvaluated += 1;
        break;
      case "policy.denied":
        policyDenied += 1;
        break;
      case "approval.requested":
        approvalRequested = true;
        break;
      case "action.accepted":
        actionAccepted = true;
        break;
      case "tool.dispatched": {
        toolDispatched += 1;
        const attempt = (event.payload as { attempt?: number } | undefined)?.attempt;
        if (typeof attempt === "number" && attempt > 1) {
          toolRetryDispatches += 1;
        }
        break;
      }
      case "tool.outcome_unknown":
        outcomeUnknown += 1;
        break;
      case "run.lease_lost":
        leaseTakeovers += 1;
        break;
      default:
        break;
    }
  }

  const terminal = isTerminalStatus(run.status);
  return {
    runId: run.runId,
    terminal,
    succeeded: run.status === "succeeded",
    policyEvaluated,
    policyDenied,
    approvalRequested,
    actionAccepted,
    toolDispatched,
    toolRetryDispatches,
    outcomeUnknown,
    leaseTakeovers,
  };
}

export function aggregateMetrics(
  snapshots: RunMetricsSnapshot[],
  gaps: readonly string[],
): AggregateMetrics {
  const runs = snapshots.length;
  const terminalRuns = snapshots.filter((s) => s.terminal).length;
  const succeededRuns = snapshots.filter((s) => s.succeeded).length;
  const policyEvaluated = snapshots.reduce((n, s) => n + s.policyEvaluated, 0);
  const policyDenied = snapshots.reduce((n, s) => n + s.policyDenied, 0);
  const actionAcceptedRuns = snapshots.filter((s) => s.actionAccepted).length;
  const approvalRuns = snapshots.filter((s) => s.approvalRequested).length;
  const toolDispatched = snapshots.reduce((n, s) => n + s.toolDispatched, 0);
  const toolRetryDispatches = snapshots.reduce((n, s) => n + s.toolRetryDispatches, 0);
  const outcomeUnknown = snapshots.reduce((n, s) => n + s.outcomeUnknown, 0);
  const leaseTakeoverCount = snapshots.reduce((n, s) => n + s.leaseTakeovers, 0);

  return {
    runs,
    terminalRuns,
    succeededRuns,
    taskSuccessRate: terminalRuns > 0 ? succeededRuns / terminalRuns : null,
    policyDenyRate: policyEvaluated > 0 ? policyDenied / policyEvaluated : null,
    approvalRate: actionAcceptedRuns > 0 ? approvalRuns / actionAcceptedRuns : null,
    toolRetryRate: toolDispatched > 0 ? toolRetryDispatches / toolDispatched : null,
    outcomeUnknownRate: toolDispatched > 0 ? outcomeUnknown / toolDispatched : null,
    leaseTakeoverCount,
    gaps,
  };
}
