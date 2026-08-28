import { useState } from "react";
import type { Run } from "@monai/contracts";

import { api, defaultApiContext } from "../../api/client";
import { useRunConsole } from "../../contexts/RunConsoleContext";

type Props = {
  run: Run;
};

export function ControlActions({ run }: Props) {
  const { applyHandleResult } = useRunConsole();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function act(action: "pause" | "resume" | "cancel"): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const result = await api.controlRun(
        defaultApiContext(),
        run.runId,
        action,
        run.revision,
      );
      applyHandleResult(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : `${action} failed`);
    } finally {
      setBusy(false);
    }
  }

  async function executeTurn(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const result = await api.executeTurn(defaultApiContext(), run.runId);
      applyHandleResult(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "execute turn failed");
    } finally {
      setBusy(false);
    }
  }

  const canPause = run.status === "running" || run.status === "queued";
  const canResume = run.status === "paused";
  const canCancel = !["succeeded", "failed", "cancelled"].includes(run.status);
  const canTurn = run.status === "running";

  return (
    <div style={{ marginTop: 12 }}>
      <div className="panel-header" style={{ border: "none", padding: "0 0 8px" }}>
        控制
      </div>
      {error ? <div className="error-banner">{error}</div> : null}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {canTurn ? (
          <button type="button" className="btn btn-primary" disabled={busy} onClick={executeTurn}>
            Execute turn
          </button>
        ) : null}
        {canPause ? (
          <button type="button" className="btn" disabled={busy} onClick={() => act("pause")}>
            Pause
          </button>
        ) : null}
        {canResume ? (
          <button type="button" className="btn" disabled={busy} onClick={() => act("resume")}>
            Resume
          </button>
        ) : null}
        {canCancel ? (
          <button type="button" className="btn btn-danger" disabled={busy} onClick={() => act("cancel")}>
            Cancel
          </button>
        ) : null}
      </div>
    </div>
  );
}
