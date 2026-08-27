import type { AcceptanceCheck, RunState } from "@monai/contracts";

export type AcceptanceDecision = "pass" | "fail" | "not_applicable";

export type AcceptanceCheckResult = {
  checkId: string;
  validatorId: string;
  version: string;
  inputHash: string;
  decision: AcceptanceDecision;
  required: boolean;
  reason: string;
};

function readJsonPointer(root: unknown, pointer: string): { found: boolean; value: unknown } {
  if (!pointer || pointer === "/") {
    return { found: true, value: root };
  }
  const parts = pointer
    .split("/")
    .slice(1)
    .map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"));
  let current: unknown = root;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== "object") {
      return { found: false, value: undefined };
    }
    if (!(part in (current as object))) {
      return { found: false, value: undefined };
    }
    current = (current as Record<string, unknown>)[part];
  }
  return { found: true, value: current };
}

function selectInput(
  state: RunState,
  selector: AcceptanceCheck["inputSelector"],
): { found: boolean; value: unknown } {
  const pointer = selector.selector ?? selector.ref ?? "";
  if (selector.selectorType === "json_pointer" || selector.selectorType === "state_ref") {
    return readJsonPointer(state, pointer.startsWith("/") ? pointer : `/${pointer}`);
  }
  return { found: false, value: undefined };
}

function runValidator(validatorId: string, input: unknown): AcceptanceDecision {
  switch (validatorId) {
    case "core.finish_gate":
      return "pass";
    case "core.state_last_fact":
      return typeof input === "string" && input.length > 0 ? "pass" : "fail";
    default:
      return "fail";
  }
}

/**
 * Deterministic acceptanceChecks (design 01 §4.1 / 03 §6.3).
 * Pure — no IO. Unknown validators fail closed.
 */
export function evaluateAcceptanceChecks(
  state: RunState,
  checks: readonly AcceptanceCheck[],
): AcceptanceCheckResult[] {
  return checks.map((check) => {
    const selected = selectInput(state, check.inputSelector);
    if (!selected.found) {
      const decision: AcceptanceDecision = check.inputSelector.required
        ? "fail"
        : "not_applicable";
      return {
        checkId: check.checkId,
        validatorId: check.validatorRef.validatorId,
        version: check.validatorRef.version,
        inputHash: `ih:${check.checkId}:missing`,
        decision,
        required: check.required,
        reason: check.inputSelector.required
          ? "required selector input missing"
          : "selector input missing; not_applicable",
      };
    }

    const decision = runValidator(check.validatorRef.validatorId, selected.value);
    return {
      checkId: check.checkId,
      validatorId: check.validatorRef.validatorId,
      version: check.validatorRef.version,
      inputHash: `ih:${check.checkId}:${JSON.stringify(selected.value)}`,
      decision,
      required: check.required,
      reason:
        decision === "pass"
          ? `validator ${check.validatorRef.validatorId} passed`
          : `validator ${check.validatorRef.validatorId} failed`,
    };
  });
}

export function requiredAcceptanceChecksPassed(results: readonly AcceptanceCheckResult[]): boolean {
  return results.every((result) => !result.required || result.decision === "pass");
}
