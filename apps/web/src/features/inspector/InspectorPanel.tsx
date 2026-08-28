import { useState } from "react";

import { useRunConsole } from "../../contexts/RunConsoleContext";
import { StatusActions } from "../actions/StatusActions";

type InspectorTab = "overview" | "tools" | "state" | "continuation";

export function InspectorPanel() {
  const {
    selectedRunId,
    run,
    state,
    continuation,
    approvals,
    toolCalls,
    runLoading,
    runError,
  } = useRunConsole();
  const [tab, setTab] = useState<InspectorTab>("overview");

  return (
    <aside className="panel" style={{ borderLeft: "none" }}>
      <div className="panel-header">Inspector</div>
      <div className="panel-body">
        {runError ? <div className="error-banner">{runError}</div> : null}
        {!selectedRunId ? <p className="empty-hint">未选择 Run。</p> : null}
        {runLoading && !run ? <p className="empty-hint">加载中…</p> : null}
        {run ? (
          <>
            <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
              {(["overview", "tools", "state", "continuation"] as InspectorTab[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  className="btn"
                  style={{
                    opacity: tab === t ? 1 : 0.65,
                    borderColor: tab === t ? "var(--accent)" : undefined,
                  }}
                  onClick={() => setTab(t)}
                >
                  {t}
                </button>
              ))}
            </div>

            {tab === "overview" ? (
              <>
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.8rem" }}>{run.runId}</div>
                  <div style={{ marginTop: 8 }}>
                    <span className={`status-pill ${run.status}`}>{run.status}</span>
                  </div>
                  <div style={{ marginTop: 8, fontSize: "0.8rem", color: "var(--text-muted)" }}>
                    session {run.sessionId} · rev {run.revision} · leaseEpoch {run.leaseEpoch}
                  </div>
                  <div style={{ marginTop: 8, fontSize: "0.85rem" }}>{run.goal}</div>
                  <div style={{ marginTop: 8, fontSize: "0.75rem", color: "var(--text-muted)" }}>
                    strategy {run.strategy.type}@{run.strategy.version} · agent {run.agentDefinitionId}
                  </div>
                </div>
                <StatusActions />
                {approvals.length > 0 ? (
                  <div style={{ marginTop: 16 }}>
                    <div className="panel-header" style={{ border: "none", padding: "0 0 8px" }}>
                      Approvals ({approvals.length})
                    </div>
                    <pre className="json-block">{JSON.stringify(approvals, null, 2)}</pre>
                  </div>
                ) : null}
              </>
            ) : null}

            {tab === "tools" ? (
              toolCalls.length > 0 ? (
                <pre className="json-block">{JSON.stringify(toolCalls, null, 2)}</pre>
              ) : (
                <p className="empty-hint">暂无 Tool 调用记录。</p>
              )
            ) : null}

            {tab === "state" ? (
              state ? (
                <pre className="json-block">{JSON.stringify(state, null, 2)}</pre>
              ) : (
                <p className="empty-hint">暂无 State 快照。</p>
              )
            ) : null}

            {tab === "continuation" ? (
              continuation ? (
                <pre className="json-block">{JSON.stringify(continuation, null, 2)}</pre>
              ) : (
                <p className="empty-hint">无 Continuation。</p>
              )
            ) : null}
          </>
        ) : null}
      </div>
    </aside>
  );
}
