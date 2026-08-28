import { useState, type FormEvent } from "react";
import type { Continuation, Run } from "@monai/contracts";

import { api, defaultApiContext } from "../../api/client";
import { useRunConsole } from "../../contexts/RunConsoleContext";

type Props = {
  run: Run;
  continuation: Continuation;
};

export function InputAction({ run, continuation }: Props) {
  const { applyHandleResult } = useRunConsole();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputId = continuation.continuationId;

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await api.submitInput(
        defaultApiContext(),
        run.runId,
        inputId,
        run.revision,
        value.trim(),
      );
      applyHandleResult(result);
      setValue("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "submit failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ marginTop: 12 }}>
      <div className="panel-header" style={{ border: "none", padding: "0 0 8px" }}>
        用户输入
      </div>
      {continuation.inputPrompt ? (
        <p style={{ fontSize: "0.85rem", margin: "0 0 8px" }}>{continuation.inputPrompt}</p>
      ) : null}
      <div className="field">
        <label htmlFor="inputValue">回复</label>
        <textarea id="inputValue" value={value} onChange={(e) => setValue(e.target.value)} />
      </div>
      {error ? <div className="error-banner">{error}</div> : null}
      <button type="submit" className="btn btn-primary" disabled={busy}>
        {busy ? "提交中…" : "Submit input"}
      </button>
    </form>
  );
}
