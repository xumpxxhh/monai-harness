import { OutboxDispatcher, Scheduler } from "@monai/delivery";
import { InMemoryLease } from "@monai/lease-memory";
import { StubModelPort } from "@monai/model-stub";
import { InMemoryPersistence } from "@monai/persistence-memory";
import { InMemoryQueue } from "@monai/queue-memory";
import { Engine, HookRunner } from "@monai/runtime";
import { describe, expect, it } from "vitest";

import { createHttpApp } from "./create-app.js";

describe("P8c HTTP + SSE", () => {
  it("CreateRun via REST then SSE sees created → queued → lease_acquired", async () => {
    const persistence = new InMemoryPersistence();
    const lease = new InMemoryLease();
    const queue = new InMemoryQueue();
    const engine = new Engine({
      persistence,
      lease,
      model: new StubModelPort(),
      hooks: new HookRunner(),
      requireApprovalTools: [],
    });
    const dispatcher = new OutboxDispatcher({ outbox: persistence, queue });
    const scheduler = new Scheduler({ queue, engine, ownerId: "sched" });
    const app = createHttpApp({
      engine,
      persistence,
      ssePollIntervalMs: 50,
    });

    const createRes = await app.request("/v1/runs", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Idempotency-Key": "idem-http-1",
        "X-Tenant-Id": "t1",
      },
      body: JSON.stringify({
        runId: "run-http-1",
        sessionId: "s1",
        goal: "hello world",
        strategy: { type: "light", version: "1" },
        packVersions: [{ packId: "core", version: "0.1.0" }],
        executionManifestRef: "manifest://http",
      }),
    });
    expect(createRes.status).toBe(200);
    const created = (await createRes.json()) as {
      ok: boolean;
      revision: number;
      run: { status: string };
    };
    expect(created.ok).toBe(true);
    expect(created.run.status).toBe("created");

    await dispatcher.tick();
    await scheduler.tick();

    const getRes = await app.request("/v1/runs/run-http-1");
    expect(getRes.status).toBe(200);
    const got = (await getRes.json()) as { run: { status: string; revision: number } };
    expect(got.run.status).toBe("running");

    const eventsRes = await app.request("/v1/runs/run-http-1/events?fromSequence=1");
    expect(eventsRes.status).toBe(200);
    const polled = (await eventsRes.json()) as { events: Array<{ eventType: string }> };
    const types = polled.events.map((e) => e.eventType);
    expect(types).toEqual(["run.created", "run.queued", "run.lease_acquired"]);

    const streamRes = await app.request("/v1/runs/run-http-1/events/stream?fromSequence=1");
    expect(streamRes.status).toBe(200);
    expect(streamRes.headers.get("content-type")).toMatch(/text\/event-stream/);

    const reader = streamRes.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const seen: string[] = [];
    const deadline = Date.now() + 5_000;
    while (seen.length < 3 && Date.now() < deadline) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      for (const line of buffer.split("\n")) {
        if (line.startsWith("event:")) {
          const name = line.slice("event:".length).trim();
          if (name && !seen.includes(name)) seen.push(name);
        }
      }
    }
    await reader.cancel();
    expect(seen.slice(0, 3)).toEqual(["run.created", "run.queued", "run.lease_acquired"]);
  });

  it("maps conflict category to HTTP 409", async () => {
    const persistence = new InMemoryPersistence();
    const engine = new Engine({
      persistence,
      lease: new InMemoryLease(),
      model: new StubModelPort(),
    });
    const app = createHttpApp({ engine, persistence });

    await app.request("/v1/runs", {
      method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": "c1" },
      body: JSON.stringify({ runId: "run-conflict", goal: "x" }),
    });

    const cancel = await app.request("/v1/runs/run-conflict/cancel", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "If-Match": "0",
      },
      body: JSON.stringify({}),
    });
    expect(cancel.status).toBe(409);
    const body = (await cancel.json()) as { code: string };
    expect(body.code).toBe("conflict");
  });
});
