import { useNavigate, useParams } from "react-router-dom";

import { RunConsoleProvider } from "../contexts/RunConsoleContext";
import { CreateRunForm } from "../features/runs/CreateRunForm";
import { SessionSidebar } from "../features/sessions/SessionSidebar";
import { EventTimeline } from "../features/timeline/EventTimeline";
import { InspectorPanel } from "../features/inspector/InspectorPanel";

function ConsoleShell() {
  const { runId } = useParams<{ runId?: string }>();
  const navigate = useNavigate();

  return (
    <RunConsoleProvider
      selectedRunId={runId}
      onSelectRun={(id) => navigate(`/runs/${encodeURIComponent(id)}`)}
    >
      <div className="console-root">
        <SessionSidebar
          selectedRunId={runId}
          onSelectRun={(id) => navigate(`/runs/${encodeURIComponent(id)}`)}
        />
        <main className="panel" style={{ borderLeft: "none", borderRight: "none" }}>
          <div className="panel-header">Monai Harness Console</div>
          <div className="panel-body">
            <CreateRunForm
              onCreated={(id) => navigate(`/runs/${encodeURIComponent(id)}`)}
            />
            <EventTimeline />
          </div>
        </main>
        <InspectorPanel />
      </div>
    </RunConsoleProvider>
  );
}

export function ConsoleLayout() {
  return <ConsoleShell />;
}
