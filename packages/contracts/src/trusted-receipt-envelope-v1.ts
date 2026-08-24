import type {
  EvaluationCasebookQualificationReceipt,
  EvaluationSuiteGateReceipt,
} from "./evaluation-v1.js";
import type { ExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryProofBundle } from "./execution-plan-portfolio-v1.js";
import type {
  ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpoint,
  ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorum,
} from "./receipt-trust-activation-v1.js";
import type {
  ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApproval,
  ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyReview,
} from "./receipt-trust-approval-v1.js";
import type {
  ReceiptTrustAnchorDirectoryMetadataReceipt,
  TrustedReceiptEnvelopeBase,
} from "./receipt-trust-core-v1.js";
import type {
  ReceiptTrustAnchorDirectoryQuorumActivationDecisionReceipt,
  ReceiptTrustAnchorDirectoryQuorumPromotionReceipt,
} from "./receipt-trust-quorum-v1.js";
import type { ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposal } from "./receipt-trust-rotation-v1.js";

export type TrustedReceipt =
  | EvaluationSuiteGateReceipt
  | EvaluationCasebookQualificationReceipt
  | ExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryProofBundle
  | ReceiptTrustAnchorDirectoryMetadataReceipt
  | ReceiptTrustAnchorDirectoryQuorumPromotionReceipt
  | ReceiptTrustAnchorDirectoryQuorumActivationDecisionReceipt
  | ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposal
  | ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApproval
  | ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyReview
  | ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpoint
  | ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorum;

export type TrustedReceiptEnvelope<
  Receipt extends TrustedReceipt = TrustedReceipt,
> = TrustedReceiptEnvelopeBase<Receipt>;

