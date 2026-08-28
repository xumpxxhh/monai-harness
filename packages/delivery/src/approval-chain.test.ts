import { CONTRACTS_SCHEMA_VERSION } from "@monai/contracts";
import type { HarnessCommand } from "@monai/ports";
import { describe, expect, it } from "vitest";

import { createPackTestFixtures, toRunning as bootToRunning } from "./test-pack-fixtures.js";

function cmd(
  partial: Partial<HarnessCommand> & Pick<HarnessCommand, "commandType" | "commandId">,
): HarnessCommand {
  return {
    schemaVersion: CONTRACTS_SCHEMA_VERSION,
    tenantId: "t1",
    issuedAt: new Date().toISOString(),
    ...partial,
  };
}

describe("P5 waiting states", () => {
  it("synthetic.write_high: require_approval → approve → queued → resume consume+prepared → dispatch", async () => {
    const { persistence, lease, engine, tools, pack, ownerId } = createPackTestFixtures();

    const running = await bootToRunning(engine, cmd, "r-apr", "do synthetic write", ownerId);
    expect(running.ok).toBe(true);
    if (!running.ok) return;

    const turn = await engine.handle(
      cmd({
        commandType: "execute_turn",
        commandId: "turn-wait",
        runId: "r-apr",
        expectedRevision: running.revision,
        leaseEpoch: running.leaseEpoch,
        actor: { principalId: ownerId },
      }),
    );
    expect(turn.ok).toBe(true);
    if (!turn.ok) return;
    expect(turn.run.status).toBe("awaiting_approval");
    expect(await lease.get("r-apr")).toBeUndefined();

    const types = (await persistence.listEvents("r-apr")).map((e) => e.eventType);
    expect(types).toContain("approval.requested");
    expect(types).toContain("checkpoint.saved");
    expect(types).toContain("run.lease_lost");

    const cp = await persistence.getLatestCheckpoint("r-apr");
    expect(cp).toBeDefined();
    expect(cp!.revision).toBe(turn.revision);
    expect(cp!.sequence).toBeGreaterThan(0);
    expect(cp!.stateHash.length).toBeGreaterThan(0);

    const approvals = await persistence.listApprovals("r-apr");
    expect(approvals).toHaveLength(1);
    expect(approvals[0]!.status).toBe("pending");

    const approved = await engine.handle(
      cmd({
        commandType: "approval_decision",
        commandId: "apr-ok",
        runId: "r-apr",
        expectedRevision: turn.revision,
        actor: { principalId: "approver-1" },
        payload: { approvalId: approvals[0]!.approvalId, decision: "approved" },
      }),
    );
    expect(approved.ok).toBe(true);
    if (!approved.ok) return;
    expect(approved.run.status).toBe("queued");
    expect((await persistence.getApproval(approvals[0]!.approvalId))!.status).toBe("approved");

    const leased = await engine.handle(
      cmd({
        commandType: "acquire_lease",
        commandId: "lease-2",
        runId: "r-apr",
        expectedRevision: approved.revision,
        actor: { principalId: ownerId },
      }),
    );
    expect(leased.ok).toBe(true);
    if (!leased.ok) return;
    expect(leased.run.status).toBe("running");

    const resume = await engine.handle(
      cmd({
        commandType: "execute_turn",
        commandId: "turn-resume",
        runId: "r-apr",
        expectedRevision: leased.revision,
        leaseEpoch: leased.leaseEpoch,
        actor: { principalId: ownerId },
      }),
    );
    expect(resume.ok).toBe(true);
    if (!resume.ok) return;
    expect((await persistence.listEvents("r-apr")).map((e) => e.eventType)).toContain(
      "approval.consumed",
    );
    expect((await persistence.listEvents("r-apr")).map((e) => e.eventType)).toContain(
      "tool.call_prepared",
    );
    expect((await persistence.getApproval(approvals[0]!.approvalId))!.status).toBe("consumed");
    expect(await persistence.getContinuation("r-apr")).toBeUndefined();

    expect(await tools.tick()).toBeGreaterThan(0);
    const finalTypes = (await persistence.listEvents("r-apr")).map((e) => e.eventType);
    expect(finalTypes).toContain("tool.succeeded");
    expect(finalTypes).toContain("fact.accepted");
    expect(pack.synthetic.effectCount("synthetic://demo/resource")).toBe(1);
  });

  it("approval rejected → failed (not cancelled)", async () => {
    const { persistence, engine, ownerId } = createPackTestFixtures();

    const running = await bootToRunning(engine, cmd, "r-rej", "do synthetic write", ownerId);
    expect(running.ok).toBe(true);
    if (!running.ok) return;

    const turn = await engine.handle(
      cmd({
        commandType: "execute_turn",
        commandId: "turn-rej",
        runId: "r-rej",
        expectedRevision: running.revision,
        leaseEpoch: running.leaseEpoch,
        actor: { principalId: ownerId },
      }),
    );
    expect(turn.ok).toBe(true);
    if (!turn.ok) return;
    expect(turn.run.status).toBe("awaiting_approval");

    const approval = (await persistence.listApprovals("r-rej"))[0]!;
    const rejected = await engine.handle(
      cmd({
        commandType: "approval_decision",
        commandId: "apr-rej",
        runId: "r-rej",
        expectedRevision: turn.revision,
        actor: { principalId: "approver-1" },
        payload: { approvalId: approval.approvalId, decision: "rejected", reason: "nope" },
      }),
    );
    expect(rejected.ok).toBe(true);
    if (!rejected.ok) return;
    expect(rejected.run.status).toBe("failed");
    expect((await persistence.listEvents("r-rej")).map((e) => e.eventType)).toContain(
      "approval.rejected",
    );
  });

  it("ask_user → awaiting_input → submit_input → queued → resume fact", async () => {
    const { persistence, engine, ownerId } = createPackTestFixtures();

    const running = await bootToRunning(engine, cmd, "r-ask", "please ask-user now", ownerId);
    expect(running.ok).toBe(true);
    if (!running.ok) return;

    const turn = await engine.handle(
      cmd({
        commandType: "execute_turn",
        commandId: "turn-ask",
        runId: "r-ask",
        expectedRevision: running.revision,
        leaseEpoch: running.leaseEpoch,
        actor: { principalId: ownerId },
      }),
    );
    expect(turn.ok).toBe(true);
    if (!turn.ok) return;
    expect(turn.run.status).toBe("awaiting_input");
    expect((await persistence.getContinuation("r-ask"))?.kind).toBe("input");

    const submitted = await engine.handle(
      cmd({
        commandType: "submit_input",
        commandId: "input-1",
        runId: "r-ask",
        expectedRevision: turn.revision,
        actor: { principalId: "user-1" },
        payload: { inputId: "in-1", value: "confirmed" },
      }),
    );
    expect(submitted.ok).toBe(true);
    if (!submitted.ok) return;
    expect(submitted.run.status).toBe("queued");

    const leased = await engine.handle(
      cmd({
        commandType: "acquire_lease",
        commandId: "lease-ask-2",
        runId: "r-ask",
        expectedRevision: submitted.revision,
        actor: { principalId: ownerId },
      }),
    );
    expect(leased.ok).toBe(true);
    if (!leased.ok) return;

    const resume = await engine.handle(
      cmd({
        commandType: "execute_turn",
        commandId: "turn-ask-resume",
        runId: "r-ask",
        expectedRevision: leased.revision,
        leaseEpoch: leased.leaseEpoch,
        actor: { principalId: ownerId },
      }),
    );
    expect(resume.ok).toBe(true);
    if (!resume.ok) return;
    const types = (await persistence.listEvents("r-ask")).map((e) => e.eventType);
    expect(types).toContain("observation.recorded");
    expect(types).toContain("fact.accepted");
    expect(types).toContain("step.completed");
    expect((await persistence.getState("r-ask"))?.facts[0]?.summary).toContain("confirmed");
  });
});
