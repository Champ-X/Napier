import type { ToolProgressReceiptV1 } from "@napier/contracts/tool-protocol";

import { canonicalJson, sha256 } from "./ed25519.js";

const SHA256 = /^[a-f0-9]{64}$/u;

export type RunEffectChange = "initialized" | "changed" | "unchanged";

export type RunMarginalProgress =
  | "advanced"
  | "regressed"
  | "unchanged"
  | "indeterminate"
  | "invalid";

export interface RunMarginalProgressEvidenceV1 {
  kind: "napier.run-marginal-progress-evidence";
  schemaVersion: 1;
  objectiveSha256: string;
  direction: Exclude<RunMarginalProgress, "indeterminate" | "invalid">;
  evidenceSha256: string;
  /** Omit only when the product resource has not previously been observed. */
  fromStateSha256?: string;
  toStateSha256: string;
}

export interface RunVerificationBindingV1 {
  kind: "napier.run-verification-binding";
  schemaVersion: 1;
  productResourceKeySha256: string;
  productStateSha256: string;
  verdict: "passed" | "failed";
}

export interface RunReadinessToolObservation {
  kind: "tool_progress_receipt";
  observationId: string;
  /** Trusted Run objective binding supplied by the host, not by the tool. */
  objectiveSha256: string;
  receipt: ToolProgressReceiptV1;
  /** Product effects are delivery requirements unless explicitly optional. */
  deliveryRequirement?: "required" | "optional";
  marginalProgress?: RunMarginalProgressEvidenceV1;
  /** Required for a verification receipt to affect delivery readiness. */
  verification?: RunVerificationBindingV1;
}

export interface RunAssistantDeliveryObservation {
  kind: "assistant_delivery";
  observationId: string;
  contentSha256: string;
}

export interface RunDeliveryAcceptanceObservation {
  kind: "delivery_acceptance";
  observationId: string;
  deliveryObservationId: string;
  evidenceSha256: string;
}

export type RunEffectReadinessObservation =
  | RunReadinessToolObservation
  | RunAssistantDeliveryObservation
  | RunDeliveryAcceptanceObservation;

export interface RunProductVerificationProjection {
  observationId: string;
  verdict: "passed" | "failed";
  productStateSha256: string;
  productRevision: number;
  evidenceStateSha256: string;
}

export interface RunProductResourceProjection {
  resourceKeySha256: string;
  scope: ToolProgressReceiptV1["scope"];
  currentStateSha256: string;
  revision: number;
  deliveryRequirement: "required" | "optional";
  effectCount: number;
  changedEffectCount: number;
  latestEffect: RunEffectChange;
  latestMarginalProgress: RunMarginalProgress;
  latestMarginalEvidenceSha256?: string;
  verification?: RunProductVerificationProjection;
}

export type RunDeliveryBlockerReason =
  | "unverified_product"
  | "stale_verification"
  | "verification_failed";

export interface RunDeliveryReadinessBlocker {
  resourceKeySha256: string;
  reason: RunDeliveryBlockerReason;
}

export interface RunDeliveryReadinessProjection {
  status:
    | "no_product"
    | "unverified"
    | "stale"
    | "verification_failed"
    | "ready";
  productStateSetSha256: string;
  blockers: RunDeliveryReadinessBlocker[];
}

export interface RunDeliveryAttemptProjection {
  observationId: string;
  contentSha256: string;
  productStateSetSha256: string;
  readinessAtAttempt: RunDeliveryReadinessProjection["status"];
  accepted: boolean;
  acceptanceEvidenceSha256?: string;
}

export interface RunEffectReadinessProjection {
  kind: "napier.run-effect-readiness-projection";
  schemaVersion: 1;
  processedObservationIds: string[];
  products: Record<string, RunProductResourceProjection>;
  effectCount: number;
  marginalAdvancedCount: number;
  marginalRegressedCount: number;
  indeterminateEffectCount: number;
  invalidMarginalEvidenceCount: number;
  unboundVerificationCount: number;
  deliveryReadiness: RunDeliveryReadinessProjection;
  deliveryAttempts: RunDeliveryAttemptProjection[];
  explicitAcceptanceCount: number;
}

/**
 * A compact, replay-safe projection that deliberately keeps three concerns
 * separate:
 *
 * 1. Effect: a resource acquired a different stable state.
 * 2. Marginal progress: goal-bound evidence proves whether that transition
 *    moved toward the objective.
 * 3. Delivery readiness: every required product's current revision has a
 *    passing verification bound to that exact revision.
 *
 * In particular, a new state hash is never treated as progress by itself.
 */
export function projectRunEffectReadiness(
  observations: readonly RunEffectReadinessObservation[],
): RunEffectReadinessProjection {
  return observations.reduce(
    (state, observation) => reduceRunEffectReadiness(state, observation),
    emptyRunEffectReadinessProjection(),
  );
}

export function emptyRunEffectReadinessProjection(): RunEffectReadinessProjection {
  return {
    kind: "napier.run-effect-readiness-projection",
    schemaVersion: 1,
    processedObservationIds: [],
    products: {},
    effectCount: 0,
    marginalAdvancedCount: 0,
    marginalRegressedCount: 0,
    indeterminateEffectCount: 0,
    invalidMarginalEvidenceCount: 0,
    unboundVerificationCount: 0,
    deliveryReadiness: readiness({}),
    deliveryAttempts: [],
    explicitAcceptanceCount: 0,
  };
}

export function reduceRunEffectReadiness(
  current: RunEffectReadinessProjection,
  observation: RunEffectReadinessObservation,
): RunEffectReadinessProjection {
  if (current.processedObservationIds.includes(observation.observationId)) {
    return current;
  }
  const state = cloneProjection(current);
  state.processedObservationIds.push(observation.observationId);
  if (observation.kind === "assistant_delivery") {
    recordDeliveryAttempt(state, observation);
    return state;
  }
  if (observation.kind === "delivery_acceptance") {
    recordExplicitAcceptance(state, observation);
    return state;
  }
  recordToolEffect(state, observation);
  state.deliveryReadiness = readiness(state.products);
  return state;
}

function recordToolEffect(
  state: RunEffectReadinessProjection,
  observation: RunReadinessToolObservation,
): void {
  const { receipt } = observation;
  if (receipt.contribution === "product") {
    recordProductEffect(state, observation);
  }
  if (receipt.contribution === "verification") {
    recordVerification(state, observation);
  }
}

function recordProductEffect(
  state: RunEffectReadinessProjection,
  observation: RunReadinessToolObservation,
): void {
  const { receipt } = observation;
  if (!hash(receipt.resourceKeySha256) || !hash(receipt.stateSha256)) return;
  const resourceKeySha256 = receipt.resourceKeySha256!;
  const stateSha256 = receipt.stateSha256!;
  const previous = state.products[resourceKeySha256];
  const effect: RunEffectChange = !previous
    ? "initialized"
    : previous.currentStateSha256 === stateSha256
      ? "unchanged"
      : "changed";
  const marginal = marginalProgress(
    previous?.currentStateSha256,
    stateSha256,
    effect,
    observation.objectiveSha256,
    observation.marginalProgress,
  );
  const revision = previous
    ? previous.revision + (effect === "changed" ? 1 : 0)
    : 1;
  state.products[resourceKeySha256] = {
    resourceKeySha256,
    scope: receipt.scope,
    currentStateSha256: stateSha256,
    revision,
    deliveryRequirement:
      observation.deliveryRequirement ??
      previous?.deliveryRequirement ??
      "required",
    effectCount: (previous?.effectCount ?? 0) + 1,
    changedEffectCount:
      (previous?.changedEffectCount ?? 0) +
      (effect === "initialized" || effect === "changed" ? 1 : 0),
    latestEffect: effect,
    latestMarginalProgress: marginal,
    ...(observation.marginalProgress &&
    (marginal === "advanced" ||
      marginal === "regressed" ||
      marginal === "unchanged")
      ? {
          latestMarginalEvidenceSha256:
            observation.marginalProgress.evidenceSha256,
        }
      : {}),
    ...(previous?.verification ? { verification: previous.verification } : {}),
  };
  state.effectCount += 1;
  if (marginal === "advanced") state.marginalAdvancedCount += 1;
  if (marginal === "regressed") state.marginalRegressedCount += 1;
  if (marginal === "indeterminate") state.indeterminateEffectCount += 1;
  if (marginal === "invalid") state.invalidMarginalEvidenceCount += 1;
}

function recordVerification(
  state: RunEffectReadinessProjection,
  observation: RunReadinessToolObservation,
): void {
  const { receipt, verification } = observation;
  const product = verification
    ? state.products[verification.productResourceKeySha256]
    : undefined;
  if (
    receipt.operation !== "verify" ||
    !verification ||
    !product ||
    !hash(receipt.stateSha256) ||
    !hash(verification.productResourceKeySha256) ||
    !hash(verification.productStateSha256) ||
    product.currentStateSha256 !== verification.productStateSha256
  ) {
    state.unboundVerificationCount += 1;
    return;
  }
  product.verification = {
    observationId: observation.observationId,
    verdict: verification.verdict,
    productStateSha256: verification.productStateSha256,
    productRevision: product.revision,
    evidenceStateSha256: receipt.stateSha256!,
  };
}

function recordDeliveryAttempt(
  state: RunEffectReadinessProjection,
  observation: RunAssistantDeliveryObservation,
): void {
  if (!hash(observation.contentSha256)) return;
  state.deliveryAttempts.push({
    observationId: observation.observationId,
    contentSha256: observation.contentSha256,
    productStateSetSha256: state.deliveryReadiness.productStateSetSha256,
    readinessAtAttempt: state.deliveryReadiness.status,
    accepted: false,
  });
}

function recordExplicitAcceptance(
  state: RunEffectReadinessProjection,
  observation: RunDeliveryAcceptanceObservation,
): void {
  if (!hash(observation.evidenceSha256)) return;
  const attempt = state.deliveryAttempts.find(
    (candidate) =>
      candidate.observationId === observation.deliveryObservationId,
  );
  if (!attempt || attempt.accepted) return;
  attempt.accepted = true;
  attempt.acceptanceEvidenceSha256 = observation.evidenceSha256;
  state.explicitAcceptanceCount += 1;
}

function marginalProgress(
  previousStateSha256: string | undefined,
  currentStateSha256: string,
  effect: RunEffectChange,
  expectedObjectiveSha256: string,
  evidence: RunMarginalProgressEvidenceV1 | undefined,
): RunMarginalProgress {
  if (!evidence) return effect === "unchanged" ? "unchanged" : "indeterminate";
  if (
    evidence.kind !== "napier.run-marginal-progress-evidence" ||
    evidence.schemaVersion !== 1 ||
    !hash(expectedObjectiveSha256) ||
    !hash(evidence.objectiveSha256) ||
    evidence.objectiveSha256 !== expectedObjectiveSha256 ||
    !hash(evidence.evidenceSha256) ||
    !hash(evidence.toStateSha256) ||
    evidence.toStateSha256 !== currentStateSha256 ||
    evidence.fromStateSha256 !== previousStateSha256 ||
    (evidence.fromStateSha256 !== undefined &&
      !hash(evidence.fromStateSha256)) ||
    (effect === "unchanged" && evidence.direction !== "unchanged")
  ) {
    return "invalid";
  }
  return evidence.direction;
}

function readiness(
  products: Record<string, RunProductResourceProjection>,
): RunDeliveryReadinessProjection {
  const required = Object.values(products)
    .filter((product) => product.deliveryRequirement === "required")
    .sort((left, right) =>
      left.resourceKeySha256.localeCompare(right.resourceKeySha256),
    );
  const productStateSetSha256 = sha256(
    canonicalJson(
      required.map((product) => ({
        resourceKeySha256: product.resourceKeySha256,
        revision: product.revision,
        stateSha256: product.currentStateSha256,
      })),
    ),
  );
  if (required.length === 0) {
    return { status: "no_product", productStateSetSha256, blockers: [] };
  }
  const blockers = required.flatMap<RunDeliveryReadinessBlocker>((product) => {
    const verification = product.verification;
    if (!verification) {
      return [
        {
          resourceKeySha256: product.resourceKeySha256,
          reason: "unverified_product",
        },
      ];
    }
    if (
      verification.productRevision !== product.revision ||
      verification.productStateSha256 !== product.currentStateSha256
    ) {
      return [
        {
          resourceKeySha256: product.resourceKeySha256,
          reason: "stale_verification",
        },
      ];
    }
    return verification.verdict === "failed"
      ? [
          {
            resourceKeySha256: product.resourceKeySha256,
            reason: "verification_failed" as const,
          },
        ]
      : [];
  });
  const reasons = new Set(blockers.map((blocker) => blocker.reason));
  const status: RunDeliveryReadinessProjection["status"] = reasons.has(
    "verification_failed",
  )
    ? "verification_failed"
    : reasons.has("stale_verification")
      ? "stale"
      : blockers.length > 0
        ? "unverified"
        : "ready";
  return { status, productStateSetSha256, blockers };
}

function cloneProjection(
  value: RunEffectReadinessProjection,
): RunEffectReadinessProjection {
  return {
    ...value,
    processedObservationIds: [...value.processedObservationIds],
    products: Object.fromEntries(
      Object.entries(value.products).map(([key, product]) => [
        key,
        {
          ...product,
          ...(product.verification
            ? { verification: { ...product.verification } }
            : {}),
        },
      ]),
    ),
    deliveryReadiness: {
      ...value.deliveryReadiness,
      blockers: value.deliveryReadiness.blockers.map((blocker) => ({
        ...blocker,
      })),
    },
    deliveryAttempts: value.deliveryAttempts.map((attempt) => ({ ...attempt })),
  };
}

function hash(value: string | undefined): value is string {
  return typeof value === "string" && SHA256.test(value);
}
