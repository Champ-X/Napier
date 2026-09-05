import type { JsonObject, RunEvent } from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";
import type { RunConvergencePolicy } from "./run-convergence-policy.js";
import {
  currentDecisionRequiredKeys,
  validateCurrentDecisionFields,
} from "./run-progress-decision-fields.js";
import {
  exactKeys,
  fail,
  hash,
  nonNegativeInteger,
  object,
  validateContentHash,
} from "./run-progress-payload-primitives.js";
import type {
  ValidatedRunProgressDecision,
  ValidatedRunProgressDecisionKind,
  ValidatedRunProgressVector,
} from "./run-progress-payload-types.js";

export function upcastLegacyRunProgressDecisionV1(
  event: RunEvent,
  latestVector: ValidatedRunProgressVector,
): ValidatedRunProgressDecision {
  const value = object(event.payload, event.seq);
  if (
    event.type !== "run.progress.rerouted" ||
    value["kind"] !== "napier.run-progress-reroute" ||
    value["schemaVersion"] !== 1 ||
    value["policyVersion"] !== undefined
  ) {
    fail(
      "payload_schema",
      "Decision is not a supported legacy reroute v1",
      event.seq,
    );
  }
  const strategy = value["strategy"];
  const kind =
    strategy === "action_first"
      ? "legacy_action_first"
      : strategy === "summarize_and_converge"
        ? "no_progress_request"
        : fail(
            "payload_schema",
            "Legacy reroute strategy is unsupported",
            event.seq,
          );
  const required = [
    "kind",
    "schemaVersion",
    "strategy",
    "reason",
    "turnIndex",
    ...(kind === "no_progress_request"
      ? ["stagnantTurnCount", "stagnantElapsedMs"]
      : []),
    "elapsedMs",
    "thresholdTurns",
    "thresholdElapsedMs",
    "progressVectorSha256",
    "instructionSha256",
    "taskIntentSha256",
    "contentSha256",
  ];
  exactKeys(value, required, [], event.seq);
  validateContentHash(value, event.seq);
  for (const key of [
    "turnIndex",
    "elapsedMs",
    "thresholdTurns",
    "thresholdElapsedMs",
    ...(kind === "no_progress_request"
      ? ["stagnantTurnCount", "stagnantElapsedMs"]
      : []),
  ]) {
    nonNegativeInteger(value[key], key, event.seq);
  }
  for (const key of [
    "progressVectorSha256",
    "instructionSha256",
    "taskIntentSha256",
    "contentSha256",
  ]) {
    hash(value[key], key, event.seq);
  }
  assertLatestVectorBinding(value, latestVector, event.seq);
  const contentSha256 = String(value["contentSha256"]);
  return {
    sourceGeneration: "legacy_v1",
    kind,
    eventSeq: event.seq,
    decisionId: contentSha256,
    progressVectorSha256: latestVector.contentSha256,
    contentSha256,
    rawPayload: value,
  };
}

export function decodeCurrentRunProgressDecision(
  event: RunEvent,
  value: JsonObject,
  context: {
    latestVector: ValidatedRunProgressVector;
    expectedPolicySha256: string;
    policy: Readonly<RunConvergencePolicy>;
    controlEpochId: string;
    lineageId: string;
  },
): ValidatedRunProgressDecision {
  const kind = currentDecisionKind(event, value);
  exactKeys(value, currentDecisionRequiredKeys(kind), [], event.seq);
  if (value["schemaVersion"] !== 1 || value["policyVersion"] !== 1) {
    fail(
      "payload_schema",
      "Current Run progress decision schema is invalid",
      event.seq,
    );
  }
  validateContentHash(value, event.seq);
  if (value["policySha256"] !== context.expectedPolicySha256) {
    fail(
      "policy_binding",
      "Run progress decision policy hash is not active",
      event.seq,
    );
  }
  if (value["parentControlEpochId"] !== context.controlEpochId) {
    fail(
      "control_epoch_lineage",
      "Run progress decision has a stale control epoch",
      event.seq,
    );
  }
  assertLatestVectorBinding(value, context.latestVector, event.seq);
  const decisionId = hash(value["decisionId"], "decisionId", event.seq);
  const expectedDecisionId = sha256(
    canonicalJson({
      schemaVersion: 1,
      policyVersion: 1,
      policySha256: context.expectedPolicySha256,
      kind,
      progressVectorSha256: context.latestVector.contentSha256,
      lineageId: context.lineageId,
      parentControlEpochId: context.controlEpochId,
    }),
  );
  if (decisionId !== expectedDecisionId) {
    fail(
      "decision_identity",
      "Run progress decisionId is not bound to its inputs",
      event.seq,
    );
  }
  validateCurrentDecisionFields(
    kind,
    value,
    context.latestVector,
    context.policy,
    event.seq,
  );
  return {
    sourceGeneration: "current_v1",
    kind,
    eventSeq: event.seq,
    decisionId,
    progressVectorSha256: context.latestVector.contentSha256,
    parentControlEpochId: context.controlEpochId,
    contentSha256: hash(value["contentSha256"], "contentSha256", event.seq),
    rawPayload: value,
  };
}

export function currentDecisionKind(
  event: RunEvent,
  value: JsonObject,
): Exclude<ValidatedRunProgressDecisionKind, "legacy_action_first"> {
  if (event.type === "run.progress.convergence_requested")
    return "convergence_request";
  if (event.type === "run.progress.convergence_activated")
    return "convergence_activate";
  if (event.type === "run.progress.convergence_reopened")
    return "convergence_reopen";
  if (event.type !== "run.progress.rerouted") {
    return fail(
      "payload_schema",
      "Run progress decision event type is invalid",
      event.seq,
    );
  }
  const status = value["status"];
  if (status === "requested") return "no_progress_request";
  if (status === "resolved") return "no_progress_resolve";
  if (status === "repair") return "no_progress_repair";
  if (status === "observability_degraded")
    return "no_progress_observability_degraded";
  if (status === "halted") return "no_progress_halt";
  return fail(
    "payload_schema",
    `Run progress reroute status is invalid: ${String(status)}`,
    event.seq,
  );
}

function assertLatestVectorBinding(
  value: JsonObject,
  vector: ValidatedRunProgressVector,
  eventSeq: number,
): void {
  if (value["progressVectorSha256"] !== vector.contentSha256) {
    fail(
      "vector_binding",
      "Run progress decision is not bound to the latest vector",
      eventSeq,
    );
  }
}
