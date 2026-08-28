import { useState } from "react";
import type { Run } from "@monai/contracts";

import { api, defaultApiContext } from "../../api/client";
import { useRunConsole } from "../../contexts/RunConsoleContext";

type Props = {
  run: Run;
  approvalId: string;
};

export function ApprovalAction({ run, approvalId }: Props) {
  const { applyHandleResult } = useRunConsole();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function decide(decision: "approved" | "rejected"): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const result = await api.approvalDecision(
        defaultApiContext(),
        run.runId,
        approvalId,
        run.revision,
        decision,
        reason.trim() || undefined,
      );
      applyHandleResult(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "approval failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: 12 }}>
      <div className="panel-header" style={{ border: "none", padding: "0 0 8px" }}>
        审批 · {approvalId}
      </div>
      <div className="field">
        <label htmlFor="approvalReason">原因（可选）</label>
        <input
          id="approvalReason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="拒绝时可填写原因"
        />
      </div>
      {error ? <div className="error-banner">{error}</div> : null}
      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy}
          onClick={() => decide("approved")}
        >
          批准
        </button>
        <button type="button" className="btn btn-danger" disabled={busy} onClick={() => decide("rejected")}>
          拒绝
        </button>
      </div>
    </div>
  );
}
