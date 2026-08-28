import { useState, type FormEvent } from "react";

import { api, defaultApiContext } from "../../api/client";
import { useRunConsole } from "../../contexts/RunConsoleContext";

type Props = {
  onCreated: (runId: string, sessionId: string) => void;
};

export function CreateRunForm({ onCreated }: Props) {
  const { applyHandleResult, refreshRunsList } = useRunConsole();
  const [sessionId, setSessionId] = useState("s-console");
  const [goal, setGoal] = useState("echo hello from console");
  const [strategyType, setStrategyType] = useState<"light" | "dag">("light");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const runId = `run-${Date.now()}`;
    const sid = sessionId.trim() || "s-console";
    try {
      const result = await api.createRun(defaultApiContext(), {
        runId,
        sessionId: sid,
        goal: goal.trim(),
        strategy: { type: strategyType, version: "1" },
      });
      applyHandleResult(result);
      await refreshRunsList();
      onCreated(runId, sid);
    } catch (err) {
      setError(err instanceof Error ? err.message : "create failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ marginBottom: 16 }}>
      <div className="field">
        <label htmlFor="sessionId">Session ID</label>
        <input
          id="sessionId"
          value={sessionId}
          onChange={(e) => setSessionId(e.target.value)}
          placeholder="s-console"
        />
      </div>
      <div className="field">
        <label htmlFor="strategy">Strategy</label>
        <select
          id="strategy"
          value={strategyType}
          onChange={(e) => setStrategyType(e.target.value as "light" | "dag")}
        >
          <option value="light">light</option>
          <option value="dag">dag</option>
        </select>
      </div>
      <div className="field">
        <label htmlFor="goal">Goal</label>
        <textarea id="goal" value={goal} onChange={(e) => setGoal(e.target.value)} />
      </div>
      {error ? <div className="error-banner">{error}</div> : null}
      <button type="submit" className="btn btn-primary" disabled={busy}>
        {busy ? "创建中…" : "Create Run"}
      </button>
    </form>
  );
}
