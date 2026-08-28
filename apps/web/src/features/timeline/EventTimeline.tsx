import { useRunConsole } from "../../contexts/RunConsoleContext";
import { EventView } from "./EventViewRegistry";

export function EventTimeline() {
  const { selectedRunId, events, streamConnected, runError } = useRunConsole();

  if (!selectedRunId) {
    return <p className="empty-hint">选择或创建一个 Run 以查看事件流。</p>;
  }

  return (
    <div>
      <div style={{ marginBottom: 12, fontSize: "0.8rem", color: "var(--text-muted)" }}>
        SSE {streamConnected ? "已连接" : "未连接"} · {selectedRunId}
      </div>
      {runError ? <div className="error-banner">{runError}</div> : null}
      <div className="timeline">
        {events.map((event) => (
          <article key={event.sequence} className="event-card">
            <div className="event-type">{event.eventType}</div>
            <div className="event-meta">
              seq {event.sequence} · {event.occurredAt}
            </div>
            <EventView event={event} />
          </article>
        ))}
        {events.length === 0 ? <p className="empty-hint">等待事件…</p> : null}
      </div>
    </div>
  );
}
