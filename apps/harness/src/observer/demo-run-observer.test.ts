import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CONTRACTS_SCHEMA_VERSION, type EventEnvelope } from "@monai/contracts";
import { PreviewHub } from "@monai/runtime";
import { describe, expect, it } from "vitest";

import type { HarnessConfig } from "../config/env.js";
import { DemoRunObserver, readCompressionRef } from "./demo-run-observer.js";

function minimalConfig(): HarnessConfig {
  return {
    mode: "demo",
    persistenceDriver: "memory",
    queueDriver: "memory",
    leaseDriver: "memory",
    modelDriver: "stub",
  } as HarnessConfig;
}

function summaryCreatedEvent(
  compressionId: string,
  sequence: number,
): EventEnvelope {
  return {
    schemaVersion: CONTRACTS_SCHEMA_VERSION,
    eventId: `evt-${compressionId}`,
    eventType: "context.summary_created",
    tenantId: "t1",
    sessionId: "s1",
    runId: "r-obs-cmp",
    stepId: `step-${sequence}`,
    occurredAt: new Date().toISOString(),
    producer: { kind: "runtime", id: "test" },
    hash: `hash-${compressionId}`,
    expectedRevision: 1,
    sequence,
    recordedAt: new Date().toISOString(),
    payload: {
      record: {
        compressionId,
        summaryHash: `sh-${compressionId}`,
        summaryText: `Summary body for ${compressionId}`,
        sourceRunIds: ["r-obs-cmp"],
        sourceEventRanges: [{ runId: "r-obs-cmp", fromSequence: 1, toSequence: sequence }],
        createdAt: new Date().toISOString(),
        summarizerModelCallId: `mc-${compressionId}`,
      },
    },
  };
}

describe("readCompressionRef", () => {
  it("reads compressionRef from context", () => {
    expect(readCompressionRef({ context: { compressionRef: "cmp-1" } })).toBe("cmp-1");
    expect(readCompressionRef({ context: {} })).toBeUndefined();
    expect(readCompressionRef({})).toBeUndefined();
  });
});

describe("DemoRunObserver compression archive", () => {
  it("writes one file per context.summary_created under compression/", async () => {
    const archiveDir = mkdtempSync(join(tmpdir(), "monai-obs-cmp-"));
    // Stub listEvents on a thin runtime (avoid full harness bootstrap).
    const events = [
      summaryCreatedEvent("cmp-aaa", 1),
      summaryCreatedEvent("cmp-bbb", 2),
    ];
    let listCalls = 0;
    const runtime = {
      config: minimalConfig(),
      persistence: {
        listEvents: async () => {
          listCalls += 1;
          return events;
        },
        getRun: async () => null,
        listToolCalls: async () => [],
        getState: async () => null,
      },
      previewHub: new PreviewHub(),
    } as never;

    const observer = new DemoRunObserver({
      runId: "r-obs-cmp",
      goal: "test",
      runtime,
      archiveDir,
    });
    await observer.start();
    await observer.syncPersistence("test");

    const files = readdirSync(join(archiveDir, "compression")).sort();
    expect(files).toEqual(["cmp-aaa.json", "cmp-bbb.json"]);

    const a = JSON.parse(readFileSync(join(archiveDir, "compression", "cmp-aaa.json"), "utf8"));
    expect(a.compressionId).toBe("cmp-aaa");
    expect(a.summaryText).toContain("cmp-aaa");
    expect(a.eventType).toBe("context.summary_created");

    await observer.stop();
    expect(listCalls).toBeGreaterThan(0);
  });
});
