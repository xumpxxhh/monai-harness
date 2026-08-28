import { useState, type FormEvent } from "react";

import { useRunConsole } from "../../contexts/RunConsoleContext";

export function OpenRunForm() {
  const { openRun, refreshRunsList } = useRunConsole();
  const [runId, setRunId] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit(e: FormEvent): Promise<void> {
    e.preventDefault();
    const id = runId.trim();
    if (!id) {
      setError("runId 不能为空");
      return Promise.resolve();
    }
    setError(null);
    openRun(id);
    refreshRunsList();
    return Promise.resolve();
  }

  return (
    <form onSubmit={submit} style={{ marginBottom: 12 }}>
      <div className="field">
        <label htmlFor="openRunId">打开已有 Run</label>
        <input
          id="openRunId"
          value={runId}
          onChange={(e) => setRunId(e.target.value)}
          placeholder="run-..."
        />
      </div>
      {error ? <div className="error-banner">{error}</div> : null}
      <button type="submit" className="btn">打开</button>
    </form>
  );
}
