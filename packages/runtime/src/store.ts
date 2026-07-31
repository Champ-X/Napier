import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import path from "node:path";

import {
  NAPIER_API_VERSION,
  emptyUsage,
  type AgentProfile,
  type AgentProfileRevision,
  type AgentProfileRollbackResult,
  type AgentMilestone,
  type ApplyExtensionPackageDeploymentRequest,
  type ApplyExtensionPackageDeploymentResult,
  type ApplyExtensionPackageRolloutChannelRequest,
  type ApplyExtensionPackageRolloutChannelResult,
  type ApplyExtensionPackageUpdateRequest,
  type ApplyExtensionPackageUpdateResult,
  type ApplyReceiptTrustAnchorDirectoryQuorumActivationSelectionResult,
  type AutomaticRecoveryAssessment,
  type AutomaticRecoveryAttempt,
  type AutomaticRecoveryClaim,
  type AutomationSchedule,
  type CreateAutomationScheduleRequest,
  type CreateExecutionPlanRequest,
  type CreateExecutionPlanFromBlueprintRecordRequest,
  type CreateCredentialReferenceRequest,
  type ContextCheckpointCalibrationReport,
  type CreateExtensionPublisherTrustAnchorRequest,
  type CreateReceiptTrustAnchorRequest,
  type CreatedInboundChannel,
  type CreateMcpExtensionRequest,
  type CreateEvaluationCasebookRequest,
  type ExtensionConnection,
  type ExtensionPackageChannelIndexVerification,
  type ExtensionPackageDeploymentPreview,
  type ExtensionPackageLockfile,
  type ExtensionPackageLockfileVerification,
  type ExtensionPackageRolloutChannel,
  type ExtensionPackageRolloutPreview,
  type ExtensionPackageUpdatePreview,
  type ExtensionPublisherTrustAnchor,
  type ExtensionRecord,
  type ExecutionPlan,
  type ExecutionPlanStatus,
  type ExecutionPlanBlueprintRecord,
  type ExecutionPlanBlueprintRecordPreview,
  type ExecutionPlanBlueprintRecordQualification,
  type ExecutionPlanBlueprintRecordReplay,
  type ExecutionPlanBlueprintRecordReplayEventVerification,
  type ExecutionPlanBlueprintRecordReplayHistory,
  type ExecutionPlanBlueprintRecordReplayHistoryVerification,
  type ExecutionPlanBlueprintRecordReplayOutcome,
  type ExecutionPlanBlueprintRecordReplayOutcomes,
  type ExecutionPlanBlueprintRecordReplayOutcomesVerification,
  type ExecutionPlanBlueprintRecordOutcomeBaseline,
  type ExecutionPlanBlueprintRecordOutcomeBaselinePolicy,
  type ExecutionPlanBlueprintRecordOutcomeBaselineReviewGate,
  type ExecutionPlanBlueprintRecordOutcomeQualification,
  type ExecutionPlanBlueprintRecordOutcomeReview,
  type ExecutionPlanBlueprintRecommendationPolicy,
  type ExecutionPlanBlueprintRecommendationPolicyBacktest,
  type ExecutionPlanBlueprintRecommendationPolicyBacktestCandidate,
  type ExecutionPlanBlueprintRecommendationPolicyBacktestResult,
  type ExecutionPlanBlueprintRecommendationPolicyOverride,
  type ExecutionPlanBlueprintRecommendationPolicyOverrideDriftReview,
  type ExecutionPlanBlueprintRecommendationPolicyOverrideDriftReviewItem,
  type ExecutionPlanBlueprintRecommendationPolicyOverrideList,
  type ExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistory,
  type ExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryProofBundle,
  type ExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryProofBundleItem,
  type ExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryVerification,
  type ExecutionPlanBlueprintRecommendationPolicySource,
  type ExecutionPlanBlueprintRecommendationPolicyTemplateId,
  type ExecutionPlanBlueprintPortfolioCalibration,
  type ExecutionPlanBlueprintPortfolioCalibrationFamily,
  type ExecutionPlanBlueprintRecordSelection,
  type ExecutionPlanBlueprintRecordSelectionCandidate,
  type RetireExecutionPlanBlueprintRecommendationPolicyOverrideRequest,
  type RetireExecutionPlanBlueprintRecommendationPolicyOverrideResult,
  type SetExecutionPlanBlueprintRecommendationPolicyOverrideRequest,
  type CredentialAvailability,
  type CredentialReference,
  type CreateEvaluationSuiteRequest,
  type EventCategory,
  type EventVisibility,
  type EvaluationAdjudication,
  type EvaluationCalibrationReport,
  type EvaluationCasebook,
  type EvaluationCasebookArtifact,
  type EvaluationCasebookCalibrationReport,
  type EvaluationCasebookQualificationExecution,
  type EvaluationCasebookQualificationReceipt,
  type EvaluationConsensusGate,
  type EvaluationConsensusReport,
  type EvaluationConsensusResolution,
  type EvaluationReviewerBallot,
  type EvaluationQualificationBaseline,
  type EvaluationSuite,
  type EvaluationSuiteExecution,
  type ExportExtensionPackageLockfileRequest,
  type GoalState,
  type InboundChannel,
  type InboundChannelAdapter,
  type InboundChannelPolicyTemplateId,
  type InboundDeadLetterExport,
  type InboundDelivery,
  type InboundDeliveryQualificationStatus,
  type InboundMessageRequest,
  type InboundReceipt,
  type InboundRetryPolicy,
  type InboundSignaturePolicy,
  type ImportSignedExtensionPackageRequest,
  type ApplySkillContentRequest,
  type ApplySkillContentResult,
  type InstallSkillPackageRequest,
  type InstallSkillPackageResult,
  type JsonValue,
  type PreviewSkillContentRequest,
  type QualifySkillPackageRequest,
  type CreateMemoryRequest,
  type MemoryFact,
  type MemorySource,
  type ReviewMemoryRequest,
  type ReviewRunEvaluationRequest,
  type ReceiptTrustAnchor,
  type ReceiptTrustAnchorDirectory,
  type ReceiptTrustAnchorDirectoryDiscovery,
  type ReceiptTrustAnchorDirectoryQuorumMetadataEvidence,
  type ReceiptTrustAnchorDirectoryQuorum,
  type ReceiptTrustAnchorDirectoryQuorumPolicy,
  type ReceiptTrustAnchorDirectoryQuorumActivationDecisionHistory,
  type ReceiptTrustAnchorDirectoryQuorumActivationDecisionHistoryVerification,
  type ReceiptTrustAnchorDirectoryQuorumActivationDecisionRecord,
  type ReceiptTrustAnchorDirectoryQuorumActivationSelection,
  type ReceiptTrustAnchorDirectoryQuorumActivationSelectionDriftAudit,
  type ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposal,
  type ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalDiscovery,
  type ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription,
  type ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApproval,
  type ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicy,
  type ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaseline,
  type ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyReview,
  type ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionRefreshResult,
  type ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationReview,
  type ReceiptTrustAnchorDirectoryQuorumActivationSelectionState,
  type ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpoint,
  type ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointDiscovery,
  type ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorum,
  type ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaseline,
  type ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumPolicy,
  type ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription,
  type ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionRefreshResult,
  type ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointVerification,
  type ReceiptTrustAnchorDirectoryQuorumPromotionBaseline,
  type ReceiptTrustAnchorDirectoryQuorumPromotionBaselineImportPolicy,
  type ReceiptTrustAnchorDirectoryQuorumPromotionBaselineImportPolicyReview,
  type ReceiptTrustAnchorDirectoryQuorumPromotionReceipt,
  type ReceiptTrustAnchorDirectorySubscription,
  type ReceiptTrustAnchorDirectorySubscriptionRefreshResult,
  type ReceiptTrustAnchorDirectoryVerification,
  type ReceiptTrustAnchorDirectoryVerificationPolicy,
  type CreateReceiptTrustAnchorDirectorySubscriptionRequest,
  type CreateReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionRequest,
  type CreateReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionRequest,
  type SignReceiptTrustAnchorDirectoryQuorumActivationDecisionResult,
  type UpdateReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionRequest,
  type UpdateReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionRequest,
  type UpdateReceiptTrustAnchorDirectorySubscriptionRequest,
  type ReplanExecutionPlanRequest,
  type ResolveEvaluationConsensusRequest,
  type ResolveEvaluationConsensusResult,
  type SubmitEvaluationReviewerBallotRequest,
  type CurateEvaluationCaseRequest,
  type RemoveEvaluationCaseRequest,
  type ReviewExtensionRequest,
  type ReviewMcpToolRequest,
  type RecordAgentMilestoneInput,
  type RunEvent,
  type RunEvaluationRecord,
  type AnswerOperatorDecisionRequest,
  type OperatorDecision,
  type OperatorDecisionCancellationReason,
  type RequestOperatorDecisionInput,
  type RunControlMessage,
  type RunControlMessageCancellationReason,
  type RunControlMessageMode,
  type RunRecord,
  type RunInvocationSource,
  type RunLeaseHandle,
  type ScheduleClaim,
  type RunExecutionMode,
  type RunStatus,
  type SignedExtensionPackageChannelIndexEnvelope,
  type SignedExtensionPackageEnvelope,
  type SignedSkillPackageEnvelope,
  type SignExtensionPackageChannelIndexRequest,
  type SignExtensionPackageRequest,
  type SignSkillPackageRequest,
  type SkillContentReview,
  type SkillPackageInstallation,
  type SkillPackageQualification,
  type SkillPackageVerification,
  type SaveExecutionPlanBlueprintRequest,
  type SaveExecutionPlanBlueprintResult,
  type SelectExecutionPlanBlueprintRecordRequest,
  type SetExecutionPlanBlueprintRecordStatusRequest,
  type SubagentOutcome,
  type SubagentRole,
  type SubagentStopReason,
  type SubagentTask,
  type SubagentTaskStatus,
  type StorePersistenceMetrics,
  type ThreadDetail,
  type ThreadImportProvenance,
  type ThreadReplayBundle,
  type ThreadRecord,
  type ThreadStatus,
  type ThreadSummary,
  type TrustedReceiptEnvelope,
  type TransitionPlanStepRequest,
  type UpdateArtifactManifestRequest,
  type UpdateAgentProfileRequest,
  type UpdateEvaluationCasebookRequest,
  type UpdateAutomationScheduleRequest,
  type UpdateEvaluationSuiteRequest,
  type CreateInboundChannelRequest,
  type UpdateInboundSignaturePolicyRequest,
  type WorkspaceSummary,
  type PromoteEvaluationQualificationBaselineResult,
  type PromoteReceiptTrustAnchorDirectoryQuorumBaselineResult,
  type PromoteReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselineResult,
  type PreviewExtensionPackageRolloutChannelRequest,
  type PublishExtensionPackageRolloutChannelRequest,
  type QualifyInspectorPackageRequest,
  type QualifyPromptPackageRequest,
  type VerifyExtensionPackageChannelIndexRequest,
  type VerifyInspectorPackageRequest,
  type VerifySkillPackageRequest,
  type InspectorPackageQualification,
  type InspectorPackageVerification,
  type PromptPackageQualification,
  type PromptPackageVerification,
  type PromoteExecutionPlanBlueprintRecordOutcomeBaselineRequest,
  type PromoteExecutionPlanBlueprintRecordOutcomeBaselineResult,
  type SignedInspectorPackageEnvelope,
  type SignedPromptPackageEnvelope,
  type SignInspectorPackageRequest,
  type SignPromptPackageRequest,
  type VerifyPromptPackageRequest,
  type VerifyExecutionPlanBlueprintRecordReplayEventRequest,
} from "@napier/contracts";

import { createId, nowIso } from "./ids.js";
import {
  DEFAULT_MODEL_ADVISOR_POLICY,
  DEFAULT_RUN_LIMITS,
  DEFAULT_SUBAGENT_LIMITS,
  changedAgentFields,
  createAgentProfileRevision,
  normalizeRunLimits,
  normalizeSubagentLimits,
  rollbackAgentProfile,
  updateAgentProfile,
  validateAgentProfileRevision,
} from "./agents.js";
import {
  assessAutomaticRecovery,
  hashAutomaticRecoveryAssessment,
  hashAutomaticRecoveryAttempt,
  hashAutomaticRecoveryEventStream,
  validateAutomaticRecoveryAssessment,
  validateAutomaticRecoveryAttempt,
} from "./automatic-recovery.js";
import {
  createCredentialReference as createCredentialReferenceRecord,
  credentialSourceKey,
  recordCredentialAvailability,
  setCredentialReferenceStatus,
} from "./credential-references.js";
import { createContextCheckpointCalibrationReport } from "./checkpoint-calibration.js";
import {
  createMcpExtension,
  type DiscoveredMcpTool,
  mergeDiscoveredMcpTools,
  normalizeMcpName,
  reviewExtensionRecord,
  reviewMcpToolRecord,
  setExtensionAgentEnabled,
  updateExtensionConnection,
} from "./extensions.js";
import {
  MAX_EXTENSION_PUBLISHER_TRUST_ANCHORS,
  MAX_EXTENSION_PACKAGE_ROLLOUT_CHANNELS,
  applyExtensionPackageDeploymentRecords,
  applyExtensionPackageRolloutChannelRecords,
  applyExtensionPackageUpdateRecord,
  createExtensionPackageDeploymentPreview,
  createExtensionPublisherTrustAnchor as createExtensionPublisherTrustAnchorRecord,
  createExtensionPackageLockfile,
  createExtensionPackageRolloutChannel,
  createExtensionPackageRolloutPreview,
  createExtensionPackageUpdatePreview,
  createMcpExtensionFromSignedPackage,
  extensionPackageDependencyFailure,
  revokeExtensionPublisherTrustAnchor as revokeExtensionPublisherTrustAnchorRecord,
  signExtensionPackageChannelIndex as signExtensionPackageChannelIndexRecord,
  signExtensionPackage as signExtensionPackageRecord,
  validateExtensionPackageDependencyGraph,
  validateExtensionPackageHistory,
  validateExtensionPackageRolloutChannel,
  validateExtensionPublisherTrustAnchor,
  verifyBoundExtensionPackageTrust,
  verifySignedExtensionPackageChannelIndexEnvelope as verifySignedExtensionPackageChannelIndexEnvelopeRecord,
  verifyExtensionPackageLockfile as verifyExtensionPackageLockfileRecord,
  verifySignedExtensionPackageEnvelope,
} from "./extension-packages.js";
import { normalizeRubric } from "./evaluation.js";
import {
  assertRunEvaluationCompletedEventBindings,
  assertRunEvaluationGovernanceSourceBinding,
} from "./evaluation-governance.js";
import {
  createEvaluationCalibrationReport,
  hashEvaluationAdjudicationRevision,
  reviewRunEvaluation as reviewRunEvaluationRecord,
  validateEvaluationAdjudication,
} from "./evaluation-calibration.js";
import {
  createEvaluationCasebook as createEvaluationCasebookRecord,
  createEvaluationCasebookArtifact,
  createEvaluationCasebookCalibrationReport,
  curateEvaluationCase,
  migrateLegacyEvaluationCasebook,
  removeEvaluationCase,
  updateEvaluationCasebook as updateEvaluationCasebookRecord,
} from "./evaluation-casebooks.js";
import { validateEvaluationCasebookQualificationExecution } from "./evaluation-casebook-qualification.js";
import {
  MAX_EVALUATION_CONSENSUS_RESOLUTIONS,
  MAX_EVALUATION_REVIEWERS,
  consensusAdjudicationRequest,
  createEvaluationConsensusReport,
  createEvaluationConsensusResolution,
  hashEvaluationConsensusReport,
  hashEvaluationConsensusResolution,
  hashEvaluationReviewerBallotRevision,
  submitEvaluationReviewerBallot,
  validateEvaluationConsensusReport,
  validateEvaluationConsensusResolution,
  validateEvaluationReviewerBallot,
} from "./evaluation-consensus.js";
import {
  createEvaluationSuiteRecord,
  hashEvaluationSuiteExecution,
  hashRunEvaluation,
  normalizeEvaluationSuiteGate,
  updateEvaluationSuiteRecord,
} from "./evaluation-suites.js";
import { validateModelContextEnvelopeReceipt } from "./model-context-envelope.js";
import {
  MAX_QUALIFICATION_BASELINES_PER_CASEBOOK,
  MAX_RECEIPT_TRUST_ANCHORS,
  createEvaluationQualificationBaseline,
  createReceiptTrustAnchorDirectory,
  createReceiptTrustAnchor as createReceiptTrustAnchorRecord,
  revokeReceiptTrustAnchor as revokeReceiptTrustAnchorRecord,
  validateEvaluationQualificationBaseline,
  validateReceiptTrustAnchor,
  validateTrustedReceiptEnvelope,
  verifyReceiptTrustAnchorDirectory,
  verifyTrustedReceiptEnvelope,
} from "./receipt-trust.js";
import {
  MAX_RECEIPT_TRUST_DIRECTORY_QUORUM_ACTIVATION_DECISIONS,
  MAX_RECEIPT_TRUST_DIRECTORY_QUORUM_PROMOTION_BASELINES,
  MAX_RECEIPT_TRUST_DIRECTORY_SUBSCRIPTIONS,
  MAX_RECEIPT_TRUST_CHECKPOINT_REGISTRY_QUORUM_BASELINES,
  MAX_RECEIPT_TRUST_CHECKPOINT_SUBSCRIPTIONS,
  MAX_RECEIPT_TRUST_ROTATION_PROPOSAL_SUBSCRIPTIONS,
  createReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaseline,
  createReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorum,
  createReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaseline,
  createReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription,
  createReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription,
  createReceiptTrustAnchorDirectoryQuorumActivationDecisionHistory,
  createReceiptTrustAnchorDirectoryQuorumActivationDecisionRecord,
  createReceiptTrustAnchorDirectoryQuorumActivationSelection,
  createReceiptTrustAnchorDirectoryQuorumActivationSelectionDriftAudit,
  createReceiptTrustAnchorDirectoryQuorumActivationSelectionState,
  createReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpoint,
  createReceiptTrustAnchorDirectoryQuorumActivationSourceAlignment,
  createReceiptTrustAnchorDirectoryQuorumPromotionBaseline,
  createReceiptTrustAnchorDirectorySubscriptionQuorum,
  createReceiptTrustAnchorDirectorySubscription,
  reviewReceiptTrustAnchorDirectoryQuorumPromotionBaselineImportPolicy,
  settleReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionRefresh,
  settleReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionRefresh,
  settleReceiptTrustAnchorDirectorySubscriptionRefresh,
  stripReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionSecrets,
  stripReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionSecrets,
  stripReceiptTrustAnchorDirectorySubscriptionSecrets,
  updateReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionStatus,
  updateReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionStatus,
  updateReceiptTrustAnchorDirectorySubscriptionStatus,
  normalizeReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicy,
  validateReceiptTrustAnchorDirectoryQuorumActivationDecisionRecord,
  validateReceiptTrustAnchorDirectoryQuorumActivationSelection,
  validateReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaseline,
  validateReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaseline,
  validateReceiptTrustAnchorDirectoryQuorumPromotionBaseline,
  validatePersistedReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription,
  validatePersistedReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription,
  validatePersistedReceiptTrustAnchorDirectorySubscription,
  verifyReceiptTrustAnchorDirectoryQuorumActivationDecisionHistory,
  verifyReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaseline,
  verifyReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpoint,
  verifyReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaseline,
  type PersistedReceiptTrustAnchorDirectorySubscription,
  type PersistedReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription,
  type PersistedReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription,
  type ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalApprovalApplyClaim,
  type ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalApprovalPolicyApplyClaim,
  type ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionClaim,
  type ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionClaim,
  type ReceiptTrustAnchorDirectorySubscriptionClaim,
} from "./receipt-trust-directory-subscriptions.js";
import {
  signWorkspaceSkillPackage,
  createSkillPackageInstallation,
  markSkillPackageInstallationReplaced,
  qualifyWorkspaceSkillPackage,
  validateSkillPackageInstallation,
  validateSignedSkillPackageEnvelope,
  verifySignedSkillPackageEnvelope,
} from "./skill-packages.js";
import {
  applyReviewedSkillContent,
  createSkillContentReview,
} from "./skill-content.js";
import {
  qualifyAgentPromptPackage,
  signPromptPackage,
  validateSignedPromptPackageEnvelope,
  verifySignedPromptPackageEnvelope,
} from "./prompt-packages.js";
import {
  qualifyInspectorPackage,
  signInspectorPackage,
  verifySignedInspectorPackageEnvelope,
} from "./inspector-packages.js";
import {
  DEFAULT_MEMORY_REVIEW_INTERVAL_DAYS,
  createMemoryFact,
  expireMemoryFact,
  memoryDedupeKey,
  memoryReplacementTargetIds,
  memoryReviewDueAt,
  normalizeMemoryConsolidationIds,
  normalizeMemoryReviewInterval,
  recordMemoryUse,
  reviewMemoryFact,
  supersedeMemoryFact,
} from "./memory.js";
import {
  assertPlanArtifactEventBindings,
  createExecutionPlan,
  interruptPlanRun,
  recoverCompletedPlanStep as recoverCompletedPlanStepProjection,
  refreshPlanProjection,
  replanExecutionPlan,
  transitionPlanStep,
  updateArtifactManifest,
} from "./plans.js";
import { assertArtifactReceiptEventBoundary } from "./artifact-receipts.js";
import {
  createExecutionPlanBlueprintRecord,
  executionPlanRequestFromBlueprint,
  qualifyExecutionPlanBlueprintRecord as qualifyExecutionPlanBlueprintRecordProjection,
  setExecutionPlanBlueprintRecordStatus,
  validateExecutionPlanBlueprint,
  validateExecutionPlanBlueprintRecord,
} from "./workflow-blueprints.js";
import {
  advanceSchedule,
  createAutomationSchedule,
  updateAutomationSchedule,
} from "./schedules.js";
import {
  ConcurrentStoreUpdateError,
  LEDGER_DATABASE_FILENAME,
  type LedgerSchemaReport,
  SqliteLedger,
} from "./sqlite-ledger.js";
import {
  monotonicNow,
  StorePersistenceMonitor,
} from "./store-observability.js";
import {
  createRunConfigurationFingerprint,
  type PromptVariableFingerprintInput,
  validateRunConfigurationFingerprint,
} from "./run-config.js";
import {
  createAgentMilestoneRecordedPayload,
  MAX_AGENT_MILESTONES_PER_RUN,
  MAX_AGENT_MILESTONES_PER_THREAD,
  projectAgentMilestones,
} from "./agent-milestones.js";
import {
  createOperatorDecisionAnsweredPayload,
  createOperatorDecisionCancelledPayload,
  createOperatorDecisionContinuedPayload,
  createOperatorDecisionRequestedPayload,
  MAX_OPERATOR_DECISIONS_PER_THREAD,
  projectOperatorDecisions,
} from "./operator-decisions.js";
import {
  createRunControlMessageCancelledPayload,
  createRunControlMessageDeliveredPayload,
  createRunControlMessageQueuedPayload,
  createRunControlMessageUserPayload,
  MAX_PENDING_RUN_CONTROL_MESSAGES,
  MAX_TOTAL_RUN_CONTROL_MESSAGES,
  nextPendingRunControlMessage,
  projectRunControlMessages,
} from "./run-control-messages.js";
import {
  assertSubagentOutcomeBinding,
  rebindSubagentOutcome,
} from "./subagent-outcomes.js";
import {
  rebindSubagentOutcomeRepairOutcome,
  rebindSubagentOutcomeRepairRequest,
  validateSubagentOutcomeRepairOutcome,
  validateSubagentOutcomeRepairRequest,
} from "./subagent-outcome-repair.js";
import {
  validateThreadReplayBundle,
  verifyThreadReplayBundle,
} from "./thread-bundles.js";
import {
  WORKFLOW_NODE_EXECUTION,
  type WorkflowNodeExecution,
} from "./workflow-node-execution.js";
import {
  AGENT_MESSAGE_EXPERIMENT_EXECUTION,
  type AgentMessageExperimentExecution,
} from "./agent-message-experiment-execution.js";
import {
  MODEL_INVOCATION_EXPERIMENT_EXECUTION,
  type ModelInvocationExperimentExecution,
} from "./model-invocation-experiment-execution.js";
import { validateModelInvocationExperimentRunGate } from "./model-invocation-experiment-run-gate.js";

export const DEFAULT_INBOUND_RETRY_POLICY: Readonly<InboundRetryPolicy> = {
  maxAttempts: 3,
  baseDelayMs: 5_000,
};
export const DEFAULT_INBOUND_SIGNATURE_POLICY: Readonly<InboundSignaturePolicy> =
  {
    required: false,
    algorithm: "hmac-sha256",
    header: "X-Napier-Channel-Signature",
    timestampHeader: "X-Napier-Channel-Timestamp",
    toleranceSeconds: 300,
  };
export const DEFAULT_INBOUND_CHANNEL_ADAPTER: InboundChannelAdapter =
  "napier_json";
type NamedInboundChannelPolicyTemplateId = Exclude<
  InboundChannelPolicyTemplateId,
  "custom"
>;
const INBOUND_CHANNEL_POLICY_TEMPLATES: Readonly<
  Record<
    NamedInboundChannelPolicyTemplateId,
    {
      retryPolicy: InboundRetryPolicy;
      signaturePolicy: InboundSignaturePolicy;
    }
  >
> = {
  legacy_bearer: {
    retryPolicy: { maxAttempts: 3, baseDelayMs: 5_000 },
    signaturePolicy: {
      required: false,
      algorithm: "hmac-sha256",
      header: "X-Napier-Channel-Signature",
      timestampHeader: "X-Napier-Channel-Timestamp",
      toleranceSeconds: 300,
    },
  },
  signed_standard: {
    retryPolicy: { maxAttempts: 3, baseDelayMs: 5_000 },
    signaturePolicy: {
      required: true,
      algorithm: "hmac-sha256",
      header: "X-Napier-Channel-Signature",
      timestampHeader: "X-Napier-Channel-Timestamp",
      toleranceSeconds: 300,
    },
  },
  signed_strict: {
    retryPolicy: { maxAttempts: 2, baseDelayMs: 1_000 },
    signaturePolicy: {
      required: true,
      algorithm: "hmac-sha256",
      header: "X-Napier-Channel-Signature",
      timestampHeader: "X-Napier-Channel-Timestamp",
      toleranceSeconds: 60,
    },
  },
};
const MAX_INBOUND_ATTEMPTS = 10;
const MIN_INBOUND_RETRY_BASE_MS = 250;
const MAX_INBOUND_RETRY_BASE_MS = 60_000;
const MIN_INBOUND_SIGNATURE_TOLERANCE_SECONDS = 30;
const MAX_INBOUND_SIGNATURE_TOLERANCE_SECONDS = 900;
const MAX_INBOUND_RETRY_DELAY_MS = 24 * 60 * 60 * 1_000;
const MAX_CONCURRENT_WORKFLOW_RUNS_PER_THREAD = 4;
const THREAD_IMPORTED_EVENT = "thread.imported";
const MEMORY_STATUSES = new Set([
  "proposed",
  "active",
  "stale",
  "rejected",
  "archived",
]);

interface PersistedRunRecord extends RunRecord {
  leaseTokenSha256?: string;
}

interface PersistedAutomationSchedule extends AutomationSchedule {
  claimTokenSha256?: string;
}

interface PersistedAutomaticRecoveryAttempt extends AutomaticRecoveryAttempt {
  claimTokenSha256?: string;
}

interface PersistedInboundChannel extends InboundChannel {
  tokenSha256: string;
}

interface PersistedInboundDelivery extends InboundDelivery {
  idempotencySha256: string;
  message: string;
  model?: InboundMessageRequest["model"];
}

interface PersistedState {
  version: 1;
  apiVersion: string;
  agents: AgentProfile[];
  agentRevisions: AgentProfileRevision[];
  threads: ThreadRecord[];
  runs: PersistedRunRecord[];
  memories: MemoryFact[];
  subagents: SubagentTask[];
  extensions: ExtensionRecord[];
  extensionPackageRolloutChannels: ExtensionPackageRolloutChannel[];
  extensionPublisherTrustAnchors: ExtensionPublisherTrustAnchor[];
  skillPackageInstallations: SkillPackageInstallation[];
  evaluations: RunEvaluationRecord[];
  evaluationAdjudications: EvaluationAdjudication[];
  evaluationReviewerBallots: EvaluationReviewerBallot[];
  evaluationConsensusResolutions: EvaluationConsensusResolution[];
  evaluationCasebooks: EvaluationCasebook[];
  evaluationCasebookQualificationExecutions: EvaluationCasebookQualificationExecution[];
  receiptTrustAnchors: ReceiptTrustAnchor[];
  receiptTrustAnchorDirectorySubscriptions: PersistedReceiptTrustAnchorDirectorySubscription[];
  receiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptions: PersistedReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription[];
  receiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptions: PersistedReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription[];
  receiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselines: ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaseline[];
  receiptTrustAnchorDirectoryQuorumPromotionBaselines: ReceiptTrustAnchorDirectoryQuorumPromotionBaseline[];
  receiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaselines: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaseline[];
  receiptTrustAnchorDirectoryQuorumActivationDecisions: ReceiptTrustAnchorDirectoryQuorumActivationDecisionRecord[];
  receiptTrustAnchorDirectoryQuorumActivationSelections: ReceiptTrustAnchorDirectoryQuorumActivationSelection[];
  receiptTrustAnchorDirectoryQuorumActivationSelection?: ReceiptTrustAnchorDirectoryQuorumActivationSelection;
  evaluationQualificationBaselines: EvaluationQualificationBaseline[];
  evaluationSuites: EvaluationSuite[];
  evaluationSuiteExecutions: EvaluationSuiteExecution[];
  automaticRecoveryAssessments: AutomaticRecoveryAssessment[];
  automaticRecoveryAttempts: PersistedAutomaticRecoveryAttempt[];
  plans: ExecutionPlan[];
  executionPlanBlueprints: ExecutionPlanBlueprintRecord[];
  executionPlanBlueprintOutcomeBaselines: ExecutionPlanBlueprintRecordOutcomeBaseline[];
  executionPlanBlueprintRecommendationPolicyOverrides: ExecutionPlanBlueprintRecommendationPolicyOverride[];
  executionPlanBlueprintRecommendationPolicyOverrideRetirements: RetireExecutionPlanBlueprintRecommendationPolicyOverrideResult[];
  credentials: CredentialReference[];
  schedules: PersistedAutomationSchedule[];
  channels: PersistedInboundChannel[];
  inboundDeliveries: PersistedInboundDelivery[];
}

export interface AppendEventInput {
  threadId: string;
  runId: string;
  type: string;
  category: EventCategory;
  visibility?: EventVisibility;
  payload: JsonValue;
}

export interface QueueRunControlMessageInput {
  threadId: string;
  runId: string;
  mode: RunControlMessageMode;
  text: string;
}

export interface RunControlMessageDelivery {
  message: RunControlMessage;
  text: string;
  events: RunEvent[];
}

export interface RequestOperatorDecisionStoreInput extends RequestOperatorDecisionInput {
  threadId: string;
  runId: string;
}

export interface OperatorDecisionMutation {
  decision: OperatorDecision;
  events: RunEvent[];
}

export interface RecordAgentMilestoneStoreInput extends RecordAgentMilestoneInput {
  threadId: string;
  runId: string;
}

export interface AgentMilestoneMutation {
  milestone: AgentMilestone;
  events: RunEvent[];
}

export interface CreateRunInput {
  threadId: string;
  agentId: string;
  model?: AgentProfile["model"];
  agentRevision?: number;
  executionMode?: RunExecutionMode;
  skillCatalogSha256?: string;
  promptVariables?: PromptVariableFingerprintInput;
  parentRunId?: string;
  operatorDecisionId?: string;
  branchFromSeq?: number;
  source?: RunInvocationSource;
  triggerId?: string;
  [WORKFLOW_NODE_EXECUTION]?: WorkflowNodeExecution;
  [AGENT_MESSAGE_EXPERIMENT_EXECUTION]?: AgentMessageExperimentExecution;
  [MODEL_INVOCATION_EXPERIMENT_EXECUTION]?: ModelInvocationExperimentExecution;
}

export interface RunLeaseOptions {
  ownerId: string;
  ttlMs: number;
}

export interface SettleScheduleClaimInput {
  runId?: string;
  error?: string;
}

export interface DueScheduleClaims {
  claims: ScheduleClaim[];
  skipped: Array<{
    schedule: AutomationSchedule;
    scheduledFor: string;
    reason: string;
  }>;
}

export interface DueReceiptTrustAnchorDirectorySubscriptionClaims {
  claims: ReceiptTrustAnchorDirectorySubscriptionClaim[];
}

export interface DueReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionClaims {
  claims: ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionClaim[];
}

export interface DueReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionClaims {
  claims: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionClaim[];
}

export interface DueReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalApprovalApplyClaims {
  claims: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalApprovalApplyClaim[];
}

export interface DueReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalApprovalPolicyApplyClaims {
  claims: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalApprovalPolicyApplyClaim[];
}

export interface AutomaticRecoveryClaims {
  claims: AutomaticRecoveryClaim[];
  skipped: AutomaticRecoveryAssessment[];
  settled: AutomaticRecoveryAttempt[];
  deferred: number;
}

export interface InboundExecution {
  delivery: InboundDelivery;
  message: string;
  model?: InboundMessageRequest["model"];
}

const EMPTY_STATE: PersistedState = {
  version: 1,
  apiVersion: NAPIER_API_VERSION,
  agents: [],
  agentRevisions: [],
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

const DEFAULT_EXECUTION_PLAN_BLUEPRINT_OUTCOME_BASELINE_POLICY: ExecutionPlanBlueprintRecordOutcomeBaselinePolicy =
  {
    minReplayCount: 1,
    minCompletionRateBps: 10_000,
    maxBlockedCount: 0,
    maxInvalidCount: 0,
  };

const DEFAULT_EXECUTION_PLAN_BLUEPRINT_OUTCOME_BASELINE_REVIEW_GATE: ExecutionPlanBlueprintRecordOutcomeBaselineReviewGate =
  {
    minScore: 80,
    maxRisk: "medium",
  };

const EXECUTION_PLAN_BLUEPRINT_RECOMMENDATION_POLICIES: Record<
  ExecutionPlanBlueprintRecommendationPolicyTemplateId,
  ExecutionPlanBlueprintRecommendationPolicy
> = {
  balanced: {
    templateId: "balanced",
    weights: {
      outcomeCompletionBps: 5_000,
      familyCompletionBps: 2_500,
      reviewedBaselineBps: 1_500,
      replayEvidenceBps: 1_000,
    },
  },
  delivery_first: {
    templateId: "delivery_first",
    weights: {
      outcomeCompletionBps: 7_000,
      familyCompletionBps: 1_000,
      reviewedBaselineBps: 1_000,
      replayEvidenceBps: 1_000,
    },
  },
  portfolio_first: {
    templateId: "portfolio_first",
    weights: {
      outcomeCompletionBps: 3_500,
      familyCompletionBps: 3_500,
      reviewedBaselineBps: 2_000,
      replayEvidenceBps: 1_000,
    },
  },
};
const EXECUTION_PLAN_BLUEPRINT_RECOMMENDATION_POLICY_TEMPLATE_IDS: ExecutionPlanBlueprintRecommendationPolicyTemplateId[] =
  ["balanced", "delivery_first", "portfolio_first"];

export interface CreateSubagentTaskInput {
  threadId: string;
  runId: string;
  role: SubagentRole;
  description: string;
  prompt: string;
  model: SubagentTask["model"];
}

const TERMINAL_SUBAGENT_STATUSES = new Set<SubagentTaskStatus>([
  "completed",
  "failed",
  "cancelled",
  "timed_out",
]);

class SerialQueue {
  private tail = Promise.resolve();

  constructor(
    private readonly beforeOperation?: () => void | Promise<void>,
    private readonly maxConflictRetries = 0,
  ) {}

  run<T>(operation: () => Promise<T>): Promise<T> {
    const execute = async (): Promise<T> => {
      for (let attempt = 0; ; attempt += 1) {
        await this.beforeOperation?.();
        try {
          return await operation();
        } catch (error) {
          if (
            !(error instanceof ConcurrentStoreUpdateError) ||
            attempt >= this.maxConflictRetries
          ) {
            throw error;
          }
        }
      }
    };
    const result = this.tail.then(execute, execute);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

export interface LocalStoreOptions {
  dataRoot: string;
  workspaceRoot: string;
}

export class LocalStore {
  readonly dataRoot: string;
  readonly workspaceRoot: string;

  private readonly statePath: string;
  private readonly eventsRoot: string;
  private readonly databasePath: string;
  private readonly stateQueue: SerialQueue;
  private readonly threadQueues = new Map<string, SerialQueue>();
  private readonly persistenceMonitor = new StorePersistenceMonitor();
  private ledger: SqliteLedger | undefined;
  private state: PersistedState = structuredClone(EMPTY_STATE);
  private stateRevision = 0;
  private initialized = false;

  constructor(options: LocalStoreOptions) {
    this.dataRoot = path.resolve(options.dataRoot);
    this.workspaceRoot = path.resolve(options.workspaceRoot);
    this.statePath = path.join(this.dataRoot, "workspace.json");
    this.eventsRoot = path.join(this.dataRoot, "events");
    this.databasePath = path.join(this.dataRoot, LEDGER_DATABASE_FILENAME);
    this.stateQueue = new SerialQueue(() => this.refreshStateFromLedger(), 4);
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    await mkdir(this.eventsRoot, { recursive: true });
    const ledger = new SqliteLedger(this.databasePath);
    ledger.initialize();
    this.ledger = ledger;
    let restored = false;
    let requiresStateMigration = false;
    try {
      const snapshot = ledger.readSnapshot();
      if (snapshot) {
        requiresStateMigration = this.restoreSnapshot(snapshot);
        restored = true;
      } else {
        try {
          const parsed = JSON.parse(
            await readFile(this.statePath, "utf8"),
          ) as PersistedState;
          this.state = this.validateState(parsed);
          const events = await this.readLegacyEvents();
          this.state = this.validateState(this.state, events);
          const imported = ledger.bootstrap(JSON.stringify(this.state), events);
          this.restoreSnapshot(imported);
          restored = true;
          await this.writeStateProjection(imported.stateJson);
        } catch (error) {
          if (!isMissingFileError(error)) throw error;
          this.state = structuredClone(EMPTY_STATE);
          await this.seedWorkspace();
        }
      }
      this.validateLedgerConsistency();
      if (requiresStateMigration) {
        await this.stateQueue.run(() => this.persistState());
      }
      this.initialized = true;
      if (restored) await this.reconcileInterruptedRuns();
    } catch (error) {
      ledger.close();
      this.ledger = undefined;
      throw error;
    }
  }

  close(): void {
    this.ledger?.close();
    this.ledger = undefined;
    this.initialized = false;
  }

  getWorkspaceSummary(): WorkspaceSummary {
    this.assertInitialized();
    return {
      root: this.workspaceRoot,
      dataRoot: this.dataRoot,
      localFirst: true,
      isolation: "workspace",
    };
  }

  getLedgerSchemaReport(): LedgerSchemaReport {
    this.assertInitialized();
    return this.requireLedger().schemaReport();
  }

  getPersistenceMetrics(): StorePersistenceMetrics {
    this.assertInitialized();
    return this.persistenceMonitor.snapshot();
  }

  listAgents(): AgentProfile[] {
    this.assertInitialized();
    return structuredClone(this.state.agents);
  }

  getAgent(agentId: string): AgentProfile {
    this.assertInitialized();
    const agent = this.state.agents.find((item) => item.id === agentId);
    if (!agent) throw new Error(`Agent not found: ${agentId}`);
    return structuredClone(agent);
  }

  listAgentRevisions(agentId: string): AgentProfileRevision[] {
    this.assertInitialized();
    this.getAgent(agentId);
    return structuredClone(
      this.state.agentRevisions
        .filter((revision) => revision.agentId === agentId)
        .sort((left, right) => right.revision - left.revision),
    );
  }

  getAgentRevision(agentId: string, revision: number): AgentProfileRevision {
    this.assertInitialized();
    this.getAgent(agentId);
    const snapshot = this.state.agentRevisions.find(
      (candidate) =>
        candidate.agentId === agentId && candidate.revision === revision,
    );
    if (!snapshot) {
      throw new Error(`Agent revision not found: ${agentId}@${revision}`);
    }
    return structuredClone(snapshot);
  }

  async updateAgent(
    agentId: string,
    request: UpdateAgentProfileRequest,
  ): Promise<AgentProfile> {
    this.assertInitialized();
    return this.stateQueue.run(async () => {
      const index = this.state.agents.findIndex(
        (candidate) => candidate.id === agentId,
      );
      const current = this.state.agents[index];
      if (!current) throw new Error(`Agent not found: ${agentId}`);
      const updated = updateAgentProfile(current, request);
      this.state.agents[index] = updated;
      if (updated.revision !== current.revision) {
        this.state.agentRevisions.push(
          createAgentProfileRevision(updated, {
            source: "updated",
            changedFields: changedAgentFields(current, updated),
          }),
        );
        await this.persistState();
      }
      return structuredClone(updated);
    });
  }

  async rollbackAgent(
    agentId: string,
    targetRevision: number,
  ): Promise<AgentProfileRollbackResult> {
    this.assertInitialized();
    return this.stateQueue.run(async () => {
      const index = this.state.agents.findIndex(
        (candidate) => candidate.id === agentId,
      );
      const current = this.state.agents[index];
      if (!current) throw new Error(`Agent not found: ${agentId}`);
      const target = this.state.agentRevisions.find(
        (candidate) =>
          candidate.agentId === agentId &&
          candidate.revision === targetRevision,
      );
      if (!target) {
        throw new Error(
          `Agent revision not found: ${agentId}@${targetRevision}`,
        );
      }
      const agent = rollbackAgentProfile(current, target);
      const revision = createAgentProfileRevision(agent, {
        source: "rollback",
        changedFields: changedAgentFields(current, agent),
        restoredFromRevision: target.revision,
      });
      this.state.agents[index] = agent;
      this.state.agentRevisions.push(revision);
      await this.persistState();
      return structuredClone({ agent, revision });
    });
  }

  listCredentialReferences(): CredentialReference[] {
    this.assertInitialized();
    return structuredClone(
      [...this.state.credentials].sort((left, right) =>
        `${left.providerId}:${left.label}`.localeCompare(
          `${right.providerId}:${right.label}`,
        ),
      ),
    );
  }

  getCredentialReference(referenceId: string): CredentialReference {
    this.assertInitialized();
    const reference = this.state.credentials.find(
      (candidate) => candidate.id === referenceId,
    );
    if (!reference) {
      throw new Error(`Credential reference not found: ${referenceId}`);
    }
    return structuredClone(reference);
  }

  getActiveCredentialReference(
    providerId: string,
  ): CredentialReference | undefined {
    this.assertInitialized();
    const reference = this.state.credentials.find(
      (candidate) =>
        candidate.providerId === providerId && candidate.status === "active",
    );
    return reference ? structuredClone(reference) : undefined;
  }

  async createCredentialReference(
    request: CreateCredentialReferenceRequest,
  ): Promise<CredentialReference> {
    this.assertInitialized();
    const reference = createCredentialReferenceRecord(request);
    return this.stateQueue.run(async () => {
      if (
        this.state.credentials.some(
          (candidate) =>
            candidate.providerId === reference.providerId &&
            candidate.status === "active",
        )
      ) {
        throw new Error(
          `Provider already has an active credential reference: ${reference.providerId}`,
        );
      }
      const sourceKey = credentialSourceKey(reference);
      if (
        this.state.credentials.some(
          (candidate) => credentialSourceKey(candidate) === sourceKey,
        )
      ) {
        throw new Error("Credential reference source already exists");
      }
      this.state.credentials.push(reference);
      await this.persistState();
      return structuredClone(reference);
    });
  }

  async setCredentialReferenceStatus(
    referenceId: string,
    status: CredentialReference["status"],
  ): Promise<CredentialReference> {
    this.assertInitialized();
    return this.stateQueue.run(async () => {
      const index = this.state.credentials.findIndex(
        (candidate) => candidate.id === referenceId,
      );
      const current = this.state.credentials[index];
      if (!current) {
        throw new Error(`Credential reference not found: ${referenceId}`);
      }
      if (
        status === "active" &&
        this.state.credentials.some(
          (candidate) =>
            candidate.id !== referenceId &&
            candidate.providerId === current.providerId &&
            candidate.status === "active",
        )
      ) {
        throw new Error(
          `Provider already has an active credential reference: ${current.providerId}`,
        );
      }
      const updated = setCredentialReferenceStatus(current, status);
      this.state.credentials[index] = updated;
      if (updated.revision !== current.revision) await this.persistState();
      return structuredClone(updated);
    });
  }

  async recordCredentialAvailability(
    referenceId: string,
    availability: CredentialAvailability,
    error?: string,
  ): Promise<CredentialReference> {
    this.assertInitialized();
    return this.stateQueue.run(async () => {
      const index = this.state.credentials.findIndex(
        (candidate) => candidate.id === referenceId,
      );
      const current = this.state.credentials[index];
      if (!current) {
        throw new Error(`Credential reference not found: ${referenceId}`);
      }
      const updated = recordCredentialAvailability(
        current,
        availability,
        error,
      );
      this.state.credentials[index] = updated;
      await this.persistState();
      return structuredClone(updated);
    });
  }

  listReceiptTrustAnchors(): ReceiptTrustAnchor[] {
    this.assertInitialized();
    return structuredClone(
      this.state.receiptTrustAnchors
        .slice()
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
    );
  }

  getReceiptTrustAnchorDirectory(): ReceiptTrustAnchorDirectory {
    this.assertInitialized();
    return createReceiptTrustAnchorDirectory(this.listReceiptTrustAnchors());
  }

  verifyReceiptTrustAnchorDirectory(
    input: unknown,
    policy?: ReceiptTrustAnchorDirectoryVerificationPolicy,
  ): ReceiptTrustAnchorDirectoryVerification {
    this.assertInitialized();
    return verifyReceiptTrustAnchorDirectory(input, policy);
  }

  getReceiptTrustAnchor(anchorId: string): ReceiptTrustAnchor {
    this.assertInitialized();
    const anchor = this.state.receiptTrustAnchors.find(
      (candidate) => candidate.id === anchorId,
    );
    if (!anchor) {
      throw new Error(`Receipt trust anchor not found: ${anchorId}`);
    }
    return structuredClone(anchor);
  }

  async createReceiptTrustAnchor(
    request: CreateReceiptTrustAnchorRequest,
  ): Promise<ReceiptTrustAnchor> {
    this.assertInitialized();
    this.getThread(request.threadId);
    const anchor = createReceiptTrustAnchorRecord(request);
    return this.stateQueue.run(async () => {
      if (this.state.receiptTrustAnchors.length >= MAX_RECEIPT_TRUST_ANCHORS) {
        throw new Error(
          `Workspace exceeds ${MAX_RECEIPT_TRUST_ANCHORS} receipt trust anchors`,
        );
      }
      if (
        this.state.receiptTrustAnchors.some(
          (candidate) => candidate.keyId === anchor.keyId,
        )
      ) {
        throw new Error(
          `Receipt trust anchor already exists for key: ${anchor.keyId}`,
        );
      }
      if (
        anchor.signingSource &&
        this.state.receiptTrustAnchors.some(
          (candidate) =>
            candidate.signingSource?.variable ===
            anchor.signingSource?.variable,
        )
      ) {
        throw new Error(
          `Receipt signing source already exists: ${anchor.signingSource.variable}`,
        );
      }
      this.state.receiptTrustAnchors.push(anchor);
      await this.persistState();
      return structuredClone(anchor);
    });
  }

  async revokeReceiptTrustAnchor(
    anchorId: string,
  ): Promise<ReceiptTrustAnchor> {
    this.assertInitialized();
    return this.stateQueue.run(async () => {
      const index = this.state.receiptTrustAnchors.findIndex(
        (candidate) => candidate.id === anchorId,
      );
      const current = this.state.receiptTrustAnchors[index];
      if (!current) {
        throw new Error(`Receipt trust anchor not found: ${anchorId}`);
      }
      const updated = revokeReceiptTrustAnchorRecord(current);
      this.state.receiptTrustAnchors[index] = updated;
      if (updated.status !== current.status) await this.persistState();
      return structuredClone(updated);
    });
  }

  listReceiptTrustAnchorDirectorySubscriptions(): ReceiptTrustAnchorDirectorySubscription[] {
    this.assertInitialized();
    return this.state.receiptTrustAnchorDirectorySubscriptions
      .map(stripReceiptTrustAnchorDirectorySubscriptionSecrets)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  getReceiptTrustAnchorDirectorySubscription(
    subscriptionId: string,
  ): ReceiptTrustAnchorDirectorySubscription {
    this.assertInitialized();
    const subscription =
      this.state.receiptTrustAnchorDirectorySubscriptions.find(
        (candidate) => candidate.id === subscriptionId,
      );
    if (!subscription) {
      throw new Error(
        `Receipt trust anchor directory subscription not found: ${subscriptionId}`,
      );
    }
    return stripReceiptTrustAnchorDirectorySubscriptionSecrets(subscription);
  }

  getReceiptTrustAnchorDirectorySubscriptionQuorum(
    policy?: ReceiptTrustAnchorDirectoryQuorumPolicy,
    metadataEvidence?: ReceiptTrustAnchorDirectoryQuorumMetadataEvidence[],
  ): ReceiptTrustAnchorDirectoryQuorum {
    this.assertInitialized();
    return createReceiptTrustAnchorDirectorySubscriptionQuorum(
      this.listReceiptTrustAnchorDirectorySubscriptions(),
      policy,
      metadataEvidence,
    );
  }

  listReceiptTrustAnchorDirectoryQuorumPromotionBaselines(): ReceiptTrustAnchorDirectoryQuorumPromotionBaseline[] {
    this.assertInitialized();
    return structuredClone(
      this.state.receiptTrustAnchorDirectoryQuorumPromotionBaselines
        .slice()
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
    );
  }

  async promoteReceiptTrustAnchorDirectoryQuorumPromotionBaseline(
    promotedByThreadId: string,
    envelope: TrustedReceiptEnvelope<ReceiptTrustAnchorDirectoryQuorumPromotionReceipt>,
  ): Promise<PromoteReceiptTrustAnchorDirectoryQuorumBaselineResult> {
    this.assertInitialized();
    this.getThread(promotedByThreadId);
    return this.stateQueue.run(async () => {
      const anchor = this.state.receiptTrustAnchors.find(
        (candidate) => candidate.keyId === envelope.signature.keyId,
      );
      if (!anchor) {
        throw new Error(
          `Receipt trust anchor not found for key: ${envelope.signature.keyId}`,
        );
      }
      const verification = verifyTrustedReceiptEnvelope(envelope, [anchor]);
      if (verification.status !== "trusted") {
        throw new Error(
          `Receipt trust anchor directory quorum promotion baseline receipt is not trusted: ${verification.reason}`,
        );
      }
      const existing =
        this.state.receiptTrustAnchorDirectoryQuorumPromotionBaselines.find(
          (baseline) =>
            receiptTrustAnchorDirectoryQuorumPromotionBaselineKey(
              baseline.envelope,
            ) ===
            receiptTrustAnchorDirectoryQuorumPromotionBaselineKey(envelope),
        );
      if (existing) {
        return {
          baseline: structuredClone(existing),
          created: false,
        };
      }
      const baseline =
        this.appendReceiptTrustAnchorDirectoryQuorumPromotionBaseline(
          promotedByThreadId,
          envelope,
        );
      await this.persistState();
      return {
        baseline: structuredClone(baseline),
        created: true,
      };
    });
  }

  async importReceiptTrustAnchorDirectoryQuorumPromotionBaseline(
    importedByThreadId: string,
    baselineInput: unknown,
    expectedCurrentBaselineSha256: string,
    trustedAnchors: ReceiptTrustAnchor[],
    importPolicy?: ReceiptTrustAnchorDirectoryQuorumPromotionBaselineImportPolicy,
  ): Promise<{
    baseline: ReceiptTrustAnchorDirectoryQuorumPromotionBaseline;
    imported: boolean;
    policyReview?: ReceiptTrustAnchorDirectoryQuorumPromotionBaselineImportPolicyReview;
    previousBaselineSha256?: string;
  }> {
    this.assertInitialized();
    this.getThread(importedByThreadId);
    if (
      expectedCurrentBaselineSha256 !== "" &&
      !isSha256(expectedCurrentBaselineSha256)
    ) {
      throw new Error(
        "Receipt trust anchor directory quorum promotion baseline import precondition is invalid",
      );
    }
    return this.stateQueue.run(async () => {
      const current =
        this.state.receiptTrustAnchorDirectoryQuorumPromotionBaselines.at(-1);
      const currentSha256 = current?.contentSha256 ?? "";
      if (currentSha256 !== expectedCurrentBaselineSha256) {
        throw new Error(
          "Receipt trust anchor directory quorum promotion baseline import precondition failed",
        );
      }
      const importedBaseline =
        validateReceiptTrustAnchorDirectoryQuorumPromotionBaseline(
          baselineInput,
          trustedAnchors,
        );
      const verification = verifyTrustedReceiptEnvelope(
        importedBaseline.envelope,
        trustedAnchors,
      );
      if (verification.status !== "trusted") {
        throw new Error(
          `Receipt trust anchor directory quorum promotion baseline import is not trusted: ${verification.reason}`,
        );
      }
      const policyReview =
        importPolicy === undefined
          ? undefined
          : reviewReceiptTrustAnchorDirectoryQuorumPromotionBaselineImportPolicy(
              importedBaseline,
              importPolicy,
            );
      if (policyReview?.status === "rejected") {
        throw new Error(
          `Receipt trust anchor directory quorum promotion baseline import policy rejected: ${policyReview.diagnostics.join(",")}`,
        );
      }
      const existing =
        this.state.receiptTrustAnchorDirectoryQuorumPromotionBaselines.find(
          (baseline) =>
            receiptTrustAnchorDirectoryQuorumPromotionBaselineKey(
              baseline.envelope,
            ) ===
            receiptTrustAnchorDirectoryQuorumPromotionBaselineKey(
              importedBaseline.envelope,
            ),
        );
      if (existing) {
        return {
          baseline: structuredClone(existing),
          imported: false,
          ...(policyReview ? { policyReview } : {}),
          ...(current ? { previousBaselineSha256: current.contentSha256 } : {}),
        };
      }
      const baseline =
        this.appendReceiptTrustAnchorDirectoryQuorumPromotionBaseline(
          importedByThreadId,
          importedBaseline.envelope,
        );
      await this.persistState();
      return {
        baseline: structuredClone(baseline),
        imported: true,
        ...(policyReview ? { policyReview } : {}),
        ...(current ? { previousBaselineSha256: current.contentSha256 } : {}),
      };
    });
  }

  listReceiptTrustAnchorDirectoryQuorumActivationDecisionRecords(): ReceiptTrustAnchorDirectoryQuorumActivationDecisionRecord[] {
    this.assertInitialized();
    return structuredClone(
      this.state.receiptTrustAnchorDirectoryQuorumActivationDecisions
        .slice()
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
    );
  }

  getReceiptTrustAnchorDirectoryQuorumActivationDecisionHistory(): ReceiptTrustAnchorDirectoryQuorumActivationDecisionHistory {
    this.assertInitialized();
    return createReceiptTrustAnchorDirectoryQuorumActivationDecisionHistory(
      this.listReceiptTrustAnchorDirectoryQuorumActivationDecisionRecords(),
    );
  }

  verifyReceiptTrustAnchorDirectoryQuorumActivationDecisionHistory(
    value: unknown,
  ): ReceiptTrustAnchorDirectoryQuorumActivationDecisionHistoryVerification {
    this.assertInitialized();
    return verifyReceiptTrustAnchorDirectoryQuorumActivationDecisionHistory(
      value,
      this.getReceiptTrustAnchorDirectoryQuorumActivationDecisionHistory(),
    );
  }

  getReceiptTrustAnchorDirectoryQuorumActivationSelectionState(): ReceiptTrustAnchorDirectoryQuorumActivationSelectionState {
    this.assertInitialized();
    return createReceiptTrustAnchorDirectoryQuorumActivationSelectionState(
      this.state.receiptTrustAnchorDirectoryQuorumActivationSelection,
    );
  }

  getReceiptTrustAnchorDirectoryQuorumActivationSelectionBySha256(
    selectionSha256: string,
  ): ReceiptTrustAnchorDirectoryQuorumActivationSelection | undefined {
    this.assertInitialized();
    if (!/^[a-f0-9]{64}$/.test(selectionSha256)) return undefined;
    const selection =
      this.state.receiptTrustAnchorDirectoryQuorumActivationSelections.find(
        (candidate) => candidate.contentSha256 === selectionSha256,
      );
    return selection
      ? validateReceiptTrustAnchorDirectoryQuorumActivationSelection(selection)
      : undefined;
  }

  getReceiptTrustAnchorDirectoryQuorumActivationSelectionDriftAudit(): ReceiptTrustAnchorDirectoryQuorumActivationSelectionDriftAudit {
    this.assertInitialized();
    return createReceiptTrustAnchorDirectoryQuorumActivationSelectionDriftAudit(
      {
        selectionState:
          this.getReceiptTrustAnchorDirectoryQuorumActivationSelectionState(),
        currentQuorum: this.getReceiptTrustAnchorDirectorySubscriptionQuorum(),
      },
    );
  }

  getReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpoint(): ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpoint {
    this.assertInitialized();
    return createReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpoint(
      this.state.receiptTrustAnchorDirectoryQuorumActivationSelections,
      this.getReceiptTrustAnchorDirectoryQuorumActivationSelectionDriftAudit(),
    );
  }

  verifyReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpoint(
    value: unknown,
  ): ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointVerification {
    this.assertInitialized();
    return verifyReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpoint(
      value,
      this.getReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpoint(),
    );
  }

  reviewReceiptTrustAnchorDirectoryQuorumActivationSelectionRotation(
    activationDecisionRecordId: string,
    expectedCurrentSelectionSha256: string,
    checkpointRegistryQuorumPolicy?: ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumPolicy,
  ): ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationReview {
    this.assertInitialized();
    const reviewedAt = new Date().toISOString();
    const currentSelection =
      this.state.receiptTrustAnchorDirectoryQuorumActivationSelection;
    const currentSelectionSha256 = currentSelection?.contentSha256 ?? "";
    const driftAudit =
      this.getReceiptTrustAnchorDirectoryQuorumActivationSelectionDriftAudit();
    const checkpointRegistryQuorum =
      checkpointRegistryQuorumPolicy !== undefined
        ? this.getReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorum(
            checkpointRegistryQuorumPolicy,
          )
        : undefined;
    const record =
      this.state.receiptTrustAnchorDirectoryQuorumActivationDecisions.find(
        (candidate) => candidate.id === activationDecisionRecordId,
      );
    const diagnostics: string[] = [];
    if (expectedCurrentSelectionSha256 !== currentSelectionSha256) {
      diagnostics.push("selection_precondition_failed");
    }
    if (!record) {
      diagnostics.push("activation_decision_missing");
    }
    if (
      checkpointRegistryQuorum &&
      checkpointRegistryQuorum.status !== "agreed"
    ) {
      diagnostics.push("checkpoint_registry_quorum_not_agreed");
    }
    if (currentSelection?.activationDecisionRecordId === record?.id) {
      diagnostics.push("selection_already_active");
    }
    let currentSourceAlignmentSha256: string | undefined;
    if (record) {
      const currentSourceAlignment =
        createReceiptTrustAnchorDirectoryQuorumActivationSourceAlignment(
          record.baseline,
          this.state.receiptTrustAnchorDirectorySubscriptions,
        );
      currentSourceAlignmentSha256 = currentSourceAlignment.contentSha256;
      if (record.envelope.receipt.decision !== "approved") {
        diagnostics.push("activation_decision_not_approved");
      }
      if (
        currentSourceAlignment.selectedSourceOriginSetSha256 !==
          record.sourceAlignment.selectedSourceOriginSetSha256 ||
        currentSourceAlignment.alignedSourceCount !==
          record.sourceAlignment.alignedSourceCount ||
        currentSourceAlignment.driftedSourceCount !== 0 ||
        currentSourceAlignment.missingSourceCount !== 0
      ) {
        diagnostics.push("source_alignment_drifted");
      }
    }
    const status: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationReview["status"] =
      expectedCurrentSelectionSha256 !== currentSelectionSha256
        ? "stale_selection"
        : !record
          ? "missing_decision"
          : currentSelection?.activationDecisionRecordId === record.id
            ? "already_active"
            : diagnostics.length > 0
              ? "blocked"
              : "eligible";
    const content = {
      kind: "napier.receipt-trust-anchor-directory-quorum-activation-selection-rotation-review" as const,
      schemaVersion: 1 as const,
      apiVersion: NAPIER_API_VERSION,
      reviewedAt,
      status,
      diagnostics,
      expectedCurrentSelectionSha256,
      currentSelectionSha256,
      activationDecisionRecordId,
      ...(record
        ? {
            activationDecisionRecordSha256: record.contentSha256,
            baselineSha256: record.baseline.contentSha256,
            sourceAlignmentSha256: record.sourceAlignment.contentSha256,
          }
        : {}),
      ...(currentSourceAlignmentSha256 ? { currentSourceAlignmentSha256 } : {}),
      driftAudit,
      ...(checkpointRegistryQuorum ? { checkpointRegistryQuorum } : {}),
    };
    return {
      ...content,
      contentSha256: sha256(canonicalJson(content)),
    };
  }

  proposeReceiptTrustAnchorDirectoryQuorumActivationSelectionRotation(
    activationDecisionRecordId: string,
    expectedCurrentSelectionSha256: string,
    options: {
      checkpointRegistryQuorumBaselineId?: string;
      expectedCheckpointRegistryQuorumBaselineSha256?: string;
      checkpointRegistryQuorumPolicy?: ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumPolicy;
    } = {},
  ): ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposal {
    this.assertInitialized();
    const proposedAt = nowIso();
    const rotationReview =
      this.reviewReceiptTrustAnchorDirectoryQuorumActivationSelectionRotation(
        activationDecisionRecordId,
        expectedCurrentSelectionSha256,
        options.checkpointRegistryQuorumPolicy,
      );
    const currentCheckpoint =
      this.getReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpoint();
    const checkpointRegistryQuorumBaselines =
      this.state
        .receiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselines;
    const checkpointRegistryQuorumBaseline =
      options.checkpointRegistryQuorumBaselineId === undefined
        ? checkpointRegistryQuorumBaselines.at(-1)
        : checkpointRegistryQuorumBaselines.find(
            (baseline) =>
              baseline.id === options.checkpointRegistryQuorumBaselineId,
          );
    const diagnostics = rotationReview.diagnostics.slice();
    if (rotationReview.status !== "eligible") {
      diagnostics.push(`rotation_review_${rotationReview.status}`);
    }
    if (!checkpointRegistryQuorumBaseline) {
      diagnostics.push("checkpoint_registry_quorum_baseline_missing");
    } else {
      if (
        options.expectedCheckpointRegistryQuorumBaselineSha256 !== undefined &&
        checkpointRegistryQuorumBaseline.contentSha256 !==
          options.expectedCheckpointRegistryQuorumBaselineSha256
      ) {
        diagnostics.push(
          "checkpoint_registry_quorum_baseline_precondition_failed",
        );
      }
      if (
        checkpointRegistryQuorumBaseline.envelope.receipt.status !== "agreed"
      ) {
        diagnostics.push("checkpoint_registry_quorum_baseline_not_agreed");
      }
      if (
        checkpointRegistryQuorumBaseline.selectedCheckpointSha256 !==
        currentCheckpoint.contentSha256
      ) {
        diagnostics.push(
          "checkpoint_registry_quorum_baseline_checkpoint_mismatch",
        );
      }
      if (
        checkpointRegistryQuorumBaseline.selectedSelectionSetSha256 !==
        currentCheckpoint.selectionSetSha256
      ) {
        diagnostics.push(
          "checkpoint_registry_quorum_baseline_selection_set_mismatch",
        );
      }
      if (
        (checkpointRegistryQuorumBaseline.selectedSelectionChainTailSha256 ??
          "") !== (currentCheckpoint.selectionChainTailSha256 ?? "")
      ) {
        diagnostics.push(
          "checkpoint_registry_quorum_baseline_selection_chain_tail_mismatch",
        );
      }
    }
    const status: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposal["status"] =
      rotationReview.status === "stale_selection"
        ? "stale_selection"
        : rotationReview.status === "missing_decision"
          ? "missing_decision"
          : rotationReview.status === "already_active"
            ? "already_active"
            : !checkpointRegistryQuorumBaseline
              ? "missing_checkpoint_registry_baseline"
              : diagnostics.length > 0
                ? "blocked"
                : "proposed";
    const content = {
      kind: "napier.receipt-trust-anchor-directory-quorum-activation-selection-rotation-proposal" as const,
      schemaVersion: 1 as const,
      apiVersion: NAPIER_API_VERSION,
      proposedAt,
      status,
      diagnostics,
      activationDecisionRecordId,
      ...(rotationReview.activationDecisionRecordSha256
        ? {
            activationDecisionRecordSha256:
              rotationReview.activationDecisionRecordSha256,
          }
        : {}),
      expectedCurrentSelectionSha256,
      currentSelectionSha256: rotationReview.currentSelectionSha256,
      rotationReview,
      rotationReviewSha256: rotationReview.contentSha256,
      ...(options.checkpointRegistryQuorumBaselineId
        ? {
            checkpointRegistryQuorumBaselineId:
              options.checkpointRegistryQuorumBaselineId,
          }
        : checkpointRegistryQuorumBaseline
          ? {
              checkpointRegistryQuorumBaselineId:
                checkpointRegistryQuorumBaseline.id,
            }
          : {}),
      ...(options.expectedCheckpointRegistryQuorumBaselineSha256
        ? {
            expectedCheckpointRegistryQuorumBaselineSha256:
              options.expectedCheckpointRegistryQuorumBaselineSha256,
          }
        : {}),
      ...(checkpointRegistryQuorumBaseline
        ? {
            checkpointRegistryQuorumBaselineSha256:
              checkpointRegistryQuorumBaseline.contentSha256,
            checkpointRegistryQuorumBaselineEnvelopeSha256:
              checkpointRegistryQuorumBaseline.envelope.contentSha256,
            checkpointRegistryQuorumSha256:
              checkpointRegistryQuorumBaseline.envelope.receipt.contentSha256,
            selectedCheckpointSha256:
              checkpointRegistryQuorumBaseline.selectedCheckpointSha256,
            selectedSelectionSetSha256:
              checkpointRegistryQuorumBaseline.selectedSelectionSetSha256,
            ...(checkpointRegistryQuorumBaseline.selectedSelectionChainTailSha256
              ? {
                  selectedSelectionChainTailSha256:
                    checkpointRegistryQuorumBaseline.selectedSelectionChainTailSha256,
                }
              : {}),
            selectedSubscriptionSetSha256:
              checkpointRegistryQuorumBaseline.selectedSubscriptionSetSha256,
            selectedSourceOriginSetSha256:
              checkpointRegistryQuorumBaseline.selectedSourceOriginSetSha256,
            selectedSignerSetSha256:
              checkpointRegistryQuorumBaseline.selectedSignerSetSha256,
            checkpointRegistryQuorumBaseline,
          }
        : {}),
      currentCheckpointSha256: currentCheckpoint.contentSha256,
      currentSelectionSetSha256: currentCheckpoint.selectionSetSha256,
      ...(currentCheckpoint.selectionChainTailSha256
        ? {
            currentSelectionChainTailSha256:
              currentCheckpoint.selectionChainTailSha256,
          }
        : {}),
    };
    return {
      ...content,
      contentSha256: sha256(canonicalJson(content)),
    };
  }

  async applyReceiptTrustAnchorDirectoryQuorumActivationSelection(
    threadId: string,
    activationDecisionRecordId: string,
    expectedCurrentSelectionSha256: string,
  ): Promise<ApplyReceiptTrustAnchorDirectoryQuorumActivationSelectionResult> {
    this.assertInitialized();
    this.getThread(threadId);
    return this.stateQueue.run(async () => {
      const currentSelection =
        this.state.receiptTrustAnchorDirectoryQuorumActivationSelection;
      const currentSelectionSha256 = currentSelection?.contentSha256 ?? "";
      if (expectedCurrentSelectionSha256 !== currentSelectionSha256) {
        throw new Error(
          "Receipt trust anchor directory quorum activation selection precondition failed",
        );
      }
      const record =
        this.state.receiptTrustAnchorDirectoryQuorumActivationDecisions.find(
          (candidate) => candidate.id === activationDecisionRecordId,
        );
      if (!record) {
        throw new Error(
          `Receipt trust anchor directory quorum activation decision not found: ${activationDecisionRecordId}`,
        );
      }
      if (currentSelection?.activationDecisionRecordId === record.id) {
        const selectionState =
          createReceiptTrustAnchorDirectoryQuorumActivationSelectionState(
            currentSelection,
          );
        const content = {
          applied: false,
          expectedCurrentSelectionSha256,
          selection: structuredClone(currentSelection),
          selectionState,
          ...(currentSelection.previousSelectionSha256
            ? {
                previousSelectionSha256:
                  currentSelection.previousSelectionSha256,
              }
            : {}),
        };
        return {
          ...content,
          contentSha256: sha256(canonicalJson(content)),
        };
      }
      const currentSourceAlignment =
        createReceiptTrustAnchorDirectoryQuorumActivationSourceAlignment(
          record.baseline,
          this.state.receiptTrustAnchorDirectorySubscriptions,
        );
      if (
        currentSourceAlignment.selectedSourceOriginSetSha256 !==
          record.sourceAlignment.selectedSourceOriginSetSha256 ||
        currentSourceAlignment.alignedSourceCount !==
          record.sourceAlignment.alignedSourceCount ||
        currentSourceAlignment.driftedSourceCount !== 0 ||
        currentSourceAlignment.missingSourceCount !== 0
      ) {
        throw new Error(
          "Receipt trust anchor directory quorum activation selection source alignment drifted",
        );
      }
      if (
        this.state.receiptTrustAnchorDirectoryQuorumActivationSelections
          .length >= MAX_RECEIPT_TRUST_DIRECTORY_QUORUM_ACTIVATION_DECISIONS
      ) {
        throw new Error(
          `Receipt trust anchor directory quorum activation exceeds ${MAX_RECEIPT_TRUST_DIRECTORY_QUORUM_ACTIVATION_DECISIONS} selections`,
        );
      }
      const selection =
        createReceiptTrustAnchorDirectoryQuorumActivationSelection({
          activatedByThreadId: threadId,
          activationDecisionRecord: record,
          ...(currentSelectionSha256
            ? { previousSelectionSha256: currentSelectionSha256 }
            : {}),
        });
      this.state.receiptTrustAnchorDirectoryQuorumActivationSelection =
        selection;
      this.state.receiptTrustAnchorDirectoryQuorumActivationSelections.push(
        selection,
      );
      await this.persistState();
      const selectionState =
        createReceiptTrustAnchorDirectoryQuorumActivationSelectionState(
          selection,
        );
      const content = {
        applied: true,
        expectedCurrentSelectionSha256,
        selection: structuredClone(selection),
        selectionState,
        ...(currentSelectionSha256
          ? { previousSelectionSha256: currentSelectionSha256 }
          : {}),
      };
      return {
        ...content,
        contentSha256: sha256(canonicalJson(content)),
      };
    });
  }

  async recordReceiptTrustAnchorDirectoryQuorumActivationDecision(
    signedByThreadId: string,
    result: SignReceiptTrustAnchorDirectoryQuorumActivationDecisionResult,
  ): Promise<ReceiptTrustAnchorDirectoryQuorumActivationDecisionRecord> {
    this.assertInitialized();
    this.getThread(signedByThreadId);
    return this.stateQueue.run(async () => {
      const anchor = this.state.receiptTrustAnchors.find(
        (candidate) => candidate.keyId === result.envelope.signature.keyId,
      );
      if (!anchor) {
        throw new Error(
          `Receipt trust anchor not found for key: ${result.envelope.signature.keyId}`,
        );
      }
      const verification = verifyTrustedReceiptEnvelope(result.envelope, [
        anchor,
      ]);
      if (verification.status !== "trusted") {
        throw new Error(
          `Receipt trust anchor directory quorum activation decision is not trusted: ${verification.reason}`,
        );
      }
      const existing =
        this.state.receiptTrustAnchorDirectoryQuorumActivationDecisions.find(
          (record) =>
            record.envelope.contentSha256 === result.envelope.contentSha256,
        );
      if (existing) return structuredClone(existing);
      const record =
        this.appendReceiptTrustAnchorDirectoryQuorumActivationDecision(
          signedByThreadId,
          result,
        );
      await this.persistState();
      return structuredClone(record);
    });
  }

  async createReceiptTrustAnchorDirectorySubscription(
    request: CreateReceiptTrustAnchorDirectorySubscriptionRequest,
    discovery: ReceiptTrustAnchorDirectoryDiscovery,
  ): Promise<ReceiptTrustAnchorDirectorySubscription> {
    this.assertInitialized();
    this.getThread(request.threadId);
    const subscription = createReceiptTrustAnchorDirectorySubscription(
      request,
      discovery,
    );
    return this.stateQueue.run(async () => {
      if (
        this.state.receiptTrustAnchorDirectorySubscriptions.length >=
        MAX_RECEIPT_TRUST_DIRECTORY_SUBSCRIPTIONS
      ) {
        throw new Error(
          `Workspace exceeds ${MAX_RECEIPT_TRUST_DIRECTORY_SUBSCRIPTIONS} receipt trust anchor directory subscriptions`,
        );
      }
      if (
        this.state.receiptTrustAnchorDirectorySubscriptions.some(
          (candidate) =>
            candidate.sourceUrlSha256 === subscription.sourceUrlSha256,
        )
      ) {
        throw new Error(
          "Receipt trust anchor directory subscription source already exists",
        );
      }
      this.state.receiptTrustAnchorDirectorySubscriptions.push(subscription);
      await this.persistState();
      return stripReceiptTrustAnchorDirectorySubscriptionSecrets(subscription);
    });
  }

  async updateReceiptTrustAnchorDirectorySubscription(
    subscriptionId: string,
    request: UpdateReceiptTrustAnchorDirectorySubscriptionRequest,
  ): Promise<ReceiptTrustAnchorDirectorySubscription> {
    this.assertInitialized();
    this.getThread(request.threadId);
    return this.stateQueue.run(async () => {
      const index =
        this.state.receiptTrustAnchorDirectorySubscriptions.findIndex(
          (candidate) => candidate.id === subscriptionId,
        );
      const current =
        this.state.receiptTrustAnchorDirectorySubscriptions[index];
      if (!current) {
        throw new Error(
          `Receipt trust anchor directory subscription not found: ${subscriptionId}`,
        );
      }
      if (current.revision !== request.expectedRevision) {
        throw new Error(
          "Receipt trust anchor directory subscription revision changed",
        );
      }
      if (current.claim && Date.parse(current.claim.expiresAt) > Date.now()) {
        throw new Error(
          "Receipt trust anchor directory subscription refresh is in progress",
        );
      }
      const hadExpiredClaim = current.claim !== undefined;
      delete current.claim;
      delete current.claimTokenSha256;
      const updated = updateReceiptTrustAnchorDirectorySubscriptionStatus(
        current,
        request.status,
      );
      this.state.receiptTrustAnchorDirectorySubscriptions[index] = updated;
      if (updated.revision !== current.revision || hadExpiredClaim) {
        await this.persistState();
      }
      return stripReceiptTrustAnchorDirectorySubscriptionSecrets(updated);
    });
  }

  async claimReceiptTrustAnchorDirectorySubscription(
    subscriptionId: string,
    expectedRevision: number,
    ownerId: string,
    options: { now?: Date; leaseMs?: number } = {},
  ): Promise<ReceiptTrustAnchorDirectorySubscriptionClaim> {
    this.assertInitialized();
    const owner = normalizeLeaseOwner(ownerId);
    const now = options.now ?? new Date();
    if (!Number.isFinite(now.getTime())) {
      throw new Error("Receipt trust anchor directory claim time is invalid");
    }
    const leaseMs = validateLeaseTtl(options.leaseMs ?? 30_000);
    return this.stateQueue.run(async () => {
      const subscription =
        this.state.receiptTrustAnchorDirectorySubscriptions.find(
          (candidate) => candidate.id === subscriptionId,
        );
      if (!subscription) {
        throw new Error(
          `Receipt trust anchor directory subscription not found: ${subscriptionId}`,
        );
      }
      if (subscription.revision !== expectedRevision) {
        throw new Error(
          "Receipt trust anchor directory subscription revision changed",
        );
      }
      if (
        subscription.claim &&
        Date.parse(subscription.claim.expiresAt) > now.getTime()
      ) {
        throw new Error(
          "Receipt trust anchor directory subscription refresh is in progress",
        );
      }
      const token = createLeaseToken();
      subscription.claim = {
        ownerId: owner,
        acquiredAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + leaseMs).toISOString(),
      };
      subscription.claimTokenSha256 = sha256(token);
      await this.persistState();
      return {
        subscription:
          stripReceiptTrustAnchorDirectorySubscriptionSecrets(subscription),
        sourceUrl: subscription.sourceUrl,
        token,
      };
    });
  }

  async claimDueReceiptTrustAnchorDirectorySubscriptions(
    ownerId: string,
    options: {
      now?: Date;
      leaseMs?: number;
      limit?: number;
    } = {},
  ): Promise<DueReceiptTrustAnchorDirectorySubscriptionClaims> {
    this.assertInitialized();
    const owner = normalizeLeaseOwner(ownerId);
    const now = options.now ?? new Date();
    if (!Number.isFinite(now.getTime())) {
      throw new Error("Receipt trust anchor directory claim time is invalid");
    }
    const leaseMs = validateLeaseTtl(options.leaseMs ?? 30_000);
    const limit = Math.min(Math.max(options.limit ?? 5, 1), 20);
    return this.stateQueue.run(async () => {
      const claims: ReceiptTrustAnchorDirectorySubscriptionClaim[] = [];
      const due = this.state.receiptTrustAnchorDirectorySubscriptions
        .filter(
          (subscription) =>
            subscription.status === "active" &&
            Date.parse(subscription.nextRefreshAt) <= now.getTime(),
        )
        .sort((left, right) =>
          left.nextRefreshAt.localeCompare(right.nextRefreshAt),
        );
      for (const subscription of due) {
        if (claims.length >= limit) break;
        if (
          subscription.claim &&
          Date.parse(subscription.claim.expiresAt) > now.getTime()
        ) {
          continue;
        }
        const token = createLeaseToken();
        subscription.claim = {
          ownerId: owner,
          acquiredAt: now.toISOString(),
          expiresAt: new Date(now.getTime() + leaseMs).toISOString(),
        };
        subscription.claimTokenSha256 = sha256(token);
        claims.push({
          subscription:
            stripReceiptTrustAnchorDirectorySubscriptionSecrets(subscription),
          sourceUrl: subscription.sourceUrl,
          token,
        });
      }
      if (claims.length > 0) await this.persistState();
      return { claims };
    });
  }

  async settleReceiptTrustAnchorDirectorySubscriptionClaim(
    subscriptionId: string,
    token: string,
    outcome:
      | { discovery: ReceiptTrustAnchorDirectoryDiscovery }
      | { failureSha256: string },
  ): Promise<ReceiptTrustAnchorDirectorySubscriptionRefreshResult> {
    this.assertInitialized();
    return this.stateQueue.run(async () => {
      const index =
        this.state.receiptTrustAnchorDirectorySubscriptions.findIndex(
          (candidate) => candidate.id === subscriptionId,
        );
      const current =
        this.state.receiptTrustAnchorDirectorySubscriptions[index];
      if (!current) {
        throw new Error(
          `Receipt trust anchor directory subscription not found: ${subscriptionId}`,
        );
      }
      assertLeaseToken(current.claimTokenSha256, token);
      if (!current.claim) {
        throw new Error(
          "Receipt trust anchor directory subscription claim is not active",
        );
      }
      if (Date.parse(current.claim.expiresAt) <= Date.now()) {
        throw new Error(
          "Receipt trust anchor directory subscription claim expired",
        );
      }
      const settled = settleReceiptTrustAnchorDirectorySubscriptionRefresh(
        current,
        outcome,
      );
      this.state.receiptTrustAnchorDirectorySubscriptions[index] =
        settled.persisted;
      await this.persistState();
      return settled.result;
    });
  }

  listReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptions(): ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription[] {
    this.assertInitialized();
    return this.state.receiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptions
      .map(
        stripReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionSecrets,
      )
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  getReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription(
    subscriptionId: string,
  ): ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription {
    this.assertInitialized();
    const subscription =
      this.state.receiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptions.find(
        (candidate) => candidate.id === subscriptionId,
      );
    if (!subscription) {
      throw new Error(
        `Receipt trust anchor directory quorum activation selection checkpoint subscription not found: ${subscriptionId}`,
      );
    }
    return stripReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionSecrets(
      subscription,
    );
  }

  listReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptions(): ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription[] {
    this.assertInitialized();
    return this.state.receiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptions
      .map(
        stripReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionSecrets,
      )
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  getReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription(
    subscriptionId: string,
  ): ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription {
    this.assertInitialized();
    const subscription =
      this.state.receiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptions.find(
        (candidate) => candidate.id === subscriptionId,
      );
    if (!subscription) {
      throw new Error(
        `Receipt trust anchor directory quorum activation selection rotation proposal subscription not found: ${subscriptionId}`,
      );
    }
    return stripReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionSecrets(
      subscription,
    );
  }

  getReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionRefreshSource(
    subscriptionId: string,
    threadId: string,
    expectedRevision: number,
  ): {
    subscription: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription;
    sourceUrl: string;
  } {
    this.assertInitialized();
    this.getThread(threadId);
    const subscription =
      this.state.receiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptions.find(
        (candidate) => candidate.id === subscriptionId,
      );
    if (!subscription) {
      throw new Error(
        `Receipt trust anchor directory quorum activation selection rotation proposal subscription not found: ${subscriptionId}`,
      );
    }
    if (subscription.auditThreadId !== threadId) {
      throw new Error(
        "Receipt trust anchor directory quorum activation selection rotation proposal subscription audit thread changed",
      );
    }
    if (subscription.revision !== expectedRevision) {
      throw new Error(
        "Receipt trust anchor directory quorum activation selection rotation proposal subscription revision changed",
      );
    }
    return {
      subscription:
        stripReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionSecrets(
          subscription,
        ),
      sourceUrl: subscription.sourceUrl,
    };
  }

  async createReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription(
    request: CreateReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionRequest,
    discovery: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalDiscovery,
  ): Promise<ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription> {
    this.assertInitialized();
    this.getThread(request.threadId);
    const subscription =
      createReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription(
        request,
        discovery,
      );
    return this.stateQueue.run(async () => {
      if (
        this.state
          .receiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptions
          .length >= MAX_RECEIPT_TRUST_ROTATION_PROPOSAL_SUBSCRIPTIONS
      ) {
        throw new Error(
          `Workspace exceeds ${MAX_RECEIPT_TRUST_ROTATION_PROPOSAL_SUBSCRIPTIONS} receipt trust anchor directory quorum activation selection rotation proposal subscriptions`,
        );
      }
      if (
        this.state.receiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptions.some(
          (candidate) =>
            candidate.sourceUrlSha256 === subscription.sourceUrlSha256,
        )
      ) {
        throw new Error(
          "Receipt trust anchor directory quorum activation selection rotation proposal subscription source already exists",
        );
      }
      this.state.receiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptions.push(
        subscription,
      );
      await this.persistState();
      return stripReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionSecrets(
        subscription,
      );
    });
  }

  async updateReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription(
    subscriptionId: string,
    request: UpdateReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionRequest,
  ): Promise<ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription> {
    this.assertInitialized();
    this.getThread(request.threadId);
    return this.stateQueue.run(async () => {
      const index =
        this.state.receiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptions.findIndex(
          (candidate) => candidate.id === subscriptionId,
        );
      const current =
        this.state
          .receiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptions[
          index
        ];
      if (!current) {
        throw new Error(
          `Receipt trust anchor directory quorum activation selection rotation proposal subscription not found: ${subscriptionId}`,
        );
      }
      if (current.revision !== request.expectedRevision) {
        throw new Error(
          "Receipt trust anchor directory quorum activation selection rotation proposal subscription revision changed",
        );
      }
      if (current.claim && Date.parse(current.claim.expiresAt) > Date.now()) {
        throw new Error(
          "Receipt trust anchor directory quorum activation selection rotation proposal subscription refresh is in progress",
        );
      }
      const hadExpiredClaim = current.claim !== undefined;
      delete current.claim;
      delete current.claimTokenSha256;
      const updated =
        updateReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionStatus(
          current,
          request.status,
        );
      this.state.receiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptions[
        index
      ] = updated;
      if (updated.revision !== current.revision || hadExpiredClaim) {
        await this.persistState();
      }
      return stripReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionSecrets(
        updated,
      );
    });
  }

  async refreshReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription(
    subscriptionId: string,
    threadId: string,
    expectedRevision: number,
    outcome:
      | {
          discovery: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalDiscovery;
        }
      | { failureSha256: string },
  ): Promise<ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionRefreshResult> {
    this.assertInitialized();
    this.getThread(threadId);
    return this.stateQueue.run(async () => {
      const index =
        this.state.receiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptions.findIndex(
          (candidate) => candidate.id === subscriptionId,
        );
      const current =
        this.state
          .receiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptions[
          index
        ];
      if (!current) {
        throw new Error(
          `Receipt trust anchor directory quorum activation selection rotation proposal subscription not found: ${subscriptionId}`,
        );
      }
      if (current.auditThreadId !== threadId) {
        throw new Error(
          "Receipt trust anchor directory quorum activation selection rotation proposal subscription audit thread changed",
        );
      }
      if (current.revision !== expectedRevision) {
        throw new Error(
          "Receipt trust anchor directory quorum activation selection rotation proposal subscription revision changed",
        );
      }
      if (current.claim && Date.parse(current.claim.expiresAt) > Date.now()) {
        throw new Error(
          "Receipt trust anchor directory quorum activation selection rotation proposal subscription refresh is in progress",
        );
      }
      delete current.claim;
      delete current.claimTokenSha256;
      const settled =
        settleReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionRefresh(
          current,
          outcome,
        );
      this.state.receiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptions[
        index
      ] = settled.persisted;
      await this.persistState();
      return settled.result;
    });
  }

  async claimReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription(
    subscriptionId: string,
    expectedRevision: number,
    ownerId: string,
    options: { now?: Date; leaseMs?: number } = {},
  ): Promise<ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionClaim> {
    this.assertInitialized();
    const owner = normalizeLeaseOwner(ownerId);
    const now = options.now ?? new Date();
    if (!Number.isFinite(now.getTime())) {
      throw new Error(
        "Receipt trust anchor directory quorum activation selection rotation proposal claim time is invalid",
      );
    }
    const leaseMs = validateLeaseTtl(options.leaseMs ?? 30_000);
    return this.stateQueue.run(async () => {
      const subscription =
        this.state.receiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptions.find(
          (candidate) => candidate.id === subscriptionId,
        );
      if (!subscription) {
        throw new Error(
          `Receipt trust anchor directory quorum activation selection rotation proposal subscription not found: ${subscriptionId}`,
        );
      }
      if (subscription.revision !== expectedRevision) {
        throw new Error(
          "Receipt trust anchor directory quorum activation selection rotation proposal subscription revision changed",
        );
      }
      if (
        subscription.claim &&
        Date.parse(subscription.claim.expiresAt) > now.getTime()
      ) {
        throw new Error(
          "Receipt trust anchor directory quorum activation selection rotation proposal subscription refresh is in progress",
        );
      }
      const token = createLeaseToken();
      subscription.claim = {
        ownerId: owner,
        acquiredAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + leaseMs).toISOString(),
      };
      subscription.claimTokenSha256 = sha256(token);
      await this.persistState();
      return {
        subscription:
          stripReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionSecrets(
            subscription,
          ),
        sourceUrl: subscription.sourceUrl,
        token,
      };
    });
  }

  async claimDueReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptions(
    ownerId: string,
    options: {
      now?: Date;
      leaseMs?: number;
      limit?: number;
    } = {},
  ): Promise<DueReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionClaims> {
    this.assertInitialized();
    const owner = normalizeLeaseOwner(ownerId);
    const now = options.now ?? new Date();
    if (!Number.isFinite(now.getTime())) {
      throw new Error(
        "Receipt trust anchor directory quorum activation selection rotation proposal claim time is invalid",
      );
    }
    const leaseMs = validateLeaseTtl(options.leaseMs ?? 30_000);
    const limit = Math.min(Math.max(options.limit ?? 5, 1), 20);
    return this.stateQueue.run(async () => {
      const claims: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionClaim[] =
        [];
      const due =
        this.state.receiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptions
          .filter(
            (subscription) =>
              subscription.status === "active" &&
              Date.parse(subscription.nextRefreshAt) <= now.getTime(),
          )
          .sort((left, right) =>
            left.nextRefreshAt.localeCompare(right.nextRefreshAt),
          );
      for (const subscription of due) {
        if (claims.length >= limit) break;
        if (
          subscription.claim &&
          Date.parse(subscription.claim.expiresAt) > now.getTime()
        ) {
          continue;
        }
        const token = createLeaseToken();
        subscription.claim = {
          ownerId: owner,
          acquiredAt: now.toISOString(),
          expiresAt: new Date(now.getTime() + leaseMs).toISOString(),
        };
        subscription.claimTokenSha256 = sha256(token);
        claims.push({
          subscription:
            stripReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionSecrets(
              subscription,
            ),
          sourceUrl: subscription.sourceUrl,
          token,
        });
      }
      if (claims.length > 0) await this.persistState();
      return { claims };
    });
  }

  async settleReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionClaim(
    subscriptionId: string,
    token: string,
    outcome:
      | {
          discovery: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalDiscovery;
        }
      | { failureSha256: string },
  ): Promise<ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionRefreshResult> {
    this.assertInitialized();
    return this.stateQueue.run(async () => {
      const index =
        this.state.receiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptions.findIndex(
          (candidate) => candidate.id === subscriptionId,
        );
      const current =
        this.state
          .receiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptions[
          index
        ];
      if (!current) {
        throw new Error(
          `Receipt trust anchor directory quorum activation selection rotation proposal subscription not found: ${subscriptionId}`,
        );
      }
      assertLeaseToken(current.claimTokenSha256, token);
      if (!current.claim) {
        throw new Error(
          "Receipt trust anchor directory quorum activation selection rotation proposal subscription claim is not active",
        );
      }
      if (Date.parse(current.claim.expiresAt) <= Date.now()) {
        throw new Error(
          "Receipt trust anchor directory quorum activation selection rotation proposal subscription claim expired",
        );
      }
      const settled =
        settleReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionRefresh(
          current,
          outcome,
        );
      this.state.receiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptions[
        index
      ] = settled.persisted;
      await this.persistState();
      return settled.result;
    });
  }

  async queueReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalApprovalApply(
    subscriptionId: string,
    threadId: string,
    expectedRevision: number,
    expectedSubscriptionSha256: string,
    approvalEnvelope: TrustedReceiptEnvelope<ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApproval>,
    applyAfter = new Date().toISOString(),
  ): Promise<ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription> {
    this.assertInitialized();
    this.getThread(threadId);
    return this.stateQueue.run(async () => {
      const subscription =
        this.state.receiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptions.find(
          (candidate) => candidate.id === subscriptionId,
        );
      if (!subscription) {
        throw new Error(
          `Receipt trust anchor directory quorum activation selection rotation proposal subscription not found: ${subscriptionId}`,
        );
      }
      if (subscription.auditThreadId !== threadId) {
        throw new Error(
          "Receipt trust anchor directory quorum activation selection rotation proposal approval apply audit thread changed",
        );
      }
      if (subscription.revision !== expectedRevision) {
        throw new Error(
          "Receipt trust anchor directory quorum activation selection rotation proposal approval apply revision changed",
        );
      }
      if (subscription.contentSha256 !== expectedSubscriptionSha256) {
        throw new Error(
          "Receipt trust anchor directory quorum activation selection rotation proposal approval apply precondition failed",
        );
      }
      if (!Number.isFinite(Date.parse(applyAfter))) {
        throw new Error(
          "Receipt trust anchor directory quorum activation selection rotation proposal approval apply time is invalid",
        );
      }
      if (subscription.pendingApprovalPolicyApply?.status === "pending") {
        throw new Error(
          "Receipt trust anchor directory quorum activation selection rotation proposal policy approval apply is already pending",
        );
      }
      const envelope = validateTrustedReceiptEnvelope(
        approvalEnvelope,
      ) as TrustedReceiptEnvelope<ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApproval>;
      if (
        envelope.receiptKind !==
        "receipt_trust_anchor_directory_quorum_activation_selection_rotation_proposal_subscription_approval"
      ) {
        throw new Error(
          "Receipt trust anchor directory quorum activation selection rotation proposal approval receipt kind is invalid",
        );
      }
      subscription.pendingApprovalApply = {
        status: "pending",
        queuedAt: new Date().toISOString(),
        applyAfter,
        approvalEnvelope: envelope,
        approvalEnvelopeSha256: envelope.contentSha256,
        approvalSha256: envelope.receipt.contentSha256,
      };
      await this.persistState();
      return stripReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionSecrets(
        subscription,
      );
    });
  }

  async queueReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalApprovalPolicyApply(
    subscriptionId: string,
    threadId: string,
    expectedRevision: number,
    expectedSubscriptionSha256: string,
    approvalEnvelopes: TrustedReceiptEnvelope<ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApproval>[],
    approvalPolicyInput: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicy,
    approvalPolicyBaselineSha256: string,
    applyAfter = new Date().toISOString(),
  ): Promise<ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription> {
    this.assertInitialized();
    this.getThread(threadId);
    if (!isSha256(approvalPolicyBaselineSha256)) {
      throw new Error(
        "Receipt trust anchor directory quorum activation selection rotation proposal approval policy baseline hash is invalid",
      );
    }
    const approvalPolicy =
      normalizeReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicy(
        approvalPolicyInput,
      );
    const approvalPolicySha256 = sha256(canonicalJson(approvalPolicy));
    if (!Number.isFinite(Date.parse(applyAfter))) {
      throw new Error(
        "Receipt trust anchor directory quorum activation selection rotation proposal approval policy apply time is invalid",
      );
    }
    return this.stateQueue.run(async () => {
      const subscription =
        this.state.receiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptions.find(
          (candidate) => candidate.id === subscriptionId,
        );
      if (!subscription) {
        throw new Error(
          `Receipt trust anchor directory quorum activation selection rotation proposal subscription not found: ${subscriptionId}`,
        );
      }
      if (subscription.auditThreadId !== threadId) {
        throw new Error(
          "Receipt trust anchor directory quorum activation selection rotation proposal approval policy apply audit thread changed",
        );
      }
      if (subscription.revision !== expectedRevision) {
        throw new Error(
          "Receipt trust anchor directory quorum activation selection rotation proposal approval policy apply revision changed",
        );
      }
      if (subscription.contentSha256 !== expectedSubscriptionSha256) {
        throw new Error(
          "Receipt trust anchor directory quorum activation selection rotation proposal approval policy apply precondition failed",
        );
      }
      if (subscription.pendingApprovalApply?.status === "pending") {
        throw new Error(
          "Receipt trust anchor directory quorum activation selection rotation proposal approval apply is already pending",
        );
      }
      const approvalPolicyBaseline =
        this.state.receiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaselines.find(
          (candidate) =>
            candidate.contentSha256 === approvalPolicyBaselineSha256,
        );
      if (!approvalPolicyBaseline) {
        throw new Error(
          "Receipt trust anchor directory quorum activation selection rotation proposal approval policy baseline not found",
        );
      }
      if (
        approvalPolicyBaseline.approvalPolicySha256 !== approvalPolicySha256
      ) {
        throw new Error(
          "Receipt trust anchor directory quorum activation selection rotation proposal approval policy baseline mismatch",
        );
      }
      if (
        !Array.isArray(approvalEnvelopes) ||
        approvalEnvelopes.length === 0 ||
        approvalEnvelopes.length > 20
      ) {
        throw new Error(
          "Receipt trust anchor directory quorum activation selection rotation proposal approval policy apply envelopes are invalid",
        );
      }
      const envelopes = approvalEnvelopes
        .map((approvalEnvelope) => {
          const envelope = validateTrustedReceiptEnvelope(
            approvalEnvelope,
          ) as TrustedReceiptEnvelope<ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApproval>;
          if (
            envelope.receiptKind !==
            "receipt_trust_anchor_directory_quorum_activation_selection_rotation_proposal_subscription_approval"
          ) {
            throw new Error(
              "Receipt trust anchor directory quorum activation selection rotation proposal approval receipt kind is invalid",
            );
          }
          return envelope;
        })
        .sort((left, right) =>
          left.contentSha256.localeCompare(right.contentSha256),
        );
      subscription.pendingApprovalPolicyApply = {
        status: "pending",
        queuedAt: new Date().toISOString(),
        applyAfter,
        approvalEnvelopes: envelopes,
        approvalEnvelopeSha256s: envelopes.map(
          (envelope) => envelope.contentSha256,
        ),
        approvalPolicy,
        approvalPolicySha256,
        approvalPolicyBaselineSha256,
      };
      await this.persistState();
      return stripReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionSecrets(
        subscription,
      );
    });
  }

  async claimDueReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalApprovalApplies(
    ownerId: string,
    options: {
      now?: Date;
      leaseMs?: number;
      limit?: number;
    } = {},
  ): Promise<DueReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalApprovalApplyClaims> {
    this.assertInitialized();
    const owner = normalizeLeaseOwner(ownerId);
    const now = options.now ?? new Date();
    if (!Number.isFinite(now.getTime())) {
      throw new Error(
        "Receipt trust anchor directory quorum activation selection rotation proposal approval apply claim time is invalid",
      );
    }
    const leaseMs = validateLeaseTtl(options.leaseMs ?? 30_000);
    const limit = Math.min(Math.max(options.limit ?? 5, 1), 20);
    return this.stateQueue.run(async () => {
      const claims: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalApprovalApplyClaim[] =
        [];
      const due =
        this.state.receiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptions
          .filter((subscription) => {
            const pending = subscription.pendingApprovalApply;
            return (
              subscription.status === "active" &&
              pending?.status === "pending" &&
              Date.parse(pending.applyAfter) <= now.getTime()
            );
          })
          .sort((left, right) =>
            (left.pendingApprovalApply?.applyAfter ?? "").localeCompare(
              right.pendingApprovalApply?.applyAfter ?? "",
            ),
          );
      for (const subscription of due) {
        if (claims.length >= limit) break;
        const pending = subscription.pendingApprovalApply;
        if (!pending) continue;
        if (
          pending.claim &&
          Date.parse(pending.claim.expiresAt) > now.getTime()
        ) {
          continue;
        }
        const token = createLeaseToken();
        pending.claim = {
          ownerId: owner,
          acquiredAt: now.toISOString(),
          expiresAt: new Date(now.getTime() + leaseMs).toISOString(),
        };
        pending.claimTokenSha256 = sha256(token);
        claims.push({
          subscription:
            stripReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionSecrets(
              subscription,
            ),
          approvalEnvelope: pending.approvalEnvelope,
          token,
        });
      }
      if (claims.length > 0) await this.persistState();
      return { claims };
    });
  }

  async settleReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalApprovalApplyClaim(
    subscriptionId: string,
    token: string,
    outcome: { resultSha256: string } | { failureSha256: string },
  ): Promise<ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription> {
    this.assertInitialized();
    return this.stateQueue.run(async () => {
      const subscription =
        this.state.receiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptions.find(
          (candidate) => candidate.id === subscriptionId,
        );
      if (!subscription?.pendingApprovalApply) {
        throw new Error(
          "Receipt trust anchor directory quorum activation selection rotation proposal approval apply claim is not active",
        );
      }
      const pending = subscription.pendingApprovalApply;
      assertLeaseToken(pending.claimTokenSha256, token);
      if (!pending.claim) {
        throw new Error(
          "Receipt trust anchor directory quorum activation selection rotation proposal approval apply claim is not active",
        );
      }
      if (Date.parse(pending.claim.expiresAt) <= Date.now()) {
        throw new Error(
          "Receipt trust anchor directory quorum activation selection rotation proposal approval apply claim expired",
        );
      }
      if (
        "resultSha256" in outcome &&
        !/^[a-f0-9]{64}$/.test(outcome.resultSha256)
      ) {
        throw new Error(
          "Receipt trust anchor directory quorum activation selection rotation proposal approval apply result hash is invalid",
        );
      }
      if (
        "failureSha256" in outcome &&
        !/^[a-f0-9]{64}$/.test(outcome.failureSha256)
      ) {
        throw new Error(
          "Receipt trust anchor directory quorum activation selection rotation proposal approval apply failure hash is invalid",
        );
      }
      subscription.pendingApprovalApply = {
        ...pending,
        status: "resultSha256" in outcome ? "applied" : "failed",
        settledAt: new Date().toISOString(),
        ...("resultSha256" in outcome
          ? { resultSha256: outcome.resultSha256 }
          : { failureSha256: outcome.failureSha256 }),
      };
      delete subscription.pendingApprovalApply.claim;
      delete subscription.pendingApprovalApply.claimTokenSha256;
      await this.persistState();
      return stripReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionSecrets(
        subscription,
      );
    });
  }

  async claimDueReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalApprovalPolicyApplies(
    ownerId: string,
    options: {
      now?: Date;
      leaseMs?: number;
      limit?: number;
    } = {},
  ): Promise<DueReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalApprovalPolicyApplyClaims> {
    this.assertInitialized();
    const owner = normalizeLeaseOwner(ownerId);
    const now = options.now ?? new Date();
    if (!Number.isFinite(now.getTime())) {
      throw new Error(
        "Receipt trust anchor directory quorum activation selection rotation proposal approval policy apply claim time is invalid",
      );
    }
    const leaseMs = validateLeaseTtl(options.leaseMs ?? 30_000);
    const limit = Math.min(Math.max(options.limit ?? 5, 1), 20);
    return this.stateQueue.run(async () => {
      const claims: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalApprovalPolicyApplyClaim[] =
        [];
      const due =
        this.state.receiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptions
          .filter((subscription) => {
            const pending = subscription.pendingApprovalPolicyApply;
            return (
              subscription.status === "active" &&
              pending?.status === "pending" &&
              Date.parse(pending.applyAfter) <= now.getTime()
            );
          })
          .sort((left, right) =>
            (left.pendingApprovalPolicyApply?.applyAfter ?? "").localeCompare(
              right.pendingApprovalPolicyApply?.applyAfter ?? "",
            ),
          );
      for (const subscription of due) {
        if (claims.length >= limit) break;
        const pending = subscription.pendingApprovalPolicyApply;
        if (!pending) continue;
        if (
          pending.claim &&
          Date.parse(pending.claim.expiresAt) > now.getTime()
        ) {
          continue;
        }
        const token = createLeaseToken();
        pending.claim = {
          ownerId: owner,
          acquiredAt: now.toISOString(),
          expiresAt: new Date(now.getTime() + leaseMs).toISOString(),
        };
        pending.claimTokenSha256 = sha256(token);
        claims.push({
          subscription:
            stripReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionSecrets(
              subscription,
            ),
          approvalEnvelopes: pending.approvalEnvelopes,
          approvalPolicy: pending.approvalPolicy,
          approvalPolicyBaselineSha256: pending.approvalPolicyBaselineSha256,
          token,
        });
      }
      if (claims.length > 0) await this.persistState();
      return { claims };
    });
  }

  async settleReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalApprovalPolicyApplyClaim(
    subscriptionId: string,
    token: string,
    outcome: { resultSha256: string } | { failureSha256: string },
  ): Promise<ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription> {
    this.assertInitialized();
    return this.stateQueue.run(async () => {
      const subscription =
        this.state.receiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptions.find(
          (candidate) => candidate.id === subscriptionId,
        );
      if (!subscription?.pendingApprovalPolicyApply) {
        throw new Error(
          "Receipt trust anchor directory quorum activation selection rotation proposal approval policy apply claim is not active",
        );
      }
      const pending = subscription.pendingApprovalPolicyApply;
      assertLeaseToken(pending.claimTokenSha256, token);
      if (!pending.claim) {
        throw new Error(
          "Receipt trust anchor directory quorum activation selection rotation proposal approval policy apply claim is not active",
        );
      }
      if (Date.parse(pending.claim.expiresAt) <= Date.now()) {
        throw new Error(
          "Receipt trust anchor directory quorum activation selection rotation proposal approval policy apply claim expired",
        );
      }
      if ("resultSha256" in outcome && !isSha256(outcome.resultSha256)) {
        throw new Error(
          "Receipt trust anchor directory quorum activation selection rotation proposal approval policy apply result hash is invalid",
        );
      }
      if ("failureSha256" in outcome && !isSha256(outcome.failureSha256)) {
        throw new Error(
          "Receipt trust anchor directory quorum activation selection rotation proposal approval policy apply failure hash is invalid",
        );
      }
      subscription.pendingApprovalPolicyApply = {
        ...pending,
        status: "resultSha256" in outcome ? "applied" : "failed",
        settledAt: new Date().toISOString(),
        ...("resultSha256" in outcome
          ? { resultSha256: outcome.resultSha256 }
          : { failureSha256: outcome.failureSha256 }),
      };
      delete subscription.pendingApprovalPolicyApply.claim;
      delete subscription.pendingApprovalPolicyApply.claimTokenSha256;
      await this.persistState();
      return stripReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionSecrets(
        subscription,
      );
    });
  }

  getReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorum(
    policy?: ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumPolicy,
  ): ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorum {
    this.assertInitialized();
    return createReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorum(
      this.listReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptions(),
      policy,
    );
  }

  listReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselines(): ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaseline[] {
    this.assertInitialized();
    return structuredClone(
      this.state.receiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselines
        .slice()
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
    );
  }

  async promoteReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaseline(
    promotedByThreadId: string,
    envelope: TrustedReceiptEnvelope<ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorum>,
  ): Promise<PromoteReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselineResult> {
    this.assertInitialized();
    this.getThread(promotedByThreadId);
    return this.stateQueue.run(async () => {
      const anchor = this.state.receiptTrustAnchors.find(
        (candidate) => candidate.keyId === envelope.signature.keyId,
      );
      if (!anchor) {
        throw new Error(
          `Receipt trust anchor not found for key: ${envelope.signature.keyId}`,
        );
      }
      const verification = verifyTrustedReceiptEnvelope(envelope, [anchor]);
      if (verification.status !== "trusted") {
        throw new Error(
          `Receipt trust checkpoint registry quorum baseline receipt is not trusted: ${verification.reason}`,
        );
      }
      if (envelope.receipt.status !== "agreed") {
        throw new Error(
          "Receipt trust checkpoint registry quorum baseline requires an agreed quorum",
        );
      }
      const existing =
        this.state.receiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselines.find(
          (baseline) =>
            receiptTrustCheckpointRegistryQuorumBaselineKey(
              baseline.envelope,
            ) === receiptTrustCheckpointRegistryQuorumBaselineKey(envelope),
        );
      if (existing) {
        return {
          baseline: structuredClone(existing),
          created: false,
        };
      }
      const baseline =
        this.appendReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaseline(
          promotedByThreadId,
          envelope,
        );
      await this.persistState();
      return {
        baseline: structuredClone(baseline),
        created: true,
      };
    });
  }

  async importReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaseline(
    importedByThreadId: string,
    baselineInput: unknown,
    expectedCurrentBaselineSha256: string,
    trustedAnchors: ReceiptTrustAnchor[],
  ): Promise<{
    baseline: ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaseline;
    imported: boolean;
    previousBaselineSha256?: string;
  }> {
    this.assertInitialized();
    this.getThread(importedByThreadId);
    if (
      expectedCurrentBaselineSha256 !== "" &&
      !isSha256(expectedCurrentBaselineSha256)
    ) {
      throw new Error(
        "Receipt trust checkpoint registry quorum baseline import precondition is invalid",
      );
    }
    return this.stateQueue.run(async () => {
      const current =
        this.state.receiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselines.at(
          -1,
        );
      const currentSha256 = current?.contentSha256 ?? "";
      if (currentSha256 !== expectedCurrentBaselineSha256) {
        throw new Error(
          "Receipt trust checkpoint registry quorum baseline import precondition failed",
        );
      }
      const importedBaseline =
        validateReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaseline(
          baselineInput,
          trustedAnchors,
        );
      const verification =
        verifyReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaseline(
          importedBaseline,
          trustedAnchors,
        );
      if (verification.status !== "trusted") {
        throw new Error(
          `Receipt trust checkpoint registry quorum baseline import is not trusted: ${verification.diagnostics.join(",")}`,
        );
      }
      const existing =
        this.state.receiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselines.find(
          (baseline) =>
            receiptTrustCheckpointRegistryQuorumBaselineKey(
              baseline.envelope,
            ) ===
            receiptTrustCheckpointRegistryQuorumBaselineKey(
              importedBaseline.envelope,
            ),
        );
      if (existing) {
        return {
          baseline: structuredClone(existing),
          imported: false,
          ...(current ? { previousBaselineSha256: current.contentSha256 } : {}),
        };
      }
      const baseline =
        this.appendReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaseline(
          importedByThreadId,
          importedBaseline.envelope,
        );
      await this.persistState();
      return {
        baseline: structuredClone(baseline),
        imported: true,
        ...(current ? { previousBaselineSha256: current.contentSha256 } : {}),
      };
    });
  }

  listReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaselines(): ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaseline[] {
    this.assertInitialized();
    return structuredClone(
      this.state.receiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaselines
        .slice()
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
    );
  }

  async promoteReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaseline(
    promotedByThreadId: string,
    envelope: TrustedReceiptEnvelope<ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyReview>,
  ): Promise<{
    baseline: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaseline;
    created: boolean;
  }> {
    this.assertInitialized();
    this.getThread(promotedByThreadId);
    return this.stateQueue.run(async () => {
      const anchor = this.state.receiptTrustAnchors.find(
        (candidate) => candidate.keyId === envelope.signature.keyId,
      );
      if (!anchor) {
        throw new Error(
          `Receipt trust anchor not found for key: ${envelope.signature.keyId}`,
        );
      }
      const verification = verifyTrustedReceiptEnvelope(envelope, [anchor]);
      if (verification.status !== "trusted") {
        throw new Error(
          `Receipt trust rotation approval policy baseline receipt is not trusted: ${verification.reason}`,
        );
      }
      if (envelope.receipt.status !== "accepted") {
        throw new Error(
          "Receipt trust rotation approval policy baseline requires an accepted review",
        );
      }
      const existing =
        this.state.receiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaselines.find(
          (baseline) =>
            receiptTrustRotationApprovalPolicyBaselineKey(baseline.envelope) ===
            receiptTrustRotationApprovalPolicyBaselineKey(envelope),
        );
      if (existing) {
        return {
          baseline: structuredClone(existing),
          created: false,
        };
      }
      const baseline =
        this.appendReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaseline(
          promotedByThreadId,
          envelope,
        );
      await this.persistState();
      return {
        baseline: structuredClone(baseline),
        created: true,
      };
    });
  }

  async importReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaseline(
    importedByThreadId: string,
    baselineInput: unknown,
    expectedCurrentBaselineSha256: string,
    trustedAnchors: ReceiptTrustAnchor[],
  ): Promise<{
    baseline: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaseline;
    imported: boolean;
    previousBaselineSha256?: string;
  }> {
    this.assertInitialized();
    this.getThread(importedByThreadId);
    if (
      expectedCurrentBaselineSha256 !== "" &&
      !isSha256(expectedCurrentBaselineSha256)
    ) {
      throw new Error(
        "Receipt trust rotation approval policy baseline import precondition is invalid",
      );
    }
    return this.stateQueue.run(async () => {
      const current =
        this.state.receiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaselines.at(
          -1,
        );
      const currentSha256 = current?.contentSha256 ?? "";
      if (currentSha256 !== expectedCurrentBaselineSha256) {
        throw new Error(
          "Receipt trust rotation approval policy baseline import precondition failed",
        );
      }
      const importedBaseline =
        validateReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaseline(
          baselineInput,
          trustedAnchors,
        );
      const verification =
        verifyReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaseline(
          importedBaseline,
          trustedAnchors,
        );
      if (verification.status !== "trusted") {
        throw new Error(
          `Receipt trust rotation approval policy baseline import is not trusted: ${verification.diagnostics.join(",")}`,
        );
      }
      const existing =
        this.state.receiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaselines.find(
          (baseline) =>
            receiptTrustRotationApprovalPolicyBaselineKey(baseline.envelope) ===
            receiptTrustRotationApprovalPolicyBaselineKey(
              importedBaseline.envelope,
            ),
        );
      if (existing) {
        return {
          baseline: structuredClone(existing),
          imported: false,
          ...(current ? { previousBaselineSha256: current.contentSha256 } : {}),
        };
      }
      const baseline =
        this.appendReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaseline(
          importedByThreadId,
          importedBaseline.envelope,
        );
      await this.persistState();
      return {
        baseline: structuredClone(baseline),
        imported: true,
        ...(current ? { previousBaselineSha256: current.contentSha256 } : {}),
      };
    });
  }

  async createReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription(
    request: CreateReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionRequest,
    discovery: ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointDiscovery,
  ): Promise<ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription> {
    this.assertInitialized();
    this.getThread(request.threadId);
    const subscription =
      createReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription(
        request,
        discovery,
      );
    return this.stateQueue.run(async () => {
      if (
        this.state
          .receiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptions
          .length >= MAX_RECEIPT_TRUST_CHECKPOINT_SUBSCRIPTIONS
      ) {
        throw new Error(
          `Workspace exceeds ${MAX_RECEIPT_TRUST_CHECKPOINT_SUBSCRIPTIONS} receipt trust anchor directory quorum activation selection checkpoint subscriptions`,
        );
      }
      if (
        this.state.receiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptions.some(
          (candidate) =>
            candidate.sourceUrlSha256 === subscription.sourceUrlSha256,
        )
      ) {
        throw new Error(
          "Receipt trust anchor directory quorum activation selection checkpoint subscription source already exists",
        );
      }
      this.state.receiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptions.push(
        subscription,
      );
      await this.persistState();
      return stripReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionSecrets(
        subscription,
      );
    });
  }

  async updateReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription(
    subscriptionId: string,
    request: UpdateReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionRequest,
  ): Promise<ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription> {
    this.assertInitialized();
    this.getThread(request.threadId);
    return this.stateQueue.run(async () => {
      const index =
        this.state.receiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptions.findIndex(
          (candidate) => candidate.id === subscriptionId,
        );
      const current =
        this.state
          .receiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptions[
          index
        ];
      if (!current) {
        throw new Error(
          `Receipt trust anchor directory quorum activation selection checkpoint subscription not found: ${subscriptionId}`,
        );
      }
      if (current.revision !== request.expectedRevision) {
        throw new Error(
          "Receipt trust anchor directory quorum activation selection checkpoint subscription revision changed",
        );
      }
      if (current.claim && Date.parse(current.claim.expiresAt) > Date.now()) {
        throw new Error(
          "Receipt trust anchor directory quorum activation selection checkpoint subscription refresh is in progress",
        );
      }
      const hadExpiredClaim = current.claim !== undefined;
      delete current.claim;
      delete current.claimTokenSha256;
      const updated =
        updateReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionStatus(
          current,
          request.status,
        );
      this.state.receiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptions[
        index
      ] = updated;
      if (updated.revision !== current.revision || hadExpiredClaim) {
        await this.persistState();
      }
      return stripReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionSecrets(
        updated,
      );
    });
  }

  async claimReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription(
    subscriptionId: string,
    expectedRevision: number,
    ownerId: string,
    options: { now?: Date; leaseMs?: number } = {},
  ): Promise<ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionClaim> {
    this.assertInitialized();
    const owner = normalizeLeaseOwner(ownerId);
    const now = options.now ?? new Date();
    if (!Number.isFinite(now.getTime())) {
      throw new Error(
        "Receipt trust anchor directory quorum activation selection checkpoint claim time is invalid",
      );
    }
    const leaseMs = validateLeaseTtl(options.leaseMs ?? 30_000);
    return this.stateQueue.run(async () => {
      const subscription =
        this.state.receiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptions.find(
          (candidate) => candidate.id === subscriptionId,
        );
      if (!subscription) {
        throw new Error(
          `Receipt trust anchor directory quorum activation selection checkpoint subscription not found: ${subscriptionId}`,
        );
      }
      if (subscription.revision !== expectedRevision) {
        throw new Error(
          "Receipt trust anchor directory quorum activation selection checkpoint subscription revision changed",
        );
      }
      if (
        subscription.claim &&
        Date.parse(subscription.claim.expiresAt) > now.getTime()
      ) {
        throw new Error(
          "Receipt trust anchor directory quorum activation selection checkpoint subscription refresh is in progress",
        );
      }
      const token = createLeaseToken();
      subscription.claim = {
        ownerId: owner,
        acquiredAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + leaseMs).toISOString(),
      };
      subscription.claimTokenSha256 = sha256(token);
      await this.persistState();
      return {
        subscription:
          stripReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionSecrets(
            subscription,
          ),
        sourceUrl: subscription.sourceUrl,
        token,
      };
    });
  }

  async claimDueReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptions(
    ownerId: string,
    options: {
      now?: Date;
      leaseMs?: number;
      limit?: number;
    } = {},
  ): Promise<DueReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionClaims> {
    this.assertInitialized();
    const owner = normalizeLeaseOwner(ownerId);
    const now = options.now ?? new Date();
    if (!Number.isFinite(now.getTime())) {
      throw new Error(
        "Receipt trust anchor directory quorum activation selection checkpoint claim time is invalid",
      );
    }
    const leaseMs = validateLeaseTtl(options.leaseMs ?? 30_000);
    const limit = Math.min(Math.max(options.limit ?? 5, 1), 20);
    return this.stateQueue.run(async () => {
      const claims: ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionClaim[] =
        [];
      const due =
        this.state.receiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptions
          .filter(
            (subscription) =>
              subscription.status === "active" &&
              Date.parse(subscription.nextRefreshAt) <= now.getTime(),
          )
          .sort((left, right) =>
            left.nextRefreshAt.localeCompare(right.nextRefreshAt),
          );
      for (const subscription of due) {
        if (claims.length >= limit) break;
        if (
          subscription.claim &&
          Date.parse(subscription.claim.expiresAt) > now.getTime()
        ) {
          continue;
        }
        const token = createLeaseToken();
        subscription.claim = {
          ownerId: owner,
          acquiredAt: now.toISOString(),
          expiresAt: new Date(now.getTime() + leaseMs).toISOString(),
        };
        subscription.claimTokenSha256 = sha256(token);
        claims.push({
          subscription:
            stripReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionSecrets(
              subscription,
            ),
          sourceUrl: subscription.sourceUrl,
          token,
        });
      }
      if (claims.length > 0) await this.persistState();
      return { claims };
    });
  }

  async settleReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionClaim(
    subscriptionId: string,
    token: string,
    outcome:
      | {
          discovery: ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointDiscovery;
        }
      | { failureSha256: string },
  ): Promise<ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionRefreshResult> {
    this.assertInitialized();
    return this.stateQueue.run(async () => {
      const index =
        this.state.receiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptions.findIndex(
          (candidate) => candidate.id === subscriptionId,
        );
      const current =
        this.state
          .receiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptions[
          index
        ];
      if (!current) {
        throw new Error(
          `Receipt trust anchor directory quorum activation selection checkpoint subscription not found: ${subscriptionId}`,
        );
      }
      assertLeaseToken(current.claimTokenSha256, token);
      if (!current.claim) {
        throw new Error(
          "Receipt trust anchor directory quorum activation selection checkpoint subscription claim is not active",
        );
      }
      if (Date.parse(current.claim.expiresAt) <= Date.now()) {
        throw new Error(
          "Receipt trust anchor directory quorum activation selection checkpoint subscription claim expired",
        );
      }
      const settled =
        settleReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionRefresh(
          current,
          outcome,
        );
      this.state.receiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptions[
        index
      ] = settled.persisted;
      await this.persistState();
      return settled.result;
    });
  }

  listSchedules(threadId?: string): AutomationSchedule[] {
    this.assertInitialized();
    return structuredClone(
      this.state.schedules
        .filter((schedule) => !threadId || schedule.threadId === threadId)
        .map(stripScheduleSecrets)
        .sort((left, right) => left.nextRunAt.localeCompare(right.nextRunAt)),
    );
  }

  getSchedule(scheduleId: string): AutomationSchedule {
    this.assertInitialized();
    const schedule = this.state.schedules.find(
      (candidate) => candidate.id === scheduleId,
    );
    if (!schedule) throw new Error(`Schedule not found: ${scheduleId}`);
    return structuredClone(stripScheduleSecrets(schedule));
  }

  async createSchedule(
    request: CreateAutomationScheduleRequest,
  ): Promise<AutomationSchedule> {
    this.assertInitialized();
    this.getThread(request.threadId);
    const schedule = createAutomationSchedule(request);
    return this.stateQueue.run(async () => {
      this.state.schedules.push(schedule);
      await this.persistState();
      return structuredClone(stripScheduleSecrets(schedule));
    });
  }

  async updateSchedule(
    scheduleId: string,
    request: UpdateAutomationScheduleRequest,
  ): Promise<AutomationSchedule> {
    this.assertInitialized();
    return this.stateQueue.run(async () => {
      const schedule = this.mutableSchedule(scheduleId);
      const updated: PersistedAutomationSchedule = {
        ...updateAutomationSchedule(schedule, request),
        ...(schedule.claimTokenSha256
          ? { claimTokenSha256: schedule.claimTokenSha256 }
          : {}),
      };
      const index = this.state.schedules.findIndex(
        (candidate) => candidate.id === scheduleId,
      );
      this.state.schedules[index] = updated;
      if (updated.revision !== schedule.revision) await this.persistState();
      return structuredClone(stripScheduleSecrets(updated));
    });
  }

  async claimDueSchedules(
    ownerId: string,
    options: {
      now?: Date;
      leaseMs?: number;
      limit?: number;
    } = {},
  ): Promise<DueScheduleClaims> {
    this.assertInitialized();
    const owner = normalizeLeaseOwner(ownerId);
    const now = options.now ?? new Date();
    if (!Number.isFinite(now.getTime()))
      throw new Error("Claim time is invalid");
    const leaseMs = validateLeaseTtl(options.leaseMs ?? 60_000);
    const limit = Math.min(Math.max(options.limit ?? 10, 1), 100);
    return this.stateQueue.run(async () => {
      const claims: ScheduleClaim[] = [];
      const skipped: DueScheduleClaims["skipped"] = [];
      const due = this.state.schedules
        .filter(
          (schedule) =>
            schedule.status === "active" &&
            Date.parse(schedule.nextRunAt) <= now.getTime(),
        )
        .sort((left, right) => left.nextRunAt.localeCompare(right.nextRunAt));
      let processed = 0;
      for (const schedule of due) {
        if (processed >= limit) break;
        if (
          schedule.claim &&
          Date.parse(schedule.claim.expiresAt) > now.getTime()
        ) {
          continue;
        }
        processed += 1;
        const scheduledFor = schedule.nextRunAt;
        const thread = this.mutableThread(schedule.threadId);
        if (thread.currentRunId) {
          const reason = `Skipped because thread has active run ${thread.currentRunId}`;
          schedule.lastScheduledFor = scheduledFor;
          schedule.lastError = reason;
          schedule.nextRunAt = advanceSchedule(schedule, scheduledFor, now);
          schedule.updatedAt = now.toISOString();
          schedule.revision += 1;
          delete schedule.claim;
          delete schedule.claimTokenSha256;
          skipped.push({
            schedule: structuredClone(stripScheduleSecrets(schedule)),
            scheduledFor,
            reason,
          });
          continue;
        }
        const token = createLeaseToken();
        schedule.claim = {
          ownerId: owner,
          scheduledFor,
          acquiredAt: now.toISOString(),
          expiresAt: new Date(now.getTime() + leaseMs).toISOString(),
          revision: (schedule.claim?.revision ?? 0) + 1,
        };
        schedule.claimTokenSha256 = sha256(token);
        schedule.updatedAt = now.toISOString();
        schedule.revision += 1;
        claims.push({
          schedule: structuredClone(stripScheduleSecrets(schedule)),
          token,
          scheduledFor,
        });
      }
      if (claims.length > 0 || skipped.length > 0) await this.persistState();
      return { claims, skipped };
    });
  }

  async renewScheduleClaim(
    scheduleId: string,
    token: string,
    ttlMs: number,
  ): Promise<AutomationSchedule> {
    this.assertInitialized();
    const normalizedTtl = validateLeaseTtl(ttlMs);
    return this.stateQueue.run(async () => {
      const schedule = this.mutableSchedule(scheduleId);
      assertLeaseToken(schedule.claimTokenSha256, token);
      if (!schedule.claim) throw new Error("Schedule claim is not active");
      const heartbeatAt = nowIso();
      schedule.claim = {
        ...schedule.claim,
        expiresAt: new Date(
          Date.parse(heartbeatAt) + normalizedTtl,
        ).toISOString(),
        revision: schedule.claim.revision + 1,
      };
      schedule.updatedAt = heartbeatAt;
      await this.persistState();
      return structuredClone(stripScheduleSecrets(schedule));
    });
  }

  async settleScheduleClaim(
    scheduleId: string,
    token: string,
    input: SettleScheduleClaimInput,
  ): Promise<AutomationSchedule> {
    this.assertInitialized();
    return this.stateQueue.run(async () => {
      const schedule = this.mutableSchedule(scheduleId);
      assertLeaseToken(schedule.claimTokenSha256, token);
      const claim = schedule.claim;
      if (!claim) throw new Error("Schedule claim is not active");
      if (input.runId) {
        const run = this.state.runs.find(
          (candidate) =>
            candidate.id === input.runId &&
            candidate.threadId === schedule.threadId,
        );
        if (!run) throw new Error("Schedule run does not belong to its thread");
        schedule.lastRunId = input.runId;
        schedule.lastRunAt = nowIso();
      }
      schedule.lastScheduledFor = claim.scheduledFor;
      if (input.error) schedule.lastError = input.error.slice(0, 500);
      else delete schedule.lastError;
      schedule.nextRunAt = advanceSchedule(
        schedule,
        claim.scheduledFor,
        new Date(),
      );
      delete schedule.claim;
      delete schedule.claimTokenSha256;
      schedule.updatedAt = nowIso();
      schedule.revision += 1;
      await this.persistState();
      return structuredClone(stripScheduleSecrets(schedule));
    });
  }

  listInboundChannels(): InboundChannel[] {
    this.assertInitialized();
    return structuredClone(
      this.state.channels
        .map(stripChannelSecrets)
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
    );
  }

  getInboundChannel(channelId: string): InboundChannel {
    this.assertInitialized();
    const channel = this.state.channels.find(
      (candidate) => candidate.id === channelId,
    );
    if (!channel) throw new Error(`Inbound channel not found: ${channelId}`);
    return structuredClone(stripChannelSecrets(channel));
  }

  async createInboundChannel(
    request: CreateInboundChannelRequest,
  ): Promise<CreatedInboundChannel> {
    this.assertInitialized();
    this.getThread(request.threadId);
    const policy = normalizeInboundChannelPolicy(request);
    const retryPolicy = normalizeInboundRetryPolicy(policy.retryPolicy);
    const signaturePolicy = normalizeInboundSignaturePolicy(
      policy.signaturePolicy,
    );
    const token = createLeaseToken();
    const tokenSha256 = sha256(token);
    const timestamp = nowIso();
    const channel: PersistedInboundChannel = {
      id: createId("channel"),
      type: "webhook",
      adapter: normalizeInboundChannelAdapter(request.adapter),
      name: normalizeChannelName(request.name),
      threadId: request.threadId,
      status: "active",
      tokenFingerprint: tokenSha256.slice(0, 12),
      tokenSha256,
      policyTemplate: deriveInboundChannelPolicyTemplate(
        retryPolicy,
        signaturePolicy,
      ),
      signaturePolicy,
      retryPolicy,
      revision: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    return this.stateQueue.run(async () => {
      this.state.channels.push(channel);
      await this.persistState();
      return {
        channel: structuredClone(stripChannelSecrets(channel)),
        token,
      };
    });
  }

  async setInboundChannelStatus(
    channelId: string,
    status: InboundChannel["status"],
  ): Promise<InboundChannel> {
    this.assertInitialized();
    return this.stateQueue.run(async () => {
      const channel = this.mutableInboundChannel(channelId);
      if (status !== "active" && status !== "disabled") {
        throw new Error("Inbound channel status is invalid");
      }
      if (channel.status !== status) {
        channel.status = status;
        channel.revision += 1;
        channel.updatedAt = nowIso();
        await this.persistState();
      }
      return structuredClone(stripChannelSecrets(channel));
    });
  }

  async updateInboundRetryPolicy(
    channelId: string,
    retryPolicy: InboundRetryPolicy,
  ): Promise<InboundChannel> {
    this.assertInitialized();
    const normalized = normalizeInboundRetryPolicy(retryPolicy, false);
    return this.stateQueue.run(async () => {
      const channel = this.mutableInboundChannel(channelId);
      if (
        channel.retryPolicy.maxAttempts !== normalized.maxAttempts ||
        channel.retryPolicy.baseDelayMs !== normalized.baseDelayMs
      ) {
        channel.retryPolicy = normalized;
        channel.policyTemplate = deriveInboundChannelPolicyTemplate(
          channel.retryPolicy,
          channel.signaturePolicy,
        );
        channel.revision += 1;
        channel.updatedAt = nowIso();
        await this.persistState();
      }
      return structuredClone(stripChannelSecrets(channel));
    });
  }

  async updateInboundSignaturePolicy(
    channelId: string,
    signaturePolicy: UpdateInboundSignaturePolicyRequest["signaturePolicy"],
  ): Promise<InboundChannel> {
    this.assertInitialized();
    const normalized = normalizeInboundSignaturePolicy(signaturePolicy);
    return this.stateQueue.run(async () => {
      const channel = this.mutableInboundChannel(channelId);
      if (
        channel.signaturePolicy.required !== normalized.required ||
        channel.signaturePolicy.toleranceSeconds !== normalized.toleranceSeconds
      ) {
        channel.signaturePolicy = normalized;
        channel.policyTemplate = deriveInboundChannelPolicyTemplate(
          channel.retryPolicy,
          channel.signaturePolicy,
        );
        channel.revision += 1;
        channel.updatedAt = nowIso();
        await this.persistState();
      }
      return structuredClone(stripChannelSecrets(channel));
    });
  }

  async rotateInboundChannelToken(
    channelId: string,
  ): Promise<CreatedInboundChannel> {
    this.assertInitialized();
    return this.stateQueue.run(async () => {
      const channel = this.mutableInboundChannel(channelId);
      const token = createLeaseToken();
      const tokenSha256 = sha256(token);
      channel.tokenSha256 = tokenSha256;
      channel.tokenFingerprint = tokenSha256.slice(0, 12);
      channel.revision += 1;
      channel.updatedAt = nowIso();
      await this.persistState();
      return {
        channel: structuredClone(stripChannelSecrets(channel)),
        token,
      };
    });
  }

  async acceptInboundDelivery(
    channelId: string,
    token: string,
    request: InboundMessageRequest,
  ): Promise<InboundReceipt> {
    this.assertInitialized();
    const idempotencyKey = normalizeIdempotencyKey(request.idempotencyKey);
    const message = normalizeInboundMessage(request.message);
    const bodySha256 = normalizeOptionalSha256(
      request.bodySha256,
      "Inbound body SHA-256",
    );
    const adapterCatalogSha256 = normalizeOptionalSha256(
      request.adapterCatalogSha256,
      "Inbound adapter catalog SHA-256",
    );
    const idempotencySha256 = sha256(`${channelId}\0${idempotencyKey}`);
    return this.stateQueue.run(async () => {
      const channel = this.mutableInboundChannel(channelId);
      assertHashedToken(channel.tokenSha256, token, "Inbound channel token");
      if (channel.status !== "active") {
        throw new Error("Inbound channel is disabled");
      }
      const existing = this.state.inboundDeliveries.find(
        (candidate) =>
          candidate.channelId === channelId &&
          candidate.idempotencySha256 === idempotencySha256,
      );
      if (existing) {
        return {
          delivery: structuredClone(stripDeliverySecrets(existing)),
          duplicate: true,
        };
      }
      const timestamp = nowIso();
      const deliveryId = createId("delivery");
      const delivery: PersistedInboundDelivery = {
        id: deliveryId,
        channelId,
        threadId: channel.threadId,
        idempotencyFingerprint: idempotencySha256.slice(0, 12),
        idempotencySha256,
        ...(bodySha256 ? { bodySha256 } : {}),
        ...(adapterCatalogSha256 ? { adapterCatalogSha256 } : {}),
        status: "accepted",
        triggerId: `channel:${channelId}:${deliveryId}`,
        attemptCount: 0,
        maxAttempts: channel.retryPolicy.maxAttempts,
        retryBaseMs: channel.retryPolicy.baseDelayMs,
        message,
        ...(request.model
          ? { model: normalizeInboundModel(request.model) }
          : {}),
        createdAt: timestamp,
        revision: 1,
      };
      this.state.inboundDeliveries.push(delivery);
      await this.persistState();
      return {
        delivery: structuredClone(stripDeliverySecrets(delivery)),
        duplicate: false,
      };
    });
  }

  listInboundDeliveries(channelId?: string): InboundDelivery[] {
    this.assertInitialized();
    return structuredClone(
      this.state.inboundDeliveries
        .filter((delivery) => !channelId || delivery.channelId === channelId)
        .map(stripDeliverySecrets)
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
    );
  }

  exportInboundDeadLetters(
    channelId: string,
    now = new Date(),
    currentAdapterCatalogSha256?: string,
  ): InboundDeadLetterExport {
    this.assertInitialized();
    if (!Number.isFinite(now.getTime())) {
      throw new Error("Dead-letter export time is invalid");
    }
    const normalizedCatalogSha256 = normalizeOptionalSha256(
      currentAdapterCatalogSha256,
      "Inbound adapter catalog SHA-256",
    );
    const channel = this.mutableInboundChannel(channelId);
    const deliveries = this.state.inboundDeliveries
      .filter(
        (delivery) =>
          delivery.channelId === channelId && delivery.status === "failed",
      )
      .sort(
        (left, right) =>
          left.createdAt.localeCompare(right.createdAt) ||
          left.id.localeCompare(right.id),
      )
      .map((delivery) => ({
        deliveryId: delivery.id,
        threadId: delivery.threadId,
        idempotencyFingerprint: delivery.idempotencyFingerprint,
        triggerId: delivery.triggerId,
        attemptCount: delivery.attemptCount,
        maxAttempts: delivery.maxAttempts,
        retryBaseMs: delivery.retryBaseMs,
        retryDisposition:
          delivery.attemptCount < delivery.maxAttempts
            ? ("manual_retry_available" as const)
            : ("retry_exhausted" as const),
        ...(normalizedCatalogSha256
          ? {
              qualificationStatus: inboundDeadLetterQualificationStatus(
                delivery,
                normalizedCatalogSha256,
              ),
            }
          : {}),
        messageSha256: sha256(delivery.message),
        ...(delivery.bodySha256 ? { bodySha256: delivery.bodySha256 } : {}),
        ...(delivery.adapterCatalogSha256
          ? { adapterCatalogSha256: delivery.adapterCatalogSha256 }
          : {}),
        error: delivery.error ?? "Inbound delivery failed without an error.",
        ...(delivery.runId ? { runId: delivery.runId } : {}),
        createdAt: delivery.createdAt,
        ...(delivery.lastAttemptAt
          ? { lastAttemptAt: delivery.lastAttemptAt }
          : {}),
        ...(delivery.finishedAt ? { finishedAt: delivery.finishedAt } : {}),
      }));
    const qualificationSummary = normalizedCatalogSha256
      ? inboundDeadLetterQualificationSummary(deliveries)
      : undefined;
    const content = {
      schemaVersion: 1 as const,
      channel: {
        id: channel.id,
        name: channel.name,
        threadId: channel.threadId,
        status: channel.status,
        retryPolicy: structuredClone(channel.retryPolicy),
        revision: channel.revision,
      },
      ...(normalizedCatalogSha256
        ? { currentAdapterCatalogSha256: normalizedCatalogSha256 }
        : {}),
      ...(qualificationSummary ?? {}),
      deliveryCount: deliveries.length,
      deliveries,
    };
    return {
      ...content,
      exportedAt: now.toISOString(),
      contentSha256: sha256(canonicalJson(content)),
    };
  }

  async claimInboundDelivery(
    deliveryId: string,
    now = new Date(),
  ): Promise<InboundExecution | undefined> {
    this.assertInitialized();
    const timestamp = now.toISOString();
    return this.stateQueue.run(async () => {
      const delivery = this.mutableInboundDelivery(deliveryId);
      if (delivery.status !== "accepted" && delivery.status !== "retrying") {
        return undefined;
      }
      if (
        delivery.nextAttemptAt &&
        Date.parse(delivery.nextAttemptAt) > now.getTime()
      ) {
        return undefined;
      }
      const channel = this.mutableInboundChannel(delivery.channelId);
      if (channel.status !== "active") return undefined;
      const thread = this.mutableThread(delivery.threadId);
      if (thread.currentRunId) return undefined;
      delivery.status = "running";
      delivery.attemptCount += 1;
      delivery.startedAt ??= timestamp;
      delivery.lastAttemptAt = timestamp;
      delete delivery.nextAttemptAt;
      delete delivery.finishedAt;
      delete delivery.error;
      delivery.revision += 1;
      await this.persistState();
      return {
        delivery: structuredClone(stripDeliverySecrets(delivery)),
        message: delivery.message,
        ...(delivery.model ? { model: structuredClone(delivery.model) } : {}),
      };
    });
  }

  async finishInboundDelivery(
    deliveryId: string,
    input:
      | { status: "completed"; runId: string }
      | { status: "failed"; error: string; runId?: string },
  ): Promise<InboundDelivery> {
    this.assertInitialized();
    return this.stateQueue.run(async () => {
      const delivery = this.mutableInboundDelivery(deliveryId);
      if (delivery.status === "completed" || delivery.status === "failed") {
        return structuredClone(stripDeliverySecrets(delivery));
      }
      if (delivery.status !== "running") {
        throw new Error("Inbound delivery is not running");
      }
      if (input.runId) {
        const run = this.state.runs.find(
          (candidate) =>
            candidate.id === input.runId &&
            candidate.threadId === delivery.threadId,
        );
        if (!run) throw new Error("Inbound run does not belong to its thread");
        delivery.runId = input.runId;
      }
      delivery.status = input.status;
      if (input.status === "failed") {
        delivery.error = input.error.slice(0, 500);
      } else {
        delete delivery.error;
      }
      delete delivery.nextAttemptAt;
      delivery.finishedAt = nowIso();
      delivery.revision += 1;
      await this.persistState();
      return structuredClone(stripDeliverySecrets(delivery));
    });
  }

  async scheduleInboundDeliveryRetry(
    deliveryId: string,
    error: string,
    delayMs: number,
    now = new Date(),
  ): Promise<InboundDelivery> {
    this.assertInitialized();
    if (
      !Number.isInteger(delayMs) ||
      delayMs < 1 ||
      delayMs > MAX_INBOUND_RETRY_DELAY_MS
    ) {
      throw new Error("Inbound retry delay is invalid");
    }
    const timestamp = now.toISOString();
    return this.stateQueue.run(async () => {
      const delivery = this.mutableInboundDelivery(deliveryId);
      if (delivery.status !== "running") {
        return structuredClone(stripDeliverySecrets(delivery));
      }
      delivery.error = error.slice(0, 500);
      if (delivery.attemptCount >= delivery.maxAttempts) {
        delivery.status = "failed";
        delivery.finishedAt = timestamp;
        delete delivery.nextAttemptAt;
      } else {
        delivery.status = "retrying";
        delivery.nextAttemptAt = new Date(
          now.getTime() + delayMs,
        ).toISOString();
        delete delivery.finishedAt;
      }
      delivery.revision += 1;
      await this.persistState();
      return structuredClone(stripDeliverySecrets(delivery));
    });
  }

  async retryInboundDelivery(
    channelId: string,
    deliveryId: string,
    now = new Date(),
  ): Promise<InboundDelivery> {
    this.assertInitialized();
    const timestamp = now.toISOString();
    return this.stateQueue.run(async () => {
      this.mutableInboundChannel(channelId);
      const delivery = this.mutableInboundDelivery(deliveryId);
      if (delivery.channelId !== channelId) {
        throw new Error("Inbound delivery not found in channel");
      }
      if (delivery.status !== "failed") {
        throw new Error("Only failed inbound deliveries can be retried");
      }
      if (delivery.attemptCount >= delivery.maxAttempts) {
        throw new Error("Inbound delivery retry limit is exhausted");
      }
      const run = delivery.runId
        ? this.state.runs.find((candidate) => candidate.id === delivery.runId)
        : undefined;
      if (run?.status === "queued" || run?.status === "running") {
        throw new Error("Inbound delivery run is still active");
      }
      delivery.status = "retrying";
      delivery.nextAttemptAt = timestamp;
      delete delivery.finishedAt;
      delivery.revision += 1;
      await this.persistState();
      return structuredClone(stripDeliverySecrets(delivery));
    });
  }

  listRunnableInboundDeliveryIds(now = new Date()): string[] {
    this.assertInitialized();
    const timestamp = now.getTime();
    return this.state.inboundDeliveries
      .filter(
        (delivery) =>
          delivery.status === "accepted" ||
          (delivery.status === "retrying" &&
            (!delivery.nextAttemptAt ||
              Date.parse(delivery.nextAttemptAt) <= timestamp)),
      )
      .map((delivery) => delivery.id);
  }

  listThreads(): ThreadSummary[] {
    this.assertInitialized();
    return structuredClone(
      [...this.state.threads].sort((left, right) =>
        right.updatedAt.localeCompare(left.updatedAt),
      ),
    );
  }

  getThread(threadId: string): ThreadRecord {
    this.assertInitialized();
    const thread = this.state.threads.find((item) => item.id === threadId);
    if (!thread) throw new Error(`Thread not found: ${threadId}`);
    return structuredClone(thread);
  }

  listRuns(threadId: string): RunRecord[] {
    this.assertInitialized();
    return structuredClone(
      this.state.runs
        .filter((run) => run.threadId === threadId)
        .map(stripRunSecrets),
    );
  }

  getRunByTriggerId(triggerId: string): RunRecord | undefined {
    this.assertInitialized();
    const run = this.state.runs.find(
      (candidate) => candidate.triggerId === triggerId,
    );
    return run ? structuredClone(stripRunSecrets(run)) : undefined;
  }

  listAutomaticRecoveryAssessments(
    threadId?: string,
  ): AutomaticRecoveryAssessment[] {
    this.assertInitialized();
    return structuredClone(
      this.state.automaticRecoveryAssessments
        .filter((assessment) => !threadId || assessment.threadId === threadId)
        .sort((left, right) => left.assessedAt.localeCompare(right.assessedAt)),
    );
  }

  listAutomaticRecoveryAttempts(threadId?: string): AutomaticRecoveryAttempt[] {
    this.assertInitialized();
    return structuredClone(
      this.state.automaticRecoveryAttempts
        .filter((attempt) => !threadId || attempt.threadId === threadId)
        .map(stripAutomaticRecoverySecrets)
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
    );
  }

  getAutomaticRecoveryAttempt(attemptId: string): AutomaticRecoveryAttempt {
    this.assertInitialized();
    const attempt = this.state.automaticRecoveryAttempts.find(
      (candidate) => candidate.id === attemptId,
    );
    if (!attempt) {
      throw new Error(`Automatic recovery attempt not found: ${attemptId}`);
    }
    return structuredClone(stripAutomaticRecoverySecrets(attempt));
  }

  async claimAutomaticRecoveries(
    ownerId: string,
    options: {
      now?: Date;
      leaseMs?: number;
      limit?: number;
    } = {},
  ): Promise<AutomaticRecoveryClaims> {
    this.assertInitialized();
    const owner = normalizeLeaseOwner(ownerId);
    const leaseMs = validateLeaseTtl(options.leaseMs ?? 60_000);
    const now = options.now ?? new Date();
    if (!Number.isFinite(now.getTime())) {
      throw new Error("Automatic recovery claim time is invalid");
    }
    const limit =
      options.limit === undefined
        ? 8
        : boundedStoreInteger(
            options.limit,
            "Automatic recovery claim limit",
            1,
            32,
          );
    return this.stateQueue.run(async () => {
      const timestamp = now.toISOString();
      const claims: AutomaticRecoveryClaim[] = [];
      const skipped: AutomaticRecoveryAssessment[] = [];
      const settled: AutomaticRecoveryAttempt[] = [];
      let deferred = 0;
      let changed = false;

      for (
        let index = 0;
        index < this.state.automaticRecoveryAttempts.length;
        index += 1
      ) {
        const current = this.state.automaticRecoveryAttempts[index]!;
        if (current.status !== "claimed" && current.status !== "running") {
          continue;
        }
        const recoveryRun = current.recoveryRunId
          ? this.state.runs.find(
              (candidate) => candidate.id === current.recoveryRunId,
            )
          : undefined;
        if (
          recoveryRun &&
          recoveryRun.status !== "queued" &&
          recoveryRun.status !== "running"
        ) {
          const updated = settleAutomaticRecoveryAttemptRecord(
            current,
            recoveryRun,
            timestamp,
          );
          this.state.automaticRecoveryAttempts[index] = updated;
          settled.push(stripAutomaticRecoverySecrets(updated));
          changed = true;
          continue;
        }
        if (
          current.status === "claimed" &&
          !current.recoveryRunId &&
          current.claim &&
          Date.parse(current.claim.expiresAt) <= now.getTime() &&
          claims.length < limit
        ) {
          const assessment = this.state.automaticRecoveryAssessments.find(
            (candidate) => candidate.contentSha256 === current.assessmentSha256,
          );
          if (!assessment) {
            throw new Error(
              `Automatic recovery assessment is missing: ${current.id}`,
            );
          }
          const token = createLeaseToken();
          const updated = reissueAutomaticRecoveryClaim(
            current,
            owner,
            token,
            timestamp,
            leaseMs,
          );
          this.state.automaticRecoveryAttempts[index] = updated;
          claims.push({
            assessment: structuredClone(assessment),
            attempt: stripAutomaticRecoverySecrets(updated),
            token,
          });
          changed = true;
        }
      }

      const candidates = this.state.runs
        .filter((run) => run.status === "interrupted")
        .filter(
          (run) =>
            !this.state.runs.some(
              (candidate) =>
                candidate.threadId === run.threadId &&
                candidate.source === "recovery" &&
                candidate.parentRunId === run.id,
            ),
        )
        .filter(
          (run) =>
            !this.state.automaticRecoveryAssessments.some(
              (assessment) => assessment.runId === run.id,
            ),
        )
        .sort((left, right) =>
          (
            left.interruptedAt ??
            left.finishedAt ??
            left.startedAt
          ).localeCompare(
            right.interruptedAt ?? right.finishedAt ?? right.startedAt,
          ),
        );

      for (const run of candidates) {
        if (claims.length >= limit) break;
        const thread = this.state.threads.find(
          (candidate) => candidate.id === run.threadId,
        );
        if (
          !thread ||
          thread.status !== "waiting" ||
          thread.currentRunId !== undefined
        ) {
          continue;
        }
        const chain = automaticRecoveryRoot(this.state.runs, run);
        const priorAttempts = this.state.automaticRecoveryAttempts.filter(
          (attempt) => attempt.rootRunId === chain.rootRunId,
        ).length;
        const events = this.requireLedger().listEvents(run.threadId);
        const assessment = assessAutomaticRecovery({
          run: stripRunSecrets(run),
          events,
          rootRunId: chain.rootRunId,
          priorAttempts,
          chainTrusted: chain.trusted && !thread.importProvenance,
          assessedAt: now,
        });
        if (
          assessment.eligible &&
          Date.parse(assessment.eligibleAt) > now.getTime()
        ) {
          deferred += 1;
          continue;
        }
        this.state.automaticRecoveryAssessments.push(assessment);
        changed = true;
        if (!assessment.eligible) {
          skipped.push(structuredClone(assessment));
          continue;
        }
        const token = createLeaseToken();
        const attempt = createAutomaticRecoveryAttemptRecord(
          assessment,
          owner,
          token,
          timestamp,
          leaseMs,
        );
        this.state.automaticRecoveryAttempts.push(attempt);
        claims.push({
          assessment: structuredClone(assessment),
          attempt: stripAutomaticRecoverySecrets(attempt),
          token,
        });
      }
      if (changed) await this.persistState();
      return { claims, skipped, settled, deferred };
    });
  }

  async renewAutomaticRecoveryClaim(
    attemptId: string,
    token: string,
    ttlMs: number,
  ): Promise<AutomaticRecoveryAttempt> {
    this.assertInitialized();
    const normalizedTtl = validateLeaseTtl(ttlMs);
    return this.stateQueue.run(async () => {
      const index = this.state.automaticRecoveryAttempts.findIndex(
        (candidate) => candidate.id === attemptId,
      );
      const current = this.state.automaticRecoveryAttempts[index];
      if (
        !current ||
        (current.status !== "claimed" && current.status !== "running") ||
        !current.claim
      ) {
        throw new Error("Automatic recovery claim is not active");
      }
      assertLeaseToken(current.claimTokenSha256, token);
      if (Date.parse(current.claim.expiresAt) <= Date.now()) {
        throw new Error("Automatic recovery claim has expired");
      }
      const heartbeatAt = nowIso();
      const updated = withAutomaticRecoveryAttemptHash({
        ...current,
        claim: {
          ...current.claim,
          heartbeatAt,
          expiresAt: new Date(
            Date.parse(heartbeatAt) + normalizedTtl,
          ).toISOString(),
          revision: current.claim.revision + 1,
        },
        updatedAt: heartbeatAt,
        revision: current.revision + 1,
      });
      this.state.automaticRecoveryAttempts[index] = updated;
      await this.persistState();
      return stripAutomaticRecoverySecrets(updated);
    });
  }

  async bindAutomaticRecoveryRun(
    attemptId: string,
    token: string,
    recoveryRunId: string,
  ): Promise<AutomaticRecoveryAttempt> {
    this.assertInitialized();
    return this.stateQueue.run(async () => {
      const index = this.state.automaticRecoveryAttempts.findIndex(
        (candidate) => candidate.id === attemptId,
      );
      const current = this.state.automaticRecoveryAttempts[index];
      if (!current || current.status !== "claimed" || !current.claim) {
        throw new Error("Automatic recovery attempt cannot bind a Run");
      }
      assertLeaseToken(current.claimTokenSha256, token);
      const run = this.state.runs.find(
        (candidate) => candidate.id === recoveryRunId,
      );
      if (
        !run ||
        run.threadId !== current.threadId ||
        run.agentId !== current.agentId ||
        run.source !== "recovery" ||
        run.parentRunId !== current.interruptedRunId ||
        run.triggerId !== current.triggerId ||
        (run.status !== "queued" && run.status !== "running")
      ) {
        throw new Error("Automatic recovery Run binding is invalid");
      }
      const updated = withAutomaticRecoveryAttemptHash({
        ...current,
        status: "running",
        recoveryRunId: run.id,
        startedAt: run.startedAt,
        updatedAt: nowIso(),
        revision: current.revision + 1,
      });
      this.state.automaticRecoveryAttempts[index] = updated;
      await this.persistState();
      return stripAutomaticRecoverySecrets(updated);
    });
  }

  async settleAutomaticRecoveryAttempt(
    attemptId: string,
    token: string,
    recoveryRunId: string,
  ): Promise<AutomaticRecoveryAttempt> {
    this.assertInitialized();
    return this.stateQueue.run(async () => {
      const index = this.state.automaticRecoveryAttempts.findIndex(
        (candidate) => candidate.id === attemptId,
      );
      const current = this.state.automaticRecoveryAttempts[index];
      if (
        !current ||
        (current.status !== "claimed" && current.status !== "running")
      ) {
        throw new Error("Automatic recovery attempt is not active");
      }
      assertLeaseToken(current.claimTokenSha256, token);
      const run = this.state.runs.find(
        (candidate) => candidate.id === recoveryRunId,
      );
      if (
        !run ||
        run.triggerId !== current.triggerId ||
        run.parentRunId !== current.interruptedRunId ||
        run.status === "queued" ||
        run.status === "running"
      ) {
        throw new Error("Automatic recovery Run is not settled");
      }
      const updated = settleAutomaticRecoveryAttemptRecord(
        current,
        run,
        nowIso(),
      );
      this.state.automaticRecoveryAttempts[index] = updated;
      await this.persistState();
      return stripAutomaticRecoverySecrets(updated);
    });
  }

  async abandonAutomaticRecoveryAttempt(
    attemptId: string,
    token: string,
    error: string,
  ): Promise<AutomaticRecoveryAttempt> {
    this.assertInitialized();
    return this.stateQueue.run(async () => {
      const index = this.state.automaticRecoveryAttempts.findIndex(
        (candidate) => candidate.id === attemptId,
      );
      const current = this.state.automaticRecoveryAttempts[index];
      if (
        !current ||
        current.status !== "claimed" ||
        current.recoveryRunId ||
        !current.claim
      ) {
        throw new Error("Automatic recovery attempt cannot be abandoned");
      }
      assertLeaseToken(current.claimTokenSha256, token);
      const timestamp = nowIso();
      const {
        claim: _claim,
        claimTokenSha256: _claimTokenSha256,
        ...withoutClaim
      } = current;
      const updated = withAutomaticRecoveryAttemptHash({
        ...withoutClaim,
        status: "abandoned",
        error: normalizeAutomaticRecoveryError(error),
        updatedAt: timestamp,
        finishedAt: timestamp,
        revision: current.revision + 1,
      });
      this.state.automaticRecoveryAttempts[index] = updated;
      await this.persistState();
      return stripAutomaticRecoverySecrets(updated);
    });
  }

  listPlans(threadId: string): ExecutionPlan[] {
    this.assertInitialized();
    this.getThread(threadId);
    return structuredClone(
      this.state.plans
        .filter((plan) => plan.threadId === threadId)
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
    );
  }

  getPlan(planId: string): ExecutionPlan {
    this.assertInitialized();
    const plan = this.state.plans.find((candidate) => candidate.id === planId);
    if (!plan) throw new Error(`Plan not found: ${planId}`);
    return structuredClone(plan);
  }

  listExecutionPlanBlueprints(
    status?: ExecutionPlanBlueprintRecord["status"],
  ): ExecutionPlanBlueprintRecord[] {
    this.assertInitialized();
    return structuredClone(
      this.state.executionPlanBlueprints
        .filter((record) => (status ? record.status === status : true))
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    );
  }

  getExecutionPlanBlueprintRecord(
    recordId: string,
  ): ExecutionPlanBlueprintRecord {
    this.assertInitialized();
    const record = this.state.executionPlanBlueprints.find(
      (candidate) => candidate.id === recordId,
    );
    if (!record) {
      throw new Error(`Execution plan blueprint not found: ${recordId}`);
    }
    return structuredClone(record);
  }

  async saveExecutionPlanBlueprint(
    threadId: string,
    request: SaveExecutionPlanBlueprintRequest,
  ): Promise<SaveExecutionPlanBlueprintResult> {
    this.assertInitialized();
    this.getThread(threadId);
    const blueprint = validateExecutionPlanBlueprint(request.blueprint);
    return this.stateQueue.run(async () => {
      const existing = this.state.executionPlanBlueprints.find(
        (record) =>
          record.status === "active" &&
          record.blueprintSha256 === blueprint.contentSha256,
      );
      if (existing) {
        return {
          record: structuredClone(existing),
          created: false,
        };
      }
      const record = createExecutionPlanBlueprintRecord({
        id: createId("blueprint"),
        blueprint,
        createdByThreadId: threadId,
        createdAt: nowIso(),
        ...(request.name ? { name: request.name } : {}),
        ...(request.description !== undefined
          ? { description: request.description }
          : {}),
      });
      this.state.executionPlanBlueprints.push(record);
      await this.persistState();
      return {
        record: structuredClone(record),
        created: true,
      };
    });
  }

  async setExecutionPlanBlueprintRecordStatus(
    recordId: string,
    request: SetExecutionPlanBlueprintRecordStatusRequest,
  ): Promise<ExecutionPlanBlueprintRecord> {
    this.assertInitialized();
    return this.stateQueue.run(async () => {
      const index = this.state.executionPlanBlueprints.findIndex(
        (candidate) => candidate.id === recordId,
      );
      const current = this.state.executionPlanBlueprints[index];
      if (!current) {
        throw new Error(`Execution plan blueprint not found: ${recordId}`);
      }
      const updated = setExecutionPlanBlueprintRecordStatus(
        current,
        request.status,
        nowIso(),
      );
      this.state.executionPlanBlueprints[index] = updated;
      await this.persistState();
      return structuredClone(updated);
    });
  }

  async qualifyExecutionPlanBlueprintRecord(
    recordId: string,
  ): Promise<ExecutionPlanBlueprintRecordQualification> {
    this.assertInitialized();
    return qualifyExecutionPlanBlueprintRecordProjection(this, recordId);
  }

  async getExecutionPlanBlueprintRecordReplayHistory(
    recordId: string,
  ): Promise<ExecutionPlanBlueprintRecordReplayHistory> {
    this.assertInitialized();
    this.getExecutionPlanBlueprintRecord(recordId);
    const replays: ExecutionPlanBlueprintRecordReplay[] = [];
    for (const thread of this.state.threads) {
      const events = await this.listEvents(thread.id);
      for (const event of events) {
        const replay = executionPlanBlueprintRecordReplayFromEvent(
          event,
          recordId,
        );
        if (replay) replays.push(replay);
      }
    }
    return createExecutionPlanBlueprintRecordReplayHistory(recordId, replays);
  }

  async verifyExecutionPlanBlueprintRecordReplayHistory(
    recordId: string,
    input: unknown,
  ): Promise<ExecutionPlanBlueprintRecordReplayHistoryVerification> {
    this.assertInitialized();
    this.getExecutionPlanBlueprintRecord(recordId);
    const observed =
      await this.getExecutionPlanBlueprintRecordReplayHistory(recordId);
    return verifyExecutionPlanBlueprintRecordReplayHistoryProjection(
      input,
      recordId,
      observed,
    );
  }

  async getExecutionPlanBlueprintRecordReplayOutcomes(
    recordId: string,
  ): Promise<ExecutionPlanBlueprintRecordReplayOutcomes> {
    this.assertInitialized();
    this.getExecutionPlanBlueprintRecord(recordId);
    const history =
      await this.getExecutionPlanBlueprintRecordReplayHistory(recordId);
    const outcomes = history.replays.map((replay) =>
      createExecutionPlanBlueprintRecordReplayOutcome(
        replay,
        this.state.plans.find((plan) => plan.id === replay.planId),
      ),
    );
    return createExecutionPlanBlueprintRecordReplayOutcomes(
      recordId,
      history.contentSha256,
      outcomes,
    );
  }

  async verifyExecutionPlanBlueprintRecordReplayOutcomes(
    recordId: string,
    input: unknown,
  ): Promise<ExecutionPlanBlueprintRecordReplayOutcomesVerification> {
    this.assertInitialized();
    this.getExecutionPlanBlueprintRecord(recordId);
    const observed =
      await this.getExecutionPlanBlueprintRecordReplayOutcomes(recordId);
    return verifyExecutionPlanBlueprintRecordReplayOutcomesProjection(
      input,
      recordId,
      observed,
    );
  }

  listExecutionPlanBlueprintRecordOutcomeBaselines(
    recordId: string,
  ): ExecutionPlanBlueprintRecordOutcomeBaseline[] {
    this.assertInitialized();
    this.getExecutionPlanBlueprintRecord(recordId);
    return structuredClone(
      this.state.executionPlanBlueprintOutcomeBaselines
        .filter((baseline) => baseline.recordId === recordId)
        .sort((left, right) => left.promotedAt.localeCompare(right.promotedAt)),
    );
  }

  async promoteExecutionPlanBlueprintRecordOutcomeBaseline(
    recordId: string,
    request: PromoteExecutionPlanBlueprintRecordOutcomeBaselineRequest,
  ): Promise<PromoteExecutionPlanBlueprintRecordOutcomeBaselineResult> {
    this.assertInitialized();
    this.getExecutionPlanBlueprintRecord(recordId);
    const policy = normalizeExecutionPlanBlueprintOutcomeBaselinePolicy(
      request.policy,
    );
    const observed =
      await this.getExecutionPlanBlueprintRecordReplayOutcomes(recordId);
    const verification =
      verifyExecutionPlanBlueprintRecordReplayOutcomesProjection(
        request.outcomes,
        recordId,
        observed,
      );
    if (verification.status !== "valid") {
      throw new Error(
        "Execution plan blueprint outcome baseline requires current outcomes",
      );
    }
    const policyDiagnostics = executionPlanBlueprintOutcomePolicyDiagnostics(
      observed,
      policy,
    );
    if (policyDiagnostics.length > 0) {
      throw new Error(
        `Execution plan blueprint outcome baseline policy failed: ${policyDiagnostics.join(",")}`,
      );
    }
    const hasReview = request.review !== undefined;
    const reviewGate =
      hasReview || request.reviewGate !== undefined
        ? normalizeExecutionPlanBlueprintOutcomeBaselineReviewGate(
            request.reviewGate,
          )
        : undefined;
    if (reviewGate && !hasReview) {
      throw new Error(
        "Execution plan blueprint outcome baseline requires reviewed outcomes",
      );
    }
    const reviewEvidence = hasReview
      ? createExecutionPlanBlueprintOutcomeBaselineReviewEvidence({
          recordId,
          review: request.review,
          outcomes: observed,
          sourceQualification:
            await this.qualifyExecutionPlanBlueprintRecord(recordId),
          outcomeQualification:
            await this.qualifyExecutionPlanBlueprintRecordOutcomes(recordId),
          reviewGate:
            reviewGate ??
            DEFAULT_EXECUTION_PLAN_BLUEPRINT_OUTCOME_BASELINE_REVIEW_GATE,
        })
      : undefined;
    return this.stateQueue.run(async () => {
      const latest = this.state.executionPlanBlueprintOutcomeBaselines
        .filter((baseline) => baseline.recordId === recordId)
        .sort((left, right) => left.promotedAt.localeCompare(right.promotedAt))
        .at(-1);
      if (
        latest &&
        latest.replayOutcomesSha256 === observed.contentSha256 &&
        JSON.stringify(latest.policy) === JSON.stringify(policy) &&
        (latest.reviewSha256 ?? "") === (reviewEvidence?.reviewSha256 ?? "") &&
        JSON.stringify(latest.reviewGate ?? null) ===
          JSON.stringify(reviewEvidence?.reviewGate ?? null)
      ) {
        return {
          baseline: structuredClone(latest),
          created: false,
        };
      }
      const baseline = createExecutionPlanBlueprintOutcomeBaseline({
        id: createId("outcome_base"),
        recordId,
        outcomes: observed,
        policy,
        ...(reviewEvidence ? { reviewEvidence } : {}),
        promotedAt: nowIso(),
        ...(latest ? { supersedesBaselineId: latest.id } : {}),
      });
      this.state.executionPlanBlueprintOutcomeBaselines.push(baseline);
      await this.persistState();
      return {
        baseline: structuredClone(baseline),
        created: true,
      };
    });
  }

  async qualifyExecutionPlanBlueprintRecordOutcomes(
    recordId: string,
  ): Promise<ExecutionPlanBlueprintRecordOutcomeQualification> {
    this.assertInitialized();
    this.getExecutionPlanBlueprintRecord(recordId);
    const outcomes =
      await this.getExecutionPlanBlueprintRecordReplayOutcomes(recordId);
    const latest = this.state.executionPlanBlueprintOutcomeBaselines
      .filter((baseline) => baseline.recordId === recordId)
      .sort((left, right) => left.promotedAt.localeCompare(right.promotedAt))
      .at(-1);
    return createExecutionPlanBlueprintOutcomeQualification(
      recordId,
      outcomes,
      latest,
    );
  }

  async selectExecutionPlanBlueprintRecord(
    threadId: string,
    request: SelectExecutionPlanBlueprintRecordRequest = {},
  ): Promise<ExecutionPlanBlueprintRecordSelection> {
    this.assertInitialized();
    this.getThread(threadId);
    const objective = normalizeExecutionPlanBlueprintSelectionObjective(
      request.objective,
    );
    const recommendationPolicy =
      normalizeExecutionPlanBlueprintRecommendationPolicy(
        request.policyTemplate,
      );
    const policyOverrides =
      this.state.executionPlanBlueprintRecommendationPolicyOverrides.map(
        validateExecutionPlanBlueprintRecommendationPolicyOverride,
      );
    const policyOverrideByFamilySha256 = new Map(
      policyOverrides.map((override) => [override.familySha256, override]),
    );
    const candidateInputs: Array<{
      record: ExecutionPlanBlueprintRecord;
      sourceQualification: ExecutionPlanBlueprintRecordQualification;
      outcomeQualification: ExecutionPlanBlueprintRecordOutcomeQualification;
      latestBaseline?: ExecutionPlanBlueprintRecordOutcomeBaseline;
      preview?: ExecutionPlanBlueprintRecordPreview;
      entry: ExecutionPlanBlueprintPortfolioCalibrationEntry;
    }> = [];
    const entries: ExecutionPlanBlueprintPortfolioCalibrationEntry[] = [];
    const records = [...this.state.executionPlanBlueprints].sort(
      compareExecutionPlanBlueprintRecords,
    );
    for (const record of records) {
      const sourceQualification =
        await this.qualifyExecutionPlanBlueprintRecord(record.id);
      const outcomeQualification =
        await this.qualifyExecutionPlanBlueprintRecordOutcomes(record.id);
      const latestBaseline = this.state.executionPlanBlueprintOutcomeBaselines
        .filter((baseline) => baseline.recordId === record.id)
        .sort((left, right) => left.promotedAt.localeCompare(right.promotedAt))
        .at(-1);
      const preview =
        sourceQualification.status === "qualified" &&
        outcomeQualification.status === "qualified"
          ? await this.previewPlanFromBlueprintRecord(threadId, {
              recordId: record.id,
              ...(objective ? { objective } : {}),
            })
          : undefined;
      const entry = createExecutionPlanBlueprintPortfolioCalibrationEntry({
        record,
        sourceQualification,
        outcomeQualification,
        ...(latestBaseline ? { latestBaseline } : {}),
      });
      entries.push(entry);
      candidateInputs.push({
        record,
        sourceQualification,
        outcomeQualification,
        entry,
        ...(latestBaseline ? { latestBaseline } : {}),
        ...(preview ? { preview } : {}),
      });
    }
    const families =
      createExecutionPlanBlueprintPortfolioCalibrationFamilies(entries);
    const familyBySha256 = new Map(
      families.map((family) => [family.familySha256, family]),
    );
    const candidates = candidateInputs.map((input) => {
      const family = familyBySha256.get(input.entry.familySha256);
      if (!family) {
        throw new Error("Execution plan blueprint portfolio family missing");
      }
      const familyPolicyOverride =
        request.policyTemplate === undefined
          ? policyOverrideByFamilySha256.get(family.familySha256)
          : undefined;
      const candidateRecommendationPolicy =
        familyPolicyOverride?.recommendationPolicy ?? recommendationPolicy;
      const recommendationPolicySource: ExecutionPlanBlueprintRecommendationPolicySource =
        request.policyTemplate !== undefined
          ? "request"
          : familyPolicyOverride
            ? "family_override"
            : "default";
      return createExecutionPlanBlueprintSelectionCandidate({
        record: input.record,
        sourceQualification: input.sourceQualification,
        outcomeQualification: input.outcomeQualification,
        family,
        recommendationPolicy: candidateRecommendationPolicy,
        recommendationPolicySource,
        ...(familyPolicyOverride
          ? { familyPolicyOverrideSha256: familyPolicyOverride.contentSha256 }
          : {}),
        ...(input.latestBaseline
          ? { latestBaseline: input.latestBaseline }
          : {}),
        ...(input.preview ? { preview: input.preview } : {}),
      });
    });
    const selected = selectExecutionPlanBlueprintCandidate(candidates);
    const selectedCandidates = candidates.map((candidate) =>
      selected && candidate.recordId === selected.recordId
        ? { ...candidate, selectionStatus: "selected" as const }
        : candidate,
    );
    return createExecutionPlanBlueprintRecordSelection({
      threadId,
      candidates: selectedCandidates,
      recommendationPolicy,
      familyPolicyOverrides: policyOverrides,
      portfolioSetSha256: executionPlanBlueprintPortfolioSetSha256(entries),
      ...(objective ? { objective } : {}),
    });
  }

  async calibrateExecutionPlanBlueprintPortfolio(): Promise<ExecutionPlanBlueprintPortfolioCalibration> {
    this.assertInitialized();
    const entries =
      await this.listExecutionPlanBlueprintPortfolioCalibrationEntries();
    return createExecutionPlanBlueprintPortfolioCalibration(entries);
  }

  async backtestExecutionPlanBlueprintRecommendationPolicies(): Promise<ExecutionPlanBlueprintRecommendationPolicyBacktest> {
    this.assertInitialized();
    const entries =
      await this.listExecutionPlanBlueprintPortfolioCalibrationEntries();
    const families =
      createExecutionPlanBlueprintPortfolioCalibrationFamilies(entries);
    return createExecutionPlanBlueprintRecommendationPolicyBacktest({
      entries,
      families,
      policies: listExecutionPlanBlueprintRecommendationPolicies(),
      portfolioSetSha256: executionPlanBlueprintPortfolioSetSha256(entries),
    });
  }

  async listExecutionPlanBlueprintRecommendationPolicyOverrides(): Promise<ExecutionPlanBlueprintRecommendationPolicyOverrideList> {
    this.assertInitialized();
    const entries =
      await this.listExecutionPlanBlueprintPortfolioCalibrationEntries();
    return createExecutionPlanBlueprintRecommendationPolicyOverrideList({
      overrides: this.state.executionPlanBlueprintRecommendationPolicyOverrides,
      portfolioSetSha256: executionPlanBlueprintPortfolioSetSha256(entries),
    });
  }

  async reviewExecutionPlanBlueprintRecommendationPolicyOverrideDrift(): Promise<ExecutionPlanBlueprintRecommendationPolicyOverrideDriftReview> {
    this.assertInitialized();
    const entries =
      await this.listExecutionPlanBlueprintPortfolioCalibrationEntries();
    const families =
      createExecutionPlanBlueprintPortfolioCalibrationFamilies(entries);
    const overrides =
      this.state.executionPlanBlueprintRecommendationPolicyOverrides.map(
        validateExecutionPlanBlueprintRecommendationPolicyOverride,
      );
    return createExecutionPlanBlueprintRecommendationPolicyOverrideDriftReview({
      entries,
      families,
      overrides,
      policies: listExecutionPlanBlueprintRecommendationPolicies(),
      portfolioSetSha256: executionPlanBlueprintPortfolioSetSha256(entries),
    });
  }

  async listExecutionPlanBlueprintRecommendationPolicyOverrideRetirements(): Promise<ExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistory> {
    this.assertInitialized();
    const entries =
      await this.listExecutionPlanBlueprintPortfolioCalibrationEntries();
    const overrides =
      this.state.executionPlanBlueprintRecommendationPolicyOverrides.map(
        validateExecutionPlanBlueprintRecommendationPolicyOverride,
      );
    return createExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistory(
      {
        retirements:
          this.state
            .executionPlanBlueprintRecommendationPolicyOverrideRetirements,
        portfolioSetSha256: executionPlanBlueprintPortfolioSetSha256(entries),
        currentOverrideSetSha256:
          executionPlanBlueprintRecommendationPolicyOverrideSetSha256(
            overrides,
          ),
      },
    );
  }

  async verifyExecutionPlanBlueprintRecommendationPolicyOverrideRetirements(
    input: unknown,
  ): Promise<ExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryVerification> {
    this.assertInitialized();
    const observed =
      await this.listExecutionPlanBlueprintRecommendationPolicyOverrideRetirements();
    return verifyExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryProjection(
      input,
      observed,
    );
  }

  verifyExecutionPlanBlueprintRecommendationPolicyOverrideRetirementProofBundle(
    histories: unknown[],
  ): ExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryProofBundle {
    this.assertInitialized();
    return createExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryProofBundle(
      histories,
    );
  }

  async setExecutionPlanBlueprintRecommendationPolicyOverride(
    request: SetExecutionPlanBlueprintRecommendationPolicyOverrideRequest,
  ): Promise<ExecutionPlanBlueprintRecommendationPolicyOverride> {
    this.assertInitialized();
    return this.stateQueue.run(async () => {
      if (!isSha256(request.familySha256)) {
        throw new Error(
          "Execution plan blueprint recommendation policy override family is invalid",
        );
      }
      const recommendationPolicy =
        normalizeExecutionPlanBlueprintRecommendationPolicy(
          request.policyTemplate,
        );
      const entries =
        await this.listExecutionPlanBlueprintPortfolioCalibrationEntries();
      const portfolioSetSha256 =
        executionPlanBlueprintPortfolioSetSha256(entries);
      if (
        request.expectedPortfolioSetSha256 !== undefined &&
        request.expectedPortfolioSetSha256 !== portfolioSetSha256
      ) {
        throw new Error(
          "Execution plan blueprint recommendation policy override portfolio set changed",
        );
      }
      const family = createExecutionPlanBlueprintPortfolioCalibrationFamilies(
        entries,
      ).find((candidate) => candidate.familySha256 === request.familySha256);
      if (!family) {
        throw new Error(
          "Execution plan blueprint recommendation policy override family is missing",
        );
      }
      const override = createExecutionPlanBlueprintRecommendationPolicyOverride(
        {
          family,
          recommendationPolicy,
          portfolioSetSha256,
          updatedAt: nowIso(),
        },
      );
      const index =
        this.state.executionPlanBlueprintRecommendationPolicyOverrides.findIndex(
          (candidate) => candidate.familySha256 === request.familySha256,
        );
      if (index >= 0) {
        this.state.executionPlanBlueprintRecommendationPolicyOverrides[index] =
          override;
      } else {
        this.state.executionPlanBlueprintRecommendationPolicyOverrides.push(
          override,
        );
      }
      this.state.executionPlanBlueprintRecommendationPolicyOverrides.sort(
        (left, right) => left.familySha256.localeCompare(right.familySha256),
      );
      await this.persistState();
      return structuredClone(override);
    });
  }

  async retireExecutionPlanBlueprintRecommendationPolicyOverride(
    request: RetireExecutionPlanBlueprintRecommendationPolicyOverrideRequest,
  ): Promise<RetireExecutionPlanBlueprintRecommendationPolicyOverrideResult> {
    this.assertInitialized();
    return this.stateQueue.run(async () => {
      if (
        !isSha256(request.familySha256) ||
        !isSha256(request.expectedOverrideSha256) ||
        !isSha256(request.expectedOverrideSetSha256) ||
        !isSha256(request.expectedDriftReviewSetSha256) ||
        !isSha256(request.expectedPortfolioSetSha256)
      ) {
        throw new Error(
          "Execution plan blueprint recommendation policy override retirement request is invalid",
        );
      }
      const entries =
        await this.listExecutionPlanBlueprintPortfolioCalibrationEntries();
      const portfolioSetSha256 =
        executionPlanBlueprintPortfolioSetSha256(entries);
      if (request.expectedPortfolioSetSha256 !== portfolioSetSha256) {
        throw new Error(
          "Execution plan blueprint recommendation policy override retirement portfolio set changed",
        );
      }
      const overrides =
        this.state.executionPlanBlueprintRecommendationPolicyOverrides.map(
          validateExecutionPlanBlueprintRecommendationPolicyOverride,
        );
      const overrideSetSha256 =
        executionPlanBlueprintRecommendationPolicyOverrideSetSha256(overrides);
      if (request.expectedOverrideSetSha256 !== overrideSetSha256) {
        throw new Error(
          "Execution plan blueprint recommendation policy override retirement override set changed",
        );
      }
      const override = overrides.find(
        (candidate) => candidate.familySha256 === request.familySha256,
      );
      if (!override) {
        throw new Error(
          "Execution plan blueprint recommendation policy override retirement override is missing",
        );
      }
      if (request.expectedOverrideSha256 !== override.contentSha256) {
        throw new Error(
          "Execution plan blueprint recommendation policy override retirement override changed",
        );
      }
      const families =
        createExecutionPlanBlueprintPortfolioCalibrationFamilies(entries);
      const driftReview =
        createExecutionPlanBlueprintRecommendationPolicyOverrideDriftReview({
          entries,
          families,
          overrides,
          policies: listExecutionPlanBlueprintRecommendationPolicies(),
          portfolioSetSha256,
        });
      if (
        request.expectedDriftReviewSetSha256 !== driftReview.reviewSetSha256
      ) {
        throw new Error(
          "Execution plan blueprint recommendation policy override retirement drift review changed",
        );
      }
      const review = driftReview.reviews.find(
        (candidate) => candidate.familySha256 === request.familySha256,
      );
      if (!review || review.recommendation !== "retire") {
        throw new Error(
          "Execution plan blueprint recommendation policy override retirement is not retire recommended",
        );
      }
      this.state.executionPlanBlueprintRecommendationPolicyOverrides =
        overrides.filter(
          (candidate) => candidate.familySha256 !== request.familySha256,
        );
      const remainingOverrideSetSha256 =
        executionPlanBlueprintRecommendationPolicyOverrideSetSha256(
          this.state.executionPlanBlueprintRecommendationPolicyOverrides,
        );
      const result =
        createExecutionPlanBlueprintRecommendationPolicyOverrideRetirementResult(
          {
            override,
            portfolioSetSha256,
            overrideSetSha256,
            driftReviewSetSha256: driftReview.reviewSetSha256,
            remainingOverrideSetSha256,
            retiredAt: nowIso(),
          },
        );
      this.state.executionPlanBlueprintRecommendationPolicyOverrideRetirements.push(
        result,
      );
      await this.persistState();
      return structuredClone(result);
    });
  }

  private async listExecutionPlanBlueprintPortfolioCalibrationEntries(): Promise<
    ExecutionPlanBlueprintPortfolioCalibrationEntry[]
  > {
    const records = [...this.state.executionPlanBlueprints].sort(
      compareExecutionPlanBlueprintRecords,
    );
    const entries: ExecutionPlanBlueprintPortfolioCalibrationEntry[] = [];
    for (const record of records) {
      const sourceQualification =
        await this.qualifyExecutionPlanBlueprintRecord(record.id);
      const outcomeQualification =
        await this.qualifyExecutionPlanBlueprintRecordOutcomes(record.id);
      const latestBaseline = this.state.executionPlanBlueprintOutcomeBaselines
        .filter((baseline) => baseline.recordId === record.id)
        .sort((left, right) => left.promotedAt.localeCompare(right.promotedAt))
        .at(-1);
      entries.push(
        createExecutionPlanBlueprintPortfolioCalibrationEntry({
          record,
          sourceQualification,
          outcomeQualification,
          ...(latestBaseline ? { latestBaseline } : {}),
        }),
      );
    }
    return entries;
  }

  async verifyExecutionPlanBlueprintRecordReplayEvent(
    recordId: string,
    request: VerifyExecutionPlanBlueprintRecordReplayEventRequest,
  ): Promise<ExecutionPlanBlueprintRecordReplayEventVerification> {
    this.assertInitialized();
    this.getExecutionPlanBlueprintRecord(recordId);
    const threadExists = this.state.threads.some(
      (thread) => thread.id === request.threadId,
    );
    const events = threadExists ? await this.listEvents(request.threadId) : [];
    return verifyExecutionPlanBlueprintRecordReplayEventProjection(
      recordId,
      request,
      events,
    );
  }

  async previewPlanFromBlueprintRecord(
    threadId: string,
    request: CreateExecutionPlanFromBlueprintRecordRequest,
  ): Promise<ExecutionPlanBlueprintRecordPreview> {
    this.assertInitialized();
    this.getThread(threadId);
    const qualification = await this.qualifyExecutionPlanBlueprintRecord(
      request.recordId,
    );
    const hasOpenPlan = this.state.plans.some(
      (candidate) =>
        candidate.threadId === threadId &&
        (candidate.status === "active" || candidate.status === "blocked"),
    );
    const base = {
      threadId,
      recordId: request.recordId,
      qualification,
      hasOpenPlan,
    };
    if (qualification.status !== "qualified") {
      return withExecutionPlanBlueprintRecordPreviewHash({
        ...base,
        status: "not_qualified",
        diagnostics: qualification.diagnostics,
      });
    }
    const record = this.state.executionPlanBlueprints.find(
      (candidate) => candidate.id === request.recordId,
    );
    if (!record || record.status !== "active") {
      return withExecutionPlanBlueprintRecordPreviewHash({
        ...base,
        status: "not_qualified",
        diagnostics: ["record_missing"],
      });
    }
    if (hasOpenPlan) {
      return withExecutionPlanBlueprintRecordPreviewHash({
        ...base,
        status: "blocked",
        diagnostics: ["thread_has_open_plan"],
      });
    }
    return withExecutionPlanBlueprintRecordPreviewHash({
      ...base,
      status: "ready",
      diagnostics: [],
      plan: createExecutionPlan(
        threadId,
        executionPlanRequestFromBlueprint(record.blueprint, request.objective),
      ),
    });
  }

  async createPlanFromBlueprintRecord(
    threadId: string,
    request: CreateExecutionPlanFromBlueprintRecordRequest,
  ): Promise<{
    plan: ExecutionPlan;
    record: ExecutionPlanBlueprintRecord;
    qualification: ExecutionPlanBlueprintRecordQualification;
    event: RunEvent;
    previewSha256: string;
  }> {
    this.assertInitialized();
    this.getThread(threadId);
    const preview = await this.previewPlanFromBlueprintRecord(
      threadId,
      request,
    );
    if (preview.status !== "ready") {
      throw new Error(
        `Execution plan blueprint record is not ready: ${preview.status}`,
      );
    }
    const expectedPreviewSha256 = normalizeOptionalSha256(
      request.expectedPreviewSha256,
      "Execution plan blueprint preview hash",
    );
    if (
      expectedPreviewSha256 !== undefined &&
      expectedPreviewSha256 !== preview.previewSha256
    ) {
      throw new Error("Execution plan blueprint preview hash mismatch");
    }
    return this.stateQueue.run(async () => {
      const record = this.state.executionPlanBlueprints.find(
        (candidate) => candidate.id === request.recordId,
      );
      if (!record || record.status !== "active") {
        throw new Error(
          `Execution plan blueprint not found: ${request.recordId}`,
        );
      }
      const plan = createExecutionPlan(
        threadId,
        executionPlanRequestFromBlueprint(record.blueprint, request.objective),
      );
      if (
        this.state.plans.some(
          (candidate) =>
            candidate.threadId === threadId &&
            (candidate.status === "active" || candidate.status === "blocked"),
        )
      ) {
        throw new Error("Thread already has an open execution plan");
      }
      this.state.plans.push(plan);
      const currentThread = this.mutableThread(threadId);
      const event: RunEvent = {
        id: createId("event"),
        threadId,
        runId: createId("runctl"),
        seq: currentThread.eventCount + 1,
        type: "plan.created",
        category: "plan",
        visibility: "user",
        createdAt: nowIso(),
        payload: {
          planId: plan.id,
          objective: plan.objective,
          status: plan.status,
          stepCount: plan.steps.length,
          artifactCount: plan.artifacts.length,
          criticalPathStepIds: plan.criticalPathStepIds,
          readyStepIds: plan.readyStepIds,
          blockedStepIds: plan.blockedStepIds,
          activePhaseIndex: plan.activePhaseIndex,
          parallelReadyStepIds: plan.parallelReadyStepIds,
          phaseWaveCount: plan.phaseWaves.length,
          phaseProjectionSha256: plan.phaseProjectionSha256,
          blueprintRecordId: record.id,
          blueprintSha256: record.blueprintSha256,
          blueprintSourcePlanId: record.sourcePlanId,
          blueprintSourcePlanRevision: record.sourcePlanRevision,
          blueprintSourceArchiveSha256: record.sourcePlanArchiveSha256,
          blueprintQualificationStatus: preview.qualification.status,
          blueprintQualificationSha256: sha256(
            JSON.stringify(preview.qualification),
          ),
          blueprintQualificationDiagnosticsSha256: sha256(
            JSON.stringify(preview.qualification.diagnostics),
          ),
          blueprintPreviewSha256: preview.previewSha256,
        },
      };
      currentThread.eventCount = event.seq;
      currentThread.updatedAt = event.createdAt;
      await this.persistState(event);
      return {
        plan: structuredClone(plan),
        record: structuredClone(record),
        qualification: structuredClone(preview.qualification),
        event: structuredClone(event),
        previewSha256: preview.previewSha256,
      };
    });
  }

  async createPlan(
    threadId: string,
    request: CreateExecutionPlanRequest,
  ): Promise<ExecutionPlan> {
    this.assertInitialized();
    this.getThread(threadId);
    const plan = createExecutionPlan(threadId, request);
    return this.stateQueue.run(async () => {
      if (
        this.state.plans.some(
          (candidate) =>
            candidate.threadId === threadId && candidate.status === "active",
        )
      ) {
        throw new Error("Thread already has an active execution plan");
      }
      this.state.plans.push(plan);
      await this.persistState();
      return structuredClone(plan);
    });
  }

  async replanPlan(
    planId: string,
    request: ReplanExecutionPlanRequest,
  ): Promise<ExecutionPlan> {
    this.assertInitialized();
    return this.stateQueue.run(async () => {
      const index = this.state.plans.findIndex(
        (candidate) => candidate.id === planId,
      );
      const current = this.state.plans[index];
      if (!current) throw new Error(`Plan not found: ${planId}`);
      const updated = replanExecutionPlan(current, request);
      this.state.plans[index] = updated;
      if (updated.revision !== current.revision) await this.persistState();
      return structuredClone(updated);
    });
  }

  async transitionPlanStep(
    planId: string,
    stepId: string,
    request: TransitionPlanStepRequest,
  ): Promise<ExecutionPlan> {
    this.assertInitialized();
    return this.stateQueue.run(async () => {
      const index = this.state.plans.findIndex(
        (candidate) => candidate.id === planId,
      );
      const current = this.state.plans[index];
      if (!current) throw new Error(`Plan not found: ${planId}`);
      if (request.action === "start") {
        if (!request.runId) {
          throw new Error("Starting a plan step requires a runId");
        }
        const run = this.state.runs.find(
          (candidate) => candidate.id === request.runId,
        );
        if (
          !run ||
          run.threadId !== current.threadId ||
          run.status !== "running"
        ) {
          throw new Error(
            "Plan steps must start in a running run from the same thread",
          );
        }
      }
      const updated = transitionPlanStep(current, stepId, request);
      this.state.plans[index] = updated;
      if (updated.revision !== current.revision) await this.persistState();
      return structuredClone(updated);
    });
  }

  async recoverCompletedWorkflowPlanStep(
    planId: string,
    stepId: string,
    runId: string,
    evidence: string,
  ): Promise<ExecutionPlan> {
    this.assertInitialized();
    return this.stateQueue.run(async () => {
      const index = this.state.plans.findIndex(
        (candidate) => candidate.id === planId,
      );
      const current = this.state.plans[index];
      if (!current) throw new Error(`Plan not found: ${planId}`);
      const run = this.state.runs.find((candidate) => candidate.id === runId);
      if (
        !run ||
        run.threadId !== current.threadId ||
        run.source !== "workflow" ||
        (run.status !== "completed" && run.status !== "interrupted")
      ) {
        throw new Error(
          "Recovered Workflow completion requires its completed or interrupted Run",
        );
      }
      const updated = recoverCompletedPlanStepProjection(
        current,
        stepId,
        runId,
        evidence,
      );
      this.state.plans[index] = updated;
      await this.persistState();
      return structuredClone(updated);
    });
  }

  async updatePlanArtifact(
    planId: string,
    artifactId: string,
    request: UpdateArtifactManifestRequest,
  ): Promise<ExecutionPlan> {
    this.assertInitialized();
    return this.stateQueue.run(async () => {
      const index = this.state.plans.findIndex(
        (candidate) => candidate.id === planId,
      );
      const current = this.state.plans[index];
      if (!current) throw new Error(`Plan not found: ${planId}`);
      if (request.sourceRunId) {
        const run = this.state.runs.find(
          (candidate) => candidate.id === request.sourceRunId,
        );
        if (!run || run.threadId !== current.threadId) {
          throw new Error(
            "Artifact sourceRunId must belong to the plan thread",
          );
        }
      }
      const updated = updateArtifactManifest(current, artifactId, request);
      this.state.plans[index] = updated;
      if (updated.revision !== current.revision) await this.persistState();
      return structuredClone(updated);
    });
  }

  listRunEvaluations(threadId: string): RunEvaluationRecord[] {
    this.assertInitialized();
    return structuredClone(
      this.state.evaluations
        .filter((evaluation) => evaluation.threadId === threadId)
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
    );
  }

  listEvaluationAdjudications(threadId: string): EvaluationAdjudication[] {
    this.assertInitialized();
    this.getThread(threadId);
    return structuredClone(
      this.state.evaluationAdjudications
        .filter((adjudication) => adjudication.threadId === threadId)
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
    );
  }

  async reviewRunEvaluation(
    threadId: string,
    evaluationId: string,
    request: ReviewRunEvaluationRequest,
  ): Promise<EvaluationAdjudication> {
    this.assertInitialized();
    this.getThread(threadId);
    return this.stateQueue.run(async () => {
      const evaluation = this.state.evaluations.find(
        (candidate) =>
          candidate.id === evaluationId && candidate.threadId === threadId,
      );
      if (!evaluation) {
        throw new Error(`Run evaluation not found: ${evaluationId}`);
      }
      const index = this.state.evaluationAdjudications.findIndex(
        (candidate) => candidate.evaluationId === evaluationId,
      );
      const current =
        index >= 0 ? this.state.evaluationAdjudications[index] : undefined;
      const updated = reviewRunEvaluationRecord(current, evaluation, request);
      if (current && updated.currentRevision === current.currentRevision) {
        return structuredClone(current);
      }
      if (index >= 0) this.state.evaluationAdjudications[index] = updated;
      else this.state.evaluationAdjudications.push(updated);
      await this.persistState();
      return structuredClone(updated);
    });
  }

  listEvaluationReviewerBallots(
    threadId: string,
    evaluationId?: string,
  ): EvaluationReviewerBallot[] {
    this.assertInitialized();
    this.getThread(threadId);
    return structuredClone(
      this.state.evaluationReviewerBallots
        .filter(
          (ballot) =>
            ballot.threadId === threadId &&
            (!evaluationId || ballot.evaluationId === evaluationId),
        )
        .sort((left, right) =>
          `${left.evaluationId}/${left.reviewerId}`.localeCompare(
            `${right.evaluationId}/${right.reviewerId}`,
          ),
        ),
    );
  }

  async submitEvaluationReviewerBallot(
    threadId: string,
    evaluationId: string,
    request: SubmitEvaluationReviewerBallotRequest,
  ): Promise<EvaluationReviewerBallot> {
    this.assertInitialized();
    this.getThread(threadId);
    return this.stateQueue.run(async () => {
      const evaluation = this.state.evaluations.find(
        (candidate) =>
          candidate.id === evaluationId && candidate.threadId === threadId,
      );
      if (!evaluation) {
        throw new Error(`Run evaluation not found: ${evaluationId}`);
      }
      const normalizedReviewerId = request.reviewerId.trim().toLowerCase();
      const index = this.state.evaluationReviewerBallots.findIndex(
        (candidate) =>
          candidate.evaluationId === evaluationId &&
          candidate.reviewerId === normalizedReviewerId,
      );
      const current =
        index >= 0 ? this.state.evaluationReviewerBallots[index] : undefined;
      if (
        !current &&
        this.state.evaluationReviewerBallots.filter(
          (candidate) => candidate.evaluationId === evaluationId,
        ).length >= MAX_EVALUATION_REVIEWERS
      ) {
        throw new Error(
          `Evaluation consensus exceeds ${MAX_EVALUATION_REVIEWERS} reviewers`,
        );
      }
      const updated = submitEvaluationReviewerBallot(
        current,
        evaluation,
        request,
      );
      if (current && updated.currentRevision === current.currentRevision) {
        return structuredClone(current);
      }
      if (index >= 0) this.state.evaluationReviewerBallots[index] = updated;
      else this.state.evaluationReviewerBallots.push(updated);
      await this.persistState();
      return structuredClone(updated);
    });
  }

  getEvaluationConsensusReport(
    threadId: string,
    evaluationId: string,
    gate?: Partial<EvaluationConsensusGate>,
  ): EvaluationConsensusReport {
    this.assertInitialized();
    this.getThread(threadId);
    const evaluation = this.state.evaluations.find(
      (candidate) =>
        candidate.id === evaluationId && candidate.threadId === threadId,
    );
    if (!evaluation) {
      throw new Error(`Run evaluation not found: ${evaluationId}`);
    }
    return createEvaluationConsensusReport(
      evaluation,
      this.state.evaluationReviewerBallots.filter(
        (candidate) => candidate.evaluationId === evaluationId,
      ),
      gate,
    );
  }

  listEvaluationConsensusResolutions(
    threadId: string,
    evaluationId?: string,
  ): EvaluationConsensusResolution[] {
    this.assertInitialized();
    this.getThread(threadId);
    return structuredClone(
      this.state.evaluationConsensusResolutions
        .filter(
          (resolution) =>
            resolution.threadId === threadId &&
            (!evaluationId || resolution.evaluationId === evaluationId),
        )
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
    );
  }

  async resolveEvaluationConsensus(
    threadId: string,
    evaluationId: string,
    request: ResolveEvaluationConsensusRequest,
  ): Promise<ResolveEvaluationConsensusResult> {
    this.assertInitialized();
    this.getThread(threadId);
    return this.stateQueue.run(async () => {
      const evaluation = this.state.evaluations.find(
        (candidate) =>
          candidate.id === evaluationId && candidate.threadId === threadId,
      );
      if (!evaluation) {
        throw new Error(`Run evaluation not found: ${evaluationId}`);
      }
      const ballots = this.state.evaluationReviewerBallots.filter(
        (candidate) => candidate.evaluationId === evaluationId,
      );
      const report = createEvaluationConsensusReport(
        evaluation,
        ballots,
        request.gate,
      );
      consensusAdjudicationRequest(report);
      const existing = this.state.evaluationConsensusResolutions.find(
        (candidate) =>
          candidate.evaluationId === evaluationId &&
          candidate.report.contentSha256 === report.contentSha256,
      );
      const adjudicationIndex = this.state.evaluationAdjudications.findIndex(
        (candidate) => candidate.evaluationId === evaluationId,
      );
      const currentAdjudication =
        adjudicationIndex >= 0
          ? this.state.evaluationAdjudications[adjudicationIndex]
          : undefined;
      if (existing) {
        if (!currentAdjudication) {
          throw new Error(
            `Evaluation consensus adjudication is missing: ${existing.id}`,
          );
        }
        return {
          report: structuredClone(existing.report),
          resolution: structuredClone(existing),
          adjudication: structuredClone(currentAdjudication),
          created: false,
        };
      }
      if (
        this.state.evaluationConsensusResolutions.filter(
          (candidate) => candidate.evaluationId === evaluationId,
        ).length >= MAX_EVALUATION_CONSENSUS_RESOLUTIONS
      ) {
        throw new Error(
          `Evaluation exceeds ${MAX_EVALUATION_CONSENSUS_RESOLUTIONS} consensus resolutions`,
        );
      }
      const adjudication = reviewRunEvaluationRecord(
        currentAdjudication,
        evaluation,
        consensusAdjudicationRequest(report),
      );
      const resolution = createEvaluationConsensusResolution(
        evaluation,
        report,
        adjudication,
      );
      validateEvaluationConsensusResolution(
        resolution,
        evaluation,
        ballots,
        adjudication,
      );
      if (adjudicationIndex >= 0) {
        this.state.evaluationAdjudications[adjudicationIndex] = adjudication;
      } else {
        this.state.evaluationAdjudications.push(adjudication);
      }
      this.state.evaluationConsensusResolutions.push(resolution);
      await this.persistState();
      return {
        report: structuredClone(report),
        resolution: structuredClone(resolution),
        adjudication: structuredClone(adjudication),
        created: true,
      };
    });
  }

  getEvaluationCalibration(threadId: string): EvaluationCalibrationReport {
    this.assertInitialized();
    this.getThread(threadId);
    return createEvaluationCalibrationReport(
      threadId,
      this.state.evaluations,
      this.state.evaluationAdjudications,
    );
  }

  async getContextCheckpointCalibration(
    threadId: string,
  ): Promise<ContextCheckpointCalibrationReport> {
    this.assertInitialized();
    this.getThread(threadId);
    return createContextCheckpointCalibrationReport(
      threadId,
      await this.listEvents(threadId),
    );
  }

  listEvaluationCasebooks(): EvaluationCasebook[] {
    this.assertInitialized();
    return structuredClone(
      this.state.evaluationCasebooks
        .slice()
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    );
  }

  getEvaluationCasebook(casebookId: string): EvaluationCasebook {
    this.assertInitialized();
    const casebook = this.state.evaluationCasebooks.find(
      (candidate) => candidate.id === casebookId,
    );
    if (!casebook) {
      throw new Error(`Evaluation Casebook not found: ${casebookId}`);
    }
    return structuredClone(casebook);
  }

  async createEvaluationCasebook(
    request: CreateEvaluationCasebookRequest,
  ): Promise<EvaluationCasebook> {
    this.assertInitialized();
    this.getThread(request.threadId);
    const casebook = createEvaluationCasebookRecord(request);
    return this.stateQueue.run(async () => {
      this.state.evaluationCasebooks.push(casebook);
      await this.persistState();
      return structuredClone(casebook);
    });
  }

  async updateEvaluationCasebook(
    casebookId: string,
    request: UpdateEvaluationCasebookRequest,
  ): Promise<EvaluationCasebook> {
    this.assertInitialized();
    this.getThread(request.threadId);
    return this.stateQueue.run(async () => {
      const index = this.state.evaluationCasebooks.findIndex(
        (candidate) => candidate.id === casebookId,
      );
      const current = this.state.evaluationCasebooks[index];
      if (!current) {
        throw new Error(`Evaluation Casebook not found: ${casebookId}`);
      }
      const updated = updateEvaluationCasebookRecord(current, request);
      if (updated.currentRevision !== current.currentRevision) {
        this.state.evaluationCasebooks[index] = updated;
        await this.persistState();
      }
      return structuredClone(updated);
    });
  }

  async curateEvaluationCasebookCase(
    casebookId: string,
    request: CurateEvaluationCaseRequest,
  ): Promise<EvaluationCasebook> {
    this.assertInitialized();
    this.getThread(request.threadId);
    return this.stateQueue.run(async () => {
      const index = this.state.evaluationCasebooks.findIndex(
        (candidate) => candidate.id === casebookId,
      );
      const current = this.state.evaluationCasebooks[index];
      if (!current) {
        throw new Error(`Evaluation Casebook not found: ${casebookId}`);
      }
      const evaluation = this.state.evaluations.find(
        (candidate) =>
          candidate.id === request.evaluationId &&
          candidate.threadId === request.threadId,
      );
      if (!evaluation) {
        throw new Error(`Run evaluation not found: ${request.evaluationId}`);
      }
      const adjudication = this.state.evaluationAdjudications.find(
        (candidate) =>
          candidate.evaluationId === evaluation.id &&
          candidate.threadId === request.threadId,
      );
      if (!adjudication) {
        throw new Error(
          `Evaluation requires human adjudication before curation: ${evaluation.id}`,
        );
      }
      const truth = adjudication.revisions.at(-1)!;
      const consensusResolution =
        truth.source === "reviewer_consensus"
          ? this.state.evaluationConsensusResolutions.find(
              (resolution) =>
                resolution.adjudicationId === adjudication.id &&
                resolution.adjudicationRevision.revision === truth.revision &&
                resolution.report.contentSha256 === truth.sourceSha256,
            )
          : undefined;
      if (truth.source === "reviewer_consensus" && !consensusResolution) {
        throw new Error(
          `Consensus evidence is missing for curation: ${evaluation.id}`,
        );
      }
      const consensusEvidence = consensusResolution
        ? {
            resolution: consensusResolution,
            reviewerBallots: consensusResolution.report.votes.map((vote) => {
              const ballot = this.state.evaluationReviewerBallots.find(
                (candidate) => candidate.id === vote.ballotId,
              );
              const revision = ballot?.revisions.find(
                (candidate) => candidate.revision === vote.ballotRevision,
              );
              if (!ballot || !revision) {
                throw new Error(
                  `Consensus reviewer evidence is missing: ${vote.ballotId}`,
                );
              }
              return {
                ...structuredClone(ballot),
                revisions: ballot.revisions
                  .slice(0, vote.ballotRevision)
                  .map((item) => structuredClone(item)),
                currentRevision: vote.ballotRevision,
                updatedAt: revision.createdAt,
              };
            }),
          }
        : undefined;
      const updated = curateEvaluationCase(
        current,
        evaluation,
        adjudication,
        consensusEvidence,
      );
      if (updated.currentRevision !== current.currentRevision) {
        this.state.evaluationCasebooks[index] = updated;
        await this.persistState();
      }
      return structuredClone(updated);
    });
  }

  async removeEvaluationCasebookCase(
    casebookId: string,
    caseId: string,
    request: RemoveEvaluationCaseRequest,
  ): Promise<EvaluationCasebook> {
    this.assertInitialized();
    this.getThread(request.threadId);
    return this.stateQueue.run(async () => {
      const index = this.state.evaluationCasebooks.findIndex(
        (candidate) => candidate.id === casebookId,
      );
      const current = this.state.evaluationCasebooks[index];
      if (!current) {
        throw new Error(`Evaluation Casebook not found: ${casebookId}`);
      }
      const updated = removeEvaluationCase(current, caseId);
      this.state.evaluationCasebooks[index] = updated;
      await this.persistState();
      return structuredClone(updated);
    });
  }

  getEvaluationCasebookCalibration(
    casebookId: string,
  ): EvaluationCasebookCalibrationReport {
    return createEvaluationCasebookCalibrationReport(
      this.getEvaluationCasebook(casebookId),
    );
  }

  exportEvaluationCasebook(casebookId: string): EvaluationCasebookArtifact {
    return createEvaluationCasebookArtifact(
      this.getEvaluationCasebook(casebookId),
    );
  }

  listEvaluationCasebookQualificationExecutions(
    casebookId: string,
  ): EvaluationCasebookQualificationExecution[] {
    this.assertInitialized();
    this.getEvaluationCasebook(casebookId);
    return structuredClone(
      this.state.evaluationCasebookQualificationExecutions
        .filter((execution) => execution.casebookId === casebookId)
        .sort((left, right) => left.startedAt.localeCompare(right.startedAt)),
    );
  }

  async saveEvaluationCasebookQualificationExecution(
    execution: EvaluationCasebookQualificationExecution,
  ): Promise<EvaluationCasebookQualificationExecution> {
    this.assertInitialized();
    return this.stateQueue.run(async () => {
      const casebook = this.state.evaluationCasebooks.find(
        (candidate) => candidate.id === execution.casebookId,
      );
      if (!casebook) {
        throw new Error(
          `Evaluation Casebook not found: ${execution.casebookId}`,
        );
      }
      if (execution.casebookRevision !== casebook.currentRevision) {
        throw new Error(
          `Evaluation Casebook changed during qualification: ${execution.casebookId}`,
        );
      }
      if (
        !this.state.threads.some(
          (thread) => thread.id === execution.auditThreadId,
        )
      ) {
        throw new Error(
          `Evaluation Casebook qualification audit thread is missing: ${execution.auditThreadId}`,
        );
      }
      validateEvaluationCasebookQualificationExecution(execution, casebook);
      if (
        this.state.evaluationCasebookQualificationExecutions.some(
          (candidate) => candidate.id === execution.id,
        )
      ) {
        throw new Error(
          `Evaluation Casebook qualification execution already exists: ${execution.id}`,
        );
      }
      this.state.evaluationCasebookQualificationExecutions.push(
        structuredClone(execution),
      );
      const executions = this.state.evaluationCasebookQualificationExecutions
        .filter((candidate) => candidate.casebookId === execution.casebookId)
        .sort((left, right) => left.startedAt.localeCompare(right.startedAt));
      if (executions.length > 20) {
        const protectedExecutionIds = new Set([
          execution.id,
          ...this.state.evaluationQualificationBaselines
            .filter((baseline) => baseline.casebookId === execution.casebookId)
            .map((baseline) => baseline.qualificationExecutionId),
        ]);
        const removeIds = new Set(
          executions
            .filter((candidate) => !protectedExecutionIds.has(candidate.id))
            .slice(0, Math.max(0, executions.length - 20))
            .map((candidate) => candidate.id),
        );
        this.state.evaluationCasebookQualificationExecutions =
          this.state.evaluationCasebookQualificationExecutions.filter(
            (candidate) => !removeIds.has(candidate.id),
          );
      }
      await this.persistState();
      return structuredClone(execution);
    });
  }

  listEvaluationQualificationBaselines(
    casebookId?: string,
  ): EvaluationQualificationBaseline[] {
    this.assertInitialized();
    if (casebookId) this.getEvaluationCasebook(casebookId);
    return structuredClone(
      this.state.evaluationQualificationBaselines
        .filter((baseline) => !casebookId || baseline.casebookId === casebookId)
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
    );
  }

  async promoteEvaluationQualificationBaseline(
    casebookId: string,
    promotedByThreadId: string,
    envelope: TrustedReceiptEnvelope<EvaluationCasebookQualificationReceipt>,
  ): Promise<PromoteEvaluationQualificationBaselineResult> {
    this.assertInitialized();
    this.getThread(promotedByThreadId);
    return this.stateQueue.run(async () => {
      const casebook = this.state.evaluationCasebooks.find(
        (candidate) => candidate.id === casebookId,
      );
      if (!casebook) {
        throw new Error(`Evaluation Casebook not found: ${casebookId}`);
      }
      const anchor = this.state.receiptTrustAnchors.find(
        (candidate) => candidate.keyId === envelope.signature.keyId,
      );
      if (!anchor) {
        throw new Error(
          `Receipt trust anchor not found for key: ${envelope.signature.keyId}`,
        );
      }
      const verification = verifyTrustedReceiptEnvelope(envelope, [anchor]);
      if (verification.status !== "trusted") {
        throw new Error(
          `Qualification baseline receipt is not trusted: ${verification.reason}`,
        );
      }
      const existing = this.state.evaluationQualificationBaselines.find(
        (baseline) =>
          baseline.casebookId === casebookId &&
          baseline.casebookRevision === casebook.currentRevision &&
          baseline.envelope.receipt.contentSha256 ===
            envelope.receipt.contentSha256 &&
          baseline.envelope.signature.keyId === envelope.signature.keyId,
      );
      if (existing) {
        return {
          baseline: structuredClone(existing),
          created: false,
        };
      }
      const casebookBaselines =
        this.state.evaluationQualificationBaselines.filter(
          (baseline) => baseline.casebookId === casebookId,
        );
      if (
        casebookBaselines.length >= MAX_QUALIFICATION_BASELINES_PER_CASEBOOK
      ) {
        throw new Error(
          `Evaluation Casebook exceeds ${MAX_QUALIFICATION_BASELINES_PER_CASEBOOK} qualification baselines`,
        );
      }
      const current = casebookBaselines.at(-1);
      const baseline = createEvaluationQualificationBaseline(
        envelope,
        casebook,
        promotedByThreadId,
        current?.id,
      );
      const execution =
        this.state.evaluationCasebookQualificationExecutions.find(
          (candidate) =>
            candidate.id === baseline.qualificationExecutionId &&
            candidate.casebookId === casebookId &&
            candidate.contentSha256 === baseline.qualificationExecutionSha256,
        );
      if (!execution) {
        throw new Error(
          `Qualification baseline execution is missing: ${baseline.qualificationExecutionId}`,
        );
      }
      this.state.evaluationQualificationBaselines.push(baseline);
      await this.persistState();
      return {
        baseline: structuredClone(baseline),
        created: true,
      };
    });
  }

  async saveRunEvaluation(
    evaluation: RunEvaluationRecord,
  ): Promise<RunEvaluationRecord> {
    this.assertInitialized();
    this.getThread(evaluation.threadId);
    if (evaluation.leftRunId === evaluation.rightRunId) {
      throw new Error("Run evaluation requires two distinct runs");
    }
    const runIds = new Set(
      this.state.runs
        .filter((run) => run.threadId === evaluation.threadId)
        .map((run) => run.id),
    );
    if (
      !runIds.has(evaluation.leftRunId) ||
      !runIds.has(evaluation.rightRunId)
    ) {
      throw new Error("Evaluation runs must belong to the target thread");
    }
    validatePersistedRunEvaluation(
      evaluation,
      this.state.threads,
      this.state.runs,
      this.state.subagents,
      this.requireLedger().listEvents(evaluation.threadId),
    );
    return this.stateQueue.run(async () => {
      if (
        this.state.evaluations.some(
          (candidate) => candidate.id === evaluation.id,
        )
      ) {
        throw new Error(`Run evaluation already exists: ${evaluation.id}`);
      }
      this.state.evaluations.push(structuredClone(evaluation));
      const threadEvaluations = this.state.evaluations
        .filter((candidate) => candidate.threadId === evaluation.threadId)
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
      if (threadEvaluations.length > 50) {
        const protectedEvaluationIds = new Set([
          ...this.state.evaluationSuiteExecutions.flatMap((execution) =>
            execution.results.map((result) => result.evaluationId),
          ),
          ...this.state.evaluationAdjudications.map(
            (adjudication) => adjudication.evaluationId,
          ),
          ...this.state.evaluationReviewerBallots.map(
            (ballot) => ballot.evaluationId,
          ),
          ...this.state.evaluationConsensusResolutions.map(
            (resolution) => resolution.evaluationId,
          ),
        ]);
        const removeIds = new Set(
          threadEvaluations
            .filter((candidate) => !protectedEvaluationIds.has(candidate.id))
            .slice(0, threadEvaluations.length - 50)
            .map((candidate) => candidate.id),
        );
        this.state.evaluations = this.state.evaluations.filter(
          (candidate) => !removeIds.has(candidate.id),
        );
      }
      await this.persistState();
      return structuredClone(evaluation);
    });
  }

  listEvaluationSuites(threadId: string): EvaluationSuite[] {
    this.assertInitialized();
    this.getThread(threadId);
    return structuredClone(
      this.state.evaluationSuites
        .filter((suite) => suite.threadId === threadId)
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
    );
  }

  getEvaluationSuite(suiteId: string): EvaluationSuite {
    this.assertInitialized();
    const suite = this.state.evaluationSuites.find(
      (candidate) => candidate.id === suiteId,
    );
    if (!suite) throw new Error(`Evaluation suite not found: ${suiteId}`);
    return structuredClone(suite);
  }

  async createEvaluationSuite(
    threadId: string,
    request: CreateEvaluationSuiteRequest,
  ): Promise<EvaluationSuite> {
    this.assertInitialized();
    const thread = this.getThread(threadId);
    const suite = createEvaluationSuiteRecord(
      threadId,
      request,
      this.getAgent(thread.agentId).model,
    );
    return this.stateQueue.run(async () => {
      assertEvaluationSuiteRuns(this.state.runs, suite);
      this.state.evaluationSuites.push(suite);
      await this.persistState();
      return structuredClone(suite);
    });
  }

  async updateEvaluationSuite(
    suiteId: string,
    request: UpdateEvaluationSuiteRequest,
  ): Promise<EvaluationSuite> {
    this.assertInitialized();
    return this.stateQueue.run(async () => {
      const index = this.state.evaluationSuites.findIndex(
        (candidate) => candidate.id === suiteId,
      );
      const current = this.state.evaluationSuites[index];
      if (!current) throw new Error(`Evaluation suite not found: ${suiteId}`);
      const updated = updateEvaluationSuiteRecord(current, request);
      assertEvaluationSuiteRuns(this.state.runs, updated);
      this.state.evaluationSuites[index] = updated;
      if (updated.revision !== current.revision) await this.persistState();
      return structuredClone(updated);
    });
  }

  listEvaluationSuiteExecutions(
    threadId: string,
    suiteId?: string,
  ): EvaluationSuiteExecution[] {
    this.assertInitialized();
    this.getThread(threadId);
    return structuredClone(
      this.state.evaluationSuiteExecutions
        .filter(
          (execution) =>
            execution.threadId === threadId &&
            (!suiteId || execution.suiteId === suiteId),
        )
        .sort((left, right) => left.startedAt.localeCompare(right.startedAt)),
    );
  }

  async saveEvaluationSuiteExecution(
    execution: EvaluationSuiteExecution,
  ): Promise<EvaluationSuiteExecution> {
    this.assertInitialized();
    return this.stateQueue.run(async () => {
      validateEvaluationSuiteExecution(
        execution,
        this.state.evaluationSuites,
        this.state.evaluations,
        this.state.runs,
      );
      if (
        this.state.evaluationSuiteExecutions.some(
          (candidate) => candidate.id === execution.id,
        )
      ) {
        throw new Error(
          `Evaluation suite execution already exists: ${execution.id}`,
        );
      }
      this.state.evaluationSuiteExecutions.push(structuredClone(execution));
      const suiteExecutions = this.state.evaluationSuiteExecutions
        .filter((candidate) => candidate.suiteId === execution.suiteId)
        .sort((left, right) => left.startedAt.localeCompare(right.startedAt));
      if (suiteExecutions.length > 20) {
        const removeIds = new Set(
          suiteExecutions
            .slice(0, suiteExecutions.length - 20)
            .map((candidate) => candidate.id),
        );
        this.state.evaluationSuiteExecutions =
          this.state.evaluationSuiteExecutions.filter(
            (candidate) => !removeIds.has(candidate.id),
          );
      }
      await this.persistState();
      return structuredClone(execution);
    });
  }

  listSubagentTasks(threadId: string, runId?: string): SubagentTask[] {
    this.assertInitialized();
    return structuredClone(
      this.state.subagents
        .filter(
          (task) =>
            task.threadId === threadId && (!runId || task.runId === runId),
        )
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
    );
  }

  async createSubagentTask(
    input: CreateSubagentTaskInput,
  ): Promise<SubagentTask> {
    this.assertInitialized();
    this.getThread(input.threadId);
    const run = this.state.runs.find(
      (candidate) => candidate.id === input.runId,
    );
    if (!run || run.threadId !== input.threadId) {
      throw new Error(
        `Run ${input.runId} does not belong to thread ${input.threadId}`,
      );
    }
    if (run.status !== "running") {
      throw new Error(`Cannot delegate from run in ${run.status} state`);
    }
    return this.stateQueue.run(async () => {
      const timestamp = nowIso();
      const task: SubagentTask = {
        id: createId("task"),
        threadId: input.threadId,
        runId: input.runId,
        role: input.role,
        description: input.description,
        prompt: input.prompt,
        status: "pending",
        model: structuredClone(input.model),
        stepCount: 0,
        turnCount: 0,
        usage: emptyUsage(),
        createdAt: timestamp,
        revision: 1,
      };
      this.state.subagents.push(task);
      await this.persistState();
      return structuredClone(task);
    });
  }

  async startSubagentTask(taskId: string): Promise<SubagentTask> {
    this.assertInitialized();
    return this.stateQueue.run(async () => {
      const task = this.mutableSubagentTask(taskId);
      if (task.status !== "pending") {
        throw new Error(`Cannot start subagent task in ${task.status} state`);
      }
      task.status = "running";
      task.startedAt = nowIso();
      task.revision += 1;
      await this.persistState();
      return structuredClone(task);
    });
  }

  async recordSubagentProgress(
    taskId: string,
    input: {
      stepDelta?: number;
      turnDelta?: number;
      usage?: SubagentTask["usage"];
    },
  ): Promise<SubagentTask> {
    this.assertInitialized();
    return this.stateQueue.run(async () => {
      const task = this.mutableSubagentTask(taskId);
      if (TERMINAL_SUBAGENT_STATUSES.has(task.status)) {
        return structuredClone(task);
      }
      task.stepCount += Math.max(0, input.stepDelta ?? 0);
      task.turnCount += Math.max(0, input.turnDelta ?? 0);
      if (input.usage) task.usage = structuredClone(input.usage);
      task.revision += 1;
      await this.persistState();
      return structuredClone(task);
    });
  }

  async finishSubagentTask(
    taskId: string,
    input: {
      status: Exclude<SubagentTaskStatus, "pending" | "running">;
      stopReason: SubagentStopReason;
      result?: string;
      outcome?: SubagentOutcome;
      error?: string;
      usage?: SubagentTask["usage"];
    },
  ): Promise<SubagentTask> {
    this.assertInitialized();
    return this.stateQueue.run(async () => {
      const task = this.mutableSubagentTask(taskId);
      if (TERMINAL_SUBAGENT_STATUSES.has(task.status)) {
        return structuredClone(task);
      }
      if (input.outcome !== undefined && input.status !== "completed") {
        throw new Error("Only completed subagent tasks may carry an outcome");
      }
      const outcome =
        input.outcome === undefined
          ? undefined
          : assertSubagentOutcomeBinding(input.outcome, task);
      task.status = input.status;
      task.stopReason = input.stopReason;
      if (input.result !== undefined) task.result = input.result;
      if (outcome !== undefined) task.outcome = outcome;
      if (input.error !== undefined) task.error = input.error;
      if (input.usage) task.usage = structuredClone(input.usage);
      task.finishedAt = nowIso();
      task.revision += 1;
      await this.persistState();
      return structuredClone(task);
    });
  }

  listExtensions(options: { agentId?: string } = {}): ExtensionRecord[] {
    this.assertInitialized();
    return structuredClone(
      this.state.extensions
        .filter(
          (extension) =>
            !options.agentId ||
            extension.enabledAgentIds.includes(options.agentId),
        )
        .sort((left, right) => left.name.localeCompare(right.name)),
    );
  }

  getExtension(extensionId: string): ExtensionRecord {
    this.assertInitialized();
    const extension = this.state.extensions.find(
      (candidate) => candidate.id === extensionId,
    );
    if (!extension) throw new Error(`Extension not found: ${extensionId}`);
    return structuredClone(extension);
  }

  async createMcpExtension(
    request: CreateMcpExtensionRequest,
  ): Promise<ExtensionRecord> {
    this.assertInitialized();
    const extension = createMcpExtension(request);
    return this.stateQueue.run(async () => {
      if (
        this.state.extensions.some(
          (candidate) =>
            candidate.kind === "mcp" &&
            candidate.normalizedName === extension.normalizedName,
        )
      ) {
        throw new Error(
          `MCP extension name already exists: ${extension.normalizedName}`,
        );
      }
      this.state.extensions.push(extension);
      await this.persistState();
      return structuredClone(extension);
    });
  }

  listExtensionPublisherTrustAnchors(): ExtensionPublisherTrustAnchor[] {
    this.assertInitialized();
    return structuredClone(
      this.state.extensionPublisherTrustAnchors
        .slice()
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
    );
  }

  getExtensionPublisherTrustAnchor(
    anchorId: string,
  ): ExtensionPublisherTrustAnchor {
    this.assertInitialized();
    const anchor = this.state.extensionPublisherTrustAnchors.find(
      (candidate) => candidate.id === anchorId,
    );
    if (!anchor) {
      throw new Error(
        `Extension publisher trust anchor not found: ${anchorId}`,
      );
    }
    return structuredClone(anchor);
  }

  async createExtensionPublisherTrustAnchor(
    request: CreateExtensionPublisherTrustAnchorRequest,
  ): Promise<ExtensionPublisherTrustAnchor> {
    this.assertInitialized();
    this.getThread(request.threadId);
    const anchor = createExtensionPublisherTrustAnchorRecord(request);
    return this.stateQueue.run(async () => {
      if (
        this.state.extensionPublisherTrustAnchors.length >=
        MAX_EXTENSION_PUBLISHER_TRUST_ANCHORS
      ) {
        throw new Error(
          `Workspace exceeds ${MAX_EXTENSION_PUBLISHER_TRUST_ANCHORS} Extension publisher trust anchors`,
        );
      }
      if (
        this.state.extensionPublisherTrustAnchors.some(
          (candidate) => candidate.keyId === anchor.keyId,
        )
      ) {
        throw new Error(
          `Extension publisher trust anchor already exists for key: ${anchor.keyId}`,
        );
      }
      if (
        anchor.signingSource &&
        this.state.extensionPublisherTrustAnchors.some(
          (candidate) =>
            candidate.signingSource?.variable ===
            anchor.signingSource?.variable,
        )
      ) {
        throw new Error(
          `Extension publisher signing source already exists: ${anchor.signingSource.variable}`,
        );
      }
      this.state.extensionPublisherTrustAnchors.push(anchor);
      await this.persistState();
      return structuredClone(anchor);
    });
  }

  async revokeExtensionPublisherTrustAnchor(
    anchorId: string,
  ): Promise<ExtensionPublisherTrustAnchor> {
    this.assertInitialized();
    return this.stateQueue.run(async () => {
      const index = this.state.extensionPublisherTrustAnchors.findIndex(
        (candidate) => candidate.id === anchorId,
      );
      const current = this.state.extensionPublisherTrustAnchors[index];
      if (!current) {
        throw new Error(
          `Extension publisher trust anchor not found: ${anchorId}`,
        );
      }
      const updated = revokeExtensionPublisherTrustAnchorRecord(current);
      this.state.extensionPublisherTrustAnchors[index] = updated;
      if (updated.status !== current.status) {
        for (
          let extensionIndex = 0;
          extensionIndex < this.state.extensions.length;
          extensionIndex += 1
        ) {
          const extension = this.state.extensions[extensionIndex]!;
          const directlyRevoked =
            extension.packageBinding?.envelope.signature.keyId ===
            updated.keyId;
          const dependencyFailure = extensionPackageDependencyFailure(
            extension,
            this.state.extensions,
            this.state.extensionPublisherTrustAnchors,
            new Date(updated.updatedAt),
          );
          if (!directlyRevoked && !dependencyFailure) continue;
          this.state.extensions[extensionIndex] = {
            ...extension,
            enabledAgentIds: [],
            connection: {
              status: "disconnected",
              toolCount: extension.tools.length,
              error: directlyRevoked
                ? "Signed package publisher key was revoked."
                : (dependencyFailure ??
                  "Signed package dependency is unavailable."),
            },
            revision: extension.revision + 1,
            updatedAt: updated.updatedAt,
          };
        }
        await this.persistState();
      }
      return structuredClone(updated);
    });
  }

  async signExtensionPackage(
    extensionId: string,
    request: SignExtensionPackageRequest,
  ): Promise<SignedExtensionPackageEnvelope> {
    this.assertInitialized();
    this.getThread(request.threadId);
    const extension = this.getExtension(extensionId);
    const anchor = this.getExtensionPublisherTrustAnchor(request.trustAnchorId);
    return signExtensionPackageRecord(extension, request.publisher, anchor, {
      ...(request.expiresAt ? { expiresAt: request.expiresAt } : {}),
      ...(request.dependencies ? { dependencies: request.dependencies } : {}),
    });
  }

  async signSkillPackage(
    request: SignSkillPackageRequest,
  ): Promise<SignedSkillPackageEnvelope> {
    this.assertInitialized();
    this.getThread(request.threadId);
    const anchor = this.getExtensionPublisherTrustAnchor(request.trustAnchorId);
    return signWorkspaceSkillPackage(
      this.workspaceRoot,
      request.publisher,
      anchor,
      {
        ...(request.skillNames ? { skillNames: request.skillNames } : {}),
        ...(request.expiresAt ? { expiresAt: request.expiresAt } : {}),
      },
    );
  }

  verifySkillPackage(
    request: VerifySkillPackageRequest,
  ): SkillPackageVerification {
    this.assertInitialized();
    return verifySignedSkillPackageEnvelope(
      request.envelope,
      this.state.extensionPublisherTrustAnchors,
    );
  }

  async qualifySkillPackage(
    request: QualifySkillPackageRequest,
  ): Promise<SkillPackageQualification> {
    this.assertInitialized();
    if (request.threadId) this.getThread(request.threadId);
    return qualifyWorkspaceSkillPackage(
      this.workspaceRoot,
      request.envelope,
      this.state.extensionPublisherTrustAnchors,
    );
  }

  listSkillPackageInstallations(): SkillPackageInstallation[] {
    this.assertInitialized();
    return structuredClone(
      [...this.state.skillPackageInstallations].sort((left, right) =>
        right.installedAt.localeCompare(left.installedAt),
      ),
    );
  }

  async installSkillPackage(
    request: InstallSkillPackageRequest,
  ): Promise<InstallSkillPackageResult> {
    this.assertInitialized();
    this.getThread(request.threadId);
    return this.stateQueue.run(async () => {
      const qualification = await qualifyWorkspaceSkillPackage(
        this.workspaceRoot,
        request.envelope,
        this.state.extensionPublisherTrustAnchors,
      );
      if (qualification.status !== "qualified") {
        throw new Error(
          `Skill package cannot be installed: ${qualification.reason}`,
        );
      }
      const envelope = validateSignedSkillPackageEnvelope(request.envelope);
      const active = this.state.skillPackageInstallations.find(
        (installation) => installation.status === "active",
      );
      if (active?.envelopeSha256 === envelope.contentSha256) {
        return {
          installation: structuredClone(active),
          qualification,
          created: false,
        };
      }
      if (active) {
        if (
          request.replaceInstallationId !== active.id ||
          request.confirmReplacement !== true
        ) {
          throw new Error(
            `Skill package replacement requires confirmation for ${active.id}`,
          );
        }
        if (
          (active.publisher !== envelope.manifest.publisher ||
            active.keyId !== envelope.signature.keyId) &&
          request.confirmPublisherChange !== true
        ) {
          throw new Error(
            "Skill package publisher change requires explicit confirmation",
          );
        }
        if (
          active.skillNamesSha256 !==
            createHash("sha256")
              .update(JSON.stringify(envelope.manifest.loadedSkillNames))
              .digest("hex") &&
          request.confirmSkillSetChange !== true
        ) {
          throw new Error(
            "Skill package Skill set change requires explicit confirmation",
          );
        }
      } else if (request.replaceInstallationId || request.confirmReplacement) {
        throw new Error("Skill package replacement target is not active");
      }
      const installation = createSkillPackageInstallation({
        id: createId("skillinstall"),
        envelope,
        installedByThreadId: request.threadId,
        ...(active ? { replacesInstallationId: active.id } : {}),
      });
      let replacedInstallation: SkillPackageInstallation | undefined;
      if (active) {
        const index = this.state.skillPackageInstallations.findIndex(
          (candidate) => candidate.id === active.id,
        );
        replacedInstallation = markSkillPackageInstallationReplaced(
          active,
          installation.id,
          installation.installedAt,
        );
        this.state.skillPackageInstallations[index] = replacedInstallation;
      }
      this.state.skillPackageInstallations.push(installation);
      await this.persistState();
      return {
        installation: structuredClone(installation),
        qualification,
        created: true,
        ...(replacedInstallation
          ? { replacedInstallation: structuredClone(replacedInstallation) }
          : {}),
      };
    });
  }

  async previewSkillContent(
    request: PreviewSkillContentRequest,
  ): Promise<SkillContentReview> {
    this.assertInitialized();
    this.getThread(request.threadId);
    return createSkillContentReview(this.workspaceRoot, request.content);
  }

  async applySkillContent(
    request: ApplySkillContentRequest,
  ): Promise<ApplySkillContentResult> {
    this.assertInitialized();
    this.getThread(request.threadId);
    return applyReviewedSkillContent(this.workspaceRoot, this.dataRoot, {
      content: request.content,
      expectedReviewSha256: request.expectedReviewSha256,
      ...(request.confirmInstall !== undefined
        ? { confirmInstall: request.confirmInstall }
        : {}),
      ...(request.confirmReplacement !== undefined
        ? { confirmReplacement: request.confirmReplacement }
        : {}),
    });
  }

  signPromptPackage(
    request: SignPromptPackageRequest,
  ): SignedPromptPackageEnvelope {
    this.assertInitialized();
    this.getThread(request.threadId);
    const profile = this.getAgent(request.agentId);
    const revision = this.getAgentRevision(profile.id, profile.revision);
    const anchor = this.getExtensionPublisherTrustAnchor(request.trustAnchorId);
    return signPromptPackage(profile, revision, request.publisher, anchor, {
      ...(request.expiresAt ? { expiresAt: request.expiresAt } : {}),
    });
  }

  verifyPromptPackage(
    request: VerifyPromptPackageRequest,
  ): PromptPackageVerification {
    this.assertInitialized();
    return verifySignedPromptPackageEnvelope(
      request.envelope,
      this.state.extensionPublisherTrustAnchors,
    );
  }

  qualifyPromptPackage(
    request: QualifyPromptPackageRequest,
  ): PromptPackageQualification {
    this.assertInitialized();
    if (request.threadId) this.getThread(request.threadId);
    let targetAgentId = request.agentId;
    if (!targetAgentId) {
      const envelope = validateSignedPromptPackageEnvelope(request.envelope);
      targetAgentId = envelope.manifest.sourceAgentId;
    }
    const profile = this.state.agents.find(
      (agent) => agent.id === targetAgentId,
    );
    return qualifyAgentPromptPackage(
      request.envelope,
      this.state.extensionPublisherTrustAnchors,
      profile ? structuredClone(profile) : undefined,
    );
  }

  signInspectorPackage(
    request: SignInspectorPackageRequest,
  ): SignedInspectorPackageEnvelope {
    this.assertInitialized();
    this.getThread(request.threadId);
    const anchor = this.getExtensionPublisherTrustAnchor(request.trustAnchorId);
    return signInspectorPackage(request.publisher, anchor, {
      ...(request.expiresAt ? { expiresAt: request.expiresAt } : {}),
    });
  }

  verifyInspectorPackage(
    request: VerifyInspectorPackageRequest,
  ): InspectorPackageVerification {
    this.assertInitialized();
    return verifySignedInspectorPackageEnvelope(
      request.envelope,
      this.state.extensionPublisherTrustAnchors,
    );
  }

  qualifyInspectorPackage(
    request: QualifyInspectorPackageRequest,
  ): InspectorPackageQualification {
    this.assertInitialized();
    if (request.threadId) this.getThread(request.threadId);
    return qualifyInspectorPackage(
      request.envelope,
      this.state.extensionPublisherTrustAnchors,
    );
  }

  async importSignedExtensionPackage(
    request: ImportSignedExtensionPackageRequest,
  ): Promise<ExtensionRecord> {
    this.assertInitialized();
    this.getThread(request.threadId);
    return this.stateQueue.run(async () => {
      const verification = verifySignedExtensionPackageEnvelope(
        request.envelope,
        this.state.extensionPublisherTrustAnchors,
      );
      if (verification.status !== "trusted") {
        throw new Error(
          `Signed Extension package is not trusted: ${verification.reason}`,
        );
      }
      const extension = createMcpExtensionFromSignedPackage(request.envelope);
      if (
        this.state.extensions.some(
          (candidate) =>
            candidate.normalizedName === extension.normalizedName ||
            candidate.packageBinding?.envelope.contentSha256 ===
              extension.packageBinding?.envelope.contentSha256,
        )
      ) {
        throw new Error(
          `MCP extension or signed package already exists: ${extension.normalizedName}`,
        );
      }
      const nextExtensions = [...this.state.extensions, extension];
      validateExtensionPackageDependencyGraph(
        nextExtensions,
        this.state.extensionPublisherTrustAnchors,
        { requireTrusted: true },
      );
      this.state.extensions = nextExtensions;
      await this.persistState();
      return structuredClone(extension);
    });
  }

  previewExtensionPackageUpdate(
    extensionId: string,
    envelope: unknown,
  ): ExtensionPackageUpdatePreview {
    this.assertInitialized();
    const index = this.state.extensions.findIndex(
      (candidate) => candidate.id === extensionId,
    );
    const current = this.state.extensions[index];
    if (!current) throw new Error(`Extension not found: ${extensionId}`);
    const preview = createExtensionPackageUpdatePreview(
      current,
      envelope,
      this.state.extensionPublisherTrustAnchors,
    );
    if (preview.noChanges) return preview;
    const simulated = applyExtensionPackageUpdateRecord(
      current,
      envelope,
      this.state.extensionPublisherTrustAnchors,
      {
        expectedPackageBindingSha256: preview.expectedPackageBindingSha256,
        confirmPublisherChange: true,
        confirmVersionOverride: true,
        updatedAt: preview.generatedAt,
      },
    );
    const nextExtensions = [...this.state.extensions];
    nextExtensions[index] = simulated.extension;
    validateExtensionPackageDependencyGraph(
      nextExtensions,
      this.state.extensionPublisherTrustAnchors,
      { requireTrusted: true, now: new Date(preview.generatedAt) },
    );
    return preview;
  }

  async applyExtensionPackageUpdate(
    extensionId: string,
    request: ApplyExtensionPackageUpdateRequest,
  ): Promise<ApplyExtensionPackageUpdateResult> {
    this.assertInitialized();
    this.getThread(request.threadId);
    return this.stateQueue.run(async () => {
      const index = this.state.extensions.findIndex(
        (candidate) => candidate.id === extensionId,
      );
      const current = this.state.extensions[index];
      if (!current) throw new Error(`Extension not found: ${extensionId}`);
      const result = applyExtensionPackageUpdateRecord(
        structuredClone(current),
        request.envelope,
        this.state.extensionPublisherTrustAnchors,
        {
          expectedPackageBindingSha256: request.expectedPackageBindingSha256,
          ...(request.confirmPublisherChange === true
            ? { confirmPublisherChange: true }
            : {}),
          ...(request.confirmVersionOverride === true
            ? { confirmVersionOverride: true }
            : {}),
        },
      );
      if (result.updated) {
        const nextExtensions = [...this.state.extensions];
        nextExtensions[index] = result.extension;
        validateExtensionPackageDependencyGraph(
          nextExtensions,
          this.state.extensionPublisherTrustAnchors,
          { requireTrusted: true },
        );
        this.state.extensions = nextExtensions;
        await this.persistState();
      }
      return structuredClone(result);
    });
  }

  previewExtensionPackageDeployment(
    envelopes: unknown[],
  ): ExtensionPackageDeploymentPreview {
    this.assertInitialized();
    return createExtensionPackageDeploymentPreview(
      this.state.extensions,
      envelopes,
      this.state.extensionPublisherTrustAnchors,
    );
  }

  async applyExtensionPackageDeployment(
    request: ApplyExtensionPackageDeploymentRequest,
  ): Promise<ApplyExtensionPackageDeploymentResult> {
    this.assertInitialized();
    this.getThread(request.threadId);
    return this.stateQueue.run(async () => {
      const result = applyExtensionPackageDeploymentRecords(
        this.state.extensions,
        request.envelopes,
        this.state.extensionPublisherTrustAnchors,
        {
          expectedDeploymentSha256: request.expectedDeploymentSha256,
          ...(request.confirmPublisherChanges === true
            ? { confirmPublisherChanges: true }
            : {}),
          ...(request.confirmVersionOverrides === true
            ? { confirmVersionOverrides: true }
            : {}),
        },
      );
      if (result.extensions.length > 0) {
        const nextExtensions = [...this.state.extensions];
        for (const extension of result.extensions) {
          const index = nextExtensions.findIndex(
            (candidate) => candidate.id === extension.id,
          );
          if (index >= 0) {
            nextExtensions[index] = extension;
          } else {
            nextExtensions.push(extension);
          }
        }
        validateExtensionPackageDependencyGraph(
          nextExtensions,
          this.state.extensionPublisherTrustAnchors,
          { requireTrusted: true },
        );
        this.state.extensions = nextExtensions;
        await this.persistState();
      }
      return structuredClone(result);
    });
  }

  exportExtensionPackageLockfile(
    request: ExportExtensionPackageLockfileRequest,
  ): ExtensionPackageLockfile {
    this.assertInitialized();
    this.getThread(request.threadId);
    return createExtensionPackageLockfile(
      this.state.extensions,
      this.state.extensionPublisherTrustAnchors,
      request.extensionIds ? { extensionIds: request.extensionIds } : {},
    );
  }

  verifyExtensionPackageLockfile(
    lockfile: unknown,
  ): ExtensionPackageLockfileVerification {
    this.assertInitialized();
    return verifyExtensionPackageLockfileRecord(
      lockfile,
      this.state.extensionPublisherTrustAnchors,
    );
  }

  async signExtensionPackageChannelIndex(
    request: SignExtensionPackageChannelIndexRequest,
  ): Promise<SignedExtensionPackageChannelIndexEnvelope> {
    this.assertInitialized();
    this.getThread(request.threadId);
    const anchor = this.getExtensionPublisherTrustAnchor(request.trustAnchorId);
    return signExtensionPackageChannelIndexRecord(
      this.state.extensionPackageRolloutChannels,
      request.publisher,
      anchor,
      {
        ...(request.channelIds ? { channelIds: request.channelIds } : {}),
        ...(request.expiresAt ? { expiresAt: request.expiresAt } : {}),
        ...(request.lockfileBaseUrl
          ? { lockfileBaseUrl: request.lockfileBaseUrl }
          : {}),
      },
    );
  }

  verifyExtensionPackageChannelIndex(
    request: VerifyExtensionPackageChannelIndexRequest,
  ): ExtensionPackageChannelIndexVerification {
    this.assertInitialized();
    return verifySignedExtensionPackageChannelIndexEnvelopeRecord(
      request.envelope,
      this.state.extensionPublisherTrustAnchors,
    );
  }

  listExtensionPackageRolloutChannels(): ExtensionPackageRolloutChannel[] {
    this.assertInitialized();
    return structuredClone(
      this.state.extensionPackageRolloutChannels
        .slice()
        .sort((left, right) => left.name.localeCompare(right.name)),
    );
  }

  getExtensionPackageRolloutChannel(
    channelId: string,
  ): ExtensionPackageRolloutChannel {
    this.assertInitialized();
    const channel = this.state.extensionPackageRolloutChannels.find(
      (candidate) => candidate.id === channelId,
    );
    if (!channel) {
      throw new Error(
        `Extension package rollout channel not found: ${channelId}`,
      );
    }
    return structuredClone(channel);
  }

  getExtensionPackageRolloutLockfile(
    lockfileSha256: string,
  ): ExtensionPackageLockfile {
    this.assertInitialized();
    if (!/^[a-f0-9]{64}$/.test(lockfileSha256)) {
      throw new Error("Extension package lockfile hash is invalid");
    }
    const channel = this.state.extensionPackageRolloutChannels.find(
      (candidate) => candidate.lockfileSha256 === lockfileSha256,
    );
    if (!channel) {
      throw new Error(
        `Extension package rollout lockfile not found: ${lockfileSha256}`,
      );
    }
    return structuredClone(channel.lockfile);
  }

  async publishExtensionPackageRolloutChannel(
    request: PublishExtensionPackageRolloutChannelRequest,
  ): Promise<ExtensionPackageRolloutChannel> {
    this.assertInitialized();
    this.getThread(request.threadId);
    return this.stateQueue.run(async () => {
      const normalizedName = normalizeMcpName(
        request.name.replace(/\s+/g, " ").trim(),
      );
      const existing = this.state.extensionPackageRolloutChannels.find(
        (channel) => channel.normalizedName === normalizedName,
      );
      const channel = createExtensionPackageRolloutChannel({
        ...(existing ? { existing } : {}),
        extensions: this.state.extensions,
        anchors: this.state.extensionPublisherTrustAnchors,
        request,
      });
      const nextChannels = [...this.state.extensionPackageRolloutChannels];
      const index = nextChannels.findIndex(
        (candidate) => candidate.id === channel.id,
      );
      if (index >= 0) {
        nextChannels[index] = channel;
      } else {
        nextChannels.push(channel);
      }
      this.state.extensionPackageRolloutChannels = nextChannels;
      await this.persistState();
      return structuredClone(channel);
    });
  }

  previewExtensionPackageRolloutChannel(
    request: PreviewExtensionPackageRolloutChannelRequest,
  ): ExtensionPackageRolloutPreview {
    this.assertInitialized();
    return createExtensionPackageRolloutPreview(
      this.getExtensionPackageRolloutChannel(request.channelId),
      this.state.extensions,
      this.state.extensionPublisherTrustAnchors,
    );
  }

  async applyExtensionPackageRolloutChannel(
    request: ApplyExtensionPackageRolloutChannelRequest,
  ): Promise<ApplyExtensionPackageRolloutChannelResult> {
    this.assertInitialized();
    this.getThread(request.threadId);
    return this.stateQueue.run(async () => {
      const channel = this.state.extensionPackageRolloutChannels.find(
        (candidate) => candidate.id === request.channelId,
      );
      if (!channel) {
        throw new Error(
          `Extension package rollout channel not found: ${request.channelId}`,
        );
      }
      const result = applyExtensionPackageRolloutChannelRecords(
        channel,
        this.state.extensions,
        this.state.extensionPublisherTrustAnchors,
        {
          expectedRolloutSha256: request.expectedRolloutSha256,
          expectedDeploymentSha256: request.expectedDeploymentSha256,
          ...(request.confirmPublisherChanges === true
            ? { confirmPublisherChanges: true }
            : {}),
          ...(request.confirmVersionOverrides === true
            ? { confirmVersionOverrides: true }
            : {}),
        },
      );
      if (result.deployment.extensions.length > 0) {
        const nextExtensions = [...this.state.extensions];
        for (const extension of result.deployment.extensions) {
          const index = nextExtensions.findIndex(
            (candidate) => candidate.id === extension.id,
          );
          if (index >= 0) {
            nextExtensions[index] = extension;
          } else {
            nextExtensions.push(extension);
          }
        }
        validateExtensionPackageDependencyGraph(
          nextExtensions,
          this.state.extensionPublisherTrustAnchors,
          { requireTrusted: true },
        );
        this.state.extensions = nextExtensions;
        await this.persistState();
      }
      return structuredClone(result);
    });
  }

  async reviewExtension(
    extensionId: string,
    request: ReviewExtensionRequest,
  ): Promise<ExtensionRecord> {
    return this.updateExtension(extensionId, (current) =>
      reviewExtensionRecord(current, request),
    );
  }

  async setExtensionEnabled(
    extensionId: string,
    agentId: string,
    enabled: boolean,
  ): Promise<ExtensionRecord> {
    this.getAgent(agentId);
    return this.updateExtension(extensionId, (current) => {
      if (enabled) {
        const verification = verifyBoundExtensionPackageTrust(
          current,
          this.state.extensionPublisherTrustAnchors,
        );
        if (verification && verification.status !== "trusted") {
          throw new Error(
            `Signed Extension package is not trusted: ${verification.reason}`,
          );
        }
        const dependencyFailure = extensionPackageDependencyFailure(
          current,
          this.state.extensions,
          this.state.extensionPublisherTrustAnchors,
        );
        if (dependencyFailure) throw new Error(dependencyFailure);
      }
      return setExtensionAgentEnabled(current, agentId, enabled);
    });
  }

  async setExtensionConnection(
    extensionId: string,
    connection: ExtensionConnection,
  ): Promise<ExtensionRecord> {
    return this.updateExtension(extensionId, (current) =>
      updateExtensionConnection(current, connection),
    );
  }

  async replaceDiscoveredMcpTools(
    extensionId: string,
    tools: DiscoveredMcpTool[],
  ): Promise<ExtensionRecord> {
    return this.updateExtension(extensionId, (current) =>
      mergeDiscoveredMcpTools(current, tools),
    );
  }

  async reviewMcpTool(
    extensionId: string,
    toolName: string,
    request: ReviewMcpToolRequest,
  ): Promise<ExtensionRecord> {
    return this.updateExtension(extensionId, (current) =>
      reviewMcpToolRecord(current, toolName, request),
    );
  }

  listMemories(options: { agentId?: string } = {}): MemoryFact[] {
    this.assertInitialized();
    const statusOrder: Record<MemoryFact["status"], number> = {
      proposed: 0,
      active: 1,
      stale: 2,
      rejected: 3,
      archived: 4,
    };
    return structuredClone(
      this.state.memories
        .filter(
          (fact) =>
            !options.agentId ||
            fact.scope === "workspace" ||
            fact.agentId === options.agentId,
        )
        .sort((left, right) => {
          const statusDelta =
            statusOrder[left.status] - statusOrder[right.status];
          return statusDelta || right.updatedAt.localeCompare(left.updatedAt);
        }),
    );
  }

  async proposeMemory(
    input: CreateMemoryRequest,
    source: MemorySource,
  ): Promise<MemoryFact> {
    this.assertInitialized();
    const fact = createMemoryFact(input, source);
    return this.stateQueue.run(async () => {
      const replacementTargetIds = memoryReplacementTargetIds(fact);
      if (replacementTargetIds.length > 0) {
        const targets = replacementTargetIds.map((targetId) => {
          const target = this.state.memories.find(
            (memory) => memory.id === targetId,
          );
          if (!target) {
            throw new Error(`Memory replacement target not found: ${targetId}`);
          }
          return target;
        });
        assertMemoryReplacementTargets(targets, fact);
        const pendingReplacement = this.state.memories.find(
          (memory) =>
            memory.status === "proposed" &&
            memoryReplacementTargetIds(memory).some((targetId) =>
              replacementTargetIds.includes(targetId),
            ),
        );
        if (pendingReplacement) {
          throw new Error(
            `Memory already has a pending replacement: ${pendingReplacement.id}`,
          );
        }
      }
      const key = memoryDedupeKey(fact);
      const replacementKey = memoryReplacementKey(fact);
      const existing = this.state.memories.find(
        (item) =>
          (item.status === "proposed" ||
            (!replacementKey && item.status === "active")) &&
          memoryReplacementKey(item) === replacementKey &&
          memoryDedupeKey(item) === key,
      );
      if (existing) return structuredClone(existing);
      this.state.memories.push(fact);
      await this.persistState();
      return structuredClone(fact);
    });
  }

  async reviewMemory(
    memoryId: string,
    request: ReviewMemoryRequest,
  ): Promise<MemoryFact> {
    this.assertInitialized();
    return this.stateQueue.run(async () => {
      const index = this.state.memories.findIndex(
        (memory) => memory.id === memoryId,
      );
      const current = this.state.memories[index];
      if (!current) throw new Error(`Memory not found: ${memoryId}`);
      const updated = reviewMemoryFact(current, request);
      const replacementTargetIds = memoryReplacementTargetIds(current);
      if (request.action === "approve" && replacementTargetIds.length > 0) {
        const targets = replacementTargetIds.map((targetId) => {
          const targetIndex = this.state.memories.findIndex(
            (memory) => memory.id === targetId,
          );
          const target = this.state.memories[targetIndex];
          if (!target) {
            throw new Error(`Memory replacement target not found: ${targetId}`);
          }
          return { target, targetIndex };
        });
        assertMemoryReplacementTargets(
          targets.map(({ target }) => target),
          updated,
        );
        for (const { target, targetIndex } of targets) {
          this.state.memories[targetIndex] = supersedeMemoryFact(
            target,
            updated.id,
            updated.reviewedAt,
          );
        }
      }
      this.state.memories[index] = updated;
      await this.persistState();
      return structuredClone(updated);
    });
  }

  async expireDueMemories(
    options: { agentId?: string; now?: Date } = {},
  ): Promise<MemoryFact[]> {
    this.assertInitialized();
    return this.stateQueue.run(async () => {
      const expired: MemoryFact[] = [];
      for (let index = 0; index < this.state.memories.length; index += 1) {
        const current = this.state.memories[index]!;
        if (
          options.agentId &&
          current.scope === "agent" &&
          current.agentId !== options.agentId
        ) {
          continue;
        }
        const updated = expireMemoryFact(current, options.now);
        if (updated.revision === current.revision) continue;
        this.state.memories[index] = updated;
        expired.push(structuredClone(updated));
      }
      if (expired.length > 0) await this.persistState();
      return expired;
    });
  }

  async recordMemoryUsage(
    memoryIds: string[],
    runId: string,
    usedAt = nowIso(),
  ): Promise<MemoryFact[]> {
    this.assertInitialized();
    const uniqueIds = [...new Set(memoryIds)];
    return this.stateQueue.run(async () => {
      const updatedFacts: MemoryFact[] = [];
      for (const memoryId of uniqueIds) {
        const index = this.state.memories.findIndex(
          (memory) => memory.id === memoryId,
        );
        const current = this.state.memories[index];
        if (!current) throw new Error(`Memory not found: ${memoryId}`);
        const updated = recordMemoryUse(current, runId, usedAt);
        if (updated.revision === current.revision) continue;
        this.state.memories[index] = updated;
        updatedFacts.push(structuredClone(updated));
      }
      if (updatedFacts.length > 0) await this.persistState();
      return updatedFacts;
    });
  }

  async getDetail(threadId: string): Promise<ThreadDetail> {
    const thread = this.getThread(threadId);
    const events = await this.listEvents(threadId);
    return {
      thread,
      agent: this.getAgent(thread.agentId),
      runs: this.listRuns(threadId),
      plans: this.listPlans(threadId),
      evaluations: this.listRunEvaluations(threadId),
      evaluationAdjudications: this.listEvaluationAdjudications(threadId),
      evaluationReviewerBallots: this.listEvaluationReviewerBallots(threadId),
      evaluationConsensusResolutions:
        this.listEvaluationConsensusResolutions(threadId),
      evaluationSuites: this.listEvaluationSuites(threadId),
      evaluationSuiteExecutions: this.listEvaluationSuiteExecutions(threadId),
      automaticRecoveryAssessments:
        this.listAutomaticRecoveryAssessments(threadId),
      automaticRecoveryAttempts: this.listAutomaticRecoveryAttempts(threadId),
      subagents: this.listSubagentTasks(threadId),
      runControlMessages: projectRunControlMessages(events),
      operatorDecisions: projectOperatorDecisions(events),
      contextCheckpointCalibration: createContextCheckpointCalibrationReport(
        threadId,
        events,
      ),
      events,
    };
  }

  async listRunControlMessages(
    threadId: string,
    runId?: string,
  ): Promise<RunControlMessage[]> {
    const events = await this.listEvents(threadId);
    return projectRunControlMessages(events, runId);
  }

  async listOperatorDecisions(
    threadId: string,
    runId?: string,
  ): Promise<OperatorDecision[]> {
    const events = await this.listEvents(threadId);
    return projectOperatorDecisions(events, runId);
  }

  async listAgentMilestones(
    threadId: string,
    runId?: string,
  ): Promise<AgentMilestone[]> {
    const events = await this.listEvents(threadId);
    return projectAgentMilestones(events, runId);
  }

  async listEvents(threadId: string, afterSeq = 0): Promise<RunEvent[]> {
    this.assertInitialized();
    this.getThread(threadId);
    return structuredClone(this.requireLedger().listEvents(threadId, afterSeq));
  }

  async createThread(input: {
    title: string;
    agentId: string;
    importProvenance?: ThreadImportProvenance;
  }): Promise<ThreadRecord> {
    this.assertInitialized();
    this.getAgent(input.agentId);
    return this.stateQueue.run(async () => {
      const timestamp = nowIso();
      const thread: ThreadRecord = {
        id: createId("thread"),
        title: input.title,
        agentId: input.agentId,
        status: "idle",
        createdAt: timestamp,
        updatedAt: timestamp,
        lastMessage: "",
        eventCount: 0,
        runIds: [],
        ...(input.importProvenance
          ? { importProvenance: structuredClone(input.importProvenance) }
          : {}),
      };
      this.state.threads.push(thread);
      await this.persistState();
      return structuredClone(thread);
    });
  }

  async importThreadReplayBundle(
    input: ThreadReplayBundle,
    title?: string,
  ): Promise<ThreadDetail> {
    this.assertInitialized();
    const bundle = validateThreadReplayBundle(input);
    const bundleVerification = verifyThreadReplayBundle(bundle);
    if (bundleVerification.status !== "valid") {
      throw new Error(
        `Thread replay bundle verification failed: ${bundleVerification.diagnostics.join(", ")}`,
      );
    }
    const importedThreadId = await this.stateQueue.run(async () => {
      const importedAt = nowIso();
      const agentId = createId("agent");
      const threadId = createId("thread");
      const runIds = new Map(
        bundle.runs.map((run) => [run.id, createId("run")]),
      );
      const auxiliaryRunIds = new Map<string, string>();
      for (const event of bundle.events) {
        if (!runIds.has(event.runId) && !auxiliaryRunIds.has(event.runId)) {
          auxiliaryRunIds.set(event.runId, createId("runctl"));
        }
      }
      const planIds = new Map(
        bundle.plans.map((plan) => [plan.id, createId("plan")]),
      );
      const evaluationIds = new Map(
        bundle.evaluations.map((evaluation) => [
          evaluation.id,
          createId("evaluation"),
        ]),
      );
      const evaluationAdjudicationIds = new Map(
        (bundle.evaluationAdjudications ?? []).map((adjudication) => [
          adjudication.id,
          createId("adjudication"),
        ]),
      );
      const evaluationReviewerBallotIds = new Map(
        (bundle.evaluationReviewerBallots ?? []).map((ballot) => [
          ballot.id,
          createId("reviewballot"),
        ]),
      );
      const evaluationConsensusResolutionIds = new Map(
        (bundle.evaluationConsensusResolutions ?? []).map((resolution) => [
          resolution.id,
          createId("consensus"),
        ]),
      );
      const evaluationSuiteIds = new Map(
        (bundle.evaluationSuites ?? []).map((suite) => [
          suite.id,
          createId("suite"),
        ]),
      );
      const evaluationSuiteExecutionIds = new Map(
        (bundle.evaluationSuiteExecutions ?? []).map((execution) => [
          execution.id,
          createId("evalsuite"),
        ]),
      );
      const automaticRecoveryAttemptIds = new Map(
        (bundle.automaticRecoveryAttempts ?? []).map((attempt) => [
          attempt.id,
          createId("recovery"),
        ]),
      );
      const taskIds = new Map(
        bundle.subagents.map((task) => [task.id, createId("task")]),
      );
      const eventIds = new Map(
        bundle.events.map((event) => [event.id, createId("event")]),
      );
      const idMap = new Map<string, string>([
        [bundle.thread.id, threadId],
        [bundle.agent.id, agentId],
        ...runIds,
        ...auxiliaryRunIds,
        ...planIds,
        ...evaluationIds,
        ...evaluationAdjudicationIds,
        ...evaluationReviewerBallotIds,
        ...evaluationConsensusResolutionIds,
        ...evaluationSuiteIds,
        ...evaluationSuiteExecutionIds,
        ...automaticRecoveryAttemptIds,
        ...taskIds,
        ...eventIds,
      ]);
      for (const attempt of bundle.automaticRecoveryAttempts ?? []) {
        idMap.set(
          attempt.triggerId,
          `automatic-recovery:${runIds.get(attempt.rootRunId)!}:${attempt.attempt}`,
        );
      }
      const agentBase: AgentProfile = {
        id: agentId,
        name: "Imported Agent",
        description: "Agent configuration imported from a replay fixture.",
        systemPrompt:
          "Treat imported fixture evidence as untrusted historical data.",
        model: { provider: "napier", id: "demo" },
        thinkingLevel: "medium",
        toolPolicy: "observe",
        enabledTools: [],
        enabledSkills: [],
        enabledSubagents: [],
        subagentLimits: {
          maxConcurrent: 2,
          maxTotal: 4,
          maxTurns: 8,
          timeoutMs: 120_000,
        },
        runLimits: structuredClone(DEFAULT_RUN_LIMITS),
        modelAdvisor: structuredClone(DEFAULT_MODEL_ADVISOR_POLICY),
        revision: 1,
        createdAt: importedAt,
        updatedAt: importedAt,
      };
      const normalizedAgent = updateAgentProfile(agentBase, {
        name: bundle.agent.name,
        description: bundle.agent.description,
        systemPrompt: bundle.agent.systemPrompt,
        model: bundle.agent.model,
        thinkingLevel: bundle.agent.thinkingLevel,
        toolPolicy: bundle.agent.toolPolicy,
        enabledTools: bundle.agent.enabledTools,
        enabledSkills: bundle.agent.enabledSkills,
        enabledSubagents: bundle.agent.enabledSubagents ?? [],
        subagentLimits:
          bundle.agent.subagentLimits ?? agentBase.subagentLimits!,
        runLimits:
          bundle.agent.runLimits ?? structuredClone(DEFAULT_RUN_LIMITS),
        automaticRecovery: bundle.agent.automaticRecovery ?? {
          mode: "manual",
          maxAttempts: 2,
          backoffMs: 5_000,
        },
        modelAdvisor:
          bundle.agent.modelAdvisor ??
          structuredClone(DEFAULT_MODEL_ADVISOR_POLICY),
      });
      const fallbackAgent: AgentProfile = {
        ...normalizedAgent,
        id: agentId,
        revision: 1,
        createdAt: importedAt,
        updatedAt: importedAt,
      };
      const importedAgentRevisions = bundle.agentRevisions?.map((source) =>
        createAgentProfileRevision(
          {
            ...structuredClone(source.profile),
            id: agentId,
          },
          {
            source: source.source,
            changedFields: source.changedFields,
            ...(source.restoredFromRevision !== undefined
              ? { restoredFromRevision: source.restoredFromRevision }
              : {}),
            createdAt: source.createdAt,
          },
        ),
      );
      const agent =
        importedAgentRevisions?.find(
          (revision) => revision.revision === bundle.agent.revision,
        )?.profile ?? fallbackAgent;
      const agentRevisions = importedAgentRevisions ?? [
        createAgentProfileRevision(agent, { source: "imported" }),
      ];
      const activeRunIds = new Set(
        bundle.runs
          .filter((run) => run.status === "queued" || run.status === "running")
          .map((run) => run.id),
      );
      const runs: PersistedRunRecord[] = bundle.runs.map((source) => {
        const active = activeRunIds.has(source.id);
        const mappedParentId = source.parentRunId
          ? runIds.get(source.parentRunId)
          : undefined;
        return {
          id: runIds.get(source.id)!,
          threadId,
          agentId,
          status: active ? "interrupted" : source.status,
          ...(source.source ? { source: source.source } : {}),
          ...(source.workflowPlanId
            ? { workflowPlanId: planIds.get(source.workflowPlanId)! }
            : {}),
          startedAt: source.startedAt,
          ...(active
            ? {
                finishedAt: importedAt,
                interruptedAt: importedAt,
                interruptionReason:
                  "Imported fixture captured this run before it reached a terminal state.",
                error:
                  "Imported fixture run outcome is unknown and requires verification.",
              }
            : {
                ...(source.finishedAt ? { finishedAt: source.finishedAt } : {}),
                ...(source.interruptedAt
                  ? { interruptedAt: source.interruptedAt }
                  : {}),
                ...(source.interruptionReason
                  ? { interruptionReason: source.interruptionReason }
                  : {}),
                ...(source.error ? { error: source.error } : {}),
              }),
          ...(mappedParentId ? { parentRunId: mappedParentId } : {}),
          ...(source.branchFromSeq !== undefined
            ? { branchFromSeq: source.branchFromSeq }
            : {}),
          usage: structuredClone(source.usage),
          agentRevision:
            source.agentRevision ??
            source.configuration?.agentRevision ??
            bundle.agent.revision,
          limits: normalizeRunLimits(
            source.limits ??
              source.configuration?.runLimits ??
              agent.runLimits ??
              structuredClone(DEFAULT_RUN_LIMITS),
          ),
          ...(source.configuration
            ? { configuration: structuredClone(source.configuration) }
            : {}),
        };
      });
      const plans: ExecutionPlan[] = bundle.plans.map((source) => {
        const hadRunningStep = source.steps.some(
          (step) => step.status === "running",
        );
        return refreshPlanProjection({
          ...structuredClone(source),
          id: planIds.get(source.id)!,
          threadId,
          status: hadRunningStep ? "blocked" : source.status,
          steps: source.steps.map((step) => ({
            ...structuredClone(step),
            ...(step.runId && runIds.has(step.runId)
              ? { runId: runIds.get(step.runId)! }
              : {}),
            ...(step.status === "running"
              ? {
                  status: "blocked" as const,
                  blocker:
                    "Imported fixture captured this step while it was running.",
                  evidence:
                    "The imported step outcome is unknown and must be verified before reopening.",
                  finishedAt: importedAt,
                  updatedAt: importedAt,
                }
              : {}),
          })),
          artifacts: source.artifacts.map((artifact) => ({
            ...structuredClone(artifact),
            ...(artifact.sourceRunId && runIds.has(artifact.sourceRunId)
              ? { sourceRunId: runIds.get(artifact.sourceRunId)! }
              : {}),
          })),
          revision: source.revision + (hadRunningStep ? 1 : 0),
          updatedAt: hadRunningStep ? importedAt : source.updatedAt,
        });
      });
      const evaluations: RunEvaluationRecord[] = bundle.evaluations.map(
        (source) => ({
          ...structuredClone(source),
          id: evaluationIds.get(source.id)!,
          threadId,
          leftRunId: runIds.get(source.leftRunId)!,
          rightRunId: runIds.get(source.rightRunId)!,
        }),
      );
      const mappedEvaluationsBySourceId = new Map(
        bundle.evaluations.map((source, index) => [
          source.id,
          evaluations[index]!,
        ]),
      );
      const evaluationReviewerBallots: EvaluationReviewerBallot[] = (
        bundle.evaluationReviewerBallots ?? []
      ).map((source) => {
        const evaluation = mappedEvaluationsBySourceId.get(
          source.evaluationId,
        )!;
        const ballotId = evaluationReviewerBallotIds.get(source.id)!;
        const revisions = source.revisions.map((revision) => {
          const content = {
            revision: revision.revision,
            reviewerName: revision.reviewerName,
            expectedVerdict: revision.expectedVerdict,
            note: revision.note,
            evaluationSha256: hashRunEvaluation(evaluation),
            createdAt: revision.createdAt,
          };
          return {
            ...content,
            contentSha256: hashEvaluationReviewerBallotRevision(
              ballotId,
              threadId,
              evaluation.id,
              source.reviewerId,
              content,
            ),
          };
        });
        return validateEvaluationReviewerBallot(
          {
            ...structuredClone(source),
            id: ballotId,
            threadId,
            evaluationId: evaluation.id,
            revisions,
          },
          evaluation,
        );
      });
      const mappedBallotsBySourceId = new Map(
        (bundle.evaluationReviewerBallots ?? []).map((source, index) => [
          source.id,
          evaluationReviewerBallots[index]!,
        ]),
      );
      const mappedReportsByResolutionId = new Map<
        string,
        EvaluationConsensusReport
      >();
      const mappedReportSha256 = new Map<string, string>();
      for (const source of bundle.evaluationConsensusResolutions ?? []) {
        const evaluation = mappedEvaluationsBySourceId.get(
          source.evaluationId,
        )!;
        const mapped: EvaluationConsensusReport = {
          ...structuredClone(source.report),
          threadId,
          evaluationId: evaluation.id,
          evaluationSha256: hashRunEvaluation(evaluation),
          votes: source.report.votes.map((vote) => {
            const ballot = mappedBallotsBySourceId.get(vote.ballotId)!;
            const revision = ballot.revisions.find(
              (candidate) => candidate.revision === vote.ballotRevision,
            )!;
            return {
              ...structuredClone(vote),
              ballotId: ballot.id,
              ballotSha256: revision.contentSha256,
            };
          }),
          contentSha256: "",
        };
        const {
          generatedAt: _generatedAt,
          contentSha256: _contentSha256,
          ...content
        } = mapped;
        mapped.contentSha256 = hashEvaluationConsensusReport(content);
        validateEvaluationConsensusReport(
          mapped,
          evaluation,
          evaluationReviewerBallots.filter(
            (ballot) => ballot.evaluationId === evaluation.id,
          ),
          { requireCurrent: false },
        );
        mappedReportsByResolutionId.set(source.id, mapped);
        mappedReportSha256.set(
          source.report.contentSha256,
          mapped.contentSha256,
        );
      }
      const evaluationAdjudications: EvaluationAdjudication[] = (
        bundle.evaluationAdjudications ?? []
      ).map((source) => {
        const evaluation = mappedEvaluationsBySourceId.get(
          source.evaluationId,
        )!;
        const adjudicationId = evaluationAdjudicationIds.get(source.id)!;
        const revisions = source.revisions.map((revision) => {
          const mappedSourceSha256 = revision.sourceSha256
            ? mappedReportSha256.get(revision.sourceSha256)
            : undefined;
          if (revision.source && !mappedSourceSha256) {
            throw new Error(
              `Imported consensus report is missing: ${revision.sourceSha256}`,
            );
          }
          const content = {
            revision: revision.revision,
            expectedVerdict: revision.expectedVerdict,
            note: revision.note,
            evaluationSha256: hashRunEvaluation(evaluation),
            ...(revision.source
              ? {
                  source: revision.source,
                  sourceSha256: mappedSourceSha256!,
                }
              : {}),
            createdAt: revision.createdAt,
          };
          return {
            ...content,
            contentSha256: hashEvaluationAdjudicationRevision(
              adjudicationId,
              threadId,
              evaluation.id,
              content,
            ),
          };
        });
        return validateEvaluationAdjudication(
          {
            ...structuredClone(source),
            id: adjudicationId,
            threadId,
            evaluationId: evaluation.id,
            revisions,
          },
          evaluation,
        );
      });
      const mappedAdjudicationsBySourceId = new Map(
        (bundle.evaluationAdjudications ?? []).map((source, index) => [
          source.id,
          evaluationAdjudications[index]!,
        ]),
      );
      const evaluationConsensusResolutions: EvaluationConsensusResolution[] = (
        bundle.evaluationConsensusResolutions ?? []
      ).map((source) => {
        const evaluation = mappedEvaluationsBySourceId.get(
          source.evaluationId,
        )!;
        const report = mappedReportsByResolutionId.get(source.id)!;
        const adjudication = mappedAdjudicationsBySourceId.get(
          source.adjudicationId,
        )!;
        const adjudicationRevision = adjudication.revisions.find(
          (revision) =>
            revision.revision === source.adjudicationRevision.revision,
        )!;
        const id = evaluationConsensusResolutionIds.get(source.id)!;
        const content = {
          threadId,
          evaluationId: evaluation.id,
          evaluationSha256: hashRunEvaluation(evaluation),
          report,
          adjudicationId: adjudication.id,
          adjudicationRevision,
          createdAt: source.createdAt,
        };
        const resolution: EvaluationConsensusResolution = {
          id,
          ...content,
          contentSha256: hashEvaluationConsensusResolution(id, content),
        };
        return validateEvaluationConsensusResolution(
          resolution,
          evaluation,
          evaluationReviewerBallots.filter(
            (ballot) => ballot.evaluationId === evaluation.id,
          ),
          adjudication,
        );
      });
      const evaluationSuites: EvaluationSuite[] = (
        bundle.evaluationSuites ?? []
      ).map((source) => ({
        ...structuredClone(source),
        id: evaluationSuiteIds.get(source.id)!,
        threadId,
        baselineRunId: runIds.get(source.baselineRunId)!,
        candidateRunIds: source.candidateRunIds.map(
          (runId) => runIds.get(runId)!,
        ),
      }));
      const evaluationSuiteExecutions: EvaluationSuiteExecution[] = (
        bundle.evaluationSuiteExecutions ?? []
      ).map((source) => {
        const mapped: EvaluationSuiteExecution = {
          ...structuredClone(source),
          id: evaluationSuiteExecutionIds.get(source.id)!,
          suiteId: evaluationSuiteIds.get(source.suiteId)!,
          threadId,
          baselineRunId: runIds.get(source.baselineRunId)!,
          candidateRunIds: source.candidateRunIds.map(
            (runId) => runIds.get(runId)!,
          ),
          results: source.results.map((result) => {
            const evaluation = mappedEvaluationsBySourceId.get(
              result.evaluationId,
            )!;
            return {
              ...structuredClone(result),
              candidateRunId: runIds.get(result.candidateRunId)!,
              evaluationId: evaluationIds.get(result.evaluationId)!,
              evaluationSha256: hashRunEvaluation(evaluation),
            };
          }),
          contentSha256: "",
        };
        const {
          id: _id,
          contentSha256: _contentSha256,
          startedAt: _startedAt,
          finishedAt: _finishedAt,
          ...hashInput
        } = mapped;
        mapped.contentSha256 = hashEvaluationSuiteExecution(hashInput);
        return mapped;
      });
      for (const execution of evaluationSuiteExecutions) {
        validateEvaluationSuiteExecution(
          execution,
          evaluationSuites,
          evaluations,
          runs,
        );
      }
      const subagents: SubagentTask[] = bundle.subagents.map((source) => {
        const active =
          source.status === "pending" || source.status === "running";
        const { outcome: _outcome, ...sourceTask } = structuredClone(source);
        const taskId = taskIds.get(source.id)!;
        return {
          ...sourceTask,
          id: taskId,
          threadId,
          runId: runIds.get(source.runId)!,
          ...(!active && source.outcome
            ? {
                outcome: rebindSubagentOutcome(source.outcome, {
                  taskId,
                  prompt: source.prompt,
                }),
              }
            : {}),
          ...(active
            ? {
                status: "cancelled" as const,
                stopReason: "cancelled" as const,
                error:
                  "Imported fixture captured this subagent before it reached a terminal state.",
                finishedAt: importedAt,
                revision: source.revision + 1,
              }
            : {}),
        };
      });
      const subagentsById = new Map(
        subagents.map((task) => [task.id, task] as const),
      );
      const events: RunEvent[] = bundle.events.map((source) => {
        const payload = rebindImportedSubagentEventPayload(
          source.type,
          source.payload,
          remapJsonValue(source.payload, idMap),
          subagentsById,
          idMap,
        );
        return {
          id: eventIds.get(source.id)!,
          threadId,
          runId: runIds.get(source.runId) ?? auxiliaryRunIds.get(source.runId)!,
          seq: source.seq,
          type: source.type,
          category: source.category,
          visibility: source.visibility,
          createdAt: source.createdAt,
          payload,
        };
      });
      const mappedAssessmentSha256 = new Map<string, string>();
      const automaticRecoveryAssessments: AutomaticRecoveryAssessment[] = (
        bundle.automaticRecoveryAssessments ?? []
      )
        .slice()
        .sort(
          (left, right) =>
            left.priorAttempts - right.priorAttempts ||
            left.assessedAt.localeCompare(right.assessedAt),
        )
        .map((source) => {
          for (const event of events) {
            event.payload = remapJsonValue(event.payload, idMap);
          }
          const mappedRunId = runIds.get(source.runId)!;
          const mappedRootRunId = runIds.get(source.rootRunId)!;
          const mappedRunEvents = events.filter(
            (event) => event.runId === mappedRunId,
          );
          const {
            contentSha256: _contentSha256,
            eventRange: _eventRange,
            ...sourceContent
          } = source;
          const content: Omit<AutomaticRecoveryAssessment, "contentSha256"> = {
            ...structuredClone(sourceContent),
            threadId,
            runId: mappedRunId,
            rootRunId: mappedRootRunId,
            agentId,
            eventRange: {
              fromSeq: mappedRunEvents[0]?.seq ?? 0,
              toSeq: mappedRunEvents.at(-1)?.seq ?? 0,
              eventCount: mappedRunEvents.length,
              eventStreamSha256:
                hashAutomaticRecoveryEventStream(mappedRunEvents),
            },
          };
          const mapped = validateAutomaticRecoveryAssessment({
            ...content,
            contentSha256: hashAutomaticRecoveryAssessment(content),
          });
          mappedAssessmentSha256.set(
            source.contentSha256,
            mapped.contentSha256,
          );
          idMap.set(source.contentSha256, mapped.contentSha256);
          return mapped;
        });
      const automaticRecoveryAttempts: PersistedAutomaticRecoveryAttempt[] = (
        bundle.automaticRecoveryAttempts ?? []
      ).map((source) => {
        const id = automaticRecoveryAttemptIds.get(source.id)!;
        const rootRunId = runIds.get(source.rootRunId)!;
        const interruptedRunId = runIds.get(source.interruptedRunId)!;
        const assessmentSha256 = mappedAssessmentSha256.get(
          source.assessmentSha256,
        )!;
        const mappedRecoveryRunId = source.recoveryRunId
          ? runIds.get(source.recoveryRunId)
          : undefined;
        const convertedClaimed = source.status === "claimed";
        const convertedRunning = source.status === "running";
        const status: AutomaticRecoveryAttempt["status"] = convertedClaimed
          ? "abandoned"
          : convertedRunning
            ? "interrupted"
            : source.status;
        const triggerId = `automatic-recovery:${rootRunId}:${source.attempt}`;
        const recoveryRun = mappedRecoveryRunId
          ? runs.find((run) => run.id === mappedRecoveryRunId)
          : undefined;
        if (recoveryRun) recoveryRun.triggerId = triggerId;
        const converted = convertedClaimed || convertedRunning;
        const content: Omit<AutomaticRecoveryAttempt, "contentSha256"> = {
          id,
          threadId,
          agentId,
          rootRunId,
          interruptedRunId,
          attempt: source.attempt,
          maxAttempts: source.maxAttempts,
          triggerId,
          assessmentSha256,
          status,
          ...(!convertedClaimed && mappedRecoveryRunId
            ? { recoveryRunId: mappedRecoveryRunId }
            : {}),
          ...(converted
            ? {
                error:
                  "Imported fixture closed an in-flight automatic recovery attempt.",
              }
            : source.error
              ? { error: source.error }
              : {}),
          createdAt: source.createdAt,
          updatedAt: converted ? importedAt : source.updatedAt,
          ...(!convertedClaimed && source.startedAt
            ? { startedAt: source.startedAt }
            : {}),
          ...(converted
            ? { finishedAt: importedAt }
            : source.finishedAt
              ? { finishedAt: source.finishedAt }
              : {}),
          revision: source.revision + (converted ? 1 : 0),
        };
        const mapped = validateAutomaticRecoveryAttempt({
          ...content,
          contentSha256: hashAutomaticRecoveryAttempt(content),
        });
        idMap.set(source.contentSha256, mapped.contentSha256);
        return mapped;
      });
      for (const event of events) {
        event.payload = remapJsonValue(event.payload, idMap);
      }
      const importedStatus: ThreadStatus =
        activeRunIds.size > 0 || bundle.thread.status === "waiting"
          ? "waiting"
          : bundle.thread.status === "failed"
            ? "failed"
            : "idle";
      const goal = bundle.thread.goal
        ? structuredClone(bundle.thread.goal)
        : undefined;
      if (goal?.lastEvaluatedRunId) {
        goal.lastEvaluatedRunId =
          runIds.get(goal.lastEvaluatedRunId) ?? goal.lastEvaluatedRunId;
      }
      const localImportedThroughSeq = events.length + 1;
      const importProvenance: ThreadImportProvenance = {
        sourceThreadId: bundle.thread.id,
        sourceApiVersion: bundle.apiVersion,
        sourceContentSha256: bundle.contentSha256,
        sourceEventStreamSha256: bundle.eventStreamSha256,
        sourceEventCount: bundle.events.length,
        localImportedThroughSeq,
        sourceModelContextEnvelopeCount:
          bundleVerification.modelContextEnvelopeCount,
        sourceEmbeddedModelContextEnvelopeCount:
          bundleVerification.embeddedModelContextEnvelopeCount,
        importedAt,
      };
      events.push({
        id: createId("event"),
        threadId,
        runId: createId("runctl"),
        seq: localImportedThroughSeq,
        type: THREAD_IMPORTED_EVENT,
        category: "lifecycle",
        visibility: "debug",
        createdAt: importedAt,
        payload: threadImportProvenanceEventPayload(importProvenance),
      });
      const thread: ThreadRecord = {
        id: threadId,
        title: normalizeImportedThreadTitle(
          title ?? `${bundle.thread.title} (imported)`,
        ),
        agentId,
        status: importedStatus,
        createdAt: importedAt,
        updatedAt: importedAt,
        lastMessage: bundle.thread.lastMessage,
        eventCount: events.length,
        ...(goal ? { goal } : {}),
        runIds: bundle.thread.runIds.map((runId) => runIds.get(runId)!),
        importProvenance,
      };
      this.state.agents.push(agent);
      this.state.agentRevisions.push(...agentRevisions);
      this.state.threads.push(thread);
      this.state.runs.push(...runs);
      this.state.plans.push(...plans);
      this.state.evaluations.push(...evaluations);
      this.state.evaluationAdjudications.push(...evaluationAdjudications);
      this.state.evaluationReviewerBallots.push(...evaluationReviewerBallots);
      this.state.evaluationConsensusResolutions.push(
        ...evaluationConsensusResolutions,
      );
      this.state.evaluationSuites.push(...evaluationSuites);
      this.state.evaluationSuiteExecutions.push(...evaluationSuiteExecutions);
      this.state.automaticRecoveryAssessments.push(
        ...automaticRecoveryAssessments,
      );
      this.state.automaticRecoveryAttempts.push(...automaticRecoveryAttempts);
      this.state.subagents.push(...subagents);
      await this.persistState(events);
      return threadId;
    });
    return this.getDetail(importedThreadId);
  }

  async createRun(input: CreateRunInput): Promise<RunRecord> {
    this.assertInitialized();
    return this.stateQueue.run(async () => {
      const run = this.createRunRecord(input);
      await this.persistState();
      return structuredClone(stripRunSecrets(run));
    });
  }

  async createLeasedRun(
    input: CreateRunInput,
    leaseOptions: RunLeaseOptions,
  ): Promise<RunLeaseHandle> {
    this.assertInitialized();
    const ttlMs = validateLeaseTtl(leaseOptions.ttlMs);
    const ownerId = normalizeLeaseOwner(leaseOptions.ownerId);
    return this.stateQueue.run(async () => {
      const token = createLeaseToken();
      const acquiredAt = nowIso();
      const run = this.createRunRecord(input, {
        tokenSha256: sha256(token),
        summary: {
          ownerId,
          acquiredAt,
          heartbeatAt: acquiredAt,
          expiresAt: new Date(Date.parse(acquiredAt) + ttlMs).toISOString(),
          revision: 1,
        },
      });
      await this.persistState();
      return {
        run: structuredClone(stripRunSecrets(run)),
        token,
      };
    });
  }

  async renewRunLease(
    runId: string,
    token: string,
    ttlMs: number,
  ): Promise<RunRecord> {
    this.assertInitialized();
    const normalizedTtl = validateLeaseTtl(ttlMs);
    return this.stateQueue.run(async () => {
      const run = this.mutableRun(runId);
      assertLeaseToken(run.leaseTokenSha256, token);
      if (!run.lease || run.status !== "running") {
        throw new Error("Run lease is not active");
      }
      if (Date.parse(run.lease.expiresAt) <= Date.now()) {
        throw new Error("Run lease has expired");
      }
      const heartbeatAt = nowIso();
      run.lease = {
        ...run.lease,
        heartbeatAt,
        expiresAt: new Date(
          Date.parse(heartbeatAt) + normalizedTtl,
        ).toISOString(),
        revision: run.lease.revision + 1,
      };
      await this.persistState();
      return structuredClone(stripRunSecrets(run));
    });
  }

  async recordAgentMilestone(
    input: RecordAgentMilestoneStoreInput,
  ): Promise<AgentMilestoneMutation> {
    this.assertInitialized();
    this.validateResourceId(input.threadId);
    this.validateResourceId(input.runId);
    return this.threadQueue(input.threadId).run(() =>
      this.stateQueue.run(async () => {
        const thread = this.mutableThread(input.threadId);
        const run = this.mutableRun(input.runId);
        if (run.source === "workflow") {
          throw new Error("Workflow node Runs do not record Agent milestones");
        }
        if (
          run.threadId !== thread.id ||
          run.status !== "running" ||
          thread.currentRunId !== run.id
        ) {
          throw new Error("Agent milestone requires the active Thread Run");
        }
        const currentEvents = this.requireLedger().listEvents(thread.id);
        const current = projectAgentMilestones(currentEvents);
        if (current.length >= MAX_AGENT_MILESTONES_PER_THREAD) {
          throw new Error(
            `Agent milestone Thread limit reached (${MAX_AGENT_MILESTONES_PER_THREAD})`,
          );
        }
        const runMilestones = current.filter(
          (milestone) => milestone.runId === run.id,
        );
        if (runMilestones.length >= MAX_AGENT_MILESTONES_PER_RUN) {
          throw new Error(
            `Agent milestone Run limit reached (${MAX_AGENT_MILESTONES_PER_RUN})`,
          );
        }
        const payload = createAgentMilestoneRecordedPayload({
          milestoneId: createId("milestone"),
          milestone: {
            phase: input.phase,
            title: input.title,
            summary: input.summary,
            completedItems: input.completedItems,
            openLoops: input.openLoops,
          },
          ...(runMilestones.at(-1)
            ? { predecessor: runMilestones.at(-1)! }
            : {}),
        });
        const events = this.appendEventsToThread(thread, [
          {
            threadId: thread.id,
            runId: run.id,
            type: "agent.milestone.recorded",
            category: "plan",
            visibility: "user",
            payload,
          },
        ]);
        await this.persistState(events);
        const milestone = projectAgentMilestones([
          ...currentEvents,
          ...events,
        ]).find((candidate) => candidate.id === payload.milestoneId);
        if (!milestone) {
          throw new Error("Agent milestone receipt is invalid");
        }
        return {
          milestone: structuredClone(milestone),
          events: structuredClone(events),
        };
      }),
    );
  }

  async requestOperatorDecision(
    input: RequestOperatorDecisionStoreInput,
  ): Promise<OperatorDecisionMutation> {
    this.assertInitialized();
    this.validateResourceId(input.threadId);
    this.validateResourceId(input.runId);
    return this.threadQueue(input.threadId).run(() =>
      this.stateQueue.run(async () => {
        const thread = this.mutableThread(input.threadId);
        const run = this.mutableRun(input.runId);
        if (
          run.threadId !== thread.id ||
          run.status !== "running" ||
          thread.currentRunId !== run.id
        ) {
          throw new Error("Operator decision requires the active Thread Run");
        }
        if (
          run.source !== "workflow" &&
          run.configuration?.model.provider === "napier" &&
          run.configuration.model.id === "demo"
        ) {
          throw new Error("The demo model cannot request operator decisions");
        }
        const currentEvents = this.requireLedger().listEvents(thread.id);
        const current = projectOperatorDecisions(currentEvents);
        if (current.length >= MAX_OPERATOR_DECISIONS_PER_THREAD) {
          throw new Error(
            `Operator decision limit reached (${MAX_OPERATOR_DECISIONS_PER_THREAD})`,
          );
        }
        if (
          current.some(
            (decision) =>
              decision.status === "pending" || decision.status === "answered",
          )
        ) {
          throw new Error("Thread already has an open operator decision");
        }
        const payload = createOperatorDecisionRequestedPayload({
          decisionId: createId("decision"),
          request: {
            header: input.header,
            question: input.question,
            options: input.options,
            multiSelect: input.multiSelect,
          },
        });
        const events = this.appendEventsToThread(thread, [
          {
            threadId: thread.id,
            runId: run.id,
            type: "operator.decision.requested",
            category: "system",
            visibility: "user",
            payload,
          },
        ]);
        await this.persistState(events);
        const decision = projectOperatorDecisions([
          ...currentEvents,
          ...events,
        ]).find((candidate) => candidate.id === payload.decisionId);
        if (!decision || decision.status !== "pending") {
          throw new Error("Operator decision request receipt is invalid");
        }
        return {
          decision: structuredClone(decision),
          events: structuredClone(events),
        };
      }),
    );
  }

  async answerOperatorDecision(
    threadId: string,
    decisionId: string,
    answer: AnswerOperatorDecisionRequest,
  ): Promise<OperatorDecisionMutation> {
    this.assertInitialized();
    this.validateResourceId(threadId);
    this.validateResourceId(decisionId);
    return this.threadQueue(threadId).run(() =>
      this.stateQueue.run(async () => {
        const thread = this.mutableThread(threadId);
        if (thread.currentRunId || thread.status !== "waiting") {
          throw new Error("Operator decision answer requires a waiting Thread");
        }
        const currentEvents = this.requireLedger().listEvents(thread.id);
        const current = projectOperatorDecisions(currentEvents).find(
          (decision) => decision.id === decisionId,
        );
        if (!current) {
          throw new Error(`Operator decision not found: ${decisionId}`);
        }
        if (current.status === "answered") {
          throw new Error("Operator decision has already been answered");
        }
        if (current.status !== "pending") {
          throw new Error(
            `Operator decision cannot be answered in ${current.status} state`,
          );
        }
        const originRun = this.mutableRun(current.runId);
        if (
          originRun.threadId !== thread.id ||
          (originRun.status !== "completed" &&
            originRun.status !== "interrupted")
        ) {
          throw new Error(
            "Operator decision origin Run is not waiting for input",
          );
        }
        const payload = createOperatorDecisionAnsweredPayload({
          decision: current,
          answer,
        });
        const events = this.appendEventsToThread(thread, [
          {
            threadId: thread.id,
            runId: current.runId,
            type: "operator.decision.answered",
            category: "system",
            visibility: "user",
            payload,
          },
        ]);
        await this.persistState(events);
        const decision = projectOperatorDecisions([
          ...currentEvents,
          ...events,
        ]).find((candidate) => candidate.id === decisionId);
        if (!decision || decision.status !== "answered") {
          throw new Error("Operator decision answer receipt is invalid");
        }
        return {
          decision: structuredClone(decision),
          events: structuredClone(events),
        };
      }),
    );
  }

  async continueOperatorDecision(
    threadId: string,
    decisionId: string,
    continuationRunId: string,
  ): Promise<OperatorDecisionMutation> {
    this.assertInitialized();
    this.validateResourceId(threadId);
    this.validateResourceId(decisionId);
    this.validateResourceId(continuationRunId);
    return this.threadQueue(threadId).run(() =>
      this.stateQueue.run(async () => {
        const thread = this.mutableThread(threadId);
        const continuationRun = this.mutableRun(continuationRunId);
        const currentEvents = this.requireLedger().listEvents(thread.id);
        const current = projectOperatorDecisions(currentEvents).find(
          (decision) => decision.id === decisionId,
        );
        if (!current) {
          throw new Error(`Operator decision not found: ${decisionId}`);
        }
        if (current.status !== "answered") {
          throw new Error(
            `Operator decision cannot continue in ${current.status} state`,
          );
        }
        if (
          thread.currentRunId !== continuationRun.id ||
          continuationRun.threadId !== thread.id ||
          continuationRun.status !== "running" ||
          continuationRun.parentRunId !== current.runId
        ) {
          throw new Error(
            "Operator decision continuation Run binding is invalid",
          );
        }
        const payload = createOperatorDecisionContinuedPayload({
          decision: current,
          continuationRunId: continuationRun.id,
        });
        const events = this.appendEventsToThread(thread, [
          {
            threadId: thread.id,
            runId: current.runId,
            type: "operator.decision.continued",
            category: "system",
            visibility: "user",
            payload,
          },
        ]);
        await this.persistState(events);
        const decision = projectOperatorDecisions([
          ...currentEvents,
          ...events,
        ]).find((candidate) => candidate.id === decisionId);
        if (!decision || decision.status !== "continued") {
          throw new Error("Operator decision continuation receipt is invalid");
        }
        return {
          decision: structuredClone(decision),
          events: structuredClone(events),
        };
      }),
    );
  }

  async cancelOperatorDecision(
    threadId: string,
    decisionId: string,
    reason: OperatorDecisionCancellationReason = "operator_cancelled",
  ): Promise<OperatorDecisionMutation> {
    this.assertInitialized();
    this.validateResourceId(threadId);
    this.validateResourceId(decisionId);
    return this.threadQueue(threadId).run(() =>
      this.stateQueue.run(async () => {
        const thread = this.mutableThread(threadId);
        if (thread.currentRunId) {
          throw new Error(
            "Operator decision cannot be cancelled while the Thread is running",
          );
        }
        const currentEvents = this.requireLedger().listEvents(thread.id);
        const current = projectOperatorDecisions(currentEvents).find(
          (decision) => decision.id === decisionId,
        );
        if (!current) {
          throw new Error(`Operator decision not found: ${decisionId}`);
        }
        if (current.status === "cancelled") {
          return { decision: structuredClone(current), events: [] };
        }
        const payload = createOperatorDecisionCancelledPayload({
          decision: current,
          reason,
        });
        const events = this.appendEventsToThread(thread, [
          {
            threadId: thread.id,
            runId: current.runId,
            type: "operator.decision.cancelled",
            category: "system",
            visibility: "user",
            payload,
          },
        ]);
        const originRun = this.mutableRun(current.runId);
        if (
          thread.status === "waiting" &&
          (originRun.status === "completed" ||
            originRun.status === "interrupted")
        ) {
          thread.status = "idle";
        }
        await this.persistState(events);
        const decision = projectOperatorDecisions([
          ...currentEvents,
          ...events,
        ]).find((candidate) => candidate.id === decisionId);
        if (!decision || decision.status !== "cancelled") {
          throw new Error("Operator decision cancellation receipt is invalid");
        }
        return {
          decision: structuredClone(decision),
          events: structuredClone(events),
        };
      }),
    );
  }

  async queueRunControlMessage(
    input: QueueRunControlMessageInput,
  ): Promise<RunControlMessage> {
    this.assertInitialized();
    this.validateResourceId(input.threadId);
    this.validateResourceId(input.runId);
    return this.threadQueue(input.threadId).run(() =>
      this.stateQueue.run(async () => {
        const thread = this.mutableThread(input.threadId);
        const run = this.mutableRun(input.runId);
        if (run.source === "workflow") {
          throw new Error(
            "Workflow node Runs do not accept live Run control messages",
          );
        }
        if (
          run.threadId !== thread.id ||
          run.status !== "running" ||
          thread.currentRunId !== run.id
        ) {
          throw new Error("Run control message requires the active Thread Run");
        }
        if (
          run.configuration?.model.provider === "napier" &&
          run.configuration.model.id === "demo"
        ) {
          throw new Error(
            "The demo model does not accept live Run control messages",
          );
        }
        const currentEvents = this.requireLedger().listEvents(thread.id);
        const currentMessages = projectRunControlMessages(
          currentEvents,
          run.id,
        );
        if (currentMessages.length >= MAX_TOTAL_RUN_CONTROL_MESSAGES) {
          throw new Error(
            `Run control message total limit reached (${MAX_TOTAL_RUN_CONTROL_MESSAGES})`,
          );
        }
        if (
          currentMessages.filter((message) => message.status === "queued")
            .length >= MAX_PENDING_RUN_CONTROL_MESSAGES
        ) {
          throw new Error(
            `Run control message pending limit reached (${MAX_PENDING_RUN_CONTROL_MESSAGES})`,
          );
        }
        const payload = createRunControlMessageQueuedPayload({
          controlMessageId: createId("control"),
          mode: input.mode,
          text: input.text,
        });
        const [queuedEvent] = this.appendEventsToThread(thread, [
          {
            threadId: thread.id,
            runId: run.id,
            type: "run.control.queued",
            category: "message",
            visibility: "user",
            payload,
          },
        ]);
        if (!queuedEvent) {
          throw new Error("Run control message queue event was not created");
        }
        await this.persistState(queuedEvent);
        const message = projectRunControlMessages(
          [...currentEvents, queuedEvent],
          run.id,
        ).find((candidate) => candidate.id === payload.controlMessageId);
        if (!message) {
          throw new Error("Run control message queue receipt is invalid");
        }
        return structuredClone(message);
      }),
    );
  }

  async deliverNextRunControlMessage(
    threadId: string,
    runId: string,
    mode: RunControlMessageMode,
  ): Promise<RunControlMessageDelivery | undefined> {
    this.assertInitialized();
    this.validateResourceId(threadId);
    this.validateResourceId(runId);
    return this.threadQueue(threadId).run(() =>
      this.stateQueue.run(async () => {
        const thread = this.mutableThread(threadId);
        const run = this.mutableRun(runId);
        if (
          run.source === "workflow" ||
          run.threadId !== thread.id ||
          run.status !== "running" ||
          thread.currentRunId !== run.id
        ) {
          return undefined;
        }
        const currentEvents = this.requireLedger().listEvents(thread.id);
        const pending = nextPendingRunControlMessage(
          currentEvents,
          run.id,
          mode,
        );
        if (!pending) return undefined;
        const messageEventSeq = thread.eventCount + 2;
        const deliveredPayload = createRunControlMessageDeliveredPayload({
          message: pending.message,
          messageEventSeq,
        });
        const deliveryEvents = this.appendEventsToThread(thread, [
          {
            threadId: thread.id,
            runId: run.id,
            type: "run.control.delivered",
            category: "message",
            visibility: "user",
            payload: deliveredPayload,
          },
          {
            threadId: thread.id,
            runId: run.id,
            type: "message.user",
            category: "message",
            visibility: "user",
            payload: createRunControlMessageUserPayload(pending),
          },
        ]);
        await this.persistState(deliveryEvents);
        const message = projectRunControlMessages(
          [...currentEvents, ...deliveryEvents],
          run.id,
        ).find((candidate) => candidate.id === pending.message.id);
        if (!message || message.status !== "delivered") {
          throw new Error("Run control message delivery receipt is invalid");
        }
        return {
          message: structuredClone(message),
          text: pending.text,
          events: structuredClone(deliveryEvents),
        };
      }),
    );
  }

  async cancelRunControlMessage(
    threadId: string,
    runId: string,
    controlMessageId: string,
  ): Promise<RunControlMessage> {
    this.assertInitialized();
    this.validateResourceId(threadId);
    this.validateResourceId(runId);
    this.validateResourceId(controlMessageId);
    return this.threadQueue(threadId).run(() =>
      this.stateQueue.run(async () => {
        const thread = this.mutableThread(threadId);
        const run = this.mutableRun(runId);
        if (run.threadId !== thread.id) {
          throw new Error(`Run not found in thread: ${runId}`);
        }
        const currentEvents = this.requireLedger().listEvents(thread.id);
        const current = projectRunControlMessages(currentEvents, run.id).find(
          (message) => message.id === controlMessageId,
        );
        if (!current) {
          throw new Error(`Run control message not found: ${controlMessageId}`);
        }
        if (current.status === "cancelled") return structuredClone(current);
        if (current.status !== "queued") {
          throw new Error("Delivered Run control message cannot be cancelled");
        }
        const payload = createRunControlMessageCancelledPayload({
          message: current,
          reason: "operator_cancelled",
        });
        const [cancelledEvent] = this.appendEventsToThread(thread, [
          {
            threadId: thread.id,
            runId: run.id,
            type: "run.control.cancelled",
            category: "message",
            visibility: "user",
            payload,
          },
        ]);
        if (!cancelledEvent) {
          throw new Error(
            "Run control message cancellation event was not created",
          );
        }
        await this.persistState(cancelledEvent);
        const cancelled = projectRunControlMessages(
          [...currentEvents, cancelledEvent],
          run.id,
        ).find((message) => message.id === controlMessageId);
        if (!cancelled || cancelled.status !== "cancelled") {
          throw new Error(
            "Run control message cancellation receipt is invalid",
          );
        }
        return structuredClone(cancelled);
      }),
    );
  }

  async finishRun(
    runId: string,
    status: Exclude<RunStatus, "queued" | "running">,
    options: {
      error?: string;
      usage?: RunRecord["usage"];
      leaseToken?: string;
      waitForOperatorDecisionId?: string;
    } = {},
  ): Promise<RunRecord> {
    this.assertInitialized();
    return this.stateQueue.run(async () => {
      const run = this.mutableRun(runId);
      if (run.leaseTokenSha256) {
        assertLeaseToken(run.leaseTokenSha256, options.leaseToken);
      }
      const thread = this.mutableThread(run.threadId);
      const waitingDecision = options.waitForOperatorDecisionId
        ? projectOperatorDecisions(
            this.requireLedger().listEvents(thread.id),
            run.id,
          ).find(
            (decision) =>
              decision.id === options.waitForOperatorDecisionId &&
              decision.status === "pending",
          )
        : undefined;
      if (
        options.waitForOperatorDecisionId &&
        (status !== "completed" || !waitingDecision)
      ) {
        throw new Error(
          "Run cannot wait without its pending operator decision",
        );
      }
      run.status = status;
      run.finishedAt = nowIso();
      if (options.error) run.error = options.error;
      if (options.usage) run.usage = structuredClone(options.usage);
      delete run.lease;
      delete run.leaseTokenSha256;
      thread.updatedAt = run.finishedAt;
      const runOrder = new Map(
        thread.runIds.map((candidateRunId, index) => [candidateRunId, index]),
      );
      const remainingActiveRuns = this.state.runs
        .filter(
          (candidate) =>
            candidate.threadId === thread.id &&
            candidate.id !== run.id &&
            (candidate.status === "queued" || candidate.status === "running"),
        )
        .sort(
          (left, right) =>
            left.startedAt.localeCompare(right.startedAt) ||
            (runOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
              (runOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER),
        );
      if (thread.currentRunId === run.id) {
        const replacement = remainingActiveRuns[0];
        if (replacement) thread.currentRunId = replacement.id;
        else delete thread.currentRunId;
      }
      const cancellationEvents = [
        ...this.cancelPendingRunControlMessages(
          thread,
          run.id,
          runControlMessageCancellationReason(status),
        ),
        ...this.cancelPendingOperatorDecisions(
          thread,
          run.id,
          operatorDecisionCancellationReason(status),
          waitingDecision?.id,
        ),
      ];
      const openDecision = projectOperatorDecisions([
        ...this.requireLedger().listEvents(thread.id),
        ...cancellationEvents,
      ]).find(
        (decision) =>
          decision.status === "pending" || decision.status === "answered",
      );
      thread.status =
        remainingActiveRuns.length > 0
          ? "running"
          : waitingDecision || openDecision
            ? "waiting"
            : status === "completed" || status === "cancelled"
              ? "idle"
              : status === "interrupted"
                ? "waiting"
                : "failed";
      await this.persistState(cancellationEvents);
      return structuredClone(stripRunSecrets(run));
    });
  }

  async setThreadStatus(threadId: string, status: ThreadStatus): Promise<void> {
    this.assertInitialized();
    await this.stateQueue.run(async () => {
      const thread = this.mutableThread(threadId);
      thread.status = status;
      thread.updatedAt = nowIso();
      await this.persistState();
    });
  }

  async setGoal(
    threadId: string,
    goal: GoalState | undefined,
  ): Promise<ThreadRecord> {
    this.assertInitialized();
    return this.stateQueue.run(async () => {
      const thread = this.mutableThread(threadId);
      if (goal) thread.goal = structuredClone(goal);
      else delete thread.goal;
      thread.updatedAt = nowIso();
      await this.persistState();
      return structuredClone(thread);
    });
  }

  async appendEvent(input: AppendEventInput): Promise<RunEvent> {
    this.assertInitialized();
    this.validateResourceId(input.threadId);
    return this.threadQueue(input.threadId).run(() =>
      this.stateQueue.run(async () => {
        const currentThread = this.mutableThread(input.threadId);
        const [event] = this.appendEventsToThread(currentThread, [input]);
        if (!event) throw new Error("Ledger event was not created");
        await this.persistState(event);
        return structuredClone(event);
      }),
    );
  }

  private async reconcileInterruptedRuns(): Promise<void> {
    const reason =
      "The runtime process exited or its renewable owner lease expired before this run reached a terminal state.";
    const timestamp = nowIso();
    const timestampMs = Date.parse(timestamp);
    const interruptedRunIds = new Set<string>();
    const runControlCancellationEvents: RunEvent[] = [];
    const interruptedPlanSteps: Array<{
      threadId: string;
      planId: string;
      stepId: string;
      runId: string;
      blocker: string;
    }> = [];
    let changed = false;
    await this.stateQueue.run(async () => {
      for (const run of this.state.runs) {
        if (run.status !== "queued" && run.status !== "running") continue;
        if (
          run.lease &&
          run.leaseTokenSha256 &&
          Number.isFinite(Date.parse(run.lease.expiresAt)) &&
          Date.parse(run.lease.expiresAt) > timestampMs
        ) {
          continue;
        }
        run.status = "interrupted";
        run.interruptedAt = timestamp;
        run.interruptionReason = reason;
        run.finishedAt = timestamp;
        run.error = reason;
        delete run.lease;
        delete run.leaseTokenSha256;
        interruptedRunIds.add(run.id);
        changed = true;
      }
      for (const delivery of this.state.inboundDeliveries) {
        if (delivery.status !== "running") continue;
        const attemptTriggerId =
          delivery.attemptCount <= 1
            ? delivery.triggerId
            : `${delivery.triggerId}:attempt:${delivery.attemptCount}`;
        const activeRun = this.state.runs.find(
          (run) =>
            (run.id === delivery.runId || run.triggerId === attemptTriggerId) &&
            (run.status === "queued" || run.status === "running"),
        );
        if (activeRun && !interruptedRunIds.has(activeRun.id)) continue;
        delivery.status = "failed";
        delivery.error =
          "Runtime restarted before the inbound delivery settled.";
        delivery.finishedAt = timestamp;
        delete delivery.nextAttemptAt;
        delivery.revision += 1;
        changed = true;
      }
      for (const thread of this.state.threads) {
        if (thread.currentRunId && interruptedRunIds.has(thread.currentRunId)) {
          delete thread.currentRunId;
          thread.status = "waiting";
          thread.updatedAt = timestamp;
          changed = true;
        } else if (
          thread.status === "running" &&
          thread.runIds.some((runId) => interruptedRunIds.has(runId))
        ) {
          thread.status = "waiting";
          thread.updatedAt = timestamp;
          changed = true;
        }
      }
      for (const runId of interruptedRunIds) {
        const run = this.mutableRun(runId);
        const thread = this.mutableThread(run.threadId);
        runControlCancellationEvents.push(
          ...this.cancelPendingRunControlMessages(
            thread,
            run.id,
            "run_interrupted_before_delivery",
          ),
        );
      }
      for (const task of this.state.subagents) {
        if (
          !interruptedRunIds.has(task.runId) ||
          (task.status !== "pending" && task.status !== "running")
        ) {
          continue;
        }
        task.status = "cancelled";
        task.stopReason = "cancelled";
        task.error = "Parent run was interrupted by a runtime restart.";
        task.finishedAt = timestamp;
        task.revision += 1;
        changed = true;
      }
      for (let index = 0; index < this.state.plans.length; index += 1) {
        const current = this.state.plans[index]!;
        let updated = current;
        for (const runId of interruptedRunIds) {
          const affected = updated.steps.filter(
            (step) => step.status === "running" && step.runId === runId,
          );
          if (affected.length === 0) continue;
          updated = interruptPlanRun(updated, runId, reason);
          interruptedPlanSteps.push(
            ...affected.map((step) => ({
              threadId: updated.threadId,
              planId: updated.id,
              stepId: step.id,
              runId,
              blocker: reason,
            })),
          );
        }
        if (updated.revision !== current.revision) {
          this.state.plans[index] = updated;
          changed = true;
        }
      }
      for (const extension of this.state.extensions) {
        if (extension.connection.status !== "connecting") continue;
        extension.connection = {
          status: "disconnected",
          toolCount: extension.tools.length,
          error: "Runtime restarted while the MCP connection was opening.",
        };
        extension.updatedAt = timestamp;
        extension.revision += 1;
        changed = true;
      }
      if (changed) await this.persistState(runControlCancellationEvents);
    });

    const interruptedRuns = this.state.runs.filter(
      (run) => run.status === "interrupted",
    );
    for (const run of interruptedRuns) {
      const events = await this.listEvents(run.threadId);
      if (
        !events.some(
          (event) => event.runId === run.id && event.type === "run.interrupted",
        )
      ) {
        await this.appendEvent({
          threadId: run.threadId,
          runId: run.id,
          type: "run.interrupted",
          category: "lifecycle",
          visibility: "user",
          payload: {
            status: "interrupted",
            reason: run.interruptionReason ?? reason,
            interruptedAt: run.interruptedAt ?? timestamp,
          },
        });
      }
      const tasks = this.state.subagents.filter(
        (task) =>
          task.runId === run.id &&
          task.status === "cancelled" &&
          task.stopReason === "cancelled",
      );
      const currentEvents = await this.listEvents(run.threadId);
      for (const task of tasks) {
        const alreadyRecorded = currentEvents.some(
          (event) =>
            event.type === "subagent.cancelled" &&
            event.payload &&
            !Array.isArray(event.payload) &&
            typeof event.payload === "object" &&
            event.payload["taskId"] === task.id,
        );
        if (alreadyRecorded) continue;
        await this.appendEvent({
          threadId: task.threadId,
          runId: task.runId,
          type: "subagent.cancelled",
          category: "subagent",
          visibility: "user",
          payload: {
            taskId: task.id,
            role: task.role,
            description: task.description,
            status: task.status,
            stopReason: task.stopReason ?? "cancelled",
            error: task.error ?? "",
          },
        });
      }
    }
    for (const step of interruptedPlanSteps) {
      const events = await this.listEvents(step.threadId);
      const alreadyRecorded = events.some(
        (event) =>
          event.type === "plan.step.blocked" &&
          event.payload &&
          !Array.isArray(event.payload) &&
          typeof event.payload === "object" &&
          event.payload["planId"] === step.planId &&
          event.payload["stepId"] === step.stepId &&
          event.payload["runId"] === step.runId,
      );
      if (alreadyRecorded) continue;
      await this.appendEvent({
        threadId: step.threadId,
        runId: step.runId,
        type: "plan.step.blocked",
        category: "plan",
        visibility: "user",
        payload: {
          planId: step.planId,
          stepId: step.stepId,
          runId: step.runId,
          status: "blocked",
          blocker: step.blocker,
          evidence:
            "The step outcome is unknown and must be verified before reopening.",
        },
      });
    }
  }

  private async seedWorkspace(): Promise<void> {
    const timestamp = nowIso();
    const threadId = createId("thread");
    const runId = createId("run");
    const assistantText =
      "This thread is a durable ledger. Every answer, tool call, branch, goal, and artifact is recorded as evidence you can inspect and replay.";
    const agent: AgentProfile = {
      id: "agent_napier",
      name: "Napier",
      description:
        "A glass-box generalist for research, building, and long-running goals.",
      systemPrompt:
        "You are Napier, a rigorous general-purpose agent. Work in observable steps, preserve evidence, and prefer reversible actions.",
      model: { provider: "napier", id: "demo" },
      thinkingLevel: "medium",
      toolPolicy: "observe",
      enabledTools: [
        "list_files",
        "read_file",
        "search_files",
        "list_symbols",
        "inspect_data",
        "sqlite_query",
        "inspect_code",
        "read_symbol",
        "apply_patch",
        "verify_workspace",
      ],
      enabledSkills: [
        "data-analysis",
        "research-brief",
        "software-delivery",
        "artifact-studio",
      ],
      enabledSubagents: ["researcher", "reviewer", "general"],
      subagentLimits: {
        maxConcurrent: 2,
        maxTotal: 4,
        maxTurns: 8,
        timeoutMs: 120_000,
      },
      runLimits: structuredClone(DEFAULT_RUN_LIMITS),
      modelAdvisor: structuredClone(DEFAULT_MODEL_ADVISOR_POLICY),
      revision: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const events: RunEvent[] = [
      {
        id: createId("event"),
        threadId,
        runId,
        seq: 1,
        type: "run.started",
        category: "lifecycle",
        visibility: "debug",
        createdAt: timestamp,
        payload: { source: "onboarding" },
      },
      {
        id: createId("event"),
        threadId,
        runId,
        seq: 2,
        type: "message.assistant",
        category: "message",
        visibility: "user",
        createdAt: nowIso(),
        payload: {
          role: "assistant",
          text: assistantText,
          model: "napier/demo",
        },
      },
      {
        id: createId("event"),
        threadId,
        runId,
        seq: 3,
        type: "system.note",
        category: "system",
        visibility: "debug",
        createdAt: nowIso(),
        payload: {
          text: "Demo mode is active. Configure a provider key to switch this agent to a live model.",
        },
      },
    ];
    const finishedAt = events.at(-1)!.createdAt;
    const thread: ThreadRecord = {
      id: threadId,
      title: "The first ledger",
      agentId: agent.id,
      status: "idle",
      createdAt: timestamp,
      updatedAt: finishedAt,
      lastMessage: assistantText,
      eventCount: events.length,
      runIds: [runId],
    };
    const run: PersistedRunRecord = {
      id: runId,
      threadId,
      agentId: agent.id,
      status: "completed",
      startedAt: timestamp,
      finishedAt,
      usage: emptyUsage(),
      agentRevision: agent.revision,
      limits: normalizeRunLimits(
        agent.runLimits ?? structuredClone(DEFAULT_RUN_LIMITS),
      ),
      configuration: createRunConfigurationFingerprint(agent),
    };
    const state: PersistedState = {
      ...structuredClone(EMPTY_STATE),
      agents: [agent],
      agentRevisions: [
        createAgentProfileRevision(agent, { source: "created" }),
      ],
      threads: [thread],
      runs: [run],
    };
    const snapshot = this.requireLedger().bootstrap(
      JSON.stringify(state),
      events,
    );
    this.restoreSnapshot(snapshot);
    await Promise.allSettled([
      this.writeStateProjection(JSON.stringify(this.state, null, 2)),
      ...this.state.threads.map((item) => this.writeEventProjection(item.id)),
    ]);
  }

  private validateState(
    state: PersistedState,
    sourceBindingEvents?: readonly RunEvent[],
  ): PersistedState {
    if (
      state.version !== 1 ||
      !Array.isArray(state.agents) ||
      !Array.isArray(state.threads) ||
      !Array.isArray(state.runs)
    ) {
      throw new Error(
        `Unsupported or invalid Napier state at ${this.statePath}`,
      );
    }
    const migrateAgentRevisions = !Array.isArray(state.agentRevisions);
    if (migrateAgentRevisions) state.agentRevisions = [];
    if (!Array.isArray(state.memories)) state.memories = [];
    if (!Array.isArray(state.subagents)) state.subagents = [];
    if (!Array.isArray(state.extensions)) state.extensions = [];
    if (!Array.isArray(state.extensionPackageRolloutChannels)) {
      state.extensionPackageRolloutChannels = [];
    }
    if (!Array.isArray(state.extensionPublisherTrustAnchors)) {
      state.extensionPublisherTrustAnchors = [];
    }
    if (!Array.isArray(state.skillPackageInstallations)) {
      state.skillPackageInstallations = [];
    }
    if (!Array.isArray(state.evaluations)) state.evaluations = [];
    if (!Array.isArray(state.evaluationAdjudications)) {
      state.evaluationAdjudications = [];
    }
    if (!Array.isArray(state.evaluationReviewerBallots)) {
      state.evaluationReviewerBallots = [];
    }
    if (!Array.isArray(state.evaluationConsensusResolutions)) {
      state.evaluationConsensusResolutions = [];
    }
    if (!Array.isArray(state.evaluationCasebooks)) {
      state.evaluationCasebooks = [];
    }
    if (!Array.isArray(state.evaluationCasebookQualificationExecutions)) {
      state.evaluationCasebookQualificationExecutions = [];
    }
    if (!Array.isArray(state.receiptTrustAnchors)) {
      state.receiptTrustAnchors = [];
    }
    if (!Array.isArray(state.receiptTrustAnchorDirectorySubscriptions)) {
      state.receiptTrustAnchorDirectorySubscriptions = [];
    }
    if (
      !Array.isArray(
        state.receiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptions,
      )
    ) {
      state.receiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptions =
        [];
    }
    if (
      !Array.isArray(
        state.receiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptions,
      )
    ) {
      state.receiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptions =
        [];
    }
    if (
      !Array.isArray(
        state.receiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselines,
      )
    ) {
      state.receiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselines =
        [];
    }
    if (
      !Array.isArray(state.receiptTrustAnchorDirectoryQuorumPromotionBaselines)
    ) {
      state.receiptTrustAnchorDirectoryQuorumPromotionBaselines = [];
    }
    if (
      !Array.isArray(
        state.receiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaselines,
      )
    ) {
      state.receiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaselines =
        [];
    }
    if (
      !Array.isArray(state.receiptTrustAnchorDirectoryQuorumActivationDecisions)
    ) {
      state.receiptTrustAnchorDirectoryQuorumActivationDecisions = [];
    }
    if (
      !Array.isArray(
        state.receiptTrustAnchorDirectoryQuorumActivationSelections,
      )
    ) {
      state.receiptTrustAnchorDirectoryQuorumActivationSelections =
        state.receiptTrustAnchorDirectoryQuorumActivationSelection === undefined
          ? []
          : [state.receiptTrustAnchorDirectoryQuorumActivationSelection];
    }
    if (!Array.isArray(state.evaluationQualificationBaselines)) {
      state.evaluationQualificationBaselines = [];
    }
    if (!Array.isArray(state.evaluationSuites)) state.evaluationSuites = [];
    if (!Array.isArray(state.evaluationSuiteExecutions)) {
      state.evaluationSuiteExecutions = [];
    }
    if (!Array.isArray(state.automaticRecoveryAssessments)) {
      state.automaticRecoveryAssessments = [];
    }
    if (!Array.isArray(state.automaticRecoveryAttempts)) {
      state.automaticRecoveryAttempts = [];
    }
    if (!Array.isArray(state.plans)) state.plans = [];
    state.plans = state.plans.map((plan) => refreshPlanProjection(plan));
    if (!Array.isArray(state.executionPlanBlueprints)) {
      state.executionPlanBlueprints = [];
    }
    if (!Array.isArray(state.executionPlanBlueprintOutcomeBaselines)) {
      state.executionPlanBlueprintOutcomeBaselines = [];
    }
    if (
      !Array.isArray(state.executionPlanBlueprintRecommendationPolicyOverrides)
    ) {
      state.executionPlanBlueprintRecommendationPolicyOverrides = [];
    }
    if (
      !Array.isArray(
        state.executionPlanBlueprintRecommendationPolicyOverrideRetirements,
      )
    ) {
      state.executionPlanBlueprintRecommendationPolicyOverrideRetirements = [];
    }
    if (!Array.isArray(state.credentials)) state.credentials = [];
    if (!Array.isArray(state.schedules)) state.schedules = [];
    if (!Array.isArray(state.channels)) state.channels = [];
    if (!Array.isArray(state.inboundDeliveries)) {
      state.inboundDeliveries = [];
    }
    if (
      state.extensionPublisherTrustAnchors.length >
      MAX_EXTENSION_PUBLISHER_TRUST_ANCHORS
    ) {
      throw new Error(
        "Persisted Extension publisher trust anchor limit is exceeded",
      );
    }
    const extensionPublisherAnchorIds = new Set<string>();
    const extensionPublisherKeyIds = new Set<string>();
    const extensionPublisherSigningSources = new Set<string>();
    const threadIds = new Set<string>();
    for (const thread of state.threads) {
      if (threadIds.has(thread.id)) {
        throw new Error(`Duplicate persisted Thread: ${thread.id}`);
      }
      threadIds.add(thread.id);
      if (thread.importProvenance !== undefined) {
        thread.importProvenance = validateThreadImportProvenance(
          thread,
          thread.importProvenance,
        );
      }
    }
    for (const input of state.extensionPublisherTrustAnchors) {
      const anchor = validateExtensionPublisherTrustAnchor(input);
      const signingSource = anchor.signingSource?.variable;
      if (
        extensionPublisherAnchorIds.has(anchor.id) ||
        extensionPublisherKeyIds.has(anchor.keyId) ||
        (signingSource !== undefined &&
          extensionPublisherSigningSources.has(signingSource))
      ) {
        throw new Error(
          `Duplicate persisted Extension publisher trust anchor: ${anchor.id}`,
        );
      }
      extensionPublisherAnchorIds.add(anchor.id);
      extensionPublisherKeyIds.add(anchor.keyId);
      if (signingSource) extensionPublisherSigningSources.add(signingSource);
      Object.assign(input, anchor);
    }
    const executionPlanBlueprintIds = new Set<string>();
    const activeExecutionPlanBlueprintHashes = new Set<string>();
    for (const input of state.executionPlanBlueprints) {
      const record = validateExecutionPlanBlueprintRecord(input);
      if (executionPlanBlueprintIds.has(record.id)) {
        throw new Error(
          `Duplicate persisted Execution Plan blueprint: ${record.id}`,
        );
      }
      executionPlanBlueprintIds.add(record.id);
      if (record.status === "active") {
        if (activeExecutionPlanBlueprintHashes.has(record.blueprintSha256)) {
          throw new Error(
            `Duplicate active Execution Plan blueprint hash: ${record.id}`,
          );
        }
        activeExecutionPlanBlueprintHashes.add(record.blueprintSha256);
      }
      Object.assign(input, record);
    }
    const outcomeBaselineIds = new Set<string>();
    const outcomeBaselineKeys = new Set<string>();
    const latestOutcomeBaselineByRecord = new Map<
      string,
      ExecutionPlanBlueprintRecordOutcomeBaseline
    >();
    for (const input of state.executionPlanBlueprintOutcomeBaselines) {
      const baseline = validateExecutionPlanBlueprintOutcomeBaseline(input);
      const previous = latestOutcomeBaselineByRecord.get(baseline.recordId);
      const baselineKey = `${baseline.recordId}:${baseline.replayOutcomesSha256}:${baseline.contentSha256}`;
      if (
        outcomeBaselineIds.has(baseline.id) ||
        outcomeBaselineKeys.has(baselineKey) ||
        !executionPlanBlueprintIds.has(baseline.recordId) ||
        baseline.supersedesBaselineId !== previous?.id
      ) {
        throw new Error(
          `Persisted Execution Plan blueprint outcome baseline is invalid: ${baseline.id}`,
        );
      }
      outcomeBaselineIds.add(baseline.id);
      outcomeBaselineKeys.add(baselineKey);
      latestOutcomeBaselineByRecord.set(baseline.recordId, baseline);
      Object.assign(input, baseline);
    }
    const recommendationPolicyOverrideFamilies = new Set<string>();
    for (const input of state.executionPlanBlueprintRecommendationPolicyOverrides) {
      const override =
        validateExecutionPlanBlueprintRecommendationPolicyOverride(input);
      if (recommendationPolicyOverrideFamilies.has(override.familySha256)) {
        throw new Error(
          `Duplicate persisted Execution Plan blueprint recommendation policy override: ${override.familySha256}`,
        );
      }
      recommendationPolicyOverrideFamilies.add(override.familySha256);
      Object.assign(input, override);
    }
    const recommendationPolicyOverrideRetirementHashes = new Set<string>();
    for (const input of state.executionPlanBlueprintRecommendationPolicyOverrideRetirements) {
      const retirement =
        validateExecutionPlanBlueprintRecommendationPolicyOverrideRetirementResult(
          input,
        );
      if (
        recommendationPolicyOverrideRetirementHashes.has(
          retirement.contentSha256,
        )
      ) {
        throw new Error(
          `Duplicate persisted Execution Plan blueprint recommendation policy override retirement: ${retirement.contentSha256}`,
        );
      }
      recommendationPolicyOverrideRetirementHashes.add(
        retirement.contentSha256,
      );
      Object.assign(input, retirement);
    }
    const skillPackageInstallationIds = new Set<string>();
    let activeSkillPackageInstallationCount = 0;
    for (const input of state.skillPackageInstallations) {
      const installation = validateSkillPackageInstallation(input);
      if (skillPackageInstallationIds.has(installation.id)) {
        throw new Error(
          `Duplicate persisted Skill package installation: ${installation.id}`,
        );
      }
      skillPackageInstallationIds.add(installation.id);
      if (installation.status === "active") {
        activeSkillPackageInstallationCount += 1;
      }
      Object.assign(input, installation);
    }
    if (activeSkillPackageInstallationCount > 1) {
      throw new Error(
        "Multiple active Skill package installations are invalid",
      );
    }
    for (const installation of state.skillPackageInstallations) {
      if (
        installation.replacesInstallationId &&
        !skillPackageInstallationIds.has(installation.replacesInstallationId)
      ) {
        throw new Error(
          `Persisted Skill package replacement target is missing: ${installation.id}`,
        );
      }
      if (
        installation.replacedByInstallationId &&
        !skillPackageInstallationIds.has(installation.replacedByInstallationId)
      ) {
        throw new Error(
          `Persisted Skill package replacement successor is missing: ${installation.id}`,
        );
      }
    }
    for (const extension of state.extensions) {
      if (
        (extension.provenance.source === "signed_package") !==
        Boolean(extension.packageBinding)
      ) {
        throw new Error(
          `Persisted Extension package provenance is invalid: ${extension.id}`,
        );
      }
      if (
        extension.packageHistory !== undefined &&
        !Array.isArray(extension.packageHistory)
      ) {
        throw new Error(
          `Persisted Extension package history is invalid: ${extension.id}`,
        );
      }
      if (extension.packageBinding && extension.packageHistory === undefined) {
        extension.packageHistory = [];
      }
      if (extension.packageBinding || extension.packageHistory !== undefined) {
        extension.packageHistory = validateExtensionPackageHistory(
          extension,
          state.extensionPublisherTrustAnchors,
        );
      }
      const verification = verifyBoundExtensionPackageTrust(
        extension,
        state.extensionPublisherTrustAnchors,
      );
      if (
        verification &&
        verification.status !== "trusted" &&
        verification.status !== "revoked" &&
        verification.status !== "expired"
      ) {
        throw new Error(
          `Persisted signed Extension package is invalid: ${extension.id}: ${verification.reason}`,
        );
      }
    }
    validateExtensionPackageDependencyGraph(
      state.extensions,
      state.extensionPublisherTrustAnchors,
    );
    if (
      state.extensionPackageRolloutChannels.length >
      MAX_EXTENSION_PACKAGE_ROLLOUT_CHANNELS
    ) {
      throw new Error(
        "Persisted Extension package rollout channel limit is exceeded",
      );
    }
    const rolloutChannelIds = new Set<string>();
    const rolloutChannelNames = new Set<string>();
    for (const input of state.extensionPackageRolloutChannels) {
      const channel = validateExtensionPackageRolloutChannel(
        input,
        state.extensionPublisherTrustAnchors,
      );
      if (
        rolloutChannelIds.has(channel.id) ||
        rolloutChannelNames.has(channel.normalizedName)
      ) {
        throw new Error(
          `Duplicate persisted Extension package rollout channel: ${channel.id}`,
        );
      }
      rolloutChannelIds.add(channel.id);
      rolloutChannelNames.add(channel.normalizedName);
      Object.assign(input, channel);
    }
    for (const channel of state.channels) {
      channel.adapter = normalizeInboundChannelAdapter(channel.adapter);
      channel.retryPolicy = channel.retryPolicy
        ? normalizeInboundRetryPolicy(channel.retryPolicy)
        : structuredClone(DEFAULT_INBOUND_RETRY_POLICY);
      channel.signaturePolicy = normalizeInboundSignaturePolicy(
        channel.signaturePolicy,
      );
      channel.policyTemplate = deriveInboundChannelPolicyTemplate(
        channel.retryPolicy,
        channel.signaturePolicy,
      );
    }
    for (const delivery of state.inboundDeliveries) {
      const channelPolicy =
        state.channels.find((channel) => channel.id === delivery.channelId)
          ?.retryPolicy ?? DEFAULT_INBOUND_RETRY_POLICY;
      if (
        !Number.isInteger(delivery.attemptCount) ||
        delivery.attemptCount < 0
      ) {
        delivery.attemptCount =
          delivery.status === "accepted" || delivery.status === "retrying"
            ? 0
            : 1;
      }
      if (
        !Number.isInteger(delivery.maxAttempts) ||
        delivery.maxAttempts < delivery.attemptCount ||
        delivery.maxAttempts > MAX_INBOUND_ATTEMPTS
      ) {
        delivery.maxAttempts = Math.max(
          channelPolicy.maxAttempts,
          delivery.attemptCount,
        );
      }
      if (
        !Number.isInteger(delivery.retryBaseMs) ||
        delivery.retryBaseMs < MIN_INBOUND_RETRY_BASE_MS ||
        delivery.retryBaseMs > MAX_INBOUND_RETRY_BASE_MS
      ) {
        delivery.retryBaseMs = channelPolicy.baseDelayMs;
      }
    }
    for (const memory of state.memories) {
      if (!MEMORY_STATUSES.has(memory.status)) {
        throw new Error(`Invalid persisted memory status: ${memory.status}`);
      }
      memory.reviewIntervalDays = normalizeMemoryReviewInterval(
        memory.reviewIntervalDays ?? DEFAULT_MEMORY_REVIEW_INTERVAL_DAYS,
      );
      if (memory.consolidatesMemoryIds !== undefined) {
        if (!Array.isArray(memory.consolidatesMemoryIds)) {
          throw new Error(
            `Invalid persisted memory consolidation: ${memory.id}`,
          );
        }
        memory.consolidatesMemoryIds = normalizeMemoryConsolidationIds(
          memory.consolidatesMemoryIds,
        );
      }
      memoryReplacementTargetIds(memory);
      if (!Number.isSafeInteger(memory.useCount) || memory.useCount < 0) {
        memory.useCount = 0;
      }
      if (memory.status === "active") {
        memory.reviewedAt ??= memory.updatedAt;
        memory.reviewDueAt ??= memoryReviewDueAt(
          memory.reviewedAt,
          memory.reviewIntervalDays,
        );
      }
      for (const timestamp of [
        memory.reviewedAt,
        memory.reviewDueAt,
        memory.lastUsedAt,
      ]) {
        if (timestamp && !Number.isFinite(Date.parse(timestamp))) {
          throw new Error(`Invalid persisted memory timestamp: ${memory.id}`);
        }
      }
    }
    for (const memory of state.memories) {
      const replacementTargetIds = memoryReplacementTargetIds(memory);
      for (const targetId of replacementTargetIds) {
        const target = state.memories.find(
          (candidate) => candidate.id === targetId,
        );
        if (!target) {
          throw new Error(
            `Persisted memory replacement target is missing: ${memory.id}`,
          );
        }
        if (
          target.scope !== memory.scope ||
          target.agentId !== memory.agentId
        ) {
          throw new Error(
            `Persisted memory replacement scope is invalid: ${memory.id}`,
          );
        }
        if (
          memory.status !== "proposed" &&
          memory.status !== "rejected" &&
          (target.status !== "archived" ||
            target.supersededByMemoryId !== memory.id)
        ) {
          throw new Error(
            `Persisted memory replacement settlement is invalid: ${memory.id}`,
          );
        }
      }
      if (memory.supersededByMemoryId) {
        const replacement = state.memories.find(
          (candidate) => candidate.id === memory.supersededByMemoryId,
        );
        if (
          !replacement ||
          !memoryReplacementTargetIds(replacement).includes(memory.id)
        ) {
          throw new Error(
            `Persisted memory supersession link is invalid: ${memory.id}`,
          );
        }
      }
    }
    for (const agent of state.agents) {
      if (!Number.isInteger(agent.revision) || agent.revision < 1) {
        agent.revision = 1;
      }
      agent.runLimits = normalizeRunLimits(
        agent.runLimits ?? structuredClone(DEFAULT_RUN_LIMITS),
      );
      agent.subagentLimits = normalizeSubagentLimits(
        agent.subagentLimits ?? structuredClone(DEFAULT_SUBAGENT_LIMITS),
      );
    }
    if (migrateAgentRevisions) {
      state.agentRevisions = state.agents.map((agent) =>
        createAgentProfileRevision(agent, { source: "migrated" }),
      );
    }
    const agentRevisionKeys = new Set<string>();
    for (const input of state.agentRevisions) {
      const revision = validateAgentProfileRevision(input);
      const agent = state.agents.find(
        (candidate) => candidate.id === revision.agentId,
      );
      if (!agent || revision.revision > agent.revision) {
        throw new Error(
          `Persisted Agent revision references an invalid Agent: ${revision.agentId}@${revision.revision}`,
        );
      }
      const key = `${revision.agentId}:${revision.revision}`;
      if (agentRevisionKeys.has(key)) {
        throw new Error(`Duplicate persisted Agent revision: ${key}`);
      }
      agentRevisionKeys.add(key);
      Object.assign(input, revision);
    }
    for (const agent of state.agents) {
      const current = state.agentRevisions.find(
        (revision) =>
          revision.agentId === agent.id && revision.revision === agent.revision,
      );
      if (
        !current ||
        JSON.stringify(current.profile) !== JSON.stringify(agent)
      ) {
        throw new Error(
          `Persisted Agent current revision is missing: ${agent.id}@${agent.revision}`,
        );
      }
    }
    for (const run of state.runs) {
      const agent = state.agents.find(
        (candidate) => candidate.id === run.agentId,
      );
      if (run.workflowPlanId !== undefined) {
        this.validateResourceId(run.workflowPlanId);
        const workflowPlan = state.plans.find(
          (candidate) => candidate.id === run.workflowPlanId,
        );
        if (
          run.source !== "workflow" ||
          !workflowPlan ||
          workflowPlan.threadId !== run.threadId
        ) {
          throw new Error(
            `Persisted Workflow Run Plan binding is invalid: ${run.id}`,
          );
        }
      }
      const configuration = run.configuration
        ? validateRunConfigurationFingerprint(run.configuration)
        : undefined;
      if (configuration) run.configuration = configuration;
      if (
        !Number.isInteger(run.agentRevision) ||
        Number(run.agentRevision) < 1
      ) {
        run.agentRevision =
          configuration?.agentRevision ?? agent?.revision ?? 1;
      }
      run.limits = normalizeRunLimits(
        run.limits ??
          configuration?.runLimits ??
          agent?.runLimits ??
          structuredClone(DEFAULT_RUN_LIMITS),
      );
      if (
        configuration &&
        (run.agentRevision !== configuration.agentRevision ||
          JSON.stringify(run.limits) !==
            JSON.stringify(configuration.runLimits))
      ) {
        throw new Error(
          `Run configuration fingerprint conflicts with Run record: ${run.id}`,
        );
      }
    }
    const automaticRecoveryAssessmentIds = new Set<string>();
    for (const input of state.automaticRecoveryAssessments) {
      const assessment = validateAutomaticRecoveryAssessment(input);
      if (automaticRecoveryAssessmentIds.has(assessment.runId)) {
        throw new Error(
          `Duplicate automatic recovery assessment: ${assessment.runId}`,
        );
      }
      const run = state.runs.find(
        (candidate) => candidate.id === assessment.runId,
      );
      const rootRun = state.runs.find(
        (candidate) => candidate.id === assessment.rootRunId,
      );
      if (
        !run ||
        !rootRun ||
        run.threadId !== assessment.threadId ||
        run.agentId !== assessment.agentId ||
        rootRun.threadId !== assessment.threadId ||
        assessment.runConfigurationSha256 !== run.configuration?.contentSha256
      ) {
        throw new Error(
          `Persisted automatic recovery assessment references invalid state: ${assessment.runId}`,
        );
      }
      automaticRecoveryAssessmentIds.add(assessment.runId);
      Object.assign(input, assessment);
    }
    const automaticRecoveryAttemptIds = new Set<string>();
    const automaticRecoveryTriggers = new Set<string>();
    for (const input of state.automaticRecoveryAttempts) {
      const attempt = validateAutomaticRecoveryAttempt(
        stripAutomaticRecoverySecrets(input),
      );
      if (
        automaticRecoveryAttemptIds.has(attempt.id) ||
        automaticRecoveryTriggers.has(attempt.triggerId)
      ) {
        throw new Error(`Duplicate automatic recovery attempt: ${attempt.id}`);
      }
      const assessment = state.automaticRecoveryAssessments.find(
        (candidate) => candidate.contentSha256 === attempt.assessmentSha256,
      );
      const interruptedRun = state.runs.find(
        (candidate) => candidate.id === attempt.interruptedRunId,
      );
      const recoveryRun = attempt.recoveryRunId
        ? state.runs.find((candidate) => candidate.id === attempt.recoveryRunId)
        : undefined;
      if (
        !assessment ||
        assessment.runId !== attempt.interruptedRunId ||
        assessment.rootRunId !== attempt.rootRunId ||
        assessment.priorAttempts + 1 !== attempt.attempt ||
        assessment.policy.maxAttempts !== attempt.maxAttempts ||
        !interruptedRun ||
        interruptedRun.threadId !== attempt.threadId ||
        interruptedRun.agentId !== attempt.agentId ||
        (attempt.recoveryRunId &&
          (!recoveryRun ||
            recoveryRun.threadId !== attempt.threadId ||
            recoveryRun.parentRunId !== attempt.interruptedRunId ||
            recoveryRun.triggerId !== attempt.triggerId))
      ) {
        throw new Error(
          `Persisted automatic recovery attempt references invalid state: ${attempt.id}`,
        );
      }
      if (
        Boolean(attempt.claim) !== Boolean(input.claimTokenSha256) ||
        (input.claimTokenSha256 &&
          !/^[a-f0-9]{64}$/.test(input.claimTokenSha256))
      ) {
        throw new Error(
          `Persisted automatic recovery claim secret is invalid: ${attempt.id}`,
        );
      }
      automaticRecoveryAttemptIds.add(attempt.id);
      automaticRecoveryTriggers.add(attempt.triggerId);
      Object.assign(input, attempt);
    }
    const evaluationIds = new Set<string>();
    for (const evaluation of state.evaluations) {
      if (evaluationIds.has(evaluation.id)) {
        throw new Error(`Duplicate persisted Run evaluation: ${evaluation.id}`);
      }
      evaluationIds.add(evaluation.id);
      validatePersistedRunEvaluation(
        evaluation,
        state.threads,
        state.runs,
        state.subagents,
        sourceBindingEvents,
      );
    }
    const adjudicationIds = new Set<string>();
    const adjudicatedEvaluationIds = new Set<string>();
    for (const adjudication of state.evaluationAdjudications) {
      if (adjudicationIds.has(adjudication.id)) {
        throw new Error(
          `Duplicate persisted evaluation adjudication: ${adjudication.id}`,
        );
      }
      if (adjudicatedEvaluationIds.has(adjudication.evaluationId)) {
        throw new Error(
          `Duplicate persisted adjudicated evaluation: ${adjudication.evaluationId}`,
        );
      }
      const evaluation = state.evaluations.find(
        (candidate) => candidate.id === adjudication.evaluationId,
      );
      if (!evaluation || evaluation.threadId !== adjudication.threadId) {
        throw new Error(
          `Persisted evaluation adjudication reference is invalid: ${adjudication.id}`,
        );
      }
      validateEvaluationAdjudication(adjudication, evaluation);
      adjudicationIds.add(adjudication.id);
      adjudicatedEvaluationIds.add(adjudication.evaluationId);
    }
    const reviewerBallotIds = new Set<string>();
    const reviewerLaneKeys = new Set<string>();
    for (const ballot of state.evaluationReviewerBallots) {
      const evaluation = state.evaluations.find(
        (candidate) => candidate.id === ballot.evaluationId,
      );
      const laneKey = `${ballot.evaluationId}:${ballot.reviewerId}`;
      if (
        reviewerBallotIds.has(ballot.id) ||
        reviewerLaneKeys.has(laneKey) ||
        !evaluation ||
        evaluation.threadId !== ballot.threadId
      ) {
        throw new Error(
          `Persisted evaluation reviewer ballot is invalid: ${ballot.id}`,
        );
      }
      validateEvaluationReviewerBallot(ballot, evaluation);
      reviewerBallotIds.add(ballot.id);
      reviewerLaneKeys.add(laneKey);
    }
    const consensusResolutionIds = new Set<string>();
    const consensusReportHashes = new Set<string>();
    for (const resolution of state.evaluationConsensusResolutions) {
      const evaluation = state.evaluations.find(
        (candidate) => candidate.id === resolution.evaluationId,
      );
      const adjudication = state.evaluationAdjudications.find(
        (candidate) => candidate.id === resolution.adjudicationId,
      );
      const reportKey = `${resolution.evaluationId}:${resolution.report.contentSha256}`;
      if (
        consensusResolutionIds.has(resolution.id) ||
        consensusReportHashes.has(reportKey) ||
        !evaluation ||
        !adjudication ||
        evaluation.threadId !== resolution.threadId
      ) {
        throw new Error(
          `Persisted evaluation consensus resolution is invalid: ${resolution.id}`,
        );
      }
      validateEvaluationConsensusResolution(
        resolution,
        evaluation,
        state.evaluationReviewerBallots.filter(
          (ballot) => ballot.evaluationId === evaluation.id,
        ),
        adjudication,
      );
      consensusResolutionIds.add(resolution.id);
      consensusReportHashes.add(reportKey);
    }
    for (const adjudication of state.evaluationAdjudications) {
      for (const revision of adjudication.revisions) {
        if (
          revision.source === "reviewer_consensus" &&
          !state.evaluationConsensusResolutions.some(
            (resolution) =>
              resolution.adjudicationId === adjudication.id &&
              resolution.adjudicationRevision.revision === revision.revision &&
              resolution.report.contentSha256 === revision.sourceSha256,
          )
        ) {
          throw new Error(
            `Persisted consensus adjudication provenance is missing: ${adjudication.id}@${revision.revision}`,
          );
        }
      }
    }
    const casebookIds = new Set<string>();
    for (const input of state.evaluationCasebooks) {
      const casebook = migrateLegacyEvaluationCasebook(input);
      if (casebookIds.has(casebook.id)) {
        throw new Error(
          `Duplicate persisted Evaluation Casebook: ${casebook.id}`,
        );
      }
      casebookIds.add(casebook.id);
      Object.assign(input, casebook);
    }
    const casebookQualificationExecutionIds = new Set<string>();
    for (const execution of state.evaluationCasebookQualificationExecutions) {
      if (casebookQualificationExecutionIds.has(execution.id)) {
        throw new Error(
          `Duplicate persisted Evaluation Casebook qualification execution: ${execution.id}`,
        );
      }
      const casebook = state.evaluationCasebooks.find(
        (candidate) => candidate.id === execution.casebookId,
      );
      if (
        !casebook ||
        !state.threads.some((thread) => thread.id === execution.auditThreadId)
      ) {
        throw new Error(
          `Persisted Evaluation Casebook qualification reference is invalid: ${execution.id}`,
        );
      }
      validateEvaluationCasebookQualificationExecution(execution, casebook);
      casebookQualificationExecutionIds.add(execution.id);
    }
    if (state.receiptTrustAnchors.length > MAX_RECEIPT_TRUST_ANCHORS) {
      throw new Error("Persisted receipt trust anchor limit is exceeded");
    }
    const trustAnchorIds = new Set<string>();
    const trustAnchorKeyIds = new Set<string>();
    const trustAnchorSigningSources = new Set<string>();
    for (const anchor of state.receiptTrustAnchors) {
      validateReceiptTrustAnchor(anchor);
      const signingSource = anchor.signingSource?.variable;
      if (
        trustAnchorIds.has(anchor.id) ||
        trustAnchorKeyIds.has(anchor.keyId) ||
        (signingSource !== undefined &&
          trustAnchorSigningSources.has(signingSource))
      ) {
        throw new Error(
          `Duplicate persisted receipt trust anchor: ${anchor.id}`,
        );
      }
      trustAnchorIds.add(anchor.id);
      trustAnchorKeyIds.add(anchor.keyId);
      if (signingSource) trustAnchorSigningSources.add(signingSource);
    }
    if (
      state.receiptTrustAnchorDirectorySubscriptions.length >
      MAX_RECEIPT_TRUST_DIRECTORY_SUBSCRIPTIONS
    ) {
      throw new Error(
        "Persisted receipt trust anchor directory subscription limit is exceeded",
      );
    }
    const trustDirectorySubscriptionIds = new Set<string>();
    const trustDirectorySubscriptionSourceHashes = new Set<string>();
    for (const input of state.receiptTrustAnchorDirectorySubscriptions) {
      const subscription =
        validatePersistedReceiptTrustAnchorDirectorySubscription(input);
      if (
        trustDirectorySubscriptionIds.has(subscription.id) ||
        trustDirectorySubscriptionSourceHashes.has(
          subscription.sourceUrlSha256,
        ) ||
        !state.threads.some(
          (thread) => thread.id === subscription.auditThreadId,
        )
      ) {
        throw new Error(
          `Duplicate persisted receipt trust anchor directory subscription: ${subscription.id}`,
        );
      }
      trustDirectorySubscriptionIds.add(subscription.id);
      trustDirectorySubscriptionSourceHashes.add(subscription.sourceUrlSha256);
      Object.assign(input, subscription);
    }
    if (
      state
        .receiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptions
        .length > MAX_RECEIPT_TRUST_CHECKPOINT_SUBSCRIPTIONS
    ) {
      throw new Error(
        "Persisted receipt trust anchor directory quorum activation selection checkpoint subscription limit is exceeded",
      );
    }
    const trustCheckpointSubscriptionIds = new Set<string>();
    const trustCheckpointSubscriptionSourceHashes = new Set<string>();
    for (const input of state.receiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptions) {
      const subscription =
        validatePersistedReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription(
          input,
        );
      if (
        trustCheckpointSubscriptionIds.has(subscription.id) ||
        trustCheckpointSubscriptionSourceHashes.has(
          subscription.sourceUrlSha256,
        ) ||
        !state.threads.some(
          (thread) => thread.id === subscription.auditThreadId,
        )
      ) {
        throw new Error(
          `Duplicate persisted receipt trust anchor directory quorum activation selection checkpoint subscription: ${subscription.id}`,
        );
      }
      trustCheckpointSubscriptionIds.add(subscription.id);
      trustCheckpointSubscriptionSourceHashes.add(subscription.sourceUrlSha256);
      Object.assign(input, subscription);
    }
    if (
      state
        .receiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptions
        .length > MAX_RECEIPT_TRUST_ROTATION_PROPOSAL_SUBSCRIPTIONS
    ) {
      throw new Error(
        "Persisted receipt trust anchor directory quorum activation selection rotation proposal subscription limit is exceeded",
      );
    }
    const trustRotationProposalSubscriptionIds = new Set<string>();
    const trustRotationProposalSubscriptionSourceHashes = new Set<string>();
    for (const input of state.receiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptions) {
      const subscription =
        validatePersistedReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription(
          input,
        );
      if (
        trustRotationProposalSubscriptionIds.has(subscription.id) ||
        trustRotationProposalSubscriptionSourceHashes.has(
          subscription.sourceUrlSha256,
        ) ||
        !state.threads.some(
          (thread) => thread.id === subscription.auditThreadId,
        )
      ) {
        throw new Error(
          `Duplicate persisted receipt trust anchor directory quorum activation selection rotation proposal subscription: ${subscription.id}`,
        );
      }
      trustRotationProposalSubscriptionIds.add(subscription.id);
      trustRotationProposalSubscriptionSourceHashes.add(
        subscription.sourceUrlSha256,
      );
      Object.assign(input, subscription);
    }
    if (
      state
        .receiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselines
        .length > MAX_RECEIPT_TRUST_CHECKPOINT_REGISTRY_QUORUM_BASELINES
    ) {
      throw new Error(
        "Persisted receipt trust checkpoint registry quorum baseline limit is exceeded",
      );
    }
    const checkpointRegistryQuorumBaselineIds = new Set<string>();
    const checkpointRegistryQuorumBaselineKeys = new Set<string>();
    let latestCheckpointRegistryQuorumBaseline:
      | ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaseline
      | undefined;
    for (const input of state.receiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselines) {
      const baseline =
        validateReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaseline(
          input,
          state.receiptTrustAnchors,
        );
      const baselineKey = receiptTrustCheckpointRegistryQuorumBaselineKey(
        baseline.envelope,
      );
      if (
        checkpointRegistryQuorumBaselineIds.has(baseline.id) ||
        checkpointRegistryQuorumBaselineKeys.has(baselineKey) ||
        !state.threads.some(
          (thread) => thread.id === baseline.promotedByThreadId,
        ) ||
        baseline.supersedesBaselineId !==
          latestCheckpointRegistryQuorumBaseline?.id
      ) {
        throw new Error(
          `Persisted receipt trust checkpoint registry quorum baseline is invalid: ${baseline.id}`,
        );
      }
      checkpointRegistryQuorumBaselineIds.add(baseline.id);
      checkpointRegistryQuorumBaselineKeys.add(baselineKey);
      latestCheckpointRegistryQuorumBaseline = baseline;
      Object.assign(input, baseline);
    }
    if (
      state.receiptTrustAnchorDirectoryQuorumPromotionBaselines.length >
      MAX_RECEIPT_TRUST_DIRECTORY_QUORUM_PROMOTION_BASELINES
    ) {
      throw new Error(
        "Persisted receipt trust anchor directory quorum promotion baseline limit is exceeded",
      );
    }
    const trustDirectoryQuorumPromotionBaselineIds = new Set<string>();
    const trustDirectoryQuorumPromotionBaselineKeys = new Set<string>();
    let latestTrustDirectoryQuorumPromotionBaseline:
      | ReceiptTrustAnchorDirectoryQuorumPromotionBaseline
      | undefined;
    for (const input of state.receiptTrustAnchorDirectoryQuorumPromotionBaselines) {
      const baseline =
        validateReceiptTrustAnchorDirectoryQuorumPromotionBaseline(
          input,
          state.receiptTrustAnchors,
        );
      const baselineKey = receiptTrustAnchorDirectoryQuorumPromotionBaselineKey(
        baseline.envelope,
      );
      if (
        trustDirectoryQuorumPromotionBaselineIds.has(baseline.id) ||
        trustDirectoryQuorumPromotionBaselineKeys.has(baselineKey) ||
        !state.threads.some(
          (thread) => thread.id === baseline.promotedByThreadId,
        ) ||
        baseline.supersedesBaselineId !==
          latestTrustDirectoryQuorumPromotionBaseline?.id
      ) {
        throw new Error(
          `Persisted receipt trust anchor directory quorum promotion baseline is invalid: ${baseline.id}`,
        );
      }
      trustDirectoryQuorumPromotionBaselineIds.add(baseline.id);
      trustDirectoryQuorumPromotionBaselineKeys.add(baselineKey);
      latestTrustDirectoryQuorumPromotionBaseline = baseline;
      Object.assign(input, baseline);
    }
    if (
      state
        .receiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaselines
        .length > MAX_RECEIPT_TRUST_CHECKPOINT_REGISTRY_QUORUM_BASELINES
    ) {
      throw new Error(
        "Persisted receipt trust rotation approval policy baseline limit is exceeded",
      );
    }
    const rotationApprovalPolicyBaselineIds = new Set<string>();
    const rotationApprovalPolicyBaselineKeys = new Set<string>();
    const rotationApprovalPolicyBaselinesBySha256 = new Map<
      string,
      ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaseline
    >();
    let latestRotationApprovalPolicyBaseline:
      | ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaseline
      | undefined;
    for (const input of state.receiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaselines) {
      const baseline =
        validateReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaseline(
          input,
          state.receiptTrustAnchors,
        );
      const baselineKey = receiptTrustRotationApprovalPolicyBaselineKey(
        baseline.envelope,
      );
      if (
        rotationApprovalPolicyBaselineIds.has(baseline.id) ||
        rotationApprovalPolicyBaselineKeys.has(baselineKey) ||
        !state.threads.some(
          (thread) => thread.id === baseline.promotedByThreadId,
        ) ||
        baseline.supersedesBaselineId !==
          latestRotationApprovalPolicyBaseline?.id
      ) {
        throw new Error(
          `Persisted receipt trust rotation approval policy baseline is invalid: ${baseline.id}`,
        );
      }
      rotationApprovalPolicyBaselineIds.add(baseline.id);
      rotationApprovalPolicyBaselineKeys.add(baselineKey);
      rotationApprovalPolicyBaselinesBySha256.set(
        baseline.contentSha256,
        baseline,
      );
      latestRotationApprovalPolicyBaseline = baseline;
      Object.assign(input, baseline);
    }
    for (const subscription of state.receiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptions) {
      const pending = subscription.pendingApprovalPolicyApply;
      if (!pending) continue;
      const baseline = rotationApprovalPolicyBaselinesBySha256.get(
        pending.approvalPolicyBaselineSha256,
      );
      if (
        !baseline ||
        baseline.approvalPolicySha256 !== pending.approvalPolicySha256
      ) {
        throw new Error(
          `Persisted receipt trust rotation approval policy apply baseline reference is invalid: ${subscription.id}`,
        );
      }
    }
    if (
      state.receiptTrustAnchorDirectoryQuorumActivationDecisions.length >
      MAX_RECEIPT_TRUST_DIRECTORY_QUORUM_ACTIVATION_DECISIONS
    ) {
      throw new Error(
        "Persisted receipt trust anchor directory quorum activation decision limit is exceeded",
      );
    }
    const trustDirectoryQuorumActivationDecisionIds = new Set<string>();
    const trustDirectoryQuorumActivationDecisionEnvelopeHashes =
      new Set<string>();
    for (const input of state.receiptTrustAnchorDirectoryQuorumActivationDecisions) {
      const record =
        validateReceiptTrustAnchorDirectoryQuorumActivationDecisionRecord(
          input,
        );
      if (
        trustDirectoryQuorumActivationDecisionIds.has(record.id) ||
        trustDirectoryQuorumActivationDecisionEnvelopeHashes.has(
          record.envelope.contentSha256,
        ) ||
        !state.threads.some(
          (thread) => thread.id === record.signedByThreadId,
        ) ||
        !state.receiptTrustAnchorDirectoryQuorumPromotionBaselines.some(
          (baseline) =>
            baseline.contentSha256 === record.baseline.contentSha256,
        )
      ) {
        throw new Error(
          `Persisted receipt trust anchor directory quorum activation decision is invalid: ${record.id}`,
        );
      }
      trustDirectoryQuorumActivationDecisionIds.add(record.id);
      trustDirectoryQuorumActivationDecisionEnvelopeHashes.add(
        record.envelope.contentSha256,
      );
      Object.assign(input, record);
    }
    if (
      state.receiptTrustAnchorDirectoryQuorumActivationSelections.length >
      MAX_RECEIPT_TRUST_DIRECTORY_QUORUM_ACTIVATION_DECISIONS
    ) {
      throw new Error(
        "Persisted receipt trust anchor directory quorum activation selection limit is exceeded",
      );
    }
    const trustDirectoryQuorumActivationSelectionIds = new Set<string>();
    const trustDirectoryQuorumActivationSelectionHashes = new Set<string>();
    let latestTrustDirectoryQuorumActivationSelection:
      | ReceiptTrustAnchorDirectoryQuorumActivationSelection
      | undefined;
    for (const input of state.receiptTrustAnchorDirectoryQuorumActivationSelections) {
      const selection =
        validateReceiptTrustAnchorDirectoryQuorumActivationSelection(input);
      const record =
        state.receiptTrustAnchorDirectoryQuorumActivationDecisions.find(
          (candidate) => candidate.id === selection.activationDecisionRecordId,
        );
      if (
        trustDirectoryQuorumActivationSelectionIds.has(selection.id) ||
        trustDirectoryQuorumActivationSelectionHashes.has(
          selection.contentSha256,
        ) ||
        !record ||
        record.contentSha256 !== selection.activationDecisionRecordSha256 ||
        record.envelope.contentSha256 !==
          selection.activationDecisionEnvelopeSha256 ||
        record.envelope.receipt.contentSha256 !==
          selection.activationDecisionReceiptSha256 ||
        !state.threads.some(
          (thread) => thread.id === selection.activatedByThreadId,
        ) ||
        (latestTrustDirectoryQuorumActivationSelection !== undefined &&
          selection.previousSelectionSha256 !==
            latestTrustDirectoryQuorumActivationSelection.contentSha256)
      ) {
        throw new Error(
          `Persisted receipt trust anchor directory quorum activation selection history is invalid: ${selection.id}`,
        );
      }
      trustDirectoryQuorumActivationSelectionIds.add(selection.id);
      trustDirectoryQuorumActivationSelectionHashes.add(
        selection.contentSha256,
      );
      latestTrustDirectoryQuorumActivationSelection = selection;
      Object.assign(input, selection);
    }
    if (state.receiptTrustAnchorDirectoryQuorumActivationSelection) {
      const selection =
        validateReceiptTrustAnchorDirectoryQuorumActivationSelection(
          state.receiptTrustAnchorDirectoryQuorumActivationSelection,
        );
      const record =
        state.receiptTrustAnchorDirectoryQuorumActivationDecisions.find(
          (candidate) => candidate.id === selection.activationDecisionRecordId,
        );
      if (
        !record ||
        record.contentSha256 !== selection.activationDecisionRecordSha256 ||
        record.envelope.contentSha256 !==
          selection.activationDecisionEnvelopeSha256 ||
        record.envelope.receipt.contentSha256 !==
          selection.activationDecisionReceiptSha256 ||
        !state.threads.some(
          (thread) => thread.id === selection.activatedByThreadId,
        )
      ) {
        throw new Error(
          `Persisted receipt trust anchor directory quorum activation selection is invalid: ${selection.id}`,
        );
      }
      Object.assign(
        state.receiptTrustAnchorDirectoryQuorumActivationSelection,
        selection,
      );
    }
    if (
      latestTrustDirectoryQuorumActivationSelection &&
      state.receiptTrustAnchorDirectoryQuorumActivationSelection
        ?.contentSha256 !==
        latestTrustDirectoryQuorumActivationSelection.contentSha256
    ) {
      throw new Error(
        "Persisted receipt trust anchor directory quorum activation selection history tail is invalid",
      );
    }
    if (
      !latestTrustDirectoryQuorumActivationSelection &&
      state.receiptTrustAnchorDirectoryQuorumActivationSelection
    ) {
      throw new Error(
        "Persisted receipt trust anchor directory quorum activation selection history is missing",
      );
    }
    const qualificationBaselineIds = new Set<string>();
    const qualificationBaselineKeys = new Set<string>();
    const latestBaselineByCasebook = new Map<
      string,
      EvaluationQualificationBaseline
    >();
    const baselineCountByCasebook = new Map<string, number>();
    for (const baseline of state.evaluationQualificationBaselines) {
      validateEvaluationQualificationBaseline(
        baseline,
        state.receiptTrustAnchors,
      );
      const previous = latestBaselineByCasebook.get(baseline.casebookId);
      const baselineKey = `${baseline.casebookId}:${baseline.casebookRevision}:${baseline.envelope.receipt.contentSha256}:${baseline.envelope.signature.keyId}`;
      const count = (baselineCountByCasebook.get(baseline.casebookId) ?? 0) + 1;
      if (
        qualificationBaselineIds.has(baseline.id) ||
        qualificationBaselineKeys.has(baselineKey) ||
        count > MAX_QUALIFICATION_BASELINES_PER_CASEBOOK ||
        !state.evaluationCasebooks.some(
          (casebook) => casebook.id === baseline.casebookId,
        ) ||
        !state.threads.some(
          (thread) => thread.id === baseline.promotedByThreadId,
        ) ||
        !state.evaluationCasebookQualificationExecutions.some(
          (execution) =>
            execution.id === baseline.qualificationExecutionId &&
            execution.casebookId === baseline.casebookId &&
            execution.contentSha256 === baseline.qualificationExecutionSha256,
        ) ||
        baseline.supersedesBaselineId !== previous?.id
      ) {
        throw new Error(
          `Persisted Evaluation qualification baseline is invalid: ${baseline.id}`,
        );
      }
      qualificationBaselineIds.add(baseline.id);
      qualificationBaselineKeys.add(baselineKey);
      latestBaselineByCasebook.set(baseline.casebookId, baseline);
      baselineCountByCasebook.set(baseline.casebookId, count);
    }
    const suiteIds = new Set<string>();
    for (const suite of state.evaluationSuites) {
      normalizePersistedEvaluationSuite(suite);
      if (suiteIds.has(suite.id)) {
        throw new Error(`Duplicate persisted evaluation suite: ${suite.id}`);
      }
      suiteIds.add(suite.id);
      if (!state.threads.some((thread) => thread.id === suite.threadId)) {
        throw new Error(
          `Persisted evaluation suite thread is missing: ${suite.id}`,
        );
      }
      assertEvaluationSuiteRuns(state.runs, suite);
    }
    const executionIds = new Set<string>();
    for (const execution of state.evaluationSuiteExecutions) {
      if (executionIds.has(execution.id)) {
        throw new Error(
          `Duplicate persisted evaluation suite execution: ${execution.id}`,
        );
      }
      executionIds.add(execution.id);
      validateEvaluationSuiteExecution(
        execution,
        state.evaluationSuites,
        state.evaluations,
        state.runs,
      );
    }
    return state;
  }

  private async updateExtension(
    extensionId: string,
    update: (current: ExtensionRecord) => ExtensionRecord,
  ): Promise<ExtensionRecord> {
    this.assertInitialized();
    return this.stateQueue.run(async () => {
      const index = this.state.extensions.findIndex(
        (extension) => extension.id === extensionId,
      );
      const current = this.state.extensions[index];
      if (!current) throw new Error(`Extension not found: ${extensionId}`);
      const updated = update(structuredClone(current));
      this.state.extensions[index] = updated;
      await this.persistState();
      return structuredClone(updated);
    });
  }

  private appendReceiptTrustAnchorDirectoryQuorumPromotionBaseline(
    threadId: string,
    envelope: TrustedReceiptEnvelope<ReceiptTrustAnchorDirectoryQuorumPromotionReceipt>,
  ): ReceiptTrustAnchorDirectoryQuorumPromotionBaseline {
    if (
      this.state.receiptTrustAnchorDirectoryQuorumPromotionBaselines.length >=
      MAX_RECEIPT_TRUST_DIRECTORY_QUORUM_PROMOTION_BASELINES
    ) {
      throw new Error(
        `Receipt trust anchor directory quorum promotion exceeds ${MAX_RECEIPT_TRUST_DIRECTORY_QUORUM_PROMOTION_BASELINES} baselines`,
      );
    }
    const current =
      this.state.receiptTrustAnchorDirectoryQuorumPromotionBaselines.at(-1);
    const baseline = createReceiptTrustAnchorDirectoryQuorumPromotionBaseline(
      envelope,
      threadId,
      current?.id,
    );
    this.state.receiptTrustAnchorDirectoryQuorumPromotionBaselines.push(
      baseline,
    );
    return baseline;
  }

  private appendReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaseline(
    threadId: string,
    envelope: TrustedReceiptEnvelope<ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorum>,
  ): ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaseline {
    if (
      this.state
        .receiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselines
        .length >= MAX_RECEIPT_TRUST_CHECKPOINT_REGISTRY_QUORUM_BASELINES
    ) {
      throw new Error(
        `Receipt trust checkpoint registry quorum exceeds ${MAX_RECEIPT_TRUST_CHECKPOINT_REGISTRY_QUORUM_BASELINES} baselines`,
      );
    }
    const current =
      this.state.receiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselines.at(
        -1,
      );
    const baseline =
      createReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaseline(
        envelope,
        threadId,
        current?.id,
      );
    this.state.receiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselines.push(
      baseline,
    );
    return baseline;
  }

  private appendReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaseline(
    threadId: string,
    envelope: TrustedReceiptEnvelope<ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyReview>,
  ): ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaseline {
    if (
      this.state
        .receiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaselines
        .length >= MAX_RECEIPT_TRUST_CHECKPOINT_REGISTRY_QUORUM_BASELINES
    ) {
      throw new Error(
        `Receipt trust rotation approval policy exceeds ${MAX_RECEIPT_TRUST_CHECKPOINT_REGISTRY_QUORUM_BASELINES} baselines`,
      );
    }
    const current =
      this.state.receiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaselines.at(
        -1,
      );
    const baseline =
      createReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaseline(
        threadId,
        envelope,
        current?.id,
      );
    this.state.receiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaselines.push(
      baseline,
    );
    return baseline;
  }

  private appendReceiptTrustAnchorDirectoryQuorumActivationDecision(
    threadId: string,
    result: SignReceiptTrustAnchorDirectoryQuorumActivationDecisionResult,
  ): ReceiptTrustAnchorDirectoryQuorumActivationDecisionRecord {
    if (
      this.state.receiptTrustAnchorDirectoryQuorumActivationDecisions.length >=
      MAX_RECEIPT_TRUST_DIRECTORY_QUORUM_ACTIVATION_DECISIONS
    ) {
      throw new Error(
        `Receipt trust anchor directory quorum activation exceeds ${MAX_RECEIPT_TRUST_DIRECTORY_QUORUM_ACTIVATION_DECISIONS} decisions`,
      );
    }
    const record =
      createReceiptTrustAnchorDirectoryQuorumActivationDecisionRecord({
        signedByThreadId: threadId,
        baseline: result.baseline,
        verification: result.verification,
        policyReview: result.policyReview,
        sourceAlignment: result.sourceAlignment,
        envelope: result.envelope,
      });
    this.state.receiptTrustAnchorDirectoryQuorumActivationDecisions.push(
      record,
    );
    return record;
  }

  private appendEventsToThread(
    thread: ThreadRecord,
    inputs: AppendEventInput[],
  ): RunEvent[] {
    const events = inputs.map((input) => {
      if (input.threadId !== thread.id) {
        throw new Error(
          "Ledger event Thread does not match mutable projection",
        );
      }
      const event: RunEvent = {
        id: createId("event"),
        threadId: input.threadId,
        runId: input.runId,
        seq: thread.eventCount + 1,
        type: input.type,
        category: input.category,
        visibility: input.visibility ?? "debug",
        createdAt: nowIso(),
        payload: input.payload,
      };
      assertArtifactReceiptEventBoundary(event, `Ledger event ${input.type}`);
      thread.eventCount = event.seq;
      thread.updatedAt = event.createdAt;
      const message = extractMessagePreview(event);
      if (message) thread.lastMessage = message;
      return event;
    });
    return events;
  }

  private cancelPendingRunControlMessages(
    thread: ThreadRecord,
    runId: string,
    reason: RunControlMessageCancellationReason,
  ): RunEvent[] {
    const currentEvents = this.requireLedger().listEvents(thread.id);
    const pending = projectRunControlMessages(currentEvents, runId).filter(
      (message) => message.status === "queued",
    );
    return this.appendEventsToThread(
      thread,
      pending.map((message) => ({
        threadId: thread.id,
        runId,
        type: "run.control.cancelled",
        category: "message",
        visibility: "user",
        payload: createRunControlMessageCancelledPayload({
          message,
          reason,
        }),
      })),
    );
  }

  private cancelPendingOperatorDecisions(
    thread: ThreadRecord,
    runId: string,
    reason: OperatorDecisionCancellationReason,
    preservedDecisionId?: string,
  ): RunEvent[] {
    const currentEvents = this.requireLedger().listEvents(thread.id);
    const pending = projectOperatorDecisions(currentEvents, runId).filter(
      (decision) =>
        decision.status === "pending" && decision.id !== preservedDecisionId,
    );
    return this.appendEventsToThread(
      thread,
      pending.map((decision) => ({
        threadId: thread.id,
        runId,
        type: "operator.decision.cancelled",
        category: "system",
        visibility: "user",
        payload: createOperatorDecisionCancelledPayload({
          decision,
          reason,
        }),
      })),
    );
  }

  private createRunRecord(
    input: CreateRunInput,
    lease?: {
      tokenSha256: string;
      summary: NonNullable<RunRecord["lease"]>;
    },
  ): PersistedRunRecord {
    const thread = this.mutableThread(input.threadId);
    const workflowExecution = input[WORKFLOW_NODE_EXECUTION];
    if (input.source === "workflow") {
      const plan = workflowExecution
        ? this.state.plans.find(
            (candidate) => candidate.id === workflowExecution.planId,
          )
        : undefined;
      if (!plan || plan.threadId !== thread.id || plan.status !== "active") {
        throw new Error(
          "Workflow Run requires its active same-Thread Plan capability",
        );
      }
    } else if (workflowExecution) {
      throw new Error(
        "Workflow Plan capability requires a Workflow Run source",
      );
    }
    const activeRuns = this.state.runs.filter(
      (run) =>
        run.threadId === thread.id &&
        (run.status === "queued" || run.status === "running"),
    );
    const concurrentWorkflowRun =
      input.source === "workflow" &&
      activeRuns.length > 0 &&
      activeRuns.every(
        (run) =>
          run.source === "workflow" &&
          run.workflowPlanId === workflowExecution?.planId,
      );
    if (activeRuns.length > 0 && !concurrentWorkflowRun) {
      throw new Error(`Thread already has an active run: ${activeRuns[0]!.id}`);
    }
    if (
      concurrentWorkflowRun &&
      activeRuns.length >= MAX_CONCURRENT_WORKFLOW_RUNS_PER_THREAD
    ) {
      throw new Error(
        `Thread reached its concurrent Workflow Run limit (${MAX_CONCURRENT_WORKFLOW_RUNS_PER_THREAD})`,
      );
    }
    const openOperatorDecision = projectOperatorDecisions(
      this.requireLedger().listEvents(thread.id),
    ).find(
      (decision) =>
        decision.status === "pending" || decision.status === "answered",
    );
    if (
      openOperatorDecision &&
      (openOperatorDecision.status !== "answered" ||
        input.operatorDecisionId !== openOperatorDecision.id ||
        input.parentRunId !== openOperatorDecision.runId)
    ) {
      throw new Error(
        `Thread is waiting for operator decision: ${openOperatorDecision.id}`,
      );
    }
    if (!openOperatorDecision && input.operatorDecisionId) {
      throw new Error(
        `Operator decision not found for continuation: ${input.operatorDecisionId}`,
      );
    }
    if (thread.agentId !== input.agentId) {
      throw new Error("Run agent must match the thread agent");
    }
    const agent = this.state.agents.find(
      (candidate) => candidate.id === input.agentId,
    );
    if (!agent) throw new Error(`Agent not found: ${input.agentId}`);
    const runAgent =
      input.agentRevision === undefined
        ? agent
        : this.state.agentRevisions.find(
            (revision) =>
              revision.agentId === input.agentId &&
              revision.revision === input.agentRevision,
          )?.profile;
    if (!runAgent) {
      throw new Error(
        `Agent revision not found: ${input.agentId}@${String(input.agentRevision)}`,
      );
    }
    const executionMode = input.executionMode ?? "standard";
    if (openOperatorDecision) {
      const originRun = this.state.runs.find(
        (candidate) => candidate.id === openOperatorDecision.runId,
      );
      if (
        !originRun ||
        originRun.threadId !== thread.id ||
        originRun.agentId !== input.agentId ||
        !originRun.configuration
      ) {
        throw new Error(
          "Operator decision origin Run configuration is unavailable",
        );
      }
      if (runAgent.revision !== originRun.agentRevision) {
        throw new Error(
          "Operator decision continuation must reuse the origin Agent revision",
        );
      }
      const continuationModel = input.model ?? runAgent.model;
      if (
        continuationModel.provider !== originRun.configuration.model.provider ||
        continuationModel.id !== originRun.configuration.model.id
      ) {
        throw new Error(
          "Operator decision continuation must reuse the origin model",
        );
      }
    }
    const messageExperiment = input[AGENT_MESSAGE_EXPERIMENT_EXECUTION];
    const modelInvocationExperiment =
      input[MODEL_INVOCATION_EXPERIMENT_EXECUTION];
    if (
      input.source === "model_experiment" ||
      executionMode === "model_experiment_single_call" ||
      modelInvocationExperiment
    ) {
      validateModelInvocationExperimentRunGate({
        source: input.source,
        executionMode,
        targetThreadId: input.threadId,
        targetAgentId: input.agentId,
        targetAgentRevision: runAgent.revision,
        targetModel: input.model ?? runAgent.model,
        execution: modelInvocationExperiment,
        runs: this.state.runs,
        sourceEvents: modelInvocationExperiment
          ? this.requireLedger().listEvents(
              modelInvocationExperiment.sourceThreadId,
            )
          : [],
      });
    }
    if (executionMode === "agent_experiment_read_only") {
      const branchRun = input.parentRunId
        ? this.state.runs.find(
            (candidate) => candidate.id === input.parentRunId,
          )
        : undefined;
      const sourceRun = messageExperiment
        ? this.state.runs.find(
            (candidate) => candidate.id === messageExperiment.sourceRunId,
          )
        : undefined;
      const sourceEvents = messageExperiment
        ? this.requireLedger().listEvents(messageExperiment.sourceThreadId)
        : [];
      const sourceMessage = sourceEvents.find(
        (event) =>
          event.seq === messageExperiment?.sourceMessageSeq &&
          event.runId === messageExperiment.sourceRunId &&
          event.type === "message.user",
      );
      const sourcePromptVariables = sourceEvents.filter(
        (event) =>
          event.runId === messageExperiment?.sourceRunId &&
          event.type === "context.prompt_variables",
      );
      const sourceConfiguration =
        sourceRun?.configuration &&
        "promptVariableSnapshotSha256" in sourceRun.configuration
          ? sourceRun.configuration
          : undefined;
      const sourcePromptVariablePayload =
        sourcePromptVariables.length === 1 &&
        isRecord(sourcePromptVariables[0]?.payload)
          ? sourcePromptVariables[0].payload
          : undefined;
      const sourcePromptVariableSnapshotSha256 =
        sourceConfiguration?.promptVariableSnapshotSha256;
      const sourceMessageText =
        sourceMessage && isRecord(sourceMessage.payload)
          ? sourceMessage.payload["text"]
          : undefined;
      const branchEvents =
        branchRun &&
        this.requireLedger()
          .listEvents(input.threadId)
          .filter(
            (event) =>
              event.runId === branchRun.id &&
              event.type === "branch.created" &&
              event.category === "lifecycle" &&
              event.visibility === "user" &&
              isRecord(event.payload) &&
              Object.keys(event.payload).length === 2 &&
              event.payload["sourceThreadId"] ===
                messageExperiment?.sourceThreadId &&
              event.payload["sourceSeq"] === branchRun.branchFromSeq,
          );
      if (
        input.source !== "user" ||
        !messageExperiment ||
        !branchRun ||
        branchRun.threadId !== input.threadId ||
        branchRun.agentId !== input.agentId ||
        branchRun.status !== "completed" ||
        branchRun.parentRunId !== messageExperiment.sourceRunId ||
        branchRun.branchFromSeq !== messageExperiment.sourceMessageSeq - 1 ||
        branchEvents?.length !== 1 ||
        !sourceRun ||
        sourceRun.threadId !== messageExperiment.sourceThreadId ||
        sourceRun.agentId !== input.agentId ||
        sourceRun.status === "running" ||
        sourceRun.status === "queued" ||
        !sourceConfiguration ||
        sourceConfiguration.contentSha256 !==
          messageExperiment.sourceRunConfigurationSha256 ||
        input.skillCatalogSha256 !== sourceConfiguration.skillCatalogSha256 ||
        input.promptVariables?.catalogSha256 !==
          sourceConfiguration.promptVariableCatalogSha256 ||
        input.promptVariables?.snapshotSha256 !==
          sourceConfiguration.promptVariableSnapshotSha256 ||
        input.promptVariables?.renderedSystemPromptSha256 !==
          sourceConfiguration.resolvedSystemPromptSha256 ||
        sourcePromptVariablePayload?.["resolvedAt"] !==
          messageExperiment.sourcePromptVariableResolvedAt ||
        sourcePromptVariablePayload?.["contentSha256"] !==
          sourcePromptVariableSnapshotSha256 ||
        !Number.isFinite(
          Date.parse(messageExperiment.sourcePromptVariableResolvedAt),
        ) ||
        sourceRun.agentRevision !== runAgent.revision ||
        typeof sourceMessageText !== "string" ||
        sha256(sourceMessageText) !== messageExperiment.sourcePromptSha256 ||
        !/^[a-f0-9]{64}$/u.test(messageExperiment.previewSha256) ||
        !/^[a-f0-9]{64}$/u.test(
          messageExperiment.candidateWorkspaceSnapshotSha256,
        )
      ) {
        throw new Error(
          "Read-only Agent experiment requires its verified message Branch capability",
        );
      }
    } else if (messageExperiment) {
      throw new Error(
        "Agent experiment capability requires read-only experiment execution",
      );
    } else if (executionMode === "safe_read_only_recovery") {
      const parent = input.parentRunId
        ? this.state.runs.find(
            (candidate) => candidate.id === input.parentRunId,
          )
        : undefined;
      if (
        input.source !== "recovery" ||
        !parent ||
        parent.threadId !== input.threadId ||
        parent.agentId !== input.agentId ||
        parent.status !== "interrupted"
      ) {
        throw new Error(
          "Safe read-only recovery requires an interrupted parent Run",
        );
      }
    } else if (executionMode === "workflow_map_read_only") {
      const parent = input.parentRunId
        ? this.state.runs.find(
            (candidate) => candidate.id === input.parentRunId,
          )
        : undefined;
      const parentStartedAsMap =
        parent !== undefined &&
        this.requireLedger()
          .listEvents(input.threadId)
          .some(
            (event) =>
              event.runId === parent.id &&
              event.type === "workflow.node.started" &&
              isRecord(event.payload) &&
              event.payload["planId"] === workflowExecution?.planId &&
              event.payload["nodeType"] === "map",
          );
      if (
        input.source !== "workflow" ||
        !workflowExecution ||
        !parent ||
        parent.threadId !== input.threadId ||
        parent.agentId !== input.agentId ||
        parent.source !== "workflow" ||
        parent.status !== "running" ||
        parent.workflowPlanId !== workflowExecution.planId ||
        parent.parentRunId !== undefined ||
        !parent.configuration ||
        parent.configuration.schemaVersion === 1 ||
        parent.configuration.executionMode !== "standard" ||
        !parentStartedAsMap
      ) {
        throw new Error(
          "Workflow Map read-only execution requires its active coordinator Run",
        );
      }
    }
    if (input.triggerId) {
      const triggerId = normalizeTriggerId(input.triggerId);
      if (
        this.state.runs.some((candidate) => candidate.triggerId === triggerId)
      ) {
        throw new Error(`Run trigger already exists: ${triggerId}`);
      }
      input = { ...input, triggerId };
    }
    const run: PersistedRunRecord = {
      id: createId("run"),
      threadId: input.threadId,
      agentId: input.agentId,
      status: "running",
      ...(input.source ? { source: input.source } : {}),
      ...(workflowExecution
        ? { workflowPlanId: workflowExecution.planId }
        : {}),
      ...(input.triggerId ? { triggerId: input.triggerId } : {}),
      startedAt: nowIso(),
      usage: emptyUsage(),
      agentRevision: runAgent.revision,
      limits: normalizeRunLimits(
        runAgent.runLimits ?? structuredClone(DEFAULT_RUN_LIMITS),
      ),
      configuration: createRunConfigurationFingerprint(
        runAgent,
        input.model ?? runAgent.model,
        executionMode,
        {
          ...(input.skillCatalogSha256
            ? { skillCatalogSha256: input.skillCatalogSha256 }
            : {}),
          ...(input.promptVariables
            ? { promptVariables: input.promptVariables }
            : {}),
        },
      ),
      ...(input.parentRunId ? { parentRunId: input.parentRunId } : {}),
      ...(input.branchFromSeq !== undefined
        ? { branchFromSeq: input.branchFromSeq }
        : {}),
      ...(lease
        ? {
            lease: lease.summary,
            leaseTokenSha256: lease.tokenSha256,
          }
        : {}),
    };
    this.state.runs.push(run);
    thread.runIds.push(run.id);
    thread.currentRunId ??= run.id;
    thread.status = "running";
    thread.updatedAt = run.startedAt;
    return run;
  }

  private mutableThread(threadId: string): ThreadRecord {
    const thread = this.state.threads.find((item) => item.id === threadId);
    if (!thread) throw new Error(`Thread not found: ${threadId}`);
    return thread;
  }

  private mutableRun(runId: string): PersistedRunRecord {
    const run = this.state.runs.find((item) => item.id === runId);
    if (!run) throw new Error(`Run not found: ${runId}`);
    return run;
  }

  private mutableSchedule(scheduleId: string): PersistedAutomationSchedule {
    const schedule = this.state.schedules.find(
      (item) => item.id === scheduleId,
    );
    if (!schedule) throw new Error(`Schedule not found: ${scheduleId}`);
    return schedule;
  }

  private mutableInboundChannel(channelId: string): PersistedInboundChannel {
    const channel = this.state.channels.find((item) => item.id === channelId);
    if (!channel) throw new Error(`Inbound channel not found: ${channelId}`);
    return channel;
  }

  private mutableInboundDelivery(deliveryId: string): PersistedInboundDelivery {
    const delivery = this.state.inboundDeliveries.find(
      (item) => item.id === deliveryId,
    );
    if (!delivery) {
      throw new Error(`Inbound delivery not found: ${deliveryId}`);
    }
    return delivery;
  }

  private mutableSubagentTask(taskId: string): SubagentTask {
    const task = this.state.subagents.find((item) => item.id === taskId);
    if (!task) throw new Error(`Subagent task not found: ${taskId}`);
    return task;
  }

  private threadQueue(threadId: string): SerialQueue {
    const existing = this.threadQueues.get(threadId);
    if (existing) return existing;
    const queue = new SerialQueue();
    this.threadQueues.set(threadId, queue);
    return queue;
  }

  private eventPath(threadId: string): string {
    this.validateResourceId(threadId);
    return path.join(this.eventsRoot, `${threadId}.jsonl`);
  }

  private validateResourceId(id: string): void {
    if (!/^[a-z][a-z0-9_]{2,80}$/.test(id)) {
      throw new Error(`Invalid resource ID: ${id}`);
    }
  }

  private async persistState(
    eventOrEvents?: RunEvent | RunEvent[],
  ): Promise<void> {
    const startedAt = monotonicNow();
    const serializationStartedAt = monotonicNow();
    const compactState = JSON.stringify(this.state);
    const serializationDurationMs = monotonicNow() - serializationStartedAt;
    const stateBytes = Buffer.byteLength(compactState, "utf8");
    const events = Array.isArray(eventOrEvents)
      ? eventOrEvents
      : eventOrEvents
        ? [eventOrEvents]
        : [];
    const eventBytes = events.reduce(
      (total, event) =>
        total + Buffer.byteLength(JSON.stringify(event), "utf8"),
      0,
    );
    const touchedThreadIds = [
      ...new Set(events.map((event) => event.threadId)),
    ];
    const ledgerCommitStartedAt = monotonicNow();
    try {
      this.stateRevision = this.requireLedger().commit(
        this.stateRevision,
        compactState,
        events,
      );
    } catch (error) {
      this.persistenceMonitor.record({
        status: "failed",
        revision: this.stateRevision,
        stateBytes,
        eventCount: events.length,
        eventBytes,
        touchedThreadCount: touchedThreadIds.length,
        stateProjectionBytes: 0,
        eventProjectionBytes: 0,
        serializationDurationMs,
        ledgerCommitDurationMs: monotonicNow() - ledgerCommitStartedAt,
        projectionDurationMs: 0,
        totalDurationMs: monotonicNow() - startedAt,
        projectionFailureCount: 0,
      });
      this.refreshStateFromLedger(true);
      throw error;
    }
    const ledgerCommitDurationMs = monotonicNow() - ledgerCommitStartedAt;
    const projectionStartedAt = monotonicNow();
    const projections: Array<Promise<number>> = [
      this.writeStateProjection(JSON.stringify(this.state, null, 2)),
    ];
    for (const threadId of touchedThreadIds) {
      projections.push(this.writeEventProjection(threadId));
    }
    const projectionResults = await Promise.allSettled(projections);
    const projectionDurationMs = monotonicNow() - projectionStartedAt;
    const projectionFailureCount = projectionResults.filter(
      (result) => result.status === "rejected",
    ).length;
    const stateProjectionBytes =
      projectionResults[0]?.status === "fulfilled"
        ? projectionResults[0].value
        : 0;
    const eventProjectionBytes = projectionResults
      .slice(1)
      .reduce(
        (total, result) =>
          total + (result.status === "fulfilled" ? result.value : 0),
        0,
      );
    this.persistenceMonitor.record({
      status: "committed",
      revision: this.stateRevision,
      stateBytes,
      eventCount: events.length,
      eventBytes,
      touchedThreadCount: touchedThreadIds.length,
      stateProjectionBytes,
      eventProjectionBytes,
      serializationDurationMs,
      ledgerCommitDurationMs,
      projectionDurationMs,
      totalDurationMs: monotonicNow() - startedAt,
      projectionFailureCount,
    });
  }

  private assertInitialized(): void {
    if (!this.initialized && this.state.agents.length === 0) {
      throw new Error("LocalStore.initialize() must be called first");
    }
    if (this.initialized) this.refreshStateFromLedger();
  }

  private refreshStateFromLedger(force = false): void {
    const snapshot = this.ledger?.readSnapshot();
    if (!snapshot || (!force && snapshot.revision === this.stateRevision)) {
      return;
    }
    this.restoreSnapshot(snapshot);
  }

  private restoreSnapshot(snapshot: {
    revision: number;
    stateJson: string;
  }): boolean {
    const parsed = JSON.parse(snapshot.stateJson) as PersistedState;
    const migrateEvaluationCasebooks =
      Array.isArray(parsed.evaluationCasebooks) &&
      parsed.evaluationCasebooks.some(
        (casebook) =>
          !Array.isArray((casebook as unknown as { cases?: unknown }).cases),
      );
    const migrateExtensionPackageHistory =
      Array.isArray(parsed.extensions) &&
      parsed.extensions.some(
        (extension) =>
          Boolean(extension.packageBinding) &&
          !Array.isArray(extension.packageHistory),
      );
    const requiresStateMigration =
      !Array.isArray(parsed.agentRevisions) ||
      !Array.isArray(parsed.evaluationAdjudications) ||
      !Array.isArray(parsed.evaluationReviewerBallots) ||
      !Array.isArray(parsed.evaluationConsensusResolutions) ||
      !Array.isArray(parsed.evaluationCasebooks) ||
      !Array.isArray(parsed.evaluationCasebookQualificationExecutions) ||
      !Array.isArray(parsed.receiptTrustAnchors) ||
      !Array.isArray(parsed.receiptTrustAnchorDirectorySubscriptions) ||
      !Array.isArray(
        parsed.receiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptions,
      ) ||
      !Array.isArray(
        parsed.receiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptions,
      ) ||
      !Array.isArray(
        parsed.receiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselines,
      ) ||
      !Array.isArray(
        parsed.receiptTrustAnchorDirectoryQuorumPromotionBaselines,
      ) ||
      !Array.isArray(
        parsed.receiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaselines,
      ) ||
      !Array.isArray(
        parsed.receiptTrustAnchorDirectoryQuorumActivationDecisions,
      ) ||
      !Array.isArray(
        parsed.receiptTrustAnchorDirectoryQuorumActivationSelections,
      ) ||
      !Array.isArray(parsed.extensionPublisherTrustAnchors) ||
      !Array.isArray(parsed.evaluationQualificationBaselines) ||
      !Array.isArray(parsed.executionPlanBlueprintOutcomeBaselines) ||
      !Array.isArray(parsed.automaticRecoveryAssessments) ||
      !Array.isArray(parsed.automaticRecoveryAttempts) ||
      migrateEvaluationCasebooks ||
      migrateExtensionPackageHistory;
    this.state = this.validateState(
      parsed,
      this.listPersistedEvaluationEvents(parsed),
    );
    this.stateRevision = snapshot.revision;
    return requiresStateMigration;
  }

  private requireLedger(): SqliteLedger {
    if (!this.ledger) throw new Error("SQLite ledger is not initialized");
    return this.ledger;
  }

  private listPersistedEvaluationEvents(state: PersistedState): RunEvent[] {
    if (!Array.isArray(state.evaluations)) return [];
    const threadIds = new Set(
      state.evaluations
        .map((evaluation) => evaluation.threadId)
        .filter((threadId): threadId is string => typeof threadId === "string"),
    );
    return [...threadIds].flatMap((threadId) =>
      this.requireLedger().listEvents(threadId),
    );
  }

  private async readLegacyEvents(): Promise<RunEvent[]> {
    const events: RunEvent[] = [];
    const threads = new Map(
      this.state.threads.map((thread) => [thread.id, thread]),
    );
    const files = (await readdir(this.eventsRoot))
      .filter((file) => file.endsWith(".jsonl"))
      .sort();
    for (const file of files) {
      const threadId = file.slice(0, -".jsonl".length);
      const thread = threads.get(threadId);
      if (!thread) {
        throw new Error(`Legacy ledger has an orphan event file: ${file}`);
      }
      const contents = await readFile(path.join(this.eventsRoot, file), "utf8");
      const threadEvents = contents
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as RunEvent);
      for (const [index, event] of threadEvents.entries()) {
        const expectedSeq = index + 1;
        if (event.threadId !== threadId || event.seq !== expectedSeq) {
          throw new Error(
            `Legacy ledger sequence is invalid for ${threadId} at ${expectedSeq}`,
          );
        }
      }
      if (threadEvents.length < thread.eventCount) {
        throw new Error(
          `Legacy ledger is missing evidence for ${threadId}: expected ${thread.eventCount}, found ${threadEvents.length}`,
        );
      }
      if (threadEvents.length > thread.eventCount) {
        thread.eventCount = threadEvents.length;
        const lastEvent = threadEvents.at(-1);
        if (lastEvent) {
          thread.updatedAt = lastEvent.createdAt;
          for (let index = threadEvents.length - 1; index >= 0; index -= 1) {
            const message = extractMessagePreview(threadEvents[index]!);
            if (message) {
              thread.lastMessage = message;
              break;
            }
          }
        }
      }
      events.push(...threadEvents);
      threads.delete(threadId);
    }
    for (const thread of threads.values()) {
      if (thread.eventCount > 0) {
        throw new Error(`Legacy ledger event file is missing for ${thread.id}`);
      }
    }
    return events;
  }

  private validateLedgerConsistency(): void {
    const stats = new Map(
      this.requireLedger()
        .listEventStats()
        .map((item) => [item.threadId, item]),
    );
    for (const thread of this.state.threads) {
      const threadEvents = this.requireLedger().listEvents(thread.id);
      const eventStats = stats.get(thread.id);
      const count = eventStats?.count ?? 0;
      const maxSeq = eventStats?.maxSeq ?? 0;
      if (count !== thread.eventCount || maxSeq !== thread.eventCount) {
        throw new Error(
          `SQLite ledger projection mismatch for ${thread.id}: state=${thread.eventCount}, events=${count}, maxSeq=${maxSeq}`,
        );
      }
      if (thread.importProvenance) {
        validateThreadImportProvenanceLedgerReceipt(thread, threadEvents);
      }
      for (const [index, event] of threadEvents.entries()) {
        assertArtifactReceiptEventBoundary(
          event,
          `Persisted Thread ${thread.id} events[${index}]`,
        );
      }
      assertRunEvaluationCompletedEventBindings({
        evaluations: this.state.evaluations.filter(
          (evaluation) => evaluation.threadId === thread.id,
        ),
        events: threadEvents,
        label: `Persisted Thread ${thread.id}`,
      });
      assertPlanArtifactEventBindings({
        plans: this.state.plans.filter((plan) => plan.threadId === thread.id),
        events: threadEvents,
        label: `Persisted Thread ${thread.id}`,
      });
      stats.delete(thread.id);
    }
    if (stats.size > 0) {
      throw new Error(
        `SQLite ledger contains events for unknown thread ${stats.keys().next().value}`,
      );
    }
  }

  private async writeStateProjection(stateJson: string): Promise<number> {
    const temporaryPath = this.projectionTemporaryPath(this.statePath);
    const contents = `${stateJson}\n`;
    await writeFile(temporaryPath, contents, "utf8");
    await rename(temporaryPath, this.statePath);
    return Buffer.byteLength(contents, "utf8");
  }

  private async writeEventProjection(threadId: string): Promise<number> {
    const eventPath = this.eventPath(threadId);
    const temporaryPath = this.projectionTemporaryPath(eventPath);
    const events = this.requireLedger().listEvents(threadId);
    const contents = events.map((event) => JSON.stringify(event)).join("\n");
    const projection = contents ? `${contents}\n` : "";
    await writeFile(temporaryPath, projection, "utf8");
    await rename(temporaryPath, eventPath);
    return Buffer.byteLength(projection, "utf8");
  }

  private projectionTemporaryPath(targetPath: string): string {
    return `${targetPath}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  }
}

function stripRunSecrets(run: PersistedRunRecord): RunRecord {
  const output = structuredClone(run);
  delete output.leaseTokenSha256;
  return output;
}

function runControlMessageCancellationReason(
  status: Exclude<RunStatus, "queued" | "running">,
): RunControlMessageCancellationReason {
  if (status === "completed") return "run_completed_before_delivery";
  if (status === "cancelled") return "run_cancelled_before_delivery";
  if (status === "interrupted") return "run_interrupted_before_delivery";
  return "run_failed_before_delivery";
}

function operatorDecisionCancellationReason(
  status: Exclude<RunStatus, "queued" | "running">,
): OperatorDecisionCancellationReason {
  if (status === "completed") return "run_completed_without_wait";
  if (status === "cancelled") return "run_cancelled";
  return "run_failed";
}

function stripAutomaticRecoverySecrets(
  attempt: PersistedAutomaticRecoveryAttempt,
): AutomaticRecoveryAttempt {
  const output = structuredClone(attempt);
  delete output.claimTokenSha256;
  return output;
}

function withAutomaticRecoveryAttemptHash(
  input: Omit<PersistedAutomaticRecoveryAttempt, "contentSha256"> & {
    contentSha256?: string;
  },
): PersistedAutomaticRecoveryAttempt {
  const { contentSha256: _contentSha256, claimTokenSha256, ...content } = input;
  const publicContent = content as Omit<
    AutomaticRecoveryAttempt,
    "contentSha256"
  >;
  const validated = validateAutomaticRecoveryAttempt({
    ...publicContent,
    contentSha256: hashAutomaticRecoveryAttempt(publicContent),
  });
  return {
    ...validated,
    ...(claimTokenSha256 ? { claimTokenSha256 } : {}),
  };
}

function createAutomaticRecoveryAttemptRecord(
  assessment: AutomaticRecoveryAssessment,
  ownerId: string,
  token: string,
  timestamp: string,
  leaseMs: number,
): PersistedAutomaticRecoveryAttempt {
  const content: Omit<AutomaticRecoveryAttempt, "contentSha256"> = {
    id: createId("recovery"),
    threadId: assessment.threadId,
    agentId: assessment.agentId,
    rootRunId: assessment.rootRunId,
    interruptedRunId: assessment.runId,
    attempt: assessment.priorAttempts + 1,
    maxAttempts: assessment.policy.maxAttempts,
    triggerId: `automatic-recovery:${assessment.rootRunId}:${assessment.priorAttempts + 1}`,
    assessmentSha256: assessment.contentSha256,
    status: "claimed",
    claim: {
      ownerId,
      acquiredAt: timestamp,
      heartbeatAt: timestamp,
      expiresAt: new Date(Date.parse(timestamp) + leaseMs).toISOString(),
      revision: 1,
    },
    createdAt: timestamp,
    updatedAt: timestamp,
    revision: 1,
  };
  return withAutomaticRecoveryAttemptHash({
    ...content,
    claimTokenSha256: sha256(token),
  });
}

function reissueAutomaticRecoveryClaim(
  current: PersistedAutomaticRecoveryAttempt,
  ownerId: string,
  token: string,
  timestamp: string,
  leaseMs: number,
): PersistedAutomaticRecoveryAttempt {
  return withAutomaticRecoveryAttemptHash({
    ...current,
    claim: {
      ownerId,
      acquiredAt: timestamp,
      heartbeatAt: timestamp,
      expiresAt: new Date(Date.parse(timestamp) + leaseMs).toISOString(),
      revision: (current.claim?.revision ?? 0) + 1,
    },
    claimTokenSha256: sha256(token),
    updatedAt: timestamp,
    revision: current.revision + 1,
  });
}

function settleAutomaticRecoveryAttemptRecord(
  current: PersistedAutomaticRecoveryAttempt,
  run: PersistedRunRecord,
  timestamp: string,
): PersistedAutomaticRecoveryAttempt {
  if (
    run.status === "queued" ||
    run.status === "running" ||
    run.triggerId !== current.triggerId ||
    run.parentRunId !== current.interruptedRunId
  ) {
    throw new Error("Automatic recovery attempt cannot settle from this Run");
  }
  const {
    claim: _claim,
    claimTokenSha256: _claimTokenSha256,
    contentSha256: _contentSha256,
    error: _error,
    ...base
  } = current;
  const status: AutomaticRecoveryAttempt["status"] =
    run.status === "completed"
      ? "completed"
      : run.status === "failed"
        ? "failed"
        : run.status === "cancelled"
          ? "cancelled"
          : "interrupted";
  return withAutomaticRecoveryAttemptHash({
    ...base,
    status,
    recoveryRunId: run.id,
    ...(status === "completed"
      ? {}
      : {
          error: normalizeAutomaticRecoveryError(
            run.error ?? `Recovery Run settled as ${run.status}`,
          ),
        }),
    startedAt: current.startedAt ?? run.startedAt,
    finishedAt: run.finishedAt ?? timestamp,
    updatedAt: timestamp,
    revision: current.revision + 1,
  });
}

function automaticRecoveryRoot(
  runs: PersistedRunRecord[],
  candidate: PersistedRunRecord,
): { rootRunId: string; trusted: boolean } {
  let current = candidate;
  let trusted = true;
  const visited = new Set([candidate.id]);
  for (let depth = 0; current.source === "recovery"; depth += 1) {
    if (depth >= 32 || !current.parentRunId) {
      trusted = false;
      break;
    }
    const parent = runs.find(
      (run) =>
        run.id === current.parentRunId &&
        run.threadId === candidate.threadId &&
        run.agentId === candidate.agentId,
    );
    if (!parent || visited.has(parent.id) || parent.status !== "interrupted") {
      trusted = false;
      break;
    }
    visited.add(parent.id);
    current = parent;
  }
  return { rootRunId: current.id, trusted };
}

function normalizeAutomaticRecoveryError(value: string): string {
  const normalized = value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (normalized || "Automatic recovery failed").slice(0, 1_000);
}

function boundedStoreInteger(
  value: number,
  label: string,
  minimum: number,
  maximum: number,
): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(
      `${label} must be an integer from ${minimum} to ${maximum}`,
    );
  }
  return value;
}

function assertMemoryReplacementTargets(
  targets: MemoryFact[],
  replacement: MemoryFact,
): void {
  const consolidation = targets.length > 1;
  for (const target of targets) {
    if (target.status !== "active" && target.status !== "stale") {
      throw new Error(
        `Cannot ${consolidation ? "consolidate" : "correct"} memory in ${target.status} state`,
      );
    }
    if (
      target.scope !== replacement.scope ||
      target.agentId !== replacement.agentId
    ) {
      throw new Error(
        `Memory ${consolidation ? "consolidation" : "correction"} must preserve scope and Agent`,
      );
    }
    if (target.content === replacement.content) {
      throw new Error(
        consolidation
          ? "Memory consolidation must synthesize source content"
          : "Memory correction must change content",
      );
    }
    if (target.supersededByMemoryId) {
      throw new Error(
        `Memory is already superseded by ${target.supersededByMemoryId}`,
      );
    }
  }
}

function memoryReplacementKey(
  fact: Pick<MemoryFact, "supersedesMemoryId" | "consolidatesMemoryIds">,
): string {
  return memoryReplacementTargetIds(fact).join(",");
}

function validatePersistedRunEvaluation(
  evaluation: RunEvaluationRecord,
  threads: ThreadRecord[],
  runs: PersistedRunRecord[],
  subagents: SubagentTask[],
  sourceBindingEvents?: readonly RunEvent[],
): void {
  const thread = threads.find(
    (candidate) => candidate.id === evaluation.threadId,
  );
  const leftRun = runs.find(
    (candidate) => candidate.id === evaluation.leftRunId,
  );
  const rightRun = runs.find(
    (candidate) => candidate.id === evaluation.rightRunId,
  );
  if (
    !/^evaluation_[a-z0-9_]{8,80}$/.test(evaluation.id) ||
    !thread ||
    !leftRun ||
    !rightRun ||
    leftRun.id === rightRun.id ||
    leftRun.threadId !== evaluation.threadId ||
    rightRun.threadId !== evaluation.threadId
  ) {
    throw new Error(
      `Persisted Run evaluation reference is invalid: ${evaluation.id}`,
    );
  }
  if (
    !/^[a-f0-9]{64}$/.test(evaluation.leftSnapshotSha256) ||
    !/^[a-f0-9]{64}$/.test(evaluation.rightSnapshotSha256) ||
    !Number.isFinite(Date.parse(evaluation.createdAt)) ||
    !evaluation.evaluatorModel.provider.trim() ||
    !evaluation.evaluatorModel.id.trim() ||
    !["left_better", "right_better", "tie", "inconclusive"].includes(
      evaluation.verdict,
    ) ||
    typeof evaluation.reason !== "string" ||
    !evaluation.reason.trim() ||
    evaluation.reason.length > 20_000 ||
    typeof evaluation.evidence !== "string" ||
    evaluation.evidence.length > 20_000
  ) {
    throw new Error(`Persisted Run evaluation is invalid: ${evaluation.id}`);
  }
  if (evaluation.comparisonGovernance) {
    const governance = evaluation.comparisonGovernance;
    const { contentSha256, ...governanceContent } = governance;
    if (
      governance.kind !== "napier.run-evaluation-governance" ||
      governance.schemaVersion !== 1 ||
      !["clean", "partial", "missing", "regressed"].includes(
        governance.contextCoverageStatus,
      ) ||
      !Number.isFinite(governance.contextCoverageRateDelta) ||
      !/^[a-f0-9]{64}$/.test(governance.contextCoverageDiagnosticsSha256) ||
      !/^[a-f0-9]{64}$/.test(governance.contextCoverageDeltaSha256) ||
      (governance.traceSummaryBoundaryStatus !== undefined &&
        !["clean", "generic_present", "regressed"].includes(
          governance.traceSummaryBoundaryStatus,
        )) ||
      (governance.traceSummaryBoundaryGenericDelta !== undefined &&
        !Number.isSafeInteger(governance.traceSummaryBoundaryGenericDelta)) ||
      (governance.traceSummaryBoundaryDiagnosticsSha256 !== undefined &&
        !/^[a-f0-9]{64}$/.test(
          governance.traceSummaryBoundaryDiagnosticsSha256,
        )) ||
      (governance.traceSummaryBoundaryDeltaSha256 !== undefined &&
        !/^[a-f0-9]{64}$/.test(governance.traceSummaryBoundaryDeltaSha256)) ||
      ([
        governance.traceSummaryBoundaryStatus,
        governance.traceSummaryBoundaryGenericDelta,
        governance.traceSummaryBoundaryDiagnosticsSha256,
        governance.traceSummaryBoundaryDeltaSha256,
      ].some((value) => value !== undefined) &&
        ![
          governance.traceSummaryBoundaryStatus,
          governance.traceSummaryBoundaryGenericDelta,
          governance.traceSummaryBoundaryDiagnosticsSha256,
          governance.traceSummaryBoundaryDeltaSha256,
        ].every((value) => value !== undefined)) ||
      !/^[a-f0-9]{64}$/.test(contentSha256) ||
      sha256(canonicalJson(governanceContent)) !== contentSha256
    ) {
      throw new Error(
        `Persisted Run evaluation governance is invalid: ${evaluation.id}`,
      );
    }
    if (sourceBindingEvents) {
      assertRunEvaluationGovernanceSourceBinding({
        evaluation,
        events: sourceBindingEvents,
        subagents,
        label: `Persisted Run evaluation ${evaluation.id}`,
        skipSnapshotSourceBinding: isImportedHistoricalEvaluation(
          evaluation,
          thread.importProvenance,
        ),
      });
    }
  }
  if (
    !evaluation.rubric.name.trim() ||
    evaluation.rubric.name.length > 500 ||
    !Array.isArray(evaluation.rubric.criteria) ||
    evaluation.rubric.criteria.length < 1 ||
    evaluation.rubric.criteria.length > 100 ||
    !Array.isArray(evaluation.scores) ||
    evaluation.scores.length > 100
  ) {
    throw new Error(
      `Persisted Run evaluation rubric is invalid: ${evaluation.id}`,
    );
  }
  const criterionIds = new Set<string>();
  for (const criterion of evaluation.rubric.criteria) {
    if (
      !criterion.id ||
      criterion.id.length > 100 ||
      !criterion.name.trim() ||
      criterion.name.length > 500 ||
      !criterion.description.trim() ||
      criterion.description.length > 5_000 ||
      criterionIds.has(criterion.id)
    ) {
      throw new Error(
        `Persisted Run evaluation criterion is invalid: ${evaluation.id}`,
      );
    }
    criterionIds.add(criterion.id);
  }
  const scoreCriterionIds = new Set<string>();
  for (const score of evaluation.scores) {
    if (
      !criterionIds.has(score.criterionId) ||
      scoreCriterionIds.has(score.criterionId) ||
      !Number.isFinite(score.leftScore) ||
      score.leftScore < 1 ||
      score.leftScore > 5 ||
      !Number.isFinite(score.rightScore) ||
      score.rightScore < 1 ||
      score.rightScore > 5 ||
      !score.reason.trim() ||
      score.reason.length > 10_000
    ) {
      throw new Error(
        `Persisted Run evaluation score is invalid: ${evaluation.id}`,
      );
    }
    scoreCriterionIds.add(score.criterionId);
  }
}

function assertEvaluationSuiteRuns(
  runs: PersistedRunRecord[],
  suite: Pick<
    EvaluationSuite,
    "id" | "threadId" | "baselineRunId" | "candidateRunIds"
  >,
): void {
  for (const runId of [suite.baselineRunId, ...suite.candidateRunIds]) {
    const run = runs.find((candidate) => candidate.id === runId);
    if (!run || run.threadId !== suite.threadId) {
      throw new Error(
        `Evaluation suite run must belong to the target thread: ${runId}`,
      );
    }
    if (run.status === "queued" || run.status === "running") {
      throw new Error(`Evaluation suite run must be terminal: ${runId}`);
    }
  }
}

function isImportedHistoricalEvaluation(
  evaluation: RunEvaluationRecord,
  importProvenance: ThreadImportProvenance | undefined,
): boolean {
  return Boolean(
    importProvenance &&
    Date.parse(evaluation.createdAt) <= Date.parse(importProvenance.importedAt),
  );
}

function normalizePersistedEvaluationSuite(suite: EvaluationSuite): void {
  if (!/^suite_[a-z0-9]{8,80}$/.test(suite.id)) {
    throw new Error(`Persisted evaluation suite ID is invalid: ${suite.id}`);
  }
  suite.name = suite.name.replace(/\s+/g, " ").trim().slice(0, 100);
  if (!suite.name) {
    throw new Error(`Persisted evaluation suite name is invalid: ${suite.id}`);
  }
  if (
    !/^run_[a-z0-9]{8,80}$/.test(suite.baselineRunId) ||
    !Array.isArray(suite.candidateRunIds) ||
    suite.candidateRunIds.length < 1 ||
    suite.candidateRunIds.length > 8 ||
    new Set(suite.candidateRunIds).size !== suite.candidateRunIds.length ||
    suite.candidateRunIds.includes(suite.baselineRunId) ||
    suite.candidateRunIds.some((runId) => !/^run_[a-z0-9]{8,80}$/.test(runId))
  ) {
    throw new Error(`Persisted evaluation suite runs are invalid: ${suite.id}`);
  }
  suite.rubric = normalizeRubric(suite.rubric);
  suite.gate = normalizeEvaluationSuiteGate(suite.gate);
  suite.evaluatorModel = {
    provider: suite.evaluatorModel.provider.trim(),
    id: suite.evaluatorModel.id.trim(),
  };
  if (!suite.evaluatorModel.provider || !suite.evaluatorModel.id) {
    throw new Error(`Persisted evaluation suite model is invalid: ${suite.id}`);
  }
  if (!Number.isInteger(suite.revision) || suite.revision < 1) {
    throw new Error(
      `Persisted evaluation suite revision is invalid: ${suite.id}`,
    );
  }
  if (
    !Number.isFinite(Date.parse(suite.createdAt)) ||
    !Number.isFinite(Date.parse(suite.updatedAt))
  ) {
    throw new Error(
      `Persisted evaluation suite timestamp is invalid: ${suite.id}`,
    );
  }
}

function validateEvaluationSuiteExecution(
  execution: EvaluationSuiteExecution,
  suites: EvaluationSuite[],
  evaluations: RunEvaluationRecord[],
  runs: PersistedRunRecord[],
): void {
  if (!/^evalsuite_[a-z0-9]{8,80}$/.test(execution.id)) {
    throw new Error("Evaluation suite execution ID is invalid");
  }
  const suite = suites.find((candidate) => candidate.id === execution.suiteId);
  if (
    !suite ||
    suite.threadId !== execution.threadId ||
    !Number.isInteger(execution.suiteRevision) ||
    execution.suiteRevision < 1 ||
    execution.suiteRevision > suite.revision
  ) {
    throw new Error("Evaluation suite execution references an invalid suite");
  }
  if (
    !execution.name.trim() ||
    execution.name.length > 100 ||
    !Array.isArray(execution.candidateRunIds) ||
    execution.candidateRunIds.length < 1 ||
    execution.candidateRunIds.length > 8 ||
    new Set(execution.candidateRunIds).size !==
      execution.candidateRunIds.length ||
    execution.candidateRunIds.includes(execution.baselineRunId)
  ) {
    throw new Error("Evaluation suite execution snapshot is invalid");
  }
  assertEvaluationSuiteRuns(runs, {
    id: execution.suiteId,
    threadId: execution.threadId,
    baselineRunId: execution.baselineRunId,
    candidateRunIds: execution.candidateRunIds,
  });
  const normalizedRubric = normalizeRubric(execution.rubric);
  const normalizedGate = normalizeEvaluationSuiteGate(execution.gate);
  if (
    JSON.stringify(normalizedRubric) !== JSON.stringify(execution.rubric) ||
    JSON.stringify(normalizedGate) !== JSON.stringify(execution.gate) ||
    !execution.evaluatorModel.provider.trim() ||
    !execution.evaluatorModel.id.trim()
  ) {
    throw new Error("Evaluation suite execution inputs are invalid");
  }
  if (
    !Number.isFinite(Date.parse(execution.startedAt)) ||
    !Number.isFinite(Date.parse(execution.finishedAt)) ||
    Date.parse(execution.finishedAt) < Date.parse(execution.startedAt) ||
    !/^[a-f0-9]{64}$/.test(execution.contentSha256)
  ) {
    throw new Error("Evaluation suite execution evidence is invalid");
  }
  if (
    !Array.isArray(execution.results) ||
    execution.results.length !== execution.candidateRunIds.length
  ) {
    throw new Error("Evaluation suite execution results are incomplete");
  }

  const evaluationIds = new Set<string>();
  for (const [index, result] of execution.results.entries()) {
    const candidateRunId = execution.candidateRunIds[index];
    const evaluation = evaluations.find(
      (candidate) => candidate.id === result.evaluationId,
    );
    if (
      !candidateRunId ||
      result.candidateRunId !== candidateRunId ||
      evaluationIds.has(result.evaluationId) ||
      !evaluation ||
      evaluation.threadId !== execution.threadId ||
      evaluation.leftRunId !== execution.baselineRunId ||
      evaluation.rightRunId !== candidateRunId ||
      result.evaluationSha256 !== hashRunEvaluation(evaluation) ||
      result.verdict !== evaluation.verdict ||
      result.baselineSnapshotSha256 !== evaluation.leftSnapshotSha256 ||
      result.candidateSnapshotSha256 !== evaluation.rightSnapshotSha256
    ) {
      throw new Error("Evaluation suite case evidence is invalid");
    }
    evaluationIds.add(result.evaluationId);
    const baselineAverageScore = scoreAverage(
      evaluation.scores.map((score) => score.leftScore),
    );
    const candidateAverageScore = scoreAverage(
      evaluation.scores.map((score) => score.rightScore),
    );
    const expectedStatus =
      evaluation.verdict === "inconclusive" ||
      candidateAverageScore === undefined
        ? "inconclusive"
        : (evaluation.verdict === "right_better" ||
              evaluation.verdict === "tie") &&
            candidateAverageScore >= execution.gate.minimumCandidateScore
          ? "passed"
          : "failed";
    if (
      result.status !== expectedStatus ||
      result.baselineAverageScore !== baselineAverageScore ||
      result.candidateAverageScore !== candidateAverageScore
    ) {
      throw new Error("Evaluation suite case aggregation is invalid");
    }
  }

  const passedCount = execution.results.filter(
    (result) => result.status === "passed",
  ).length;
  const failedCount = execution.results.filter(
    (result) => result.status === "failed",
  ).length;
  const inconclusiveCount =
    execution.results.length - passedCount - failedCount;
  const conclusiveCount = passedCount + failedCount;
  const passRate = conclusiveCount > 0 ? passedCount / conclusiveCount : 0;
  const averageCandidateScore = scoreAverage(
    execution.results.flatMap((result) =>
      result.candidateAverageScore === undefined
        ? []
        : [result.candidateAverageScore],
    ),
  );
  const status =
    conclusiveCount === 0 ||
    (!execution.gate.allowInconclusive && inconclusiveCount > 0)
      ? "inconclusive"
      : passRate >= execution.gate.minimumPassRate
        ? "passed"
        : "failed";
  if (
    execution.passedCount !== passedCount ||
    execution.failedCount !== failedCount ||
    execution.inconclusiveCount !== inconclusiveCount ||
    execution.passRate !== passRate ||
    execution.averageCandidateScore !== averageCandidateScore ||
    execution.status !== status
  ) {
    throw new Error("Evaluation suite aggregate evidence is invalid");
  }
  const {
    id: _id,
    contentSha256: _contentSha256,
    startedAt: _startedAt,
    finishedAt: _finishedAt,
    ...hashInput
  } = execution;
  if (execution.contentSha256 !== hashEvaluationSuiteExecution(hashInput)) {
    throw new Error("Evaluation suite execution content hash mismatch");
  }
}

function scoreAverage(values: number[]): number | undefined {
  return values.length > 0
    ? Number(
        (
          values.reduce((total, value) => total + value, 0) / values.length
        ).toFixed(4),
      )
    : undefined;
}

function stripScheduleSecrets(
  schedule: PersistedAutomationSchedule,
): AutomationSchedule {
  const output = structuredClone(schedule);
  delete output.claimTokenSha256;
  return output;
}

function stripChannelSecrets(channel: PersistedInboundChannel): InboundChannel {
  const { tokenSha256: _tokenSha256, ...output } = structuredClone(channel);
  return output;
}

function stripDeliverySecrets(
  delivery: PersistedInboundDelivery,
): InboundDelivery {
  const {
    idempotencySha256: _idempotencySha256,
    message: _message,
    model: _model,
    ...output
  } = structuredClone(delivery);
  return output;
}

function createLeaseToken(): string {
  return randomBytes(32).toString("base64url");
}

function receiptTrustAnchorDirectoryQuorumPromotionBaselineKey(
  envelope: TrustedReceiptEnvelope<ReceiptTrustAnchorDirectoryQuorumPromotionReceipt>,
): string {
  const receipt = envelope.receipt;
  return [
    receipt.selectedAnchorSetSha256,
    receipt.selectedDirectorySha256,
    receipt.selectedSubscriptionSetSha256,
    envelope.signature.keyId,
  ].join(":");
}

function receiptTrustCheckpointRegistryQuorumBaselineKey(
  envelope: TrustedReceiptEnvelope<ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorum>,
): string {
  const receipt = envelope.receipt;
  const candidate = receipt.candidates.find(
    (item) => item.checkpointSha256 === receipt.selectedCheckpointSha256,
  );
  return [
    receipt.selectedCheckpointSha256 ?? "",
    receipt.selectedSelectionSetSha256 ?? "",
    receipt.selectedSelectionChainTailSha256 ?? "",
    candidate?.subscriptionSetSha256 ?? "",
    candidate?.sourceOriginSetSha256 ?? "",
    candidate?.signerSetSha256 ?? "",
    envelope.signature.keyId,
  ].join(":");
}

function receiptTrustRotationApprovalPolicyBaselineKey(
  envelope: TrustedReceiptEnvelope<ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyReview>,
): string {
  const receipt = envelope.receipt;
  return [
    receipt.approvalPolicySha256,
    receipt.subscriptionSha256,
    receipt.acceptedApprovalEnvelopeSetSha256,
    receipt.signerSetSha256,
    receipt.requiredSignerSetSha256 ?? "",
    envelope.signature.keyId,
  ].join(":");
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function assertLeaseToken(
  expectedSha256: string | undefined,
  token: string | undefined,
): void {
  assertHashedToken(expectedSha256, token, "Lease token");
}

function assertHashedToken(
  expectedSha256: string | undefined,
  token: string | undefined,
  label: string,
): void {
  if (!expectedSha256 || !token) throw new Error(`${label} is required`);
  const expected = Buffer.from(expectedSha256, "hex");
  const actual = Buffer.from(sha256(token), "hex");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new Error(`${label} is invalid`);
  }
}

function validateLeaseTtl(value: number): number {
  if (!Number.isInteger(value) || value < 5_000 || value > 10 * 60_000) {
    throw new Error("Lease TTL must be an integer from 5000 to 600000 ms");
  }
  return value;
}

function normalizeLeaseOwner(value: string): string {
  const normalized = value.trim();
  if (!/^[a-z][a-z0-9_.:-]{2,127}$/.test(normalized)) {
    throw new Error("Lease owner ID is invalid");
  }
  return normalized;
}

function normalizeTriggerId(value: string): string {
  const normalized = value.trim();
  if (
    !normalized ||
    normalized.length > 240 ||
    /[\u0000-\u001f\u007f]/.test(normalized)
  ) {
    throw new Error("Run trigger ID is invalid");
  }
  return normalized;
}

function normalizeChannelName(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) throw new Error("Inbound channel name is required");
  if (normalized.length > 100) {
    throw new Error("Inbound channel name must be at most 100 characters");
  }
  return normalized;
}

function normalizeInboundChannelAdapter(
  adapter: unknown,
): InboundChannelAdapter {
  if (adapter === undefined) return DEFAULT_INBOUND_CHANNEL_ADAPTER;
  if (
    adapter === "napier_json" ||
    adapter === "github_webhook" ||
    adapter === "slack_event" ||
    adapter === "linear_webhook"
  ) {
    return adapter;
  }
  throw new Error("Inbound channel adapter is invalid");
}

function normalizeImportedThreadTitle(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized ? normalized.slice(0, 100) : "Imported ledger";
}

function remapJsonValue(
  value: JsonValue,
  idMap: ReadonlyMap<string, string>,
): JsonValue {
  if (typeof value === "string") return idMap.get(value) ?? value;
  if (Array.isArray(value)) {
    return value.map((item) => remapJsonValue(item, idMap));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        remapJsonValue(item, idMap),
      ]),
    );
  }
  return value;
}

function rebindImportedSubagentEventPayload(
  type: string,
  sourcePayload: JsonValue,
  payload: JsonValue,
  tasks: ReadonlyMap<string, SubagentTask>,
  idMap: Map<string, string>,
): JsonValue {
  if (type === "subagent.outcome.repair.requested") {
    const source = validateSubagentOutcomeRepairRequest(sourcePayload);
    const taskId = idMap.get(source.taskId);
    if (!taskId || !tasks.has(taskId)) {
      throw new Error("Imported Subagent outcome repair task is missing");
    }
    const rebound = rebindSubagentOutcomeRepairRequest(source, taskId);
    idMap.set(source.contentSha256, rebound.contentSha256);
    return rebound as unknown as JsonValue;
  }
  if (type === "subagent.outcome.repair.outcome") {
    const source = validateSubagentOutcomeRepairOutcome(sourcePayload);
    const taskId = idMap.get(source.taskId);
    const requestContentSha256 = idMap.get(source.requestContentSha256);
    const task = taskId ? tasks.get(taskId) : undefined;
    const importedOutcomeSha256 =
      source.status === "accepted" ? task?.outcome?.contentSha256 : undefined;
    if (
      !taskId ||
      !requestContentSha256 ||
      !task ||
      (source.status === "accepted" && !importedOutcomeSha256)
    ) {
      throw new Error("Imported Subagent outcome repair binding is missing");
    }
    const rebound = rebindSubagentOutcomeRepairOutcome(source, {
      taskId,
      requestContentSha256,
      ...(importedOutcomeSha256
        ? { outcomeSha256: importedOutcomeSha256 }
        : {}),
    });
    idMap.set(source.contentSha256, rebound.contentSha256);
    return rebound as unknown as JsonValue;
  }
  if (
    (type !== "subagent.outcome.accepted" && type !== "subagent.completed") ||
    !payload ||
    Array.isArray(payload) ||
    typeof payload !== "object"
  ) {
    return payload;
  }
  const taskId = payload["taskId"];
  const task = typeof taskId === "string" ? tasks.get(taskId) : undefined;
  if (!task?.outcome) return payload;
  if (type === "subagent.completed") {
    return {
      ...payload,
      outcome: structuredClone(task.outcome) as unknown as JsonValue,
    };
  }
  return {
    ...payload,
    outcomeSha256: task.outcome.contentSha256,
    resultSha256: task.outcome.resultSha256,
    itemSetSha256: task.outcome.itemSetSha256,
    itemCount: task.outcome.itemCount,
    unknownCount: task.outcome.unknownCount,
    ...(task.outcome.schemaVersion === 2
      ? {
          evidenceSetSha256: task.outcome.evidenceSetSha256!,
          evidenceCount: task.outcome.evidenceCount!,
        }
      : {}),
  };
}

function normalizeInboundChannelPolicy(request: CreateInboundChannelRequest): {
  retryPolicy: InboundRetryPolicy | undefined;
  signaturePolicy: Partial<InboundSignaturePolicy> | undefined;
} {
  const templateId =
    request.policyTemplate ??
    (request.retryPolicy || request.signaturePolicy
      ? "custom"
      : "legacy_bearer");
  if (templateId === "custom") {
    return {
      retryPolicy: request.retryPolicy,
      signaturePolicy: request.signaturePolicy,
    };
  }
  if (!isNamedInboundChannelPolicyTemplateId(templateId)) {
    throw new Error("Inbound channel policy template is invalid");
  }
  if (
    request.retryPolicy !== undefined ||
    request.signaturePolicy !== undefined
  ) {
    throw new Error(
      "Inbound channel policy template cannot be combined with explicit policies",
    );
  }
  const template = INBOUND_CHANNEL_POLICY_TEMPLATES[templateId];
  return {
    retryPolicy: structuredClone(template.retryPolicy),
    signaturePolicy: structuredClone(template.signaturePolicy),
  };
}

function deriveInboundChannelPolicyTemplate(
  retryPolicy: InboundRetryPolicy,
  signaturePolicy: InboundSignaturePolicy,
): InboundChannelPolicyTemplateId {
  for (const [templateId, template] of Object.entries(
    INBOUND_CHANNEL_POLICY_TEMPLATES,
  ) as Array<
    [
      NamedInboundChannelPolicyTemplateId,
      (typeof INBOUND_CHANNEL_POLICY_TEMPLATES)[NamedInboundChannelPolicyTemplateId],
    ]
  >) {
    if (
      sameInboundRetryPolicy(retryPolicy, template.retryPolicy) &&
      sameInboundSignaturePolicy(signaturePolicy, template.signaturePolicy)
    ) {
      return templateId;
    }
  }
  return "custom";
}

function isNamedInboundChannelPolicyTemplateId(
  value: unknown,
): value is NamedInboundChannelPolicyTemplateId {
  return (
    typeof value === "string" &&
    Object.hasOwn(INBOUND_CHANNEL_POLICY_TEMPLATES, value)
  );
}

function sameInboundRetryPolicy(
  left: InboundRetryPolicy,
  right: InboundRetryPolicy,
): boolean {
  return (
    left.maxAttempts === right.maxAttempts &&
    left.baseDelayMs === right.baseDelayMs
  );
}

function sameInboundSignaturePolicy(
  left: InboundSignaturePolicy,
  right: InboundSignaturePolicy,
): boolean {
  return (
    left.required === right.required &&
    left.algorithm === right.algorithm &&
    left.header === right.header &&
    left.timestampHeader === right.timestampHeader &&
    left.toleranceSeconds === right.toleranceSeconds
  );
}

function normalizeInboundRetryPolicy(
  policy: InboundRetryPolicy | undefined,
  allowDefault = true,
): InboundRetryPolicy {
  if (policy === undefined) {
    if (!allowDefault) {
      throw new Error("Inbound retry policy is required");
    }
    policy = structuredClone(DEFAULT_INBOUND_RETRY_POLICY);
  }
  if (policy === null || typeof policy !== "object" || Array.isArray(policy)) {
    throw new Error("Inbound retry policy must be an object");
  }
  const normalized = policy;
  if (
    !Number.isInteger(normalized.maxAttempts) ||
    normalized.maxAttempts < 1 ||
    normalized.maxAttempts > MAX_INBOUND_ATTEMPTS
  ) {
    throw new Error(
      `Inbound retry maxAttempts must be an integer from 1 to ${MAX_INBOUND_ATTEMPTS}`,
    );
  }
  if (
    !Number.isInteger(normalized.baseDelayMs) ||
    normalized.baseDelayMs < MIN_INBOUND_RETRY_BASE_MS ||
    normalized.baseDelayMs > MAX_INBOUND_RETRY_BASE_MS
  ) {
    throw new Error(
      `Inbound retry baseDelayMs must be an integer from ${MIN_INBOUND_RETRY_BASE_MS} to ${MAX_INBOUND_RETRY_BASE_MS}`,
    );
  }
  return {
    maxAttempts: normalized.maxAttempts,
    baseDelayMs: normalized.baseDelayMs,
  };
}

function normalizeInboundSignaturePolicy(
  policy: Partial<InboundSignaturePolicy> | undefined,
): InboundSignaturePolicy {
  if (policy === undefined) {
    return structuredClone(DEFAULT_INBOUND_SIGNATURE_POLICY);
  }
  if (policy === null || typeof policy !== "object" || Array.isArray(policy)) {
    throw new Error("Inbound signature policy must be an object");
  }
  const required =
    typeof policy.required === "boolean" ? policy.required : false;
  const toleranceSeconds =
    policy.toleranceSeconds === undefined
      ? DEFAULT_INBOUND_SIGNATURE_POLICY.toleranceSeconds
      : policy.toleranceSeconds;
  if (
    !Number.isInteger(toleranceSeconds) ||
    toleranceSeconds < MIN_INBOUND_SIGNATURE_TOLERANCE_SECONDS ||
    toleranceSeconds > MAX_INBOUND_SIGNATURE_TOLERANCE_SECONDS
  ) {
    throw new Error(
      `Inbound signature toleranceSeconds must be an integer from ${MIN_INBOUND_SIGNATURE_TOLERANCE_SECONDS} to ${MAX_INBOUND_SIGNATURE_TOLERANCE_SECONDS}`,
    );
  }
  return {
    required,
    algorithm: "hmac-sha256",
    header: "X-Napier-Channel-Signature",
    timestampHeader: "X-Napier-Channel-Timestamp",
    toleranceSeconds,
  };
}

function normalizeIdempotencyKey(value: string): string {
  const normalized = value.trim();
  if (
    normalized.length < 8 ||
    normalized.length > 200 ||
    /[\u0000-\u001f\u007f]/.test(normalized)
  ) {
    throw new Error("Inbound idempotency key must be 8-200 visible characters");
  }
  return normalized;
}

function normalizeInboundMessage(value: string): string {
  const normalized = value.replace(/\r\n?/g, "\n").trim();
  if (!normalized) throw new Error("Inbound message is required");
  if (normalized.length > 20_000) {
    throw new Error("Inbound message must be at most 20000 characters");
  }
  return normalized;
}

function normalizeOptionalSha256(
  value: string | undefined,
  label: string,
): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw new Error(`${label} is invalid`);
  }
  return normalized;
}

function withExecutionPlanBlueprintRecordPreviewHash(
  preview: Omit<ExecutionPlanBlueprintRecordPreview, "previewSha256">,
): ExecutionPlanBlueprintRecordPreview {
  return {
    ...preview,
    previewSha256: sha256(
      canonicalJson(executionPlanBlueprintRecordPreviewHashContent(preview)),
    ),
  };
}

function executionPlanBlueprintRecordPreviewHashContent(
  preview: Omit<ExecutionPlanBlueprintRecordPreview, "previewSha256">,
): unknown {
  const { qualifiedAt: _qualifiedAt, ...qualification } = preview.qualification;
  return {
    status: preview.status,
    diagnostics: preview.diagnostics,
    threadId: preview.threadId,
    recordId: preview.recordId,
    qualification,
    hasOpenPlan: preview.hasOpenPlan,
    ...(preview.plan
      ? {
          plan: {
            threadId: preview.plan.threadId,
            objective: preview.plan.objective,
            status: preview.plan.status,
            revision: preview.plan.revision,
            steps: preview.plan.steps.map((step) => ({
              id: step.id,
              title: step.title,
              description: step.description,
              verification: step.verification,
              dependsOn: step.dependsOn,
              status: step.status,
              evidence: step.evidence,
              ...(step.blocker ? { blocker: step.blocker } : {}),
              ...(step.runId ? { runId: step.runId } : {}),
            })),
            artifacts: preview.plan.artifacts.map((artifact) => ({
              id: artifact.id,
              path: artifact.path,
              kind: artifact.kind,
              description: artifact.description,
              status: artifact.status,
              evidence: artifact.evidence,
              ...(artifact.sha256 ? { sha256: artifact.sha256 } : {}),
              ...(artifact.sizeBytes !== undefined
                ? { sizeBytes: artifact.sizeBytes }
                : {}),
              ...(artifact.sourceRunId
                ? { sourceRunId: artifact.sourceRunId }
                : {}),
            })),
            criticalPathStepIds: preview.plan.criticalPathStepIds,
            readyStepIds: preview.plan.readyStepIds,
            blockedStepIds: preview.plan.blockedStepIds,
            activePhaseIndex: preview.plan.activePhaseIndex,
            parallelReadyStepIds: preview.plan.parallelReadyStepIds,
            phaseWaveCount: preview.plan.phaseWaves.length,
            phaseProjectionSha256: preview.plan.phaseProjectionSha256,
          },
        }
      : {}),
  };
}

function executionPlanBlueprintRecordReplayFromEvent(
  event: RunEvent,
  recordId: string,
): ExecutionPlanBlueprintRecordReplay | undefined {
  if (event.type !== "plan.created" || !isRecord(event.payload)) {
    return undefined;
  }
  if (event.payload["blueprintRecordId"] !== recordId) return undefined;
  const planId = event.payload["planId"];
  const objective = event.payload["objective"];
  const status = event.payload["status"];
  const stepCount = event.payload["stepCount"];
  const artifactCount = event.payload["artifactCount"];
  const blueprintSha256 = event.payload["blueprintSha256"];
  const sourcePlanId = event.payload["blueprintSourcePlanId"];
  const sourcePlanRevision = event.payload["blueprintSourcePlanRevision"];
  const sourcePlanArchiveSha256 = event.payload["blueprintSourceArchiveSha256"];
  const qualificationStatus = event.payload["blueprintQualificationStatus"];
  const qualificationSha256 = event.payload["blueprintQualificationSha256"];
  const qualificationDiagnosticsSha256 =
    event.payload["blueprintQualificationDiagnosticsSha256"];
  const previewSha256 = event.payload["blueprintPreviewSha256"];
  if (
    typeof planId !== "string" ||
    typeof objective !== "string" ||
    !isExecutionPlanStatus(status) ||
    !isNonNegativeInteger(stepCount) ||
    !isNonNegativeInteger(artifactCount) ||
    !isSha256(blueprintSha256) ||
    typeof sourcePlanId !== "string" ||
    !isNonNegativeInteger(sourcePlanRevision) ||
    !isSha256(sourcePlanArchiveSha256) ||
    !isExecutionPlanBlueprintRecordQualificationStatus(qualificationStatus) ||
    !isSha256(qualificationSha256) ||
    !isSha256(qualificationDiagnosticsSha256) ||
    !isSha256(previewSha256)
  ) {
    return undefined;
  }
  return {
    eventId: event.id,
    threadId: event.threadId,
    runId: event.runId,
    seq: event.seq,
    createdAt: event.createdAt,
    recordId,
    planId,
    objectiveSha256: sha256(objective),
    status,
    stepCount,
    artifactCount,
    blueprintSha256,
    sourcePlanId,
    sourcePlanRevision,
    sourcePlanArchiveSha256,
    qualificationStatus,
    qualificationSha256,
    qualificationDiagnosticsSha256,
    previewSha256,
  };
}

function createExecutionPlanBlueprintRecordReplayHistory(
  recordId: string,
  replays: ExecutionPlanBlueprintRecordReplay[],
): ExecutionPlanBlueprintRecordReplayHistory {
  const sortedReplays = [...replays].sort((left, right) => {
    const createdOrder = left.createdAt.localeCompare(right.createdAt);
    if (createdOrder !== 0) return createdOrder;
    const threadOrder = left.threadId.localeCompare(right.threadId);
    if (threadOrder !== 0) return threadOrder;
    return left.seq - right.seq;
  });
  const threadCount = new Set(sortedReplays.map((replay) => replay.threadId))
    .size;
  const content = {
    kind: "napier.execution-plan-blueprint-replay-history" as const,
    schemaVersion: 1 as const,
    apiVersion: NAPIER_API_VERSION,
    recordId,
    replayCount: sortedReplays.length,
    threadCount,
    planCount: new Set(sortedReplays.map((replay) => replay.planId)).size,
    eventSetSha256: sha256(
      canonicalJson(
        sortedReplays.map((replay) => ({
          eventId: replay.eventId,
          threadId: replay.threadId,
          seq: replay.seq,
          previewSha256: replay.previewSha256,
        })),
      ),
    ),
    ...(threadCount === 1 && sortedReplays[0]
      ? { firstSeq: sortedReplays[0].seq }
      : {}),
    ...(threadCount === 1 && sortedReplays.at(-1)
      ? { lastSeq: sortedReplays.at(-1)!.seq }
      : {}),
    replays: sortedReplays,
  };
  return {
    ...content,
    generatedAt: nowIso(),
    contentSha256: sha256(canonicalJson(content)),
  };
}

function createExecutionPlanBlueprintRecordReplayOutcome(
  replay: ExecutionPlanBlueprintRecordReplay,
  plan: ExecutionPlan | undefined,
): ExecutionPlanBlueprintRecordReplayOutcome {
  const identityMatches =
    plan?.id === replay.planId && plan.threadId === replay.threadId;
  const status: ExecutionPlanBlueprintRecordReplayOutcome["status"] = !plan
    ? "plan_missing"
    : identityMatches
      ? plan.status
      : "identity_mismatch";
  const content = {
    replayEventId: replay.eventId,
    replayEventSeq: replay.seq,
    threadId: replay.threadId,
    planId: replay.planId,
    createdAt: replay.createdAt,
    status,
    ...(identityMatches ? { planRevision: plan.revision } : {}),
    stepCount: identityMatches ? plan.steps.length : replay.stepCount,
    completedStepCount: identityMatches
      ? plan.steps.filter((step) => step.status === "completed").length
      : 0,
    skippedStepCount: identityMatches
      ? plan.steps.filter((step) => step.status === "skipped").length
      : 0,
    blockedStepCount: identityMatches
      ? plan.steps.filter((step) => step.status === "blocked").length
      : 0,
    artifactCount: identityMatches
      ? plan.artifacts.length
      : replay.artifactCount,
    verifiedArtifactCount: identityMatches
      ? plan.artifacts.filter((artifact) => artifact.status === "verified")
          .length
      : 0,
    missingArtifactCount: identityMatches
      ? plan.artifacts.filter((artifact) => artifact.status === "missing")
          .length
      : 0,
    replanCount: identityMatches ? plan.replans.length : 0,
    ...(identityMatches
      ? { planProjectionSha256: executionPlanOutcomeProjectionSha256(plan) }
      : {}),
  };
  return {
    ...content,
    outcomeSha256: sha256(canonicalJson(content)),
  };
}

function executionPlanOutcomeProjectionSha256(plan: ExecutionPlan): string {
  return sha256(
    canonicalJson({
      id: plan.id,
      threadId: plan.threadId,
      status: plan.status,
      revision: plan.revision,
      steps: plan.steps.map((step) => ({
        id: step.id,
        status: step.status,
        dependsOn: step.dependsOn,
        evidenceSha256: sha256(step.evidence),
        ...(step.blocker ? { blockerSha256: sha256(step.blocker) } : {}),
        ...(step.runId ? { runId: step.runId } : {}),
      })),
      artifacts: plan.artifacts.map((artifact) => ({
        id: artifact.id,
        kind: artifact.kind,
        pathSha256: sha256(artifact.path),
        status: artifact.status,
        evidenceSha256: sha256(artifact.evidence),
        ...(artifact.sha256 ? { sha256: artifact.sha256 } : {}),
        ...(artifact.sizeBytes !== undefined
          ? { sizeBytes: artifact.sizeBytes }
          : {}),
        ...(artifact.sourceRunId ? { sourceRunId: artifact.sourceRunId } : {}),
      })),
      replanSha256s: plan.replans.map((replan) => replan.replanSha256),
      criticalPathStepIds: plan.criticalPathStepIds,
      readyStepIds: plan.readyStepIds,
      blockedStepIds: plan.blockedStepIds,
      activePhaseIndex: plan.activePhaseIndex,
      parallelReadyStepIds: plan.parallelReadyStepIds,
      phaseWaveCount: plan.phaseWaves.length,
      phaseProjectionSha256: plan.phaseProjectionSha256,
    }),
  );
}

function createExecutionPlanBlueprintRecordReplayOutcomes(
  recordId: string,
  replayHistorySha256: string,
  outcomes: ExecutionPlanBlueprintRecordReplayOutcome[],
): ExecutionPlanBlueprintRecordReplayOutcomes {
  const sortedOutcomes = [...outcomes].sort((left, right) => {
    const createdOrder = left.createdAt.localeCompare(right.createdAt);
    if (createdOrder !== 0) return createdOrder;
    const threadOrder = left.threadId.localeCompare(right.threadId);
    if (threadOrder !== 0) return threadOrder;
    return left.replayEventSeq - right.replayEventSeq;
  });
  const activeCount = sortedOutcomes.filter(
    (outcome) => outcome.status === "active",
  ).length;
  const completedCount = sortedOutcomes.filter(
    (outcome) => outcome.status === "completed",
  ).length;
  const blockedCount = sortedOutcomes.filter(
    (outcome) => outcome.status === "blocked",
  ).length;
  const cancelledCount = sortedOutcomes.filter(
    (outcome) => outcome.status === "cancelled",
  ).length;
  const invalidCount = sortedOutcomes.filter(
    (outcome) =>
      outcome.status === "plan_missing" ||
      outcome.status === "identity_mismatch",
  ).length;
  const replayCount = sortedOutcomes.length;
  const content = {
    kind: "napier.execution-plan-blueprint-replay-outcomes" as const,
    schemaVersion: 1 as const,
    apiVersion: NAPIER_API_VERSION,
    recordId,
    replayHistorySha256,
    replayCount,
    activeCount,
    completedCount,
    blockedCount,
    cancelledCount,
    invalidCount,
    completionRateBps:
      replayCount === 0
        ? 0
        : Math.floor((completedCount * 10_000) / replayCount),
    outcomeSetSha256: sha256(
      canonicalJson(sortedOutcomes.map((outcome) => outcome.outcomeSha256)),
    ),
    outcomes: sortedOutcomes,
  };
  return {
    ...content,
    generatedAt: nowIso(),
    contentSha256: sha256(canonicalJson(content)),
  };
}

function normalizeExecutionPlanBlueprintOutcomeBaselinePolicy(
  policy:
    | Partial<ExecutionPlanBlueprintRecordOutcomeBaselinePolicy>
    | undefined,
): ExecutionPlanBlueprintRecordOutcomeBaselinePolicy {
  const minReplayCount =
    policy?.minReplayCount ??
    DEFAULT_EXECUTION_PLAN_BLUEPRINT_OUTCOME_BASELINE_POLICY.minReplayCount;
  const minCompletionRateBps =
    policy?.minCompletionRateBps ??
    DEFAULT_EXECUTION_PLAN_BLUEPRINT_OUTCOME_BASELINE_POLICY.minCompletionRateBps;
  const maxBlockedCount =
    policy?.maxBlockedCount ??
    DEFAULT_EXECUTION_PLAN_BLUEPRINT_OUTCOME_BASELINE_POLICY.maxBlockedCount;
  const maxInvalidCount =
    policy?.maxInvalidCount ??
    DEFAULT_EXECUTION_PLAN_BLUEPRINT_OUTCOME_BASELINE_POLICY.maxInvalidCount;
  if (
    !isNonNegativeInteger(minReplayCount) ||
    minReplayCount < 1 ||
    minReplayCount > 10_000 ||
    !isNonNegativeInteger(minCompletionRateBps) ||
    minCompletionRateBps > 10_000 ||
    !isNonNegativeInteger(maxBlockedCount) ||
    maxBlockedCount > 10_000 ||
    !isNonNegativeInteger(maxInvalidCount) ||
    maxInvalidCount > 10_000
  ) {
    throw new Error(
      "Execution plan blueprint outcome baseline policy is invalid",
    );
  }
  return {
    minReplayCount,
    minCompletionRateBps,
    maxBlockedCount,
    maxInvalidCount,
  };
}

function normalizeExecutionPlanBlueprintOutcomeBaselineReviewGate(
  gate:
    | Partial<ExecutionPlanBlueprintRecordOutcomeBaselineReviewGate>
    | undefined,
): ExecutionPlanBlueprintRecordOutcomeBaselineReviewGate {
  const minScore =
    gate?.minScore ??
    DEFAULT_EXECUTION_PLAN_BLUEPRINT_OUTCOME_BASELINE_REVIEW_GATE.minScore;
  const maxRisk =
    gate?.maxRisk ??
    DEFAULT_EXECUTION_PLAN_BLUEPRINT_OUTCOME_BASELINE_REVIEW_GATE.maxRisk;
  if (
    !isNonNegativeInteger(minScore) ||
    minScore > 100 ||
    (maxRisk !== "low" && maxRisk !== "medium" && maxRisk !== "high")
  ) {
    throw new Error(
      "Execution plan blueprint outcome baseline review gate is invalid",
    );
  }
  return {
    minScore,
    maxRisk,
  };
}

interface ExecutionPlanBlueprintOutcomeBaselineReviewEvidence {
  reviewGate: ExecutionPlanBlueprintRecordOutcomeBaselineReviewGate;
  reviewSha256: string;
  reviewInputSha256: string;
  reviewResponseSha256: string;
  reviewVerdict: NonNullable<
    ExecutionPlanBlueprintRecordOutcomeBaseline["reviewVerdict"]
  >;
  reviewScore: number;
  reviewRisk: NonNullable<
    ExecutionPlanBlueprintRecordOutcomeBaseline["reviewRisk"]
  >;
  reviewModel: NonNullable<
    ExecutionPlanBlueprintRecordOutcomeBaseline["reviewModel"]
  >;
}

function createExecutionPlanBlueprintOutcomeBaselineReviewEvidence(input: {
  recordId: string;
  review: unknown;
  outcomes: ExecutionPlanBlueprintRecordReplayOutcomes;
  sourceQualification: ExecutionPlanBlueprintRecordQualification;
  outcomeQualification: ExecutionPlanBlueprintRecordOutcomeQualification;
  reviewGate: ExecutionPlanBlueprintRecordOutcomeBaselineReviewGate;
}): ExecutionPlanBlueprintOutcomeBaselineReviewEvidence {
  const review = validateExecutionPlanBlueprintOutcomeReview(input.review);
  const diagnostics: string[] = [];
  if (review.recordId !== input.recordId) diagnostics.push("record_mismatch");
  if (review.blueprintSha256 !== input.sourceQualification.blueprintSha256) {
    diagnostics.push("blueprint_mismatch");
  }
  if (review.replayOutcomesSha256 !== input.outcomes.contentSha256) {
    diagnostics.push("outcomes_mismatch");
  }
  if (review.replayHistorySha256 !== input.outcomes.replayHistorySha256) {
    diagnostics.push("replay_history_mismatch");
  }
  if (review.outcomeSetSha256 !== input.outcomes.outcomeSetSha256) {
    diagnostics.push("outcome_set_mismatch");
  }
  if (review.replayCount !== input.outcomes.replayCount) {
    diagnostics.push("replay_count_mismatch");
  }
  if (review.completedCount !== input.outcomes.completedCount) {
    diagnostics.push("completed_count_mismatch");
  }
  if (review.blockedCount !== input.outcomes.blockedCount) {
    diagnostics.push("blocked_count_mismatch");
  }
  if (review.invalidCount !== input.outcomes.invalidCount) {
    diagnostics.push("invalid_count_mismatch");
  }
  if (review.completionRateBps !== input.outcomes.completionRateBps) {
    diagnostics.push("completion_rate_mismatch");
  }
  if (
    review.sourceQualificationStatus !== input.sourceQualification.status ||
    input.sourceQualification.status !== "qualified"
  ) {
    diagnostics.push("source_qualification_mismatch");
  }
  if (review.outcomeQualificationStatus !== input.outcomeQualification.status) {
    diagnostics.push("outcome_qualification_mismatch");
  }
  if (review.verdict !== "promote") diagnostics.push("review_not_promote");
  if (review.score < input.reviewGate.minScore) {
    diagnostics.push("review_score_below_min");
  }
  if (
    outcomeReviewRiskRank(review.risk) >
    outcomeReviewRiskRank(input.reviewGate.maxRisk)
  ) {
    diagnostics.push("review_risk_above_max");
  }
  if (diagnostics.length > 0) {
    throw new Error(
      `Execution plan blueprint outcome baseline review failed: ${diagnostics.join(",")}`,
    );
  }
  return {
    reviewGate: input.reviewGate,
    reviewSha256: review.reviewSha256,
    reviewInputSha256: review.inputSha256,
    reviewResponseSha256: review.responseSha256,
    reviewVerdict: review.verdict,
    reviewScore: review.score,
    reviewRisk: review.risk,
    reviewModel: review.model,
  };
}

function validateExecutionPlanBlueprintOutcomeReview(
  value: unknown,
): ExecutionPlanBlueprintRecordOutcomeReview {
  if (!isRecord(value)) {
    throw new Error("Execution plan blueprint outcome review is invalid");
  }
  const review = value as unknown as ExecutionPlanBlueprintRecordOutcomeReview;
  if (
    review.kind !== "napier.execution-plan-blueprint-outcome-review" ||
    review.schemaVersion !== 1 ||
    typeof review.policyId !== "string" ||
    typeof review.recordId !== "string" ||
    !isSha256(review.blueprintSha256) ||
    !isModelRef(review.model) ||
    !isRecord(review.criteria) ||
    (review.verdict !== "promote" &&
      review.verdict !== "revise" &&
      review.verdict !== "reject" &&
      review.verdict !== "inconclusive") ||
    !isNonNegativeInteger(review.score) ||
    review.score > 100 ||
    (review.risk !== "low" &&
      review.risk !== "medium" &&
      review.risk !== "high") ||
    typeof review.reason !== "string" ||
    !Array.isArray(review.concerns) ||
    !Array.isArray(review.scores) ||
    !isExecutionPlanBlueprintRecordQualificationStatus(
      review.sourceQualificationStatus,
    ) ||
    (review.outcomeQualificationStatus !== "qualified" &&
      review.outcomeQualificationStatus !== "missing_baseline" &&
      review.outcomeQualificationStatus !== "policy_failed") ||
    !isSha256(review.replayOutcomesSha256) ||
    !isSha256(review.replayHistorySha256) ||
    !isSha256(review.outcomeSetSha256) ||
    !isNonNegativeInteger(review.replayCount) ||
    !isNonNegativeInteger(review.completedCount) ||
    !isNonNegativeInteger(review.blockedCount) ||
    !isNonNegativeInteger(review.invalidCount) ||
    !isNonNegativeInteger(review.completionRateBps) ||
    review.completionRateBps > 10_000 ||
    (review.baselineId !== undefined &&
      typeof review.baselineId !== "string") ||
    (review.baselineSha256 !== undefined && !isSha256(review.baselineSha256)) ||
    (review.baselineOutcomesSha256 !== undefined &&
      !isSha256(review.baselineOutcomesSha256)) ||
    !isSha256(review.inputSha256) ||
    !isSha256(review.promptSha256) ||
    !isSha256(review.responseSha256) ||
    !isSha256(review.reviewSchemaSha256) ||
    !isSha256(review.reviewSha256) ||
    !Number.isFinite(Date.parse(review.createdAt))
  ) {
    throw new Error("Execution plan blueprint outcome review is invalid");
  }
  if (review.modelContextEnvelope !== undefined) {
    validateModelContextEnvelopeReceipt(review.modelContextEnvelope);
  }
  const { reviewSha256: _reviewSha256, ...content } = review;
  if (sha256(canonicalJson(content)) !== review.reviewSha256) {
    throw new Error("Execution plan blueprint outcome review hash mismatch");
  }
  return structuredClone(review);
}

function outcomeReviewRiskRank(
  risk: NonNullable<ExecutionPlanBlueprintRecordOutcomeBaseline["reviewRisk"]>,
): number {
  return risk === "low" ? 0 : risk === "medium" ? 1 : 2;
}

function executionPlanBlueprintOutcomePolicyDiagnostics(
  outcomes: Pick<
    ExecutionPlanBlueprintRecordReplayOutcomes,
    "replayCount" | "completionRateBps" | "blockedCount" | "invalidCount"
  >,
  policy: ExecutionPlanBlueprintRecordOutcomeBaselinePolicy,
): string[] {
  const diagnostics: string[] = [];
  if (outcomes.replayCount < policy.minReplayCount) {
    diagnostics.push("replay_count_below_min");
  }
  if (outcomes.completionRateBps < policy.minCompletionRateBps) {
    diagnostics.push("completion_rate_below_min");
  }
  if (outcomes.blockedCount > policy.maxBlockedCount) {
    diagnostics.push("blocked_count_above_max");
  }
  if (outcomes.invalidCount > policy.maxInvalidCount) {
    diagnostics.push("invalid_count_above_max");
  }
  return diagnostics;
}

function createExecutionPlanBlueprintOutcomeBaseline(input: {
  id: string;
  recordId: string;
  outcomes: ExecutionPlanBlueprintRecordReplayOutcomes;
  policy: ExecutionPlanBlueprintRecordOutcomeBaselinePolicy;
  reviewEvidence?: ExecutionPlanBlueprintOutcomeBaselineReviewEvidence;
  promotedAt: string;
  supersedesBaselineId?: string;
}): ExecutionPlanBlueprintRecordOutcomeBaseline {
  const content = {
    id: input.id,
    recordId: input.recordId,
    replayOutcomesSha256: input.outcomes.contentSha256,
    replayHistorySha256: input.outcomes.replayHistorySha256,
    outcomeSetSha256: input.outcomes.outcomeSetSha256,
    replayCount: input.outcomes.replayCount,
    completedCount: input.outcomes.completedCount,
    blockedCount: input.outcomes.blockedCount,
    invalidCount: input.outcomes.invalidCount,
    completionRateBps: input.outcomes.completionRateBps,
    policy: input.policy,
    ...(input.reviewEvidence
      ? {
          reviewGate: input.reviewEvidence.reviewGate,
          reviewSha256: input.reviewEvidence.reviewSha256,
          reviewInputSha256: input.reviewEvidence.reviewInputSha256,
          reviewResponseSha256: input.reviewEvidence.reviewResponseSha256,
          reviewVerdict: input.reviewEvidence.reviewVerdict,
          reviewScore: input.reviewEvidence.reviewScore,
          reviewRisk: input.reviewEvidence.reviewRisk,
          reviewModel: input.reviewEvidence.reviewModel,
        }
      : {}),
    promotedAt: input.promotedAt,
    ...(input.supersedesBaselineId
      ? { supersedesBaselineId: input.supersedesBaselineId }
      : {}),
  };
  return {
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  };
}

function validateExecutionPlanBlueprintOutcomeBaseline(
  value: unknown,
): ExecutionPlanBlueprintRecordOutcomeBaseline {
  if (!isRecord(value)) {
    throw new Error("Execution Plan blueprint outcome baseline is invalid");
  }
  const baseline =
    value as unknown as ExecutionPlanBlueprintRecordOutcomeBaseline;
  const policy = normalizeExecutionPlanBlueprintOutcomeBaselinePolicy(
    baseline.policy,
  );
  const reviewGate =
    baseline.reviewGate === undefined
      ? undefined
      : normalizeExecutionPlanBlueprintOutcomeBaselineReviewGate(
          baseline.reviewGate,
        );
  const hasReviewEvidence =
    baseline.reviewSha256 !== undefined ||
    baseline.reviewInputSha256 !== undefined ||
    baseline.reviewResponseSha256 !== undefined ||
    baseline.reviewVerdict !== undefined ||
    baseline.reviewScore !== undefined ||
    baseline.reviewRisk !== undefined ||
    baseline.reviewModel !== undefined ||
    baseline.reviewGate !== undefined;
  if (
    typeof baseline.id !== "string" ||
    typeof baseline.recordId !== "string" ||
    !isSha256(baseline.replayOutcomesSha256) ||
    !isSha256(baseline.replayHistorySha256) ||
    !isSha256(baseline.outcomeSetSha256) ||
    !isNonNegativeInteger(baseline.replayCount) ||
    !isNonNegativeInteger(baseline.completedCount) ||
    !isNonNegativeInteger(baseline.blockedCount) ||
    !isNonNegativeInteger(baseline.invalidCount) ||
    !isNonNegativeInteger(baseline.completionRateBps) ||
    baseline.completionRateBps > 10_000 ||
    (hasReviewEvidence &&
      (!reviewGate ||
        !isSha256(baseline.reviewSha256) ||
        !isSha256(baseline.reviewInputSha256) ||
        !isSha256(baseline.reviewResponseSha256) ||
        baseline.reviewVerdict !== "promote" ||
        !isNonNegativeInteger(baseline.reviewScore) ||
        baseline.reviewScore > 100 ||
        (baseline.reviewRisk !== "low" &&
          baseline.reviewRisk !== "medium" &&
          baseline.reviewRisk !== "high") ||
        !isModelRef(baseline.reviewModel))) ||
    !Number.isFinite(Date.parse(baseline.promotedAt)) ||
    (baseline.supersedesBaselineId !== undefined &&
      typeof baseline.supersedesBaselineId !== "string") ||
    !isSha256(baseline.contentSha256)
  ) {
    throw new Error("Execution Plan blueprint outcome baseline is invalid");
  }
  const { contentSha256: _contentSha256, ...content } = {
    ...baseline,
    policy,
    ...(reviewGate ? { reviewGate } : {}),
  };
  if (sha256(canonicalJson(content)) !== baseline.contentSha256) {
    throw new Error("Execution Plan blueprint outcome baseline hash mismatch");
  }
  return structuredClone({
    ...baseline,
    policy,
    ...(reviewGate ? { reviewGate } : {}),
  });
}

function createExecutionPlanBlueprintRecommendationPolicyOverride(input: {
  family: ExecutionPlanBlueprintPortfolioCalibrationFamily;
  recommendationPolicy: ExecutionPlanBlueprintRecommendationPolicy;
  portfolioSetSha256: string;
  updatedAt: string;
}): ExecutionPlanBlueprintRecommendationPolicyOverride {
  const content = {
    kind: "napier.execution-plan-blueprint-recommendation-policy-override" as const,
    schemaVersion: 1 as const,
    apiVersion: NAPIER_API_VERSION,
    familySha256: input.family.familySha256,
    recommendationPolicy: input.recommendationPolicy,
    recommendationPolicySha256:
      executionPlanBlueprintRecommendationPolicySha256(
        input.recommendationPolicy,
      ),
    portfolioSetSha256: input.portfolioSetSha256,
    familyRecordCount: input.family.recordCount,
    familyOutcomeQualifiedCount: input.family.outcomeQualifiedCount,
    familyCompletionRateBps: input.family.completionRateBps,
    updatedAt: input.updatedAt,
  };
  return {
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  };
}

function validateExecutionPlanBlueprintRecommendationPolicyOverride(
  value: unknown,
): ExecutionPlanBlueprintRecommendationPolicyOverride {
  if (!isRecord(value)) {
    throw new Error(
      "Execution Plan blueprint recommendation policy override is invalid",
    );
  }
  const override =
    value as unknown as ExecutionPlanBlueprintRecommendationPolicyOverride;
  const recommendationPolicy =
    normalizeExecutionPlanBlueprintRecommendationPolicy(
      override.recommendationPolicy?.templateId,
    );
  if (
    override.kind !==
      "napier.execution-plan-blueprint-recommendation-policy-override" ||
    override.schemaVersion !== 1 ||
    override.apiVersion !== NAPIER_API_VERSION ||
    !isSha256(override.familySha256) ||
    override.recommendationPolicySha256 !==
      executionPlanBlueprintRecommendationPolicySha256(recommendationPolicy) ||
    !isSha256(override.portfolioSetSha256) ||
    !isNonNegativeInteger(override.familyRecordCount) ||
    !isNonNegativeInteger(override.familyOutcomeQualifiedCount) ||
    !isNonNegativeInteger(override.familyCompletionRateBps) ||
    override.familyCompletionRateBps > 10_000 ||
    !Number.isFinite(Date.parse(override.updatedAt)) ||
    !isSha256(override.contentSha256)
  ) {
    throw new Error(
      "Execution Plan blueprint recommendation policy override is invalid",
    );
  }
  const { contentSha256: _contentSha256, ...content } = {
    ...override,
    recommendationPolicy,
  };
  if (sha256(canonicalJson(content)) !== override.contentSha256) {
    throw new Error(
      "Execution Plan blueprint recommendation policy override hash mismatch",
    );
  }
  return structuredClone({
    ...override,
    recommendationPolicy,
  });
}

function createExecutionPlanBlueprintRecommendationPolicyOverrideList(input: {
  overrides: ExecutionPlanBlueprintRecommendationPolicyOverride[];
  portfolioSetSha256: string;
}): ExecutionPlanBlueprintRecommendationPolicyOverrideList {
  const overrides = input.overrides
    .map(validateExecutionPlanBlueprintRecommendationPolicyOverride)
    .sort((left, right) => left.familySha256.localeCompare(right.familySha256));
  const content = {
    kind: "napier.execution-plan-blueprint-recommendation-policy-overrides" as const,
    schemaVersion: 1 as const,
    apiVersion: NAPIER_API_VERSION,
    overrideCount: overrides.length,
    portfolioSetSha256: input.portfolioSetSha256,
    overrideSetSha256:
      executionPlanBlueprintRecommendationPolicyOverrideSetSha256(overrides),
    overrides,
  };
  return {
    ...content,
    generatedAt: nowIso(),
    contentSha256: sha256(canonicalJson(content)),
  };
}

function createExecutionPlanBlueprintOutcomeQualification(
  recordId: string,
  outcomes: ExecutionPlanBlueprintRecordReplayOutcomes,
  baseline: ExecutionPlanBlueprintRecordOutcomeBaseline | undefined,
): ExecutionPlanBlueprintRecordOutcomeQualification {
  const diagnostics = baseline
    ? executionPlanBlueprintOutcomePolicyDiagnostics(outcomes, baseline.policy)
    : ["baseline_missing"];
  const status: ExecutionPlanBlueprintRecordOutcomeQualification["status"] =
    !baseline
      ? "missing_baseline"
      : diagnostics.length === 0
        ? "qualified"
        : "policy_failed";
  const content = {
    schemaVersion: 1 as const,
    status,
    diagnostics,
    recordId,
    ...(baseline
      ? {
          baselineId: baseline.id,
          baselineSha256: baseline.contentSha256,
          baselineOutcomesSha256: baseline.replayOutcomesSha256,
          policy: baseline.policy,
        }
      : {}),
    currentOutcomesSha256: outcomes.contentSha256,
    currentReplayHistorySha256: outcomes.replayHistorySha256,
    currentOutcomeSetSha256: outcomes.outcomeSetSha256,
    replayCount: outcomes.replayCount,
    completedCount: outcomes.completedCount,
    blockedCount: outcomes.blockedCount,
    invalidCount: outcomes.invalidCount,
    completionRateBps: outcomes.completionRateBps,
  };
  return {
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  };
}

function normalizeExecutionPlanBlueprintSelectionObjective(
  value: string | undefined,
): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  if (normalized.length < 1 || normalized.length > 4_000) {
    throw new Error("Execution plan blueprint selection objective is invalid");
  }
  return normalized;
}

function normalizeExecutionPlanBlueprintRecommendationPolicy(
  templateId: ExecutionPlanBlueprintRecommendationPolicyTemplateId | undefined,
): ExecutionPlanBlueprintRecommendationPolicy {
  const selected = templateId ?? "balanced";
  const policy = EXECUTION_PLAN_BLUEPRINT_RECOMMENDATION_POLICIES[selected];
  if (!policy) {
    throw new Error(
      "Execution plan blueprint recommendation policy is invalid",
    );
  }
  return structuredClone(policy);
}

function compareExecutionPlanBlueprintRecords(
  left: ExecutionPlanBlueprintRecord,
  right: ExecutionPlanBlueprintRecord,
): number {
  const updatedOrder = right.updatedAt.localeCompare(left.updatedAt);
  if (updatedOrder !== 0) return updatedOrder;
  return left.id.localeCompare(right.id);
}

function createExecutionPlanBlueprintSelectionCandidate(input: {
  record: ExecutionPlanBlueprintRecord;
  sourceQualification: ExecutionPlanBlueprintRecordQualification;
  outcomeQualification: ExecutionPlanBlueprintRecordOutcomeQualification;
  family: ExecutionPlanBlueprintPortfolioCalibrationFamily;
  recommendationPolicy: ExecutionPlanBlueprintRecommendationPolicy;
  recommendationPolicySource: ExecutionPlanBlueprintRecommendationPolicySource;
  familyPolicyOverrideSha256?: string;
  latestBaseline?: ExecutionPlanBlueprintRecordOutcomeBaseline;
  preview?: ExecutionPlanBlueprintRecordPreview;
}): ExecutionPlanBlueprintRecordSelectionCandidate {
  const ready =
    input.sourceQualification.status === "qualified" &&
    input.outcomeQualification.status === "qualified" &&
    input.preview?.status === "ready";
  const diagnostics = uniqueStrings([
    ...(input.sourceQualification.status === "qualified"
      ? []
      : [`source_${input.sourceQualification.status}`]),
    ...input.sourceQualification.diagnostics.map(
      (diagnostic) => `source_${diagnostic}`,
    ),
    ...(input.outcomeQualification.status === "qualified"
      ? []
      : [`outcome_${input.outcomeQualification.status}`]),
    ...input.outcomeQualification.diagnostics.map(
      (diagnostic) => `outcome_${diagnostic}`,
    ),
    ...(input.preview && input.preview.status !== "ready"
      ? [`preview_${input.preview.status}`]
      : []),
    ...(input.preview?.diagnostics.map(
      (diagnostic) => `preview_${diagnostic}`,
    ) ?? []),
  ]);
  return {
    recordId: input.record.id,
    recordStatus: input.record.status,
    recordUpdatedAt: input.record.updatedAt,
    selectionStatus: ready ? "qualified" : "rejected",
    diagnostics,
    blueprintSha256: input.record.blueprintSha256,
    familySha256: input.family.familySha256,
    sourceQualificationStatus: input.sourceQualification.status,
    outcomeQualificationStatus: input.outcomeQualification.status,
    familyRecordCount: input.family.recordCount,
    familyOutcomeQualifiedCount: input.family.outcomeQualifiedCount,
    familyReviewedBaselineCount: input.family.reviewedBaselineCount,
    familyCompletionRateBps: input.family.completionRateBps,
    recommendationScoreBps: ready
      ? executionPlanBlueprintRecommendationScoreBps({
          outcomeCompletionBps: input.outcomeQualification.completionRateBps,
          familyCompletionBps: input.family.completionRateBps,
          reviewedBaselineCoverageBps:
            executionPlanBlueprintFamilyReviewedBaselineCoverageBps(
              input.family,
            ),
          replayEvidenceBps: executionPlanBlueprintReplayEvidenceBps(
            input.outcomeQualification.replayCount,
          ),
          policy: input.recommendationPolicy,
        })
      : 0,
    recommendationPolicyTemplate: input.recommendationPolicy.templateId,
    recommendationPolicySha256:
      executionPlanBlueprintRecommendationPolicySha256(
        input.recommendationPolicy,
      ),
    recommendationPolicySource: input.recommendationPolicySource,
    ...(input.familyPolicyOverrideSha256
      ? { familyPolicyOverrideSha256: input.familyPolicyOverrideSha256 }
      : {}),
    ...(input.preview ? { previewStatus: input.preview.status } : {}),
    ...(input.preview?.previewSha256
      ? { previewSha256: input.preview.previewSha256 }
      : {}),
    ...(input.outcomeQualification.baselineId
      ? { baselineId: input.outcomeQualification.baselineId }
      : {}),
    ...(input.outcomeQualification.baselineSha256
      ? { baselineSha256: input.outcomeQualification.baselineSha256 }
      : {}),
    ...(input.outcomeQualification.baselineOutcomesSha256
      ? {
          baselineOutcomesSha256:
            input.outcomeQualification.baselineOutcomesSha256,
        }
      : {}),
    ...(input.latestBaseline?.promotedAt
      ? { baselinePromotedAt: input.latestBaseline.promotedAt }
      : {}),
    currentOutcomesSha256: input.outcomeQualification.currentOutcomesSha256,
    currentReplayHistorySha256:
      input.outcomeQualification.currentReplayHistorySha256,
    currentOutcomeSetSha256: input.outcomeQualification.currentOutcomeSetSha256,
    scoreBps: ready ? input.outcomeQualification.completionRateBps : 0,
    replayCount: input.outcomeQualification.replayCount,
    completedCount: input.outcomeQualification.completedCount,
    blockedCount: input.outcomeQualification.blockedCount,
    invalidCount: input.outcomeQualification.invalidCount,
    completionRateBps: input.outcomeQualification.completionRateBps,
    stepCount: input.record.blueprint.stepCount,
    artifactCount: input.record.blueprint.artifactCount,
  };
}

interface ExecutionPlanBlueprintPortfolioCalibrationEntry {
  recordId: string;
  recordStatus: ExecutionPlanBlueprintRecord["status"];
  recordUpdatedAt: string;
  familySha256: string;
  blueprintSha256: string;
  sourceQualificationStatus: ExecutionPlanBlueprintRecordQualification["status"];
  outcomeQualificationStatus: ExecutionPlanBlueprintRecordOutcomeQualification["status"];
  sourceDiagnostics: string[];
  outcomeDiagnostics: string[];
  baselineSha256?: string;
  baselinePromotedAt?: string;
  reviewedBaseline: boolean;
  currentOutcomesSha256: string;
  currentOutcomeSetSha256: string;
  replayCount: number;
  completedCount: number;
  blockedCount: number;
  invalidCount: number;
  completionRateBps: number;
  stepCount: number;
  artifactCount: number;
}

function createExecutionPlanBlueprintPortfolioCalibrationEntry(input: {
  record: ExecutionPlanBlueprintRecord;
  sourceQualification: ExecutionPlanBlueprintRecordQualification;
  outcomeQualification: ExecutionPlanBlueprintRecordOutcomeQualification;
  latestBaseline?: ExecutionPlanBlueprintRecordOutcomeBaseline;
}): ExecutionPlanBlueprintPortfolioCalibrationEntry {
  return {
    recordId: input.record.id,
    recordStatus: input.record.status,
    recordUpdatedAt: input.record.updatedAt,
    familySha256: executionPlanBlueprintFamilySha256(input.record.blueprint),
    blueprintSha256: input.record.blueprintSha256,
    sourceQualificationStatus: input.sourceQualification.status,
    outcomeQualificationStatus: input.outcomeQualification.status,
    sourceDiagnostics: input.sourceQualification.diagnostics,
    outcomeDiagnostics: input.outcomeQualification.diagnostics,
    ...(input.outcomeQualification.baselineSha256
      ? { baselineSha256: input.outcomeQualification.baselineSha256 }
      : {}),
    ...(input.latestBaseline?.promotedAt
      ? { baselinePromotedAt: input.latestBaseline.promotedAt }
      : {}),
    reviewedBaseline: Boolean(input.latestBaseline?.reviewSha256),
    currentOutcomesSha256: input.outcomeQualification.currentOutcomesSha256,
    currentOutcomeSetSha256: input.outcomeQualification.currentOutcomeSetSha256,
    replayCount: input.outcomeQualification.replayCount,
    completedCount: input.outcomeQualification.completedCount,
    blockedCount: input.outcomeQualification.blockedCount,
    invalidCount: input.outcomeQualification.invalidCount,
    completionRateBps: input.outcomeQualification.completionRateBps,
    stepCount: input.record.blueprint.stepCount,
    artifactCount: input.record.blueprint.artifactCount,
  };
}

function executionPlanBlueprintFamilySha256(
  blueprint: ExecutionPlanBlueprintRecord["blueprint"],
): string {
  return sha256(
    canonicalJson({
      stepCount: blueprint.stepCount,
      artifactCount: blueprint.artifactCount,
      steps: blueprint.steps
        .map((step) => ({
          idSha256: sha256(step.id),
          dependsOnSha256: sha256(
            canonicalJson([...(step.dependsOn ?? [])].sort()),
          ),
        }))
        .sort((left, right) => left.idSha256.localeCompare(right.idSha256)),
      artifacts: (blueprint.artifacts ?? [])
        .map((artifact) => ({
          idSha256: sha256(artifact.id),
          kind: artifact.kind ?? "file",
        }))
        .sort((left, right) => left.idSha256.localeCompare(right.idSha256)),
    }),
  );
}

function createExecutionPlanBlueprintPortfolioCalibration(
  entries: ExecutionPlanBlueprintPortfolioCalibrationEntry[],
): ExecutionPlanBlueprintPortfolioCalibration {
  const families =
    createExecutionPlanBlueprintPortfolioCalibrationFamilies(entries);
  const content = {
    kind: "napier.execution-plan-blueprint-portfolio-calibration" as const,
    schemaVersion: 1 as const,
    apiVersion: NAPIER_API_VERSION,
    recordCount: entries.length,
    activeCount: entries.filter((entry) => entry.recordStatus === "active")
      .length,
    archivedCount: entries.filter((entry) => entry.recordStatus === "archived")
      .length,
    familyCount: families.length,
    sourceQualifiedCount: entries.filter(
      (entry) => entry.sourceQualificationStatus === "qualified",
    ).length,
    outcomeQualifiedCount: entries.filter(
      (entry) => entry.outcomeQualificationStatus === "qualified",
    ).length,
    reviewedBaselineCount: entries.filter((entry) => entry.reviewedBaseline)
      .length,
    missingBaselineCount: entries.filter(
      (entry) => entry.outcomeQualificationStatus === "missing_baseline",
    ).length,
    policyFailedCount: entries.filter(
      (entry) => entry.outcomeQualificationStatus === "policy_failed",
    ).length,
    portfolioSetSha256: executionPlanBlueprintPortfolioSetSha256(entries),
    families,
  };
  return {
    ...content,
    generatedAt: nowIso(),
    contentSha256: sha256(canonicalJson(content)),
  };
}

function createExecutionPlanBlueprintRecommendationPolicyOverrideDriftReview(input: {
  entries: ExecutionPlanBlueprintPortfolioCalibrationEntry[];
  families: ExecutionPlanBlueprintPortfolioCalibrationFamily[];
  overrides: ExecutionPlanBlueprintRecommendationPolicyOverride[];
  policies: ExecutionPlanBlueprintRecommendationPolicy[];
  portfolioSetSha256: string;
}): ExecutionPlanBlueprintRecommendationPolicyOverrideDriftReview {
  const overrides = input.overrides
    .map(validateExecutionPlanBlueprintRecommendationPolicyOverride)
    .sort((left, right) => left.familySha256.localeCompare(right.familySha256));
  const reviews = overrides.map((override) =>
    createExecutionPlanBlueprintRecommendationPolicyOverrideDriftReviewItem({
      entries: input.entries,
      families: input.families,
      override,
      policies: input.policies,
    }),
  );
  const content = {
    kind: "napier.execution-plan-blueprint-recommendation-policy-override-drift-review" as const,
    schemaVersion: 1 as const,
    apiVersion: NAPIER_API_VERSION,
    overrideCount: reviews.length,
    alignedCount: reviews.filter((review) => review.status === "aligned")
      .length,
    retireRecommendedCount: reviews.filter(
      (review) => review.recommendation === "retire",
    ).length,
    missingFamilyCount: reviews.filter(
      (review) => review.status === "family_missing",
    ).length,
    portfolioSetSha256: input.portfolioSetSha256,
    overrideSetSha256:
      executionPlanBlueprintRecommendationPolicyOverrideSetSha256(overrides),
    reviewSetSha256:
      executionPlanBlueprintRecommendationPolicyOverrideDriftReviewSetSha256(
        reviews,
      ),
    reviews,
  };
  return {
    ...content,
    generatedAt: nowIso(),
    contentSha256: sha256(canonicalJson(content)),
  };
}

function createExecutionPlanBlueprintRecommendationPolicyOverrideDriftReviewItem(input: {
  entries: ExecutionPlanBlueprintPortfolioCalibrationEntry[];
  families: ExecutionPlanBlueprintPortfolioCalibrationFamily[];
  override: ExecutionPlanBlueprintRecommendationPolicyOverride;
  policies: ExecutionPlanBlueprintRecommendationPolicy[];
}): ExecutionPlanBlueprintRecommendationPolicyOverrideDriftReviewItem {
  const family = input.families.find(
    (candidate) => candidate.familySha256 === input.override.familySha256,
  );
  if (!family) {
    return createExecutionPlanBlueprintRecommendationPolicyOverrideDriftReviewContent(
      {
        familySha256: input.override.familySha256,
        overrideSha256: input.override.contentSha256,
        status: "family_missing",
        recommendation: "retire",
        diagnostics: ["family_missing"],
        overridePolicyTemplate: input.override.recommendationPolicy.templateId,
        overridePolicySha256: input.override.recommendationPolicySha256,
      },
    );
  }
  const familyEntries = input.entries.filter(
    (entry) => entry.familySha256 === family.familySha256,
  );
  const familyResults = input.policies.map((policy) =>
    createExecutionPlanBlueprintRecommendationPolicyBacktestResult({
      entries: familyEntries,
      families: [family],
      policy,
    }),
  );
  const best = [...familyResults].sort(
    compareExecutionPlanBlueprintRecommendationPolicyBacktestResults,
  )[0];
  const overrideResult = familyResults.find(
    (result) =>
      result.recommendationPolicy.templateId ===
      input.override.recommendationPolicy.templateId,
  );
  const diagnostics = uniqueStrings([
    ...(best?.selectedRecordId ? [] : ["no_qualified_candidate"]),
    ...(best &&
    best.recommendationPolicy.templateId !==
      input.override.recommendationPolicy.templateId
      ? ["override_policy_not_best"]
      : []),
    ...(overrideResult?.selectedRecordId &&
    best?.selectedRecordId &&
    overrideResult.selectedRecordId !== best.selectedRecordId
      ? ["override_selected_record_differs"]
      : []),
  ]);
  const aligned = diagnostics.length === 0;
  return createExecutionPlanBlueprintRecommendationPolicyOverrideDriftReviewContent(
    {
      familySha256: input.override.familySha256,
      overrideSha256: input.override.contentSha256,
      status: aligned ? "aligned" : "retire_recommended",
      recommendation: aligned ? "keep" : "retire",
      diagnostics,
      overridePolicyTemplate: input.override.recommendationPolicy.templateId,
      overridePolicySha256: input.override.recommendationPolicySha256,
      ...(overrideResult?.selectedRecordId
        ? { overrideSelectedRecordId: overrideResult.selectedRecordId }
        : {}),
      ...(overrideResult?.selectedRecommendationScoreBps !== undefined
        ? {
            overrideSelectedRecommendationScoreBps:
              overrideResult.selectedRecommendationScoreBps,
          }
        : {}),
      ...(best
        ? { bestPolicyTemplate: best.recommendationPolicy.templateId }
        : {}),
      ...(best ? { bestPolicySha256: best.recommendationPolicySha256 } : {}),
      ...(best?.selectedRecordId
        ? { bestSelectedRecordId: best.selectedRecordId }
        : {}),
      ...(best?.selectedRecommendationScoreBps !== undefined
        ? {
            bestSelectedRecommendationScoreBps:
              best.selectedRecommendationScoreBps,
          }
        : {}),
      familyRecordCount: family.recordCount,
      familyOutcomeQualifiedCount: family.outcomeQualifiedCount,
      familyCompletionRateBps: family.completionRateBps,
    },
  );
}

function createExecutionPlanBlueprintRecommendationPolicyOverrideDriftReviewContent(
  content: Omit<
    ExecutionPlanBlueprintRecommendationPolicyOverrideDriftReviewItem,
    "reviewSha256"
  >,
): ExecutionPlanBlueprintRecommendationPolicyOverrideDriftReviewItem {
  return {
    ...content,
    reviewSha256: sha256(canonicalJson(content)),
  };
}

function createExecutionPlanBlueprintRecommendationPolicyOverrideRetirementResult(input: {
  override: ExecutionPlanBlueprintRecommendationPolicyOverride;
  portfolioSetSha256: string;
  overrideSetSha256: string;
  driftReviewSetSha256: string;
  remainingOverrideSetSha256: string;
  retiredAt: string;
}): RetireExecutionPlanBlueprintRecommendationPolicyOverrideResult {
  const content = {
    kind: "napier.execution-plan-blueprint-recommendation-policy-override-retirement" as const,
    schemaVersion: 1 as const,
    apiVersion: NAPIER_API_VERSION,
    familySha256: input.override.familySha256,
    retiredOverrideSha256: input.override.contentSha256,
    retiredRecommendationPolicyTemplate:
      input.override.recommendationPolicy.templateId,
    retiredRecommendationPolicySha256:
      input.override.recommendationPolicySha256,
    portfolioSetSha256: input.portfolioSetSha256,
    overrideSetSha256: input.overrideSetSha256,
    driftReviewSetSha256: input.driftReviewSetSha256,
    remainingOverrideSetSha256: input.remainingOverrideSetSha256,
    retiredAt: input.retiredAt,
  };
  return {
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  };
}

function validateExecutionPlanBlueprintRecommendationPolicyOverrideRetirementResult(
  value: unknown,
): RetireExecutionPlanBlueprintRecommendationPolicyOverrideResult {
  if (!isRecord(value)) {
    throw new Error(
      "Execution Plan blueprint recommendation policy override retirement is invalid",
    );
  }
  const retirement =
    value as unknown as RetireExecutionPlanBlueprintRecommendationPolicyOverrideResult;
  if (
    retirement.kind !==
      "napier.execution-plan-blueprint-recommendation-policy-override-retirement" ||
    retirement.schemaVersion !== 1 ||
    retirement.apiVersion !== NAPIER_API_VERSION ||
    !isSha256(retirement.familySha256) ||
    !isSha256(retirement.retiredOverrideSha256) ||
    (retirement.retiredRecommendationPolicyTemplate !== "balanced" &&
      retirement.retiredRecommendationPolicyTemplate !== "delivery_first" &&
      retirement.retiredRecommendationPolicyTemplate !== "portfolio_first") ||
    !isSha256(retirement.retiredRecommendationPolicySha256) ||
    !isSha256(retirement.portfolioSetSha256) ||
    !isSha256(retirement.overrideSetSha256) ||
    !isSha256(retirement.driftReviewSetSha256) ||
    !isSha256(retirement.remainingOverrideSetSha256) ||
    !Number.isFinite(Date.parse(retirement.retiredAt)) ||
    !isSha256(retirement.contentSha256)
  ) {
    throw new Error(
      "Execution Plan blueprint recommendation policy override retirement is invalid",
    );
  }
  const { contentSha256: _contentSha256, ...content } = retirement;
  if (sha256(canonicalJson(content)) !== retirement.contentSha256) {
    throw new Error(
      "Execution Plan blueprint recommendation policy override retirement hash mismatch",
    );
  }
  return structuredClone(retirement);
}

function createExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistory(input: {
  retirements: RetireExecutionPlanBlueprintRecommendationPolicyOverrideResult[];
  portfolioSetSha256: string;
  currentOverrideSetSha256: string;
}): ExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistory {
  const retirements = input.retirements
    .map(
      validateExecutionPlanBlueprintRecommendationPolicyOverrideRetirementResult,
    )
    .sort(compareExecutionPlanBlueprintRecommendationPolicyOverrideRetirements);
  const latest = retirements.at(-1);
  const content = {
    kind: "napier.execution-plan-blueprint-recommendation-policy-override-retirement-history" as const,
    schemaVersion: 1 as const,
    apiVersion: NAPIER_API_VERSION,
    retirementCount: retirements.length,
    portfolioSetSha256: input.portfolioSetSha256,
    currentOverrideSetSha256: input.currentOverrideSetSha256,
    retirementSetSha256:
      executionPlanBlueprintRecommendationPolicyOverrideRetirementSetSha256(
        retirements,
      ),
    ...(latest ? { latestRetiredAt: latest.retiredAt } : {}),
    retirements,
  };
  return {
    ...content,
    generatedAt: nowIso(),
    contentSha256: sha256(canonicalJson(content)),
  };
}

function verifyExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryProjection(
  input: unknown,
  observed: ExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistory,
): ExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryVerification {
  const diagnostics: string[] = [];
  const record = isRecord(input) ? input : undefined;
  if (!record) diagnostics.push("history_not_object");
  const declaredContentSha256 = isSha256(record?.["contentSha256"])
    ? record["contentSha256"]
    : undefined;
  const recomputedContentSha256 = record
    ? sha256(canonicalJson(retirementHistoryHashContent(record)))
    : undefined;
  const declaredPortfolioSetSha256 = isSha256(record?.["portfolioSetSha256"])
    ? record["portfolioSetSha256"]
    : undefined;
  const declaredCurrentOverrideSetSha256 = isSha256(
    record?.["currentOverrideSetSha256"],
  )
    ? record["currentOverrideSetSha256"]
    : undefined;
  const declaredRetirementSetSha256 = isSha256(record?.["retirementSetSha256"])
    ? record["retirementSetSha256"]
    : undefined;
  const retirementCount = isNonNegativeInteger(record?.["retirementCount"])
    ? record["retirementCount"]
    : undefined;
  const latestRetiredAt =
    typeof record?.["latestRetiredAt"] === "string" &&
    Number.isFinite(Date.parse(record["latestRetiredAt"]))
      ? record["latestRetiredAt"]
      : undefined;
  let recomputedRetirementSetSha256: string | undefined;
  if (record && !Array.isArray(record["retirements"])) {
    diagnostics.push("retirements_not_array");
  } else if (Array.isArray(record?.["retirements"])) {
    try {
      recomputedRetirementSetSha256 =
        executionPlanBlueprintRecommendationPolicyOverrideRetirementSetSha256(
          record["retirements"].map(
            validateExecutionPlanBlueprintRecommendationPolicyOverrideRetirementResult,
          ),
        );
    } catch {
      diagnostics.push("retirements_invalid");
    }
  }
  if (
    record?.["kind"] !==
    "napier.execution-plan-blueprint-recommendation-policy-override-retirement-history"
  ) {
    diagnostics.push("kind_mismatch");
  }
  if (record?.["schemaVersion"] !== 1) diagnostics.push("schema_mismatch");
  if (record?.["apiVersion"] !== NAPIER_API_VERSION) {
    diagnostics.push("api_version_mismatch");
  }
  if (!declaredContentSha256) diagnostics.push("content_hash_missing");
  if (
    declaredContentSha256 &&
    recomputedContentSha256 &&
    declaredContentSha256 !== recomputedContentSha256
  ) {
    diagnostics.push("content_hash_mismatch");
  }
  if (
    declaredContentSha256 &&
    declaredContentSha256 !== observed.contentSha256
  ) {
    diagnostics.push("current_history_mismatch");
  }
  if (!declaredPortfolioSetSha256) diagnostics.push("portfolio_set_missing");
  if (declaredPortfolioSetSha256 !== observed.portfolioSetSha256) {
    diagnostics.push("portfolio_set_mismatch");
  }
  if (!declaredCurrentOverrideSetSha256) {
    diagnostics.push("current_override_set_missing");
  }
  if (declaredCurrentOverrideSetSha256 !== observed.currentOverrideSetSha256) {
    diagnostics.push("current_override_set_mismatch");
  }
  if (!declaredRetirementSetSha256) diagnostics.push("retirement_set_missing");
  if (
    declaredRetirementSetSha256 &&
    recomputedRetirementSetSha256 &&
    declaredRetirementSetSha256 !== recomputedRetirementSetSha256
  ) {
    diagnostics.push("retirement_set_hash_mismatch");
  }
  if (declaredRetirementSetSha256 !== observed.retirementSetSha256) {
    diagnostics.push("retirement_set_mismatch");
  }
  if (retirementCount !== observed.retirementCount) {
    diagnostics.push("retirement_count_mismatch");
  }
  if (record?.["latestRetiredAt"] !== undefined && !latestRetiredAt) {
    diagnostics.push("latest_retired_at_invalid");
  }
  if (latestRetiredAt !== observed.latestRetiredAt) {
    diagnostics.push("latest_retired_at_mismatch");
  }
  const status: ExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryVerification["status"] =
    diagnostics.length === 0 ? "valid" : "invalid";
  const content = {
    kind: "napier.execution-plan-blueprint-recommendation-policy-override-retirement-history-verification" as const,
    schemaVersion: 1 as const,
    apiVersion: NAPIER_API_VERSION,
    status,
    diagnostics,
    ...(declaredContentSha256 ? { declaredContentSha256 } : {}),
    ...(recomputedContentSha256 ? { recomputedContentSha256 } : {}),
    observedContentSha256: observed.contentSha256,
    ...(declaredPortfolioSetSha256 ? { declaredPortfolioSetSha256 } : {}),
    observedPortfolioSetSha256: observed.portfolioSetSha256,
    ...(declaredCurrentOverrideSetSha256
      ? { declaredCurrentOverrideSetSha256 }
      : {}),
    observedCurrentOverrideSetSha256: observed.currentOverrideSetSha256,
    ...(declaredRetirementSetSha256 ? { declaredRetirementSetSha256 } : {}),
    ...(recomputedRetirementSetSha256 ? { recomputedRetirementSetSha256 } : {}),
    observedRetirementSetSha256: observed.retirementSetSha256,
    ...(retirementCount !== undefined ? { retirementCount } : {}),
    observedRetirementCount: observed.retirementCount,
    ...(latestRetiredAt ? { latestRetiredAt } : {}),
    ...(observed.latestRetiredAt
      ? { observedLatestRetiredAt: observed.latestRetiredAt }
      : {}),
  };
  return {
    ...content,
    generatedAt: nowIso(),
    contentSha256: sha256(canonicalJson(content)),
  };
}

function createExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryProofBundle(
  histories: unknown[],
): ExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryProofBundle {
  const proofItems = histories.map((history, index) =>
    createExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryProofBundleItem(
      history,
      index,
    ),
  );
  const validItems = proofItems.filter((item) => item.status === "valid");
  const validContentHashes = validItems
    .map((item) => item.declaredContentSha256)
    .filter(isSha256);
  const validPortfolioSetHashes = validItems
    .map((item) => item.declaredPortfolioSetSha256)
    .filter(isSha256);
  const validCurrentOverrideSetHashes = validItems
    .map((item) => item.declaredCurrentOverrideSetSha256)
    .filter(isSha256);
  const validRetirementSetHashes = validItems
    .map((item) => item.declaredRetirementSetSha256)
    .filter(isSha256);
  const distinctHistoryCount = new Set(validContentHashes).size;
  const distinctPortfolioSetCount = new Set(validPortfolioSetHashes).size;
  const distinctCurrentOverrideSetCount = new Set(validCurrentOverrideSetHashes)
    .size;
  const distinctRetirementSetCount = new Set(validRetirementSetHashes).size;
  const diagnostics: string[] = [];
  if (histories.length < 2) diagnostics.push("history_count_below_min");
  if (proofItems.length !== validItems.length) {
    diagnostics.push("histories_invalid");
  }
  if (distinctPortfolioSetCount > 1)
    diagnostics.push("portfolio_set_divergent");
  if (distinctCurrentOverrideSetCount > 1) {
    diagnostics.push("current_override_set_divergent");
  }
  if (distinctRetirementSetCount > 1) {
    diagnostics.push("retirement_set_divergent");
  }
  const status: ExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryProofBundle["status"] =
    histories.length < 2 || proofItems.length !== validItems.length
      ? "invalid"
      : diagnostics.length > 0
        ? "divergent"
        : "aligned";
  const content = {
    kind: "napier.execution-plan-blueprint-recommendation-policy-override-retirement-history-proof-bundle" as const,
    schemaVersion: 1 as const,
    apiVersion: NAPIER_API_VERSION,
    status,
    diagnostics,
    historyCount: proofItems.length,
    validHistoryCount: validItems.length,
    invalidHistoryCount: proofItems.length - validItems.length,
    distinctHistoryCount,
    distinctPortfolioSetCount,
    distinctCurrentOverrideSetCount,
    distinctRetirementSetCount,
    historySetSha256:
      executionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryBundleSetSha256(
        validContentHashes,
      ),
    portfolioSetBundleSha256:
      executionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryBundleSetSha256(
        validPortfolioSetHashes,
      ),
    currentOverrideSetBundleSha256:
      executionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryBundleSetSha256(
        validCurrentOverrideSetHashes,
      ),
    retirementSetBundleSha256:
      executionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryBundleSetSha256(
        validRetirementSetHashes,
      ),
    histories: proofItems,
  };
  return {
    ...content,
    generatedAt: nowIso(),
    contentSha256: sha256(canonicalJson(content)),
  };
}

function createExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryProofBundleItem(
  input: unknown,
  index: number,
): ExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryProofBundleItem {
  const diagnostics: string[] = [];
  const record = isRecord(input) ? input : undefined;
  if (!record) diagnostics.push("history_not_object");
  const declaredContentSha256 = isSha256(record?.["contentSha256"])
    ? record["contentSha256"]
    : undefined;
  const recomputedContentSha256 = record
    ? sha256(canonicalJson(retirementHistoryHashContent(record)))
    : undefined;
  const declaredPortfolioSetSha256 = isSha256(record?.["portfolioSetSha256"])
    ? record["portfolioSetSha256"]
    : undefined;
  const declaredCurrentOverrideSetSha256 = isSha256(
    record?.["currentOverrideSetSha256"],
  )
    ? record["currentOverrideSetSha256"]
    : undefined;
  const declaredRetirementSetSha256 = isSha256(record?.["retirementSetSha256"])
    ? record["retirementSetSha256"]
    : undefined;
  const retirementCount = isNonNegativeInteger(record?.["retirementCount"])
    ? record["retirementCount"]
    : undefined;
  const latestRetiredAt =
    typeof record?.["latestRetiredAt"] === "string" &&
    Number.isFinite(Date.parse(record["latestRetiredAt"]))
      ? record["latestRetiredAt"]
      : undefined;
  let recomputedRetirementSetSha256: string | undefined;
  let recomputedRetirementCount: number | undefined;
  let recomputedLatestRetiredAt: string | undefined;
  if (record && !Array.isArray(record["retirements"])) {
    diagnostics.push("retirements_not_array");
  } else if (Array.isArray(record?.["retirements"])) {
    try {
      const retirements = record["retirements"]
        .map(
          validateExecutionPlanBlueprintRecommendationPolicyOverrideRetirementResult,
        )
        .sort(
          compareExecutionPlanBlueprintRecommendationPolicyOverrideRetirements,
        );
      recomputedRetirementSetSha256 =
        executionPlanBlueprintRecommendationPolicyOverrideRetirementSetSha256(
          retirements,
        );
      recomputedRetirementCount = retirements.length;
      recomputedLatestRetiredAt = retirements.at(-1)?.retiredAt;
    } catch {
      diagnostics.push("retirements_invalid");
    }
  }
  if (
    record?.["kind"] !==
    "napier.execution-plan-blueprint-recommendation-policy-override-retirement-history"
  ) {
    diagnostics.push("kind_mismatch");
  }
  if (record?.["schemaVersion"] !== 1) diagnostics.push("schema_mismatch");
  if (record?.["apiVersion"] !== NAPIER_API_VERSION) {
    diagnostics.push("api_version_mismatch");
  }
  if (!declaredContentSha256) diagnostics.push("content_hash_missing");
  if (
    declaredContentSha256 &&
    recomputedContentSha256 &&
    declaredContentSha256 !== recomputedContentSha256
  ) {
    diagnostics.push("content_hash_mismatch");
  }
  if (!declaredPortfolioSetSha256) diagnostics.push("portfolio_set_missing");
  if (!declaredCurrentOverrideSetSha256) {
    diagnostics.push("current_override_set_missing");
  }
  if (!declaredRetirementSetSha256) diagnostics.push("retirement_set_missing");
  if (
    declaredRetirementSetSha256 &&
    recomputedRetirementSetSha256 &&
    declaredRetirementSetSha256 !== recomputedRetirementSetSha256
  ) {
    diagnostics.push("retirement_set_hash_mismatch");
  }
  if (
    retirementCount !== undefined &&
    recomputedRetirementCount !== undefined &&
    retirementCount !== recomputedRetirementCount
  ) {
    diagnostics.push("retirement_count_mismatch");
  }
  if (record?.["latestRetiredAt"] !== undefined && !latestRetiredAt) {
    diagnostics.push("latest_retired_at_invalid");
  }
  if (latestRetiredAt !== recomputedLatestRetiredAt) {
    diagnostics.push("latest_retired_at_mismatch");
  }
  const status: ExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryProofBundleItem["status"] =
    diagnostics.length === 0 ? "valid" : "invalid";
  const content = {
    index,
    status,
    diagnostics,
    ...(declaredContentSha256 ? { declaredContentSha256 } : {}),
    ...(recomputedContentSha256 ? { recomputedContentSha256 } : {}),
    ...(declaredPortfolioSetSha256 ? { declaredPortfolioSetSha256 } : {}),
    ...(declaredCurrentOverrideSetSha256
      ? { declaredCurrentOverrideSetSha256 }
      : {}),
    ...(declaredRetirementSetSha256 ? { declaredRetirementSetSha256 } : {}),
    ...(recomputedRetirementSetSha256 ? { recomputedRetirementSetSha256 } : {}),
    ...(retirementCount !== undefined ? { retirementCount } : {}),
    ...(recomputedRetirementCount !== undefined
      ? { recomputedRetirementCount }
      : {}),
    ...(latestRetiredAt ? { latestRetiredAt } : {}),
    ...(recomputedLatestRetiredAt ? { recomputedLatestRetiredAt } : {}),
  };
  return {
    ...content,
    itemSha256: sha256(canonicalJson(content)),
  };
}

function executionPlanBlueprintPortfolioSetSha256(
  entries: ExecutionPlanBlueprintPortfolioCalibrationEntry[],
): string {
  return sha256(
    canonicalJson(
      entries.map((entry) => ({
        recordId: entry.recordId,
        recordStatus: entry.recordStatus,
        familySha256: entry.familySha256,
        blueprintSha256: entry.blueprintSha256,
        sourceQualificationStatus: entry.sourceQualificationStatus,
        outcomeQualificationStatus: entry.outcomeQualificationStatus,
        ...(entry.baselineSha256
          ? { baselineSha256: entry.baselineSha256 }
          : {}),
        reviewedBaseline: entry.reviewedBaseline,
        currentOutcomesSha256: entry.currentOutcomesSha256,
        currentOutcomeSetSha256: entry.currentOutcomeSetSha256,
        replayCount: entry.replayCount,
        completedCount: entry.completedCount,
        blockedCount: entry.blockedCount,
        invalidCount: entry.invalidCount,
        completionRateBps: entry.completionRateBps,
      })),
    ),
  );
}

function createExecutionPlanBlueprintRecommendationPolicyBacktest(input: {
  entries: ExecutionPlanBlueprintPortfolioCalibrationEntry[];
  families: ExecutionPlanBlueprintPortfolioCalibrationFamily[];
  policies: ExecutionPlanBlueprintRecommendationPolicy[];
  portfolioSetSha256: string;
}): ExecutionPlanBlueprintRecommendationPolicyBacktest {
  const results = input.policies.map((policy) =>
    createExecutionPlanBlueprintRecommendationPolicyBacktestResult({
      entries: input.entries,
      families: input.families,
      policy,
    }),
  );
  const referenceRecordId = results[0]?.selectedRecordId;
  const content = {
    kind: "napier.execution-plan-blueprint-recommendation-policy-backtest" as const,
    schemaVersion: 1 as const,
    apiVersion: NAPIER_API_VERSION,
    recordCount: input.entries.length,
    activeCount: input.entries.filter(
      (entry) => entry.recordStatus === "active",
    ).length,
    policyCount: results.length,
    divergentSelectionCount: results.filter(
      (result) => result.selectedRecordId !== referenceRecordId,
    ).length,
    portfolioSetSha256: input.portfolioSetSha256,
    policySetSha256: executionPlanBlueprintRecommendationPolicySetSha256(
      input.policies,
    ),
    results,
  };
  return {
    ...content,
    generatedAt: nowIso(),
    contentSha256: sha256(canonicalJson(content)),
  };
}

function createExecutionPlanBlueprintRecommendationPolicyBacktestResult(input: {
  entries: ExecutionPlanBlueprintPortfolioCalibrationEntry[];
  families: ExecutionPlanBlueprintPortfolioCalibrationFamily[];
  policy: ExecutionPlanBlueprintRecommendationPolicy;
}): ExecutionPlanBlueprintRecommendationPolicyBacktestResult {
  const familyBySha256 = new Map(
    input.families.map((family) => [family.familySha256, family]),
  );
  const candidates = input.entries.map((entry) => {
    const family = familyBySha256.get(entry.familySha256);
    if (!family) {
      throw new Error("Execution plan blueprint portfolio family missing");
    }
    return createExecutionPlanBlueprintRecommendationPolicyBacktestCandidate({
      entry,
      family,
      policy: input.policy,
    });
  });
  const selected = candidates
    .filter((candidate) => candidate.selectionStatus === "qualified")
    .sort(compareExecutionPlanBlueprintRecommendationPolicyBacktestCandidates)
    .at(0);
  const selectedCandidates = candidates
    .map((candidate) =>
      selected && candidate.recordId === selected.recordId
        ? { ...candidate, selectionStatus: "selected" as const }
        : candidate,
    )
    .sort(compareExecutionPlanBlueprintRecommendationPolicyBacktestCandidates);
  const qualifiedCandidates = selectedCandidates.filter(
    (candidate) =>
      candidate.selectionStatus === "qualified" ||
      candidate.selectionStatus === "selected",
  );
  const recommendationScoreTotal = qualifiedCandidates.reduce(
    (total, candidate) => total + candidate.recommendationScoreBps,
    0,
  );
  return {
    recommendationPolicy: input.policy,
    recommendationPolicySha256:
      executionPlanBlueprintRecommendationPolicySha256(input.policy),
    candidateCount: selectedCandidates.length,
    qualifiedCandidateCount: qualifiedCandidates.length,
    rejectedCandidateCount: selectedCandidates.filter(
      (candidate) => candidate.selectionStatus === "rejected",
    ).length,
    ...(selected ? { selectedRecordId: selected.recordId } : {}),
    ...(selected ? { selectedFamilySha256: selected.familySha256 } : {}),
    ...(selected
      ? { selectedRecommendationScoreBps: selected.recommendationScoreBps }
      : {}),
    averageRecommendationScoreBps:
      qualifiedCandidates.length > 0
        ? Math.round(recommendationScoreTotal / qualifiedCandidates.length)
        : 0,
    candidates: selectedCandidates,
  };
}

function createExecutionPlanBlueprintRecommendationPolicyBacktestCandidate(input: {
  entry: ExecutionPlanBlueprintPortfolioCalibrationEntry;
  family: ExecutionPlanBlueprintPortfolioCalibrationFamily;
  policy: ExecutionPlanBlueprintRecommendationPolicy;
}): ExecutionPlanBlueprintRecommendationPolicyBacktestCandidate {
  const ready =
    input.entry.recordStatus === "active" &&
    input.entry.sourceQualificationStatus === "qualified" &&
    input.entry.outcomeQualificationStatus === "qualified";
  const diagnostics = uniqueStrings([
    ...(input.entry.recordStatus === "active" ? [] : ["record_archived"]),
    ...(input.entry.sourceQualificationStatus === "qualified"
      ? []
      : [`source_${input.entry.sourceQualificationStatus}`]),
    ...input.entry.sourceDiagnostics.map(
      (diagnostic) => `source_${diagnostic}`,
    ),
    ...(input.entry.outcomeQualificationStatus === "qualified"
      ? []
      : [`outcome_${input.entry.outcomeQualificationStatus}`]),
    ...input.entry.outcomeDiagnostics.map(
      (diagnostic) => `outcome_${diagnostic}`,
    ),
  ]);
  const reviewedBaselineCoverageBps =
    executionPlanBlueprintFamilyReviewedBaselineCoverageBps(input.family);
  const replayEvidenceBps = executionPlanBlueprintReplayEvidenceBps(
    input.entry.replayCount,
  );
  return {
    recordId: input.entry.recordId,
    recordStatus: input.entry.recordStatus,
    recordUpdatedAt: input.entry.recordUpdatedAt,
    selectionStatus: ready ? "qualified" : "rejected",
    diagnostics,
    familySha256: input.entry.familySha256,
    sourceQualificationStatus: input.entry.sourceQualificationStatus,
    outcomeQualificationStatus: input.entry.outcomeQualificationStatus,
    familyRecordCount: input.family.recordCount,
    familyCompletionRateBps: input.family.completionRateBps,
    familyReviewedBaselineCount: input.family.reviewedBaselineCount,
    reviewedBaselineCoverageBps,
    replayEvidenceBps,
    recommendationScoreBps: ready
      ? executionPlanBlueprintRecommendationScoreBps({
          outcomeCompletionBps: input.entry.completionRateBps,
          familyCompletionBps: input.family.completionRateBps,
          reviewedBaselineCoverageBps,
          replayEvidenceBps,
          policy: input.policy,
        })
      : 0,
    replayCount: input.entry.replayCount,
    completedCount: input.entry.completedCount,
    blockedCount: input.entry.blockedCount,
    invalidCount: input.entry.invalidCount,
    completionRateBps: input.entry.completionRateBps,
    currentOutcomesSha256: input.entry.currentOutcomesSha256,
    currentOutcomeSetSha256: input.entry.currentOutcomeSetSha256,
  };
}

function compareExecutionPlanBlueprintRecommendationPolicyBacktestCandidates(
  left: ExecutionPlanBlueprintRecommendationPolicyBacktestCandidate,
  right: ExecutionPlanBlueprintRecommendationPolicyBacktestCandidate,
): number {
  const statusOrder =
    executionPlanBlueprintRecommendationPolicyBacktestStatusRank(right) -
    executionPlanBlueprintRecommendationPolicyBacktestStatusRank(left);
  if (statusOrder !== 0) return statusOrder;
  const recommendationOrder =
    right.recommendationScoreBps - left.recommendationScoreBps;
  if (recommendationOrder !== 0) return recommendationOrder;
  const completionOrder = right.completionRateBps - left.completionRateBps;
  if (completionOrder !== 0) return completionOrder;
  const familyCompletionOrder =
    right.familyCompletionRateBps - left.familyCompletionRateBps;
  if (familyCompletionOrder !== 0) return familyCompletionOrder;
  const reviewedOrder =
    right.familyReviewedBaselineCount - left.familyReviewedBaselineCount;
  if (reviewedOrder !== 0) return reviewedOrder;
  const replayOrder = right.replayCount - left.replayCount;
  if (replayOrder !== 0) return replayOrder;
  const completedOrder = right.completedCount - left.completedCount;
  if (completedOrder !== 0) return completedOrder;
  const recordOrder = right.recordUpdatedAt.localeCompare(left.recordUpdatedAt);
  if (recordOrder !== 0) return recordOrder;
  return left.recordId.localeCompare(right.recordId);
}

function executionPlanBlueprintRecommendationPolicyBacktestStatusRank(
  candidate: ExecutionPlanBlueprintRecommendationPolicyBacktestCandidate,
): number {
  if (candidate.selectionStatus === "selected") return 2;
  if (candidate.selectionStatus === "qualified") return 1;
  return 0;
}

function compareExecutionPlanBlueprintRecommendationPolicyBacktestResults(
  left: ExecutionPlanBlueprintRecommendationPolicyBacktestResult,
  right: ExecutionPlanBlueprintRecommendationPolicyBacktestResult,
): number {
  const selectedScoreOrder =
    (right.selectedRecommendationScoreBps ?? -1) -
    (left.selectedRecommendationScoreBps ?? -1);
  if (selectedScoreOrder !== 0) return selectedScoreOrder;
  const averageScoreOrder =
    right.averageRecommendationScoreBps - left.averageRecommendationScoreBps;
  if (averageScoreOrder !== 0) return averageScoreOrder;
  const qualifiedOrder =
    right.qualifiedCandidateCount - left.qualifiedCandidateCount;
  if (qualifiedOrder !== 0) return qualifiedOrder;
  const candidateOrder = right.candidateCount - left.candidateCount;
  if (candidateOrder !== 0) return candidateOrder;
  return left.recommendationPolicy.templateId.localeCompare(
    right.recommendationPolicy.templateId,
  );
}

function compareExecutionPlanBlueprintRecommendationPolicyOverrideRetirements(
  left: RetireExecutionPlanBlueprintRecommendationPolicyOverrideResult,
  right: RetireExecutionPlanBlueprintRecommendationPolicyOverrideResult,
): number {
  const retiredOrder = left.retiredAt.localeCompare(right.retiredAt);
  if (retiredOrder !== 0) return retiredOrder;
  return left.contentSha256.localeCompare(right.contentSha256);
}

function createExecutionPlanBlueprintPortfolioCalibrationFamilies(
  entries: ExecutionPlanBlueprintPortfolioCalibrationEntry[],
): ExecutionPlanBlueprintPortfolioCalibrationFamily[] {
  const byFamily = new Map<
    string,
    ExecutionPlanBlueprintPortfolioCalibrationEntry[]
  >();
  for (const entry of entries) {
    const current = byFamily.get(entry.familySha256) ?? [];
    current.push(entry);
    byFamily.set(entry.familySha256, current);
  }
  return [...byFamily.entries()]
    .map(([familySha256, familyEntries]) =>
      createExecutionPlanBlueprintPortfolioCalibrationFamily(
        familySha256,
        familyEntries,
      ),
    )
    .sort((left, right) => {
      const qualifiedOrder =
        right.outcomeQualifiedCount - left.outcomeQualifiedCount;
      if (qualifiedOrder !== 0) return qualifiedOrder;
      const replayOrder = right.replayCount - left.replayCount;
      if (replayOrder !== 0) return replayOrder;
      return left.familySha256.localeCompare(right.familySha256);
    });
}

function createExecutionPlanBlueprintPortfolioCalibrationFamily(
  familySha256: string,
  entries: ExecutionPlanBlueprintPortfolioCalibrationEntry[],
): ExecutionPlanBlueprintPortfolioCalibrationFamily {
  const replayCount = entries.reduce(
    (total, entry) => total + entry.replayCount,
    0,
  );
  const completedCount = entries.reduce(
    (total, entry) => total + entry.completedCount,
    0,
  );
  const top = entries
    .filter(
      (entry) =>
        entry.recordStatus === "active" &&
        entry.sourceQualificationStatus === "qualified" &&
        entry.outcomeQualificationStatus === "qualified",
    )
    .sort(compareExecutionPlanBlueprintPortfolioEntries)
    .at(0);
  const latestBaseline = entries
    .filter((entry) => entry.baselineSha256 && entry.baselinePromotedAt)
    .sort((left, right) =>
      (right.baselinePromotedAt ?? "").localeCompare(
        left.baselinePromotedAt ?? "",
      ),
    )
    .at(0);
  return {
    familySha256,
    recordCount: entries.length,
    activeCount: entries.filter((entry) => entry.recordStatus === "active")
      .length,
    archivedCount: entries.filter((entry) => entry.recordStatus === "archived")
      .length,
    sourceQualifiedCount: entries.filter(
      (entry) => entry.sourceQualificationStatus === "qualified",
    ).length,
    outcomeQualifiedCount: entries.filter(
      (entry) => entry.outcomeQualificationStatus === "qualified",
    ).length,
    reviewedBaselineCount: entries.filter((entry) => entry.reviewedBaseline)
      .length,
    replayCount,
    completedCount,
    blockedCount: entries.reduce(
      (total, entry) => total + entry.blockedCount,
      0,
    ),
    invalidCount: entries.reduce(
      (total, entry) => total + entry.invalidCount,
      0,
    ),
    completionRateBps:
      replayCount > 0 ? Math.round((completedCount / replayCount) * 10_000) : 0,
    ...(top ? { topRecordId: top.recordId } : {}),
    ...(top ? { topRecordScoreBps: top.completionRateBps } : {}),
    ...(latestBaseline?.baselineSha256
      ? { latestBaselineSha256: latestBaseline.baselineSha256 }
      : {}),
  };
}

function compareExecutionPlanBlueprintPortfolioEntries(
  left: ExecutionPlanBlueprintPortfolioCalibrationEntry,
  right: ExecutionPlanBlueprintPortfolioCalibrationEntry,
): number {
  const scoreOrder = right.completionRateBps - left.completionRateBps;
  if (scoreOrder !== 0) return scoreOrder;
  const replayOrder = right.replayCount - left.replayCount;
  if (replayOrder !== 0) return replayOrder;
  const completedOrder = right.completedCount - left.completedCount;
  if (completedOrder !== 0) return completedOrder;
  const baselineOrder = (right.baselinePromotedAt ?? "").localeCompare(
    left.baselinePromotedAt ?? "",
  );
  if (baselineOrder !== 0) return baselineOrder;
  const recordOrder = right.recordUpdatedAt.localeCompare(left.recordUpdatedAt);
  if (recordOrder !== 0) return recordOrder;
  return left.recordId.localeCompare(right.recordId);
}

function executionPlanBlueprintRecommendationScoreBps(input: {
  outcomeCompletionBps: number;
  familyCompletionBps: number;
  reviewedBaselineCoverageBps: number;
  replayEvidenceBps: number;
  policy: ExecutionPlanBlueprintRecommendationPolicy;
}): number {
  const weights = input.policy.weights;
  return Math.round(
    (input.outcomeCompletionBps * weights.outcomeCompletionBps +
      input.familyCompletionBps * weights.familyCompletionBps +
      input.reviewedBaselineCoverageBps * weights.reviewedBaselineBps +
      input.replayEvidenceBps * weights.replayEvidenceBps) /
      10_000,
  );
}

function executionPlanBlueprintFamilyReviewedBaselineCoverageBps(
  family: ExecutionPlanBlueprintPortfolioCalibrationFamily,
): number {
  return family.recordCount > 0
    ? Math.round((family.reviewedBaselineCount / family.recordCount) * 10_000)
    : 0;
}

function executionPlanBlueprintReplayEvidenceBps(replayCount: number): number {
  return Math.min(10_000, replayCount * 1_000);
}

function executionPlanBlueprintRecommendationPolicySha256(
  policy: ExecutionPlanBlueprintRecommendationPolicy,
): string {
  return sha256(canonicalJson(policy));
}

function executionPlanBlueprintRecommendationPolicySetSha256(
  policies: ExecutionPlanBlueprintRecommendationPolicy[],
): string {
  return sha256(
    canonicalJson(
      policies.map((policy) => ({
        templateId: policy.templateId,
        recommendationPolicySha256:
          executionPlanBlueprintRecommendationPolicySha256(policy),
      })),
    ),
  );
}

function executionPlanBlueprintRecommendationPolicyOverrideSetSha256(
  overrides: ExecutionPlanBlueprintRecommendationPolicyOverride[],
): string {
  return sha256(
    canonicalJson(
      overrides
        .map((override) => ({
          familySha256: override.familySha256,
          contentSha256: override.contentSha256,
        }))
        .sort((left, right) =>
          left.familySha256.localeCompare(right.familySha256),
        ),
    ),
  );
}

function executionPlanBlueprintRecommendationPolicyOverrideDriftReviewSetSha256(
  reviews: ExecutionPlanBlueprintRecommendationPolicyOverrideDriftReviewItem[],
): string {
  return sha256(
    canonicalJson(
      reviews
        .map((review) => ({
          familySha256: review.familySha256,
          overrideSha256: review.overrideSha256,
          reviewSha256: review.reviewSha256,
        }))
        .sort((left, right) =>
          left.familySha256.localeCompare(right.familySha256),
        ),
    ),
  );
}

function executionPlanBlueprintRecommendationPolicyOverrideRetirementSetSha256(
  retirements: RetireExecutionPlanBlueprintRecommendationPolicyOverrideResult[],
): string {
  return sha256(
    canonicalJson(
      retirements
        .map((retirement) => ({
          familySha256: retirement.familySha256,
          retiredOverrideSha256: retirement.retiredOverrideSha256,
          contentSha256: retirement.contentSha256,
        }))
        .sort((left, right) => {
          const familyOrder = left.familySha256.localeCompare(
            right.familySha256,
          );
          if (familyOrder !== 0) return familyOrder;
          return left.contentSha256.localeCompare(right.contentSha256);
        }),
    ),
  );
}

function executionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryBundleSetSha256(
  hashes: string[],
): string {
  return sha256(canonicalJson([...new Set(hashes)].sort()));
}

function listExecutionPlanBlueprintRecommendationPolicies(): ExecutionPlanBlueprintRecommendationPolicy[] {
  return EXECUTION_PLAN_BLUEPRINT_RECOMMENDATION_POLICY_TEMPLATE_IDS.map(
    (templateId) =>
      normalizeExecutionPlanBlueprintRecommendationPolicy(templateId),
  );
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function selectExecutionPlanBlueprintCandidate(
  candidates: ExecutionPlanBlueprintRecordSelectionCandidate[],
): ExecutionPlanBlueprintRecordSelectionCandidate | undefined {
  return candidates
    .filter((candidate) => candidate.selectionStatus === "qualified")
    .sort(compareExecutionPlanBlueprintSelectionCandidates)
    .at(0);
}

function compareExecutionPlanBlueprintSelectionCandidates(
  left: ExecutionPlanBlueprintRecordSelectionCandidate,
  right: ExecutionPlanBlueprintRecordSelectionCandidate,
): number {
  const recommendationOrder =
    right.recommendationScoreBps - left.recommendationScoreBps;
  if (recommendationOrder !== 0) return recommendationOrder;
  const scoreOrder = right.scoreBps - left.scoreBps;
  if (scoreOrder !== 0) return scoreOrder;
  const familyCompletionOrder =
    right.familyCompletionRateBps - left.familyCompletionRateBps;
  if (familyCompletionOrder !== 0) return familyCompletionOrder;
  const familyReviewedOrder =
    right.familyReviewedBaselineCount - left.familyReviewedBaselineCount;
  if (familyReviewedOrder !== 0) return familyReviewedOrder;
  const familyQualifiedOrder =
    right.familyOutcomeQualifiedCount - left.familyOutcomeQualifiedCount;
  if (familyQualifiedOrder !== 0) return familyQualifiedOrder;
  const replayOrder = right.replayCount - left.replayCount;
  if (replayOrder !== 0) return replayOrder;
  const completedOrder = right.completedCount - left.completedCount;
  if (completedOrder !== 0) return completedOrder;
  const baselineOrder = (right.baselinePromotedAt ?? "").localeCompare(
    left.baselinePromotedAt ?? "",
  );
  if (baselineOrder !== 0) return baselineOrder;
  const recordOrder = right.recordUpdatedAt.localeCompare(left.recordUpdatedAt);
  if (recordOrder !== 0) return recordOrder;
  return left.recordId.localeCompare(right.recordId);
}

function createExecutionPlanBlueprintRecordSelection(input: {
  threadId: string;
  objective?: string;
  candidates: ExecutionPlanBlueprintRecordSelectionCandidate[];
  portfolioSetSha256: string;
  recommendationPolicy: ExecutionPlanBlueprintRecommendationPolicy;
  familyPolicyOverrides: ExecutionPlanBlueprintRecommendationPolicyOverride[];
}): ExecutionPlanBlueprintRecordSelection {
  const selected = input.candidates.find(
    (candidate) => candidate.selectionStatus === "selected",
  );
  const qualifiedCandidateCount = input.candidates.filter(
    (candidate) =>
      candidate.selectionStatus === "qualified" ||
      candidate.selectionStatus === "selected",
  ).length;
  const content = {
    kind: "napier.execution-plan-blueprint-selection" as const,
    schemaVersion: 1 as const,
    apiVersion: NAPIER_API_VERSION,
    threadId: input.threadId,
    ...(input.objective ? { objectiveSha256: sha256(input.objective) } : {}),
    candidateCount: input.candidates.length,
    qualifiedCandidateCount,
    rejectedCandidateCount: input.candidates.filter(
      (candidate) => candidate.selectionStatus === "rejected",
    ).length,
    ...(selected ? { selectedRecordId: selected.recordId } : {}),
    ...(selected?.previewSha256
      ? { selectedPreviewSha256: selected.previewSha256 }
      : {}),
    ...(selected?.baselineId
      ? { selectedBaselineId: selected.baselineId }
      : {}),
    ...(selected?.baselineSha256
      ? { selectedBaselineSha256: selected.baselineSha256 }
      : {}),
    ...(selected ? { selectedScoreBps: selected.scoreBps } : {}),
    ...(selected ? { selectedFamilySha256: selected.familySha256 } : {}),
    ...(selected
      ? { selectedFamilyCompletionRateBps: selected.familyCompletionRateBps }
      : {}),
    ...(selected
      ? { selectedRecommendationScoreBps: selected.recommendationScoreBps }
      : {}),
    ...(selected
      ? {
          selectedRecommendationPolicyTemplate:
            selected.recommendationPolicyTemplate,
        }
      : {}),
    ...(selected
      ? {
          selectedRecommendationPolicySha256:
            selected.recommendationPolicySha256,
        }
      : {}),
    ...(selected
      ? {
          selectedRecommendationPolicySource:
            selected.recommendationPolicySource,
        }
      : {}),
    ...(selected?.familyPolicyOverrideSha256
      ? {
          selectedFamilyPolicyOverrideSha256:
            selected.familyPolicyOverrideSha256,
        }
      : {}),
    recommendationPolicy: input.recommendationPolicy,
    recommendationPolicySha256:
      executionPlanBlueprintRecommendationPolicySha256(
        input.recommendationPolicy,
      ),
    familyPolicyOverrideCount: input.familyPolicyOverrides.length,
    familyPolicyOverrideSetSha256:
      executionPlanBlueprintRecommendationPolicyOverrideSetSha256(
        input.familyPolicyOverrides,
      ),
    portfolioSetSha256: input.portfolioSetSha256,
    selectionSetSha256: sha256(
      canonicalJson(
        input.candidates.map((candidate) => ({
          recordId: candidate.recordId,
          selectionStatus: candidate.selectionStatus,
          diagnostics: candidate.diagnostics,
          scoreBps: candidate.scoreBps,
          recommendationScoreBps: candidate.recommendationScoreBps,
          recommendationPolicyTemplate: candidate.recommendationPolicyTemplate,
          recommendationPolicySha256: candidate.recommendationPolicySha256,
          recommendationPolicySource: candidate.recommendationPolicySource,
          ...(candidate.familyPolicyOverrideSha256
            ? {
                familyPolicyOverrideSha256:
                  candidate.familyPolicyOverrideSha256,
              }
            : {}),
          familySha256: candidate.familySha256,
          familyRecordCount: candidate.familyRecordCount,
          familyOutcomeQualifiedCount: candidate.familyOutcomeQualifiedCount,
          familyReviewedBaselineCount: candidate.familyReviewedBaselineCount,
          familyCompletionRateBps: candidate.familyCompletionRateBps,
          sourceQualificationStatus: candidate.sourceQualificationStatus,
          outcomeQualificationStatus: candidate.outcomeQualificationStatus,
          ...(candidate.previewStatus
            ? { previewStatus: candidate.previewStatus }
            : {}),
          ...(candidate.previewSha256
            ? { previewSha256: candidate.previewSha256 }
            : {}),
          ...(candidate.baselineSha256
            ? { baselineSha256: candidate.baselineSha256 }
            : {}),
          currentOutcomesSha256: candidate.currentOutcomesSha256,
          currentOutcomeSetSha256: candidate.currentOutcomeSetSha256,
        })),
      ),
    ),
    candidates: input.candidates,
  };
  return {
    ...content,
    generatedAt: nowIso(),
    contentSha256: sha256(canonicalJson(content)),
  };
}

function verifyExecutionPlanBlueprintRecordReplayOutcomesProjection(
  input: unknown,
  expectedRecordId: string,
  observed: ExecutionPlanBlueprintRecordReplayOutcomes,
): ExecutionPlanBlueprintRecordReplayOutcomesVerification {
  const diagnostics: string[] = [];
  const record = isRecord(input) ? input : undefined;
  if (!record) diagnostics.push("outcomes_not_object");
  const recordId =
    typeof record?.["recordId"] === "string" ? record["recordId"] : undefined;
  const declaredContentSha256 = isSha256(record?.["contentSha256"])
    ? record["contentSha256"]
    : undefined;
  const recomputedContentSha256 = record
    ? sha256(canonicalJson(replayOutcomesHashContent(record)))
    : undefined;
  const declaredReplayHistorySha256 = isSha256(record?.["replayHistorySha256"])
    ? record["replayHistorySha256"]
    : undefined;
  const declaredOutcomeSetSha256 = isSha256(record?.["outcomeSetSha256"])
    ? record["outcomeSetSha256"]
    : undefined;
  const replayCount = isNonNegativeInteger(record?.["replayCount"])
    ? record["replayCount"]
    : undefined;
  const completedCount = isNonNegativeInteger(record?.["completedCount"])
    ? record["completedCount"]
    : undefined;
  const blockedCount = isNonNegativeInteger(record?.["blockedCount"])
    ? record["blockedCount"]
    : undefined;
  const invalidCount = isNonNegativeInteger(record?.["invalidCount"])
    ? record["invalidCount"]
    : undefined;
  if (record?.["kind"] !== "napier.execution-plan-blueprint-replay-outcomes") {
    diagnostics.push("kind_mismatch");
  }
  if (record?.["schemaVersion"] !== 1) diagnostics.push("schema_mismatch");
  if (recordId !== expectedRecordId) diagnostics.push("record_mismatch");
  if (!declaredContentSha256) diagnostics.push("content_hash_missing");
  if (
    declaredContentSha256 &&
    recomputedContentSha256 &&
    declaredContentSha256 !== recomputedContentSha256
  ) {
    diagnostics.push("content_hash_mismatch");
  }
  if (
    declaredContentSha256 &&
    declaredContentSha256 !== observed.contentSha256
  ) {
    diagnostics.push("current_outcomes_mismatch");
  }
  if (declaredReplayHistorySha256 !== observed.replayHistorySha256) {
    diagnostics.push("replay_history_mismatch");
  }
  if (declaredOutcomeSetSha256 !== observed.outcomeSetSha256) {
    diagnostics.push("outcome_set_mismatch");
  }
  if (replayCount !== observed.replayCount) {
    diagnostics.push("replay_count_mismatch");
  }
  if (completedCount !== observed.completedCount) {
    diagnostics.push("completed_count_mismatch");
  }
  if (blockedCount !== observed.blockedCount) {
    diagnostics.push("blocked_count_mismatch");
  }
  if (invalidCount !== observed.invalidCount) {
    diagnostics.push("invalid_count_mismatch");
  }
  const status: ExecutionPlanBlueprintRecordReplayOutcomesVerification["status"] =
    diagnostics.length === 0 ? "valid" : "invalid";
  const verificationContent = {
    schemaVersion: 1 as const,
    status,
    diagnostics,
    ...(recordId ? { recordId } : {}),
    expectedRecordId,
    ...(declaredContentSha256 ? { declaredContentSha256 } : {}),
    ...(recomputedContentSha256 ? { recomputedContentSha256 } : {}),
    observedContentSha256: observed.contentSha256,
    ...(declaredReplayHistorySha256 ? { declaredReplayHistorySha256 } : {}),
    observedReplayHistorySha256: observed.replayHistorySha256,
    ...(declaredOutcomeSetSha256 ? { declaredOutcomeSetSha256 } : {}),
    observedOutcomeSetSha256: observed.outcomeSetSha256,
    ...(replayCount !== undefined ? { replayCount } : {}),
    observedReplayCount: observed.replayCount,
    ...(completedCount !== undefined ? { completedCount } : {}),
    observedCompletedCount: observed.completedCount,
    ...(blockedCount !== undefined ? { blockedCount } : {}),
    observedBlockedCount: observed.blockedCount,
    ...(invalidCount !== undefined ? { invalidCount } : {}),
    observedInvalidCount: observed.invalidCount,
  };
  return {
    ...verificationContent,
    contentSha256: sha256(canonicalJson(verificationContent)),
  };
}

function verifyExecutionPlanBlueprintRecordReplayHistoryProjection(
  input: unknown,
  expectedRecordId: string,
  observed: ExecutionPlanBlueprintRecordReplayHistory,
): ExecutionPlanBlueprintRecordReplayHistoryVerification {
  const diagnostics: string[] = [];
  const record = isRecord(input) ? input : undefined;
  if (!record) diagnostics.push("history_not_object");
  const recordId =
    typeof record?.["recordId"] === "string" ? record["recordId"] : undefined;
  const declaredContentSha256 = isSha256(record?.["contentSha256"])
    ? record["contentSha256"]
    : undefined;
  const recomputedContentSha256 = record
    ? sha256(canonicalJson(replayHistoryHashContent(record)))
    : undefined;
  const declaredEventSetSha256 = isSha256(record?.["eventSetSha256"])
    ? record["eventSetSha256"]
    : undefined;
  const replayCount = isNonNegativeInteger(record?.["replayCount"])
    ? record["replayCount"]
    : undefined;
  const threadCount = isNonNegativeInteger(record?.["threadCount"])
    ? record["threadCount"]
    : undefined;
  const planCount = isNonNegativeInteger(record?.["planCount"])
    ? record["planCount"]
    : undefined;
  const firstSeq = isNonNegativeInteger(record?.["firstSeq"])
    ? record["firstSeq"]
    : undefined;
  const lastSeq = isNonNegativeInteger(record?.["lastSeq"])
    ? record["lastSeq"]
    : undefined;
  if (record?.["kind"] !== "napier.execution-plan-blueprint-replay-history") {
    diagnostics.push("kind_mismatch");
  }
  if (record?.["schemaVersion"] !== 1) diagnostics.push("schema_mismatch");
  if (recordId !== expectedRecordId) diagnostics.push("record_mismatch");
  if (!declaredContentSha256) diagnostics.push("content_hash_missing");
  if (
    declaredContentSha256 &&
    recomputedContentSha256 &&
    declaredContentSha256 !== recomputedContentSha256
  ) {
    diagnostics.push("content_hash_mismatch");
  }
  if (
    declaredContentSha256 &&
    declaredContentSha256 !== observed.contentSha256
  ) {
    diagnostics.push("current_history_mismatch");
  }
  if (declaredEventSetSha256 !== observed.eventSetSha256) {
    diagnostics.push("event_set_mismatch");
  }
  if (replayCount !== observed.replayCount) {
    diagnostics.push("replay_count_mismatch");
  }
  if (threadCount !== observed.threadCount) {
    diagnostics.push("thread_count_mismatch");
  }
  if (planCount !== observed.planCount) {
    diagnostics.push("plan_count_mismatch");
  }
  if (firstSeq !== observed.firstSeq || lastSeq !== observed.lastSeq) {
    diagnostics.push("seq_range_mismatch");
  }
  const status: ExecutionPlanBlueprintRecordReplayHistoryVerification["status"] =
    diagnostics.length === 0 ? "valid" : "invalid";
  const verificationContent = {
    schemaVersion: 1 as const,
    status,
    diagnostics,
    ...(recordId ? { recordId } : {}),
    expectedRecordId,
    ...(declaredContentSha256 ? { declaredContentSha256 } : {}),
    ...(recomputedContentSha256 ? { recomputedContentSha256 } : {}),
    observedContentSha256: observed.contentSha256,
    ...(declaredEventSetSha256 ? { declaredEventSetSha256 } : {}),
    observedEventSetSha256: observed.eventSetSha256,
    ...(replayCount !== undefined ? { replayCount } : {}),
    observedReplayCount: observed.replayCount,
    ...(threadCount !== undefined ? { threadCount } : {}),
    observedThreadCount: observed.threadCount,
    ...(planCount !== undefined ? { planCount } : {}),
    observedPlanCount: observed.planCount,
    ...(firstSeq !== undefined ? { firstSeq } : {}),
    ...(observed.firstSeq !== undefined
      ? { observedFirstSeq: observed.firstSeq }
      : {}),
    ...(lastSeq !== undefined ? { lastSeq } : {}),
    ...(observed.lastSeq !== undefined
      ? { observedLastSeq: observed.lastSeq }
      : {}),
  };
  return {
    ...verificationContent,
    contentSha256: sha256(canonicalJson(verificationContent)),
  };
}

function verifyExecutionPlanBlueprintRecordReplayEventProjection(
  expectedRecordId: string,
  request: VerifyExecutionPlanBlueprintRecordReplayEventRequest,
  events: RunEvent[],
): ExecutionPlanBlueprintRecordReplayEventVerification {
  const diagnostics: string[] = [];
  const eventBySeq = events.find((event) => event.seq === request.seq);
  const eventById = events.find((event) => event.id === request.eventId);
  const observedEvent = eventBySeq ?? eventById;
  if (!eventBySeq && !eventById) diagnostics.push("event_not_found");
  if (eventBySeq && eventBySeq.id !== request.eventId) {
    diagnostics.push("event_id_mismatch");
  }
  if (eventById && eventById.seq !== request.seq) {
    diagnostics.push("event_seq_mismatch");
  }
  if (eventBySeq && eventById && eventBySeq.id !== eventById.id) {
    diagnostics.push("event_anchor_mismatch");
  }
  const observedEventSha256 = observedEvent
    ? sha256(JSON.stringify(observedEvent))
    : undefined;
  if (
    observedEventSha256 !== undefined &&
    request.eventSha256 !== observedEventSha256
  ) {
    diagnostics.push("event_hash_mismatch");
  }
  const observedReplay = observedEvent
    ? executionPlanBlueprintRecordReplayFromEvent(
        observedEvent,
        expectedRecordId,
      )
    : undefined;
  if (observedEvent && !observedReplay) {
    diagnostics.push("record_replay_mismatch");
  }
  const status: ExecutionPlanBlueprintRecordReplayEventVerification["status"] =
    diagnostics.length === 0 ? "valid" : "invalid";
  const verificationContent = {
    schemaVersion: 1 as const,
    status,
    diagnostics,
    expectedRecordId,
    threadId: request.threadId,
    eventId: request.eventId,
    seq: request.seq,
    declaredEventSha256: request.eventSha256,
    ...(observedEventSha256 ? { observedEventSha256 } : {}),
    ...(observedReplay ? { observedReplay } : {}),
  };
  return {
    ...verificationContent,
    contentSha256: sha256(canonicalJson(verificationContent)),
  };
}

function replayHistoryHashContent(
  record: Record<string, unknown>,
): Record<string, unknown> {
  const {
    generatedAt: _generatedAt,
    contentSha256: _contentSha256,
    ...content
  } = record;
  return content;
}

function replayOutcomesHashContent(
  record: Record<string, unknown>,
): Record<string, unknown> {
  const {
    generatedAt: _generatedAt,
    contentSha256: _contentSha256,
    ...content
  } = record;
  return content;
}

function retirementHistoryHashContent(
  record: Record<string, unknown>,
): Record<string, unknown> {
  const {
    generatedAt: _generatedAt,
    contentSha256: _contentSha256,
    ...content
  } = record;
  return content;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateThreadImportProvenance(
  thread: ThreadRecord,
  value: unknown,
): ThreadImportProvenance {
  if (!isRecord(value)) {
    throw new Error(
      `Persisted Thread import provenance is invalid: ${thread.id}`,
    );
  }
  const allowed = new Set([
    "sourceThreadId",
    "sourceApiVersion",
    "sourceContentSha256",
    "sourceEventStreamSha256",
    "sourceEventCount",
    "localImportedThroughSeq",
    "sourceModelContextEnvelopeCount",
    "sourceEmbeddedModelContextEnvelopeCount",
    "importedAt",
  ]);
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    throw new Error(
      `Persisted Thread import provenance is invalid: ${thread.id}`,
    );
  }
  const sourceEventCount = value["sourceEventCount"];
  const localImportedThroughSeq = value["localImportedThroughSeq"];
  const sourceModelContextEnvelopeCount =
    value["sourceModelContextEnvelopeCount"];
  const sourceEmbeddedModelContextEnvelopeCount =
    value["sourceEmbeddedModelContextEnvelopeCount"];
  if (
    typeof value["sourceThreadId"] !== "string" ||
    !/^[a-z][a-z0-9_]{2,80}$/.test(value["sourceThreadId"]) ||
    typeof value["sourceApiVersion"] !== "string" ||
    value["sourceApiVersion"].length > 64 ||
    !isSha256(value["sourceContentSha256"]) ||
    !isSha256(value["sourceEventStreamSha256"]) ||
    !isNonNegativeInteger(sourceEventCount) ||
    (localImportedThroughSeq !== undefined &&
      (!isNonNegativeInteger(localImportedThroughSeq) ||
        localImportedThroughSeq > thread.eventCount)) ||
    (sourceModelContextEnvelopeCount !== undefined &&
      !isNonNegativeInteger(sourceModelContextEnvelopeCount)) ||
    (sourceEmbeddedModelContextEnvelopeCount !== undefined &&
      !isNonNegativeInteger(sourceEmbeddedModelContextEnvelopeCount)) ||
    typeof value["importedAt"] !== "string" ||
    !Number.isFinite(Date.parse(value["importedAt"]))
  ) {
    throw new Error(
      `Persisted Thread import provenance is invalid: ${thread.id}`,
    );
  }
  return {
    sourceThreadId: value["sourceThreadId"],
    sourceApiVersion: value["sourceApiVersion"],
    sourceContentSha256: value["sourceContentSha256"],
    sourceEventStreamSha256: value["sourceEventStreamSha256"],
    sourceEventCount,
    ...(localImportedThroughSeq !== undefined
      ? { localImportedThroughSeq }
      : {}),
    ...(sourceModelContextEnvelopeCount !== undefined
      ? { sourceModelContextEnvelopeCount }
      : {}),
    ...(sourceEmbeddedModelContextEnvelopeCount !== undefined
      ? { sourceEmbeddedModelContextEnvelopeCount }
      : {}),
    importedAt: value["importedAt"],
  };
}

function validateThreadImportProvenanceLedgerReceipt(
  thread: ThreadRecord,
  events: RunEvent[],
): void {
  const provenance = thread.importProvenance;
  if (!provenance) return;
  const receipts = events.filter(
    (event) => event.type === THREAD_IMPORTED_EVENT,
  );
  if (receipts.length === 0) return;
  const receipt = receipts[0]!;
  const expectedPayload = threadImportProvenanceEventPayload(provenance);
  if (
    receipts.length !== 1 ||
    receipt.seq !== threadImportProvenanceLocalCutoff(provenance) ||
    receipt.category !== "lifecycle" ||
    receipt.visibility !== "debug" ||
    receipt.createdAt !== provenance.importedAt ||
    canonicalJson(receipt.payload) !== canonicalJson(expectedPayload)
  ) {
    throw new Error(
      `Persisted Thread import provenance receipt is invalid: ${thread.id}`,
    );
  }
}

function threadImportProvenanceEventPayload(
  provenance: ThreadImportProvenance,
): JsonValue {
  return {
    kind: "napier.thread-import-provenance",
    sourceThreadId: provenance.sourceThreadId,
    sourceApiVersion: provenance.sourceApiVersion,
    sourceContentSha256: provenance.sourceContentSha256,
    sourceEventStreamSha256: provenance.sourceEventStreamSha256,
    sourceEventCount: provenance.sourceEventCount,
    localImportedThroughSeq: threadImportProvenanceLocalCutoff(provenance),
    sourceModelContextEnvelopeCount:
      provenance.sourceModelContextEnvelopeCount ?? 0,
    sourceEmbeddedModelContextEnvelopeCount:
      provenance.sourceEmbeddedModelContextEnvelopeCount ?? 0,
    importedAt: provenance.importedAt,
  };
}

function threadImportProvenanceLocalCutoff(
  provenance: ThreadImportProvenance,
): number {
  return provenance.localImportedThroughSeq ?? provenance.sourceEventCount;
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function isModelRef(value: unknown): value is { provider: string; id: string } {
  if (!isRecord(value)) return false;
  return (
    typeof value["provider"] === "string" &&
    /^[a-z0-9][a-z0-9._-]{1,80}$/.test(value["provider"]) &&
    typeof value["id"] === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/.test(value["id"])
  );
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isExecutionPlanStatus(value: unknown): value is ExecutionPlanStatus {
  return (
    value === "active" ||
    value === "blocked" ||
    value === "completed" ||
    value === "cancelled"
  );
}

function isExecutionPlanBlueprintRecordQualificationStatus(
  value: unknown,
): value is ExecutionPlanBlueprintRecordQualification["status"] {
  return (
    value === "qualified" ||
    value === "archived" ||
    value === "source_missing" ||
    value === "source_drift" ||
    value === "invalid"
  );
}

function inboundDeadLetterQualificationStatus(
  delivery: PersistedInboundDelivery,
  currentAdapterCatalogSha256: string,
): InboundDeliveryQualificationStatus {
  if (!delivery.bodySha256 || !delivery.adapterCatalogSha256) {
    return "evidence_missing";
  }
  return delivery.adapterCatalogSha256 === currentAdapterCatalogSha256
    ? "qualified"
    : "adapter_catalog_drift";
}

function inboundDeadLetterQualificationSummary(
  deliveries: ReadonlyArray<{
    qualificationStatus?: InboundDeliveryQualificationStatus;
  }>,
): {
  qualifiedCount: number;
  evidenceMissingCount: number;
  adapterCatalogDriftCount: number;
} {
  return deliveries.reduce(
    (summary, delivery) => {
      if (delivery.qualificationStatus === "qualified") {
        summary.qualifiedCount += 1;
      } else if (delivery.qualificationStatus === "evidence_missing") {
        summary.evidenceMissingCount += 1;
      } else if (delivery.qualificationStatus === "adapter_catalog_drift") {
        summary.adapterCatalogDriftCount += 1;
      }
      return summary;
    },
    {
      qualifiedCount: 0,
      evidenceMissingCount: 0,
      adapterCatalogDriftCount: 0,
    },
  );
}

function normalizeInboundModel(model: { provider: string; id: string }) {
  const provider = model.provider.trim().toLowerCase();
  const id = model.id.trim();
  if (!/^[a-z][a-z0-9_-]{0,63}$/.test(provider) || !id || /\s/.test(id)) {
    throw new Error("Inbound model is invalid");
  }
  return { provider, id };
}

function extractMessagePreview(event: RunEvent): string | undefined {
  if (
    (event.type !== "message.user" && event.type !== "message.assistant") ||
    event.category !== "message" ||
    !event.payload ||
    Array.isArray(event.payload) ||
    typeof event.payload !== "object"
  ) {
    return undefined;
  }
  const text = event.payload["text"];
  if (typeof text !== "string") return undefined;
  return text.replace(/\s+/g, " ").trim().slice(0, 180);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(
      ([left], [right]) => left.localeCompare(right),
    );
    return `{${entries
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
