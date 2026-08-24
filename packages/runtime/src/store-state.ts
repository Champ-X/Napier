import {
  NAPIER_API_VERSION,
  type CredentialReference,
  type MemoryFact,
} from "@napier/contracts";
import type { StoreRepositoryState } from "./store-repository-host.js";

export interface PersistedStoreState extends StoreRepositoryState {
  version: 1;
  apiVersion: string;
  agentCapabilityBindings: unknown[];
  memories: MemoryFact[];
  credentials: CredentialReference[];
}

export const EMPTY_STORE_STATE: PersistedStoreState = {
  version: 1,
  apiVersion: NAPIER_API_VERSION,
  agents: [],
  agentRevisions: [],
  agentCapabilityBindings: [],
  threads: [],
  runs: [],
  memories: [],
  subagents: [],
  extensions: [],
  extensionPackageRolloutChannels: [],
  extensionPublisherTrustAnchors: [],
  skillPackageInstallations: [],
  evaluations: [],
  evaluationAdjudications: [],
  evaluationReviewerBallots: [],
  evaluationConsensusResolutions: [],
  evaluationCasebooks: [],
  evaluationCasebookQualificationExecutions: [],
  receiptTrustAnchors: [],
  receiptTrustAnchorDirectorySubscriptions: [],
  receiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptions:
    [],
  receiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptions:
    [],
  receiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselines:
    [],
  receiptTrustAnchorDirectoryQuorumPromotionBaselines: [],
  receiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaselines:
    [],
  receiptTrustAnchorDirectoryQuorumActivationDecisions: [],
  receiptTrustAnchorDirectoryQuorumActivationSelections: [],
  evaluationQualificationBaselines: [],
  evaluationSuites: [],
  evaluationSuiteExecutions: [],
  automaticRecoveryAssessments: [],
  automaticRecoveryAttempts: [],
  plans: [],
  executionPlanBlueprints: [],
  executionPlanBlueprintOutcomeBaselines: [],
  executionPlanBlueprintRecommendationPolicyOverrides: [],
  executionPlanBlueprintRecommendationPolicyOverrideRetirements: [],
  credentials: [],
  schedules: [],
  channels: [],
  inboundDeliveries: [],
};
