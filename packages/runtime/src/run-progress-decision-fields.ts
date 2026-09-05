import type { JsonObject } from "@napier/contracts";

import type {
  RunConvergencePolicy,
  RunConvergenceSnapshot,
} from "./run-convergence-policy.js";
import {
  fail,
  hash,
  nonNegativeInteger,
} from "./run-progress-payload-primitives.js";
import type {
  ValidatedRunProgressDecisionKind,
  ValidatedRunProgressVector,
} from "./run-progress-payload-types.js";

type CurrentDecisionKind = Exclude<
  ValidatedRunProgressDecisionKind,
  "legacy_action_first"
>;
const CONVERGENCE_REASONS = new Set([
  "support_phase",
  "marginal_yield",
  "failure_pressure",
  "elapsed",
]);

export function validateCurrentDecisionFields(
  kind: CurrentDecisionKind,
  value: JsonObject,
  vector: ValidatedRunProgressVector,
  policy: Readonly<RunConvergencePolicy>,
  eventSeq: number,
): void {
  validateScalarFields(kind, value, eventSeq);
  const decisionTurn =
    kind === "convergence_activate"
      ? value["acknowledgedByTurn"]
      : value["turnIndex"];
  if (decisionTurn !== vector.turnIndex) {
    fail(
      "vector_binding",
      "Run progress decision turn disagrees with its vector",
      eventSeq,
    );
  }
  switch (kind) {
    case "convergence_request":
      return validateConvergenceRequest(value, vector, eventSeq);
    case "convergence_activate":
      return validateConvergenceActivation(value, eventSeq);
    case "convergence_reopen":
      return validateConvergenceReopen(value, vector, eventSeq);
    case "no_progress_request":
      return validateNoProgressRequest(value, vector, policy, eventSeq);
    default:
      return validateNoProgressOutcome(kind, value, eventSeq);
  }
}

function validateScalarFields(
  kind: CurrentDecisionKind,
  value: JsonObject,
  eventSeq: number,
): void {
  for (const key of currentDecisionRequiredKeys(kind).filter(
    (key) =>
      key.endsWith("Count") ||
      key.endsWith("Turn") ||
      key === "turnIndex" ||
      key === "elapsedMs" ||
      key.endsWith("ElapsedMs") ||
      key.endsWith("ThroughTurn") ||
      key.endsWith("Baseline"),
  ))
    nonNegativeInteger(value[key], key, eventSeq);
  for (const key of [
    "acquisitionAttemptCountSinceProgress",
    "acquisitionAdvanceCountSinceProgress",
    "acquisitionAttemptCountSinceCheckpoint",
    "acquisitionAdvanceCountSinceCheckpoint",
    "failureDomainCountSinceCheckpoint",
  ])
    if (Object.hasOwn(value, key))
      nonNegativeInteger(value[key], key, eventSeq);
  for (const key of currentDecisionRequiredKeys(kind).filter((key) =>
    key.endsWith("Sha256"),
  )) {
    hash(value[key], key, eventSeq);
  }
}

function validateConvergenceRequest(
  value: JsonObject,
  vector: ValidatedRunProgressVector,
  eventSeq: number,
): void {
  if (
    value["kind"] !== "napier.run-convergence" ||
    value["status"] !== "requested" ||
    !CONVERGENCE_REASONS.has(String(value["reason"])) ||
    !decisionFieldsMatchVector(value, vector, [
      ["turnIndex", "turnIndex"],
      ["elapsedMs", "elapsedMs"],
      ["acquisitionOnlyTurnCount", "acquisitionOnlyTurnCount"],
      ["acquisitionStagnantTurnCount", "acquisitionStagnantTurnCount"],
      ["supportCount", "supportCount"],
      ["acquisitionAttemptCount", "acquisitionAttemptCount"],
      [
        "acquisitionAttemptCountSinceProgress",
        "acquisitionAttemptCountSinceProgress",
      ],
      [
        "acquisitionAdvanceCountSinceProgress",
        "acquisitionAdvanceCountSinceProgress",
      ],
      ["productCount", "productCount"],
      ["acceptanceCount", "acceptanceCount"],
      ["failureDomainCount", "failureDomainCount"],
    ]) ||
    Number(value["acquisitionAdvanceCountSinceCheckpoint"]) >
      Number(value["acquisitionAttemptCountSinceCheckpoint"])
  )
    fail(
      "payload_shape",
      "Convergence request fields are inconsistent",
      eventSeq,
    );
}

function validateConvergenceActivation(
  value: JsonObject,
  eventSeq: number,
): void {
  if (
    value["kind"] !== "napier.run-convergence" ||
    value["status"] !== "activated" ||
    value["graceThroughTurn"] !== value["acknowledgedByTurn"]
  ) {
    fail(
      "payload_shape",
      "Convergence activation fields are inconsistent",
      eventSeq,
    );
  }
}

function validateConvergenceReopen(
  value: JsonObject,
  vector: ValidatedRunProgressVector,
  eventSeq: number,
): void {
  if (
    value["kind"] !== "napier.run-convergence" ||
    value["status"] !== "reopened" ||
    value["reason"] !== "product_progress" ||
    (!vector.productProgressed && !vector.acceptanceProgressed)
  ) {
    fail(
      "payload_shape",
      "Convergence reopen fields are inconsistent",
      eventSeq,
    );
  }
}

function validateNoProgressRequest(
  value: JsonObject,
  vector: ValidatedRunProgressVector,
  policy: Readonly<RunConvergencePolicy>,
  eventSeq: number,
): void {
  const turnPressure =
    vector.stagnantTurnCount >= policy.noProgressTurnThreshold;
  const elapsedPressure =
    vector.stagnantElapsedMs >= policy.noProgressElapsedMs;
  if (
    vector.progressed ||
    value["kind"] !== "napier.run-progress-reroute" ||
    value["status"] !== "requested" ||
    value["strategy"] !== "summarize_and_converge" ||
    !["turns", "elapsed"].includes(String(value["reason"])) ||
    value["requestedTurn"] !== vector.turnIndex ||
    value["thresholdTurns"] !== policy.noProgressTurnThreshold ||
    value["thresholdElapsedMs"] !== policy.noProgressElapsedMs ||
    (!turnPressure && !elapsedPressure) ||
    value["reason"] !== (turnPressure ? "turns" : "elapsed") ||
    !decisionFieldsMatchVector(value, vector, [
      ["turnIndex", "turnIndex"],
      ["elapsedMs", "elapsedMs"],
      ["stagnantTurnCount", "stagnantTurnCount"],
      ["stagnantElapsedMs", "stagnantElapsedMs"],
      ["failureDomainBaseline", "failureDomainCountSinceProgress"],
      [
        "unclassifiedActivityBaseline",
        "unclassifiedActivityCountSinceProgress",
      ],
    ])
  )
    fail(
      "payload_shape",
      "No-progress request fields are inconsistent",
      eventSeq,
    );
}

function validateNoProgressOutcome(
  kind: CurrentDecisionKind,
  value: JsonObject,
  eventSeq: number,
): void {
  const expectedStatus =
    kind === "no_progress_resolve"
      ? "resolved"
      : kind === "no_progress_halt"
        ? "halted"
        : kind.replace("no_progress_", "");
  if (
    value["kind"] !== "napier.run-progress-reroute" ||
    value["status"] !== expectedStatus
  ) {
    fail(
      "payload_shape",
      "No-progress outcome fields are inconsistent",
      eventSeq,
    );
  }
}

function decisionFieldsMatchVector(
  value: JsonObject,
  vector: ValidatedRunProgressVector,
  pairs: readonly (readonly [string, keyof RunConvergenceSnapshot])[],
): boolean {
  return pairs.every(
    ([decisionField, vectorField]) =>
      value[decisionField] === vector[vectorField],
  );
}

export function currentDecisionRequiredKeys(
  kind: CurrentDecisionKind,
): readonly string[] {
  const common = [
    "kind",
    "schemaVersion",
    "policyVersion",
    "policySha256",
    "status",
    "decisionId",
    "parentControlEpochId",
  ];
  if (kind === "convergence_request")
    return [
      ...common,
      "reason",
      "turnIndex",
      "elapsedMs",
      "acquisitionOnlyTurnCount",
      "acquisitionStagnantTurnCount",
      "supportCount",
      "acquisitionAttemptCount",
      "acquisitionAttemptCountSinceProgress",
      "acquisitionAdvanceCountSinceProgress",
      "acquisitionAttemptCountSinceCheckpoint",
      "acquisitionAdvanceCountSinceCheckpoint",
      "failureDomainCountSinceCheckpoint",
      "productCount",
      "acceptanceCount",
      "failureDomainCount",
      "progressVectorSha256",
      "instructionSha256",
      "contentSha256",
    ];
  if (kind === "convergence_activate")
    return [
      ...common,
      "parentDirectiveId",
      "acknowledgedByTurn",
      "graceThroughTurn",
      "progressVectorSha256",
      "contentSha256",
    ];
  if (kind === "convergence_reopen")
    return [
      ...common,
      "parentDirectiveId",
      "reason",
      "turnIndex",
      "progressVectorSha256",
      "acquisitionAttemptBaseline",
      "acquisitionAdvanceBaseline",
      "failureDomainBaseline",
      "contentSha256",
    ];
  if (kind === "no_progress_request")
    return [
      ...common,
      "strategy",
      "directiveId",
      "reason",
      "turnIndex",
      "requestedTurn",
      "stagnantTurnCount",
      "elapsedMs",
      "stagnantElapsedMs",
      "thresholdTurns",
      "thresholdElapsedMs",
      "failureDomainBaseline",
      "unclassifiedActivityBaseline",
      "progressVectorSha256",
      "instructionSha256",
      "taskIntentSha256",
      "contentSha256",
    ];
  return [
    ...common,
    "directiveId",
    "requestedTurn",
    "failureDomainBaseline",
    "unclassifiedActivityBaseline",
    "rerouteContentSha256",
    ...(kind === "no_progress_observability_degraded"
      ? ["leaseThroughTurn"]
      : []),
    "turnIndex",
    "progressVectorSha256",
    "contentSha256",
  ];
}
