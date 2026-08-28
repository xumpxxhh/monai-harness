import type { Run } from "@monai/contracts";

import { groupRunsBySession, useRunConsole } from "../../contexts/RunConsoleContext";
import { OpenRunForm } from "../runs/OpenRunForm";

type Props = {
  selectedRunId?: string;
  onSelectRun: (runId: string) => void;
};

export function SessionSidebar({ selectedRunId, onSelectRun }: Props) {
  const { runs, runsLoading, runsError, refreshRunsList } = useRunConsole();
  const grouped = groupRunsBySession(runs);

  return (
    <aside className="panel" style={{ borderRight: "none" }}>
      <div className="panel-header">
        Sessions / Runs
        <button
          type="button"
          className="btn"
          style={{ float: "right", padding: "2px 8px", fontSize: "0.7rem" }}
          onClick={() => refreshRunsList()}
        >
          刷新
        </button>
      </div>
      <div className="panel-body">
        <OpenRunForm />
        {runsError ? <div className="error-banner">{runsError}</div> : null}
        {runsLoading && runs.length === 0 ? (
          <p className="empty-hint">加载中…</p>
        ) : null}
        {grouped.size === 0 && !runsLoading ? (
          <p className="empty-hint">暂无 Run，在中间创建第一个。</p>
        ) : null}
        {[...grouped.entries()].map(([sessionId, sessionRuns]) => (
          <div key={sessionId} className="session-block">
            <div className="session-title">session · {sessionId}</div>
            {sessionRuns.map((run: Run) => (
              <button
                key={run.runId}
                type="button"
                className={`list-item${selectedRunId === run.runId ? " active" : ""}`}
                onClick={() => onSelectRun(run.runId)}
              >
                <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.75rem" }}>
                  {run.runId}
                </div>
                <div style={{ marginTop: 4 }}>
                  <span className={`status-pill ${run.status}`}>{run.status}</span>
                  <span style={{ marginLeft: 8, fontSize: "0.7rem", color: "var(--text-muted)" }}>
                    rev {run.revision}
                  </span>
                </div>
              </button>
            ))}
          </div>
        ))}
      </div>
    </aside>
  );
}
