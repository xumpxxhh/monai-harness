import {
  createEmptyRunState,
  type FactEnvelope,
  type Observation,
  type RunState,
} from "@monai/contracts";

export type FactValidationResult =
  | { accepted: true; fact: FactEnvelope }
  | { accepted: false; reason: string };

/**
 * P3 minimal Observation → Fact validation (schema + required fields).
 * Full Validator/Policy chain expands in later phases.
 */
export function validateObservationToFact(
  observation: Observation,
  opts: { authorizationDecisionRef: string; factType?: string },
): FactValidationResult {
  if (observation.data === undefined && observation.dataRef === undefined) {
    return { accepted: false, reason: "observation missing data and dataRef" };
  }
  if (observation.data !== undefined && observation.dataRef !== undefined) {
    return { accepted: false, reason: "observation must not carry both data and dataRef" };
  }

  const factType = opts.factType ?? `${observation.source.kind}.result`;
  const fact: FactEnvelope = {
    schemaVersion: observation.schemaVersion,
    factId: `fact-${observation.observationId}`,
    factType,
    tenantId: observation.tenantId,
    sessionId: observation.sessionId,
    runId: observation.runId,
    stepId: observation.stepId,
    observationIds: [observation.observationId],
    subjectRefs: [],
    acceptedAt: new Date().toISOString(),
    validators: [
      {
        validatorId: "observation.basic",
        version: "0.1.0",
        inputHash: observation.hash,
        decision: "pass",
      },
    ],
    authorizationDecisionRef: opts.authorizationDecisionRef,
    businessRuleRefs: [],
    data: observation.data,
    dataRef: observation.dataRef,
    hash: `fact-hash-${observation.hash}`,
  };

  return { accepted: true, fact };
}

/**
 * Deterministic Reducer: nextState = reduce(previousState, FactEnvelope).
 * Pure — no IO.
 */
export function reduce(previous: RunState | undefined, fact: FactEnvelope): RunState {
  const base = previous ?? createEmptyRunState();
  const summary =
    typeof fact.data === "object" && fact.data !== null && "summary" in fact.data
      ? String((fact.data as { summary: unknown }).summary)
      : fact.factType;

  return {
    schemaVersion: base.schemaVersion,
    facts: [
      ...base.facts,
      {
        factId: fact.factId,
        factType: fact.factType,
        summary,
        data: fact.data,
      },
    ],
    lastFactId: fact.factId,
    cursor: {
      stepCount: base.cursor.stepCount + 1,
    },
  };
}
