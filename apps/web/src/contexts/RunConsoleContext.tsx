import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  ApprovalRecord,
  Continuation,
  EventEnvelope,
  Run,
  RunState,
  ToolCallRecord,
} from "@monai/contracts";

import {
  api,
  defaultApiContext,
  type ApiContext,
  type HandleSuccess,
} from "../api/client";

function parseSseChunk(block: string): EventEnvelope | undefined {
  const dataLine = block.split("\n").find((line) => line.startsWith("data:"));
  if (!dataLine) return undefined;
  const raw = dataLine.slice(5).trim();
  if (!raw) return undefined;
  return JSON.parse(raw) as EventEnvelope;
}

async function consumeEventStream(
  url: string,
  signal: AbortSignal,
  onEvent: (event: EventEnvelope) => void,
): Promise<void> {
  const res = await fetch(url, {
    headers: { Accept: "text/event-stream" },
    signal,
  });
  if (!res.ok || !res.body) {
    throw new Error(`SSE failed: ${res.status}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let split = buffer.indexOf("\n\n");
    while (split >= 0) {
      const block = buffer.slice(0, split);
      buffer = buffer.slice(split + 2);
      const event = parseSseChunk(block);
      if (event) onEvent(event);
      split = buffer.indexOf("\n\n");
    }
  }
}

/** Events that may change run snapshot (inspector / actions) — refresh on these, not on a timer. */
const SNAPSHOT_TRIGGER_EVENTS = new Set([
  "step.started",
  "run.status_changed",
  "run.completed",
  "run.failed",
  "run.cancelled",
  "approval.requested",
  "approval.approved",
  "approval.rejected",
  "approval.consumed",
  "checkpoint.saved",
  "state.reduced",
  "tool.call_prepared",
  "tool.succeeded",
  "tool.failed",
  "tool.outcome_unknown",
  "tool.reconciled",
]);

function statusFromLifecycleEvent(event: EventEnvelope): Run["status"] | undefined {
  switch (event.eventType) {
    case "run.created":
      return "created";
    case "run.queued":
      return "queued";
    case "run.lease_acquired":
      return "running";
    case "run.completed":
      return "succeeded";
    case "run.failed":
      return "failed";
    case "run.cancelled":
      return "cancelled";
    case "run.status_changed": {
      const p = event.payload as { to?: string } | undefined;
      const to = p?.to;
      if (typeof to === "string") return to as Run["status"];
      return undefined;
    }
    default:
      return undefined;
  }
}

export function groupRunsBySession(runs: Run[]): Map<string, Run[]> {
  const map = new Map<string, Run[]>();
  for (const run of runs) {
    const list = map.get(run.sessionId) ?? [];
    list.push(run);
    map.set(run.sessionId, list);
  }
  for (const [, list] of map) {
    list.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  }
  return map;
}

type RunConsoleState = {
  runs: Run[];
  runsLoading: boolean;
  runsError: string | null;
  selectedRunId: string | undefined;
  run: Run | null;
  state: RunState | null;
  continuation: Continuation | null;
  approvals: ApprovalRecord[];
  toolCalls: ToolCallRecord[];
  events: EventEnvelope[];
  streamConnected: boolean;
  runLoading: boolean;
  runError: string | null;
  refreshRunsList: () => Promise<void>;
  openRun: (runId: string) => void;
  applyHandleResult: (result: HandleSuccess) => void;
};

const RunConsoleContext = createContext<RunConsoleState | null>(null);

type ProviderProps = {
  selectedRunId: string | undefined;
  onSelectRun: (runId: string) => void;
  children: ReactNode;
  ctx?: ApiContext;
};

export function RunConsoleProvider({
  selectedRunId,
  onSelectRun,
  children,
  ctx = defaultApiContext(),
}: ProviderProps) {
  const [runs, setRuns] = useState<Run[]>([]);
  const [runsLoading, setRunsLoading] = useState(true);
  const [runsError, setRunsError] = useState<string | null>(null);

  const [run, setRun] = useState<Run | null>(null);
  const [state, setState] = useState<RunState | null>(null);
  const [continuation, setContinuation] = useState<Continuation | null>(null);
  const [approvals, setApprovals] = useState<ApprovalRecord[]>([]);
  const [toolCalls, setToolCalls] = useState<ToolCallRecord[]>([]);
  const [events, setEvents] = useState<EventEnvelope[]>([]);
  const [streamConnected, setStreamConnected] = useState(false);
  const [runLoading, setRunLoading] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);

  const snapshotTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const snapshotInflightRef = useRef(false);

  const patchRunInList = useCallback((patch: Run) => {
    setRuns((prev) => {
      const idx = prev.findIndex((r) => r.runId === patch.runId);
      if (idx < 0) return [patch, ...prev];
      const next = [...prev];
      next[idx] = patch;
      return next;
    });
  }, []);

  const refreshRunsList = useCallback(async () => {
    setRunsLoading(true);
    try {
      const list = await api.listRuns(ctx, { limit: 100 });
      setRuns(list);
      setRunsError(null);
    } catch (e) {
      setRunsError(e instanceof Error ? e.message : "list failed");
    } finally {
      setRunsLoading(false);
    }
  }, [ctx.tenantId, ctx.principalId]);

  const loadRunSnapshot = useCallback(
    async (runId: string) => {
      setRunLoading(true);
      try {
        const snap = await api.getRunSnapshot(ctx, runId);
        setRun(snap.run);
        setState(snap.state);
        setContinuation(snap.continuation);
        setApprovals(snap.approvals);
        setToolCalls(snap.toolCalls);
        setEvents(snap.events);
        patchRunInList(snap.run);
        setRunError(null);
        return snap;
      } catch (e) {
        setRunError(e instanceof Error ? e.message : "load failed");
        throw e;
      } finally {
        setRunLoading(false);
      }
    },
    [ctx.tenantId, ctx.principalId, patchRunInList],
  );

  const scheduleSnapshotRefresh = useCallback(
    (runId: string) => {
      if (snapshotTimerRef.current) clearTimeout(snapshotTimerRef.current);
      snapshotTimerRef.current = setTimeout(() => {
        if (snapshotInflightRef.current) return;
        snapshotInflightRef.current = true;
        loadRunSnapshot(runId)
          .catch(() => undefined)
          .finally(() => {
            snapshotInflightRef.current = false;
          });
      }, 200);
    },
    [loadRunSnapshot],
  );

  const appendEvent = useCallback(
    (event: EventEnvelope) => {
      setEvents((prev) => {
        if (prev.some((e) => e.sequence === event.sequence)) return prev;
        return [...prev, event].sort((a, b) => a.sequence - b.sequence);
      });

      const status = statusFromLifecycleEvent(event);
      if (status) {
        setRun((prev) => {
          if (!prev || prev.runId !== event.runId) return prev;
          const next = { ...prev, status, updatedAt: event.occurredAt };
          patchRunInList(next);
          return next;
        });
      }

      if (SNAPSHOT_TRIGGER_EVENTS.has(event.eventType)) {
        scheduleSnapshotRefresh(event.runId);
      }
    },
    [patchRunInList, scheduleSnapshotRefresh],
  );

  const applyHandleResult = useCallback(
    (result: HandleSuccess) => {
      setRun(result.run);
      patchRunInList(result.run);
      scheduleSnapshotRefresh(result.run.runId);
    },
    [patchRunInList, scheduleSnapshotRefresh],
  );

  const openRun = useCallback(
    (runId: string) => {
      onSelectRun(runId);
    },
    [onSelectRun],
  );

  useEffect(() => {
    refreshRunsList();
  }, [refreshRunsList]);

  useEffect(() => {
    if (!selectedRunId) {
      setRun(null);
      setState(null);
      setContinuation(null);
      setApprovals([]);
      setToolCalls([]);
      setEvents([]);
      setStreamConnected(false);
      setRunError(null);
      return;
    }

    const ac = new AbortController();
    let cancelled = false;

    async function bootstrap(): Promise<void> {
      try {
        const snap = await loadRunSnapshot(selectedRunId!);
        if (cancelled) return;

        const fromSeq =
          snap.events.length > 0 ? snap.events[snap.events.length - 1]!.sequence + 1 : 1;
        setStreamConnected(true);
        await consumeEventStream(
          api.eventsStreamUrl(selectedRunId!, fromSeq),
          ac.signal,
          (event) => {
            if (!cancelled) appendEvent(event);
          },
        );
      } catch (e) {
        if (!cancelled && !ac.signal.aborted) {
          setRunError(e instanceof Error ? e.message : "stream error");
          setStreamConnected(false);
        }
      }
    }

    bootstrap();

    return () => {
      cancelled = true;
      ac.abort();
      setStreamConnected(false);
      if (snapshotTimerRef.current) clearTimeout(snapshotTimerRef.current);
    };
  }, [selectedRunId, loadRunSnapshot, appendEvent]);

  const value = useMemo(
    (): RunConsoleState => ({
      runs,
      runsLoading,
      runsError,
      selectedRunId,
      run,
      state,
      continuation,
      approvals,
      toolCalls,
      events,
      streamConnected,
      runLoading,
      runError,
      refreshRunsList,
      openRun,
      applyHandleResult,
    }),
    [
      runs,
      runsLoading,
      runsError,
      selectedRunId,
      run,
      state,
      continuation,
      approvals,
      toolCalls,
      events,
      streamConnected,
      runLoading,
      runError,
      refreshRunsList,
      openRun,
      applyHandleResult,
    ],
  );

  return <RunConsoleContext.Provider value={value}>{children}</RunConsoleContext.Provider>;
}

export function useRunConsole(): RunConsoleState {
  const ctx = useContext(RunConsoleContext);
  if (!ctx) throw new Error("useRunConsole must be used within RunConsoleProvider");
  return ctx;
}
