import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { runStatusSchema } from "@monai/contracts";
import type { PersistencePort } from "@monai/ports";
import type { Engine, HandleResult } from "@monai/runtime";

import {
  buildApprovalDecisionCommand,
  buildSubmitInputCommand,
} from "../approval-input.js";
import {
  buildCancelRunCommand,
  buildPauseRunCommand,
  buildResumeRunCommand,
} from "../control-commands.js";
import { buildCreateRunCommand } from "../create-run.js";
import {
  liveSubscribeRunEvents,
  parseLastEventId,
  subscribeRunEvents,
} from "../event-stream.js";
import {
  badRequest,
  httpErrorFromHandleFailure,
  notFound,
  type HttpErrorBody,
} from "../http-error-map.js";

export type CreateHttpAppDeps = {
  engine: Engine;
  persistence: PersistencePort;
  /** Default tenant when `X-Tenant-Id` omitted. */
  defaultTenantId?: string;
  /** SSE poll interval (ms). */
  ssePollIntervalMs?: number;
  /** Allowed CORS origins; default dev Vite origins when unset. */
  corsOrigins?: string[];
};

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function commandIdFrom(c: { req: { header: (name: string) => string | undefined } }, fallback: string): string {
  return c.req.header("Idempotency-Key")?.trim() || fallback;
}

function tenantIdFrom(
  c: { req: { header: (name: string) => string | undefined } },
  body: JsonRecord | undefined,
  fallback: string,
): string {
  return (
    c.req.header("X-Tenant-Id")?.trim() ||
    (typeof body?.tenantId === "string" ? body.tenantId : undefined) ||
    fallback
  );
}

function expectedRevisionFrom(
  c: { req: { header: (name: string) => string | undefined } },
  body: JsonRecord | undefined,
): number | undefined {
  const ifMatch = c.req.header("If-Match")?.trim();
  if (ifMatch && /^\d+$/.test(ifMatch)) return Number(ifMatch);
  if (typeof body?.expectedRevision === "number") return body.expectedRevision;
  if (typeof body?.expectedRevision === "string" && /^\d+$/.test(body.expectedRevision)) {
    return Number(body.expectedRevision);
  }
  return undefined;
}

function jsonHandleResult(result: HandleResult): Response {
  if (!result.ok) {
    const err = httpErrorFromHandleFailure(result);
    return Response.json(err, { status: err.httpStatus });
  }
  return Response.json({
    ok: true,
    run: result.run,
    revision: result.revision,
    leaseEpoch: result.leaseEpoch,
    idempotent: result.idempotent,
  });
}

function jsonHttpError(err: HttpErrorBody): Response {
  return Response.json(err, { status: err.httpStatus });
}

/**
 * Hono REST + SSE app (EDR-007 Accepted).
 * Writes go only through Engine.handle; reads via PersistencePort.
 */
export function createHttpApp(deps: CreateHttpAppDeps): Hono {
  const app = new Hono();
  const defaultTenantId = deps.defaultTenantId ?? "t1";
  const ssePollIntervalMs = deps.ssePollIntervalMs ?? 200;
  const corsOrigins = deps.corsOrigins ?? [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
  ];

  app.use(
    "*",
    cors({
      origin: corsOrigins,
      allowMethods: ["GET", "POST", "OPTIONS"],
      allowHeaders: [
        "Content-Type",
        "Idempotency-Key",
        "X-Tenant-Id",
        "X-Principal-Id",
        "If-Match",
        "Last-Event-ID",
      ],
      exposeHeaders: ["Content-Type"],
    }),
  );

  app.get("/healthz", (c) => c.json({ ok: true }));

  app.post("/v1/runs", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return jsonHttpError(badRequest("invalid JSON body"));
    }
    if (!isRecord(body)) return jsonHttpError(badRequest("body must be an object"));

    const runId = typeof body.runId === "string" ? body.runId : undefined;
    if (!runId) return jsonHttpError(badRequest("runId is required"));

    const commandId = commandIdFrom(c, `create-${runId}`);
    const tenantId = tenantIdFrom(c, body, defaultTenantId);
    const strategyType =
      isRecord(body.strategy) && body.strategy.type === "dag" ? ("dag" as const) : ("light" as const);
    const strategy = {
      type: strategyType,
      version:
        isRecord(body.strategy) && typeof body.strategy.version === "string"
          ? body.strategy.version
          : "1",
    };

    const packVersions = Array.isArray(body.packVersions)
      ? body.packVersions.filter(isRecord).map((p) => ({
          packId: String(p.packId ?? "core"),
          version: String(p.version ?? "0.1.0"),
        }))
      : [];

    const result = await deps.engine.handle(
      buildCreateRunCommand({
        tenantId,
        commandId,
        runId,
        sessionId: typeof body.sessionId === "string" ? body.sessionId : "s1",
        agentDefinitionId:
          typeof body.agentDefinitionId === "string" ? body.agentDefinitionId : "agent",
        agentVersion: typeof body.agentVersion === "string" ? body.agentVersion : "1",
        executionManifestRef:
          typeof body.executionManifestRef === "string"
            ? body.executionManifestRef
            : "manifest://default",
        packVersions,
        goal: typeof body.goal === "string" ? body.goal : "",
        strategy,
        budgets: isRecord(body.budgets) ? body.budgets : undefined,
        principalId: c.req.header("X-Principal-Id")?.trim(),
      }),
    );
    return jsonHandleResult(result);
  });

  app.get("/v1/runs", async (c) => {
    const tenantId = tenantIdFrom(c, undefined, defaultTenantId);
    const sessionId = c.req.query("sessionId")?.trim() || undefined;
    const statusRaw = c.req.query("status")?.trim();
    let status: ReturnType<typeof runStatusSchema.parse> | undefined;
    if (statusRaw) {
      const parsed = runStatusSchema.safeParse(statusRaw);
      if (!parsed.success) {
        return jsonHttpError(badRequest(`invalid status: ${statusRaw}`));
      }
      status = parsed.data;
    }
    const limitRaw = c.req.query("limit");
    const limit =
      limitRaw && /^\d+$/.test(limitRaw) ? Number(limitRaw) : undefined;
    const runs = await deps.persistence.listRuns({
      tenantId,
      sessionId,
      status,
      limit,
    });
    return c.json({ ok: true, runs });
  });

  app.get("/v1/runs/:runId", async (c) => {
    const run = await deps.persistence.getRun(c.req.param("runId"));
    if (!run) return jsonHttpError(notFound("run not found"));
    return c.json({ ok: true, run });
  });

  app.get("/v1/runs/:runId/state", async (c) => {
    const runId = c.req.param("runId");
    const run = await deps.persistence.getRun(runId);
    if (!run) return jsonHttpError(notFound("run not found"));
    const state = await deps.persistence.getState(runId);
    return c.json({ ok: true, state: state ?? null });
  });

  app.get("/v1/runs/:runId/continuation", async (c) => {
    const runId = c.req.param("runId");
    const run = await deps.persistence.getRun(runId);
    if (!run) return jsonHttpError(notFound("run not found"));
    const continuation = await deps.persistence.getContinuation(runId);
    return c.json({ ok: true, continuation: continuation ?? null });
  });

  app.get("/v1/runs/:runId/approvals", async (c) => {
    const runId = c.req.param("runId");
    const run = await deps.persistence.getRun(runId);
    if (!run) return jsonHttpError(notFound("run not found"));
    const approvals = await deps.persistence.listApprovals(runId);
    return c.json({ ok: true, approvals });
  });

  app.get("/v1/runs/:runId/tool-calls", async (c) => {
    const runId = c.req.param("runId");
    const run = await deps.persistence.getRun(runId);
    if (!run) return jsonHttpError(notFound("run not found"));
    const toolCalls = await deps.persistence.listToolCalls(runId);
    return c.json({ ok: true, toolCalls });
  });

  app.get("/v1/runs/:runId/events", async (c) => {
    const runId = c.req.param("runId");
    const run = await deps.persistence.getRun(runId);
    if (!run) return jsonHttpError(notFound("run not found"));
    const fromRaw = c.req.query("fromSequence");
    const fromSequence = fromRaw && /^\d+$/.test(fromRaw) ? Number(fromRaw) : 1;
    const sub = subscribeRunEvents({
      persistence: deps.persistence,
      runId,
      fromSequence,
    });
    const events = await sub.readBatch();
    return c.json({ ok: true, events });
  });

  app.get("/v1/runs/:runId/events/stream", async (c) => {
    const runId = c.req.param("runId");
    const run = await deps.persistence.getRun(runId);
    if (!run) return jsonHttpError(notFound("run not found"));

    const fromQuery = c.req.query("fromSequence");
    const fromHeader = parseLastEventId(c.req.header("Last-Event-ID") ?? undefined);
    const fromSequence =
      fromQuery && /^\d+$/.test(fromQuery)
        ? Number(fromQuery)
        : (fromHeader ?? 1);

    return streamSSE(c, async (stream) => {
      const ac = new AbortController();
      stream.onAbort(() => ac.abort());
      try {
        for await (const event of liveSubscribeRunEvents({
          persistence: deps.persistence,
          runId,
          fromSequence,
          signal: ac.signal,
          pollIntervalMs: ssePollIntervalMs,
        })) {
          await stream.writeSSE({
            id: String(event.sequence),
            event: event.eventType,
            data: JSON.stringify(event),
          });
        }
      } catch {
        // Client disconnect / abort — do not roll back Run.
      }
    });
  });

  app.post("/v1/runs/:runId/approvals/:approvalId/decision", async (c) => {
    const runId = c.req.param("runId");
    const approvalId = c.req.param("approvalId");
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return jsonHttpError(badRequest("invalid JSON body"));
    }
    if (!isRecord(body)) return jsonHttpError(badRequest("body must be an object"));
    const decision = body.decision;
    if (decision !== "approved" && decision !== "rejected") {
      return jsonHttpError(badRequest("decision must be approved|rejected"));
    }
    const expectedRevision = expectedRevisionFrom(c, body);
    if (expectedRevision === undefined) {
      return jsonHttpError(badRequest("expectedRevision or If-Match required"));
    }
    const run = await deps.persistence.getRun(runId);
    if (!run) return jsonHttpError(notFound("run not found"));

    const result = await deps.engine.handle(
      buildApprovalDecisionCommand({
        tenantId: tenantIdFrom(c, body, run.tenantId),
        commandId: commandIdFrom(c, `approval-${approvalId}`),
        runId,
        expectedRevision,
        approvalId,
        decision,
        reason: typeof body.reason === "string" ? body.reason : undefined,
        principalId: c.req.header("X-Principal-Id")?.trim(),
      }),
    );
    return jsonHandleResult(result);
  });

  app.post("/v1/runs/:runId/input", async (c) => {
    const runId = c.req.param("runId");
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return jsonHttpError(badRequest("invalid JSON body"));
    }
    if (!isRecord(body)) return jsonHttpError(badRequest("body must be an object"));
    const expectedRevision = expectedRevisionFrom(c, body);
    if (expectedRevision === undefined) {
      return jsonHttpError(badRequest("expectedRevision or If-Match required"));
    }
    const inputId = typeof body.inputId === "string" ? body.inputId : undefined;
    if (!inputId) return jsonHttpError(badRequest("inputId is required"));
    const run = await deps.persistence.getRun(runId);
    if (!run) return jsonHttpError(notFound("run not found"));

    const result = await deps.engine.handle(
      buildSubmitInputCommand({
        tenantId: tenantIdFrom(c, body, run.tenantId),
        commandId: commandIdFrom(c, `input-${inputId}`),
        runId,
        expectedRevision,
        inputId,
        value: body.value,
        principalId: c.req.header("X-Principal-Id")?.trim(),
      }),
    );
    return jsonHandleResult(result);
  });

  async function controlRoute(c: Context, kind: "pause" | "resume" | "cancel"): Promise<Response> {
    const runId = c.req.param("runId");
    if (!runId) return jsonHttpError(badRequest("runId is required"));
    let body: JsonRecord = {};
    try {
      const raw = await c.req.json();
      if (isRecord(raw)) body = raw;
    } catch {
      body = {};
    }
    const expectedRevision = expectedRevisionFrom(c, body);
    if (expectedRevision === undefined) {
      return jsonHttpError(badRequest("expectedRevision or If-Match required"));
    }
    const run = await deps.persistence.getRun(runId);
    if (!run) return jsonHttpError(notFound("run not found"));

    const base = {
      tenantId: tenantIdFrom(c, body, run.tenantId),
      commandId: commandIdFrom(c, `${kind}-${runId}`),
      runId,
      expectedRevision,
      principalId: c.req.header("X-Principal-Id")?.trim(),
    };
    const command =
      kind === "pause"
        ? buildPauseRunCommand(base)
        : kind === "resume"
          ? buildResumeRunCommand(base)
          : buildCancelRunCommand(base);
    return jsonHandleResult(await deps.engine.handle(command));
  }

  app.post("/v1/runs/:runId/pause", (c) => controlRoute(c, "pause"));
  app.post("/v1/runs/:runId/resume", (c) => controlRoute(c, "resume"));
  app.post("/v1/runs/:runId/cancel", (c) => controlRoute(c, "cancel"));

  return app;
}
