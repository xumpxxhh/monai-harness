import type { EventEnvelope } from "@monai/contracts";
import type { ReactNode } from "react";

export type EventViewProps = {
  event: EventEnvelope;
};

export type EventViewComponent = (props: EventViewProps) => ReactNode;

const registry = new Map<string, EventViewComponent>();

export function registerEventView(eventType: string, component: EventViewComponent): void {
  registry.set(eventType, component);
}

function summarizePayload(payload: unknown): string | undefined {
  if (payload === undefined || payload === null) return undefined;
  if (typeof payload === "string") return payload;
  try {
    const text = JSON.stringify(payload);
    return text.length > 200 ? `${text.slice(0, 200)}…` : text;
  } catch {
    return String(payload);
  }
}

function GenericEventView({ event }: EventViewProps): ReactNode {
  const summary = summarizePayload(event.payload);
  return (
    <div>
      {summary ? <div className="json-block">{summary}</div> : null}
    </div>
  );
}

function RunLifecycleView({ event }: EventViewProps): ReactNode {
  const payload = event.payload as Record<string, unknown> | undefined;
  const status = payload?.status ?? payload?.toStatus;
  return status ? <div>status → {String(status)}</div> : <GenericEventView event={event} />;
}

function ToolEventView({ event }: EventViewProps): ReactNode {
  const payload = event.payload as Record<string, unknown> | undefined;
  const tool = payload?.toolId ?? payload?.toolCallId;
  return tool ? <div>tool: {String(tool)}</div> : <GenericEventView event={event} />;
}

registerEventView("run.created", RunLifecycleView);
registerEventView("run.queued", RunLifecycleView);
registerEventView("run.lease_acquired", () => <div>lease acquired</div>);
registerEventView("run.status_changed", RunLifecycleView);
registerEventView("run.completed", RunLifecycleView);
registerEventView("run.failed", RunLifecycleView);
registerEventView("run.cancelled", RunLifecycleView);
registerEventView("tool.call_prepared", ToolEventView);
registerEventView("tool.dispatched", ToolEventView);
registerEventView("tool.succeeded", ToolEventView);
registerEventView("tool.failed", ToolEventView);
registerEventView("tool.outcome_unknown", ToolEventView);
registerEventView("approval.requested", ({ event }) => {
  const p = event.payload as Record<string, unknown> | undefined;
  return <div>approval: {String(p?.approvalId ?? "?")}</div>;
});
registerEventView("action.proposed", ({ event }) => {
  const p = event.payload as Record<string, unknown> | undefined;
  return <div>action: {String(p?.actionType ?? p?.type ?? "proposed")}</div>;
});
registerEventView("policy.evaluated", GenericEventView);
registerEventView("model.responded", ({ event }) => {
  const p = event.payload as { display?: string; reasoning?: string } | undefined;
  return (
    <div>
      {p?.display ? <div style={{ whiteSpace: "pre-wrap" }}>{p.display}</div> : <div>model responded</div>}
      {p?.reasoning ? (
        <details style={{ marginTop: 8 }}>
          <summary style={{ cursor: "pointer", fontSize: "0.85rem" }}>思考过程</summary>
          <div style={{ whiteSpace: "pre-wrap", color: "var(--text-muted)" }}>{p.reasoning}</div>
        </details>
      ) : null}
    </div>
  );
});

export function EventView({ event }: EventViewProps): ReactNode {
  const View = registry.get(event.eventType) ?? GenericEventView;
  return <View event={event} />;
}
