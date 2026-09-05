import type { RunEffectReadinessProjection } from "./run-effect-readiness-projection.js";

export interface RunProgressTurnDelta {
  terminalDeliveryObserved: boolean;
  acquisitionAttempted: boolean;
  acquisitionAdvanced: boolean;
  supportAdvanced: boolean;
  productAdvanced: boolean;
  productRegressed: boolean;
  workspaceProductAdvanced: boolean;
  acceptanceAdvanced: boolean;
}

export interface RunProgressEvidenceMetrics {
  acquisitionAttemptCount: number;
  acquisitionAttemptCountSinceProgress: number;
  acquisitionAdvanceCountSinceProgress: number;
  failureDomainCountSinceProgress: number;
  unclassifiedActivityCountSinceProgress: number;
  workspaceMutationCount: number;
  supportResourceCount: number;
  productReceiptCount: number;
  supportCount: number;
  acceptanceReceiptCount: number;
  approvalCount: number;
  capabilityStatusCount: number;
  userResultCount: number;
  effectReadiness: RunEffectReadinessProjection;
  failureFingerprints: ReadonlySet<string>;
  failureDomains: ReadonlySet<string>;
}

export function emptyRunProgressTurnDelta(): RunProgressTurnDelta {
  return {
    terminalDeliveryObserved: false,
    acquisitionAttempted: false,
    acquisitionAdvanced: false,
    supportAdvanced: false,
    productAdvanced: false,
    productRegressed: false,
    workspaceProductAdvanced: false,
    acceptanceAdvanced: false,
  };
}
