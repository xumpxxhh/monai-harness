import { useRunConsole } from "../../contexts/RunConsoleContext";
import { EventView } from "./EventViewRegistry";

export function EventTimeline() {
  const { selectedRunId, events, streamConnected, runError, modelPreview } = useRunConsole();

  if (!selectedRunId) {
    return <p className="empty-hint">选择或创建一个 Run 以查看事件流。</p>;
  }

  const showPreview =
    modelPreview.status === "streaming" ||
    modelPreview.status === "invalid" ||
    (modelPreview.status === "committed" &&
      (modelPreview.reasoning.length > 0 || modelPreview.display.length > 0));

  return (
    <div>
      <div style={{ marginBottom: 12, fontSize: "0.8rem", color: "var(--text-muted)" }}>
        SSE {streamConnected ? "已连接" : "未连接"} · {selectedRunId}
      </div>
      {runError ? <div className="error-banner">{runError}</div> : null}
      <div className="timeline">
        {showPreview ? (
          <article className="event-card" style={{ borderColor: "var(--accent, #6ea8fe)" }}>
            <div className="event-type">
              model.preview
              {modelPreview.status === "streaming"
                ? " · 生成中"
                : modelPreview.status === "invalid"
                  ? " · 未通过校验（未执行）"
                  : " · 已提交"}
            </div>
            {modelPreview.reasoning ? (
              <details open={modelPreview.status === "streaming"}>
                <summary style={{ cursor: "pointer", fontSize: "0.85rem" }}>思考过程</summary>
                <div style={{ whiteSpace: "pre-wrap", marginTop: 8, color: "var(--text-muted)" }}>
                  {modelPreview.reasoning}
                </div>
              </details>
            ) : null}
            {modelPreview.display ? (
              <div style={{ whiteSpace: "pre-wrap", marginTop: 8 }}>{modelPreview.display}</div>
            ) : modelPreview.status === "streaming" ? (
              <p className="empty-hint">等待展示文案…</p>
            ) : null}
            {modelPreview.invalidReason ? (
              <div className="error-banner" style={{ marginTop: 8 }}>
                {modelPreview.invalidReason}
              </div>
            ) : null}
          </article>
        ) : null}
        {events.map((event) => (
          <article key={event.sequence} className="event-card">
            <div className="event-type">{event.eventType}</div>
            <div className="event-meta">
              seq {event.sequence} · {event.occurredAt}
            </div>
            <EventView event={event} />
          </article>
        ))}
        {events.length === 0 && !showPreview ? <p className="empty-hint">等待事件…</p> : null}
      </div>
    </div>
  );
}
