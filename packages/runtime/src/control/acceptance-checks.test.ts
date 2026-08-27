import { CONTRACTS_SCHEMA_VERSION, createEmptyRunState, type AcceptanceCheck } from "@monai/contracts";
import { describe, expect, it } from "vitest";

import {
  evaluateAcceptanceChecks,
  requiredAcceptanceChecksPassed,
} from "./acceptance-checks.js";

const finishGate: AcceptanceCheck = {
  checkId: "finish.allowed",
  validatorRef: { validatorId: "core.finish_gate", version: "0.1.0" },
  inputSelector: {
    selectorVersion: "1",
    selectorType: "state_ref",
    selector: "/cursor",
    schemaRef: "schema://run-state-cursor",
    required: false,
  },
  required: true,
};

const factsPresent: AcceptanceCheck = {
  checkId: "facts.present",
  validatorRef: { validatorId: "core.state_last_fact", version: "0.1.0" },
  inputSelector: {
    selectorVersion: "1",
    selectorType: "json_pointer",
    selector: "/lastFactId",
    schemaRef: "schema://run-state-last-fact",
    required: true,
  },
  required: true,
};

describe("evaluateAcceptanceChecks", () => {
  it("finish_gate passes on empty state", () => {
    const results = evaluateAcceptanceChecks(createEmptyRunState(), [finishGate]);
    expect(results).toHaveLength(1);
    expect(results[0]?.decision).toBe("pass");
    expect(requiredAcceptanceChecksPassed(results)).toBe(true);
  });

  it("facts.present fails when lastFactId is missing", () => {
    const results = evaluateAcceptanceChecks(createEmptyRunState(), [factsPresent]);
    expect(results[0]?.decision).toBe("fail");
    expect(requiredAcceptanceChecksPassed(results)).toBe(false);
  });

  it("facts.present passes when lastFactId exists", () => {
    const state = {
      schemaVersion: CONTRACTS_SCHEMA_VERSION,
      facts: [{ factId: "fact-1", factType: "tool.result", summary: "ok" }],
      lastFactId: "fact-1",
      cursor: { stepCount: 1 },
    };
    const results = evaluateAcceptanceChecks(state, [finishGate, factsPresent]);
    expect(results.map((r) => r.decision)).toEqual(["pass", "pass"]);
    expect(requiredAcceptanceChecksPassed(results)).toBe(true);
  });

  it("unknown validator fails closed", () => {
    const check: AcceptanceCheck = {
      ...finishGate,
      checkId: "unknown",
      validatorRef: { validatorId: "not.registered", version: "0.1.0" },
    };
    const results = evaluateAcceptanceChecks(createEmptyRunState(), [check]);
    expect(results[0]?.decision).toBe("fail");
    expect(requiredAcceptanceChecksPassed(results)).toBe(false);
  });
});
