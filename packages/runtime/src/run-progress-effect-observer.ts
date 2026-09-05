import type { JsonValue, RunEvent } from "@napier/contracts";
import type {
  ToolProgressContribution,
  ToolProgressReceiptV1,
} from "@napier/contracts/tool-protocol";

import { canonicalJson, sha256 } from "./ed25519.js";
import {
  reduceRunEffectReadiness,
  type RunEffectReadinessProjection,
  type RunMarginalProgressEvidenceV1,
} from "./run-effect-readiness-projection.js";
import {
  progressRecord,
  progressText,
  stableStateHash,
  type StableToolProgress,
} from "./run-progress-ledger-projection.js";

export interface RunProgressIdentity {
  resourceKeySha256: string;
  stateSha256: string;
}

export interface DerivedAcceptanceProgress {
  progress: StableToolProgress;
  identity: RunProgressIdentity;
}

export interface RunProgressEffectObservation {
  readiness: RunEffectReadinessProjection;
  handledAsVerification: boolean;
  productSemanticallyAdvanced?: boolean;
  productRegressed: boolean;
  unclassifiedActivityDelta: number;
  derivedAcceptance: DerivedAcceptanceProgress[];
}

export function observeRunProgressEffect(input: {
  event: RunEvent;
  progress: StableToolProgress;
  payload: Record<string, JsonValue> | undefined;
  identity: RunProgressIdentity | undefined;
  objectiveSha256: string;
  readiness: RunEffectReadinessProjection;
}): RunProgressEffectObservation {
  if (toolProgressContribution(input.payload) === "verification") {
    return observeVerificationEffect(input);
  }
  if (input.progress.contribution !== "product" || !input.identity) {
    return unchangedObservation(input.readiness);
  }
  return observeProductEffect({ ...input, identity: input.identity });
}

function observeProductEffect(
  input: Omit<Parameters<typeof observeRunProgressEffect>[0], "identity"> & {
    identity: RunProgressIdentity;
  },
): RunProgressEffectObservation {
  const previous = input.readiness.products[input.identity.resourceKeySha256];
  const advancedBefore = input.readiness.marginalAdvancedCount;
  const regressedBefore = input.readiness.marginalRegressedCount;
  const uncertainBefore = uncertaintyCount(input.readiness);
  const marginalProgress = marginalProgressEvidence(input.payload);
  const readiness = reduceRunEffectReadiness(input.readiness, {
    kind: "tool_progress_receipt",
    observationId: runEventObservationId(input.event),
    objectiveSha256: input.objectiveSha256,
    receipt: readinessReceipt(input.progress, input.identity, "product"),
    ...(marginalProgress ? { marginalProgress } : {}),
  });
  const uncertainStateChange =
    previous !== undefined &&
    previous.currentStateSha256 !== input.identity.stateSha256 &&
    uncertaintyCount(readiness) > uncertainBefore;
  return {
    readiness,
    handledAsVerification: false,
    productSemanticallyAdvanced:
      previous === undefined ||
      readiness.marginalAdvancedCount > advancedBefore,
    productRegressed:
      readinessRank(readiness.deliveryReadiness.status) <
        readinessRank(input.readiness.deliveryReadiness.status) ||
      readiness.marginalRegressedCount > regressedBefore,
    unclassifiedActivityDelta: uncertainStateChange ? 1 : 0,
    derivedAcceptance: [],
  };
}

function observeVerificationEffect(
  input: Parameters<typeof observeRunProgressEffect>[0],
): RunProgressEffectObservation {
  const verdict = verificationVerdict(input.payload, input.progress);
  const evidenceStateSha256 = verificationEvidenceState(
    input.payload,
    input.progress,
    verdict,
  );
  const products = Object.values(input.readiness.products).filter(
    (product) => product.scope === input.progress.scope,
  );
  if (!verdict || !evidenceStateSha256 || products.length === 0) {
    const readiness = reduceRunEffectReadiness(input.readiness, {
      kind: "tool_progress_receipt",
      observationId: runEventObservationId(input.event),
      objectiveSha256: input.objectiveSha256,
      receipt: readinessReceipt(
        input.progress,
        {
          resourceKeySha256:
            input.progress.resourceKeySha256 ?? sha256("unbound-verification"),
          stateSha256: evidenceStateSha256 ?? sha256("missing-evidence"),
        },
        "verification",
      ),
    });
    return verificationObservation(input.readiness, readiness, []);
  }

  let readiness = input.readiness;
  const derivedAcceptance: DerivedAcceptanceProgress[] = [];
  for (const product of products) {
    readiness = reduceRunEffectReadiness(readiness, {
      kind: "tool_progress_receipt",
      observationId: `${runEventObservationId(input.event)}:${product.resourceKeySha256}`,
      objectiveSha256: input.objectiveSha256,
      receipt: readinessReceipt(
        input.progress,
        {
          resourceKeySha256:
            input.progress.resourceKeySha256 ??
            sha256(`verification:${input.progress.scope}`),
          stateSha256: evidenceStateSha256,
        },
        "verification",
      ),
      verification: {
        kind: "napier.run-verification-binding",
        schemaVersion: 1,
        productResourceKeySha256: product.resourceKeySha256,
        productStateSha256: product.currentStateSha256,
        verdict,
      },
    });
    if (verdict === "passed") {
      derivedAcceptance.push(acceptedProductProgress(input.progress, product));
    }
  }
  return verificationObservation(input.readiness, readiness, derivedAcceptance);
}

function acceptedProductProgress(
  progress: StableToolProgress,
  product: RunEffectReadinessProjection["products"][string],
): DerivedAcceptanceProgress {
  const stateSha256 = sha256(
    canonicalJson({
      kind: "verified-product-state",
      productResourceKeySha256: product.resourceKeySha256,
      productStateSha256: product.currentStateSha256,
      verdict: "passed",
    }),
  );
  return {
    progress: {
      ...progress,
      operation: "verify",
      contribution: "acceptance",
      resourceKeySha256: product.resourceKeySha256,
      stateSha256,
    },
    identity: {
      resourceKeySha256: product.resourceKeySha256,
      stateSha256,
    },
  };
}

function verificationObservation(
  previous: RunEffectReadinessProjection,
  readiness: RunEffectReadinessProjection,
  derivedAcceptance: DerivedAcceptanceProgress[],
): RunProgressEffectObservation {
  return {
    readiness,
    handledAsVerification: true,
    productRegressed:
      readinessRank(readiness.deliveryReadiness.status) <
      readinessRank(previous.deliveryReadiness.status),
    unclassifiedActivityDelta: 0,
    derivedAcceptance,
  };
}

function unchangedObservation(
  readiness: RunEffectReadinessProjection,
): RunProgressEffectObservation {
  return {
    readiness,
    handledAsVerification: false,
    productRegressed: false,
    unclassifiedActivityDelta: 0,
    derivedAcceptance: [],
  };
}

function verificationEvidenceState(
  payload: Record<string, JsonValue> | undefined,
  progress: StableToolProgress,
  verdict: "passed" | "failed" | undefined,
): string | undefined {
  return (
    progress.stateSha256 ??
    stableStateHash(payload) ??
    (verdict
      ? sha256(
          canonicalJson({
            kind: "verification-verdict",
            scope: progress.scope,
            verdict,
          }),
        )
      : undefined)
  );
}

function readinessReceipt(
  progress: StableToolProgress,
  identity: RunProgressIdentity,
  contribution: "product" | "verification",
): ToolProgressReceiptV1 {
  return {
    kind: "napier.tool-progress-semantics",
    schemaVersion: 1,
    availability: progress.availability,
    coverage: progress.coverage,
    operation: progress.operation as ToolProgressReceiptV1["operation"],
    scope: progress.scope as ToolProgressReceiptV1["scope"],
    contribution,
    resourceKeySha256: identity.resourceKeySha256,
    stateSha256: identity.stateSha256,
  };
}

function marginalProgressEvidence(
  payload: Record<string, JsonValue> | undefined,
): RunMarginalProgressEvidenceV1 | undefined {
  const protocol = progressRecord(payload?.["toolProtocol"]);
  const progress = progressRecord(protocol?.["progress"]);
  const candidate =
    progressRecord(payload?.["marginalProgress"]) ??
    progressRecord(protocol?.["marginalProgress"]) ??
    progressRecord(progress?.["marginalProgress"]);
  const direction = progressText(candidate?.["direction"]);
  const objectiveSha256 = progressText(candidate?.["objectiveSha256"]);
  const evidenceSha256 = progressText(candidate?.["evidenceSha256"]);
  const fromStateSha256 = progressText(candidate?.["fromStateSha256"]);
  const toStateSha256 = progressText(candidate?.["toStateSha256"]);
  if (
    candidate?.["kind"] !== "napier.run-marginal-progress-evidence" ||
    candidate["schemaVersion"] !== 1 ||
    (direction !== "advanced" &&
      direction !== "regressed" &&
      direction !== "unchanged") ||
    !objectiveSha256 ||
    !evidenceSha256 ||
    !toStateSha256
  ) {
    return undefined;
  }
  return {
    kind: "napier.run-marginal-progress-evidence",
    schemaVersion: 1,
    objectiveSha256,
    direction,
    evidenceSha256,
    ...(fromStateSha256 ? { fromStateSha256 } : {}),
    toStateSha256,
  };
}

function toolProgressContribution(
  payload: Record<string, JsonValue> | undefined,
): ToolProgressContribution | undefined {
  const protocol = progressRecord(payload?.["toolProtocol"]);
  const progress = progressRecord(protocol?.["progress"]);
  const contribution = progressText(progress?.["contribution"]);
  return contribution === "supporting" ||
    contribution === "product" ||
    contribution === "verification" ||
    contribution === "control" ||
    contribution === "neutral"
    ? contribution
    : undefined;
}

function verificationVerdict(
  payload: Record<string, JsonValue> | undefined,
  progress: StableToolProgress,
): "passed" | "failed" | undefined {
  const details = progressRecord(payload?.["details"]);
  const status = progressText(details?.["status"]);
  if (status === "passed" || status === "success") return "passed";
  if (status === "failed" || status === "failure") return "failed";
  return progress.stateSha256 ? "passed" : undefined;
}

function uncertaintyCount(readiness: RunEffectReadinessProjection): number {
  return (
    readiness.indeterminateEffectCount + readiness.invalidMarginalEvidenceCount
  );
}

function readinessRank(
  status: RunEffectReadinessProjection["deliveryReadiness"]["status"],
): number {
  if (status === "ready") return 3;
  if (status === "unverified" || status === "no_product") return 2;
  if (status === "stale") return 1;
  return 0;
}

function runEventObservationId(event: Pick<RunEvent, "seq" | "type">): string {
  return `run-event:${String(event.seq)}:${event.type}`;
}
