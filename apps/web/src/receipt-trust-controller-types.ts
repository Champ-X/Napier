import type {
  CreateReceiptTrustAnchorSource,
  ImportReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselineResult,
  ImportReceiptTrustAnchorDirectoryQuorumPromotionBaselineResult,
  ReceiptTrustAnchor,
  ReceiptTrustAnchorDirectory,
  ReceiptTrustAnchorDirectoryDiscovery,
  ReceiptTrustAnchorDirectoryMetadataVerification,
  ReceiptTrustAnchorDirectoryQuorum,
  ReceiptTrustAnchorDirectoryQuorumActivationDecisionHistory,
  ReceiptTrustAnchorDirectoryQuorumActivationDecisionHistoryVerification,
  ReceiptTrustAnchorDirectoryQuorumActivationSelectionDriftAudit,
  ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposal,
  ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalPreflight,
  ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationReview,
  ReceiptTrustAnchorDirectoryQuorumActivationSelectionState,
  ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpoint,
  ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointDiscovery,
  ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorum,
  ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaseline,
  ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselineVerification,
  ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription,
  ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointVerification,
  ReceiptTrustAnchorDirectoryQuorumPromotionBaseline,
  ReceiptTrustAnchorDirectoryQuorumPromotionBaselineVerification,
  ReceiptTrustAnchorDirectorySubscription,
  ReceiptTrustAnchorDirectoryVerification,
  ReceiptTrustAnchorDirectoryVerificationPolicy,
  SignReceiptTrustAnchorDirectoryQuorumActivationDecisionResult,
  TrustedReceiptEnvelope,
  TrustedReceiptVerification,
} from "@napier/contracts";

export interface ReceiptTrustPanelProps {
  threadId: string;
  anchors: ReceiptTrustAnchor[];
  selectedAnchorId: string;
  onSelect: (anchorId: string) => void;
  onAnchors: (anchors: ReceiptTrustAnchor[]) => void;
}

export interface ReceiptTrustControllerState {
  label: string;
  sourceType: CreateReceiptTrustAnchorSource["type"];
  environmentVariable: string;
  publicKeySpki: string;
  pendingRevokeId: string | undefined;
  verification: TrustedReceiptVerification | undefined;
  directoryVerification: ReceiptTrustAnchorDirectoryVerification | undefined;
  directoryDiscovery: ReceiptTrustAnchorDirectoryDiscovery | undefined;
  directoryMetadataVerification:
    | ReceiptTrustAnchorDirectoryMetadataVerification
    | undefined;
  directorySourceUrl: string;
  directorySubscriptionLabel: string;
  directorySubscriptions: ReceiptTrustAnchorDirectorySubscription[];
  directoryQuorum: ReceiptTrustAnchorDirectoryQuorum | undefined;
  promotionBaselines: ReceiptTrustAnchorDirectoryQuorumPromotionBaseline[];
  baselineVerification:
    | ReceiptTrustAnchorDirectoryQuorumPromotionBaselineVerification
    | undefined;
  baselineImportResult:
    | ImportReceiptTrustAnchorDirectoryQuorumPromotionBaselineResult
    | undefined;
  baselineActivationDecision:
    | SignReceiptTrustAnchorDirectoryQuorumActivationDecisionResult
    | undefined;
  baselineActivationHistory:
    | ReceiptTrustAnchorDirectoryQuorumActivationDecisionHistory
    | undefined;
  baselineActivationHistoryVerification:
    | ReceiptTrustAnchorDirectoryQuorumActivationDecisionHistoryVerification
    | undefined;
  baselineActivationSelectionState:
    | ReceiptTrustAnchorDirectoryQuorumActivationSelectionState
    | undefined;
  baselineActivationSelectionDriftAudit:
    | ReceiptTrustAnchorDirectoryQuorumActivationSelectionDriftAudit
    | undefined;
  baselineActivationRotationReview:
    | ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationReview
    | undefined;
  baselineActivationRotationProposal:
    | ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposal
    | undefined;
  baselineActivationRotationProposalEnvelope:
    | TrustedReceiptEnvelope<ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposal>
    | undefined;
  baselineActivationRotationProposalPreflight:
    | ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalPreflight
    | undefined;
  baselineActivationSelectionCheckpoint:
    | ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpoint
    | undefined;
  baselineActivationSelectionCheckpointVerification:
    | ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointVerification
    | undefined;
  baselineActivationSelectionCheckpointEnvelope:
    | TrustedReceiptEnvelope<ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpoint>
    | undefined;
  baselineActivationSelectionCheckpointDiscovery:
    | ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointDiscovery
    | undefined;
  checkpointRegistryQuorum:
    | ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorum
    | undefined;
  checkpointRegistryQuorumBaseline:
    | ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaseline
    | undefined;
  checkpointRegistryQuorumBaselineVerification:
    | ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselineVerification
    | undefined;
  checkpointRegistryQuorumBaselineImportResult:
    | ImportReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselineResult
    | undefined;
  checkpointSubscriptions: ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription[];
  expectedAnchorSetSha256: string;
  checkpointSourceUrl: string;
  checkpointSubscriptionLabel: string;
  expectedCheckpointSha256: string;
  externalDirectory: ReceiptTrustAnchorDirectory | undefined;
  externalDirectoryPolicy:
    | ReceiptTrustAnchorDirectoryVerificationPolicy
    | undefined;
  externalDirectorySubscriptionId: string | undefined;
}

export const initialReceiptTrustControllerState: ReceiptTrustControllerState = {
  label: "",
  sourceType: "environment",
  environmentVariable: "",
  publicKeySpki: "",
  pendingRevokeId: undefined,
  verification: undefined,
  directoryVerification: undefined,
  directoryDiscovery: undefined,
  directoryMetadataVerification: undefined,
  directorySourceUrl: "",
  directorySubscriptionLabel: "",
  directorySubscriptions: [],
  directoryQuorum: undefined,
  promotionBaselines: [],
  baselineVerification: undefined,
  baselineImportResult: undefined,
  baselineActivationDecision: undefined,
  baselineActivationHistory: undefined,
  baselineActivationHistoryVerification: undefined,
  baselineActivationSelectionState: undefined,
  baselineActivationSelectionDriftAudit: undefined,
  baselineActivationRotationReview: undefined,
  baselineActivationRotationProposal: undefined,
  baselineActivationRotationProposalEnvelope: undefined,
  baselineActivationRotationProposalPreflight: undefined,
  baselineActivationSelectionCheckpoint: undefined,
  baselineActivationSelectionCheckpointVerification: undefined,
  baselineActivationSelectionCheckpointEnvelope: undefined,
  baselineActivationSelectionCheckpointDiscovery: undefined,
  checkpointRegistryQuorum: undefined,
  checkpointRegistryQuorumBaseline: undefined,
  checkpointRegistryQuorumBaselineVerification: undefined,
  checkpointRegistryQuorumBaselineImportResult: undefined,
  checkpointSubscriptions: [],
  expectedAnchorSetSha256: "",
  checkpointSourceUrl: "",
  checkpointSubscriptionLabel: "",
  expectedCheckpointSha256: "",
  externalDirectory: undefined,
  externalDirectoryPolicy: undefined,
  externalDirectorySubscriptionId: undefined,
};
