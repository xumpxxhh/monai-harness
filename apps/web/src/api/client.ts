import type {
  ApprovalRecord,
  Continuation,
  EventEnvelope,
  Run,
  RunState,
  RunStatus,
  ToolCallRecord,
} from "@monai/contracts";

export type ApiContext = {
  tenantId: string;
  principalId?: string;
};

export type HandleSuccess = {
  ok: true;
  run: Run;
  revision: number;
  leaseEpoch: number;
  idempotent?: boolean;
};

export type ApiError = {
  ok: false;
  code: string;
  message: string;
  httpStatus: number;
};

const defaultContext: ApiContext = {
  tenantId: "t1",
  principalId: "console-user",
};

function headers(ctx: ApiContext, extra?: Record<string, string>): Headers {
  const h = new Headers(extra ?? {});
  h.set("X-Tenant-Id", ctx.tenantId);
  if (ctx.principalId) h.set("X-Principal-Id", ctx.principalId);
  return h;
}

async function parseJson<T>(res: Response): Promise<T> {
  const data = (await res.json()) as T;
  if (!res.ok) {
    const err = data as ApiError;
    throw new Error(err.message ?? `HTTP ${res.status}`);
  }
  return data;
}

export type RunSnapshot = {
  run: Run;
  state: RunState | null;
  continuation: Continuation | null;
  approvals: ApprovalRecord[];
  toolCalls: ToolCallRecord[];
  events: EventEnvelope[];
};

export const api = {
  async health(): Promise<{ ok: boolean }> {
    const res = await fetch("/healthz");
    return parseJson(res);
  },

  async listRuns(
    ctx: ApiContext,
    query?: { sessionId?: string; status?: RunStatus; limit?: number },
  ): Promise<Run[]> {
    const params = new URLSearchParams();
    if (query?.sessionId) params.set("sessionId", query.sessionId);
    if (query?.status) params.set("status", query.status);
    if (query?.limit) params.set("limit", String(query.limit));
    const qs = params.toString();
    const res = await fetch(`/v1/runs${qs ? `?${qs}` : ""}`, {
      headers: headers(ctx),
    });
    const data = await parseJson<{ ok: true; runs: Run[] }>(res);
    return data.runs;
  },

  async getRunSnapshot(ctx: ApiContext, runId: string): Promise<RunSnapshot> {
    const h = headers(ctx);
    const [runRes, stateRes, contRes, apprRes, toolRes, eventsRes] = await Promise.all([
      fetch(`/v1/runs/${encodeURIComponent(runId)}`, { headers: h }),
      fetch(`/v1/runs/${encodeURIComponent(runId)}/state`, { headers: h }),
      fetch(`/v1/runs/${encodeURIComponent(runId)}/continuation`, { headers: h }),
      fetch(`/v1/runs/${encodeURIComponent(runId)}/approvals`, { headers: h }),
      fetch(`/v1/runs/${encodeURIComponent(runId)}/tool-calls`, { headers: h }),
      fetch(`/v1/runs/${encodeURIComponent(runId)}/events?fromSequence=1`, { headers: h }),
    ]);
    const runData = await parseJson<{ ok: true; run: Run }>(runRes);
    const stateData = await parseJson<{ ok: true; state: RunState | null }>(stateRes);
    const contData = await parseJson<{ ok: true; continuation: Continuation | null }>(contRes);
    const apprData = await parseJson<{ ok: true; approvals: ApprovalRecord[] }>(apprRes);
    const toolData = await parseJson<{ ok: true; toolCalls: ToolCallRecord[] }>(toolRes);
    const eventsData = await parseJson<{ ok: true; events: EventEnvelope[] }>(eventsRes);
    return {
      run: runData.run,
      state: stateData.state,
      continuation: contData.continuation,
      approvals: apprData.approvals,
      toolCalls: toolData.toolCalls,
      events: eventsData.events,
    };
  },

  async createRun(
    ctx: ApiContext,
    body: {
      runId: string;
      sessionId: string;
      goal: string;
      strategy?: { type: "light" | "dag"; version: string };
      agentDefinitionId?: string;
      agentVersion?: string;
      executionManifestRef?: string;
      packVersions?: Array<{ packId: string; version: string }>;
      budgets?: Record<string, unknown>;
    },
  ): Promise<HandleSuccess> {
    const res = await fetch("/v1/runs", {
      method: "POST",
      headers: headers(ctx, {
        "Content-Type": "application/json",
        "Idempotency-Key": `create-${body.runId}`,
      }),
      body: JSON.stringify({
        ...body,
        agentDefinitionId: body.agentDefinitionId ?? "agent",
        agentVersion: body.agentVersion ?? "1",
        executionManifestRef: body.executionManifestRef ?? "manifest://console",
        packVersions: body.packVersions ?? [{ packId: "core", version: "0.1.0" }],
        strategy: body.strategy ?? { type: "light", version: "1" },
      }),
    });
    return parseJson(res);
  },

  async approvalDecision(
    ctx: ApiContext,
    runId: string,
    approvalId: string,
    expectedRevision: number,
    decision: "approved" | "rejected",
    reason?: string,
  ): Promise<HandleSuccess> {
    const res = await fetch(
      `/v1/runs/${encodeURIComponent(runId)}/approvals/${encodeURIComponent(approvalId)}/decision`,
      {
        method: "POST",
        headers: headers(ctx, {
          "Content-Type": "application/json",
          "Idempotency-Key": `approval-${approvalId}`,
          "If-Match": String(expectedRevision),
        }),
        body: JSON.stringify({ decision, expectedRevision, reason }),
      },
    );
    return parseJson(res);
  },

  async submitInput(
    ctx: ApiContext,
    runId: string,
    inputId: string,
    expectedRevision: number,
    value: unknown,
  ): Promise<HandleSuccess> {
    const res = await fetch(`/v1/runs/${encodeURIComponent(runId)}/input`, {
      method: "POST",
      headers: headers(ctx, {
        "Content-Type": "application/json",
        "Idempotency-Key": `input-${inputId}`,
        "If-Match": String(expectedRevision),
      }),
      body: JSON.stringify({ inputId, value, expectedRevision }),
    });
    return parseJson(res);
  },

  async controlRun(
    ctx: ApiContext,
    runId: string,
    action: "pause" | "resume" | "cancel",
    expectedRevision: number,
  ): Promise<HandleSuccess> {
    const res = await fetch(`/v1/runs/${encodeURIComponent(runId)}/${action}`, {
      method: "POST",
      headers: headers(ctx, {
        "Content-Type": "application/json",
        "Idempotency-Key": `${action}-${runId}-${expectedRevision}`,
        "If-Match": String(expectedRevision),
      }),
      body: JSON.stringify({ expectedRevision }),
    });
    return parseJson(res);
  },

  /** Harness-only route (apps/harness http-server). */
  async executeTurn(ctx: ApiContext, runId: string): Promise<HandleSuccess> {
    const res = await fetch(`/v1/runs/${encodeURIComponent(runId)}/turn`, {
      method: "POST",
      headers: headers(ctx, {
        "Content-Type": "application/json",
        "Idempotency-Key": `turn-${runId}-${Date.now()}`,
      }),
      body: JSON.stringify({}),
    });
    return parseJson(res);
  },

  eventsStreamUrl(runId: string, fromSequence = 1): string {
    return `/v1/runs/${encodeURIComponent(runId)}/events/stream?fromSequence=${fromSequence}`;
  },
};

export function defaultApiContext(): ApiContext {
  return { ...defaultContext };
}

export type { EventEnvelope };
