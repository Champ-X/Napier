import type {
  CreateReceiptTrustAnchorRequest,
  CreateReceiptTrustAnchorDirectorySubscriptionRequest,
  CreateReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionRequest,
  DiscoverReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRequest,
  DiscoverReceiptTrustAnchorDirectoryRequest,
  EvaluateReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumRequest,
  EvaluateReceiptTrustAnchorDirectoryQuorumRequest,
  EvaluationQualificationBaseline,
  ApplyReceiptTrustAnchorDirectoryQuorumActivationSelectionRequest,
  ApplyReceiptTrustAnchorDirectoryQuorumActivationSelectionResult,
  ImportReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselineRequest,
  ImportReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselineResult,
  ImportReceiptTrustAnchorDirectoryQuorumPromotionBaselineRequest,
  ImportReceiptTrustAnchorDirectoryQuorumPromotionBaselineResult,
  ProposeReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationRequest,
  PromoteEvaluationQualificationBaselineResult,
  PromoteReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselineRequest,
  PromoteReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselineResult,
  PromoteReceiptTrustAnchorDirectoryQuorumBaselineRequest,
  PromoteReceiptTrustAnchorDirectoryQuorumBaselineResult,
  PromoteReceiptTrustAnchorDirectoryQuorumRequest,
  ReceiptTrustAnchor,
  ReceiptTrustAnchorDirectory,
  ReceiptTrustAnchorDirectoryDiscovery,
  ReceiptTrustAnchorDirectoryMetadataVerification,
  ReceiptTrustAnchorDirectoryQuorum,
  ReceiptTrustAnchorDirectoryQuorumActivationDecisionHistory,
  ReceiptTrustAnchorDirectoryQuorumActivationDecisionHistoryVerification,
  ReceiptTrustAnchorDirectoryQuorumActivationSelectionDriftAudit,
  ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposal,
  ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationReview,
  ReceiptTrustAnchorDirectoryQuorumActivationSelectionState,
  ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpoint,
  ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointDiscovery,
  ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorum,
  ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaseline,
  ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselineVerification,
  ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription,
  ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionRefreshResult,
  ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointVerification,
  ReceiptTrustAnchorDirectoryQuorumPromotionBaseline,
  ReceiptTrustAnchorDirectoryQuorumPromotionBaselineVerification,
  ReceiptTrustAnchorDirectoryQuorumPromotionReceipt,
  ReceiptTrustAnchorDirectorySubscription,
  ReceiptTrustAnchorDirectorySubscriptionRefreshResult,
  ReceiptTrustAnchorDirectoryVerification,
  ReceiptTrustAnchorDirectoryVerificationPolicy,
  SignReceiptTrustAnchorDirectoryQuorumActivationDecisionRequest,
  SignReceiptTrustAnchorDirectoryQuorumActivationDecisionResult,
  SignReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalRequest,
  SignReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRequest,
  SignReceiptTrustAnchorDirectoryMetadataRequest,
  ReviewReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationRequest,
  TrustedReceiptEnvelope,
  TrustedReceiptVerification,
  VerifyReceiptTrustAnchorDirectoryMetadataRequest,
  VerifyReceiptTrustAnchorDirectoryQuorumActivationDecisionHistoryRequest,
  VerifyReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRequest,
  VerifyReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselineRequest,
  VerifyReceiptTrustAnchorDirectoryQuorumPromotionBaselineRequest,
  VerifyReceiptTrustAnchorDirectoryRequest,
  UpdateReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionRequest,
  UpdateReceiptTrustAnchorDirectorySubscriptionRequest,
} from "@napier/contracts";

import { requestJson as requestTrustJson } from "./api-client";

export function listReceiptTrustAnchors(): Promise<ReceiptTrustAnchor[]> {
  return requestTrustJson("/api/receipt-trust/anchors");
}

export function getReceiptTrustAnchorDirectory(): Promise<ReceiptTrustAnchorDirectory> {
  return requestTrustJson("/api/receipt-trust/anchors/directory");
}

export function verifyReceiptTrustAnchorDirectory(
  body: VerifyReceiptTrustAnchorDirectoryRequest,
): Promise<ReceiptTrustAnchorDirectoryVerification> {
  return requestTrustJson("/api/receipt-trust/anchors/directory/verify", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function getSignedReceiptTrustAnchorDirectoryMetadata(
  body: SignReceiptTrustAnchorDirectoryMetadataRequest,
): Promise<TrustedReceiptEnvelope> {
  return requestTrustJson(
    "/api/receipt-trust/anchors/directory/signed-metadata",
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
}

export function verifyReceiptTrustAnchorDirectoryMetadata(
  body: VerifyReceiptTrustAnchorDirectoryMetadataRequest,
): Promise<ReceiptTrustAnchorDirectoryMetadataVerification> {
  return requestTrustJson(
    "/api/receipt-trust/anchors/directory/metadata/verify",
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
}

export function discoverReceiptTrustAnchorDirectory(
  body: DiscoverReceiptTrustAnchorDirectoryRequest,
): Promise<ReceiptTrustAnchorDirectoryDiscovery> {
  return requestTrustJson("/api/receipt-trust/anchors/directory/discover", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function listReceiptTrustAnchorDirectorySubscriptions(): Promise<
  ReceiptTrustAnchorDirectorySubscription[]
> {
  return requestTrustJson("/api/receipt-trust/anchors/directory/subscriptions");
}

export function evaluateReceiptTrustAnchorDirectoryQuorum(
  body: EvaluateReceiptTrustAnchorDirectoryQuorumRequest = {},
): Promise<ReceiptTrustAnchorDirectoryQuorum> {
  return requestTrustJson(
    "/api/receipt-trust/anchors/directory/subscriptions/quorum",
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
}

export function promoteReceiptTrustAnchorDirectoryQuorum(
  body: PromoteReceiptTrustAnchorDirectoryQuorumRequest = {},
): Promise<ReceiptTrustAnchorDirectoryQuorumPromotionReceipt> {
  return requestTrustJson(
    "/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion",
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
}

export function listReceiptTrustAnchorDirectoryQuorumPromotionBaselines(): Promise<
  ReceiptTrustAnchorDirectoryQuorumPromotionBaseline[]
> {
  return requestTrustJson(
    "/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines",
  );
}

export function promoteReceiptTrustAnchorDirectoryQuorumBaseline(
  body: PromoteReceiptTrustAnchorDirectoryQuorumBaselineRequest,
): Promise<PromoteReceiptTrustAnchorDirectoryQuorumBaselineResult> {
  return requestTrustJson(
    "/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines",
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
}

export function verifyReceiptTrustAnchorDirectoryQuorumPromotionBaseline(
  body: VerifyReceiptTrustAnchorDirectoryQuorumPromotionBaselineRequest,
): Promise<ReceiptTrustAnchorDirectoryQuorumPromotionBaselineVerification> {
  return requestTrustJson(
    "/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/verify",
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
}

export function importReceiptTrustAnchorDirectoryQuorumPromotionBaseline(
  body: ImportReceiptTrustAnchorDirectoryQuorumPromotionBaselineRequest,
): Promise<ImportReceiptTrustAnchorDirectoryQuorumPromotionBaselineResult> {
  return requestTrustJson(
    "/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/import",
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
}

export function signReceiptTrustAnchorDirectoryQuorumActivationDecision(
  body: SignReceiptTrustAnchorDirectoryQuorumActivationDecisionRequest,
): Promise<SignReceiptTrustAnchorDirectoryQuorumActivationDecisionResult> {
  return requestTrustJson(
    "/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-decision",
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
}

export function getReceiptTrustAnchorDirectoryQuorumActivationDecisionHistory(): Promise<ReceiptTrustAnchorDirectoryQuorumActivationDecisionHistory> {
  return requestTrustJson(
    "/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-decisions",
  );
}

export function verifyReceiptTrustAnchorDirectoryQuorumActivationDecisionHistory(
  body: VerifyReceiptTrustAnchorDirectoryQuorumActivationDecisionHistoryRequest,
): Promise<ReceiptTrustAnchorDirectoryQuorumActivationDecisionHistoryVerification> {
  return requestTrustJson(
    "/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-decisions/verify",
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
}

export function getReceiptTrustAnchorDirectoryQuorumActivationSelectionState(): Promise<ReceiptTrustAnchorDirectoryQuorumActivationSelectionState> {
  return requestTrustJson(
    "/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection",
  );
}

export function getReceiptTrustAnchorDirectoryQuorumActivationSelectionDriftAudit(): Promise<ReceiptTrustAnchorDirectoryQuorumActivationSelectionDriftAudit> {
  return requestTrustJson(
    "/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/drift-audit",
  );
}

export function getReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpoint(): Promise<ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpoint> {
  return requestTrustJson(
    "/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/transparency-checkpoint",
  );
}

export function verifyReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpoint(
  body: VerifyReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRequest,
): Promise<ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointVerification> {
  return requestTrustJson(
    "/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/transparency-checkpoint/verify",
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
}

export function signReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpoint(
  body: SignReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRequest,
): Promise<TrustedReceiptEnvelope<ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpoint>> {
  return requestTrustJson(
    "/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/transparency-checkpoint/sign",
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
}

export function discoverReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpoint(
  body: DiscoverReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRequest,
): Promise<ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointDiscovery> {
  return requestTrustJson(
    "/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/transparency-checkpoint/discover",
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
}

export function listReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptions(): Promise<
  ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription[]
> {
  return requestTrustJson(
    "/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/transparency-checkpoint/subscriptions",
  );
}

export function createReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription(
  body: CreateReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionRequest,
): Promise<ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription> {
  return requestTrustJson(
    "/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/transparency-checkpoint/subscriptions",
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
}

export function refreshReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription(
  subscriptionId: string,
  threadId: string,
  expectedRevision: number,
): Promise<ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionRefreshResult> {
  return requestTrustJson(
    `/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/transparency-checkpoint/subscriptions/${encodeURIComponent(subscriptionId)}/refresh`,
    {
      method: "POST",
      body: JSON.stringify({ threadId, expectedRevision }),
    },
  );
}

export function updateReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription(
  subscriptionId: string,
  body: UpdateReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionRequest,
): Promise<ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription> {
  return requestTrustJson(
    `/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/transparency-checkpoint/subscriptions/${encodeURIComponent(subscriptionId)}`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
}

export function evaluateReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorum(
  body: EvaluateReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumRequest = {},
): Promise<ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorum> {
  return requestTrustJson(
    "/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/transparency-checkpoint/subscriptions/quorum",
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
}

export function listReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselines(): Promise<
  ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaseline[]
> {
  return requestTrustJson(
    "/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/transparency-checkpoint/subscriptions/quorum/baselines",
  );
}

export function promoteReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaseline(
  body: PromoteReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselineRequest,
): Promise<PromoteReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselineResult> {
  return requestTrustJson(
    "/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/transparency-checkpoint/subscriptions/quorum/baselines",
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
}

export function verifyReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaseline(
  body: VerifyReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselineRequest,
): Promise<ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselineVerification> {
  return requestTrustJson(
    "/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/transparency-checkpoint/subscriptions/quorum/baselines/verify",
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
}

export function importReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaseline(
  body: ImportReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselineRequest,
): Promise<ImportReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselineResult> {
  return requestTrustJson(
    "/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/transparency-checkpoint/subscriptions/quorum/baselines/import",
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
}

export function reviewReceiptTrustAnchorDirectoryQuorumActivationSelectionRotation(
  body: ReviewReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationRequest,
): Promise<ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationReview> {
  return requestTrustJson(
    "/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/rotation-review",
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
}

export function proposeReceiptTrustAnchorDirectoryQuorumActivationSelectionRotation(
  body: ProposeReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationRequest,
): Promise<ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposal> {
  return requestTrustJson(
    "/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/rotation-proposal",
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
}

export function signReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposal(
  body: SignReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalRequest,
): Promise<TrustedReceiptEnvelope<ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposal>> {
  return requestTrustJson(
    "/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/rotation-proposal/sign",
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
}

export function applyReceiptTrustAnchorDirectoryQuorumActivationSelection(
  body: ApplyReceiptTrustAnchorDirectoryQuorumActivationSelectionRequest,
): Promise<ApplyReceiptTrustAnchorDirectoryQuorumActivationSelectionResult> {
  return requestTrustJson(
    "/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/apply",
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
}

export function createReceiptTrustAnchorDirectorySubscription(
  body: CreateReceiptTrustAnchorDirectorySubscriptionRequest,
): Promise<ReceiptTrustAnchorDirectorySubscription> {
  return requestTrustJson(
    "/api/receipt-trust/anchors/directory/subscriptions",
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
}

export function refreshReceiptTrustAnchorDirectorySubscription(
  subscriptionId: string,
  threadId: string,
  expectedRevision: number,
): Promise<ReceiptTrustAnchorDirectorySubscriptionRefreshResult> {
  return requestTrustJson(
    `/api/receipt-trust/anchors/directory/subscriptions/${encodeURIComponent(subscriptionId)}/refresh`,
    {
      method: "POST",
      body: JSON.stringify({ threadId, expectedRevision }),
    },
  );
}

export function updateReceiptTrustAnchorDirectorySubscription(
  subscriptionId: string,
  body: UpdateReceiptTrustAnchorDirectorySubscriptionRequest,
): Promise<ReceiptTrustAnchorDirectorySubscription> {
  return requestTrustJson(
    `/api/receipt-trust/anchors/directory/subscriptions/${encodeURIComponent(subscriptionId)}`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
}

export function createReceiptTrustAnchor(
  body: CreateReceiptTrustAnchorRequest,
): Promise<ReceiptTrustAnchor> {
  return requestTrustJson("/api/receipt-trust/anchors", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function revokeReceiptTrustAnchor(
  anchorId: string,
  threadId: string,
): Promise<ReceiptTrustAnchor> {
  return requestTrustJson(
    `/api/receipt-trust/anchors/${encodeURIComponent(anchorId)}/revoke`,
    {
      method: "POST",
      body: JSON.stringify({ threadId }),
    },
  );
}

export function verifyTrustedReceipt(
  envelope: unknown,
  directory?: unknown,
  directoryPolicy?: ReceiptTrustAnchorDirectoryVerificationPolicy,
): Promise<TrustedReceiptVerification> {
  return requestTrustJson("/api/receipt-trust/verify", {
    method: "POST",
    body: JSON.stringify({
      envelope,
      ...(directory !== undefined ? { directory } : {}),
      ...(directoryPolicy !== undefined ? { directoryPolicy } : {}),
    }),
  });
}

export function getSignedEvaluationSuiteReceipt(
  threadId: string,
  suiteId: string,
  trustAnchorId: string,
): Promise<TrustedReceiptEnvelope> {
  return requestTrustJson(
    `/api/threads/${encodeURIComponent(threadId)}/evaluation-suites/${encodeURIComponent(suiteId)}/signed-receipt`,
    {
      method: "POST",
      body: JSON.stringify({ trustAnchorId }),
    },
  );
}

export function getSignedCasebookQualificationReceipt(
  casebookId: string,
  threadId: string,
  trustAnchorId: string,
): Promise<TrustedReceiptEnvelope> {
  return requestTrustJson(
    `/api/evaluation-casebooks/${encodeURIComponent(casebookId)}/signed-qualification-receipt`,
    {
      method: "POST",
      body: JSON.stringify({ threadId, trustAnchorId }),
    },
  );
}

export function listEvaluationQualificationBaselines(
  casebookId: string,
): Promise<EvaluationQualificationBaseline[]> {
  return requestTrustJson(
    `/api/evaluation-casebooks/${encodeURIComponent(casebookId)}/qualification-baselines`,
  );
}

export function promoteEvaluationQualificationBaseline(
  casebookId: string,
  threadId: string,
  trustAnchorId: string,
): Promise<PromoteEvaluationQualificationBaselineResult> {
  return requestTrustJson(
    `/api/evaluation-casebooks/${encodeURIComponent(casebookId)}/qualification-baselines`,
    {
      method: "POST",
      body: JSON.stringify({ threadId, trustAnchorId }),
    },
  );
}
