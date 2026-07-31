import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import type {
  AnswerOperatorDecisionRequest,
  AgentMilestone,
  ApplyExtensionPackageDeploymentRequest,
  ApplyExtensionPackageDeploymentResult,
  ApplyExtensionPackageRolloutChannelRequest,
  ApplyExtensionPackageRolloutChannelResult,
  ApplyExtensionPackageUpdateRequest,
  ApplyExtensionPackageUpdateResult,
  ApplySkillContentResult,
  AgentProfile,
  CreateReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionRequest,
  CreateReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionRequest,
  DiscoverReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRequest,
  DiscoverReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalRequest,
  AgentProfileRevision,
  AgentProfileRollbackResult,
  AutomationSchedule,
  BootstrapResponse,
  CreateExtensionPublisherTrustAnchorRequest,
  CreateReceiptTrustAnchorRequest,
  CreateReceiptTrustAnchorDirectorySubscriptionRequest,
  EvaluateReceiptTrustAnchorDirectoryQuorumRequest,
  CreateInboundChannelRequest,
  ApplyInboundDeadLetterRetryRequest,
  CreateMacOsKeychainCredentialRequest,
  CreateEvaluationCasebookRequest,
  CreateEvaluationSuiteRequest,
  CreateBranchRequest,
  CreateCredentialReferenceRequest,
  CredentialReference,
  CreateExecutionPlanRequest,
  CreateMcpExtensionRequest,
  CreateMemoryRequest,
  SignReceiptTrustAnchorDirectoryMetadataRequest,
  CreateRunEvaluationRequest,
  CreateAutomationScheduleRequest,
  CreateThreadRequest,
  ContextCheckpointCalibrationReport,
  CreateExecutionPlanFromBlueprintRequest,
  CreateExecutionPlanFromBlueprintRecordRequest,
  DiscoverReceiptTrustAnchorDirectoryRequest,
  ExecutionPlan,
  ExecutionPlanArchive,
  ExecutionPlanArchiveVerification,
  ExecutionPlanBlueprint,
  ExecutionPlanBlueprintRecord,
  ExecutionPlanBlueprintRecordPreview,
  ExecutionPlanBlueprintRecordQualification,
  ExecutionPlanBlueprintRecordReplayEventVerification,
  ExecutionPlanBlueprintRecordReplayHistory,
  ExecutionPlanBlueprintRecordReplayHistoryVerification,
  ExecutionPlanBlueprintRecordReplayOutcomes,
  ExecutionPlanBlueprintRecordReplayOutcomesVerification,
  ExecutionPlanBlueprintOutcomeReviewCriteria,
  ExecutionPlanBlueprintRecordOutcomeBaseline,
  ExecutionPlanBlueprintRecordOutcomeQualification,
  ExecutionPlanBlueprintRecordOutcomeReview,
  ExecutionPlanBlueprintPortfolioCalibration,
  ExecutionPlanBlueprintRecommendationPolicyBacktest,
  ExecutionPlanBlueprintRecommendationPolicyOverride,
  ExecutionPlanBlueprintRecommendationPolicyOverrideDriftReview,
  ExecutionPlanBlueprintRecommendationPolicyOverrideList,
  ExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistory,
  ExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryProofBundle,
  ExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryVerification,
  ExecutionPlanBlueprintRecordSelection,
  ExecutionPlanBlueprintVerification,
  ExecutionPlanReplanDraftModelReview,
  ExtensionCapability,
  ExtensionRecord,
  ExtensionPublisherTrustAnchor,
  EvaluationSuite,
  EvaluationSuiteExecution,
  EvaluationSuiteGateReceipt,
  EvaluationCasebook,
  EvaluationCasebookArtifact,
  EvaluationCasebookCalibrationReport,
  EvaluationCasebookQualificationExecution,
  EvaluationCasebookQualificationReceipt,
  EvaluationAdjudication,
  EvaluationCalibrationReport,
  EvaluationQualificationBaseline,
  ExportOpenTelemetryTraceRequest,
  ExportExtensionPackageLockfileRequest,
  HealthResponse,
  ApplyReceiptTrustAnchorDirectoryQuorumActivationSelectionRequest,
  ApplyReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalRequest,
  ApplyReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyRequest,
  ApplyReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyResult,
  ApplyReceiptTrustAnchorDirectoryQuorumActivationSelectionResult,
  ImportReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselineRequest,
  ImportReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselineResult,
  ImportReceiptTrustAnchorDirectoryQuorumPromotionBaselineRequest,
  ImportReceiptTrustAnchorDirectoryQuorumPromotionBaselineResult,
  ImportReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaselineRequest,
  ImportReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaselineResult,
  ProposeReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationRequest,
  QueueReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyApplyRequest,
  QueueReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyApplyResult,
  PromoteEvaluationQualificationBaselineRequest,
  PromoteEvaluationQualificationBaselineResult,
  PromoteExecutionPlanBlueprintRecordOutcomeBaselineRequest,
  PromoteExecutionPlanBlueprintRecordOutcomeBaselineResult,
  PromoteReceiptTrustAnchorDirectoryQuorumBaselineRequest,
  PromoteReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselineRequest,
  PromoteReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselineResult,
  PromoteReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaselineRequest,
  PromoteReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaselineResult,
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
  ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalPreflight,
  ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalDiscovery,
  ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalDiscoveryPolicy,
  ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposal,
  ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription,
  ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApproval,
  ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalApplyReplay,
  ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaseline,
  ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaselineVerification,
  ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyReview,
  ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionRefreshResult,
  ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationReview,
  ReceiptTrustAnchorDirectoryQuorumActivationSelectionState,
  ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointDiscovery,
  ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointDiscoveryPolicy,
  ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorum,
  ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaseline,
  ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselineVerification,
  ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumPolicy,
  ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription,
  ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionRefreshResult,
  ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpoint,
  ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointVerification,
  ReceiptTrustAnchorDirectoryQuorumMetadataEvidence,
  ReceiptTrustAnchorDirectoryQuorumMetadataInput,
  ReceiptTrustAnchorDirectoryQuorumPolicy,
  ReceiptTrustAnchorDirectoryQuorumPromotionBaseline,
  ReceiptTrustAnchorDirectoryQuorumPromotionBaselineImportPolicy,
  ReceiptTrustAnchorDirectoryQuorumPromotionBaselineVerification,
  ReceiptTrustAnchorDirectoryQuorumPromotionReceipt,
  ReceiptTrustAnchorDirectorySubscription,
  ReceiptTrustAnchorDirectorySubscriptionRefreshResult,
  ReceiptTrustAnchorDirectoryVerification,
  ReceiptTrustAnchorDirectoryVerificationPolicy,
  RevokeExtensionPublisherTrustAnchorRequest,
  RevokeReceiptTrustAnchorRequest,
  EvaluateReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumRequest,
  RefreshReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionRequest,
  RefreshReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionRequest,
  RefreshReceiptTrustAnchorDirectorySubscriptionRequest,
  ReviewReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyRequest,
  SignReceiptTrustAnchorDirectoryQuorumActivationDecisionRequest,
  SignReceiptTrustAnchorDirectoryQuorumActivationDecisionResult,
  SignReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalRequest,
  SignReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalRequest,
  SignReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRequest,
  UpdateReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionRequest,
  UpdateReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionRequest,
  RetireExecutionPlanBlueprintRecommendationPolicyOverrideRequest,
  RetireExecutionPlanBlueprintRecommendationPolicyOverrideResult,
  SignedExtensionPackageEnvelope,
  SignedPromptPackageEnvelope,
  SignedSkillPackageEnvelope,
  SignExtensionPackageRequest,
  SignExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryProofBundleRequest,
  SignPromptPackageRequest,
  SignSkillPackageRequest,
  SignTrustedReceiptRequest,
  EvaluationConsensusGate,
  ExecuteEvaluationCasebookRequest,
  InboundChannel,
  InboundChannelAdapter,
  InboundChannelAdapterDescriptor,
  InboundChannelAdapterPreview,
  InboundChannelPolicyTemplateId,
  InboundDeadLetterExport,
  InboundDeadLetterExportVerification,
  InboundDeadLetterRetryApplyResult,
  InboundDeadLetterRetryHistory,
  InboundDeadLetterRetryHistoryVerification,
  InboundDeadLetterRetryPreview,
  VerifyInboundDeadLetterExportRequest,
  VerifyInboundDeadLetterRetryHistoryRequest,
  VerifyReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaselineRequest,
  InboundDelivery,
  InboundDeliveryQualification,
  InboundReceipt,
  InboundMessageRequest,
  ImportSignedExtensionPackageRequest,
  ImportThreadReplayBundleRequest,
  InstallSkillPackageRequest,
  InstallSkillPackageResult,
  InspectorPackageQualification,
  InspectorPackageVerification,
  JsonValue,
  MemoryFact,
  McpToolEffect,
  McpTransportConfig,
  OpenTelemetryTraceArtifact,
  OpenTelemetryTraceArtifactVerification,
  OperatorDecision,
  ThreadDetail,
  ThreadReplayBundle,
  ThreadReplayBundleVerification,
  ExtensionPackageChannelIndexVerification,
  ExtensionPackageDeploymentPreview,
  ExtensionPackageLockfile,
  ExtensionPackageLockfileVerification,
  ExtensionPackageRolloutChannel,
  ExtensionPackageRolloutPreview,
  ExtensionPackageUpdatePreview,
  ExtensionPackageVerification,
  PreviewExtensionPackageRolloutChannelRequest,
  PreviewExtensionPackageDeploymentRequest,
  PreviewExtensionPackageUpdateRequest,
  PreviewInboundDeadLetterRetryRequest,
  PreviewInboundChannelAdapterRequest,
  PublishExtensionPackageRolloutChannelRequest,
  QueueRunControlMessageRequest,
  QualifyInspectorPackageRequest,
  QualifyPromptPackageRequest,
  QualifySkillPackageRequest,
  PromptRequest,
  PromptPackageQualification,
  PromptPackageVerification,
  PromptVariableDefinition,
  ToolLoopGuardPolicy,
  ReplanExecutionPlanRequest,
  ReviewExecutionPlanReplanDraftRequest,
  RollbackAgentProfileRequest,
  RunComparison,
  RunControlMessage,
  RunEvent,
  RunEvaluationRecord,
  RunMetrics,
  RunReplaySnapshot,
  RunReplaySnapshotVerification,
  SubagentOutcomeEvidenceVerification,
  SubagentOutcomeReview,
  EvaluationReviewerBallot,
  EvaluationConsensusReport,
  EvaluationConsensusResolution,
  ResumeRunRequest,
  ReviewSubagentOutcomeRequest,
  ReviewExtensionRequest,
  ReviewMemoryRequest,
  ReviewMcpToolRequest,
  ReviewExecutionPlanBlueprintRecordOutcomesRequest,
  ReviewRunEvaluationRequest,
  ReviewReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationRequest,
  ResolveEvaluationConsensusRequest,
  ResolveEvaluationConsensusResult,
  CurateEvaluationCaseRequest,
  RemoveEvaluationCaseRequest,
  SetExtensionEnabledRequest,
  SetCredentialReferenceStatusRequest,
  SetExecutionPlanBlueprintRecommendationPolicyOverrideRequest,
  SetExecutionPlanBlueprintRecordStatusRequest,
  SelectExecutionPlanBlueprintRecordRequest,
  SetGoalRequest,
  SetInboundChannelStatusRequest,
  SignedExtensionPackageChannelIndexEnvelope,
  SignedInspectorPackageEnvelope,
  SkillContentReview,
  SkillPackageInstallation,
  SkillPackageQualification,
  SkillPackageVerification,
  SaveExecutionPlanBlueprintRequest,
  SaveExecutionPlanBlueprintResult,
  SignExtensionPackageChannelIndexRequest,
  SignInspectorPackageRequest,
  StreamFrame,
  SubmitEvaluationReviewerBallotRequest,
  TrustedReceiptEnvelope,
  TrustedReceiptVerification,
  TransitionPlanStepRequest,
  UpdateAgentProfileRequest,
  UpdateAutomationScheduleRequest,
  UpdateArtifactManifestRequest,
  UpdateInboundRetryPolicyRequest,
  UpdateInboundSignaturePolicyRequest,
  UpdateEvaluationSuiteRequest,
  UpdateEvaluationCasebookRequest,
  UpdateReceiptTrustAnchorDirectorySubscriptionRequest,
  UsagePriceTableCatalog,
  UsagePriceTableVerification,
  VerifyExtensionPackageLockfileRequest,
  VerifyExtensionPackageChannelIndexRequest,
  VerifyExecutionPlanBlueprintRequest,
  VerifyExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryRequest,
  VerifyExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryProofBundleRequest,
  VerifyExecutionPlanBlueprintRecordReplayEventRequest,
  VerifyExecutionPlanBlueprintRecordReplayHistoryRequest,
  VerifyExecutionPlanBlueprintRecordReplayOutcomesRequest,
  VerifyExecutionPlanArchiveRequest,
  VerifyInspectorPackageRequest,
  VerifyOpenTelemetryTraceArtifactRequest,
  VerifyPromptPackageRequest,
  VerifyRunReplaySnapshotRequest,
  VerifyThreadReplayBundleRequest,
  VerifyUsagePriceTableCatalogRequest,
  VerifyReceiptTrustAnchorDirectoryRequest,
  VerifyReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselineRequest,
  VerifyReceiptTrustAnchorDirectoryQuorumPromotionBaselineRequest,
  VerifyReceiptTrustAnchorDirectoryQuorumActivationDecisionHistoryRequest,
  VerifyReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRequest,
  VerifyReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalRequest,
  VerifyReceiptTrustAnchorDirectoryMetadataRequest,
  ApplySkillContentRequest,
  PreviewSkillContentRequest,
  VerifySkillPackageRequest,
  VerifySignedExtensionPackageRequest,
  VerifyTrustedReceiptRequest,
} from "@napier/contracts";
import { AGENT_TOOL_NAMES } from "@napier/contracts";
import {
  type AgentRuntime,
  AutomationService,
  ChannelService,
  changedAgentFields,
  canonicalJson,
  compareRuns,
  type CredentialReferenceStore,
  createLocalAgentRuntime,
  createThreadBranch,
  EvaluationCasebookQualificationService,
  EvaluationSuiteService,
  type KeychainSecretStore,
  type OsSandboxAdapter,
  createEvaluationCasebookQualificationReceipt,
  createEvaluationSuiteGateReceipt,
  createGoal,
  createId,
  createExecutionPlanArchive,
  createExecutionPlanBlueprint,
  createPlanArtifactEventPayload,
  createRunReplaySnapshot,
  createWorkspaceArtifactDriftRequest,
  createWorkspaceArtifactVerificationRequest,
  exportWorkspaceFileArtifact,
  inspectWorkspaceArtifactDrift,
  previewWorkspaceDataArtifactProfile,
  previewWorkspaceDirectoryArtifactManifest,
  previewWorkspaceTextArtifact,
  createInboundDeadLetterRetryHistory,
  createReceiptTrustAnchorDirectoryMetadataReceipt,
  createReceiptTrustAnchorDirectoryQuorumActivationDecisionReceipt,
  createReceiptTrustAnchorDirectoryQuorumActivationSourceAlignment,
  createReceiptTrustAnchorDirectoryQuorumPromotionReceipt,
  createOpenTelemetryTraceArtifact,
  builtinUsagePriceTableCatalog,
  exportThreadReplayBundle,
  hashEventStream,
  type LocalStore,
  MAX_RECEIPT_TRUST_ANCHORS,
  MAX_RECEIPT_TRUST_DIRECTORY_SUBSCRIPTIONS,
  MAX_RECEIPT_TRUST_DIRECTORY_SOURCE_WEIGHT,
  MAX_RECEIPT_TRUST_DIRECTORY_REFRESH_INTERVAL_MS,
  MIN_RECEIPT_TRUST_DIRECTORY_REFRESH_INTERVAL_MS,
  MAX_EXTENSION_PACKAGE_DEPENDENCIES,
  MAX_EXTENSION_PACKAGE_DEPLOYMENT_BYTES,
  MAX_EXTENSION_PACKAGE_DEPLOYMENT_CANDIDATES,
  MAX_EXTENSION_PACKAGE_CHANNEL_INDEX_BYTES,
  MAX_EXTENSION_PACKAGE_LOCKFILE_BYTES,
  MAX_SIGNED_EXTENSION_PACKAGE_BYTES,
  MAX_SIGNED_INSPECTOR_PACKAGE_BYTES,
  MAX_SIGNED_PROMPT_PACKAGE_BYTES,
  MAX_SIGNED_SKILL_PACKAGE_BYTES,
  MAX_SKILL_CONTENT_BYTES,
  MAX_TRUSTED_RECEIPT_BYTES,
  MAX_EXECUTION_PLAN_ARCHIVE_BYTES,
  MAX_EXECUTION_PLAN_BLUEPRINT_BYTES,
  MAX_RUN_CONTROL_MESSAGE_BYTES,
  MAX_THREAD_REPLAY_BUNDLE_BYTES,
  type McpExtensionManager,
  type ModelRegistry,
  type ModelInvocationExperimentRuntime,
  normalizePromptVariableDefinitions,
  normalizeToolLoopGuardPolicy,
  openTelemetryTraceArtifactEventAnchorSetSha256,
  normalizeScheduleTrigger,
  RecoveryService,
  receiptTrustAnchorsFromDirectory,
  reviewExecutionPlanBlueprintRecordOutcomes,
  reviewExecutionPlanReplanDraft,
  reviewSubagentOutcome,
  RUN_STREAM_ERROR_CODE,
  RUN_STREAM_ERROR_MESSAGE,
  RunEvaluationService,
  signTrustedReceipt,
  streamEventFrame,
  streamRunDoneFrame,
  streamRunErrorFrame,
  streamSnapshotFrame,
  ThreadBranchRequestError,
  reviewReceiptTrustAnchorDirectoryQuorumPromotionBaselineImportPolicy,
  verifyReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaseline,
  verifyReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaseline,
  verifyReceiptTrustAnchorDirectoryQuorumPromotionBaseline,
  verifySignedExtensionPackageEnvelope,
  verifyReceiptTrustAnchorDirectoryMetadata,
  verifyTrustedReceiptEnvelope,
  verifyExecutionPlanArchive,
  verifyExecutionPlanBlueprint,
  verifyOpenTelemetryTraceArtifact,
  verifyRunReplaySnapshot,
  verifySubagentOutcomeEvidence,
  validateThreadReplayBundle,
  verifyThreadReplayBundle,
  verifyInboundDeadLetterExportArtifact,
  verifyInboundDeadLetterRetryHistory,
  verifyUsagePriceTableCatalog,
  type WorkspaceFileMutationManager,
  type WorkspaceProcessManager,
  type AgentMessageExperimentRuntime,
  type ExecutionPlanWorkflowExperimentRuntime,
  type ExecutionPlanWorkflowRuntime,
  executionPlanRequestFromBlueprint,
} from "@napier/runtime";
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import {
  ReceiptTrustAnchorDirectoryDiscoveryError,
  ReceiptTrustAnchorDirectoryDiscoveryService,
  type ReceiptTrustAnchorDirectoryDiscoveryOptions,
} from "./receipt-trust-directory-discovery.js";
import {
  createReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyApplyQueueResult,
  createReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyApplyResult,
  createReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyReview,
  createReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalApplyReplay,
  createReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApproval,
  createReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalDiscovery,
  createReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalPreflight,
  type RotationProposalSubscriptionApprovalApplyGateResult,
  verifyReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaselineGate,
  verifyReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalApplyGate,
  verifyReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalGate,
} from "./receipt-trust-rotation-proposals.js";
import {
  createReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointDiscovery as createHostedReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointDiscovery,
  ReceiptTrustAnchorDirectorySubscriptionService,
  type ReceiptTrustAnchorDirectorySubscriptionServiceOptions,
} from "./receipt-trust-directory-subscriptions.js";
import { BUNDLED_SKILLS } from "./bundled-skills.js";
import {
  executeAgentMessageExperimentHttp,
  previewAgentMessageExperimentHttp,
} from "./agent-message-experiment-http.js";
import {
  executeModelInvocationExperimentHttp,
  previewModelInvocationExperimentHttp,
} from "./model-invocation-experiment-http.js";
import { executeWorkflowHttp } from "./workflow-http.js";
import {
  executeWorkflowExperimentHttp,
  previewWorkflowExperimentHttp,
} from "./workflow-experiment-http.js";

export interface NapierServices {
  store: LocalStore;
  models: ModelRegistry;
  extensions: McpExtensionManager;
  runtime: AgentRuntime;
  workflows: ExecutionPlanWorkflowRuntime;
  workflowExperiments: ExecutionPlanWorkflowExperimentRuntime;
  agentMessageExperiments: AgentMessageExperimentRuntime;
  modelInvocationExperiments: ModelInvocationExperimentRuntime;
  evaluations: RunEvaluationService;
  evaluationCasebookQualifications: EvaluationCasebookQualificationService;
  evaluationSuites: EvaluationSuiteService;
  credentials: CredentialReferenceStore;
  automation: AutomationService;
  channels: ChannelService;
  recovery: RecoveryService;
  workspaceFileMutations: WorkspaceFileMutationManager;
  workspaceProcesses: WorkspaceProcessManager;
  receiptTrustDirectories: ReceiptTrustAnchorDirectoryDiscoveryService;
  receiptTrustDirectorySubscriptions: ReceiptTrustAnchorDirectorySubscriptionService;
  shutdownLocalRuntime(): Promise<void>;
}

const MAX_RECEIPT_TRUST_CHECKPOINT_SELECTION_COUNT = 1_000;

const HEALTH_RUNTIME_COMPONENTS = ["sqlite", "openssl", "uv", "v8"] as const;

const INBOUND_CHANNEL_ADAPTERS: readonly InboundChannelAdapterDescriptor[] = [
  {
    id: "napier_json",
    label: "Napier JSON",
    description:
      "Native Napier delivery payload with explicit idempotency key and Agent message.",
    idempotencySource: "body.idempotencyKey",
    requiredHeaders: [],
    sampleHeaders: {},
    sampleBody: JSON.stringify(
      {
        idempotencyKey: "preview-delivery-0001",
        message: "Review this preview delivery without accepting it.",
      },
      null,
      2,
    ),
    securityNote:
      "The channel bearer token and optional Napier HMAC signature still authorize real inbound delivery.",
  },
  {
    id: "github_webhook",
    label: "GitHub webhook",
    description:
      "GitHub webhook payload normalized into repository/action/subject work for the Agent.",
    idempotencySource: "X-GitHub-Delivery",
    requiredHeaders: ["x-github-delivery", "x-github-event"],
    sampleHeaders: {
      "x-github-delivery": "preview-delivery-0001",
      "x-github-event": "pull_request",
    },
    sampleBody: JSON.stringify(
      {
        action: "opened",
        repository: { full_name: "acme/widgets" },
        pull_request: {
          number: 42,
          title: "Preview adapter mapping",
          html_url: "https://github.com/acme/widgets/pull/42",
        },
        sender: { login: "octocat" },
      },
      null,
      2,
    ),
    securityNote:
      "GitHub delivery IDs are used only as hashed idempotency material; public evidence exposes a short fingerprint.",
  },
  {
    id: "slack_event",
    label: "Slack events",
    description:
      "Slack Events API callback normalized into team/app/channel/user event work.",
    idempotencySource: "body.event_id",
    requiredHeaders: [],
    sampleHeaders: {},
    sampleBody: JSON.stringify(
      {
        token: "redacted-verification-token",
        team_id: "T01234567",
        api_app_id: "A01234567",
        type: "event_callback",
        event_id: "Ev0123456789",
        event_time: 1_785_000_000,
        event: {
          type: "message",
          channel: "C01234567",
          user: "U01234567",
          text: "Preview this Slack event without accepting it.",
          event_ts: "1785000000.000000",
        },
      },
      null,
      2,
    ),
    securityNote:
      "Slack event IDs are used only as hashed idempotency material; public evidence exposes a short fingerprint.",
  },
  {
    id: "linear_webhook",
    label: "Linear webhook",
    description:
      "Linear entity-change webhook normalized into issue, project, state, and assignee work.",
    idempotencySource:
      "hash(webhookId, createdAt/webhookTimestamp, type, action, data.id)",
    requiredHeaders: [],
    sampleHeaders: {},
    sampleBody: JSON.stringify(
      {
        action: "update",
        type: "Issue",
        webhookId: "wh_0123456789",
        createdAt: "2026-07-25T21:00:00.000Z",
        organizationId: "org_0123456789",
        data: {
          id: "issue_0123456789",
          identifier: "NAP-42",
          title: "Preview Linear webhook mapping",
          url: "https://linear.app/acme/issue/NAP-42",
          state: { name: "In Progress" },
          assignee: { name: "Ada Lovelace" },
          team: { key: "NAP", name: "Napier" },
          project: { name: "Agent operations" },
        },
      },
      null,
      2,
    ),
    securityNote:
      "Linear webhook identity is hashed before idempotency storage; public evidence exposes a short fingerprint.",
  },
];
function inboundChannelAdapterCatalog(): InboundChannelAdapterDescriptor[] {
  return INBOUND_CHANNEL_ADAPTERS.map((adapter) => structuredClone(adapter));
}

function inboundChannelAdapterCatalogSha256(): string {
  return sha256Text(JSON.stringify(INBOUND_CHANNEL_ADAPTERS));
}

const MAX_INBOUND_BODY_BYTES = 64 * 1024;
const MAX_THREAD_CREATE_REQUEST_BYTES = 8 * 1024;
const MAX_GOAL_REQUEST_BYTES = 8 * 1024;
const MAX_RESUME_REQUEST_BYTES = 8 * 1024;
const MAX_PROMPT_REQUEST_BYTES = 64 * 1024;
const MAX_OPERATOR_DECISION_REQUEST_BYTES = 32 * 1024;
// A JSON control-character escape can expand one UTF-8 byte to six bytes.
const MAX_RUN_CONTROL_MESSAGE_REQUEST_BYTES =
  MAX_RUN_CONTROL_MESSAGE_BYTES * 6 + 1024;
const MAX_SCHEDULE_REQUEST_BYTES = 32 * 1024;
const MAX_CHANNEL_ADMIN_REQUEST_BYTES = 8 * 1024;
const MAX_CHANNEL_ADAPTER_PREVIEW_REQUEST_BYTES =
  MAX_INBOUND_BODY_BYTES + 8 * 1024;
const MAX_DEAD_LETTER_EXPORT_VERIFY_REQUEST_BYTES = 2 * 1024 * 1024;
const MAX_MEMORY_REQUEST_BYTES = 16 * 1024;
const MAX_CREDENTIAL_REQUEST_BYTES = 8 * 1024;
const MAX_CREDENTIAL_SECRET_REQUEST_BYTES = 16 * 1024;
const MAX_EVALUATION_REQUEST_BYTES = 64 * 1024;
const MAX_AGENT_PROFILE_REQUEST_BYTES = 32 * 1024;
const MAX_EXTENSION_ADMIN_REQUEST_BYTES = 64 * 1024;
const MAX_TRACE_EXPORT_REQUEST_BYTES = 8 * 1024;
const MAX_BRANCH_REQUEST_BYTES = 8 * 1024;
const MAX_TRUST_ADMIN_REQUEST_BYTES = 8 * 1024;
const MAX_PACKAGE_GOVERNANCE_REQUEST_BYTES = 64 * 1024;
const MAX_PLAN_ARTIFACT_FILE_VERIFY_REQUEST_BYTES = 32 * 1024 * 1024;
const MAX_PLAN_ARTIFACT_DATA_PROFILE_VERIFY_REQUEST_BYTES = 4 * 1024 * 1024;
const MAX_PLAN_ARTIFACT_DIRECTORY_MANIFEST_VERIFY_REQUEST_BYTES =
  4 * 1024 * 1024;
const MAX_WORKSPACE_PROCESS_INPUT_REQUEST_BYTES = 128 * 1024;

export async function createServices(options?: {
  dataRoot?: string;
  workspaceRoot?: string;
  startAutomation?: boolean;
  keychain?: KeychainSecretStore;
  sandbox?: OsSandboxAdapter;
  receiptTrustDirectoryDiscovery?: ReceiptTrustAnchorDirectoryDiscoveryOptions;
  receiptTrustDirectorySubscriptions?: ReceiptTrustAnchorDirectorySubscriptionServiceOptions;
}): Promise<NapierServices> {
  const workspaceRoot = path.resolve(
    options?.workspaceRoot ??
      process.env["NAPIER_WORKSPACE"] ??
      inferWorkspaceRoot(process.cwd()),
  );
  const dataRoot = path.resolve(
    options?.dataRoot ??
      process.env["NAPIER_HOME"] ??
      path.join(workspaceRoot, ".napier"),
  );
  const local = await createLocalAgentRuntime({
    workspaceRoot,
    dataRoot,
    ...(options?.keychain ? { keychain: options.keychain } : {}),
    ...(options?.sandbox ? { sandbox: options.sandbox } : {}),
  });
  const {
    store,
    credentials,
    models,
    extensions,
    workspaceProcesses,
    workspaceFileMutations,
    runtime,
    workflows,
    workflowExperiments,
    agentMessageExperiments,
    modelInvocationExperiments,
  } = local;
  const evaluations = new RunEvaluationService(store, models);
  const evaluationCasebookQualifications =
    new EvaluationCasebookQualificationService(store, models);
  const evaluationSuites = new EvaluationSuiteService(store, models);
  const automation = new AutomationService(store, runtime);
  const channels = new ChannelService(store, runtime);
  const recovery = new RecoveryService(store, runtime);
  const receiptTrustDirectories =
    new ReceiptTrustAnchorDirectoryDiscoveryService(
      options?.receiptTrustDirectoryDiscovery,
    );
  const receiptTrustDirectorySubscriptions =
    new ReceiptTrustAnchorDirectorySubscriptionService(
      store,
      receiptTrustDirectories,
      options?.receiptTrustDirectorySubscriptions,
    );
  if (options?.startAutomation) {
    automation.start();
    channels.start();
    recovery.start();
    receiptTrustDirectorySubscriptions.start();
  }
  return {
    store,
    models,
    extensions,
    runtime,
    workflows,
    workflowExperiments,
    agentMessageExperiments,
    modelInvocationExperiments,
    evaluations,
    evaluationCasebookQualifications,
    evaluationSuites,
    credentials,
    automation,
    channels,
    recovery,
    workspaceFileMutations,
    workspaceProcesses,
    receiptTrustDirectories,
    receiptTrustDirectorySubscriptions,
    shutdownLocalRuntime: local.shutdown,
  };
}

export function inferWorkspaceRoot(cwd: string): string {
  const resolved = path.resolve(cwd);
  return path.basename(resolved) === "server" &&
    path.basename(path.dirname(resolved)) === "apps"
    ? path.resolve(resolved, "../..")
    : resolved;
}

export function createApp(services: NapierServices): Hono {
  const app = new Hono();
  app.use(
    "/api/*",
    cors({
      origin: ["http://localhost:5173", "http://127.0.0.1:5173"],
      allowHeaders: ["Content-Type", "Authorization", "X-Napier-Channel-Token"],
      allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      credentials: false,
    }),
  );

  app.get("/api/health", (context) => {
    const persistence = services.store.getPersistenceMetrics();
    const response: HealthResponse = {
      status:
        persistence.last?.status === "failed" ||
        (persistence.last?.projectionFailureCount ?? 0) > 0
          ? "degraded"
          : "ok",
      service: "napier",
      time: new Date().toISOString(),
      runtime: createHealthRuntimeProjection(),
      ledger: services.store.getLedgerSchemaReport(),
      store: { persistence },
    };
    setHealthProjectionHeaders(context, response);
    return context.json(response);
  });

  app.get("/api/receipt-trust/anchors", (context) => {
    const anchors = services.store.listReceiptTrustAnchors();
    setReceiptTrustAnchorListHeaders(context, anchors);
    return context.json(anchors);
  });

  app.get("/api/receipt-trust/anchors/directory", (context) => {
    const directory = services.store.getReceiptTrustAnchorDirectory();
    setReceiptTrustAnchorDirectoryHeaders(context, directory);
    return context.json(directory);
  });

  app.post(
    "/api/receipt-trust/anchors/directory/signed-metadata",
    async (context) => {
      let input: unknown;
      try {
        input = await readLimitedJson(
          context.req.raw,
          MAX_TRUST_ADMIN_REQUEST_BYTES,
          "Receipt trust anchor directory metadata signing request",
        );
      } catch (error) {
        return jsonError(
          context,
          error instanceof RequestBodyTooLargeError
            ? error.message
            : "Receipt trust anchor directory metadata signing request is invalid",
          error instanceof RequestBodyTooLargeError ? 413 : 400,
        );
      }
      const body = parseSignReceiptTrustAnchorDirectoryMetadataRequest(input);
      if (!body) {
        return jsonError(
          context,
          "Receipt trust anchor directory metadata signing request is invalid",
          400,
        );
      }
      services.store.getThread(body.threadId);
      const directory = services.store.getReceiptTrustAnchorDirectory();
      const receipt = createReceiptTrustAnchorDirectoryMetadataReceipt(
        directory,
        body,
      );
      const envelope = signTrustedReceipt(
        receipt,
        services.store.getReceiptTrustAnchor(body.trustAnchorId),
      );
      await appendReceiptTrustEvent(services, body.threadId, "receipt.signed", {
        ...trustedReceiptEventPayload(envelope),
        publisher: receipt.publisher,
        directorySha256: receipt.directorySha256,
        anchorSetSha256: receipt.anchorSetSha256,
        ...(receipt.sourceUrlSha256
          ? { sourceUrlSha256: receipt.sourceUrlSha256 }
          : {}),
        ...(receipt.sourceOriginSha256
          ? { sourceOriginSha256: receipt.sourceOriginSha256 }
          : {}),
      });
      setTrustedReceiptHeaders(
        context,
        envelope,
        `napier-signed-anchor-directory-metadata-${directory.anchorSetSha256.slice(0, 12)}-${envelope.contentSha256.slice(0, 12)}.json`,
      );
      return context.json(envelope, 201);
    },
  );

  app.get("/api/receipt-trust/anchors/directory/subscriptions", (context) => {
    const subscriptions =
      services.store.listReceiptTrustAnchorDirectorySubscriptions();
    setReceiptTrustAnchorDirectorySubscriptionListHeaders(
      context,
      subscriptions,
    );
    return context.json(subscriptions);
  });

  app.post(
    "/api/receipt-trust/anchors/directory/subscriptions/quorum",
    async (context) => {
      let input: unknown;
      try {
        input = await readLimitedJson(
          context.req.raw,
          MAX_TRUST_ADMIN_REQUEST_BYTES,
          "Receipt trust anchor directory quorum request",
        );
      } catch (error) {
        return jsonError(
          context,
          error instanceof RequestBodyTooLargeError
            ? error.message
            : "Receipt trust anchor directory quorum request is invalid",
          error instanceof RequestBodyTooLargeError ? 413 : 400,
        );
      }
      const body = parseEvaluateReceiptTrustAnchorDirectoryQuorumRequest(input);
      if (!body) {
        return jsonError(
          context,
          "Receipt trust anchor directory quorum request is invalid",
          400,
        );
      }
      let metadataEvidence: ReceiptTrustAnchorDirectoryQuorumMetadataEvidence[];
      try {
        metadataEvidence =
          createReceiptTrustAnchorDirectoryQuorumMetadataEvidence(
            services,
            body,
          );
      } catch (error) {
        return jsonError(
          context,
          errorMessage(error),
          error instanceof RequestBodyTooLargeError ? 413 : 400,
        );
      }
      const quorum =
        services.store.getReceiptTrustAnchorDirectorySubscriptionQuorum(
          body.policy,
          metadataEvidence,
        );
      setReceiptTrustAnchorDirectoryQuorumHeaders(context, quorum);
      return context.json(quorum);
    },
  );

  app.post(
    "/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion",
    async (context) => {
      let input: unknown;
      try {
        input = await readLimitedJson(
          context.req.raw,
          MAX_TRUST_ADMIN_REQUEST_BYTES,
          "Receipt trust anchor directory quorum promotion request",
        );
      } catch (error) {
        return jsonError(
          context,
          error instanceof RequestBodyTooLargeError
            ? error.message
            : "Receipt trust anchor directory quorum promotion request is invalid",
          error instanceof RequestBodyTooLargeError ? 413 : 400,
        );
      }
      const body = parsePromoteReceiptTrustAnchorDirectoryQuorumRequest(input);
      if (!body) {
        return jsonError(
          context,
          "Receipt trust anchor directory quorum promotion request is invalid",
          400,
        );
      }
      try {
        const metadataEvidence =
          createReceiptTrustAnchorDirectoryQuorumMetadataEvidence(
            services,
            body,
          );
        const quorum =
          services.store.getReceiptTrustAnchorDirectorySubscriptionQuorum(
            body.policy,
            metadataEvidence,
          );
        const promotion =
          createReceiptTrustAnchorDirectoryQuorumPromotionReceipt(
            quorum,
            body.metadata ?? [],
          );
        setReceiptTrustAnchorDirectoryQuorumPromotionHeaders(
          context,
          promotion,
        );
        return context.json(promotion, 201);
      } catch (error) {
        const message = errorMessage(error);
        return jsonError(
          context,
          message,
          message.includes("requires an agreed quorum") ? 409 : 400,
        );
      }
    },
  );

  app.get(
    "/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines",
    (context) => {
      const baselines =
        services.store.listReceiptTrustAnchorDirectoryQuorumPromotionBaselines();
      setReceiptTrustAnchorDirectoryQuorumPromotionBaselineListHeaders(
        context,
        baselines,
      );
      return context.json(baselines);
    },
  );

  app.post(
    "/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines",
    async (context) => {
      let input: unknown;
      try {
        input = await readLimitedJson(
          context.req.raw,
          MAX_TRUST_ADMIN_REQUEST_BYTES,
          "Receipt trust anchor directory quorum promotion baseline request",
        );
      } catch (error) {
        return jsonError(
          context,
          error instanceof RequestBodyTooLargeError
            ? error.message
            : "Receipt trust anchor directory quorum promotion baseline request is invalid",
          error instanceof RequestBodyTooLargeError ? 413 : 400,
        );
      }
      const body =
        parsePromoteReceiptTrustAnchorDirectoryQuorumBaselineRequest(input);
      if (!body) {
        return jsonError(
          context,
          "Receipt trust anchor directory quorum promotion baseline request is invalid",
          400,
        );
      }
      try {
        services.store.getThread(body.threadId);
        const metadataEvidence =
          createReceiptTrustAnchorDirectoryQuorumMetadataEvidence(
            services,
            body,
          );
        const quorum =
          services.store.getReceiptTrustAnchorDirectorySubscriptionQuorum(
            body.policy,
            metadataEvidence,
          );
        const promotion =
          createReceiptTrustAnchorDirectoryQuorumPromotionReceipt(
            quorum,
            body.metadata ?? [],
          );
        const envelope = signTrustedReceipt(
          promotion,
          services.store.getReceiptTrustAnchor(body.trustAnchorId),
        );
        const result =
          await services.store.promoteReceiptTrustAnchorDirectoryQuorumPromotionBaseline(
            body.threadId,
            envelope,
          );
        if (result.created) {
          await appendReceiptTrustEvent(
            services,
            body.threadId,
            "receipt_trust.directory_quorum_promotion_baseline.promoted",
            {
              ...trustedReceiptEventPayload(envelope),
              baselineId: result.baseline.id,
              baselineSha256: result.baseline.contentSha256,
              selectedAnchorSetSha256: result.baseline.selectedAnchorSetSha256,
              selectedDirectorySha256: result.baseline.selectedDirectorySha256,
              selectedSubscriptionSetSha256:
                result.baseline.selectedSubscriptionSetSha256,
              selectedMetadataEnvelopeSetSha256:
                result.baseline.selectedMetadataEnvelopeSetSha256,
            },
          );
        }
        setPromoteReceiptTrustAnchorDirectoryQuorumPromotionBaselineResultHeaders(
          context,
          result,
        );
        return context.json(result, result.created ? 201 : 200);
      } catch (error) {
        const message = errorMessage(error);
        return jsonError(
          context,
          message,
          message.includes("requires an agreed quorum") ||
            message.includes("not trusted")
            ? 409
            : 400,
        );
      }
    },
  );

  app.post(
    "/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/verify",
    async (context) => {
      let input: unknown;
      try {
        input = await readLimitedJson(
          context.req.raw,
          MAX_TRUSTED_RECEIPT_BYTES + MAX_TRUST_ADMIN_REQUEST_BYTES,
          "Receipt trust anchor directory quorum promotion baseline verification request",
        );
      } catch (error) {
        if (error instanceof RequestBodyTooLargeError) {
          return jsonError(context, error.message, 413);
        }
        return jsonError(
          context,
          "Receipt trust anchor directory quorum promotion baseline verification request is invalid",
          400,
        );
      }
      const body =
        parseVerifyReceiptTrustAnchorDirectoryQuorumPromotionBaselineRequest(
          input,
        );
      if (!body) {
        return jsonError(
          context,
          "Receipt trust anchor directory quorum promotion baseline verification request is invalid",
          400,
        );
      }
      const trustDirectoryVerification =
        body.trustDirectory === undefined
          ? undefined
          : services.store.verifyReceiptTrustAnchorDirectory(
              body.trustDirectory,
              body.trustDirectoryPolicy,
            );
      const anchors =
        body.trustDirectory === undefined
          ? services.store.listReceiptTrustAnchors()
          : trustDirectoryVerification?.status === "valid"
            ? receiptTrustAnchorsFromDirectory(body.trustDirectory)
            : [];
      const verification =
        verifyReceiptTrustAnchorDirectoryQuorumPromotionBaseline(
          body.baseline,
          anchors,
          {
            ...(trustDirectoryVerification
              ? { trustDirectoryVerification }
              : {}),
          },
        );
      setReceiptTrustAnchorDirectoryQuorumPromotionBaselineVerificationHeaders(
        context,
        verification,
      );
      return context.json(verification);
    },
  );

  app.post(
    "/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/import",
    async (context) => {
      let input: unknown;
      try {
        input = await readLimitedJson(
          context.req.raw,
          MAX_TRUSTED_RECEIPT_BYTES + MAX_TRUST_ADMIN_REQUEST_BYTES,
          "Receipt trust anchor directory quorum promotion baseline import request",
        );
      } catch (error) {
        if (error instanceof RequestBodyTooLargeError) {
          return jsonError(context, error.message, 413);
        }
        return jsonError(
          context,
          "Receipt trust anchor directory quorum promotion baseline import request is invalid",
          400,
        );
      }
      const body =
        parseImportReceiptTrustAnchorDirectoryQuorumPromotionBaselineRequest(
          input,
        );
      if (!body) {
        return jsonError(
          context,
          "Receipt trust anchor directory quorum promotion baseline import request is invalid",
          400,
        );
      }
      const trustDirectoryVerification =
        body.trustDirectory === undefined
          ? undefined
          : services.store.verifyReceiptTrustAnchorDirectory(
              body.trustDirectory,
              body.trustDirectoryPolicy,
            );
      const anchors =
        body.trustDirectory === undefined
          ? services.store.listReceiptTrustAnchors()
          : trustDirectoryVerification?.status === "valid"
            ? receiptTrustAnchorsFromDirectory(body.trustDirectory)
            : [];
      const verification =
        verifyReceiptTrustAnchorDirectoryQuorumPromotionBaseline(
          body.baseline,
          anchors,
          {
            ...(trustDirectoryVerification
              ? { trustDirectoryVerification }
              : {}),
          },
        );
      if (
        verification.status !== "trusted" ||
        !verification.baselineValid ||
        !verification.signatureValid ||
        !verification.integrityValid
      ) {
        return jsonError(
          context,
          "Receipt trust anchor directory quorum promotion baseline import requires trusted verification",
          409,
        );
      }
      try {
        const imported =
          await services.store.importReceiptTrustAnchorDirectoryQuorumPromotionBaseline(
            body.threadId,
            body.baseline,
            body.expectedCurrentBaselineSha256,
            anchors,
            body.importPolicy,
          );
        if (imported.imported) {
          await appendReceiptTrustEvent(
            services,
            body.threadId,
            "receipt_trust.directory_quorum_promotion_baseline.imported",
            {
              baselineId: imported.baseline.id,
              baselineSha256: imported.baseline.contentSha256,
              importedReceiptSha256:
                imported.baseline.envelope.receipt.contentSha256,
              envelopeSha256: imported.baseline.envelope.contentSha256,
              keyId: imported.baseline.envelope.signature.keyId,
              expectedCurrentBaselineSha256: body.expectedCurrentBaselineSha256,
              ...(imported.previousBaselineSha256
                ? { previousBaselineSha256: imported.previousBaselineSha256 }
                : {}),
              verificationSha256: verification.contentSha256,
              ...(imported.policyReview
                ? {
                    importPolicySha256: imported.policyReview.policySha256,
                    importPolicyReviewSha256:
                      imported.policyReview.contentSha256,
                  }
                : {}),
            },
          );
        }
        const result: ImportReceiptTrustAnchorDirectoryQuorumPromotionBaselineResult =
          {
            baseline: imported.baseline,
            imported: imported.imported,
            verification,
            ...(imported.policyReview
              ? { policyReview: imported.policyReview }
              : {}),
            expectedCurrentBaselineSha256: body.expectedCurrentBaselineSha256,
            ...(imported.previousBaselineSha256
              ? { previousBaselineSha256: imported.previousBaselineSha256 }
              : {}),
          };
        setImportReceiptTrustAnchorDirectoryQuorumPromotionBaselineResultHeaders(
          context,
          result,
        );
        return context.json(result, imported.imported ? 201 : 200);
      } catch (error) {
        const message = errorMessage(error);
        return jsonError(
          context,
          message,
          message.includes("precondition") ||
            message.includes("policy rejected")
            ? 409
            : 400,
        );
      }
    },
  );

  app.get(
    "/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-decisions",
    (context) => {
      const history =
        services.store.getReceiptTrustAnchorDirectoryQuorumActivationDecisionHistory();
      setReceiptTrustAnchorDirectoryQuorumActivationDecisionHistoryHeaders(
        context,
        history,
      );
      return context.json(history);
    },
  );

  app.post(
    "/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-decisions/verify",
    async (context) => {
      let input: unknown;
      try {
        input = await readLimitedJson(
          context.req.raw,
          MAX_TRUSTED_RECEIPT_BYTES + MAX_TRUST_ADMIN_REQUEST_BYTES,
          "Receipt trust anchor directory quorum activation decision history verification request",
        );
      } catch (error) {
        if (error instanceof RequestBodyTooLargeError) {
          return jsonError(context, error.message, 413);
        }
        return jsonError(
          context,
          "Receipt trust anchor directory quorum activation decision history verification request is invalid",
          400,
        );
      }
      const body =
        parseVerifyReceiptTrustAnchorDirectoryQuorumActivationDecisionHistoryRequest(
          input,
        );
      if (!body) {
        return jsonError(
          context,
          "Receipt trust anchor directory quorum activation decision history verification request is invalid",
          400,
        );
      }
      const verification =
        services.store.verifyReceiptTrustAnchorDirectoryQuorumActivationDecisionHistory(
          body.history,
        );
      setReceiptTrustAnchorDirectoryQuorumActivationDecisionHistoryVerificationHeaders(
        context,
        verification,
      );
      return context.json(verification);
    },
  );

  app.get(
    "/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection",
    (context) => {
      const state =
        services.store.getReceiptTrustAnchorDirectoryQuorumActivationSelectionState();
      setReceiptTrustAnchorDirectoryQuorumActivationSelectionStateHeaders(
        context,
        state,
      );
      return context.json(state);
    },
  );

  app.get(
    "/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/drift-audit",
    (context) => {
      const audit =
        services.store.getReceiptTrustAnchorDirectoryQuorumActivationSelectionDriftAudit();
      setReceiptTrustAnchorDirectoryQuorumActivationSelectionDriftAuditHeaders(
        context,
        audit,
      );
      return context.json(audit);
    },
  );

  app.get(
    "/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/transparency-checkpoint",
    (context) => {
      const checkpoint =
        services.store.getReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpoint();
      setReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointHeaders(
        context,
        checkpoint,
      );
      return context.json(checkpoint);
    },
  );

  app.post(
    "/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/transparency-checkpoint/verify",
    async (context) => {
      let input: unknown;
      try {
        input = await readLimitedJson(
          context.req.raw,
          MAX_TRUST_ADMIN_REQUEST_BYTES,
          "Receipt trust anchor directory quorum activation selection transparency checkpoint verification request",
        );
      } catch (error) {
        if (error instanceof RequestBodyTooLargeError) {
          return jsonError(context, error.message, 413);
        }
        return jsonError(
          context,
          "Receipt trust anchor directory quorum activation selection transparency checkpoint verification request is invalid",
          400,
        );
      }
      const body =
        parseVerifyReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRequest(
          input,
        );
      if (!body) {
        return jsonError(
          context,
          "Receipt trust anchor directory quorum activation selection transparency checkpoint verification request is invalid",
          400,
        );
      }
      const verification =
        services.store.verifyReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpoint(
          body.checkpoint,
        );
      setReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointVerificationHeaders(
        context,
        verification,
      );
      return context.json(verification);
    },
  );

  app.post(
    "/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/transparency-checkpoint/discover",
    async (context) => {
      let input: unknown;
      try {
        input = await readLimitedJson(
          context.req.raw,
          MAX_TRUSTED_RECEIPT_BYTES + MAX_TRUST_ADMIN_REQUEST_BYTES,
          "Receipt trust anchor directory quorum activation selection transparency checkpoint discovery request",
        );
      } catch (error) {
        if (error instanceof RequestBodyTooLargeError) {
          return jsonError(context, error.message, 413);
        }
        return jsonError(
          context,
          "Receipt trust anchor directory quorum activation selection transparency checkpoint discovery request is invalid",
          400,
        );
      }
      const body =
        parseDiscoverReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRequest(
          input,
        );
      if (!body) {
        return jsonError(
          context,
          "Receipt trust anchor directory quorum activation selection transparency checkpoint discovery request is invalid",
          400,
        );
      }
      try {
        const source = await services.receiptTrustDirectories.fetchJson(
          body.sourceUrl,
        );
        const discovery =
          createHostedReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointDiscovery(
            services.store,
            source,
            body,
          );
        setReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointDiscoveryHeaders(
          context,
          discovery,
        );
        return context.json(
          discovery,
          discovery.status === "valid" ? 200 : 422,
        );
      } catch (error) {
        const message = errorMessage(error);
        return jsonError(
          context,
          "Receipt trust anchor directory quorum activation selection transparency checkpoint discovery failed",
          error instanceof ReceiptTrustAnchorDirectoryDiscoveryError
            ? error.status
            : message.includes("checkpoint")
              ? 422
              : 400,
        );
      }
    },
  );

  app.get(
    "/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/transparency-checkpoint/subscriptions",
    (context) => {
      const subscriptions =
        services.store.listReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptions();
      setReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionListHeaders(
        context,
        subscriptions,
      );
      return context.json(subscriptions);
    },
  );

  app.post(
    "/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/transparency-checkpoint/subscriptions/quorum",
    async (context) => {
      let input: unknown;
      try {
        input = await readLimitedJson(
          context.req.raw,
          MAX_TRUST_ADMIN_REQUEST_BYTES,
          "Receipt trust anchor directory quorum activation selection transparency checkpoint registry quorum request",
        );
      } catch (error) {
        return jsonError(
          context,
          error instanceof RequestBodyTooLargeError
            ? error.message
            : "Receipt trust anchor directory quorum activation selection transparency checkpoint registry quorum request is invalid",
          error instanceof RequestBodyTooLargeError ? 413 : 400,
        );
      }
      const body =
        parseEvaluateReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumRequest(
          input,
        );
      if (!body) {
        return jsonError(
          context,
          "Receipt trust anchor directory quorum activation selection transparency checkpoint registry quorum request is invalid",
          400,
        );
      }
      const quorum =
        services.store.getReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorum(
          body.policy,
        );
      setReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumHeaders(
        context,
        quorum,
      );
      return context.json(quorum);
    },
  );

  app.get(
    "/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/transparency-checkpoint/subscriptions/quorum/baselines",
    (context) => {
      const baselines =
        services.store.listReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselines();
      setReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselineListHeaders(
        context,
        baselines,
      );
      return context.json(baselines);
    },
  );

  app.post(
    "/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/transparency-checkpoint/subscriptions/quorum/baselines",
    async (context) => {
      let input: unknown;
      try {
        input = await readLimitedJson(
          context.req.raw,
          MAX_TRUST_ADMIN_REQUEST_BYTES,
          "Receipt trust anchor directory quorum activation selection transparency checkpoint registry quorum baseline request",
        );
      } catch (error) {
        return jsonError(
          context,
          error instanceof RequestBodyTooLargeError
            ? error.message
            : "Receipt trust anchor directory quorum activation selection transparency checkpoint registry quorum baseline request is invalid",
          error instanceof RequestBodyTooLargeError ? 413 : 400,
        );
      }
      const body =
        parsePromoteReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselineRequest(
          input,
        );
      if (!body) {
        return jsonError(
          context,
          "Receipt trust anchor directory quorum activation selection transparency checkpoint registry quorum baseline request is invalid",
          400,
        );
      }
      try {
        services.store.getThread(body.threadId);
        const quorum =
          services.store.getReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorum(
            body.policy,
          );
        const envelope = signTrustedReceipt(
          quorum,
          services.store.getReceiptTrustAnchor(body.trustAnchorId),
        );
        const result =
          await services.store.promoteReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaseline(
            body.threadId,
            envelope,
          );
        if (result.created) {
          await appendReceiptTrustEvent(
            services,
            body.threadId,
            "receipt_trust.checkpoint_registry_quorum_baseline.promoted",
            {
              ...trustedReceiptEventPayload(envelope),
              baselineId: result.baseline.id,
              baselineSha256: result.baseline.contentSha256,
              selectedCheckpointSha256:
                result.baseline.selectedCheckpointSha256,
              selectedSelectionSetSha256:
                result.baseline.selectedSelectionSetSha256,
              selectedSelectionChainTailSha256:
                result.baseline.selectedSelectionChainTailSha256 ?? "",
              selectedSubscriptionSetSha256:
                result.baseline.selectedSubscriptionSetSha256,
              selectedSourceOriginSetSha256:
                result.baseline.selectedSourceOriginSetSha256,
              selectedSignerSetSha256: result.baseline.selectedSignerSetSha256,
            },
          );
        }
        setPromoteReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselineResultHeaders(
          context,
          result,
        );
        return context.json(result, result.created ? 201 : 200);
      } catch (error) {
        const message = errorMessage(error);
        return jsonError(
          context,
          message,
          message.includes("requires an agreed quorum") ||
            message.includes("not trusted")
            ? 409
            : 400,
        );
      }
    },
  );

  app.post(
    "/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/transparency-checkpoint/subscriptions/quorum/baselines/verify",
    async (context) => {
      let input: unknown;
      try {
        input = await readLimitedJson(
          context.req.raw,
          MAX_TRUSTED_RECEIPT_BYTES + MAX_TRUST_ADMIN_REQUEST_BYTES,
          "Receipt trust checkpoint registry quorum baseline verification request",
        );
      } catch (error) {
        return jsonError(
          context,
          error instanceof RequestBodyTooLargeError
            ? error.message
            : "Receipt trust checkpoint registry quorum baseline verification request is invalid",
          error instanceof RequestBodyTooLargeError ? 413 : 400,
        );
      }
      const body =
        parseVerifyReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselineRequest(
          input,
        );
      if (!body) {
        return jsonError(
          context,
          "Receipt trust checkpoint registry quorum baseline verification request is invalid",
          400,
        );
      }
      const trustDirectoryVerification =
        body.trustDirectory === undefined
          ? undefined
          : services.store.verifyReceiptTrustAnchorDirectory(
              body.trustDirectory,
              body.trustDirectoryPolicy,
            );
      const anchors =
        body.trustDirectory === undefined
          ? services.store.listReceiptTrustAnchors()
          : trustDirectoryVerification?.status === "valid"
            ? receiptTrustAnchorsFromDirectory(body.trustDirectory)
            : [];
      const verification =
        verifyReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaseline(
          body.baseline,
          anchors,
          {
            ...(trustDirectoryVerification
              ? { trustDirectoryVerification }
              : {}),
          },
        );
      setReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselineVerificationHeaders(
        context,
        verification,
      );
      return context.json(verification);
    },
  );

  app.post(
    "/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/transparency-checkpoint/subscriptions/quorum/baselines/import",
    async (context) => {
      let input: unknown;
      try {
        input = await readLimitedJson(
          context.req.raw,
          MAX_TRUSTED_RECEIPT_BYTES + MAX_TRUST_ADMIN_REQUEST_BYTES,
          "Receipt trust checkpoint registry quorum baseline import request",
        );
      } catch (error) {
        return jsonError(
          context,
          error instanceof RequestBodyTooLargeError
            ? error.message
            : "Receipt trust checkpoint registry quorum baseline import request is invalid",
          error instanceof RequestBodyTooLargeError ? 413 : 400,
        );
      }
      const body =
        parseImportReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselineRequest(
          input,
        );
      if (!body) {
        return jsonError(
          context,
          "Receipt trust checkpoint registry quorum baseline import request is invalid",
          400,
        );
      }
      const trustDirectoryVerification =
        body.trustDirectory === undefined
          ? undefined
          : services.store.verifyReceiptTrustAnchorDirectory(
              body.trustDirectory,
              body.trustDirectoryPolicy,
            );
      const anchors =
        body.trustDirectory === undefined
          ? services.store.listReceiptTrustAnchors()
          : trustDirectoryVerification?.status === "valid"
            ? receiptTrustAnchorsFromDirectory(body.trustDirectory)
            : [];
      const verification =
        verifyReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaseline(
          body.baseline,
          anchors,
          {
            ...(trustDirectoryVerification
              ? { trustDirectoryVerification }
              : {}),
          },
        );
      if (
        verification.status !== "trusted" ||
        !verification.baselineValid ||
        !verification.signatureValid ||
        !verification.integrityValid
      ) {
        return jsonError(
          context,
          "Receipt trust checkpoint registry quorum baseline import requires trusted verification",
          409,
        );
      }
      try {
        const imported =
          await services.store.importReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaseline(
            body.threadId,
            body.baseline,
            body.expectedCurrentBaselineSha256,
            anchors,
          );
        if (imported.imported) {
          await appendReceiptTrustEvent(
            services,
            body.threadId,
            "receipt_trust.checkpoint_registry_quorum_baseline.imported",
            {
              baselineId: imported.baseline.id,
              baselineSha256: imported.baseline.contentSha256,
              expectedCurrentBaselineSha256: body.expectedCurrentBaselineSha256,
              previousBaselineSha256: imported.previousBaselineSha256 ?? "",
              verificationSha256: verification.contentSha256,
              envelopeSha256: imported.baseline.envelope.contentSha256,
              selectedCheckpointSha256:
                imported.baseline.selectedCheckpointSha256,
              selectedSelectionSetSha256:
                imported.baseline.selectedSelectionSetSha256,
              selectedSelectionChainTailSha256:
                imported.baseline.selectedSelectionChainTailSha256 ?? "",
              selectedSubscriptionSetSha256:
                imported.baseline.selectedSubscriptionSetSha256,
              selectedSourceOriginSetSha256:
                imported.baseline.selectedSourceOriginSetSha256,
              selectedSignerSetSha256:
                imported.baseline.selectedSignerSetSha256,
            },
          );
        }
        const result: ImportReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselineResult =
          {
            baseline: imported.baseline,
            imported: imported.imported,
            verification,
            expectedCurrentBaselineSha256: body.expectedCurrentBaselineSha256,
            ...(imported.previousBaselineSha256
              ? { previousBaselineSha256: imported.previousBaselineSha256 }
              : {}),
          };
        setImportReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselineResultHeaders(
          context,
          result,
        );
        return context.json(result, imported.imported ? 201 : 200);
      } catch (error) {
        const message = errorMessage(error);
        return jsonError(
          context,
          message,
          message.includes("precondition failed") ||
            message.includes("not trusted")
            ? 409
            : 400,
        );
      }
    },
  );

  app.post(
    "/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/transparency-checkpoint/subscriptions",
    async (context) => {
      let input: unknown;
      try {
        input = await readLimitedJson(
          context.req.raw,
          MAX_TRUST_ADMIN_REQUEST_BYTES,
          "Receipt trust anchor directory quorum activation selection transparency checkpoint subscription request",
        );
      } catch (error) {
        return jsonError(
          context,
          error instanceof RequestBodyTooLargeError
            ? error.message
            : "Receipt trust anchor directory quorum activation selection transparency checkpoint subscription request is invalid",
          error instanceof RequestBodyTooLargeError ? 413 : 400,
        );
      }
      const body =
        parseCreateReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionRequest(
          input,
        );
      if (!body) {
        return jsonError(
          context,
          "Receipt trust anchor directory quorum activation selection transparency checkpoint subscription request is invalid",
          400,
        );
      }
      let discovery: ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointDiscovery;
      try {
        const source = await services.receiptTrustDirectories.fetchJson(
          body.sourceUrl,
        );
        discovery =
          createHostedReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointDiscovery(
            services.store,
            source,
            {
              sourceUrl: body.sourceUrl,
              policy: body.policy,
            },
          );
      } catch (error) {
        if (error instanceof ReceiptTrustAnchorDirectoryDiscoveryError) {
          return jsonError(context, error.message, error.status);
        }
        return jsonError(
          context,
          "Receipt trust anchor directory quorum activation selection transparency checkpoint subscription discovery failed",
          502,
        );
      }
      if (discovery.status !== "valid") {
        setReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointDiscoveryHeaders(
          context,
          discovery,
        );
        return context.json(discovery, 422);
      }
      const subscription =
        await services.store.createReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription(
          body,
          discovery,
        );
      await appendReceiptTrustEvent(
        services,
        subscription.auditThreadId,
        "receipt.trust_checkpoint_subscription.created",
        {
          subscriptionId: subscription.id,
          subscriptionRevision: subscription.revision,
          subscriptionSha256: subscription.contentSha256,
          sourceUrlSha256: subscription.sourceUrlSha256,
          sourceOriginSha256: subscription.sourceOriginSha256,
          policySha256: subscription.policySha256,
          envelopeSha256: subscription.lastGoodDiscovery?.envelopeSha256 ?? "",
          checkpointSha256:
            subscription.lastGoodDiscovery?.checkpointSha256 ?? "",
          selectionCount: subscription.lastGoodDiscovery?.selectionCount ?? 0,
          selectionChainTailSha256:
            subscription.lastGoodDiscovery?.selectionChainTailSha256 ?? "",
        },
      );
      setReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionHeaders(
        context,
        subscription,
      );
      return context.json(subscription, 201);
    },
  );

  app.post(
    "/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/transparency-checkpoint/subscriptions/:subscriptionId/refresh",
    async (context) => {
      let input: unknown;
      try {
        input = await readLimitedJson(
          context.req.raw,
          MAX_TRUST_ADMIN_REQUEST_BYTES,
          "Receipt trust anchor directory quorum activation selection transparency checkpoint subscription refresh request",
        );
      } catch (error) {
        return jsonError(
          context,
          error instanceof RequestBodyTooLargeError
            ? error.message
            : "Receipt trust anchor directory quorum activation selection transparency checkpoint subscription refresh request is invalid",
          error instanceof RequestBodyTooLargeError ? 413 : 400,
        );
      }
      const body =
        parseRefreshReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionRequest(
          input,
        );
      if (!body) {
        return jsonError(
          context,
          "Receipt trust anchor directory quorum activation selection transparency checkpoint subscription refresh request is invalid",
          400,
        );
      }
      const result =
        await services.receiptTrustDirectorySubscriptions.refreshCheckpoint(
          context.req.param("subscriptionId"),
          body.threadId,
          body.expectedRevision,
        );
      setReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionRefreshHeaders(
        context,
        result,
      );
      return context.json(result);
    },
  );

  app.post(
    "/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/transparency-checkpoint/subscriptions/:subscriptionId",
    async (context) => {
      let input: unknown;
      try {
        input = await readLimitedJson(
          context.req.raw,
          MAX_TRUST_ADMIN_REQUEST_BYTES,
          "Receipt trust anchor directory quorum activation selection transparency checkpoint subscription update request",
        );
      } catch (error) {
        return jsonError(
          context,
          error instanceof RequestBodyTooLargeError
            ? error.message
            : "Receipt trust anchor directory quorum activation selection transparency checkpoint subscription update request is invalid",
          error instanceof RequestBodyTooLargeError ? 413 : 400,
        );
      }
      const body =
        parseUpdateReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionRequest(
          input,
        );
      if (!body) {
        return jsonError(
          context,
          "Receipt trust anchor directory quorum activation selection transparency checkpoint subscription update request is invalid",
          400,
        );
      }
      const before =
        services.store.getReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription(
          context.req.param("subscriptionId"),
        );
      const subscription =
        await services.store.updateReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription(
          before.id,
          body,
        );
      if (before.revision !== subscription.revision) {
        await appendReceiptTrustEvent(
          services,
          subscription.auditThreadId,
          "receipt.trust_checkpoint_subscription.updated",
          {
            subscriptionId: subscription.id,
            subscriptionRevision: subscription.revision,
            subscriptionSha256: subscription.contentSha256,
            sourceUrlSha256: subscription.sourceUrlSha256,
            sourceOriginSha256: subscription.sourceOriginSha256,
            status: subscription.status,
          },
        );
      }
      setReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionHeaders(
        context,
        subscription,
      );
      return context.json(subscription);
    },
  );

  app.post(
    "/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/transparency-checkpoint/sign",
    async (context) => {
      let input: unknown;
      try {
        input = await readLimitedJson(
          context.req.raw,
          MAX_TRUST_ADMIN_REQUEST_BYTES,
          "Receipt trust anchor directory quorum activation selection transparency checkpoint signing request",
        );
      } catch (error) {
        if (error instanceof RequestBodyTooLargeError) {
          return jsonError(context, error.message, 413);
        }
        return jsonError(
          context,
          "Receipt trust anchor directory quorum activation selection transparency checkpoint signing request is invalid",
          400,
        );
      }
      const body =
        parseSignReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRequest(
          input,
        );
      if (!body) {
        return jsonError(
          context,
          "Receipt trust anchor directory quorum activation selection transparency checkpoint signing request is invalid",
          400,
        );
      }
      try {
        services.store.getThread(body.threadId);
        const checkpoint =
          services.store.getReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpoint();
        const envelope = signTrustedReceipt(
          checkpoint,
          services.store.getReceiptTrustAnchor(body.trustAnchorId),
        );
        await appendReceiptTrustEvent(
          services,
          body.threadId,
          "receipt.signed",
          {
            ...trustedReceiptEventPayload(envelope),
            checkpointSha256: checkpoint.contentSha256,
            selectionCount: checkpoint.selectionCount,
            selectionSetSha256: checkpoint.selectionSetSha256,
            ...(checkpoint.selectionChainTailSha256
              ? {
                  selectionChainTailSha256: checkpoint.selectionChainTailSha256,
                }
              : {}),
            driftStatus: checkpoint.driftStatus,
          },
        );
        setTrustedReceiptHeaders(
          context,
          envelope,
          `napier-signed-quorum-activation-selection-checkpoint-${envelope.contentSha256.slice(0, 12)}.json`,
        );
        return context.json(envelope, 201);
      } catch (error) {
        const message = errorMessage(error);
        const caught = error instanceof Error ? error : new Error(message);
        return jsonError(
          context,
          message,
          isReceiptTrustConflict(caught) ? 409 : 400,
        );
      }
    },
  );

  app.post(
    "/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/rotation-review",
    async (context) => {
      let input: unknown;
      try {
        input = await readLimitedJson(
          context.req.raw,
          MAX_TRUST_ADMIN_REQUEST_BYTES,
          "Receipt trust anchor directory quorum activation selection rotation review request",
        );
      } catch (error) {
        if (error instanceof RequestBodyTooLargeError) {
          return jsonError(context, error.message, 413);
        }
        return jsonError(
          context,
          "Receipt trust anchor directory quorum activation selection rotation review request is invalid",
          400,
        );
      }
      const body =
        parseReviewReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationRequest(
          input,
        );
      if (!body) {
        return jsonError(
          context,
          "Receipt trust anchor directory quorum activation selection rotation review request is invalid",
          400,
        );
      }
      const review =
        services.store.reviewReceiptTrustAnchorDirectoryQuorumActivationSelectionRotation(
          body.activationDecisionRecordId,
          body.expectedCurrentSelectionSha256,
          body.checkpointRegistryQuorumPolicy,
        );
      setReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationReviewHeaders(
        context,
        review,
      );
      return context.json(review);
    },
  );

  app.post(
    "/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/rotation-proposal",
    async (context) => {
      let input: unknown;
      try {
        input = await readLimitedJson(
          context.req.raw,
          MAX_TRUST_ADMIN_REQUEST_BYTES,
          "Receipt trust anchor directory quorum activation selection rotation proposal request",
        );
      } catch (error) {
        if (error instanceof RequestBodyTooLargeError) {
          return jsonError(context, error.message, 413);
        }
        return jsonError(
          context,
          "Receipt trust anchor directory quorum activation selection rotation proposal request is invalid",
          400,
        );
      }
      const body =
        parseProposeReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationRequest(
          input,
        );
      if (!body) {
        return jsonError(
          context,
          "Receipt trust anchor directory quorum activation selection rotation proposal request is invalid",
          400,
        );
      }
      const proposal =
        services.store.proposeReceiptTrustAnchorDirectoryQuorumActivationSelectionRotation(
          body.activationDecisionRecordId,
          body.expectedCurrentSelectionSha256,
          {
            ...(body.checkpointRegistryQuorumBaselineId
              ? {
                  checkpointRegistryQuorumBaselineId:
                    body.checkpointRegistryQuorumBaselineId,
                }
              : {}),
            ...(body.expectedCheckpointRegistryQuorumBaselineSha256
              ? {
                  expectedCheckpointRegistryQuorumBaselineSha256:
                    body.expectedCheckpointRegistryQuorumBaselineSha256,
                }
              : {}),
            ...(body.checkpointRegistryQuorumPolicy
              ? {
                  checkpointRegistryQuorumPolicy:
                    body.checkpointRegistryQuorumPolicy,
                }
              : {}),
          },
        );
      setReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalHeaders(
        context,
        proposal,
      );
      return context.json(proposal);
    },
  );

  app.post(
    "/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/rotation-proposal/sign",
    async (context) => {
      let input: unknown;
      try {
        input = await readLimitedJson(
          context.req.raw,
          MAX_TRUST_ADMIN_REQUEST_BYTES,
          "Receipt trust anchor directory quorum activation selection rotation proposal signing request",
        );
      } catch (error) {
        if (error instanceof RequestBodyTooLargeError) {
          return jsonError(context, error.message, 413);
        }
        return jsonError(
          context,
          "Receipt trust anchor directory quorum activation selection rotation proposal signing request is invalid",
          400,
        );
      }
      const body =
        parseSignReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalRequest(
          input,
        );
      if (!body) {
        return jsonError(
          context,
          "Receipt trust anchor directory quorum activation selection rotation proposal signing request is invalid",
          400,
        );
      }
      try {
        services.store.getThread(body.threadId);
        const proposal =
          services.store.proposeReceiptTrustAnchorDirectoryQuorumActivationSelectionRotation(
            body.activationDecisionRecordId,
            body.expectedCurrentSelectionSha256,
            {
              ...(body.checkpointRegistryQuorumBaselineId
                ? {
                    checkpointRegistryQuorumBaselineId:
                      body.checkpointRegistryQuorumBaselineId,
                  }
                : {}),
              ...(body.expectedCheckpointRegistryQuorumBaselineSha256
                ? {
                    expectedCheckpointRegistryQuorumBaselineSha256:
                      body.expectedCheckpointRegistryQuorumBaselineSha256,
                  }
                : {}),
              ...(body.checkpointRegistryQuorumPolicy
                ? {
                    checkpointRegistryQuorumPolicy:
                      body.checkpointRegistryQuorumPolicy,
                  }
                : {}),
            },
          );
        if (proposal.status !== "proposed") {
          return jsonError(
            context,
            "Receipt trust anchor directory quorum activation selection rotation proposal is not eligible for signing",
            409,
          );
        }
        const envelope = signTrustedReceipt(
          proposal,
          services.store.getReceiptTrustAnchor(body.trustAnchorId),
        );
        await appendReceiptTrustEvent(
          services,
          body.threadId,
          "receipt.signed",
          {
            ...trustedReceiptEventPayload(envelope),
            proposalSha256: proposal.contentSha256,
            rotationReviewSha256: proposal.rotationReviewSha256,
            activationDecisionRecordId: proposal.activationDecisionRecordId,
            ...(proposal.activationDecisionRecordSha256
              ? {
                  activationDecisionRecordSha256:
                    proposal.activationDecisionRecordSha256,
                }
              : {}),
            expectedCurrentSelectionSha256:
              proposal.expectedCurrentSelectionSha256,
            currentSelectionSha256: proposal.currentSelectionSha256,
            ...(proposal.checkpointRegistryQuorumBaselineSha256
              ? {
                  checkpointRegistryQuorumBaselineSha256:
                    proposal.checkpointRegistryQuorumBaselineSha256,
                }
              : {}),
            currentCheckpointSha256: proposal.currentCheckpointSha256,
          },
        );
        setTrustedReceiptHeaders(
          context,
          envelope,
          `napier-signed-quorum-activation-selection-rotation-proposal-${envelope.contentSha256.slice(0, 12)}.json`,
        );
        return context.json(envelope, 201);
      } catch (error) {
        return jsonError(context, errorMessage(error), 400);
      }
    },
  );

  app.post(
    "/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/rotation-proposal/discover",
    async (context) => {
      let input: unknown;
      try {
        input = await readLimitedJson(
          context.req.raw,
          MAX_TRUST_ADMIN_REQUEST_BYTES,
          "Receipt trust anchor directory quorum activation selection rotation proposal discovery request",
        );
      } catch (error) {
        if (error instanceof RequestBodyTooLargeError) {
          return jsonError(context, error.message, 413);
        }
        return jsonError(
          context,
          "Receipt trust anchor directory quorum activation selection rotation proposal discovery request is invalid",
          400,
        );
      }
      const body =
        parseDiscoverReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalRequest(
          input,
        );
      if (!body) {
        return jsonError(
          context,
          "Receipt trust anchor directory quorum activation selection rotation proposal discovery request is invalid",
          400,
        );
      }
      try {
        services.store.getThread(body.threadId);
        const source = await services.receiptTrustDirectories.fetchJson(
          body.sourceUrl,
        );
        const discovery =
          createReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalDiscovery(
            services.store,
            body,
            source,
          );
        setReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalDiscoveryHeaders(
          context,
          discovery,
        );
        return context.json(
          discovery,
          discovery.status === "valid" ? 200 : 422,
        );
      } catch (error) {
        if (error instanceof ReceiptTrustAnchorDirectoryDiscoveryError) {
          return jsonError(context, error.message, error.status);
        }
        return jsonError(
          context,
          "Receipt trust anchor directory quorum activation selection rotation proposal discovery failed",
          502,
        );
      }
    },
  );

  app.get(
    "/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/rotation-proposal/subscriptions",
    (context) => {
      const subscriptions =
        services.store.listReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptions();
      setReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionListHeaders(
        context,
        subscriptions,
      );
      return context.json(subscriptions);
    },
  );

  app.post(
    "/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/rotation-proposal/subscriptions",
    async (context) => {
      let input: unknown;
      try {
        input = await readLimitedJson(
          context.req.raw,
          MAX_TRUST_ADMIN_REQUEST_BYTES,
          "Receipt trust anchor directory quorum activation selection rotation proposal subscription request",
        );
      } catch (error) {
        return jsonError(
          context,
          error instanceof RequestBodyTooLargeError
            ? error.message
            : "Receipt trust anchor directory quorum activation selection rotation proposal subscription request is invalid",
          error instanceof RequestBodyTooLargeError ? 413 : 400,
        );
      }
      const body =
        parseCreateReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionRequest(
          input,
        );
      if (!body) {
        return jsonError(
          context,
          "Receipt trust anchor directory quorum activation selection rotation proposal subscription request is invalid",
          400,
        );
      }
      let discovery: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalDiscovery;
      try {
        services.store.getThread(body.threadId);
        const source = await services.receiptTrustDirectories.fetchJson(
          body.sourceUrl,
        );
        discovery =
          createReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalDiscovery(
            services.store,
            body,
            source,
          );
      } catch (error) {
        if (error instanceof ReceiptTrustAnchorDirectoryDiscoveryError) {
          return jsonError(context, error.message, error.status);
        }
        return jsonError(
          context,
          "Receipt trust anchor directory quorum activation selection rotation proposal subscription discovery failed",
          502,
        );
      }
      if (discovery.status !== "valid") {
        setReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalDiscoveryHeaders(
          context,
          discovery,
        );
        return context.json(discovery, 422);
      }
      const subscription =
        await services.store.createReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription(
          body,
          discovery,
        );
      await appendReceiptTrustEvent(
        services,
        subscription.auditThreadId,
        "receipt.trust_rotation_proposal_subscription.created",
        {
          subscriptionId: subscription.id,
          subscriptionRevision: subscription.revision,
          subscriptionSha256: subscription.contentSha256,
          sourceUrlSha256: subscription.sourceUrlSha256,
          sourceOriginSha256: subscription.sourceOriginSha256,
          policySha256: subscription.policySha256,
          envelopeSha256: subscription.lastGoodDiscovery?.envelopeSha256 ?? "",
          proposalSha256: subscription.lastGoodDiscovery?.proposalSha256 ?? "",
          preflightSha256:
            subscription.lastGoodDiscovery?.preflight?.contentSha256 ?? "",
        },
      );
      setReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionHeaders(
        context,
        subscription,
      );
      return context.json(subscription, 201);
    },
  );

  app.post(
    "/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/rotation-proposal/subscriptions/:subscriptionId/refresh",
    async (context) => {
      let input: unknown;
      try {
        input = await readLimitedJson(
          context.req.raw,
          MAX_TRUST_ADMIN_REQUEST_BYTES,
          "Receipt trust anchor directory quorum activation selection rotation proposal subscription refresh request",
        );
      } catch (error) {
        return jsonError(
          context,
          error instanceof RequestBodyTooLargeError
            ? error.message
            : "Receipt trust anchor directory quorum activation selection rotation proposal subscription refresh request is invalid",
          error instanceof RequestBodyTooLargeError ? 413 : 400,
        );
      }
      const body =
        parseRefreshReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionRequest(
          input,
        );
      if (!body) {
        return jsonError(
          context,
          "Receipt trust anchor directory quorum activation selection rotation proposal subscription refresh request is invalid",
          400,
        );
      }
      const subscriptionId = context.req.param("subscriptionId");
      const result =
        await services.receiptTrustDirectorySubscriptions.refreshRotationProposal(
          subscriptionId,
          body.threadId,
          body.expectedRevision,
        );
      setReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionRefreshHeaders(
        context,
        result,
      );
      return context.json(result);
    },
  );

  app.post(
    "/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/rotation-proposal/subscriptions/:subscriptionId/approval/sign",
    async (context) => {
      let input: unknown;
      try {
        input = await readLimitedJson(
          context.req.raw,
          MAX_TRUST_ADMIN_REQUEST_BYTES,
          "Receipt trust anchor directory quorum activation selection rotation proposal subscription approval signing request",
        );
      } catch (error) {
        if (error instanceof RequestBodyTooLargeError) {
          return jsonError(context, error.message, 413);
        }
        return jsonError(
          context,
          "Receipt trust anchor directory quorum activation selection rotation proposal subscription approval signing request is invalid",
          400,
        );
      }
      const body =
        parseSignReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalRequest(
          input,
        );
      if (!body) {
        return jsonError(
          context,
          "Receipt trust anchor directory quorum activation selection rotation proposal subscription approval signing request is invalid",
          400,
        );
      }
      try {
        services.store.getThread(body.threadId);
        const subscription =
          services.store.getReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription(
            context.req.param("subscriptionId"),
          );
        const approval =
          createReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApproval(
            services.store,
            subscription,
            body,
          );
        const envelope = signTrustedReceipt(
          approval,
          services.store.getReceiptTrustAnchor(body.trustAnchorId),
        );
        const approvalApplyAfter = body.queueForApply
          ? (body.applyAfter ?? new Date().toISOString())
          : undefined;
        const queuedSubscription = body.queueForApply
          ? await services.store.queueReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalApprovalApply(
              approval.subscriptionId,
              body.threadId,
              approval.subscriptionRevision,
              approval.subscriptionSha256,
              envelope,
              approvalApplyAfter,
            )
          : undefined;
        await appendReceiptTrustEvent(
          services,
          body.threadId,
          "receipt.signed",
          {
            ...trustedReceiptEventPayload(envelope),
            subscriptionId: approval.subscriptionId,
            subscriptionRevision: approval.subscriptionRevision,
            subscriptionSha256: approval.subscriptionSha256,
            sourceUrlSha256: approval.sourceUrlSha256,
            sourceOriginSha256: approval.sourceOriginSha256,
            policySha256: approval.policySha256,
            discoverySha256: approval.discoverySha256,
            envelopeSha256: approval.envelopeSha256,
            proposalSha256: approval.proposalSha256,
            approvalPreflightSha256: approval.approvalPreflightSha256,
            activationDecisionRecordId: approval.activationDecisionRecordId,
            expectedCurrentSelectionSha256:
              approval.expectedCurrentSelectionSha256,
            proposalSignerKeyId: approval.proposalSignerKeyId,
            ...(approval.checkpointRegistryQuorumBaselineSha256
              ? {
                  checkpointRegistryQuorumBaselineSha256:
                    approval.checkpointRegistryQuorumBaselineSha256,
                }
              : {}),
            ...(queuedSubscription
              ? {
                  queuedApprovalApply: true,
                  approvalApplyAfter: approvalApplyAfter ?? "",
                }
              : {}),
          },
        );
        if (queuedSubscription) {
          await appendReceiptTrustEvent(
            services,
            body.threadId,
            "receipt.trust_rotation_proposal_approval_apply.queued",
            {
              subscriptionId: queuedSubscription.id,
              subscriptionRevision: queuedSubscription.revision,
              subscriptionSha256: queuedSubscription.contentSha256,
              sourceUrlSha256: queuedSubscription.sourceUrlSha256,
              sourceOriginSha256: queuedSubscription.sourceOriginSha256,
              approvalEnvelopeSha256: envelope.contentSha256,
              approvalSha256: approval.contentSha256,
              proposalSha256: approval.proposalSha256,
              approvalPreflightSha256: approval.approvalPreflightSha256,
              applyAfter: approvalApplyAfter ?? "",
            },
          );
        }
        setTrustedReceiptHeaders(
          context,
          envelope,
          `napier-signed-quorum-activation-selection-rotation-proposal-subscription-approval-${envelope.contentSha256.slice(0, 12)}.json`,
        );
        return context.json(envelope, 201);
      } catch (error) {
        return jsonError(context, errorMessage(error), 400);
      }
    },
  );

  app.post(
    "/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/rotation-proposal/subscriptions/:subscriptionId/approval/apply",
    async (context) => {
      let input: unknown;
      try {
        input = await readLimitedJson(
          context.req.raw,
          MAX_TRUSTED_RECEIPT_BYTES + MAX_TRUST_ADMIN_REQUEST_BYTES,
          "Receipt trust anchor directory quorum activation selection rotation proposal subscription approval apply request",
        );
      } catch (error) {
        if (error instanceof RequestBodyTooLargeError) {
          return jsonError(context, error.message, 413);
        }
        return jsonError(
          context,
          "Receipt trust anchor directory quorum activation selection rotation proposal subscription approval apply request is invalid",
          400,
        );
      }
      const body =
        parseApplyReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalRequest(
          input,
        );
      if (!body) {
        return jsonError(
          context,
          "Receipt trust anchor directory quorum activation selection rotation proposal subscription approval apply request is invalid",
          400,
        );
      }
      try {
        services.store.getThread(body.threadId);
        const subscription =
          services.store.getReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription(
            context.req.param("subscriptionId"),
          );
        const approvalGate =
          verifyReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalApplyGate(
            services.store,
            subscription,
            body,
          );
        if (approvalGate.status === "rejected") {
          return jsonError(context, approvalGate.reason, 409);
        }
        const result =
          await services.store.applyReceiptTrustAnchorDirectoryQuorumActivationSelection(
            body.threadId,
            approvalGate.proposal.activationDecisionRecordId,
            approvalGate.proposal.expectedCurrentSelectionSha256,
          );
        if (result.applied) {
          await appendReceiptTrustEvent(
            services,
            body.threadId,
            "receipt.trust_directory_quorum_activation_selection.applied",
            {
              selectionId: result.selection.id,
              selectionSha256: result.selection.contentSha256,
              activationDecisionRecordId:
                result.selection.activationDecisionRecordId,
              activationDecisionRecordSha256:
                result.selection.activationDecisionRecordSha256,
              activationDecisionEnvelopeSha256:
                result.selection.activationDecisionEnvelopeSha256,
              baselineId: result.selection.baselineId,
              baselineSha256: result.selection.baselineSha256,
              selectedAnchorSetSha256: result.selection.selectedAnchorSetSha256,
              selectedDirectorySha256: result.selection.selectedDirectorySha256,
              expectedCurrentSelectionSha256:
                result.expectedCurrentSelectionSha256,
              ...(result.previousSelectionSha256
                ? { previousSelectionSha256: result.previousSelectionSha256 }
                : {}),
              rotationProposalEnvelopeSha256:
                approvalGate.proposalEnvelope.contentSha256,
              rotationProposalSha256: approvalGate.proposal.contentSha256,
              rotationProposalReviewSha256:
                approvalGate.proposal.rotationReviewSha256,
              rotationProposalCheckpointRegistryQuorumBaselineSha256:
                approvalGate.proposal.checkpointRegistryQuorumBaselineSha256 ??
                "",
              rotationProposalApprovalEnvelopeSha256:
                approvalGate.approvalEnvelope.contentSha256,
              rotationProposalApprovalSha256:
                approvalGate.approval.contentSha256,
              rotationProposalApprovalPreflightSha256:
                approvalGate.approval.approvalPreflightSha256,
              rotationProposalApprovalCurrentPreflightSha256:
                approvalGate.preflight.contentSha256,
              rotationProposalApprovalSignerKeyId:
                approvalGate.approvalEnvelope.signature.keyId,
              rotationProposalSubscriptionId:
                approvalGate.approval.subscriptionId,
              rotationProposalSubscriptionRevision:
                approvalGate.approval.subscriptionRevision,
              rotationProposalSubscriptionSha256:
                approvalGate.approval.subscriptionSha256,
              selectionStateSha256: result.selectionState.contentSha256,
              resultSha256: result.contentSha256,
            },
          );
        }
        setApplyReceiptTrustAnchorDirectoryQuorumActivationSelectionApprovalResultHeaders(
          context,
          result,
          approvalGate,
        );
        return context.json(result, result.applied ? 201 : 200);
      } catch (error) {
        return jsonError(context, errorMessage(error), 400);
      }
    },
  );

  app.post(
    "/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/rotation-proposal/subscriptions/:subscriptionId/approval/policy-review",
    async (context) => {
      let input: unknown;
      try {
        input = await readLimitedJson(
          context.req.raw,
          MAX_TRUSTED_RECEIPT_BYTES * 10 + MAX_TRUST_ADMIN_REQUEST_BYTES,
          "Receipt trust anchor directory quorum activation selection rotation proposal subscription approval policy review request",
        );
      } catch (error) {
        if (error instanceof RequestBodyTooLargeError) {
          return jsonError(context, error.message, 413);
        }
        return jsonError(
          context,
          "Receipt trust anchor directory quorum activation selection rotation proposal subscription approval policy review request is invalid",
          400,
        );
      }
      const body =
        parseReviewReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyRequest(
          input,
        );
      if (!body) {
        return jsonError(
          context,
          "Receipt trust anchor directory quorum activation selection rotation proposal subscription approval policy review request is invalid",
          400,
        );
      }
      try {
        services.store.getThread(body.threadId);
        const subscription =
          services.store.getReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription(
            context.req.param("subscriptionId"),
          );
        const { review } =
          createReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyReview(
            services.store,
            subscription,
            body,
          );
        setReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyReviewHeaders(
          context,
          review,
        );
        return context.json(review);
      } catch (error) {
        return jsonError(context, errorMessage(error), 400);
      }
    },
  );

  app.post(
    "/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/rotation-proposal/subscriptions/:subscriptionId/approval/policy-apply",
    async (context) => {
      let input: unknown;
      try {
        input = await readLimitedJson(
          context.req.raw,
          MAX_TRUSTED_RECEIPT_BYTES * 10 + MAX_TRUST_ADMIN_REQUEST_BYTES,
          "Receipt trust anchor directory quorum activation selection rotation proposal subscription approval policy apply request",
        );
      } catch (error) {
        if (error instanceof RequestBodyTooLargeError) {
          return jsonError(context, error.message, 413);
        }
        return jsonError(
          context,
          "Receipt trust anchor directory quorum activation selection rotation proposal subscription approval policy apply request is invalid",
          400,
        );
      }
      const body =
        parseApplyReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyRequest(
          input,
        );
      if (!body) {
        return jsonError(
          context,
          "Receipt trust anchor directory quorum activation selection rotation proposal subscription approval policy apply request is invalid",
          400,
        );
      }
      try {
        services.store.getThread(body.threadId);
        const subscription =
          services.store.getReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription(
            context.req.param("subscriptionId"),
          );
        const policyReview =
          createReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyReview(
            services.store,
            subscription,
            body,
          );
        if (
          policyReview.review.status !== "accepted" ||
          policyReview.acceptedGates.length === 0
        ) {
          setReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyReviewHeaders(
            context,
            policyReview.review,
          );
          return context.json(policyReview.review, 409);
        }
        const approvalGate = policyReview.acceptedGates[0]!;
        const result =
          await services.store.applyReceiptTrustAnchorDirectoryQuorumActivationSelection(
            body.threadId,
            approvalGate.proposal.activationDecisionRecordId,
            approvalGate.proposal.expectedCurrentSelectionSha256,
          );
        const applyResult =
          createReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyApplyResult(
            policyReview.review,
            result,
          );
        if (result.applied) {
          await appendReceiptTrustEvent(
            services,
            body.threadId,
            "receipt.trust_directory_quorum_activation_selection.policy_applied",
            {
              selectionId: result.selection.id,
              selectionSha256: result.selection.contentSha256,
              activationDecisionRecordId:
                result.selection.activationDecisionRecordId,
              activationDecisionRecordSha256:
                result.selection.activationDecisionRecordSha256,
              activationDecisionEnvelopeSha256:
                result.selection.activationDecisionEnvelopeSha256,
              baselineId: result.selection.baselineId,
              baselineSha256: result.selection.baselineSha256,
              selectedAnchorSetSha256: result.selection.selectedAnchorSetSha256,
              selectedDirectorySha256: result.selection.selectedDirectorySha256,
              expectedCurrentSelectionSha256:
                result.expectedCurrentSelectionSha256,
              ...(result.previousSelectionSha256
                ? { previousSelectionSha256: result.previousSelectionSha256 }
                : {}),
              rotationProposalEnvelopeSha256:
                approvalGate.proposalEnvelope.contentSha256,
              rotationProposalSha256: approvalGate.proposal.contentSha256,
              rotationProposalReviewSha256:
                approvalGate.proposal.rotationReviewSha256,
              rotationProposalApprovalPolicyReviewSha256:
                policyReview.review.contentSha256,
              rotationProposalApprovalPolicySha256:
                policyReview.review.approvalPolicySha256,
              rotationProposalApprovalPolicyDistinctSignerCount:
                policyReview.review.distinctSignerCount,
              rotationProposalApprovalPolicyAcceptedApprovalCount:
                policyReview.review.acceptedApprovalCount,
              rotationProposalApprovalPolicySignerSetSha256:
                policyReview.review.signerSetSha256,
              rotationProposalSubscriptionId:
                policyReview.review.subscriptionId,
              rotationProposalSubscriptionRevision:
                policyReview.review.subscriptionRevision,
              rotationProposalSubscriptionSha256:
                policyReview.review.subscriptionSha256,
              selectionStateSha256: result.selectionState.contentSha256,
              resultSha256: result.contentSha256,
              applyResultSha256: applyResult.contentSha256,
            },
          );
        }
        setReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyApplyResultHeaders(
          context,
          applyResult,
        );
        return context.json(applyResult, result.applied ? 201 : 200);
      } catch (error) {
        return jsonError(context, errorMessage(error), 400);
      }
    },
  );

  app.post(
    "/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/rotation-proposal/subscriptions/:subscriptionId/approval/policy-apply/queue",
    async (context) => {
      let input: unknown;
      try {
        input = await readLimitedJson(
          context.req.raw,
          MAX_TRUSTED_RECEIPT_BYTES * 10 + MAX_TRUST_ADMIN_REQUEST_BYTES,
          "Receipt trust anchor directory quorum activation selection rotation proposal subscription approval policy apply queue request",
        );
      } catch (error) {
        if (error instanceof RequestBodyTooLargeError) {
          return jsonError(context, error.message, 413);
        }
        return jsonError(
          context,
          "Receipt trust anchor directory quorum activation selection rotation proposal subscription approval policy apply queue request is invalid",
          400,
        );
      }
      const body =
        parseQueueReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyApplyRequest(
          input,
        );
      if (!body) {
        return jsonError(
          context,
          "Receipt trust anchor directory quorum activation selection rotation proposal subscription approval policy apply queue request is invalid",
          400,
        );
      }
      try {
        services.store.getThread(body.threadId);
        const subscription =
          services.store.getReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription(
            context.req.param("subscriptionId"),
          );
        const policyReview =
          createReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyReview(
            services.store,
            subscription,
            body,
          );
        if (
          policyReview.review.status !== "accepted" ||
          policyReview.acceptedGates.length === 0
        ) {
          setReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyReviewHeaders(
            context,
            policyReview.review,
          );
          return context.json(policyReview.review, 409);
        }
        const baselineGate =
          verifyReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaselineGate(
            services.store,
            policyReview.review,
            body.approvalPolicyBaselineSha256,
          );
        if (baselineGate.status === "rejected") {
          return jsonError(
            context,
            `Receipt trust anchor directory quorum activation selection rotation proposal subscription approval policy baseline is not accepted: ${baselineGate.diagnostics.join(",")}`,
            409,
          );
        }
        const applyAfter = body.applyAfter ?? new Date().toISOString();
        const queuedSubscription =
          await services.store.queueReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalApprovalPolicyApply(
            subscription.id,
            body.threadId,
            body.expectedSubscriptionRevision,
            body.expectedSubscriptionSha256,
            body.approvalEnvelopes,
            body.approvalPolicy,
            body.approvalPolicyBaselineSha256,
            applyAfter,
          );
        const queueResult =
          createReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyApplyQueueResult(
            queuedSubscription,
            policyReview.review,
            body.approvalPolicyBaselineSha256,
            applyAfter,
          );
        await appendReceiptTrustEvent(
          services,
          body.threadId,
          "receipt.trust_rotation_proposal_approval_policy_apply.queued",
          {
            subscriptionId: queuedSubscription.id,
            subscriptionRevision: queuedSubscription.revision,
            subscriptionSha256: queuedSubscription.contentSha256,
            sourceUrlSha256: queuedSubscription.sourceUrlSha256,
            sourceOriginSha256: queuedSubscription.sourceOriginSha256,
            applyAfter,
            approvalPolicyBaselineSha256: body.approvalPolicyBaselineSha256,
            approvalPolicySha256: policyReview.review.approvalPolicySha256,
            approvalEnvelopeSetSha256:
              policyReview.review.approvalEnvelopeSetSha256,
            acceptedApprovalEnvelopeSetSha256:
              policyReview.review.acceptedApprovalEnvelopeSetSha256,
            signerSetSha256: policyReview.review.signerSetSha256,
            policyReviewSha256: policyReview.review.contentSha256,
            queueResultSha256: queueResult.contentSha256,
          },
        );
        setQueueReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyApplyResultHeaders(
          context,
          queueResult,
        );
        return context.json(queueResult, 202);
      } catch (error) {
        return jsonError(context, errorMessage(error), 400);
      }
    },
  );

  app.get(
    "/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/rotation-proposal/approval-policy-baselines",
    (context) => {
      const baselines =
        services.store.listReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaselines();
      setReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaselineListHeaders(
        context,
        baselines,
      );
      return context.json(baselines);
    },
  );

  app.post(
    "/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/rotation-proposal/subscriptions/:subscriptionId/approval/policy-baselines",
    async (context) => {
      let input: unknown;
      try {
        input = await readLimitedJson(
          context.req.raw,
          MAX_TRUSTED_RECEIPT_BYTES * 10 + MAX_TRUST_ADMIN_REQUEST_BYTES,
          "Receipt trust rotation proposal approval policy baseline request",
        );
      } catch (error) {
        if (error instanceof RequestBodyTooLargeError) {
          return jsonError(context, error.message, 413);
        }
        return jsonError(
          context,
          "Receipt trust rotation proposal approval policy baseline request is invalid",
          400,
        );
      }
      const body =
        parsePromoteReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaselineRequest(
          input,
        );
      if (!body) {
        return jsonError(
          context,
          "Receipt trust rotation proposal approval policy baseline request is invalid",
          400,
        );
      }
      try {
        services.store.getThread(body.threadId);
        const subscription =
          services.store.getReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription(
            context.req.param("subscriptionId"),
          );
        const { review } =
          createReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyReview(
            services.store,
            subscription,
            body,
          );
        if (review.status !== "accepted") {
          setReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyReviewHeaders(
            context,
            review,
          );
          return context.json(review, 409);
        }
        const envelope = signTrustedReceipt(
          review,
          services.store.getReceiptTrustAnchor(body.trustAnchorId),
        );
        const result =
          await services.store.promoteReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaseline(
            body.threadId,
            envelope,
          );
        if (result.created) {
          await appendReceiptTrustEvent(
            services,
            body.threadId,
            "receipt_trust.rotation_approval_policy_baseline.promoted",
            {
              ...trustedReceiptEventPayload(envelope),
              baselineId: result.baseline.id,
              baselineSha256: result.baseline.contentSha256,
              approvalPolicySha256: result.baseline.approvalPolicySha256,
              subscriptionSha256: result.baseline.subscriptionSha256,
              acceptedApprovalEnvelopeSetSha256:
                result.baseline.acceptedApprovalEnvelopeSetSha256,
              signerSetSha256: result.baseline.signerSetSha256,
              ...(result.baseline.requiredSignerSetSha256
                ? {
                    requiredSignerSetSha256:
                      result.baseline.requiredSignerSetSha256,
                  }
                : {}),
            },
          );
        }
        setPromoteReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaselineResultHeaders(
          context,
          result,
        );
        return context.json(result, result.created ? 201 : 200);
      } catch (error) {
        const message = errorMessage(error);
        return jsonError(
          context,
          message,
          message.includes("not trusted") ||
            message.includes("requires an accepted review")
            ? 409
            : 400,
        );
      }
    },
  );

  app.post(
    "/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/rotation-proposal/approval-policy-baselines/verify",
    async (context) => {
      let input: unknown;
      try {
        input = await readLimitedJson(
          context.req.raw,
          MAX_TRUSTED_RECEIPT_BYTES + MAX_TRUST_ADMIN_REQUEST_BYTES,
          "Receipt trust rotation proposal approval policy baseline verification request",
        );
      } catch (error) {
        if (error instanceof RequestBodyTooLargeError) {
          return jsonError(context, error.message, 413);
        }
        return jsonError(
          context,
          "Receipt trust rotation proposal approval policy baseline verification request is invalid",
          400,
        );
      }
      const body =
        parseVerifyReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaselineRequest(
          input,
        );
      if (!body) {
        return jsonError(
          context,
          "Receipt trust rotation proposal approval policy baseline verification request is invalid",
          400,
        );
      }
      const trustDirectoryVerification =
        body.trustDirectory === undefined
          ? undefined
          : services.store.verifyReceiptTrustAnchorDirectory(
              body.trustDirectory,
              body.trustDirectoryPolicy,
            );
      const anchors =
        body.trustDirectory === undefined
          ? services.store.listReceiptTrustAnchors()
          : trustDirectoryVerification?.status === "valid"
            ? receiptTrustAnchorsFromDirectory(body.trustDirectory)
            : [];
      const verification =
        verifyReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaseline(
          body.baseline,
          anchors,
        );
      setReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaselineVerificationHeaders(
        context,
        verification,
      );
      return context.json(verification);
    },
  );

  app.post(
    "/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/rotation-proposal/approval-policy-baselines/import",
    async (context) => {
      let input: unknown;
      try {
        input = await readLimitedJson(
          context.req.raw,
          MAX_TRUSTED_RECEIPT_BYTES + MAX_TRUST_ADMIN_REQUEST_BYTES,
          "Receipt trust rotation proposal approval policy baseline import request",
        );
      } catch (error) {
        if (error instanceof RequestBodyTooLargeError) {
          return jsonError(context, error.message, 413);
        }
        return jsonError(
          context,
          "Receipt trust rotation proposal approval policy baseline import request is invalid",
          400,
        );
      }
      const body =
        parseImportReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaselineRequest(
          input,
        );
      if (!body) {
        return jsonError(
          context,
          "Receipt trust rotation proposal approval policy baseline import request is invalid",
          400,
        );
      }
      const trustDirectoryVerification =
        body.trustDirectory === undefined
          ? undefined
          : services.store.verifyReceiptTrustAnchorDirectory(
              body.trustDirectory,
              body.trustDirectoryPolicy,
            );
      const anchors =
        body.trustDirectory === undefined
          ? services.store.listReceiptTrustAnchors()
          : trustDirectoryVerification?.status === "valid"
            ? receiptTrustAnchorsFromDirectory(body.trustDirectory)
            : [];
      const verification =
        verifyReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaseline(
          body.baseline,
          anchors,
        );
      if (
        verification.status !== "trusted" ||
        !verification.baselineValid ||
        !verification.signatureValid ||
        !verification.integrityValid
      ) {
        return jsonError(
          context,
          "Receipt trust rotation proposal approval policy baseline import requires trusted verification",
          409,
        );
      }
      try {
        const imported =
          await services.store.importReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaseline(
            body.threadId,
            body.baseline,
            body.expectedCurrentBaselineSha256,
            anchors,
          );
        if (imported.imported) {
          await appendReceiptTrustEvent(
            services,
            body.threadId,
            "receipt_trust.rotation_approval_policy_baseline.imported",
            {
              baselineId: imported.baseline.id,
              baselineSha256: imported.baseline.contentSha256,
              policyReviewSha256:
                imported.baseline.envelope.receipt.contentSha256,
              envelopeSha256: imported.baseline.envelope.contentSha256,
              keyId: imported.baseline.envelope.signature.keyId,
              expectedCurrentBaselineSha256: body.expectedCurrentBaselineSha256,
              verificationSha256: verification.contentSha256,
              ...(imported.previousBaselineSha256
                ? { previousBaselineSha256: imported.previousBaselineSha256 }
                : {}),
            },
          );
        }
        const result: ImportReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaselineResult =
          {
            baseline: imported.baseline,
            imported: imported.imported,
            verification,
            expectedCurrentBaselineSha256: body.expectedCurrentBaselineSha256,
            ...(imported.previousBaselineSha256
              ? { previousBaselineSha256: imported.previousBaselineSha256 }
              : {}),
          };
        setImportReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaselineResultHeaders(
          context,
          result,
        );
        return context.json(result, imported.imported ? 201 : 200);
      } catch (error) {
        const message = errorMessage(error);
        return jsonError(
          context,
          message,
          message.includes("precondition") ? 409 : 400,
        );
      }
    },
  );

  app.post(
    "/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/rotation-proposal/subscriptions/:subscriptionId/approval/apply/replay",
    async (context) => {
      let input: unknown;
      try {
        input = await readLimitedJson(
          context.req.raw,
          MAX_TRUSTED_RECEIPT_BYTES + MAX_TRUST_ADMIN_REQUEST_BYTES,
          "Receipt trust anchor directory quorum activation selection rotation proposal subscription approval apply replay request",
        );
      } catch (error) {
        if (error instanceof RequestBodyTooLargeError) {
          return jsonError(context, error.message, 413);
        }
        return jsonError(
          context,
          "Receipt trust anchor directory quorum activation selection rotation proposal subscription approval apply replay request is invalid",
          400,
        );
      }
      const body =
        parseApplyReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalRequest(
          input,
        );
      if (!body) {
        return jsonError(
          context,
          "Receipt trust anchor directory quorum activation selection rotation proposal subscription approval apply replay request is invalid",
          400,
        );
      }
      try {
        services.store.getThread(body.threadId);
        const subscription =
          services.store.getReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription(
            context.req.param("subscriptionId"),
          );
        const replay =
          createReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalApplyReplay(
            services.store,
            subscription,
            body,
          );
        setReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalApplyReplayHeaders(
          context,
          replay,
        );
        return context.json(replay);
      } catch (error) {
        return jsonError(context, errorMessage(error), 400);
      }
    },
  );

  app.post(
    "/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/rotation-proposal/subscriptions/:subscriptionId",
    async (context) => {
      let input: unknown;
      try {
        input = await readLimitedJson(
          context.req.raw,
          MAX_TRUST_ADMIN_REQUEST_BYTES,
          "Receipt trust anchor directory quorum activation selection rotation proposal subscription update request",
        );
      } catch (error) {
        return jsonError(
          context,
          error instanceof RequestBodyTooLargeError
            ? error.message
            : "Receipt trust anchor directory quorum activation selection rotation proposal subscription update request is invalid",
          error instanceof RequestBodyTooLargeError ? 413 : 400,
        );
      }
      const body =
        parseUpdateReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionRequest(
          input,
        );
      if (!body) {
        return jsonError(
          context,
          "Receipt trust anchor directory quorum activation selection rotation proposal subscription update request is invalid",
          400,
        );
      }
      const before =
        services.store.getReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription(
          context.req.param("subscriptionId"),
        );
      const subscription =
        await services.store.updateReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription(
          before.id,
          body,
        );
      if (before.revision !== subscription.revision) {
        await appendReceiptTrustEvent(
          services,
          subscription.auditThreadId,
          "receipt.trust_rotation_proposal_subscription.updated",
          {
            subscriptionId: subscription.id,
            subscriptionRevision: subscription.revision,
            subscriptionSha256: subscription.contentSha256,
            sourceUrlSha256: subscription.sourceUrlSha256,
            sourceOriginSha256: subscription.sourceOriginSha256,
            status: subscription.status,
          },
        );
      }
      setReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionHeaders(
        context,
        subscription,
      );
      return context.json(subscription);
    },
  );

  app.post(
    "/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/rotation-proposal/preflight",
    async (context) => {
      let input: unknown;
      try {
        input = await readLimitedJson(
          context.req.raw,
          MAX_TRUSTED_RECEIPT_BYTES + MAX_TRUST_ADMIN_REQUEST_BYTES,
          "Receipt trust anchor directory quorum activation selection rotation proposal preflight request",
        );
      } catch (error) {
        if (error instanceof RequestBodyTooLargeError) {
          return jsonError(context, error.message, 413);
        }
        return jsonError(
          context,
          "Receipt trust anchor directory quorum activation selection rotation proposal preflight request is invalid",
          400,
        );
      }
      const body =
        parseVerifyReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalRequest(
          input,
        );
      if (!body) {
        return jsonError(
          context,
          "Receipt trust anchor directory quorum activation selection rotation proposal preflight request is invalid",
          400,
        );
      }
      try {
        services.store.getThread(body.threadId);
        const preflight =
          createReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalPreflight(
            services.store,
            body,
          );
        setReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalPreflightHeaders(
          context,
          preflight,
        );
        return context.json(preflight, 200);
      } catch (error) {
        return jsonError(context, errorMessage(error), 400);
      }
    },
  );

  app.post(
    "/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/apply",
    async (context) => {
      let input: unknown;
      try {
        input = await readLimitedJson(
          context.req.raw,
          MAX_TRUSTED_RECEIPT_BYTES + MAX_TRUST_ADMIN_REQUEST_BYTES,
          "Receipt trust anchor directory quorum activation selection request",
        );
      } catch (error) {
        if (error instanceof RequestBodyTooLargeError) {
          return jsonError(context, error.message, 413);
        }
        return jsonError(
          context,
          "Receipt trust anchor directory quorum activation selection request is invalid",
          400,
        );
      }
      const body =
        parseApplyReceiptTrustAnchorDirectoryQuorumActivationSelectionRequest(
          input,
        );
      if (!body) {
        return jsonError(
          context,
          "Receipt trust anchor directory quorum activation selection request is invalid",
          400,
        );
      }
      try {
        const selectionState =
          services.store.getReceiptTrustAnchorDirectoryQuorumActivationSelectionState();
        const activeSelection = selectionState.selection;
        const willRotateActiveSelection =
          activeSelection !== undefined &&
          activeSelection.activationDecisionRecordId !==
            body.activationDecisionRecordId;
        const proposalGate = willRotateActiveSelection
          ? verifyReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalGate(
              services.store,
              body,
            )
          : undefined;
        if (proposalGate?.status === "rejected") {
          return jsonError(context, proposalGate.reason, 409);
        }
        const result =
          await services.store.applyReceiptTrustAnchorDirectoryQuorumActivationSelection(
            body.threadId,
            body.activationDecisionRecordId,
            body.expectedCurrentSelectionSha256,
          );
        if (result.applied) {
          await appendReceiptTrustEvent(
            services,
            body.threadId,
            "receipt.trust_directory_quorum_activation_selection.applied",
            {
              selectionId: result.selection.id,
              selectionSha256: result.selection.contentSha256,
              activationDecisionRecordId:
                result.selection.activationDecisionRecordId,
              activationDecisionRecordSha256:
                result.selection.activationDecisionRecordSha256,
              activationDecisionEnvelopeSha256:
                result.selection.activationDecisionEnvelopeSha256,
              baselineId: result.selection.baselineId,
              baselineSha256: result.selection.baselineSha256,
              selectedAnchorSetSha256: result.selection.selectedAnchorSetSha256,
              selectedDirectorySha256: result.selection.selectedDirectorySha256,
              expectedCurrentSelectionSha256:
                result.expectedCurrentSelectionSha256,
              ...(result.previousSelectionSha256
                ? { previousSelectionSha256: result.previousSelectionSha256 }
                : {}),
              ...(proposalGate?.status === "accepted"
                ? {
                    rotationProposalEnvelopeSha256:
                      proposalGate.envelope.contentSha256,
                    rotationProposalSha256: proposalGate.proposal.contentSha256,
                    rotationProposalReviewSha256:
                      proposalGate.proposal.rotationReviewSha256,
                    rotationProposalCheckpointRegistryQuorumBaselineSha256:
                      proposalGate.proposal
                        .checkpointRegistryQuorumBaselineSha256 ?? "",
                  }
                : {}),
              selectionStateSha256: result.selectionState.contentSha256,
              resultSha256: result.contentSha256,
            },
          );
        }
        setApplyReceiptTrustAnchorDirectoryQuorumActivationSelectionResultHeaders(
          context,
          result,
        );
        return context.json(result, result.applied ? 201 : 200);
      } catch (error) {
        const message = errorMessage(error);
        return jsonError(
          context,
          message,
          message.includes("precondition failed") ? 409 : 400,
        );
      }
    },
  );

  app.post(
    "/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-decision",
    async (context) => {
      let input: unknown;
      try {
        input = await readLimitedJson(
          context.req.raw,
          MAX_TRUSTED_RECEIPT_BYTES + MAX_TRUST_ADMIN_REQUEST_BYTES,
          "Receipt trust anchor directory quorum activation decision request",
        );
      } catch (error) {
        if (error instanceof RequestBodyTooLargeError) {
          return jsonError(context, error.message, 413);
        }
        return jsonError(
          context,
          "Receipt trust anchor directory quorum activation decision request is invalid",
          400,
        );
      }
      const body =
        parseSignReceiptTrustAnchorDirectoryQuorumActivationDecisionRequest(
          input,
        );
      if (!body) {
        return jsonError(
          context,
          "Receipt trust anchor directory quorum activation decision request is invalid",
          400,
        );
      }
      try {
        services.store.getThread(body.threadId);
        const baselines =
          services.store.listReceiptTrustAnchorDirectoryQuorumPromotionBaselines();
        const baseline =
          body.baselineId === undefined
            ? baselines.at(-1)
            : baselines.find((candidate) => candidate.id === body.baselineId);
        if (!baseline) {
          return jsonError(
            context,
            "Receipt trust anchor directory quorum activation decision baseline was not found",
            404,
          );
        }
        const trustDirectoryVerification =
          body.trustDirectory === undefined
            ? undefined
            : services.store.verifyReceiptTrustAnchorDirectory(
                body.trustDirectory,
                body.trustDirectoryPolicy,
              );
        const anchors =
          body.trustDirectory === undefined
            ? services.store.listReceiptTrustAnchors()
            : trustDirectoryVerification?.status === "valid"
              ? receiptTrustAnchorsFromDirectory(body.trustDirectory)
              : [];
        const verification =
          verifyReceiptTrustAnchorDirectoryQuorumPromotionBaseline(
            baseline,
            anchors,
            {
              ...(trustDirectoryVerification
                ? { trustDirectoryVerification }
                : {}),
            },
          );
        const policyReview =
          reviewReceiptTrustAnchorDirectoryQuorumPromotionBaselineImportPolicy(
            baseline,
            body.importPolicy,
          );
        const sourceAlignment =
          createReceiptTrustAnchorDirectoryQuorumActivationSourceAlignment(
            baseline,
            services.store.listReceiptTrustAnchorDirectorySubscriptions(),
          );
        const receipt =
          createReceiptTrustAnchorDirectoryQuorumActivationDecisionReceipt({
            baseline,
            verification,
            policyReview,
            sourceAlignment,
          });
        const envelope = signTrustedReceipt(
          receipt,
          services.store.getReceiptTrustAnchor(body.trustAnchorId),
        );
        const result: SignReceiptTrustAnchorDirectoryQuorumActivationDecisionResult =
          {
            baseline,
            verification,
            policyReview,
            sourceAlignment,
            envelope,
          };
        const record =
          await services.store.recordReceiptTrustAnchorDirectoryQuorumActivationDecision(
            body.threadId,
            result,
          );
        await appendReceiptTrustEvent(
          services,
          body.threadId,
          "receipt_trust.directory_quorum_activation_decision.signed",
          {
            ...trustedReceiptEventPayload(envelope),
            decision: receipt.decision,
            baselineId: baseline.id,
            baselineSha256: baseline.contentSha256,
            verificationSha256: verification.contentSha256,
            policyReviewSha256: policyReview.contentSha256,
            sourceAlignmentSha256: sourceAlignment.contentSha256,
            recordId: record.id,
            recordSha256: record.contentSha256,
            alignedSourceCount: sourceAlignment.alignedSourceCount,
            driftedSourceCount: sourceAlignment.driftedSourceCount,
            missingSourceCount: sourceAlignment.missingSourceCount,
          },
        );
        setReceiptTrustAnchorDirectoryQuorumActivationDecisionResultHeaders(
          context,
          result,
        );
        context.header(
          "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Decision-Record-Id",
          record.id,
        );
        context.header(
          "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Decision-Record-SHA256",
          record.contentSha256,
        );
        return context.json(result, 201);
      } catch (error) {
        return jsonError(context, errorMessage(error), 400);
      }
    },
  );

  app.post(
    "/api/receipt-trust/anchors/directory/subscriptions",
    async (context) => {
      let input: unknown;
      try {
        input = await readLimitedJson(
          context.req.raw,
          MAX_TRUST_ADMIN_REQUEST_BYTES,
          "Receipt trust anchor directory subscription request",
        );
      } catch (error) {
        return jsonError(
          context,
          error instanceof RequestBodyTooLargeError
            ? error.message
            : "Receipt trust anchor directory subscription request is invalid",
          error instanceof RequestBodyTooLargeError ? 413 : 400,
        );
      }
      const body =
        parseCreateReceiptTrustAnchorDirectorySubscriptionRequest(input);
      if (!body) {
        return jsonError(
          context,
          "Receipt trust anchor directory subscription request is invalid",
          400,
        );
      }
      let discovery: ReceiptTrustAnchorDirectoryDiscovery;
      try {
        discovery = await services.receiptTrustDirectories.discover({
          sourceUrl: body.sourceUrl,
          policy: body.policy,
        });
      } catch (error) {
        if (error instanceof ReceiptTrustAnchorDirectoryDiscoveryError) {
          return jsonError(context, error.message, error.status);
        }
        return jsonError(
          context,
          "Receipt trust anchor directory subscription discovery failed",
          502,
        );
      }
      if (discovery.status !== "valid") {
        setReceiptTrustAnchorDirectoryDiscoveryHeaders(context, discovery);
        return context.json(discovery, 422);
      }
      const subscription =
        await services.store.createReceiptTrustAnchorDirectorySubscription(
          body,
          discovery,
        );
      await appendReceiptTrustEvent(
        services,
        subscription.auditThreadId,
        "receipt.trust_directory_subscription.created",
        {
          subscriptionId: subscription.id,
          subscriptionRevision: subscription.revision,
          subscriptionSha256: subscription.contentSha256,
          sourceUrlSha256: subscription.sourceUrlSha256,
          sourceOriginSha256: subscription.sourceOriginSha256,
          policySha256: subscription.policySha256,
          directorySha256:
            subscription.lastGoodDiscovery?.directory?.contentSha256 ?? "",
          anchorSetSha256:
            subscription.lastGoodDiscovery?.directory?.anchorSetSha256 ?? "",
        },
      );
      setReceiptTrustAnchorDirectorySubscriptionHeaders(context, subscription);
      return context.json(subscription, 201);
    },
  );

  app.post(
    "/api/receipt-trust/anchors/directory/subscriptions/:subscriptionId/refresh",
    async (context) => {
      let input: unknown;
      try {
        input = await readLimitedJson(
          context.req.raw,
          MAX_TRUST_ADMIN_REQUEST_BYTES,
          "Receipt trust anchor directory subscription refresh request",
        );
      } catch (error) {
        return jsonError(
          context,
          error instanceof RequestBodyTooLargeError
            ? error.message
            : "Receipt trust anchor directory subscription refresh request is invalid",
          error instanceof RequestBodyTooLargeError ? 413 : 400,
        );
      }
      const body =
        parseRefreshReceiptTrustAnchorDirectorySubscriptionRequest(input);
      if (!body) {
        return jsonError(
          context,
          "Receipt trust anchor directory subscription refresh request is invalid",
          400,
        );
      }
      const result = await services.receiptTrustDirectorySubscriptions.refresh(
        context.req.param("subscriptionId"),
        body.threadId,
        body.expectedRevision,
      );
      setReceiptTrustAnchorDirectorySubscriptionRefreshHeaders(context, result);
      return context.json(result);
    },
  );

  app.post(
    "/api/receipt-trust/anchors/directory/subscriptions/:subscriptionId",
    async (context) => {
      let input: unknown;
      try {
        input = await readLimitedJson(
          context.req.raw,
          MAX_TRUST_ADMIN_REQUEST_BYTES,
          "Receipt trust anchor directory subscription update request",
        );
      } catch (error) {
        return jsonError(
          context,
          error instanceof RequestBodyTooLargeError
            ? error.message
            : "Receipt trust anchor directory subscription update request is invalid",
          error instanceof RequestBodyTooLargeError ? 413 : 400,
        );
      }
      const body =
        parseUpdateReceiptTrustAnchorDirectorySubscriptionRequest(input);
      if (!body) {
        return jsonError(
          context,
          "Receipt trust anchor directory subscription update request is invalid",
          400,
        );
      }
      const before = services.store.getReceiptTrustAnchorDirectorySubscription(
        context.req.param("subscriptionId"),
      );
      const subscription =
        await services.store.updateReceiptTrustAnchorDirectorySubscription(
          before.id,
          body,
        );
      if (before.revision !== subscription.revision) {
        await appendReceiptTrustEvent(
          services,
          subscription.auditThreadId,
          "receipt.trust_directory_subscription.updated",
          {
            subscriptionId: subscription.id,
            subscriptionRevision: subscription.revision,
            subscriptionSha256: subscription.contentSha256,
            sourceUrlSha256: subscription.sourceUrlSha256,
            sourceOriginSha256: subscription.sourceOriginSha256,
            status: subscription.status,
          },
        );
      }
      setReceiptTrustAnchorDirectorySubscriptionHeaders(context, subscription);
      return context.json(subscription);
    },
  );

  app.post("/api/receipt-trust/anchors/directory/verify", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(
        context.req.raw,
        MAX_TRUSTED_RECEIPT_BYTES,
        "Receipt trust anchor directory verification request",
      );
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return jsonError(context, error.message, 413);
      }
      return jsonError(
        context,
        "Receipt trust anchor directory verification request is invalid",
        400,
      );
    }
    const body = parseVerifyReceiptTrustAnchorDirectoryRequest(input);
    if (!body) {
      return jsonError(
        context,
        "Receipt trust anchor directory verification request is invalid",
        400,
      );
    }
    const verification = services.store.verifyReceiptTrustAnchorDirectory(
      body.directory,
      body.policy,
    );
    setReceiptTrustAnchorDirectoryVerificationHeaders(context, verification);
    return context.json(verification);
  });

  app.post(
    "/api/receipt-trust/anchors/directory/metadata/verify",
    async (context) => {
      let input: unknown;
      try {
        input = await readLimitedJson(
          context.req.raw,
          MAX_TRUSTED_RECEIPT_BYTES + MAX_TRUST_ADMIN_REQUEST_BYTES,
          "Receipt trust anchor directory metadata verification request",
        );
      } catch (error) {
        if (error instanceof RequestBodyTooLargeError) {
          return jsonError(context, error.message, 413);
        }
        return jsonError(
          context,
          "Receipt trust anchor directory metadata verification request is invalid",
          400,
        );
      }
      const body = parseVerifyReceiptTrustAnchorDirectoryMetadataRequest(input);
      if (!body) {
        return jsonError(
          context,
          "Receipt trust anchor directory metadata verification request is invalid",
          400,
        );
      }
      const trustDirectoryVerification =
        body.trustDirectory === undefined
          ? undefined
          : services.store.verifyReceiptTrustAnchorDirectory(
              body.trustDirectory,
              body.trustDirectoryPolicy,
            );
      const anchors =
        body.trustDirectory === undefined
          ? services.store.listReceiptTrustAnchors()
          : trustDirectoryVerification?.status === "valid"
            ? receiptTrustAnchorsFromDirectory(body.trustDirectory)
            : [];
      const verification = verifyReceiptTrustAnchorDirectoryMetadata(
        body.envelope,
        body.directory,
        anchors,
        {
          ...(body.directoryPolicy
            ? { directoryPolicy: body.directoryPolicy }
            : {}),
          ...(trustDirectoryVerification ? { trustDirectoryVerification } : {}),
        },
      );
      setReceiptTrustAnchorDirectoryMetadataVerificationHeaders(
        context,
        verification,
      );
      return context.json(verification);
    },
  );

  app.post("/api/receipt-trust/anchors/directory/discover", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(
        context.req.raw,
        MAX_TRUST_ADMIN_REQUEST_BYTES,
        "Receipt trust anchor directory discovery request",
      );
    } catch (error) {
      return jsonError(
        context,
        error instanceof RequestBodyTooLargeError
          ? error.message
          : "Receipt trust anchor directory discovery request is invalid",
        error instanceof RequestBodyTooLargeError ? 413 : 400,
      );
    }
    const body = parseDiscoverReceiptTrustAnchorDirectoryRequest(input);
    if (!body) {
      return jsonError(
        context,
        "Receipt trust anchor directory discovery request is invalid",
        400,
      );
    }
    try {
      const discovery = await services.receiptTrustDirectories.discover(body);
      setReceiptTrustAnchorDirectoryDiscoveryHeaders(context, discovery);
      return context.json(discovery);
    } catch (error) {
      if (error instanceof ReceiptTrustAnchorDirectoryDiscoveryError) {
        return jsonError(context, error.message, error.status);
      }
      return jsonError(
        context,
        "Receipt trust anchor directory discovery failed",
        502,
      );
    }
  });

  app.post("/api/receipt-trust/anchors", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(
        context.req.raw,
        MAX_TRUST_ADMIN_REQUEST_BYTES,
        "Receipt trust anchor request",
      );
    } catch (error) {
      return jsonError(
        context,
        errorMessage(error),
        error instanceof RequestBodyTooLargeError ? 413 : 400,
      );
    }
    const body = parseCreateReceiptTrustAnchorRequest(input);
    if (!body) {
      return jsonError(context, "Receipt trust anchor is invalid", 400);
    }
    const anchor = await services.store.createReceiptTrustAnchor(body);
    await appendReceiptTrustEvent(
      services,
      body.threadId,
      "receipt.trust_anchor.created",
      {
        trustAnchorId: anchor.id,
        keyId: anchor.keyId,
        algorithm: anchor.algorithm,
        status: anchor.status,
        signingCapable: Boolean(anchor.signingSource),
        anchorSha256: anchor.contentSha256,
      },
    );
    setReceiptTrustAnchorHeaders(context, anchor);
    return context.json(anchor, 201);
  });

  app.post("/api/receipt-trust/anchors/:anchorId/revoke", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(
        context.req.raw,
        MAX_TRUST_ADMIN_REQUEST_BYTES,
        "Receipt trust anchor revocation request",
      );
    } catch (error) {
      return jsonError(
        context,
        errorMessage(error),
        error instanceof RequestBodyTooLargeError ? 413 : 400,
      );
    }
    const body = parseRevokeReceiptTrustAnchorRequest(input);
    if (!body) {
      return jsonError(
        context,
        "Receipt trust anchor revocation is invalid",
        400,
      );
    }
    services.store.getThread(body.threadId);
    const before = services.store.getReceiptTrustAnchor(
      context.req.param("anchorId"),
    );
    const anchor = await services.store.revokeReceiptTrustAnchor(before.id);
    if (before.status !== anchor.status) {
      await appendReceiptTrustEvent(
        services,
        body.threadId,
        "receipt.trust_anchor.revoked",
        {
          trustAnchorId: anchor.id,
          keyId: anchor.keyId,
          status: anchor.status,
          anchorSha256: anchor.contentSha256,
        },
      );
    }
    setReceiptTrustAnchorHeaders(context, anchor);
    return context.json(anchor);
  });

  app.post("/api/receipt-trust/verify", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(
        context.req.raw,
        MAX_TRUSTED_RECEIPT_BYTES + 1_024,
        "Trusted receipt request",
      );
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return jsonError(context, error.message, 413);
      }
      return jsonError(context, "Trusted receipt request is invalid", 400);
    }
    const body = parseVerifyTrustedReceiptRequest(input);
    if (!body) {
      return jsonError(context, "Trusted receipt request is invalid", 400);
    }
    const activeSelectionState =
      body.directory === undefined
        ? services.store.getReceiptTrustAnchorDirectoryQuorumActivationSelectionState()
        : undefined;
    const activeSelection = activeSelectionState?.selection;
    const directorySource =
      body.directory !== undefined
        ? ("uploaded" as const)
        : activeSelection
          ? ("active_selection" as const)
          : undefined;
    const selectedDirectory =
      body.directory !== undefined
        ? body.directory
        : activeSelection?.selectedDirectory;
    const directoryPolicy =
      body.directory !== undefined
        ? body.directoryPolicy
        : activeSelection
          ? {
              expectedAnchorSetSha256: activeSelection.selectedAnchorSetSha256,
            }
          : undefined;
    const directoryVerification =
      selectedDirectory === undefined
        ? undefined
        : services.store.verifyReceiptTrustAnchorDirectory(
            selectedDirectory,
            directoryPolicy,
          );
    if (directoryVerification?.status === "invalid") {
      const verification: TrustedReceiptVerification = {
        status: "invalid",
        verifiedAt: new Date().toISOString(),
        ...(directorySource ? { anchorDirectorySource: directorySource } : {}),
        anchorDirectorySha256:
          directoryVerification.declaredContentSha256 ??
          directoryVerification.recomputedContentSha256 ??
          directoryVerification.contentSha256,
        anchorDirectoryVerificationSha256: directoryVerification.contentSha256,
        ...(directoryVerification.policySha256
          ? { anchorDirectoryPolicySha256: directoryVerification.policySha256 }
          : {}),
        ...(directoryVerification.directoryGeneratedAt
          ? {
              anchorDirectoryGeneratedAt:
                directoryVerification.directoryGeneratedAt,
            }
          : {}),
        ...(directoryVerification.directoryAgeMs !== undefined
          ? { anchorDirectoryAgeMs: directoryVerification.directoryAgeMs }
          : {}),
        ...(directoryVerification.anchorCount !== undefined
          ? { anchorDirectoryAnchorCount: directoryVerification.anchorCount }
          : {}),
        ...(activeSelection
          ? {
              anchorDirectorySelectionId: activeSelection.id,
              anchorDirectorySelectionSha256: activeSelection.contentSha256,
              ...(activeSelectionState
                ? {
                    anchorDirectorySelectionStateSha256:
                      activeSelectionState.contentSha256,
                  }
                : {}),
            }
          : {}),
        signatureValid: false,
        integrityValid: false,
        reason:
          directorySource === "active_selection"
            ? "Active receipt trust anchor directory selection is invalid"
            : "Receipt trust anchor directory is invalid",
      };
      setTrustedReceiptVerificationHeaders(context, verification);
      return context.json(verification);
    }
    const directory =
      selectedDirectory === undefined
        ? undefined
        : receiptTrustAnchorsFromDirectory(selectedDirectory);
    const verification = verifyTrustedReceiptEnvelope(
      body.envelope,
      directory ?? services.store.listReceiptTrustAnchors(),
    );
    const verifiedWithDirectory: TrustedReceiptVerification =
      directoryVerification
        ? {
            ...verification,
            ...(directorySource
              ? { anchorDirectorySource: directorySource }
              : {}),
            ...(directoryVerification.declaredContentSha256
              ? {
                  anchorDirectorySha256:
                    directoryVerification.declaredContentSha256,
                }
              : {}),
            anchorDirectoryVerificationSha256:
              directoryVerification.contentSha256,
            ...(directoryVerification.policySha256
              ? {
                  anchorDirectoryPolicySha256:
                    directoryVerification.policySha256,
                }
              : {}),
            ...(directoryVerification.directoryGeneratedAt
              ? {
                  anchorDirectoryGeneratedAt:
                    directoryVerification.directoryGeneratedAt,
                }
              : {}),
            ...(directoryVerification.directoryAgeMs !== undefined
              ? { anchorDirectoryAgeMs: directoryVerification.directoryAgeMs }
              : {}),
            ...(directoryVerification.anchorCount !== undefined
              ? {
                  anchorDirectoryAnchorCount: directoryVerification.anchorCount,
                }
              : {}),
            ...(activeSelection
              ? {
                  anchorDirectorySelectionId: activeSelection.id,
                  anchorDirectorySelectionSha256: activeSelection.contentSha256,
                  ...(activeSelectionState
                    ? {
                        anchorDirectorySelectionStateSha256:
                          activeSelectionState.contentSha256,
                      }
                    : {}),
                }
              : {}),
          }
        : verification;
    setTrustedReceiptVerificationHeaders(context, verifiedWithDirectory);
    return context.json(verifiedWithDirectory);
  });

  app.get("/api/bootstrap", async (context) => {
    const threads = services.store.listThreads();
    const requestedThreadId = context.req.query("thread");
    const activeThreadId = requestedThreadId ?? threads[0]?.id;
    const response: BootstrapResponse = {
      apiVersion: "2026-07-25",
      workspace: services.store.getWorkspaceSummary(),
      agents: services.store.listAgents(),
      threads,
      skills: BUNDLED_SKILLS,
      models: await services.models.list(),
      memories: services.store.listMemories(),
      extensions: services.store.listExtensions(),
      extensionPublisherTrustAnchors:
        services.store.listExtensionPublisherTrustAnchors(),
      extensionPackageRolloutChannels:
        services.store.listExtensionPackageRolloutChannels(),
      skillPackageInstallations: services.store.listSkillPackageInstallations(),
      credentials: services.store.listCredentialReferences(),
      usagePriceTableCatalog: builtinUsagePriceTableCatalog(),
      schedules: services.store.listSchedules(),
      channels: services.store.listInboundChannels(),
      inboundChannelAdapters: inboundChannelAdapterCatalog(),
      inboundChannelAdapterCatalogSha256: inboundChannelAdapterCatalogSha256(),
      ...(activeThreadId
        ? { activeThread: await services.store.getDetail(activeThreadId) }
        : {}),
    };
    setBootstrapProjectionHeaders(context, response);
    return context.json(response);
  });

  app.get("/api/usage-price-tables", (context) => {
    const catalog = builtinUsagePriceTableCatalog();
    setUsagePriceTableCatalogHeaders(context, catalog);
    return context.json(catalog);
  });

  app.post("/api/usage-price-tables/verify", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(
        context.req.raw,
        64 * 1024,
        "Usage price table verification request",
      );
    } catch (error) {
      return jsonError(context, errorMessage(error), 400);
    }
    const body = parseVerifyUsagePriceTableCatalogRequest(input);
    if (!body) {
      return jsonError(context, "Invalid usage price table request", 400);
    }
    const verification = verifyUsagePriceTableCatalog(
      body.catalog,
      body.requiredProviders
        ? { requiredProviders: body.requiredProviders }
        : {},
    );
    setUsagePriceTableVerificationHeaders(context, verification);
    return context.json(verification);
  });

  app.get("/api/threads/:threadId", async (context) => {
    const detail = await services.store.getDetail(
      context.req.param("threadId"),
    );
    setThreadDetailProjectionHeaders(context, detail);
    return context.json(detail);
  });

  app.post(
    "/api/threads/:threadId/subagents/:taskId/outcome/verify",
    async (context) => {
      const threadId = context.req.param("threadId");
      const taskId = context.req.param("taskId");
      services.store.getThread(threadId);
      const task = services.store
        .listSubagentTasks(threadId)
        .find((candidate) => candidate.id === taskId);
      if (!task) {
        return jsonError(context, "Subagent task not found", 404);
      }
      if (!task.outcome) {
        return jsonError(context, "Subagent outcome is unavailable", 409);
      }
      const verification = await verifySubagentOutcomeEvidence(
        task.outcome,
        services.store.workspaceRoot,
      );
      setSubagentOutcomeEvidenceVerificationHeaders(context, verification);
      return context.json(verification);
    },
  );

  app.post(
    "/api/threads/:threadId/subagents/:taskId/outcome/review",
    async (context) => {
      const threadId = context.req.param("threadId");
      const taskId = context.req.param("taskId");
      services.store.getThread(threadId);
      const task = services.store
        .listSubagentTasks(threadId)
        .find((candidate) => candidate.id === taskId);
      if (!task) {
        return jsonError(context, "Subagent task not found", 404);
      }
      if (!task.outcome) {
        return jsonError(context, "Subagent outcome is unavailable", 409);
      }
      let input: unknown;
      try {
        input = await readLimitedJson(
          context.req.raw,
          8 * 1024,
          "Subagent outcome review request",
        );
      } catch (error) {
        return jsonError(
          context,
          errorMessage(error),
          error instanceof RequestBodyTooLargeError ? 413 : 400,
        );
      }
      const request = parseReviewSubagentOutcomeRequest(input);
      if (!request) {
        return jsonError(
          context,
          "Subagent outcome review request is invalid",
          400,
        );
      }
      try {
        await assertAvailableModel(services, request.model);
        const review = await reviewSubagentOutcome(
          services.models,
          task,
          request.model,
        );
        setSubagentOutcomeReviewHeaders(context, review);
        return context.json(review);
      } catch (error) {
        return jsonError(context, errorMessage(error), 400);
      }
    },
  );

  app.get("/api/threads/:threadId/recovery", (context) => {
    const threadId = context.req.param("threadId");
    services.store.getThread(threadId);
    const recovery = {
      assessments: services.store.listAutomaticRecoveryAssessments(threadId),
      attempts: services.store.listAutomaticRecoveryAttempts(threadId),
    };
    setAutomaticRecoveryProjectionHeaders(context, recovery);
    return context.json(recovery);
  });

  app.get("/api/threads/:threadId/processes", async (context) => {
    const threadId = context.req.param("threadId");
    try {
      const sessions = await services.workspaceProcesses.list(threadId);
      setWorkspaceProcessProjectionHeaders(context, sessions);
      return context.json(sessions);
    } catch (error) {
      return jsonError(context, errorMessage(error), 404);
    }
  });

  app.get("/api/threads/:threadId/workspace-trash", async (context) => {
    const threadId = context.req.param("threadId");
    try {
      const list = await services.workspaceFileMutations.listTrash(threadId);
      setWorkspaceFileProjectionHeaders(context, list);
      return context.json(list);
    } catch (error) {
      return jsonError(context, errorMessage(error), 404);
    }
  });

  app.post(
    "/api/threads/:threadId/workspace-trash/:trashId/restore",
    async (context) => {
      const threadId = context.req.param("threadId");
      const trashId = context.req.param("trashId");
      if (!validWorkspaceTrashId(trashId)) {
        return jsonError(context, "Workspace trash ID is invalid", 400);
      }
      try {
        const result = await services.workspaceFileMutations.restoreTrash(
          threadId,
          trashId,
          context.req.raw.signal,
        );
        setWorkspaceFileProjectionHeaders(context, result);
        return context.json(result);
      } catch (error) {
        const message = errorMessage(error);
        return jsonError(
          context,
          message,
          message.includes("already exists") ||
            message.includes("drifted") ||
            message.includes("stale")
            ? 409
            : 404,
        );
      }
    },
  );

  app.get(
    "/api/threads/:threadId/processes/:processId/output",
    async (context) => {
      const threadId = context.req.param("threadId");
      const processId = context.req.param("processId");
      const after = Number.parseInt(context.req.query("after") ?? "0", 10);
      const wait = Number.parseInt(context.req.query("wait") ?? "0", 10);
      if (
        !validWorkspaceProcessId(processId) ||
        !Number.isSafeInteger(after) ||
        after < 0 ||
        !Number.isSafeInteger(wait) ||
        wait < 0 ||
        wait > 5_000
      ) {
        return jsonError(
          context,
          "Workspace Process output request is invalid",
          400,
        );
      }
      try {
        const output = await services.workspaceProcesses.output(
          threadId,
          processId,
          {
            afterCursor: after,
            waitMs: wait,
            signal: context.req.raw.signal,
          },
        );
        setWorkspaceProcessProjectionHeaders(context, output);
        return context.json(output);
      } catch (error) {
        return jsonError(context, errorMessage(error), 404);
      }
    },
  );

  app.get(
    "/api/threads/:threadId/processes/:processId/delta",
    async (context) => {
      const threadId = context.req.param("threadId");
      const processId = context.req.param("processId");
      if (!validWorkspaceProcessId(processId)) {
        return jsonError(
          context,
          "Workspace Process Session ID is invalid",
          400,
        );
      }
      try {
        const delta = await services.workspaceProcesses.delta(
          threadId,
          processId,
        );
        setWorkspaceProcessProjectionHeaders(context, delta);
        return context.json(delta);
      } catch (error) {
        return jsonError(context, errorMessage(error), 404);
      }
    },
  );

  app.post(
    "/api/threads/:threadId/processes/:processId/input",
    async (context) => {
      const threadId = context.req.param("threadId");
      const processId = context.req.param("processId");
      if (!validWorkspaceProcessId(processId)) {
        return jsonError(
          context,
          "Workspace Process Session ID is invalid",
          400,
        );
      }
      let input: unknown;
      try {
        input = await readLimitedJson(
          context.req.raw,
          MAX_WORKSPACE_PROCESS_INPUT_REQUEST_BYTES,
          "Workspace Process input request",
        );
      } catch (error) {
        return jsonError(
          context,
          errorMessage(error),
          error instanceof RequestBodyTooLargeError ? 413 : 400,
        );
      }
      const request = parseWorkspaceProcessInputRequest(input);
      if (!request) {
        return jsonError(
          context,
          "Workspace Process input request is invalid",
          400,
        );
      }
      try {
        const receipt = await services.workspaceProcesses.writeInput({
          threadId,
          processId,
          ...request,
          initiatedBy: "operator",
          signal: context.req.raw.signal,
        });
        setWorkspaceProcessProjectionHeaders(context, receipt);
        return context.json(receipt);
      } catch (error) {
        const message = errorMessage(error);
        return jsonError(
          context,
          message,
          message.includes("limit")
            ? 413
            : message.includes("valid UTF-8") ||
                message.includes("input is empty")
              ? 400
              : message.includes("not open") ||
                  message.includes("pipe close semantics") ||
                  message.includes("unavailable") ||
                  message.includes("unknown")
                ? 409
                : 404,
        );
      }
    },
  );

  app.post(
    "/api/threads/:threadId/processes/:processId/cancel",
    async (context) => {
      const threadId = context.req.param("threadId");
      const processId = context.req.param("processId");
      if (!validWorkspaceProcessId(processId)) {
        return jsonError(
          context,
          "Workspace Process Session ID is invalid",
          400,
        );
      }
      try {
        const session = await services.workspaceProcesses.cancel(
          threadId,
          processId,
        );
        setWorkspaceProcessProjectionHeaders(context, session);
        return context.json(session);
      } catch (error) {
        return jsonError(context, errorMessage(error), 404);
      }
    },
  );

  app.get("/api/schedules", (context) => {
    const threadId = context.req.query("thread");
    if (threadId) services.store.getThread(threadId);
    const schedules = services.store.listSchedules(threadId);
    setAutomationScheduleListHeaders(context, schedules);
    return context.json(schedules);
  });

  app.post("/api/schedules", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(
        context.req.raw,
        MAX_SCHEDULE_REQUEST_BYTES,
        "Schedule request",
      );
    } catch (error) {
      return jsonError(
        context,
        errorMessage(error),
        error instanceof RequestBodyTooLargeError ? 413 : 400,
      );
    }
    const body = parseCreateAutomationScheduleRequest(input);
    if (!body) {
      return jsonError(context, "Schedule request is invalid", 400);
    }
    services.store.getThread(body.threadId);
    try {
      if (body.model) await assertAvailableModel(services, body.model);
    } catch (error) {
      return jsonError(context, errorMessage(error), 400);
    }
    const schedule = await services.store.createSchedule(body);
    await appendAutomationEvent(services, schedule, "schedule.created", {
      scheduleId: schedule.id,
      name: schedule.name,
      status: schedule.status,
      triggerType: schedule.trigger.type,
      nextRunAt: schedule.nextRunAt,
      revision: schedule.revision,
    });
    setAutomationScheduleProjectionHeaders(context, schedule);
    return context.json(schedule, 201);
  });

  app.put("/api/schedules/:scheduleId", async (context) => {
    const scheduleId = context.req.param("scheduleId");
    let input: unknown;
    try {
      input = await readLimitedJson(
        context.req.raw,
        MAX_SCHEDULE_REQUEST_BYTES,
        "Schedule update request",
      );
    } catch (error) {
      return jsonError(
        context,
        errorMessage(error),
        error instanceof RequestBodyTooLargeError ? 413 : 400,
      );
    }
    const body = parseUpdateAutomationScheduleRequest(input);
    if (!body) {
      return jsonError(context, "Schedule update request is invalid", 400);
    }
    try {
      if (body.model) await assertAvailableModel(services, body.model);
    } catch (error) {
      return jsonError(context, errorMessage(error), 400);
    }
    const before = services.store.getSchedule(scheduleId);
    const schedule = await services.store.updateSchedule(scheduleId, body);
    const changedFields = scheduleChangedFields(before, schedule);
    if (changedFields.length > 0) {
      await appendAutomationEvent(services, schedule, "schedule.updated", {
        scheduleId: schedule.id,
        status: schedule.status,
        nextRunAt: schedule.nextRunAt,
        revision: schedule.revision,
        changedFields,
      });
    }
    setAutomationScheduleProjectionHeaders(context, schedule);
    return context.json(schedule);
  });

  app.get("/api/channels", (context) => {
    const channels = services.store.listInboundChannels();
    setInboundChannelListHeaders(context, channels);
    return context.json(channels);
  });

  app.get("/api/channels/adapters", (context) => {
    const catalog = inboundChannelAdapterCatalog();
    setInboundChannelAdapterCatalogHeaders(context, catalog);
    return context.json(catalog);
  });

  app.post("/api/channels", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(
        context.req.raw,
        MAX_CHANNEL_ADMIN_REQUEST_BYTES,
        "Inbound channel request",
      );
    } catch (error) {
      return jsonError(
        context,
        errorMessage(error),
        error instanceof RequestBodyTooLargeError ? 413 : 400,
      );
    }
    const body = parseCreateInboundChannelRequest(input);
    if (!body) {
      return jsonError(context, "Inbound channel request is invalid", 400);
    }
    let created;
    try {
      created = await services.store.createInboundChannel(body);
    } catch (error) {
      if (
        isInboundRetryPolicyError(error) ||
        isInboundSignaturePolicyError(error) ||
        isInboundChannelPolicyTemplateError(error)
      ) {
        return jsonError(context, error.message, 400);
      }
      throw error;
    }
    await appendChannelEvent(
      services,
      created.channel.threadId,
      "channel.created",
      {
        channelId: created.channel.id,
        name: created.channel.name,
        type: created.channel.type,
        adapter: created.channel.adapter,
        status: created.channel.status,
        tokenFingerprint: created.channel.tokenFingerprint,
        policyTemplate: created.channel.policyTemplate,
        signatureRequired: created.channel.signaturePolicy.required,
        signatureAlgorithm: created.channel.signaturePolicy.algorithm,
        signatureToleranceSeconds:
          created.channel.signaturePolicy.toleranceSeconds,
        retryMaxAttempts: created.channel.retryPolicy.maxAttempts,
        retryBaseDelayMs: created.channel.retryPolicy.baseDelayMs,
        revision: created.channel.revision,
      },
    );
    setInboundChannelProjectionHeaders(context, created.channel);
    return context.json(created, 201);
  });

  app.post("/api/channels/:channelId/status", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(
        context.req.raw,
        MAX_CHANNEL_ADMIN_REQUEST_BYTES,
        "Inbound channel status request",
      );
    } catch (error) {
      return jsonError(
        context,
        errorMessage(error),
        error instanceof RequestBodyTooLargeError ? 413 : 400,
      );
    }
    const body = parseSetInboundChannelStatusRequest(input);
    if (!body) {
      return jsonError(
        context,
        "Inbound channel status request is invalid",
        400,
      );
    }
    const before = services.store.getInboundChannel(
      context.req.param("channelId"),
    );
    const channel = await services.store.setInboundChannelStatus(
      context.req.param("channelId"),
      body.status,
    );
    if (channel.revision !== before.revision) {
      await appendChannelEvent(
        services,
        channel.threadId,
        body.status === "active" ? "channel.enabled" : "channel.disabled",
        {
          channelId: channel.id,
          status: channel.status,
          revision: channel.revision,
        },
      );
    }
    setInboundChannelProjectionHeaders(context, channel, {
      includeContentSha256: true,
    });
    return context.json(channel);
  });

  app.put("/api/channels/:channelId/retry-policy", async (context) => {
    const channelId = context.req.param("channelId");
    let input: unknown;
    try {
      input = await readLimitedJson(
        context.req.raw,
        MAX_CHANNEL_ADMIN_REQUEST_BYTES,
        "Inbound retry policy request",
      );
    } catch (error) {
      return jsonError(
        context,
        errorMessage(error),
        error instanceof RequestBodyTooLargeError ? 413 : 400,
      );
    }
    const body = parseUpdateInboundRetryPolicyRequest(input);
    if (!body) {
      return jsonError(context, "Inbound retry policy request is invalid", 400);
    }
    const before = services.store.getInboundChannel(channelId);
    let channel;
    try {
      channel = await services.store.updateInboundRetryPolicy(
        channelId,
        body.retryPolicy,
      );
    } catch (error) {
      if (isInboundRetryPolicyError(error)) {
        return jsonError(context, error.message, 400);
      }
      throw error;
    }
    if (channel.revision !== before.revision) {
      await appendChannelEvent(
        services,
        channel.threadId,
        "channel.retry_policy.updated",
        {
          channelId: channel.id,
          previousMaxAttempts: before.retryPolicy.maxAttempts,
          previousBaseDelayMs: before.retryPolicy.baseDelayMs,
          maxAttempts: channel.retryPolicy.maxAttempts,
          baseDelayMs: channel.retryPolicy.baseDelayMs,
          revision: channel.revision,
        },
      );
    }
    setInboundChannelProjectionHeaders(context, channel, {
      includeContentSha256: true,
    });
    return context.json(channel);
  });

  app.put("/api/channels/:channelId/signature-policy", async (context) => {
    const channelId = context.req.param("channelId");
    let input: unknown;
    try {
      input = await readLimitedJson(
        context.req.raw,
        MAX_CHANNEL_ADMIN_REQUEST_BYTES,
        "Inbound signature policy request",
      );
    } catch (error) {
      return jsonError(
        context,
        errorMessage(error),
        error instanceof RequestBodyTooLargeError ? 413 : 400,
      );
    }
    const body = parseUpdateInboundSignaturePolicyRequest(input);
    if (!body) {
      return jsonError(
        context,
        "Inbound signature policy request is invalid",
        400,
      );
    }
    const before = services.store.getInboundChannel(channelId);
    let channel;
    try {
      channel = await services.store.updateInboundSignaturePolicy(
        channelId,
        body.signaturePolicy,
      );
    } catch (error) {
      if (isInboundSignaturePolicyError(error)) {
        return jsonError(context, error.message, 400);
      }
      throw error;
    }
    if (channel.revision !== before.revision) {
      await appendChannelEvent(
        services,
        channel.threadId,
        "channel.signature_policy.updated",
        {
          channelId: channel.id,
          previousRequired: before.signaturePolicy.required,
          previousToleranceSeconds: before.signaturePolicy.toleranceSeconds,
          required: channel.signaturePolicy.required,
          toleranceSeconds: channel.signaturePolicy.toleranceSeconds,
          algorithm: channel.signaturePolicy.algorithm,
          revision: channel.revision,
        },
      );
    }
    setInboundChannelProjectionHeaders(context, channel, {
      includeContentSha256: true,
    });
    return context.json(channel);
  });

  app.post("/api/channels/:channelId/token", async (context) => {
    const channelId = context.req.param("channelId");
    const before = services.store.getInboundChannel(channelId);
    const rotated = await services.store.rotateInboundChannelToken(channelId);
    await appendChannelEvent(
      services,
      rotated.channel.threadId,
      "channel.token.rotated",
      {
        channelId: rotated.channel.id,
        previousTokenFingerprint: before.tokenFingerprint,
        tokenFingerprint: rotated.channel.tokenFingerprint,
        status: rotated.channel.status,
        revision: rotated.channel.revision,
      },
    );
    setInboundChannelProjectionHeaders(context, rotated.channel);
    return context.json(rotated);
  });

  app.post("/api/channels/:channelId/adapter-preview", async (context) => {
    const channelId = context.req.param("channelId");
    let input: unknown;
    try {
      input = await readLimitedJson(
        context.req.raw,
        MAX_CHANNEL_ADAPTER_PREVIEW_REQUEST_BYTES,
        "Inbound adapter preview request",
      );
    } catch (error) {
      return jsonError(
        context,
        errorMessage(error),
        error instanceof RequestBodyTooLargeError ? 413 : 400,
      );
    }
    const body = parsePreviewInboundChannelAdapterRequest(input);
    if (!body) {
      return jsonError(
        context,
        "Inbound adapter preview request is invalid",
        400,
      );
    }
    if (Buffer.byteLength(body.body) > MAX_INBOUND_BODY_BYTES) {
      return jsonError(context, "Inbound preview body is too large", 413);
    }
    let channel;
    try {
      channel = services.store.getInboundChannel(channelId);
    } catch {
      return jsonError(context, "Inbound channel not found", 404);
    }
    const parsed = parseInboundMessageForAdapter(
      channel.adapter,
      body.body,
      previewHeaders(body.headers),
    );
    if (!parsed.ok) {
      return jsonError(context, parsed.error, 400);
    }
    if (parsed.body.model) {
      try {
        await assertAvailableModel(services, parsed.body.model);
      } catch (error) {
        return jsonError(context, errorMessage(error), 400);
      }
    }
    const preview = createInboundChannelAdapterPreview(
      channel.id,
      channel.adapter,
      body.body,
      parsed.body,
    );
    setInboundChannelAdapterPreviewHeaders(context, preview);
    return context.json(preview);
  });

  app.get("/api/channels/:channelId/deliveries", (context) => {
    const channelId = context.req.param("channelId");
    services.store.getInboundChannel(channelId);
    const deliveries = services.store.listInboundDeliveries(channelId);
    setInboundDeliveryListHeaders(context, channelId, deliveries);
    return context.json(deliveries);
  });

  app.get(
    "/api/channels/:channelId/deliveries/:deliveryId/qualification",
    (context) => {
      const channelId = context.req.param("channelId");
      services.store.getInboundChannel(channelId);
      const delivery = services.store
        .listInboundDeliveries(channelId)
        .find((candidate) => candidate.id === context.req.param("deliveryId"));
      if (!delivery) {
        return jsonError(context, "Inbound delivery not found", 404);
      }
      const qualification = createInboundDeliveryQualification(
        delivery,
        inboundChannelAdapterCatalogSha256(),
      );
      setInboundDeliveryQualificationHeaders(context, qualification);
      return context.json(qualification);
    },
  );

  app.post("/api/channels/:channelId/dead-letters/export", async (context) => {
    const artifact = services.store.exportInboundDeadLetters(
      context.req.param("channelId"),
      new Date(),
      inboundChannelAdapterCatalogSha256(),
    );
    const qualificationSummary =
      inboundDeadLetterQualificationSummary(artifact);
    await appendChannelEvent(
      services,
      artifact.channel.threadId,
      "channel.dead_letters.exported",
      {
        channelId: artifact.channel.id,
        schemaVersion: artifact.schemaVersion,
        deliveryCount: artifact.deliveryCount,
        contentSha256: artifact.contentSha256,
        ...(artifact.currentAdapterCatalogSha256
          ? {
              currentAdapterCatalogSha256: artifact.currentAdapterCatalogSha256,
            }
          : {}),
        ...qualificationSummary,
      },
    );
    setInboundDeadLetterExportHeaders(context, artifact);
    return context.json(artifact);
  });

  app.post("/api/channels/:channelId/dead-letters/verify", async (context) => {
    const channelId = context.req.param("channelId");
    services.store.getInboundChannel(channelId);
    let input: unknown;
    try {
      input = await readLimitedJson(
        context.req.raw,
        MAX_DEAD_LETTER_EXPORT_VERIFY_REQUEST_BYTES,
        "Dead-letter export verification request",
      );
    } catch (error) {
      return jsonError(
        context,
        errorMessage(error),
        error instanceof RequestBodyTooLargeError ? 413 : 400,
      );
    }
    const body = parseVerifyInboundDeadLetterExportRequest(input);
    if (!body) {
      return jsonError(
        context,
        "Dead-letter export verification request is invalid",
        400,
      );
    }
    const verification = verifyInboundDeadLetterExportArtifact(body.artifact, {
      expectedChannelId: channelId,
    });
    setInboundDeadLetterExportVerificationHeaders(context, verification);
    return context.json(verification);
  });

  app.post(
    "/api/channels/:channelId/dead-letters/retry-preview",
    async (context) => {
      const channelId = context.req.param("channelId");
      let input: unknown;
      try {
        input = await readLimitedJson(
          context.req.raw,
          MAX_DEAD_LETTER_EXPORT_VERIFY_REQUEST_BYTES,
          "Dead-letter retry preview request",
        );
      } catch (error) {
        return jsonError(
          context,
          errorMessage(error),
          error instanceof RequestBodyTooLargeError ? 413 : 400,
        );
      }
      const body = parsePreviewInboundDeadLetterRetryRequest(input);
      if (!body) {
        return jsonError(
          context,
          "Dead-letter retry preview request is invalid",
          400,
        );
      }
      const preview = services.channels.previewDeadLetterRetry(
        channelId,
        body.artifact,
      );
      setInboundDeadLetterRetryPreviewHeaders(context, preview);
      return context.json(preview);
    },
  );

  app.post(
    "/api/channels/:channelId/dead-letters/retry-apply",
    async (context) => {
      const channelId = context.req.param("channelId");
      let input: unknown;
      try {
        input = await readLimitedJson(
          context.req.raw,
          MAX_DEAD_LETTER_EXPORT_VERIFY_REQUEST_BYTES,
          "Dead-letter retry apply request",
        );
      } catch (error) {
        return jsonError(
          context,
          errorMessage(error),
          error instanceof RequestBodyTooLargeError ? 413 : 400,
        );
      }
      const body = parseApplyInboundDeadLetterRetryRequest(input);
      if (!body) {
        return jsonError(
          context,
          "Dead-letter retry apply request is invalid",
          400,
        );
      }
      try {
        const result = await services.channels.retryDeadLetters(
          channelId,
          body.artifact,
          body.expectedPreviewSha256,
          body.confirmReplay,
        );
        const channel = services.store.getInboundChannel(channelId);
        await appendChannelEvent(
          services,
          channel.threadId,
          "channel.dead_letters.retry_applied",
          {
            channelId,
            applyResultSha256: result.contentSha256,
            previewSha256: result.previewSha256,
            ...(result.artifactSha256
              ? { artifactSha256: result.artifactSha256 }
              : {}),
            previewCandidateSetSha256: result.previewCandidateSetSha256,
            previewRetryableDeliveryIdsSha256:
              result.previewRetryableDeliveryIdsSha256,
            previewBlockedDeliveryIdsSha256:
              result.previewBlockedDeliveryIdsSha256,
            retriedCount: result.retriedCount,
            skippedCount: result.skippedCount,
            retriedDeliveryIdsSha256: result.retriedDeliveryIdsSha256,
            skippedDeliveryIdsSha256: result.skippedDeliveryIdsSha256,
          },
        );
        setInboundDeadLetterRetryApplyResultHeaders(context, result);
        return context.json(result, 202);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (
          message.includes("confirmation") ||
          message.includes("preview") ||
          message.includes("valid export")
        ) {
          return jsonError(context, message, 409);
        }
        throw error;
      }
    },
  );

  app.get(
    "/api/channels/:channelId/dead-letters/retry-history",
    async (context) => {
      const channelId = context.req.param("channelId");
      const channel = services.store.getInboundChannel(channelId);
      const history = createInboundDeadLetterRetryHistory(
        channelId,
        await services.store.listEvents(channel.threadId),
      );
      setInboundDeadLetterRetryHistoryHeaders(context, history, channel);
      return context.json(history);
    },
  );

  app.post(
    "/api/channels/:channelId/dead-letters/retry-history/verify",
    async (context) => {
      const channelId = context.req.param("channelId");
      const channel = services.store.getInboundChannel(channelId);
      let input: unknown;
      try {
        input = await readLimitedJson(
          context.req.raw,
          MAX_DEAD_LETTER_EXPORT_VERIFY_REQUEST_BYTES,
          "Dead-letter retry history verification request",
        );
      } catch (error) {
        return jsonError(
          context,
          errorMessage(error),
          error instanceof RequestBodyTooLargeError ? 413 : 400,
        );
      }
      const body = parseVerifyInboundDeadLetterRetryHistoryRequest(input);
      if (!body) {
        return jsonError(
          context,
          "Dead-letter retry history verification request is invalid",
          400,
        );
      }
      const verification = verifyInboundDeadLetterRetryHistory(body.history, {
        expectedChannelId: channelId,
        events: await services.store.listEvents(channel.threadId),
      });
      setInboundDeadLetterRetryHistoryVerificationHeaders(
        context,
        verification,
      );
      return context.json(verification);
    },
  );

  app.post(
    "/api/channels/:channelId/deliveries/:deliveryId/retry",
    async (context) => {
      try {
        const delivery = await services.channels.retry(
          context.req.param("channelId"),
          context.req.param("deliveryId"),
        );
        setInboundDeliveryProjectionHeaders(context, delivery);
        return context.json(delivery, 202);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (
          message.includes("can be retried") ||
          message.includes("retry limit") ||
          message.includes("still active")
        ) {
          return jsonError(context, message, 409);
        }
        throw error;
      }
    },
  );

  app.post("/api/channels/:channelId/inbound", async (context) => {
    const declaredLength = Number.parseInt(
      context.req.header("content-length") ?? "0",
      10,
    );
    if (
      Number.isFinite(declaredLength) &&
      declaredLength > MAX_INBOUND_BODY_BYTES
    ) {
      return jsonError(context, "Inbound body is too large", 413);
    }
    const source = await context.req.text();
    if (Buffer.byteLength(source) > MAX_INBOUND_BODY_BYTES) {
      return jsonError(context, "Inbound body is too large", 413);
    }
    const token = inboundChannelToken(context.req.raw.headers);
    if (!token) {
      return jsonError(context, "Inbound channel token is required", 401);
    }
    let channelAdapter: InboundChannelAdapter;
    try {
      const channel = services.store.getInboundChannel(
        context.req.param("channelId"),
      );
      channelAdapter = channel.adapter;
      if (
        channel.signaturePolicy.required &&
        !validInboundSignature(
          context.req.raw.headers,
          source,
          token,
          channel.signaturePolicy.toleranceSeconds,
        )
      ) {
        return jsonError(context, "Inbound channel signature is invalid", 401);
      }
    } catch (error) {
      return jsonError(context, "Inbound channel token is invalid", 401);
    }
    const parsed = parseInboundMessageForAdapter(
      channelAdapter,
      source,
      context.req.raw.headers,
    );
    if (!parsed.ok) {
      return jsonError(context, parsed.error, 400);
    }
    const body: InboundMessageRequest = {
      ...parsed.body,
      bodySha256: sha256Text(source),
      adapterCatalogSha256: inboundChannelAdapterCatalogSha256(),
    };
    if (body.model) {
      try {
        await assertAvailableModel(services, body.model);
      } catch (error) {
        return jsonError(context, errorMessage(error), 400);
      }
    }
    try {
      const receipt = await services.channels.accept(
        context.req.param("channelId"),
        token,
        body,
      );
      setInboundReceiptHeaders(context, receipt);
      return context.json(receipt, receipt.duplicate ? 200 : 202);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        message.includes("channel token") ||
        message.includes("Inbound channel not found")
      ) {
        return jsonError(context, "Inbound channel token is invalid", 401);
      }
      if (message.includes("channel is disabled")) {
        return jsonError(context, message, 409);
      }
      if (isInboundMessageValidationError(error)) {
        return jsonError(context, message, 400);
      }
      throw error;
    }
  });

  app.put("/api/agents/:agentId", async (context) => {
    const agentId = context.req.param("agentId");
    let input: unknown;
    try {
      input = await readLimitedJson(
        context.req.raw,
        MAX_AGENT_PROFILE_REQUEST_BYTES,
        "Agent profile request",
      );
    } catch (error) {
      return jsonError(
        context,
        errorMessage(error),
        error instanceof RequestBodyTooLargeError ? 413 : 400,
      );
    }
    const body = parseUpdateAgentProfileRequest(input);
    if (!body) {
      return jsonError(context, "Agent profile request is invalid", 400);
    }
    if (body.threadId) {
      const thread = services.store.getThread(body.threadId);
      if (thread.agentId !== agentId) {
        return jsonError(
          context,
          "Audit thread does not use the target Agent",
          400,
        );
      }
    }
    const before = services.store.getAgent(agentId);
    const requestedModel = body.model
      ? {
          provider: body.model.provider.trim().toLowerCase(),
          id: body.model.id.trim(),
        }
      : undefined;
    try {
      if (requestedModel) await assertAvailableModel(services, requestedModel);
      await assertAdvisorReviewModel(
        services,
        requestedModel ?? before.model,
        body.modelAdvisor !== undefined
          ? body.modelAdvisor.reviewModel
          : before.modelAdvisor?.reviewModel,
      );
    } catch (error) {
      return jsonError(context, errorMessage(error), 400);
    }
    let updated: AgentProfile;
    try {
      updated = await services.store.updateAgent(agentId, {
        ...body,
        ...(requestedModel ? { model: requestedModel } : {}),
      });
    } catch (error) {
      return jsonError(context, errorMessage(error), 400);
    }
    const changedFields = changedAgentFields(before, updated);
    const revision = services.store.getAgentRevision(agentId, updated.revision);
    if (body.threadId && changedFields.length > 0) {
      await services.store.appendEvent({
        threadId: body.threadId,
        runId: createId("runctl"),
        type: "agent.updated",
        category: "system",
        visibility: "user",
        payload: {
          agentId,
          revision: updated.revision,
          changedFields,
          profileRevisionSha256: revision.contentSha256,
        },
      });
    }
    setAgentProfileHeaders(context, updated, revision, changedFields.length);
    return context.json(updated);
  });

  app.get("/api/agents/:agentId/revisions", (context) => {
    const agentId = context.req.param("agentId");
    const revisions = services.store.listAgentRevisions(agentId);
    setAgentRevisionListHeaders(context, agentId, revisions);
    return context.json(revisions);
  });

  app.post("/api/agents/:agentId/rollback", async (context) => {
    const agentId = context.req.param("agentId");
    let input: unknown;
    try {
      input = await readLimitedJson(
        context.req.raw,
        MAX_AGENT_PROFILE_REQUEST_BYTES,
        "Agent rollback request",
      );
    } catch (error) {
      return jsonError(
        context,
        errorMessage(error),
        error instanceof RequestBodyTooLargeError ? 413 : 400,
      );
    }
    const body = parseRollbackAgentProfileRequest(input);
    if (!body) {
      return jsonError(context, "Agent rollback request is invalid", 400);
    }
    const thread = services.store.getThread(body.threadId);
    if (thread.agentId !== agentId) {
      return jsonError(
        context,
        "Audit thread does not use the target Agent",
        400,
      );
    }
    const target = services.store.getAgentRevision(agentId, body.revision);
    try {
      await assertAvailableModel(services, target.profile.model);
      await assertAdvisorReviewModel(
        services,
        target.profile.model,
        target.profile.modelAdvisor?.reviewModel,
      );
    } catch (error) {
      return jsonError(context, errorMessage(error), 400);
    }
    const result = await services.store.rollbackAgent(agentId, body.revision);
    await services.store.appendEvent({
      threadId: body.threadId,
      runId: createId("runctl"),
      type: "agent.rolled_back",
      category: "system",
      visibility: "user",
      payload: {
        agentId,
        revision: result.agent.revision,
        restoredFromRevision: body.revision,
        changedFields: result.revision.changedFields,
        profileRevisionSha256: result.revision.contentSha256,
        restoredSnapshotSha256: target.contentSha256,
      },
    });
    setAgentRollbackHeaders(context, result, target);
    return context.json(result);
  });

  app.get("/api/threads/:threadId/events", async (context) => {
    const after = Number.parseInt(context.req.query("after") ?? "0", 10);
    const afterSeq = Number.isFinite(after) ? after : 0;
    const threadId = context.req.param("threadId");
    const events = await services.store.listEvents(threadId, afterSeq);
    setThreadEventsProjectionHeaders(context, threadId, events, afterSeq);
    return context.json(events);
  });

  app.get("/api/threads/:threadId/fixture", async (context) => {
    const bundle = await exportThreadReplayBundle(
      services.store,
      context.req.param("threadId"),
    );
    const verification = verifyThreadReplayBundle(bundle);
    if (verification.status !== "valid") {
      throw new Error(
        `Exported thread replay bundle verification failed: ${verification.diagnostics.join(", ")}`,
      );
    }
    setThreadReplayBundleHeaders(context, bundle, verification);
    return context.json(bundle);
  });

  app.post("/api/threads/import/verify", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(
        context.req.raw,
        MAX_THREAD_REPLAY_BUNDLE_BYTES,
        "Thread replay bundle verification request",
      );
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return jsonError(context, error.message, 413);
      }
      return jsonError(
        context,
        error instanceof Error
          ? `Invalid thread replay verification request: ${error.message}`
          : "Invalid thread replay verification request",
        400,
      );
    }
    const request = parseVerifyThreadReplayBundleRequest(input);
    if (!request) {
      return jsonError(
        context,
        "Thread replay verification request is invalid",
        400,
      );
    }
    const verification = verifyThreadReplayBundle(request.bundle);
    setThreadReplayBundleVerificationHeaders(context, verification);
    return context.json(verification);
  });

  app.post("/api/threads/:threadId/trace/otlp", async (context) => {
    let input: unknown;
    try {
      input = await readOptionalLimitedJson(
        context.req.raw,
        MAX_TRACE_EXPORT_REQUEST_BYTES,
        "OpenTelemetry trace export request",
      );
    } catch (error) {
      return jsonError(
        context,
        errorMessage(error),
        error instanceof RequestBodyTooLargeError ? 413 : 400,
      );
    }
    const body = parseExportOpenTelemetryTraceRequest(input);
    if (!body) {
      return jsonError(
        context,
        "OpenTelemetry trace export request is invalid",
        400,
      );
    }
    const threadId = context.req.param("threadId");
    const artifact = await createOpenTelemetryTraceArtifact(
      services.store,
      threadId,
      body.runId,
    );
    await services.store.appendEvent({
      threadId,
      runId: createId("runctl"),
      type: "trace.otlp.exported",
      category: "system",
      visibility: "user",
      payload: {
        scope: body.runId ? "run" : "thread",
        ...(body.runId ? { sourceRunId: body.runId } : {}),
        traceId: artifact.traceId,
        spanCount: artifact.spanCount,
        eventCount: artifact.eventRange.eventCount,
        eventStreamSha256: artifact.eventRange.eventStreamSha256,
        eventAnchorSetSha256:
          openTelemetryTraceArtifactEventAnchorSetSha256(artifact),
        contentSha256: artifact.contentSha256,
      },
    });
    setOpenTelemetryTraceArtifactHeaders(context, artifact);
    return context.json(artifact);
  });

  app.post("/api/threads/:threadId/trace/otlp/verify", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(
        context.req.raw,
        MAX_THREAD_REPLAY_BUNDLE_BYTES,
        "OpenTelemetry trace verification request",
      );
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return jsonError(context, error.message, 413);
      }
      return jsonError(
        context,
        error instanceof Error
          ? `Invalid OpenTelemetry trace verification request: ${error.message}`
          : "Invalid OpenTelemetry trace verification request",
        400,
      );
    }
    const request = parseVerifyOpenTelemetryTraceArtifactRequest(input);
    if (!request) {
      return jsonError(
        context,
        "OpenTelemetry trace verification request is invalid",
        400,
      );
    }
    const verification = bindOpenTelemetryTraceArtifactVerification(
      verifyOpenTelemetryTraceArtifact(request.artifact),
      context.req.param("threadId"),
    );
    setOpenTelemetryTraceArtifactVerificationHeaders(context, verification);
    return context.json(verification);
  });

  app.get("/api/threads/:threadId/runs/:runId/replay", async (context) => {
    const snapshot = await createRunReplaySnapshot(
      services.store,
      context.req.param("threadId"),
      context.req.param("runId"),
    );
    setRunReplaySnapshotHeaders(context, snapshot);
    return context.json(snapshot);
  });

  app.post(
    "/api/threads/:threadId/runs/:runId/replay/verify",
    async (context) => {
      let input: unknown;
      try {
        input = await readLimitedJson(
          context.req.raw,
          MAX_THREAD_REPLAY_BUNDLE_BYTES,
          "Run replay snapshot verification request",
        );
      } catch (error) {
        if (error instanceof RequestBodyTooLargeError) {
          return jsonError(context, error.message, 413);
        }
        return jsonError(
          context,
          error instanceof Error
            ? `Invalid Run replay snapshot verification request: ${error.message}`
            : "Invalid Run replay snapshot verification request",
          400,
        );
      }
      const request = parseVerifyRunReplaySnapshotRequest(input);
      if (!request) {
        return jsonError(
          context,
          "Run replay snapshot verification request is invalid",
          400,
        );
      }
      const verification = bindRunReplaySnapshotVerification(
        verifyRunReplaySnapshot(request.snapshot),
        context.req.param("threadId"),
        context.req.param("runId"),
      );
      setRunReplaySnapshotVerificationHeaders(context, verification);
      return context.json(verification);
    },
  );

  app.get("/api/threads/:threadId/runs/compare", async (context) => {
    const leftRunId = context.req.query("left")?.trim();
    const rightRunId = context.req.query("right")?.trim();
    if (!leftRunId || !rightRunId) {
      return jsonError(context, "left and right run IDs are required", 400);
    }
    const comparison = await compareRuns(
      services.store,
      context.req.param("threadId"),
      leftRunId,
      rightRunId,
    );
    setRunComparisonHeaders(context, comparison);
    return context.json(comparison);
  });

  app.get("/api/threads/:threadId/evaluations", (context) => {
    const threadId = context.req.param("threadId");
    services.store.getThread(threadId);
    const evaluations = services.store.listRunEvaluations(threadId);
    setRunEvaluationListHeaders(context, threadId, evaluations);
    return context.json(evaluations);
  });

  app.get("/api/threads/:threadId/evaluation-adjudications", (context) => {
    const threadId = context.req.param("threadId");
    services.store.getThread(threadId);
    const adjudications = services.store.listEvaluationAdjudications(threadId);
    setEvaluationAdjudicationListHeaders(context, threadId, adjudications);
    return context.json(adjudications);
  });

  app.get("/api/threads/:threadId/evaluation-calibration", (context) => {
    const report = services.store.getEvaluationCalibration(
      context.req.param("threadId"),
    );
    setEvaluationCalibrationHeaders(context, report);
    return context.json(report);
  });

  app.get(
    "/api/threads/:threadId/context-checkpoint-calibration",
    async (context) => {
      const report = await services.store.getContextCheckpointCalibration(
        context.req.param("threadId"),
      );
      setContextCheckpointCalibrationHeaders(context, report);
      return context.json(report);
    },
  );

  app.get("/api/evaluation-casebooks", (context) => {
    const casebooks = services.store.listEvaluationCasebooks();
    setEvaluationCasebookListHeaders(context, casebooks);
    return context.json(casebooks);
  });

  app.get("/api/evaluation-casebooks/:casebookId", (context) => {
    const casebook = services.store.getEvaluationCasebook(
      context.req.param("casebookId"),
    );
    setEvaluationCasebookProjectionHeaders(context, casebook);
    return context.json(casebook);
  });

  app.get("/api/evaluation-casebooks/:casebookId/calibration", (context) => {
    const report = services.store.getEvaluationCasebookCalibration(
      context.req.param("casebookId"),
    );
    setEvaluationCasebookCalibrationHeaders(context, report);
    return context.json(report);
  });

  app.get("/api/evaluation-casebooks/:casebookId/export", (context) => {
    const artifact = services.store.exportEvaluationCasebook(
      context.req.param("casebookId"),
    );
    setEvaluationCasebookArtifactHeaders(context, artifact);
    return context.json(artifact);
  });

  app.get("/api/evaluation-casebooks/:casebookId/qualifications", (context) => {
    const casebookId = context.req.param("casebookId");
    const qualifications =
      services.store.listEvaluationCasebookQualificationExecutions(casebookId);
    setEvaluationCasebookQualificationListHeaders(
      context,
      casebookId,
      qualifications,
    );
    return context.json(qualifications);
  });

  app.get(
    "/api/evaluation-casebooks/:casebookId/qualification-receipt",
    (context) => {
      const receipt = createEvaluationCasebookQualificationReceipt(
        services.store,
        context.req.param("casebookId"),
      );
      setEvaluationCasebookQualificationReceiptHeaders(context, receipt);
      return context.json(receipt);
    },
  );

  app.post(
    "/api/evaluation-casebooks/:casebookId/signed-qualification-receipt",
    async (context) => {
      let input: unknown;
      try {
        input = await readLimitedJson(
          context.req.raw,
          MAX_TRUST_ADMIN_REQUEST_BYTES,
          "Signed qualification receipt request",
        );
      } catch (error) {
        return jsonError(
          context,
          errorMessage(error),
          error instanceof RequestBodyTooLargeError ? 413 : 400,
        );
      }
      const body = parseSignTrustedReceiptRequest(input, true);
      if (!body?.threadId) {
        return jsonError(
          context,
          "Signed qualification receipt request is invalid",
          400,
        );
      }
      services.store.getThread(body.threadId);
      const receipt = createEvaluationCasebookQualificationReceipt(
        services.store,
        context.req.param("casebookId"),
      );
      const envelope = signTrustedReceipt(
        receipt,
        services.store.getReceiptTrustAnchor(body.trustAnchorId),
      );
      await appendReceiptTrustEvent(
        services,
        body.threadId,
        "receipt.signed",
        trustedReceiptEventPayload(envelope),
      );
      setTrustedReceiptHeaders(
        context,
        envelope,
        `napier-signed-casebook-qualification-${receipt.casebook.id}-r${receipt.casebook.currentRevision}-${envelope.contentSha256.slice(0, 12)}.json`,
      );
      return context.json(envelope, 201);
    },
  );

  app.get(
    "/api/evaluation-casebooks/:casebookId/qualification-baselines",
    (context) => {
      const casebookId = context.req.param("casebookId");
      const baselines =
        services.store.listEvaluationQualificationBaselines(casebookId);
      setEvaluationQualificationBaselineListHeaders(
        context,
        casebookId,
        baselines,
      );
      return context.json(baselines);
    },
  );

  app.post(
    "/api/evaluation-casebooks/:casebookId/qualification-baselines",
    async (context) => {
      let input: unknown;
      try {
        input = await readLimitedJson(
          context.req.raw,
          MAX_TRUST_ADMIN_REQUEST_BYTES,
          "Qualification baseline request",
        );
      } catch (error) {
        return jsonError(
          context,
          errorMessage(error),
          error instanceof RequestBodyTooLargeError ? 413 : 400,
        );
      }
      const body = parsePromoteEvaluationQualificationBaselineRequest(input);
      if (!body) {
        return jsonError(
          context,
          "Qualification baseline request is invalid",
          400,
        );
      }
      services.store.getThread(body.threadId);
      const casebookId = context.req.param("casebookId");
      const receipt = createEvaluationCasebookQualificationReceipt(
        services.store,
        casebookId,
      );
      if (receipt.state !== "passed") {
        return jsonError(
          context,
          "Qualification baseline requires a current passing receipt",
          409,
        );
      }
      const envelope = signTrustedReceipt(
        receipt,
        services.store.getReceiptTrustAnchor(body.trustAnchorId),
      );
      let result;
      try {
        result = await services.store.promoteEvaluationQualificationBaseline(
          casebookId,
          body.threadId,
          envelope,
        );
      } catch (error) {
        if (
          error instanceof Error &&
          (error.message.includes("current passing receipt") ||
            error.message.includes("not trusted") ||
            error.message.includes("changed"))
        ) {
          return jsonError(context, error.message, 409);
        }
        throw error;
      }
      if (result.created) {
        await appendReceiptTrustEvent(
          services,
          body.threadId,
          "evaluation.casebook.qualification_baseline.promoted",
          {
            baselineId: result.baseline.id,
            casebookId: result.baseline.casebookId,
            casebookRevision: result.baseline.casebookRevision,
            qualificationExecutionId: result.baseline.qualificationExecutionId,
            keyId: result.baseline.envelope.signature.keyId,
            receiptSha256: result.baseline.envelope.receipt.contentSha256,
            receiptArtifactSha256:
              result.baseline.envelope.signature.receiptArtifactSha256,
            envelopeSha256: result.baseline.envelope.contentSha256,
            baselineSha256: result.baseline.contentSha256,
          },
        );
      }
      setPromoteEvaluationQualificationBaselineResultHeaders(context, result);
      return context.json(result, result.created ? 201 : 200);
    },
  );

  app.get("/api/threads/:threadId/evaluation-suites", (context) => {
    const threadId = context.req.param("threadId");
    services.store.getThread(threadId);
    const suites = services.store.listEvaluationSuites(threadId);
    setEvaluationSuiteListHeaders(context, threadId, suites);
    return context.json(suites);
  });

  app.get(
    "/api/threads/:threadId/evaluation-suites/:suiteId/receipt",
    (context) => {
      const receipt = createEvaluationSuiteGateReceipt(
        services.store,
        context.req.param("threadId"),
        context.req.param("suiteId"),
      );
      setEvaluationSuiteGateReceiptHeaders(context, receipt);
      return context.json(receipt);
    },
  );

  app.post(
    "/api/threads/:threadId/evaluation-suites/:suiteId/signed-receipt",
    async (context) => {
      let input: unknown;
      try {
        input = await readLimitedJson(
          context.req.raw,
          MAX_TRUST_ADMIN_REQUEST_BYTES,
          "Signed evaluation gate receipt request",
        );
      } catch (error) {
        return jsonError(
          context,
          errorMessage(error),
          error instanceof RequestBodyTooLargeError ? 413 : 400,
        );
      }
      const body = parseSignTrustedReceiptRequest(input, false);
      if (!body) {
        return jsonError(
          context,
          "Signed evaluation gate receipt request is invalid",
          400,
        );
      }
      const threadId = context.req.param("threadId");
      const receipt = createEvaluationSuiteGateReceipt(
        services.store,
        threadId,
        context.req.param("suiteId"),
      );
      const envelope = signTrustedReceipt(
        receipt,
        services.store.getReceiptTrustAnchor(body.trustAnchorId),
      );
      await appendReceiptTrustEvent(
        services,
        threadId,
        "receipt.signed",
        trustedReceiptEventPayload(envelope),
      );
      setTrustedReceiptHeaders(
        context,
        envelope,
        `napier-signed-gate-${receipt.suite.id}-r${receipt.suite.revision}-${envelope.contentSha256.slice(0, 12)}.json`,
      );
      return context.json(envelope, 201);
    },
  );

  app.get("/api/threads/:threadId/evaluation-suite-executions", (context) => {
    const threadId = context.req.param("threadId");
    services.store.getThread(threadId);
    const suiteId = context.req.query("suite")?.trim();
    const executions = services.store.listEvaluationSuiteExecutions(
      threadId,
      suiteId || undefined,
    );
    setEvaluationSuiteExecutionListHeaders(
      context,
      threadId,
      suiteId || undefined,
      executions,
    );
    return context.json(executions);
  });

  app.get("/api/threads/:threadId/plans", (context) => {
    const threadId = context.req.param("threadId");
    services.store.getThread(threadId);
    const plans = services.store.listPlans(threadId);
    setExecutionPlanListHeaders(context, threadId, plans);
    return context.json(plans);
  });

  app.post("/api/threads/:threadId/plans", async (context) => {
    const threadId = context.req.param("threadId");
    let input: unknown;
    try {
      input = await readLimitedJson(
        context.req.raw,
        128 * 1024,
        "Execution plan request",
      );
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return jsonError(context, error.message, 413);
      }
      return jsonError(context, "Execution plan request is invalid", 400);
    }
    const body = parseCreateExecutionPlanRequest(input);
    if (!body) {
      return jsonError(context, "Execution plan request is invalid", 400);
    }
    const plan = await services.store.createPlan(threadId, body);
    await services.store.appendEvent({
      threadId,
      runId: createId("runctl"),
      type: "plan.created",
      category: "plan",
      visibility: "user",
      payload: {
        planId: plan.id,
        objective: plan.objective,
        status: plan.status,
        stepCount: plan.steps.length,
        artifactCount: plan.artifacts.length,
        criticalPathStepIds: plan.criticalPathStepIds,
        readyStepIds: plan.readyStepIds,
        blockedStepIds: plan.blockedStepIds,
      },
    });
    setExecutionPlanHeaders(context, plan);
    return context.json(plan, 201);
  });

  app.post("/api/threads/:threadId/plans/:planId/replan", async (context) => {
    const threadId = context.req.param("threadId");
    const planId = context.req.param("planId");
    assertPlanThread(services, planId, threadId);
    let input: unknown;
    try {
      input = await readLimitedJson(
        context.req.raw,
        64 * 1024,
        "Plan replan request",
      );
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return jsonError(context, error.message, 413);
      }
      return jsonError(context, "Plan replan request is invalid", 400);
    }
    const body = parseReplanExecutionPlanRequest(input);
    if (!body) {
      return jsonError(context, "Plan replan request is invalid", 400);
    }
    const before = services.store.getPlan(planId);
    const plan = await services.store.replanPlan(planId, body);
    const replan = plan.replans.at(-1);
    if (plan.revision !== before.revision && replan) {
      await services.store.appendEvent({
        threadId,
        runId: createId("runctl"),
        type: "plan.replanned",
        category: "plan",
        visibility: "user",
        payload: {
          planId,
          replanId: replan.id,
          strategy: replan.strategy,
          fromRevision: replan.fromRevision,
          toRevision: replan.toRevision,
          replanSha256: replan.replanSha256,
          addedStepIds: replan.addedStepIds,
          addedArtifactIds: replan.addedArtifactIds,
          supersededStepIds: replan.supersededStepIds,
          supersededArtifactIds: replan.supersededArtifactIds,
          dependencyUpdatedStepIds: replan.dependencyUpdatedStepIds,
          addedStepsSha256: replan.addedStepsSha256,
          addedArtifactsSha256: replan.addedArtifactsSha256,
          dependencyUpdatesSha256: replan.dependencyUpdatesSha256,
          status: plan.status,
          criticalPathStepIds: plan.criticalPathStepIds,
          readyStepIds: plan.readyStepIds,
          blockedStepIds: plan.blockedStepIds,
        },
      });
    }
    setExecutionPlanHeaders(context, plan);
    return context.json(plan);
  });

  app.post(
    "/api/threads/:threadId/plans/:planId/replan-draft-review",
    async (context) => {
      const threadId = context.req.param("threadId");
      const planId = context.req.param("planId");
      assertPlanThread(services, planId, threadId);
      const plan = services.store.getPlan(planId);
      let input: unknown;
      try {
        input = await readOptionalLimitedJson(
          context.req.raw,
          8 * 1024,
          "Plan replan draft review request",
        );
      } catch (error) {
        if (error instanceof RequestBodyTooLargeError) {
          return jsonError(context, error.message, 413);
        }
        return jsonError(
          context,
          "Plan replan draft review request is invalid",
          400,
        );
      }
      const body = parseReviewExecutionPlanReplanDraftRequest(input);
      if (!body) {
        return jsonError(
          context,
          "Plan replan draft review request is invalid",
          400,
        );
      }
      if (!plan.replanRecommendation) {
        return jsonError(
          context,
          "Plan has no active replan recommendation",
          409,
        );
      }
      const thread = services.store.getThread(threadId);
      const agent = services.store.getAgent(thread.agentId);
      const model = body.model ?? agent.model;
      try {
        await assertAvailableModel(services, model);
        const review = await reviewExecutionPlanReplanDraft(
          services.models,
          plan,
          model,
        );
        setExecutionPlanReplanDraftReviewHeaders(context, review);
        return context.json(review);
      } catch (error) {
        return jsonError(context, errorMessage(error), 400);
      }
    },
  );

  app.get("/api/threads/:threadId/plans/:planId/archive", async (context) => {
    const threadId = context.req.param("threadId");
    const planId = context.req.param("planId");
    assertPlanThread(services, planId, threadId);
    const archive = await createExecutionPlanArchive(
      services.store,
      threadId,
      planId,
    );
    setExecutionPlanArchiveHeaders(context, archive);
    return context.json(archive);
  });

  app.get("/api/threads/:threadId/plans/:planId/blueprint", async (context) => {
    const threadId = context.req.param("threadId");
    const planId = context.req.param("planId");
    assertPlanThread(services, planId, threadId);
    const blueprint = await createExecutionPlanBlueprint(
      services.store,
      threadId,
      planId,
    );
    setExecutionPlanBlueprintHeaders(context, blueprint);
    return context.json(blueprint);
  });

  app.post(
    "/api/threads/:threadId/plans/:planId/archive/verify",
    async (context) => {
      const threadId = context.req.param("threadId");
      const planId = context.req.param("planId");
      assertPlanThread(services, planId, threadId);
      let input: unknown;
      try {
        input = await readLimitedJson(
          context.req.raw,
          MAX_EXECUTION_PLAN_ARCHIVE_BYTES,
          "Execution plan archive verification request",
        );
      } catch (error) {
        if (error instanceof RequestBodyTooLargeError) {
          return jsonError(context, error.message, 413);
        }
        return jsonError(
          context,
          "Execution plan archive verification request is invalid",
          400,
        );
      }
      const request = parseVerifyExecutionPlanArchiveRequest(input);
      if (!request) {
        return jsonError(
          context,
          "Execution plan archive verification request is invalid",
          400,
        );
      }
      const verification = bindExecutionPlanArchiveVerification(
        verifyExecutionPlanArchive(request.archive),
        threadId,
        planId,
      );
      setExecutionPlanArchiveVerificationHeaders(context, verification);
      return context.json(verification);
    },
  );

  app.post(
    "/api/threads/:threadId/plans/blueprints/verify",
    async (context) => {
      const threadId = context.req.param("threadId");
      services.store.getThread(threadId);
      let input: unknown;
      try {
        input = await readLimitedJson(
          context.req.raw,
          MAX_EXECUTION_PLAN_BLUEPRINT_BYTES,
          "Execution plan blueprint verification request",
        );
      } catch (error) {
        if (error instanceof RequestBodyTooLargeError) {
          return jsonError(context, error.message, 413);
        }
        return jsonError(
          context,
          "Execution plan blueprint verification request is invalid",
          400,
        );
      }
      const request = parseVerifyExecutionPlanBlueprintRequest(input);
      if (!request) {
        return jsonError(
          context,
          "Execution plan blueprint verification request is invalid",
          400,
        );
      }
      const verification = verifyExecutionPlanBlueprint(request.blueprint);
      setExecutionPlanBlueprintVerificationHeaders(context, verification);
      return context.json(verification);
    },
  );

  app.get("/api/plan-blueprints", (context) => {
    const status = context.req.query("status");
    if (status !== undefined && status !== "active" && status !== "archived") {
      return jsonError(
        context,
        "Execution plan blueprint status is invalid",
        400,
      );
    }
    const records = services.store.listExecutionPlanBlueprints(status);
    setExecutionPlanBlueprintRecordListHeaders(context, records);
    return context.json(records);
  });

  app.get("/api/plan-blueprints/portfolio/calibration", async (context) => {
    const calibration =
      await services.store.calibrateExecutionPlanBlueprintPortfolio();
    setExecutionPlanBlueprintPortfolioCalibrationHeaders(context, calibration);
    return context.json(calibration);
  });

  app.get(
    "/api/plan-blueprints/portfolio/recommendation-policy-backtest",
    async (context) => {
      const backtest =
        await services.store.backtestExecutionPlanBlueprintRecommendationPolicies();
      setExecutionPlanBlueprintRecommendationPolicyBacktestHeaders(
        context,
        backtest,
      );
      return context.json(backtest);
    },
  );

  app.get(
    "/api/plan-blueprints/portfolio/recommendation-policy-overrides",
    async (context) => {
      const overrides =
        await services.store.listExecutionPlanBlueprintRecommendationPolicyOverrides();
      setExecutionPlanBlueprintRecommendationPolicyOverrideListHeaders(
        context,
        overrides,
      );
      return context.json(overrides);
    },
  );

  app.get(
    "/api/plan-blueprints/portfolio/recommendation-policy-overrides/drift-review",
    async (context) => {
      const review =
        await services.store.reviewExecutionPlanBlueprintRecommendationPolicyOverrideDrift();
      setExecutionPlanBlueprintRecommendationPolicyOverrideDriftReviewHeaders(
        context,
        review,
      );
      return context.json(review);
    },
  );

  app.get(
    "/api/plan-blueprints/portfolio/recommendation-policy-overrides/retirements",
    async (context) => {
      const history =
        await services.store.listExecutionPlanBlueprintRecommendationPolicyOverrideRetirements();
      setExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryHeaders(
        context,
        history,
      );
      return context.json(history);
    },
  );

  app.post(
    "/api/plan-blueprints/portfolio/recommendation-policy-overrides/retirements/verify",
    async (context) => {
      let input: unknown;
      try {
        input = await readLimitedJson(
          context.req.raw,
          MAX_EXECUTION_PLAN_BLUEPRINT_BYTES,
          "Execution plan blueprint recommendation policy override retirement history verification request",
        );
      } catch (error) {
        if (error instanceof RequestBodyTooLargeError) {
          return jsonError(context, error.message, 413);
        }
        return jsonError(
          context,
          "Execution plan blueprint recommendation policy override retirement history verification request is invalid",
          400,
        );
      }
      const request =
        parseVerifyExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryRequest(
          input,
        );
      if (!request) {
        return jsonError(
          context,
          "Execution plan blueprint recommendation policy override retirement history verification request is invalid",
          400,
        );
      }
      const verification =
        await services.store.verifyExecutionPlanBlueprintRecommendationPolicyOverrideRetirements(
          request.history,
        );
      setExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryVerificationHeaders(
        context,
        verification,
      );
      return context.json(verification);
    },
  );

  app.post(
    "/api/plan-blueprints/portfolio/recommendation-policy-overrides/retirements/proof-bundle/verify",
    async (context) => {
      let input: unknown;
      try {
        input = await readLimitedJson(
          context.req.raw,
          MAX_THREAD_REPLAY_BUNDLE_BYTES,
          "Execution plan blueprint recommendation policy override retirement history proof bundle verification request",
        );
      } catch (error) {
        if (error instanceof RequestBodyTooLargeError) {
          return jsonError(context, error.message, 413);
        }
        return jsonError(
          context,
          "Execution plan blueprint recommendation policy override retirement history proof bundle verification request is invalid",
          400,
        );
      }
      const request =
        parseVerifyExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryProofBundleRequest(
          input,
        );
      if (!request) {
        return jsonError(
          context,
          "Execution plan blueprint recommendation policy override retirement history proof bundle verification request is invalid",
          400,
        );
      }
      const proofBundle =
        services.store.verifyExecutionPlanBlueprintRecommendationPolicyOverrideRetirementProofBundle(
          request.histories,
        );
      setExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryProofBundleHeaders(
        context,
        proofBundle,
      );
      return context.json(proofBundle);
    },
  );

  app.post(
    "/api/plan-blueprints/portfolio/recommendation-policy-overrides/retirements/proof-bundle/sign",
    async (context) => {
      let input: unknown;
      try {
        input = await readLimitedJson(
          context.req.raw,
          MAX_THREAD_REPLAY_BUNDLE_BYTES,
          "Execution plan blueprint recommendation policy override retirement history proof bundle signing request",
        );
      } catch (error) {
        if (error instanceof RequestBodyTooLargeError) {
          return jsonError(context, error.message, 413);
        }
        return jsonError(
          context,
          "Execution plan blueprint recommendation policy override retirement history proof bundle signing request is invalid",
          400,
        );
      }
      const request =
        parseSignExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryProofBundleRequest(
          input,
        );
      if (!request) {
        return jsonError(
          context,
          "Execution plan blueprint recommendation policy override retirement history proof bundle signing request is invalid",
          400,
        );
      }
      try {
        services.store.getThread(request.threadId);
        const proofBundle =
          services.store.verifyExecutionPlanBlueprintRecommendationPolicyOverrideRetirementProofBundle(
            request.histories,
          );
        if (proofBundle.status === "invalid") {
          return jsonError(
            context,
            "Execution plan blueprint recommendation policy override retirement history proof bundle is invalid",
            409,
          );
        }
        const envelope = signTrustedReceipt(
          proofBundle,
          services.store.getReceiptTrustAnchor(request.trustAnchorId),
        );
        await appendReceiptTrustEvent(
          services,
          request.threadId,
          "receipt.signed",
          trustedReceiptEventPayload(envelope),
        );
        setTrustedReceiptHeaders(
          context,
          envelope,
          `napier-signed-policy-retirement-proof-bundle-${envelope.contentSha256.slice(0, 12)}.json`,
        );
        return context.json(envelope, 201);
      } catch (error) {
        const message = errorMessage(error);
        const caught = error instanceof Error ? error : new Error(message);
        return jsonError(
          context,
          message,
          message.includes("proof bundle is invalid") ||
            isReceiptTrustConflict(caught)
            ? 409
            : isReceiptTrustClientError(caught)
              ? 400
              : 500,
        );
      }
    },
  );

  app.post(
    "/api/plan-blueprints/portfolio/recommendation-policy-overrides/retire",
    async (context) => {
      let input: unknown;
      try {
        input = await readLimitedJson(
          context.req.raw,
          MAX_EXECUTION_PLAN_BLUEPRINT_BYTES,
          "Execution plan blueprint recommendation policy override retirement request",
        );
      } catch (error) {
        if (error instanceof RequestBodyTooLargeError) {
          return jsonError(context, error.message, 413);
        }
        return jsonError(
          context,
          "Execution plan blueprint recommendation policy override retirement request is invalid",
          400,
        );
      }
      const request =
        parseRetireExecutionPlanBlueprintRecommendationPolicyOverrideRequest(
          input,
        );
      if (!request) {
        return jsonError(
          context,
          "Execution plan blueprint recommendation policy override retirement request is invalid",
          400,
        );
      }
      try {
        const result =
          await services.store.retireExecutionPlanBlueprintRecommendationPolicyOverride(
            request,
          );
        setExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHeaders(
          context,
          result,
        );
        return context.json(result);
      } catch (error) {
        const message = errorMessage(error);
        return jsonError(
          context,
          message,
          message.includes("changed") ||
            message.includes("missing") ||
            message.includes("not retire recommended")
            ? 409
            : 400,
        );
      }
    },
  );

  app.post(
    "/api/plan-blueprints/portfolio/recommendation-policy-overrides",
    async (context) => {
      let input: unknown;
      try {
        input = await readLimitedJson(
          context.req.raw,
          MAX_EXECUTION_PLAN_BLUEPRINT_BYTES,
          "Execution plan blueprint recommendation policy override request",
        );
      } catch (error) {
        if (error instanceof RequestBodyTooLargeError) {
          return jsonError(context, error.message, 413);
        }
        return jsonError(
          context,
          "Execution plan blueprint recommendation policy override request is invalid",
          400,
        );
      }
      const request =
        parseSetExecutionPlanBlueprintRecommendationPolicyOverrideRequest(
          input,
        );
      if (!request) {
        return jsonError(
          context,
          "Execution plan blueprint recommendation policy override request is invalid",
          400,
        );
      }
      try {
        const override =
          await services.store.setExecutionPlanBlueprintRecommendationPolicyOverride(
            request,
          );
        setExecutionPlanBlueprintRecommendationPolicyOverrideHeaders(
          context,
          override,
        );
        return context.json(override);
      } catch (error) {
        const message = errorMessage(error);
        return jsonError(
          context,
          message,
          message.includes("portfolio set changed") ||
            message.includes("family is missing")
            ? 409
            : 400,
        );
      }
    },
  );

  app.get("/api/plan-blueprints/:recordId/qualification", async (context) => {
    const qualification =
      await services.store.qualifyExecutionPlanBlueprintRecord(
        context.req.param("recordId"),
      );
    setExecutionPlanBlueprintRecordQualificationHeaders(context, qualification);
    return context.json(qualification);
  });

  app.get("/api/plan-blueprints/:recordId/replays", async (context) => {
    const history =
      await services.store.getExecutionPlanBlueprintRecordReplayHistory(
        context.req.param("recordId"),
      );
    setExecutionPlanBlueprintRecordReplayHistoryHeaders(context, history);
    return context.json(history);
  });

  app.post("/api/plan-blueprints/:recordId/replays/verify", async (context) => {
    const recordId = context.req.param("recordId");
    services.store.getExecutionPlanBlueprintRecord(recordId);
    let input: unknown;
    try {
      input = await readLimitedJson(
        context.req.raw,
        MAX_EXECUTION_PLAN_BLUEPRINT_BYTES,
        "Execution plan blueprint replay history verification request",
      );
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return jsonError(context, error.message, 413);
      }
      return jsonError(
        context,
        "Execution plan blueprint replay history verification request is invalid",
        400,
      );
    }
    const request =
      parseVerifyExecutionPlanBlueprintRecordReplayHistoryRequest(input);
    if (!request) {
      return jsonError(
        context,
        "Execution plan blueprint replay history verification request is invalid",
        400,
      );
    }
    const verification =
      await services.store.verifyExecutionPlanBlueprintRecordReplayHistory(
        recordId,
        request.history,
      );
    setExecutionPlanBlueprintRecordReplayHistoryVerificationHeaders(
      context,
      verification,
    );
    return context.json(verification);
  });

  app.get(
    "/api/plan-blueprints/:recordId/replays/outcomes",
    async (context) => {
      const outcomes =
        await services.store.getExecutionPlanBlueprintRecordReplayOutcomes(
          context.req.param("recordId"),
        );
      setExecutionPlanBlueprintRecordReplayOutcomesHeaders(context, outcomes);
      return context.json(outcomes);
    },
  );

  app.post(
    "/api/plan-blueprints/:recordId/replays/outcomes/verify",
    async (context) => {
      const recordId = context.req.param("recordId");
      services.store.getExecutionPlanBlueprintRecord(recordId);
      let input: unknown;
      try {
        input = await readLimitedJson(
          context.req.raw,
          MAX_EXECUTION_PLAN_BLUEPRINT_BYTES,
          "Execution plan blueprint replay outcomes verification request",
        );
      } catch (error) {
        if (error instanceof RequestBodyTooLargeError) {
          return jsonError(context, error.message, 413);
        }
        return jsonError(
          context,
          "Execution plan blueprint replay outcomes verification request is invalid",
          400,
        );
      }
      const request =
        parseVerifyExecutionPlanBlueprintRecordReplayOutcomesRequest(input);
      if (!request) {
        return jsonError(
          context,
          "Execution plan blueprint replay outcomes verification request is invalid",
          400,
        );
      }
      const verification =
        await services.store.verifyExecutionPlanBlueprintRecordReplayOutcomes(
          recordId,
          request.outcomes,
        );
      setExecutionPlanBlueprintRecordReplayOutcomesVerificationHeaders(
        context,
        verification,
      );
      return context.json(verification);
    },
  );

  app.post(
    "/api/plan-blueprints/:recordId/replays/outcomes/review",
    async (context) => {
      const recordId = context.req.param("recordId");
      services.store.getExecutionPlanBlueprintRecord(recordId);
      let input: unknown;
      try {
        input = await readLimitedJson(
          context.req.raw,
          MAX_EVALUATION_REQUEST_BYTES,
          "Execution plan blueprint outcome review request",
        );
      } catch (error) {
        if (error instanceof RequestBodyTooLargeError) {
          return jsonError(context, error.message, 413);
        }
        return jsonError(
          context,
          "Execution plan blueprint outcome review request is invalid",
          400,
        );
      }
      const request =
        parseReviewExecutionPlanBlueprintRecordOutcomesRequest(input);
      if (!request) {
        return jsonError(
          context,
          "Execution plan blueprint outcome review request is invalid",
          400,
        );
      }
      try {
        await assertAvailableModel(services, request.model);
        const review = await reviewExecutionPlanBlueprintRecordOutcomes(
          services.store,
          services.models,
          recordId,
          request,
        );
        setExecutionPlanBlueprintRecordOutcomeReviewHeaders(context, review);
        return context.json(review);
      } catch (error) {
        return jsonError(context, errorMessage(error), 400);
      }
    },
  );

  app.get(
    "/api/plan-blueprints/:recordId/replays/outcomes/baselines",
    (context) => {
      const baselines =
        services.store.listExecutionPlanBlueprintRecordOutcomeBaselines(
          context.req.param("recordId"),
        );
      setExecutionPlanBlueprintRecordOutcomeBaselineListHeaders(
        context,
        baselines,
      );
      return context.json(baselines);
    },
  );

  app.post(
    "/api/plan-blueprints/:recordId/replays/outcomes/baselines",
    async (context) => {
      const recordId = context.req.param("recordId");
      services.store.getExecutionPlanBlueprintRecord(recordId);
      let input: unknown;
      try {
        input = await readLimitedJson(
          context.req.raw,
          MAX_EXECUTION_PLAN_BLUEPRINT_BYTES,
          "Execution plan blueprint outcome baseline request",
        );
      } catch (error) {
        if (error instanceof RequestBodyTooLargeError) {
          return jsonError(context, error.message, 413);
        }
        return jsonError(
          context,
          "Execution plan blueprint outcome baseline request is invalid",
          400,
        );
      }
      const request =
        parsePromoteExecutionPlanBlueprintRecordOutcomeBaselineRequest(input);
      if (!request) {
        return jsonError(
          context,
          "Execution plan blueprint outcome baseline request is invalid",
          400,
        );
      }
      try {
        const result =
          await services.store.promoteExecutionPlanBlueprintRecordOutcomeBaseline(
            recordId,
            request,
          );
        setExecutionPlanBlueprintRecordOutcomeBaselinePromotionHeaders(
          context,
          result,
        );
        return context.json(result, result.created ? 201 : 200);
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.startsWith("Execution plan blueprint outcome baseline")
        ) {
          return jsonError(context, error.message, 409);
        }
        throw error;
      }
    },
  );

  app.get(
    "/api/plan-blueprints/:recordId/replays/outcomes/qualification",
    async (context) => {
      const qualification =
        await services.store.qualifyExecutionPlanBlueprintRecordOutcomes(
          context.req.param("recordId"),
        );
      setExecutionPlanBlueprintRecordOutcomeQualificationHeaders(
        context,
        qualification,
      );
      return context.json(qualification);
    },
  );

  app.post(
    "/api/plan-blueprints/:recordId/replays/events/verify",
    async (context) => {
      const recordId = context.req.param("recordId");
      services.store.getExecutionPlanBlueprintRecord(recordId);
      let input: unknown;
      try {
        input = await readLimitedJson(
          context.req.raw,
          MAX_EXECUTION_PLAN_BLUEPRINT_BYTES,
          "Execution plan blueprint replay event verification request",
        );
      } catch (error) {
        if (error instanceof RequestBodyTooLargeError) {
          return jsonError(context, error.message, 413);
        }
        return jsonError(
          context,
          "Execution plan blueprint replay event verification request is invalid",
          400,
        );
      }
      const request =
        parseVerifyExecutionPlanBlueprintRecordReplayEventRequest(input);
      if (!request) {
        return jsonError(
          context,
          "Execution plan blueprint replay event verification request is invalid",
          400,
        );
      }
      const verification =
        await services.store.verifyExecutionPlanBlueprintRecordReplayEvent(
          recordId,
          request,
        );
      setExecutionPlanBlueprintRecordReplayEventVerificationHeaders(
        context,
        verification,
      );
      return context.json(verification);
    },
  );

  app.post("/api/threads/:threadId/plan-blueprints", async (context) => {
    const threadId = context.req.param("threadId");
    services.store.getThread(threadId);
    let input: unknown;
    try {
      input = await readLimitedJson(
        context.req.raw,
        MAX_EXECUTION_PLAN_BLUEPRINT_BYTES,
        "Execution plan blueprint save request",
      );
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return jsonError(context, error.message, 413);
      }
      return jsonError(
        context,
        "Execution plan blueprint save request is invalid",
        400,
      );
    }
    const request = parseSaveExecutionPlanBlueprintRequest(input);
    if (!request) {
      return jsonError(
        context,
        "Execution plan blueprint save request is invalid",
        400,
      );
    }
    try {
      const result = await services.store.saveExecutionPlanBlueprint(
        threadId,
        request,
      );
      await services.store.appendEvent({
        threadId,
        runId: createId("runctl"),
        type: result.created ? "plan.blueprint.saved" : "plan.blueprint.reused",
        category: "plan",
        visibility: "user",
        payload: {
          blueprintRecordId: result.record.id,
          blueprintSha256: result.record.blueprintSha256,
          sourcePlanId: result.record.sourcePlanId,
          sourcePlanRevision: result.record.sourcePlanRevision,
          sourcePlanArchiveSha256: result.record.sourcePlanArchiveSha256,
          created: result.created,
        },
      });
      setExecutionPlanBlueprintSaveResultHeaders(context, result);
      return context.json(result, result.created ? 201 : 200);
    } catch (error) {
      return jsonError(context, errorMessage(error), 400);
    }
  });

  app.post(
    "/api/threads/:threadId/plan-blueprints/selection",
    async (context) => {
      const threadId = context.req.param("threadId");
      services.store.getThread(threadId);
      let input: unknown;
      try {
        input = await readLimitedJson(
          context.req.raw,
          MAX_EXECUTION_PLAN_BLUEPRINT_BYTES,
          "Execution plan blueprint selection request",
        );
      } catch (error) {
        if (error instanceof RequestBodyTooLargeError) {
          return jsonError(context, error.message, 413);
        }
        return jsonError(
          context,
          "Execution plan blueprint selection request is invalid",
          400,
        );
      }
      const request = parseSelectExecutionPlanBlueprintRecordRequest(input);
      if (!request) {
        return jsonError(
          context,
          "Execution plan blueprint selection request is invalid",
          400,
        );
      }
      try {
        const selection =
          await services.store.selectExecutionPlanBlueprintRecord(
            threadId,
            request,
          );
        setExecutionPlanBlueprintRecordSelectionHeaders(context, selection);
        return context.json(selection);
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.startsWith("Execution plan blueprint selection")
        ) {
          return jsonError(context, error.message, 400);
        }
        throw error;
      }
    },
  );

  app.post("/api/plan-blueprints/:recordId/status", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(
        context.req.raw,
        8 * 1024,
        "Execution plan blueprint status request",
      );
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return jsonError(context, error.message, 413);
      }
      return jsonError(
        context,
        "Execution plan blueprint status request is invalid",
        400,
      );
    }
    const request = parseSetExecutionPlanBlueprintRecordStatusRequest(input);
    if (!request) {
      return jsonError(
        context,
        "Execution plan blueprint status request is invalid",
        400,
      );
    }
    const record = await services.store.setExecutionPlanBlueprintRecordStatus(
      context.req.param("recordId"),
      request,
    );
    setExecutionPlanBlueprintRecordHeaders(context, record);
    return context.json(record);
  });

  app.post("/api/threads/:threadId/plans/from-blueprint", async (context) => {
    const threadId = context.req.param("threadId");
    services.store.getThread(threadId);
    let input: unknown;
    try {
      input = await readLimitedJson(
        context.req.raw,
        MAX_EXECUTION_PLAN_BLUEPRINT_BYTES,
        "Execution plan blueprint request",
      );
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return jsonError(context, error.message, 413);
      }
      return jsonError(
        context,
        "Execution plan blueprint request is invalid",
        400,
      );
    }
    const request = parseCreateExecutionPlanFromBlueprintRequest(input);
    if (!request) {
      return jsonError(
        context,
        "Execution plan blueprint request is invalid",
        400,
      );
    }
    const verification = verifyExecutionPlanBlueprint(request.blueprint);
    if (verification.status !== "valid") {
      setExecutionPlanBlueprintVerificationHeaders(context, verification);
      return context.json(verification, 400);
    }
    const planRequest = executionPlanRequestFromBlueprint(
      request.blueprint,
      request.objective,
    );
    const plan = await services.store.createPlan(threadId, planRequest);
    await services.store.appendEvent({
      threadId,
      runId: createId("runctl"),
      type: "plan.created",
      category: "plan",
      visibility: "user",
      payload: {
        planId: plan.id,
        objective: plan.objective,
        status: plan.status,
        stepCount: plan.steps.length,
        artifactCount: plan.artifacts.length,
        criticalPathStepIds: plan.criticalPathStepIds,
        readyStepIds: plan.readyStepIds,
        blockedStepIds: plan.blockedStepIds,
        blueprintSha256: request.blueprint.contentSha256,
        blueprintSourcePlanId: request.blueprint.source.planId,
        blueprintSourcePlanRevision: request.blueprint.source.planRevision,
        blueprintSourceArchiveSha256:
          request.blueprint.source.planArchiveSha256,
      },
    });
    setExecutionPlanFromBlueprintHeaders(context, plan, request.blueprint);
    return context.json(plan, 201);
  });

  app.post(
    "/api/threads/:threadId/plans/from-blueprint-record/preview",
    async (context) => {
      const threadId = context.req.param("threadId");
      services.store.getThread(threadId);
      let input: unknown;
      try {
        input = await readLimitedJson(
          context.req.raw,
          16 * 1024,
          "Execution plan blueprint record preview request",
        );
      } catch (error) {
        if (error instanceof RequestBodyTooLargeError) {
          return jsonError(context, error.message, 413);
        }
        return jsonError(
          context,
          "Execution plan blueprint record preview request is invalid",
          400,
        );
      }
      const request = parseCreateExecutionPlanFromBlueprintRecordRequest(input);
      if (!request) {
        return jsonError(
          context,
          "Execution plan blueprint record preview request is invalid",
          400,
        );
      }
      const preview = await services.store.previewPlanFromBlueprintRecord(
        threadId,
        request,
      );
      setExecutionPlanBlueprintRecordPreviewHeaders(context, preview);
      return context.json(preview);
    },
  );

  app.post(
    "/api/threads/:threadId/plans/from-blueprint-record",
    async (context) => {
      const threadId = context.req.param("threadId");
      services.store.getThread(threadId);
      let input: unknown;
      try {
        input = await readLimitedJson(
          context.req.raw,
          16 * 1024,
          "Execution plan blueprint record request",
        );
      } catch (error) {
        if (error instanceof RequestBodyTooLargeError) {
          return jsonError(context, error.message, 413);
        }
        return jsonError(
          context,
          "Execution plan blueprint record request is invalid",
          400,
        );
      }
      const request = parseCreateExecutionPlanFromBlueprintRecordRequest(input);
      if (!request) {
        return jsonError(
          context,
          "Execution plan blueprint record request is invalid",
          400,
        );
      }
      const preview = await services.store.previewPlanFromBlueprintRecord(
        threadId,
        request,
      );
      if (
        preview.status !== "ready" ||
        (request.expectedPreviewSha256 !== undefined &&
          request.expectedPreviewSha256 !== preview.previewSha256)
      ) {
        setExecutionPlanBlueprintRecordPreviewHeaders(context, preview);
        return context.json(preview, 409);
      }
      const {
        plan,
        record,
        qualification: creationQualification,
        event,
        previewSha256,
      } = await services.store.createPlanFromBlueprintRecord(threadId, request);
      setExecutionPlanFromBlueprintRecordHeaders(
        context,
        plan,
        record,
        creationQualification,
        previewSha256,
        event,
      );
      return context.json(plan, 201);
    },
  );

  app.post(
    "/api/threads/:threadId/plans/:planId/steps/:stepId",
    async (context) => {
      const threadId = context.req.param("threadId");
      const planId = context.req.param("planId");
      assertPlanThread(services, planId, threadId);
      let input: unknown;
      try {
        input = await readLimitedJson(
          context.req.raw,
          8 * 1024,
          "Plan step transition request",
        );
      } catch (error) {
        if (error instanceof RequestBodyTooLargeError) {
          return jsonError(context, error.message, 413);
        }
        return jsonError(
          context,
          "Plan step transition request is invalid",
          400,
        );
      }
      const body = parseTransitionPlanStepRequest(input);
      if (!body) {
        return jsonError(
          context,
          "Plan step transition request is invalid",
          400,
        );
      }
      const before = services.store.getPlan(planId);
      const plan = await services.store.transitionPlanStep(
        planId,
        context.req.param("stepId"),
        body,
      );
      const step = plan.steps.find(
        (candidate) => candidate.id === context.req.param("stepId"),
      );
      if (plan.revision !== before.revision && step) {
        await services.store.appendEvent({
          threadId,
          runId: body.runId ?? createId("runctl"),
          type: `plan.step.${planStepEventSuffix(body.action)}`,
          category: "plan",
          visibility: "user",
          payload: {
            planId,
            stepId: step.id,
            title: step.title,
            status: step.status,
            planStatus: plan.status,
            criticalPathStepIds: plan.criticalPathStepIds,
            readyStepIds: plan.readyStepIds,
            blockedStepIds: plan.blockedStepIds,
            evidence: step.evidence,
            ...(step.blocker ? { blocker: step.blocker } : {}),
            ...(step.runId ? { runId: step.runId } : {}),
          },
        });
      }
      setExecutionPlanHeaders(context, plan);
      return context.json(plan);
    },
  );

  app.post(
    "/api/threads/:threadId/plans/:planId/artifacts/:artifactId",
    async (context) => {
      const threadId = context.req.param("threadId");
      const planId = context.req.param("planId");
      assertPlanThread(services, planId, threadId);
      let input: unknown;
      try {
        input = await readLimitedJson(
          context.req.raw,
          16 * 1024,
          "Plan artifact request",
        );
      } catch (error) {
        if (error instanceof RequestBodyTooLargeError) {
          return jsonError(context, error.message, 413);
        }
        return jsonError(context, "Plan artifact request is invalid", 400);
      }
      const body = parseUpdateArtifactManifestRequest(input);
      if (!body) {
        return jsonError(context, "Plan artifact request is invalid", 400);
      }
      const before = services.store.getPlan(planId);
      let artifactRequest: UpdateArtifactManifestRequest = body;
      if (body.observeWorkspace) {
        const artifact = before.artifacts.find(
          (candidate) => candidate.id === context.req.param("artifactId"),
        );
        if (!artifact) {
          return jsonError(context, "Plan artifact request is invalid", 400);
        }
        try {
          artifactRequest =
            body.status === "missing"
              ? await createWorkspaceArtifactDriftRequest(
                  services.store.workspaceRoot,
                  artifact,
                  body,
                )
              : await createWorkspaceArtifactVerificationRequest(
                  services.store.workspaceRoot,
                  artifact,
                  body,
                );
        } catch (error) {
          return jsonError(context, errorMessage(error), 400);
        }
      }
      const plan = await services.store.updatePlanArtifact(
        planId,
        context.req.param("artifactId"),
        artifactRequest,
      );
      const artifact = plan.artifacts.find(
        (candidate) => candidate.id === context.req.param("artifactId"),
      );
      if (plan.revision !== before.revision && artifact) {
        await services.store.appendEvent({
          threadId,
          runId: artifactRequest.sourceRunId ?? createId("runctl"),
          type: `plan.artifact.${artifact.status}`,
          category: "plan",
          visibility: "user",
          payload: createPlanArtifactEventPayload(plan, artifact),
        });
      }
      setExecutionPlanHeaders(context, plan);
      return context.json(plan);
    },
  );

  app.post(
    "/api/threads/:threadId/plans/:planId/artifacts/:artifactId/drift-check",
    async (context) => {
      const threadId = context.req.param("threadId");
      const planId = context.req.param("planId");
      assertPlanThread(services, planId, threadId);
      const plan = services.store.getPlan(planId);
      const artifact = plan.artifacts.find(
        (candidate) => candidate.id === context.req.param("artifactId"),
      );
      if (!artifact) {
        return jsonError(context, "Plan artifact drift check is invalid", 404);
      }
      try {
        const inspection = await inspectWorkspaceArtifactDrift(
          services.store.workspaceRoot,
          artifact,
        );
        const payload = {
          kind: "napier.plan-artifact-drift-check" as const,
          schemaVersion: 1 as const,
          planId: plan.id,
          artifactId: artifact.id,
          planRevision: plan.revision,
          status: artifact.status,
          artifactKind: artifact.kind,
          pathSha256: sha256Text(artifact.path),
          expectedSha256: inspection.expectedSha256,
          result: inspection.result,
          ...(inspection.observedSha256
            ? { observedSha256: inspection.observedSha256 }
            : {}),
          ...(inspection.sizeBytes !== undefined
            ? { sizeBytes: inspection.sizeBytes }
            : {}),
        };
        const ledgerEvent = await services.store.appendEvent({
          threadId,
          runId: createId("runctl"),
          type: "artifact.drift_checked",
          category: "artifact",
          visibility: "user",
          payload: {
            planId: plan.id,
            artifactId: artifact.id,
            planRevision: plan.revision,
            status: artifact.status,
            kind: artifact.kind,
            pathSha256: payload.pathSha256,
            expectedSha256: inspection.expectedSha256,
            result: inspection.result,
            ...(inspection.observedSha256
              ? { observedSha256: inspection.observedSha256 }
              : {}),
            ...(inspection.sizeBytes !== undefined
              ? { sizeBytes: inspection.sizeBytes }
              : {}),
          },
        });
        const response = {
          ...payload,
          ...createLedgerEventReceiptProjection(ledgerEvent),
        };
        setPlanArtifactDriftCheckHeaders(context, plan, artifact, response);
        return context.json(response);
      } catch (error) {
        return jsonError(context, errorMessage(error), 400);
      }
    },
  );

  app.get(
    "/api/threads/:threadId/plans/:planId/artifacts/:artifactId/file",
    async (context) => {
      const threadId = context.req.param("threadId");
      const planId = context.req.param("planId");
      assertPlanThread(services, planId, threadId);
      const plan = services.store.getPlan(planId);
      const artifact = plan.artifacts.find(
        (candidate) => candidate.id === context.req.param("artifactId"),
      );
      if (!artifact) {
        return jsonError(context, "Plan artifact file is invalid", 404);
      }
      try {
        const exported = await exportWorkspaceFileArtifact(
          services.store.workspaceRoot,
          artifact,
        );
        const ledgerEvent = await services.store.appendEvent({
          threadId,
          runId: createId("runctl"),
          type: "artifact.exported",
          category: "artifact",
          visibility: "user",
          payload: {
            planId: plan.id,
            artifactId: artifact.id,
            planRevision: plan.revision,
            status: artifact.status,
            kind: artifact.kind,
            pathSha256: sha256Text(artifact.path),
            sha256: exported.sha256,
            sizeBytes: exported.sizeBytes,
          },
        });
        setPlanArtifactFileExportHeaders(context, plan, artifact, {
          ...exported,
          ...createLedgerEventReceiptProjection(ledgerEvent),
        });
        context.header("Content-Type", "application/octet-stream");
        const body = exported.contents.buffer.slice(
          exported.contents.byteOffset,
          exported.contents.byteOffset + exported.contents.byteLength,
        ) as ArrayBuffer;
        return context.body(body);
      } catch (error) {
        return jsonError(context, errorMessage(error), 400);
      }
    },
  );

  app.post(
    "/api/threads/:threadId/plans/:planId/artifacts/:artifactId/file/verify",
    async (context) => {
      const threadId = context.req.param("threadId");
      const planId = context.req.param("planId");
      assertPlanThread(services, planId, threadId);
      const plan = services.store.getPlan(planId);
      const artifact = plan.artifacts.find(
        (candidate) => candidate.id === context.req.param("artifactId"),
      );
      if (!artifact) {
        return jsonError(
          context,
          "Plan artifact file verification request is invalid",
          404,
        );
      }
      if (
        context.req.header("content-type")?.split(";", 1)[0]?.trim() !==
        "application/octet-stream"
      ) {
        return jsonError(
          context,
          "Plan artifact file verification request must use application/octet-stream",
          400,
        );
      }
      let contents: Buffer;
      try {
        contents = await readLimitedBytes(
          context.req.raw,
          MAX_PLAN_ARTIFACT_FILE_VERIFY_REQUEST_BYTES,
          "Plan artifact file verification request",
        );
      } catch (error) {
        return jsonError(
          context,
          error instanceof RequestBodyTooLargeError
            ? error.message
            : "Plan artifact file verification request is invalid",
          error instanceof RequestBodyTooLargeError ? 413 : 400,
        );
      }
      try {
        const verification = verifyPlanArtifactFileProjection(plan, artifact, {
          sha256: sha256Bytes(contents),
          sizeBytes: contents.byteLength,
        });
        const ledgerEvent = await services.store.appendEvent({
          threadId,
          runId: createId("runctl"),
          type: "artifact.file_verified",
          category: "artifact",
          visibility: "user",
          payload: createPlanArtifactFileVerificationEventPayload(verification),
        });
        const response = {
          ...verification,
          ...createLedgerEventReceiptProjection(ledgerEvent),
        };
        setPlanArtifactFileVerificationHeaders(context, response);
        return context.json(response);
      } catch (error) {
        return jsonError(context, errorMessage(error), 400);
      }
    },
  );

  app.get(
    "/api/threads/:threadId/plans/:planId/artifacts/:artifactId/manifest",
    async (context) => {
      const threadId = context.req.param("threadId");
      const planId = context.req.param("planId");
      assertPlanThread(services, planId, threadId);
      const plan = services.store.getPlan(planId);
      const artifact = plan.artifacts.find(
        (candidate) => candidate.id === context.req.param("artifactId"),
      );
      if (!artifact) {
        return jsonError(context, "Plan artifact manifest is invalid", 404);
      }
      try {
        const manifest = await previewWorkspaceDirectoryArtifactManifest(
          services.store.workspaceRoot,
          artifact,
        );
        const payload = {
          kind: "napier.plan-artifact-directory-manifest" as const,
          schemaVersion: 1 as const,
          planId: plan.id,
          artifactId: artifact.id,
          planRevision: plan.revision,
          status: artifact.status,
          artifactKind: artifact.kind,
          pathSha256: sha256Text(artifact.path),
          sha256: manifest.sha256,
          sizeBytes: manifest.sizeBytes,
          entryCount: manifest.entryCount,
          fileCount: manifest.fileCount,
          directoryCount: manifest.directoryCount,
          entries: manifest.entries,
        };
        const ledgerEvent = await services.store.appendEvent({
          threadId,
          runId: createId("runctl"),
          type: "artifact.directory_manifested",
          category: "artifact",
          visibility: "user",
          payload: {
            planId: plan.id,
            artifactId: artifact.id,
            planRevision: plan.revision,
            status: artifact.status,
            kind: artifact.kind,
            pathSha256: payload.pathSha256,
            sha256: manifest.sha256,
            sizeBytes: manifest.sizeBytes,
            entryCount: manifest.entryCount,
            fileCount: manifest.fileCount,
            directoryCount: manifest.directoryCount,
          },
        });
        const response = {
          ...payload,
          ...createLedgerEventReceiptProjection(ledgerEvent),
        };
        setPlanArtifactDirectoryManifestHeaders(
          context,
          plan,
          artifact,
          response,
        );
        return context.json(response);
      } catch (error) {
        return jsonError(context, errorMessage(error), 400);
      }
    },
  );

  app.post(
    "/api/threads/:threadId/plans/:planId/artifacts/:artifactId/manifest/verify",
    async (context) => {
      const threadId = context.req.param("threadId");
      const planId = context.req.param("planId");
      assertPlanThread(services, planId, threadId);
      const plan = services.store.getPlan(planId);
      const artifact = plan.artifacts.find(
        (candidate) => candidate.id === context.req.param("artifactId"),
      );
      if (!artifact) {
        return jsonError(
          context,
          "Plan artifact directory manifest verification request is invalid",
          404,
        );
      }
      let input: unknown;
      try {
        input = await readLimitedJson(
          context.req.raw,
          MAX_PLAN_ARTIFACT_DIRECTORY_MANIFEST_VERIFY_REQUEST_BYTES,
          "Plan artifact directory manifest verification request",
        );
      } catch (error) {
        return jsonError(
          context,
          error instanceof RequestBodyTooLargeError
            ? error.message
            : "Plan artifact directory manifest verification request is invalid",
          error instanceof RequestBodyTooLargeError ? 413 : 400,
        );
      }
      const manifest = planArtifactDirectoryManifestVerificationRequest(input);
      if (!manifest) {
        return jsonError(
          context,
          "Plan artifact directory manifest verification request is invalid",
          400,
        );
      }
      try {
        const observed = await previewWorkspaceDirectoryArtifactManifest(
          services.store.workspaceRoot,
          artifact,
        );
        const verification = verifyPlanArtifactDirectoryManifestProjection(
          plan,
          artifact,
          manifest,
          observed,
        );
        const ledgerEvent = await services.store.appendEvent({
          threadId,
          runId: createId("runctl"),
          type: "artifact.directory_manifest_verified",
          category: "artifact",
          visibility: "user",
          payload:
            createPlanArtifactDirectoryManifestVerificationEventPayload(
              verification,
            ),
        });
        const response = {
          ...verification,
          ...createLedgerEventReceiptProjection(ledgerEvent),
        };
        setPlanArtifactDirectoryManifestVerificationHeaders(context, response);
        return context.json(response);
      } catch (error) {
        return jsonError(context, errorMessage(error), 400);
      }
    },
  );

  app.get(
    "/api/threads/:threadId/plans/:planId/artifacts/:artifactId/preview",
    async (context) => {
      const threadId = context.req.param("threadId");
      const planId = context.req.param("planId");
      assertPlanThread(services, planId, threadId);
      const plan = services.store.getPlan(planId);
      const artifact = plan.artifacts.find(
        (candidate) => candidate.id === context.req.param("artifactId"),
      );
      if (!artifact) {
        return jsonError(context, "Plan artifact preview is invalid", 404);
      }
      try {
        const preview = await previewWorkspaceTextArtifact(
          services.store.workspaceRoot,
          artifact,
        );
        const payload = {
          kind: "napier.plan-artifact-text-preview" as const,
          schemaVersion: 1 as const,
          planId: plan.id,
          artifactId: artifact.id,
          planRevision: plan.revision,
          status: artifact.status,
          artifactKind: artifact.kind,
          pathSha256: sha256Text(artifact.path),
          sha256: preview.sha256,
          sizeBytes: preview.sizeBytes,
          lineCount: preview.lineCount,
          textSha256: sha256Text(preview.text),
          text: preview.text,
        };
        const ledgerEvent = await services.store.appendEvent({
          threadId,
          runId: createId("runctl"),
          type: "artifact.previewed",
          category: "artifact",
          visibility: "user",
          payload: {
            planId: plan.id,
            artifactId: artifact.id,
            planRevision: plan.revision,
            status: artifact.status,
            kind: artifact.kind,
            pathSha256: payload.pathSha256,
            sha256: preview.sha256,
            sizeBytes: preview.sizeBytes,
            lineCount: preview.lineCount,
            textSha256: payload.textSha256,
          },
        });
        const response = {
          ...payload,
          ...createLedgerEventReceiptProjection(ledgerEvent),
        };
        setPlanArtifactTextPreviewHeaders(context, plan, artifact, response);
        return context.json(response);
      } catch (error) {
        return jsonError(context, errorMessage(error), 400);
      }
    },
  );

  app.get(
    "/api/threads/:threadId/plans/:planId/artifacts/:artifactId/data",
    async (context) => {
      const threadId = context.req.param("threadId");
      const planId = context.req.param("planId");
      assertPlanThread(services, planId, threadId);
      const plan = services.store.getPlan(planId);
      const artifact = plan.artifacts.find(
        (candidate) => candidate.id === context.req.param("artifactId"),
      );
      if (!artifact) {
        return jsonError(context, "Plan artifact data profile is invalid", 404);
      }
      try {
        const profile = await previewWorkspaceDataArtifactProfile(
          services.store.workspaceRoot,
          artifact,
        );
        const payload = {
          kind: "napier.plan-artifact-data-profile" as const,
          schemaVersion: 1 as const,
          planId: plan.id,
          artifactId: artifact.id,
          planRevision: plan.revision,
          status: artifact.status,
          artifactKind: artifact.kind,
          pathSha256: sha256Text(artifact.path),
          sha256: profile.sha256,
          sizeBytes: profile.sizeBytes,
          format: profile.format,
          rowCount: profile.rowCount,
          columnCount: profile.columnCount,
          truncated: profile.truncated,
          columnSetSha256: profile.columnSetSha256,
          sampleSha256: profile.sampleSha256,
          columns: profile.columns,
          sampleRows: profile.sampleRows,
        };
        const ledgerEvent = await services.store.appendEvent({
          threadId,
          runId: createId("runctl"),
          type: "artifact.data_profiled",
          category: "artifact",
          visibility: "user",
          payload: {
            planId: plan.id,
            artifactId: artifact.id,
            planRevision: plan.revision,
            status: artifact.status,
            kind: artifact.kind,
            pathSha256: payload.pathSha256,
            sha256: profile.sha256,
            sizeBytes: profile.sizeBytes,
            format: profile.format,
            rowCount: profile.rowCount,
            columnCount: profile.columnCount,
            truncated: profile.truncated,
            columnSetSha256: profile.columnSetSha256,
            sampleSha256: profile.sampleSha256,
          },
        });
        const response = {
          ...payload,
          ...createLedgerEventReceiptProjection(ledgerEvent),
        };
        setPlanArtifactDataProfileHeaders(context, plan, artifact, response);
        return context.json(response);
      } catch (error) {
        return jsonError(context, errorMessage(error), 400);
      }
    },
  );

  app.post(
    "/api/threads/:threadId/plans/:planId/artifacts/:artifactId/data/verify",
    async (context) => {
      const threadId = context.req.param("threadId");
      const planId = context.req.param("planId");
      assertPlanThread(services, planId, threadId);
      const plan = services.store.getPlan(planId);
      const artifact = plan.artifacts.find(
        (candidate) => candidate.id === context.req.param("artifactId"),
      );
      if (!artifact) {
        return jsonError(
          context,
          "Plan artifact data profile verification request is invalid",
          404,
        );
      }
      let input: unknown;
      try {
        input = await readLimitedJson(
          context.req.raw,
          MAX_PLAN_ARTIFACT_DATA_PROFILE_VERIFY_REQUEST_BYTES,
          "Plan artifact data profile verification request",
        );
      } catch (error) {
        return jsonError(
          context,
          error instanceof RequestBodyTooLargeError
            ? error.message
            : "Plan artifact data profile verification request is invalid",
          error instanceof RequestBodyTooLargeError ? 413 : 400,
        );
      }
      const profile = planArtifactDataProfileVerificationRequest(input);
      if (!profile) {
        return jsonError(
          context,
          "Plan artifact data profile verification request is invalid",
          400,
        );
      }
      try {
        const observed = await previewWorkspaceDataArtifactProfile(
          services.store.workspaceRoot,
          artifact,
        );
        const verification = verifyPlanArtifactDataProfileProjection(
          plan,
          artifact,
          profile,
          observed,
        );
        const ledgerEvent = await services.store.appendEvent({
          threadId,
          runId: createId("runctl"),
          type: "artifact.data_profile_verified",
          category: "artifact",
          visibility: "user",
          payload:
            createPlanArtifactDataProfileVerificationEventPayload(verification),
        });
        const response = {
          ...verification,
          ...createLedgerEventReceiptProjection(ledgerEvent),
        };
        setPlanArtifactDataProfileVerificationHeaders(context, response);
        return context.json(response);
      } catch (error) {
        return jsonError(context, errorMessage(error), 400);
      }
    },
  );

  app.post("/api/threads/:threadId/evaluations", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(
        context.req.raw,
        MAX_EVALUATION_REQUEST_BYTES,
        "Run evaluation request",
      );
    } catch (error) {
      return jsonError(
        context,
        errorMessage(error),
        error instanceof RequestBodyTooLargeError ? 413 : 400,
      );
    }
    const body = parseCreateRunEvaluationRequest(input);
    if (!body) {
      return jsonError(context, "Run evaluation request is invalid", 400);
    }
    const thread = services.store.getThread(context.req.param("threadId"));
    const agent = services.store.getAgent(thread.agentId);
    try {
      await assertAvailableModel(services, body.model ?? agent.model);
    } catch (error) {
      return jsonError(context, errorMessage(error), 400);
    }
    const evaluation = await services.evaluations.evaluate(
      context.req.param("threadId"),
      body,
    );
    setRunEvaluationRecordHeaders(context, evaluation);
    return context.json(evaluation, 201);
  });

  app.post(
    "/api/threads/:threadId/evaluations/:evaluationId/adjudication",
    async (context) => {
      const threadId = context.req.param("threadId");
      const evaluationId = context.req.param("evaluationId");
      let input: unknown;
      try {
        input = await readLimitedJson(
          context.req.raw,
          MAX_EVALUATION_REQUEST_BYTES,
          "Evaluation adjudication request",
        );
      } catch (error) {
        return jsonError(
          context,
          errorMessage(error),
          error instanceof RequestBodyTooLargeError ? 413 : 400,
        );
      }
      const body = parseReviewRunEvaluationRequest(input);
      if (!body) {
        return jsonError(
          context,
          "Evaluation adjudication request is invalid",
          400,
        );
      }
      const evaluation = services.store
        .listRunEvaluations(threadId)
        .find((candidate) => candidate.id === evaluationId);
      if (!evaluation) {
        return jsonError(
          context,
          `Run evaluation not found: ${evaluationId}`,
          404,
        );
      }
      const current = services.store
        .listEvaluationAdjudications(threadId)
        .find((candidate) => candidate.evaluationId === evaluationId);
      const adjudication = await services.store.reviewRunEvaluation(
        threadId,
        evaluationId,
        body,
      );
      if (adjudication.currentRevision !== current?.currentRevision) {
        const revision = adjudication.revisions.at(-1)!;
        await services.store.appendEvent({
          threadId,
          runId: createId("runctl"),
          type: "evaluation.adjudication.reviewed",
          category: "evaluation",
          visibility: "user",
          payload: {
            evaluationId,
            adjudicationId: adjudication.id,
            revision: revision.revision,
            modelVerdict: evaluation.verdict,
            expectedVerdict: revision.expectedVerdict,
            agreement: evaluation.verdict === revision.expectedVerdict,
            evaluationSha256: revision.evaluationSha256,
            adjudicationSha256: revision.contentSha256,
          },
        });
      }
      setEvaluationAdjudicationHeaders(context, adjudication);
      return context.json(adjudication, current ? 200 : 201);
    },
  );

  app.get(
    "/api/threads/:threadId/evaluations/:evaluationId/reviewer-ballots",
    (context) => {
      const threadId = context.req.param("threadId");
      const evaluationId = context.req.param("evaluationId");
      const ballots = services.store.listEvaluationReviewerBallots(
        threadId,
        evaluationId,
      );
      setEvaluationReviewerBallotListHeaders(
        context,
        threadId,
        evaluationId,
        ballots,
      );
      return context.json(ballots);
    },
  );

  app.post(
    "/api/threads/:threadId/evaluations/:evaluationId/reviewer-ballots",
    async (context) => {
      const threadId = context.req.param("threadId");
      const evaluationId = context.req.param("evaluationId");
      let input: unknown;
      try {
        input = await readLimitedJson(
          context.req.raw,
          MAX_EVALUATION_REQUEST_BYTES,
          "Evaluation reviewer ballot request",
        );
      } catch (error) {
        return jsonError(
          context,
          errorMessage(error),
          error instanceof RequestBodyTooLargeError ? 413 : 400,
        );
      }
      const body = parseSubmitEvaluationReviewerBallotRequest(input);
      if (!body) {
        return jsonError(context, "Evaluation reviewer ballot is invalid", 400);
      }
      const current = services.store
        .listEvaluationReviewerBallots(threadId, evaluationId)
        .find(
          (ballot) =>
            ballot.reviewerId === body.reviewerId.trim().toLowerCase(),
        );
      const ballot = await services.store.submitEvaluationReviewerBallot(
        threadId,
        evaluationId,
        body,
      );
      const changed = ballot.currentRevision !== current?.currentRevision;
      if (changed) {
        const revision = ballot.revisions.at(-1)!;
        await services.store.appendEvent({
          threadId,
          runId: createId("runctl"),
          type: "evaluation.reviewer_ballot.recorded",
          category: "evaluation",
          visibility: "user",
          payload: {
            evaluationId,
            ballotId: ballot.id,
            reviewerId: ballot.reviewerId,
            revision: revision.revision,
            expectedVerdict: revision.expectedVerdict,
            evaluationSha256: revision.evaluationSha256,
            ballotSha256: revision.contentSha256,
          },
        });
      }
      setEvaluationReviewerBallotHeaders(context, ballot);
      return context.json(ballot, current ? 200 : 201);
    },
  );

  app.post(
    "/api/threads/:threadId/evaluations/:evaluationId/consensus/preview",
    async (context) => {
      let input: unknown;
      try {
        input = await readLimitedJson(
          context.req.raw,
          MAX_EVALUATION_REQUEST_BYTES,
          "Evaluation consensus preview request",
        );
      } catch (error) {
        return jsonError(
          context,
          errorMessage(error),
          error instanceof RequestBodyTooLargeError ? 413 : 400,
        );
      }
      const body = parseResolveEvaluationConsensusRequest(input);
      if (!body) {
        return jsonError(context, "Evaluation consensus gate is invalid", 400);
      }
      const report = services.store.getEvaluationConsensusReport(
        context.req.param("threadId"),
        context.req.param("evaluationId"),
        body.gate,
      );
      setEvaluationConsensusReportHeaders(context, report);
      return context.json(report);
    },
  );

  app.post(
    "/api/threads/:threadId/evaluations/:evaluationId/consensus/resolve",
    async (context) => {
      const threadId = context.req.param("threadId");
      const evaluationId = context.req.param("evaluationId");
      let input: unknown;
      try {
        input = await readLimitedJson(
          context.req.raw,
          MAX_EVALUATION_REQUEST_BYTES,
          "Evaluation consensus resolution request",
        );
      } catch (error) {
        return jsonError(
          context,
          errorMessage(error),
          error instanceof RequestBodyTooLargeError ? 413 : 400,
        );
      }
      const body = parseResolveEvaluationConsensusRequest(input);
      if (!body) {
        return jsonError(context, "Evaluation consensus gate is invalid", 400);
      }
      let result;
      try {
        result = await services.store.resolveEvaluationConsensus(
          threadId,
          evaluationId,
          body,
        );
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.includes("not ready for resolution")
        ) {
          return jsonError(context, error.message, 409);
        }
        throw error;
      }
      if (result.created) {
        await services.store.appendEvent({
          threadId,
          runId: createId("runctl"),
          type: "evaluation.consensus.resolved",
          category: "evaluation",
          visibility: "user",
          payload: {
            evaluationId,
            resolutionId: result.resolution.id,
            reviewerCount: result.report.reviewerCount,
            consensusVerdict: result.report.consensusVerdict ?? "",
            agreementRate: result.report.agreementRate,
            reportSha256: result.report.contentSha256,
            adjudicationId: result.adjudication.id,
            adjudicationRevision:
              result.resolution.adjudicationRevision.revision,
            adjudicationSha256:
              result.resolution.adjudicationRevision.contentSha256,
            resolutionSha256: result.resolution.contentSha256,
          },
        });
      }
      setEvaluationConsensusResolutionResultHeaders(context, result);
      return context.json(result, result.created ? 201 : 200);
    },
  );

  app.get(
    "/api/threads/:threadId/evaluations/:evaluationId/consensus-resolutions",
    (context) => {
      const threadId = context.req.param("threadId");
      const evaluationId = context.req.param("evaluationId");
      const resolutions = services.store.listEvaluationConsensusResolutions(
        threadId,
        evaluationId,
      );
      setEvaluationConsensusResolutionListHeaders(
        context,
        threadId,
        evaluationId,
        resolutions,
      );
      return context.json(resolutions);
    },
  );

  app.post("/api/evaluation-casebooks", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(
        context.req.raw,
        MAX_EVALUATION_REQUEST_BYTES,
        "Evaluation casebook request",
      );
    } catch (error) {
      return jsonError(
        context,
        errorMessage(error),
        error instanceof RequestBodyTooLargeError ? 413 : 400,
      );
    }
    const body = parseCreateEvaluationCasebookRequest(input);
    if (!body) {
      return jsonError(context, "Casebook request is invalid", 400);
    }
    const casebook = await services.store.createEvaluationCasebook(body);
    await services.store.appendEvent({
      threadId: body.threadId,
      runId: createId("runctl"),
      type: "evaluation.casebook.created",
      category: "evaluation",
      visibility: "user",
      payload: evaluationCasebookEventPayload(casebook),
    });
    setEvaluationCasebookProjectionHeaders(context, casebook);
    return context.json(casebook, 201);
  });

  app.put("/api/evaluation-casebooks/:casebookId", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(
        context.req.raw,
        MAX_EVALUATION_REQUEST_BYTES,
        "Evaluation casebook update request",
      );
    } catch (error) {
      return jsonError(
        context,
        errorMessage(error),
        error instanceof RequestBodyTooLargeError ? 413 : 400,
      );
    }
    const body = parseUpdateEvaluationCasebookRequest(input);
    if (!body) {
      return jsonError(context, "Casebook update is invalid", 400);
    }
    const before = services.store.getEvaluationCasebook(
      context.req.param("casebookId"),
    );
    const casebook = await services.store.updateEvaluationCasebook(
      before.id,
      body,
    );
    if (casebook.currentRevision !== before.currentRevision) {
      await services.store.appendEvent({
        threadId: body.threadId,
        runId: createId("runctl"),
        type: "evaluation.casebook.updated",
        category: "evaluation",
        visibility: "user",
        payload: evaluationCasebookEventPayload(casebook),
      });
    }
    setEvaluationCasebookProjectionHeaders(context, casebook);
    return context.json(casebook);
  });

  app.post("/api/evaluation-casebooks/:casebookId/cases", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(
        context.req.raw,
        MAX_EVALUATION_REQUEST_BYTES,
        "Evaluation casebook curation request",
      );
    } catch (error) {
      return jsonError(
        context,
        errorMessage(error),
        error instanceof RequestBodyTooLargeError ? 413 : 400,
      );
    }
    const body = parseCurateEvaluationCaseRequest(input);
    if (!body) {
      return jsonError(context, "Casebook curation is invalid", 400);
    }
    const before = services.store.getEvaluationCasebook(
      context.req.param("casebookId"),
    );
    const casebook = await services.store.curateEvaluationCasebookCase(
      before.id,
      body,
    );
    const changed = casebook.currentRevision !== before.currentRevision;
    if (changed) {
      const revision = casebook.revisions.at(-1)!;
      await services.store.appendEvent({
        threadId: body.threadId,
        runId: createId("runctl"),
        type:
          revision.source === "case_refreshed"
            ? "evaluation.casebook.case.refreshed"
            : "evaluation.casebook.case.curated",
        category: "evaluation",
        visibility: "user",
        payload: evaluationCasebookEventPayload(casebook),
      });
    }
    setEvaluationCasebookProjectionHeaders(context, casebook);
    return context.json(
      casebook,
      changed && casebook.revisions.at(-1)!.source === "case_curated"
        ? 201
        : 200,
    );
  });

  app.post(
    "/api/evaluation-casebooks/:casebookId/cases/:caseId/remove",
    async (context) => {
      let input: unknown;
      try {
        input = await readLimitedJson(
          context.req.raw,
          MAX_EVALUATION_REQUEST_BYTES,
          "Evaluation casebook removal request",
        );
      } catch (error) {
        return jsonError(
          context,
          errorMessage(error),
          error instanceof RequestBodyTooLargeError ? 413 : 400,
        );
      }
      const body = parseRemoveEvaluationCaseRequest(input);
      if (!body) {
        return jsonError(context, "Casebook removal is invalid", 400);
      }
      const casebook = await services.store.removeEvaluationCasebookCase(
        context.req.param("casebookId"),
        context.req.param("caseId"),
        body,
      );
      await services.store.appendEvent({
        threadId: body.threadId,
        runId: createId("runctl"),
        type: "evaluation.casebook.case.removed",
        category: "evaluation",
        visibility: "user",
        payload: evaluationCasebookEventPayload(casebook),
      });
      setEvaluationCasebookProjectionHeaders(context, casebook);
      return context.json(casebook);
    },
  );

  app.post(
    "/api/evaluation-casebooks/:casebookId/qualifications",
    async (context) => {
      let input: unknown;
      try {
        input = await readLimitedJson(
          context.req.raw,
          MAX_EVALUATION_REQUEST_BYTES,
          "Evaluation casebook qualification request",
        );
      } catch (error) {
        return jsonError(
          context,
          errorMessage(error),
          error instanceof RequestBodyTooLargeError ? 413 : 400,
        );
      }
      const body = parseExecuteEvaluationCasebookRequest(input);
      if (!body) {
        return jsonError(
          context,
          "Casebook qualification request is invalid",
          400,
        );
      }
      try {
        await assertAvailableModel(services, body.model);
        const execution =
          await services.evaluationCasebookQualifications.execute(
            context.req.param("casebookId"),
            body,
          );
        setEvaluationCasebookQualificationExecutionHeaders(context, execution);
        return context.json(execution, 201);
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.includes("changed during qualification")
        ) {
          return jsonError(context, error.message, 409);
        }
        throw error;
      }
    },
  );

  app.post("/api/threads/:threadId/evaluation-suites", async (context) => {
    const threadId = context.req.param("threadId");
    let input: unknown;
    try {
      input = await readLimitedJson(
        context.req.raw,
        MAX_EVALUATION_REQUEST_BYTES,
        "Evaluation suite request",
      );
    } catch (error) {
      return jsonError(
        context,
        errorMessage(error),
        error instanceof RequestBodyTooLargeError ? 413 : 400,
      );
    }
    const body = parseCreateEvaluationSuiteRequest(input);
    if (!body) {
      return jsonError(context, "Evaluation suite request is invalid", 400);
    }
    try {
      if (body.model) await assertAvailableModel(services, body.model);
    } catch (error) {
      return jsonError(context, errorMessage(error), 400);
    }
    const suite = await services.store.createEvaluationSuite(threadId, body);
    await services.store.appendEvent({
      threadId,
      runId: createId("runctl"),
      type: "evaluation.suite.created",
      category: "evaluation",
      visibility: "user",
      payload: evaluationSuiteEventPayload(suite),
    });
    setEvaluationSuiteProjectionHeaders(context, suite);
    return context.json(suite, 201);
  });

  app.put(
    "/api/threads/:threadId/evaluation-suites/:suiteId",
    async (context) => {
      const threadId = context.req.param("threadId");
      const current = services.store.getEvaluationSuite(
        context.req.param("suiteId"),
      );
      if (current.threadId !== threadId) {
        throw new Error(
          "Evaluation suite does not belong to the target thread",
        );
      }
      let input: unknown;
      try {
        input = await readLimitedJson(
          context.req.raw,
          MAX_EVALUATION_REQUEST_BYTES,
          "Evaluation suite update request",
        );
      } catch (error) {
        return jsonError(
          context,
          errorMessage(error),
          error instanceof RequestBodyTooLargeError ? 413 : 400,
        );
      }
      const body = parseUpdateEvaluationSuiteRequest(input);
      if (!body) {
        return jsonError(
          context,
          "Evaluation suite update request is invalid",
          400,
        );
      }
      try {
        if (body.model) await assertAvailableModel(services, body.model);
      } catch (error) {
        return jsonError(context, errorMessage(error), 400);
      }
      const suite = await services.store.updateEvaluationSuite(
        current.id,
        body,
      );
      if (suite.revision !== current.revision) {
        await services.store.appendEvent({
          threadId,
          runId: createId("runctl"),
          type: "evaluation.suite.updated",
          category: "evaluation",
          visibility: "user",
          payload: evaluationSuiteEventPayload(suite),
        });
      }
      setEvaluationSuiteProjectionHeaders(context, suite);
      return context.json(suite);
    },
  );

  app.post(
    "/api/threads/:threadId/evaluation-suites/:suiteId/executions",
    async (context) => {
      const threadId = context.req.param("threadId");
      const suiteId = context.req.param("suiteId");
      const suite = services.store.getEvaluationSuite(suiteId);
      if (suite.threadId !== threadId) {
        return jsonError(
          context,
          "Evaluation suite does not belong to the target thread",
          400,
        );
      }
      try {
        await assertAvailableModel(services, suite.evaluatorModel);
      } catch (error) {
        return jsonError(context, errorMessage(error), 400);
      }
      const execution = await services.evaluationSuites.execute(
        threadId,
        suiteId,
      );
      setEvaluationSuiteExecutionHeaders(context, execution);
      return context.json(execution, 201);
    },
  );

  app.post("/api/threads", async (context) => {
    let input: unknown;
    try {
      input = await readOptionalLimitedJson(
        context.req.raw,
        MAX_THREAD_CREATE_REQUEST_BYTES,
        "Thread creation request",
      );
    } catch (error) {
      return jsonError(
        context,
        errorMessage(error),
        error instanceof RequestBodyTooLargeError ? 413 : 400,
      );
    }
    const body = parseCreateThreadRequest(input);
    if (!body) {
      return jsonError(context, "Thread creation request is invalid", 400);
    }
    const agent = body?.agentId
      ? services.store.getAgent(body.agentId)
      : services.store.listAgents()[0];
    if (!agent) throw new Error("No agent profiles are available");
    const thread = await services.store.createThread({
      title: normalizeTitle(body?.title),
      agentId: agent.id,
    });
    const detail = await services.store.getDetail(thread.id);
    setThreadDetailProjectionHeaders(context, detail);
    return context.json(detail, 201);
  });

  app.post("/api/threads/import", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(
        context.req.raw,
        MAX_THREAD_REPLAY_BUNDLE_BYTES,
      );
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return jsonError(context, error.message, 413);
      }
      return jsonError(
        context,
        error instanceof Error
          ? `Invalid thread replay import request: ${error.message}`
          : "Invalid thread replay import request",
        400,
      );
    }
    const request = parseImportThreadReplayBundleRequest(input);
    if (!request) {
      return jsonError(context, "Thread replay import request is invalid", 400);
    }
    let bundle;
    try {
      bundle = validateThreadReplayBundle(request.bundle);
    } catch (error) {
      return jsonError(
        context,
        error instanceof Error
          ? error.message
          : "Thread replay bundle is invalid",
        400,
      );
    }
    const detail = await services.store.importThreadReplayBundle(
      bundle,
      request.title,
    );
    setThreadDetailProjectionHeaders(context, detail);
    return context.json(detail, 201);
  });

  app.put("/api/threads/:threadId/goal", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(
        context.req.raw,
        MAX_GOAL_REQUEST_BYTES,
        "Goal request",
      );
    } catch (error) {
      return jsonError(
        context,
        errorMessage(error),
        error instanceof RequestBodyTooLargeError ? 413 : 400,
      );
    }
    const body = parseSetGoalRequest(input);
    if (!body) {
      return jsonError(context, "Goal request is invalid", 400);
    }
    const goal = createGoal(body.objective, body.maxContinuations);
    const threadId = context.req.param("threadId");
    await services.store.setGoal(threadId, goal);
    await services.store.appendEvent({
      threadId,
      runId: createId("runctl"),
      type: "goal.set",
      category: "goal",
      visibility: "user",
      payload: {
        objective: goal.objective,
        maxContinuations: goal.maxContinuations,
      },
    });
    const detail = await services.store.getDetail(threadId);
    setThreadDetailProjectionHeaders(context, detail);
    return context.json(detail);
  });

  app.delete("/api/threads/:threadId/goal", async (context) => {
    const threadId = context.req.param("threadId");
    await services.store.setGoal(threadId, undefined);
    await services.store.appendEvent({
      threadId,
      runId: createId("runctl"),
      type: "goal.cleared",
      category: "goal",
      visibility: "user",
      payload: {},
    });
    const detail = await services.store.getDetail(threadId);
    setThreadDetailProjectionHeaders(context, detail);
    return context.json(detail);
  });

  app.get("/api/memories", (context) => {
    const agentId = context.req.query("agent");
    const memories = services.store.listMemories(agentId ? { agentId } : {});
    setMemoryListHeaders(context, memories, agentId);
    return context.json(memories);
  });

  app.post("/api/memories", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(
        context.req.raw,
        MAX_MEMORY_REQUEST_BYTES,
        "Memory proposal request",
      );
    } catch (error) {
      return jsonError(
        context,
        errorMessage(error),
        error instanceof RequestBodyTooLargeError ? 413 : 400,
      );
    }
    const body = parseCreateMemoryRequest(input);
    if (!body) {
      return jsonError(context, "Memory proposal request is invalid", 400);
    }
    const thread = body.threadId
      ? services.store.getThread(body.threadId)
      : undefined;
    const agentId =
      body.scope === "agent"
        ? (body.agentId ??
          thread?.agentId ??
          services.store.listAgents()[0]?.id)
        : body.agentId;
    const fact = await services.store.proposeMemory(
      {
        ...body,
        ...(agentId ? { agentId } : {}),
      },
      {
        type: "manual",
        ...(body.threadId ? { threadId: body.threadId } : {}),
      },
    );
    if (body.threadId) {
      await services.store.appendEvent({
        threadId: body.threadId,
        runId: createId("runctl"),
        type: "memory.proposed",
        category: "memory",
        visibility: "user",
        payload: {
          memoryId: fact.id,
          content: fact.content,
          category: fact.category,
          confidence: fact.confidence,
          scope: fact.scope,
          reviewIntervalDays: fact.reviewIntervalDays,
          ...(fact.agentId ? { agentId: fact.agentId } : {}),
          ...(fact.supersedesMemoryId
            ? { supersedesMemoryId: fact.supersedesMemoryId }
            : {}),
          ...(fact.consolidatesMemoryIds
            ? { consolidatesMemoryIds: fact.consolidatesMemoryIds }
            : {}),
        },
      });
    }
    setMemoryProjectionHeaders(context, fact);
    return context.json(fact, 201);
  });

  app.post("/api/memories/:memoryId/review", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(
        context.req.raw,
        MAX_MEMORY_REQUEST_BYTES,
        "Memory review request",
      );
    } catch (error) {
      return jsonError(
        context,
        errorMessage(error),
        error instanceof RequestBodyTooLargeError ? 413 : 400,
      );
    }
    const body = parseReviewMemoryRequest(input);
    if (!body) {
      return jsonError(context, "Memory review request is invalid", 400);
    }
    if (body.threadId) services.store.getThread(body.threadId);
    const fact = await services.store.reviewMemory(
      context.req.param("memoryId"),
      body,
    );
    if (body.threadId) {
      await services.store.appendEvent({
        threadId: body.threadId,
        runId: createId("runctl"),
        type: memoryReviewEventType(body.action),
        category: "memory",
        visibility: "user",
        payload: {
          memoryId: fact.id,
          status: fact.status,
          content: fact.content,
          reviewIntervalDays: fact.reviewIntervalDays,
          reviewDueAt: fact.reviewDueAt ?? "",
          useCount: fact.useCount,
          ...(fact.supersedesMemoryId
            ? {
                supersedesMemoryId: fact.supersedesMemoryId,
                ...(body.action === "approve"
                  ? { supersededMemoryStatus: "archived" }
                  : {}),
              }
            : {}),
          ...(fact.consolidatesMemoryIds
            ? {
                consolidatesMemoryIds: fact.consolidatesMemoryIds,
                ...(body.action === "approve"
                  ? { consolidatedMemoryStatus: "archived" }
                  : {}),
              }
            : {}),
          ...(fact.supersededByMemoryId
            ? { supersededByMemoryId: fact.supersededByMemoryId }
            : {}),
          ...(fact.reviewNote ? { note: fact.reviewNote } : {}),
        },
      });
    }
    setMemoryProjectionHeaders(context, fact);
    return context.json(fact);
  });

  app.get("/api/credentials", (context) => {
    const references = services.store.listCredentialReferences();
    setCredentialReferenceListHeaders(context, references);
    return context.json(references);
  });

  app.post("/api/credentials", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(
        context.req.raw,
        MAX_CREDENTIAL_REQUEST_BYTES,
        "Credential reference request",
      );
    } catch (error) {
      return jsonError(
        context,
        errorMessage(error),
        error instanceof RequestBodyTooLargeError ? 413 : 400,
      );
    }
    const body = parseCreateCredentialReferenceRequest(input);
    if (!body) {
      return jsonError(context, "Credential reference request is invalid", 400);
    }
    if (body.threadId) services.store.getThread(body.threadId);
    if (!services.models.models.getProvider(body.providerId)) {
      return jsonError(context, `Provider not found: ${body.providerId}`, 400);
    }
    const reference = await services.store.createCredentialReference(body);
    await appendCredentialEvent(
      services,
      body.threadId,
      "credential.reference.created",
      reference,
    );
    setCredentialReferenceHeaders(context, reference);
    return context.json(reference, 201);
  });

  app.post("/api/credentials/macos-keychain", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(
        context.req.raw,
        MAX_CREDENTIAL_SECRET_REQUEST_BYTES,
        "macOS Keychain credential request",
      );
    } catch (error) {
      return jsonError(
        context,
        errorMessage(error),
        error instanceof RequestBodyTooLargeError ? 413 : 400,
      );
    }
    const body = parseCreateMacOsKeychainCredentialRequest(input);
    if (!body) {
      return jsonError(
        context,
        "macOS Keychain credential request is invalid",
        400,
      );
    }
    if (body.threadId) services.store.getThread(body.threadId);
    if (!services.models.models.getProvider(body.providerId)) {
      return jsonError(context, `Provider not found: ${body.providerId}`, 400);
    }
    let reference;
    try {
      reference = await services.credentials.createMacOsKeychainReference(body);
    } catch (error) {
      if (isCredentialReferenceMutationError(error)) {
        return jsonError(context, error.message, 400);
      }
      throw error;
    }
    await appendCredentialEvent(
      services,
      body.threadId,
      "credential.reference.keychain_created",
      reference,
    );
    setCredentialReferenceHeaders(context, reference);
    return context.json(reference, 201);
  });

  app.post("/api/credentials/:referenceId/check", async (context) => {
    let input: unknown;
    try {
      input = await readOptionalLimitedJson(
        context.req.raw,
        MAX_CREDENTIAL_REQUEST_BYTES,
        "Credential check request",
      );
    } catch (error) {
      return jsonError(
        context,
        errorMessage(error),
        error instanceof RequestBodyTooLargeError ? 413 : 400,
      );
    }
    const body = parseCredentialThreadContextRequest(input);
    if (!body) {
      return jsonError(context, "Credential check request is invalid", 400);
    }
    if (body.threadId) services.store.getThread(body.threadId);
    const reference = await services.credentials.check(
      context.req.param("referenceId"),
    );
    await appendCredentialEvent(
      services,
      body.threadId,
      "credential.reference.checked",
      reference,
    );
    setCredentialReferenceHeaders(context, reference);
    return context.json(reference);
  });

  app.post("/api/credentials/:referenceId/status", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(
        context.req.raw,
        MAX_CREDENTIAL_REQUEST_BYTES,
        "Credential status request",
      );
    } catch (error) {
      return jsonError(
        context,
        errorMessage(error),
        error instanceof RequestBodyTooLargeError ? 413 : 400,
      );
    }
    const body = parseSetCredentialReferenceStatusRequest(input);
    if (!body) {
      return jsonError(context, "Credential status request is invalid", 400);
    }
    if (body.threadId) services.store.getThread(body.threadId);
    const reference = await services.store.setCredentialReferenceStatus(
      context.req.param("referenceId"),
      body.status,
    );
    await appendCredentialEvent(
      services,
      body.threadId,
      body.status === "active"
        ? "credential.reference.enabled"
        : "credential.reference.disabled",
      reference,
    );
    setCredentialReferenceHeaders(context, reference);
    return context.json(reference);
  });

  app.get("/api/extensions", (context) => {
    const agentId = context.req.query("agent");
    const extensions = services.store.listExtensions(
      agentId ? { agentId } : {},
    );
    setExtensionListHeaders(context, extensions, agentId);
    return context.json(extensions);
  });

  app.get("/api/extensions/publishers", (context) => {
    const anchors = services.store.listExtensionPublisherTrustAnchors();
    setExtensionPublisherTrustAnchorListHeaders(context, anchors);
    return context.json(anchors);
  });

  app.post("/api/extensions/publishers", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(
        context.req.raw,
        MAX_TRUST_ADMIN_REQUEST_BYTES,
        "Extension publisher trust anchor request",
      );
    } catch (error) {
      return jsonError(
        context,
        errorMessage(error),
        error instanceof RequestBodyTooLargeError ? 413 : 400,
      );
    }
    const body = parseCreateExtensionPublisherTrustAnchorRequest(input);
    if (!body) {
      return jsonError(
        context,
        "Extension publisher trust anchor is invalid",
        400,
      );
    }
    const anchor =
      await services.store.createExtensionPublisherTrustAnchor(body);
    await appendExtensionEvent(
      services,
      body.threadId,
      "extension.publisher.created",
      {
        trustAnchorId: anchor.id,
        keyId: anchor.keyId,
        algorithm: anchor.algorithm,
        status: anchor.status,
        signingCapable: Boolean(anchor.signingSource),
        anchorSha256: anchor.contentSha256,
      },
    );
    setExtensionPublisherTrustAnchorHeaders(context, anchor);
    return context.json(anchor, 201);
  });

  app.post("/api/extensions/publishers/:anchorId/revoke", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(
        context.req.raw,
        MAX_TRUST_ADMIN_REQUEST_BYTES,
        "Extension publisher trust anchor revocation request",
      );
    } catch (error) {
      return jsonError(
        context,
        errorMessage(error),
        error instanceof RequestBodyTooLargeError ? 413 : 400,
      );
    }
    const body = parseRevokeExtensionPublisherTrustAnchorRequest(input);
    if (!body) {
      return jsonError(
        context,
        "Extension publisher trust anchor revocation is invalid",
        400,
      );
    }
    services.store.getThread(body.threadId);
    const before = services.store.getExtensionPublisherTrustAnchor(
      context.req.param("anchorId"),
    );
    const extensionRevisions = new Map(
      services.store
        .listExtensions()
        .map((extension) => [extension.id, extension.revision]),
    );
    const anchor = await services.store.revokeExtensionPublisherTrustAnchor(
      before.id,
    );
    const affectedExtensionIds = services.store
      .listExtensions()
      .filter(
        (extension) =>
          extension.revision !== extensionRevisions.get(extension.id),
      )
      .map((extension) => extension.id);
    await Promise.allSettled(
      affectedExtensionIds.map((extensionId) =>
        services.extensions.closeTransport(extensionId),
      ),
    );
    if (before.status !== anchor.status) {
      await appendExtensionEvent(
        services,
        body.threadId,
        "extension.publisher.revoked",
        {
          trustAnchorId: anchor.id,
          keyId: anchor.keyId,
          status: anchor.status,
          anchorSha256: anchor.contentSha256,
          affectedExtensionIdsSha256: sha256Json(affectedExtensionIds.sort()),
          affectedExtensionCount: affectedExtensionIds.length,
        },
      );
    }
    setExtensionPublisherTrustAnchorHeaders(context, anchor);
    return context.json(anchor);
  });

  app.post("/api/skills/packages/sign", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(
        context.req.raw,
        MAX_PACKAGE_GOVERNANCE_REQUEST_BYTES,
        "Skill package signing request",
      );
    } catch (error) {
      return jsonError(
        context,
        errorMessage(error),
        error instanceof RequestBodyTooLargeError ? 413 : 400,
      );
    }
    const body = parseSignSkillPackageRequest(input);
    if (!body) {
      return jsonError(
        context,
        "Skill package signing request is invalid",
        400,
      );
    }
    const envelope = await services.store.signSkillPackage(body);
    setSkillPackageHeaders(
      context,
      envelope,
      `napier-skill-package-${envelope.manifest.contentSha256.slice(0, 12)}.json`,
    );
    await appendExtensionEvent(
      services,
      body.threadId,
      "skill.package.signed",
      {
        manifestSha256: envelope.manifest.contentSha256,
        envelopeSha256: envelope.contentSha256,
        skillCatalogSha256: envelope.manifest.skillCatalogSha256,
        skillCount: envelope.manifest.skills.length,
        keyId: envelope.signature.keyId,
        skillNamesSha256: sha256Json(envelope.manifest.loadedSkillNames),
      },
    );
    return context.json(envelope);
  });

  app.post("/api/skills/packages/verify", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(
        context.req.raw,
        MAX_SIGNED_SKILL_PACKAGE_BYTES + 1_024,
        "Skill package verification request",
      );
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return jsonError(context, error.message, 413);
      }
      return jsonError(
        context,
        "Skill package verification request is invalid",
        400,
      );
    }
    const body = parseVerifySkillPackageRequest(input);
    if (!body) {
      return jsonError(
        context,
        "Skill package verification request is invalid",
        400,
      );
    }
    const verification = services.store.verifySkillPackage(body);
    setSkillPackageVerificationHeaders(context, verification);
    return context.json(verification);
  });

  app.post("/api/skills/packages/qualify", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(
        context.req.raw,
        MAX_SIGNED_SKILL_PACKAGE_BYTES + 1_024,
        "Skill package qualification request",
      );
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return jsonError(context, error.message, 413);
      }
      return jsonError(
        context,
        "Skill package qualification request is invalid",
        400,
      );
    }
    const body = parseQualifySkillPackageRequest(input);
    if (!body) {
      return jsonError(
        context,
        "Skill package qualification request is invalid",
        400,
      );
    }
    const qualification = await services.store.qualifySkillPackage(body);
    setSkillPackageQualificationHeaders(context, qualification);
    await appendExtensionEvent(
      services,
      body.threadId,
      "skill.package.qualified",
      {
        status: qualification.status,
        verificationStatus: qualification.verificationStatus,
        skillCount: qualification.skillCount,
        ...(qualification.manifestSha256
          ? { manifestSha256: qualification.manifestSha256 }
          : {}),
        ...(qualification.envelopeSha256
          ? { envelopeSha256: qualification.envelopeSha256 }
          : {}),
        ...(qualification.skillCatalogSha256
          ? { skillCatalogSha256: qualification.skillCatalogSha256 }
          : {}),
        ...(qualification.observedSkillCatalogSha256
          ? {
              observedSkillCatalogSha256:
                qualification.observedSkillCatalogSha256,
            }
          : {}),
        ...(qualification.keyId ? { keyId: qualification.keyId } : {}),
      },
    );
    return context.json(qualification);
  });

  app.get("/api/skills/packages/installations", (context) => {
    const installations = services.store.listSkillPackageInstallations();
    setSkillPackageInstallationListHeaders(context, installations);
    return context.json(installations);
  });

  app.post("/api/skills/packages/installations", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(
        context.req.raw,
        MAX_SIGNED_SKILL_PACKAGE_BYTES + 1_024,
        "Skill package installation request",
      );
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return jsonError(context, error.message, 413);
      }
      return jsonError(
        context,
        "Skill package installation request is invalid",
        400,
      );
    }
    const body = parseInstallSkillPackageRequest(input);
    if (!body) {
      return jsonError(
        context,
        "Skill package installation request is invalid",
        400,
      );
    }
    const result = await services.store.installSkillPackage(body);
    setSkillPackageInstallationResultHeaders(context, result);
    await appendExtensionEvent(
      services,
      body.threadId,
      result.created
        ? "skill.package.installed"
        : "skill.package.installation_matched",
      {
        installationId: result.installation.id,
        status: result.installation.status,
        created: result.created,
        publisher: result.installation.publisher,
        keyId: result.installation.keyId,
        skillCatalogSha256: result.installation.skillCatalogSha256,
        manifestSha256: result.installation.manifestSha256,
        envelopeSha256: result.installation.envelopeSha256,
        skillNamesSha256: result.installation.skillNamesSha256,
        skillCount: result.installation.loadedSkillNames.length,
        ...(result.replacedInstallation
          ? {
              replacedInstallationId: result.replacedInstallation.id,
              publisherChanged:
                result.replacedInstallation.publisher !==
                  result.installation.publisher ||
                result.replacedInstallation.keyId !== result.installation.keyId,
              skillSetChanged:
                result.replacedInstallation.skillNamesSha256 !==
                result.installation.skillNamesSha256,
            }
          : {}),
      },
    );
    return context.json(result);
  });

  app.post("/api/skills/content/preview", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(
        context.req.raw,
        MAX_SKILL_CONTENT_BYTES * 2 + 4_096,
        "Skill content preview request",
      );
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return jsonError(context, error.message, 413);
      }
      return jsonError(
        context,
        "Skill content preview request is invalid",
        400,
      );
    }
    const body = parsePreviewSkillContentRequest(input);
    if (!body) {
      return jsonError(
        context,
        "Skill content preview request is invalid",
        400,
      );
    }
    const review = await services.store.previewSkillContent(body);
    setSkillContentReviewHeaders(context, review);
    return context.json(review);
  });

  app.post("/api/skills/content/apply", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(
        context.req.raw,
        MAX_SKILL_CONTENT_BYTES * 2 + 4_096,
        "Skill content apply request",
      );
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return jsonError(context, error.message, 413);
      }
      return jsonError(context, "Skill content apply request is invalid", 400);
    }
    const body = parseApplySkillContentRequest(input);
    if (!body) {
      return jsonError(context, "Skill content apply request is invalid", 400);
    }
    const result = await services.store.applySkillContent(body);
    setSkillContentApplyResultHeaders(context, result);
    await appendExtensionEvent(
      services,
      body.threadId,
      result.review.action === "noop"
        ? "skill.content.noop"
        : result.review.action === "install"
          ? "skill.content.installed"
          : "skill.content.replaced",
      {
        applied: result.applied,
        skillName: result.review.skillName,
        relativePath: result.review.relativePath,
        action: result.review.action,
        reviewSha256: result.review.reviewSha256,
        contentSha256: result.review.contentSha256,
        frontmatterSha256: result.review.frontmatterSha256,
        bodySha256: result.review.bodySha256,
        sizeBytes: result.review.sizeBytes,
        lineCount: result.review.lineCount,
        ...(result.review.currentContentSha256
          ? { currentContentSha256: result.review.currentContentSha256 }
          : {}),
        ...(result.review.currentSizeBytes !== undefined
          ? { currentSizeBytes: result.review.currentSizeBytes }
          : {}),
        ...(result.review.currentLineCount !== undefined
          ? { currentLineCount: result.review.currentLineCount }
          : {}),
      },
    );
    return context.json(result);
  });

  app.post("/api/prompts/packages/sign", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(
        context.req.raw,
        MAX_PACKAGE_GOVERNANCE_REQUEST_BYTES,
        "Prompt package signing request",
      );
    } catch (error) {
      return jsonError(
        context,
        errorMessage(error),
        error instanceof RequestBodyTooLargeError ? 413 : 400,
      );
    }
    const body = parseSignPromptPackageRequest(input);
    if (!body) {
      return jsonError(
        context,
        "Prompt package signing request is invalid",
        400,
      );
    }
    const envelope = services.store.signPromptPackage(body);
    setPromptPackageHeaders(
      context,
      envelope,
      `napier-prompt-package-${envelope.manifest.contentSha256.slice(0, 12)}.json`,
    );
    await appendExtensionEvent(
      services,
      body.threadId,
      "prompt.package.signed",
      {
        manifestSha256: envelope.manifest.contentSha256,
        envelopeSha256: envelope.contentSha256,
        systemPromptSha256: envelope.manifest.systemPromptSha256,
        agentId: envelope.manifest.sourceAgentId,
        agentRevision: envelope.manifest.agentRevision,
        keyId: envelope.signature.keyId,
      },
    );
    return context.json(envelope);
  });

  app.post("/api/prompts/packages/verify", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(
        context.req.raw,
        MAX_SIGNED_PROMPT_PACKAGE_BYTES + 1_024,
        "Prompt package verification request",
      );
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return jsonError(context, error.message, 413);
      }
      return jsonError(
        context,
        "Prompt package verification request is invalid",
        400,
      );
    }
    const body = parseVerifyPromptPackageRequest(input);
    if (!body) {
      return jsonError(
        context,
        "Prompt package verification request is invalid",
        400,
      );
    }
    const verification = services.store.verifyPromptPackage(body);
    setPromptPackageVerificationHeaders(context, verification);
    return context.json(verification);
  });

  app.post("/api/prompts/packages/qualify", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(
        context.req.raw,
        MAX_SIGNED_PROMPT_PACKAGE_BYTES + 1_024,
        "Prompt package qualification request",
      );
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return jsonError(context, error.message, 413);
      }
      return jsonError(
        context,
        "Prompt package qualification request is invalid",
        400,
      );
    }
    const body = parseQualifyPromptPackageRequest(input);
    if (!body) {
      return jsonError(
        context,
        "Prompt package qualification request is invalid",
        400,
      );
    }
    const qualification = services.store.qualifyPromptPackage(body);
    setPromptPackageQualificationHeaders(context, qualification);
    await appendExtensionEvent(
      services,
      body.threadId,
      "prompt.package.qualified",
      {
        status: qualification.status,
        verificationStatus: qualification.verificationStatus,
        ...(qualification.manifestSha256
          ? { manifestSha256: qualification.manifestSha256 }
          : {}),
        ...(qualification.envelopeSha256
          ? { envelopeSha256: qualification.envelopeSha256 }
          : {}),
        ...(qualification.systemPromptSha256
          ? { systemPromptSha256: qualification.systemPromptSha256 }
          : {}),
        ...(qualification.observedSystemPromptSha256
          ? {
              observedSystemPromptSha256:
                qualification.observedSystemPromptSha256,
            }
          : {}),
        ...(qualification.observedAgentId
          ? { observedAgentId: qualification.observedAgentId }
          : {}),
        ...(qualification.observedAgentRevision
          ? { observedAgentRevision: qualification.observedAgentRevision }
          : {}),
        ...(qualification.keyId ? { keyId: qualification.keyId } : {}),
      },
    );
    return context.json(qualification);
  });

  app.post("/api/inspectors/packages/sign", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(
        context.req.raw,
        MAX_PACKAGE_GOVERNANCE_REQUEST_BYTES,
        "Inspector package signing request",
      );
    } catch (error) {
      return jsonError(
        context,
        errorMessage(error),
        error instanceof RequestBodyTooLargeError ? 413 : 400,
      );
    }
    const body = parseSignInspectorPackageRequest(input);
    if (!body) {
      return jsonError(
        context,
        "Inspector package signing request is invalid",
        400,
      );
    }
    const envelope = services.store.signInspectorPackage(body);
    setInspectorPackageHeaders(
      context,
      envelope,
      `napier-inspector-package-${envelope.manifest.contentSha256.slice(0, 12)}.json`,
    );
    await appendExtensionEvent(
      services,
      body.threadId,
      "inspector.package.signed",
      {
        manifestSha256: envelope.manifest.contentSha256,
        envelopeSha256: envelope.contentSha256,
        inspectorCatalogSha256: envelope.manifest.inspectorCatalogSha256,
        panelCount: envelope.manifest.panels.length,
        keyId: envelope.signature.keyId,
        panelIdsSha256: sha256Json(
          envelope.manifest.panels.map((panel) => panel.id),
        ),
      },
    );
    return context.json(envelope);
  });

  app.post("/api/inspectors/packages/verify", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(
        context.req.raw,
        MAX_SIGNED_INSPECTOR_PACKAGE_BYTES + 1_024,
        "Inspector package verification request",
      );
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return jsonError(context, error.message, 413);
      }
      return jsonError(
        context,
        "Inspector package verification request is invalid",
        400,
      );
    }
    const body = parseVerifyInspectorPackageRequest(input);
    if (!body) {
      return jsonError(
        context,
        "Inspector package verification request is invalid",
        400,
      );
    }
    const verification = services.store.verifyInspectorPackage(body);
    setInspectorPackageVerificationHeaders(context, verification);
    return context.json(verification);
  });

  app.post("/api/inspectors/packages/qualify", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(
        context.req.raw,
        MAX_SIGNED_INSPECTOR_PACKAGE_BYTES + 1_024,
        "Inspector package qualification request",
      );
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return jsonError(context, error.message, 413);
      }
      return jsonError(
        context,
        "Inspector package qualification request is invalid",
        400,
      );
    }
    const body = parseQualifyInspectorPackageRequest(input);
    if (!body) {
      return jsonError(
        context,
        "Inspector package qualification request is invalid",
        400,
      );
    }
    const qualification = services.store.qualifyInspectorPackage(body);
    setInspectorPackageQualificationHeaders(context, qualification);
    await appendExtensionEvent(
      services,
      body.threadId,
      "inspector.package.qualified",
      {
        status: qualification.status,
        verificationStatus: qualification.verificationStatus,
        panelCount: qualification.panelCount,
        ...(qualification.manifestSha256
          ? { manifestSha256: qualification.manifestSha256 }
          : {}),
        ...(qualification.envelopeSha256
          ? { envelopeSha256: qualification.envelopeSha256 }
          : {}),
        ...(qualification.inspectorCatalogSha256
          ? { inspectorCatalogSha256: qualification.inspectorCatalogSha256 }
          : {}),
        ...(qualification.observedInspectorCatalogSha256
          ? {
              observedInspectorCatalogSha256:
                qualification.observedInspectorCatalogSha256,
            }
          : {}),
        ...(qualification.keyId ? { keyId: qualification.keyId } : {}),
      },
    );
    return context.json(qualification);
  });

  app.post("/api/extensions/:extensionId/package/sign", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(
        context.req.raw,
        MAX_PACKAGE_GOVERNANCE_REQUEST_BYTES,
        "Extension package signing request",
      );
    } catch (error) {
      return jsonError(
        context,
        errorMessage(error),
        error instanceof RequestBodyTooLargeError ? 413 : 400,
      );
    }
    const body = parseSignExtensionPackageRequest(input);
    if (!body) {
      return jsonError(
        context,
        "Extension package signing request is invalid",
        400,
      );
    }
    const extension = services.store.getExtension(
      context.req.param("extensionId"),
    );
    const envelope = await services.store.signExtensionPackage(
      extension.id,
      body,
    );
    setSignedExtensionPackageHeaders(
      context,
      envelope,
      extension.normalizedName,
    );
    await appendExtensionEvent(
      services,
      body.threadId,
      "extension.package.signed",
      signedExtensionPackageEventPayload(extension.id, envelope),
    );
    return context.json(envelope);
  });

  app.post("/api/extensions/packages/deployment/preview", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(
        context.req.raw,
        MAX_EXTENSION_PACKAGE_DEPLOYMENT_BYTES + 131_072,
        "Signed Extension package deployment preview request",
      );
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return jsonError(context, error.message, 413);
      }
      return jsonError(
        context,
        "Signed Extension package deployment preview request is invalid",
        400,
      );
    }
    const body = parsePreviewExtensionPackageDeploymentRequest(input);
    if (!body) {
      return jsonError(
        context,
        "Signed Extension package deployment preview request is invalid",
        400,
      );
    }
    const preview = services.store.previewExtensionPackageDeployment(
      body.envelopes,
    );
    setExtensionPackageDeploymentPreviewHeaders(context, preview);
    return context.json(preview);
  });

  app.post("/api/extensions/packages/deployment", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(
        context.req.raw,
        MAX_EXTENSION_PACKAGE_DEPLOYMENT_BYTES + 131_072,
        "Signed Extension package deployment request",
      );
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return jsonError(context, error.message, 413);
      }
      return jsonError(
        context,
        "Signed Extension package deployment request is invalid",
        400,
      );
    }
    const body = parseApplyExtensionPackageDeploymentRequest(input);
    if (!body) {
      return jsonError(
        context,
        "Signed Extension package deployment request is invalid",
        400,
      );
    }
    const result = await services.store.applyExtensionPackageDeployment(body);
    await Promise.allSettled(
      result.updatedExtensionIds.map((extensionId) =>
        services.extensions.closeTransport(extensionId),
      ),
    );
    if (result.extensions.length > 0) {
      await appendExtensionEvent(
        services,
        body.threadId,
        "extension.packages.deployed",
        {
          deploymentSha256: result.preview.contentSha256,
          candidateCount: result.preview.candidateCount,
          installCount: result.installedExtensionIds.length,
          updateCount: result.updatedExtensionIds.length,
          installedExtensionIdsSha256: sha256Json(
            [...result.installedExtensionIds].sort(),
          ),
          updatedExtensionIdsSha256: sha256Json(
            [...result.updatedExtensionIds].sort(),
          ),
          candidateEnvelopeIdsSha256: sha256Json(
            result.preview.items.map((item) => item.next.envelopeSha256).sort(),
          ),
          applyOrderSha256: sha256Json(result.preview.applyOrder),
          dependencyResolutionSha256: sha256Json(
            result.preview.resolutions.map((resolution) => ({
              dependentName: resolution.dependentName,
              dependencyName: resolution.dependencyName,
              versionRange: resolution.versionRange,
              resolvedVersion: resolution.resolvedVersion,
              resolvedExtensionId: resolution.resolvedExtensionId ?? "",
              source: resolution.source,
            })),
          ),
        },
      );
    }
    setExtensionPackageDeploymentResultHeaders(context, result);
    return context.json(result);
  });

  app.post("/api/extensions/packages/lockfile/export", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(
        context.req.raw,
        MAX_PACKAGE_GOVERNANCE_REQUEST_BYTES,
        "Extension package lockfile export request",
      );
    } catch (error) {
      return jsonError(
        context,
        errorMessage(error),
        error instanceof RequestBodyTooLargeError ? 413 : 400,
      );
    }
    const body = parseExportExtensionPackageLockfileRequest(input);
    if (!body) {
      return jsonError(
        context,
        "Extension package lockfile export request is invalid",
        400,
      );
    }
    const lockfile = services.store.exportExtensionPackageLockfile(body);
    setExtensionPackageLockfileHeaders(
      context,
      lockfile,
      `napier-extension-lockfile-${lockfile.contentSha256.slice(0, 12)}.json`,
    );
    await appendExtensionEvent(
      services,
      body.threadId,
      "extension.packages.lockfile.exported",
      {
        lockfileSha256: lockfile.contentSha256,
        packageCount: lockfile.packages.length,
        packageEnvelopeIdsSha256: sha256Json(
          lockfile.packages.map((entry) => entry.envelopeSha256).sort(),
        ),
        dependencyCount: lockfile.packages.reduce(
          (total, entry) => total + entry.dependencies.length,
          0,
        ),
      },
    );
    return context.json(lockfile);
  });

  app.get(
    "/api/extensions/packages/lockfiles/:lockfileSha256",
    async (context) => {
      const lockfileSha256 = context.req.param("lockfileSha256");
      if (!/^[a-f0-9]{64}$/.test(lockfileSha256)) {
        return jsonError(
          context,
          "Extension package lockfile hash is invalid",
          400,
        );
      }
      try {
        const lockfile =
          services.store.getExtensionPackageRolloutLockfile(lockfileSha256);
        setExtensionPackageLockfileHeaders(
          context,
          lockfile,
          `napier-extension-lockfile-${lockfile.contentSha256.slice(0, 12)}.json`,
        );
        return context.json(lockfile);
      } catch (error) {
        return jsonError(context, errorMessage(error), 404);
      }
    },
  );

  app.post("/api/extensions/packages/lockfile/verify", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(
        context.req.raw,
        MAX_EXTENSION_PACKAGE_LOCKFILE_BYTES + 16_384,
        "Extension package lockfile verification request",
      );
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return jsonError(context, error.message, 413);
      }
      return jsonError(
        context,
        "Extension package lockfile verification request is invalid",
        400,
      );
    }
    const body = parseVerifyExtensionPackageLockfileRequest(input);
    if (!body) {
      return jsonError(
        context,
        "Extension package lockfile verification request is invalid",
        400,
      );
    }
    const verification = services.store.verifyExtensionPackageLockfile(
      body.lockfile,
    );
    setExtensionPackageLockfileVerificationHeaders(context, verification);
    return context.json(verification);
  });

  app.post("/api/extensions/packages/channel-index/sign", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(
        context.req.raw,
        MAX_PACKAGE_GOVERNANCE_REQUEST_BYTES,
        "Extension package channel index signing request",
      );
    } catch (error) {
      return jsonError(
        context,
        errorMessage(error),
        error instanceof RequestBodyTooLargeError ? 413 : 400,
      );
    }
    const body = parseSignExtensionPackageChannelIndexRequest(input);
    if (!body) {
      return jsonError(
        context,
        "Extension package channel index signing request is invalid",
        400,
      );
    }
    const envelope =
      await services.store.signExtensionPackageChannelIndex(body);
    setExtensionPackageChannelIndexHeaders(
      context,
      envelope,
      `napier-channel-index-${envelope.index.contentSha256.slice(0, 12)}.json`,
    );
    await appendExtensionEvent(
      services,
      body.threadId,
      "extension.packages.channel_index.signed",
      {
        indexSha256: envelope.index.contentSha256,
        envelopeSha256: envelope.contentSha256,
        channelCount: envelope.index.channels.length,
        keyId: envelope.signature.keyId,
        channelNamesSha256: sha256Json(
          envelope.index.channels.map((entry) => entry.normalizedName).sort(),
        ),
      },
    );
    return context.json(envelope);
  });

  app.post("/api/extensions/packages/channel-index/verify", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(
        context.req.raw,
        MAX_EXTENSION_PACKAGE_CHANNEL_INDEX_BYTES + 16_384,
        "Extension package channel index verification request",
      );
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return jsonError(context, error.message, 413);
      }
      return jsonError(
        context,
        "Extension package channel index verification request is invalid",
        400,
      );
    }
    const body = parseVerifyExtensionPackageChannelIndexRequest(input);
    if (!body) {
      return jsonError(
        context,
        "Extension package channel index verification request is invalid",
        400,
      );
    }
    const verification =
      services.store.verifyExtensionPackageChannelIndex(body);
    setExtensionPackageChannelIndexVerificationHeaders(context, verification);
    return context.json(verification);
  });

  app.get("/api/extensions/packages/rollouts", (context) => {
    const channels = services.store.listExtensionPackageRolloutChannels();
    setExtensionPackageRolloutChannelListHeaders(context, channels);
    return context.json(channels);
  });

  app.post("/api/extensions/packages/rollouts", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(
        context.req.raw,
        MAX_PACKAGE_GOVERNANCE_REQUEST_BYTES,
        "Extension package rollout channel request",
      );
    } catch (error) {
      return jsonError(
        context,
        errorMessage(error),
        error instanceof RequestBodyTooLargeError ? 413 : 400,
      );
    }
    const body = parsePublishExtensionPackageRolloutChannelRequest(input);
    if (!body) {
      return jsonError(
        context,
        "Extension package rollout channel request is invalid",
        400,
      );
    }
    const channel =
      await services.store.publishExtensionPackageRolloutChannel(body);
    await appendExtensionEvent(
      services,
      body.threadId,
      "extension.packages.rollout.published",
      {
        channelId: channel.id,
        name: channel.name,
        normalizedName: channel.normalizedName,
        revision: channel.revision,
        lockfileSha256: channel.lockfileSha256,
        packageCount: channel.packageCount,
        dependencyCount: channel.dependencyCount,
        packageEnvelopeIdsSha256: channel.packageEnvelopeIdsSha256,
        policySha256: sha256Json({
          maxPackages: channel.policy.maxPackages,
          allowedPublisherKeyIds: channel.policy.allowedPublisherKeyIds,
          allowedPackageNames: channel.policy.allowedPackageNames,
          requireTrustedPublishers: channel.policy.requireTrustedPublishers,
          requireDependencyClosure: channel.policy.requireDependencyClosure,
        }),
      },
    );
    setExtensionPackageRolloutChannelHeaders(context, channel);
    return context.json(channel, channel.revision === 1 ? 201 : 200);
  });

  app.post(
    "/api/extensions/packages/rollouts/:channelId/preview",
    (context) => {
      const body = parsePreviewExtensionPackageRolloutChannelRequest({
        channelId: context.req.param("channelId"),
      });
      if (!body) {
        return jsonError(
          context,
          "Extension package rollout channel preview request is invalid",
          400,
        );
      }
      const preview =
        services.store.previewExtensionPackageRolloutChannel(body);
      setExtensionPackageRolloutPreviewHeaders(context, preview);
      return context.json(preview);
    },
  );

  app.post("/api/extensions/packages/rollouts/:channelId", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(
        context.req.raw,
        MAX_PACKAGE_GOVERNANCE_REQUEST_BYTES,
        "Extension package rollout channel apply request",
      );
    } catch (error) {
      return jsonError(
        context,
        errorMessage(error),
        error instanceof RequestBodyTooLargeError ? 413 : 400,
      );
    }
    const record =
      input && typeof input === "object" && !Array.isArray(input)
        ? (input as Record<string, unknown>)
        : {};
    const body = parseApplyExtensionPackageRolloutChannelRequest({
      ...record,
      channelId: context.req.param("channelId"),
    });
    if (!body) {
      return jsonError(
        context,
        "Extension package rollout channel apply request is invalid",
        400,
      );
    }
    const result =
      await services.store.applyExtensionPackageRolloutChannel(body);
    await Promise.allSettled(
      result.deployment.updatedExtensionIds.map((extensionId) =>
        services.extensions.closeTransport(extensionId),
      ),
    );
    if (result.deployment.extensions.length > 0) {
      await appendExtensionEvent(
        services,
        body.threadId,
        "extension.packages.rollout.applied",
        {
          channelId: result.channel.id,
          channelRevision: result.channel.revision,
          rolloutSha256: result.rolloutPreview.contentSha256,
          deploymentSha256: result.deployment.preview.contentSha256,
          lockfileSha256: result.channel.lockfileSha256,
          installCount: result.deployment.installedExtensionIds.length,
          updateCount: result.deployment.updatedExtensionIds.length,
          installedExtensionIdsSha256: sha256Json(
            [...result.deployment.installedExtensionIds].sort(),
          ),
          updatedExtensionIdsSha256: sha256Json(
            [...result.deployment.updatedExtensionIds].sort(),
          ),
          packageEnvelopeIdsSha256: result.channel.packageEnvelopeIdsSha256,
        },
      );
    }
    setExtensionPackageRolloutApplyResultHeaders(context, result);
    return context.json(result);
  });

  app.post(
    "/api/extensions/:extensionId/package/update/preview",
    async (context) => {
      let input: unknown;
      try {
        input = await readLimitedJson(
          context.req.raw,
          MAX_SIGNED_EXTENSION_PACKAGE_BYTES + 16_384,
          "Signed Extension package update preview request",
        );
      } catch (error) {
        if (error instanceof RequestBodyTooLargeError) {
          return jsonError(context, error.message, 413);
        }
        return jsonError(
          context,
          "Signed Extension package update preview request is invalid",
          400,
        );
      }
      const body = parsePreviewExtensionPackageUpdateRequest(input);
      if (!body) {
        return jsonError(
          context,
          "Signed Extension package update preview request is invalid",
          400,
        );
      }
      const preview = services.store.previewExtensionPackageUpdate(
        context.req.param("extensionId"),
        body.envelope,
      );
      setExtensionPackageUpdatePreviewHeaders(context, preview);
      return context.json(preview);
    },
  );

  app.post("/api/extensions/:extensionId/package/update", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(
        context.req.raw,
        MAX_SIGNED_EXTENSION_PACKAGE_BYTES + 16_384,
        "Signed Extension package update request",
      );
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return jsonError(context, error.message, 413);
      }
      return jsonError(
        context,
        "Signed Extension package update request is invalid",
        400,
      );
    }
    const body = parseApplyExtensionPackageUpdateRequest(input);
    if (!body) {
      return jsonError(
        context,
        "Signed Extension package update request is invalid",
        400,
      );
    }
    const extensionId = context.req.param("extensionId");
    const result = await services.store.applyExtensionPackageUpdate(
      extensionId,
      body,
    );
    if (result.updated) {
      await services.extensions.closeTransport(extensionId);
      await appendExtensionEvent(
        services,
        body.threadId,
        "extension.package.updated",
        {
          extensionId,
          expectedPackageBindingSha256:
            result.preview.expectedPackageBindingSha256,
          currentManifestSha256: result.preview.current.manifestSha256,
          currentEnvelopeSha256: result.preview.current.envelopeSha256,
          nextManifestSha256: result.preview.next.manifestSha256,
          nextEnvelopeSha256: result.preview.next.envelopeSha256,
          previewSha256: result.preview.contentSha256,
          versionDirection: result.preview.versionDirection,
          publisherChanged: result.preview.publisherChanged,
          changeKinds: result.preview.changes,
          packageHistoryCount: result.extension.packageHistory?.length ?? 0,
        },
      );
    }
    setExtensionPackageUpdateResultHeaders(context, result);
    return context.json(result);
  });

  app.post("/api/extensions/packages/verify", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(
        context.req.raw,
        MAX_SIGNED_EXTENSION_PACKAGE_BYTES + 16_384,
        "Signed Extension package verification request",
      );
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return jsonError(context, error.message, 413);
      }
      return jsonError(
        context,
        "Signed Extension package verification request is invalid",
        400,
      );
    }
    const body = parseVerifySignedExtensionPackageRequest(input);
    if (!body) {
      return jsonError(
        context,
        "Signed Extension package verification request is invalid",
        400,
      );
    }
    const verification = verifySignedExtensionPackageEnvelope(
      body.envelope,
      services.store.listExtensionPublisherTrustAnchors(),
    );
    setExtensionPackageVerificationHeaders(context, verification);
    return context.json(verification);
  });

  app.post("/api/extensions/packages/import", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(
        context.req.raw,
        MAX_SIGNED_EXTENSION_PACKAGE_BYTES + 16_384,
        "Signed Extension package import request",
      );
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return jsonError(context, error.message, 413);
      }
      return jsonError(
        context,
        "Signed Extension package import request is invalid",
        400,
      );
    }
    const body = parseImportSignedExtensionPackageRequest(input);
    if (!body) {
      return jsonError(
        context,
        "Signed Extension package import request is invalid",
        400,
      );
    }
    const extension = await services.store.importSignedExtensionPackage(body);
    const packageBinding = extension.packageBinding;
    if (!packageBinding) {
      throw new Error(
        "Signed Extension import did not produce a package binding",
      );
    }
    await appendExtensionEvent(
      services,
      body.threadId,
      "extension.package.imported",
      {
        ...signedExtensionPackageEventPayload(
          extension.id,
          packageBinding.envelope,
        ),
        packageBindingSha256: packageBinding.contentSha256,
      },
    );
    setExtensionRecordHeaders(context, extension);
    return context.json(extension, 201);
  });

  app.post("/api/extensions/mcp", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(
        context.req.raw,
        MAX_EXTENSION_ADMIN_REQUEST_BYTES,
        "MCP extension request",
      );
    } catch (error) {
      return jsonError(
        context,
        errorMessage(error),
        error instanceof RequestBodyTooLargeError ? 413 : 400,
      );
    }
    const body = parseCreateMcpExtensionRequest(input);
    if (!body) {
      return jsonError(context, "MCP extension request is invalid", 400);
    }
    if (body.threadId) services.store.getThread(body.threadId);
    const extension = await services.store.createMcpExtension(body);
    await appendExtensionEvent(services, body.threadId, "extension.proposed", {
      extensionId: extension.id,
      name: extension.name,
      kind: extension.kind,
      requestedCapabilities: extension.requestedCapabilities,
      provenanceSha256: extension.provenance.digestSha256,
    });
    setExtensionRecordHeaders(context, extension);
    return context.json(extension, 201);
  });

  app.post("/api/extensions/:extensionId/review", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(
        context.req.raw,
        MAX_EXTENSION_ADMIN_REQUEST_BYTES,
        "Extension review request",
      );
    } catch (error) {
      return jsonError(
        context,
        errorMessage(error),
        error instanceof RequestBodyTooLargeError ? 413 : 400,
      );
    }
    const body = parseReviewExtensionRequest(input);
    if (!body) {
      return jsonError(context, "Extension review request is invalid", 400);
    }
    if (body.threadId) services.store.getThread(body.threadId);
    const extension = await services.store.reviewExtension(
      context.req.param("extensionId"),
      body,
    );
    await appendExtensionEvent(
      services,
      body.threadId,
      `extension.${body.action === "approve" ? "approved" : "rejected"}`,
      {
        extensionId: extension.id,
        trustStatus: extension.trustStatus,
        approvedCapabilities: extension.approvedCapabilities,
      },
    );
    setExtensionRecordHeaders(context, extension);
    return context.json(extension);
  });

  app.post("/api/extensions/:extensionId/enabled", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(
        context.req.raw,
        MAX_EXTENSION_ADMIN_REQUEST_BYTES,
        "Extension enablement request",
      );
    } catch (error) {
      return jsonError(
        context,
        errorMessage(error),
        error instanceof RequestBodyTooLargeError ? 413 : 400,
      );
    }
    const body = parseSetExtensionEnabledRequest(input);
    if (!body) {
      return jsonError(context, "Extension enablement request is invalid", 400);
    }
    if (body.threadId) services.store.getThread(body.threadId);
    const extension = await services.store.setExtensionEnabled(
      context.req.param("extensionId"),
      body.agentId,
      body.enabled,
    );
    await appendExtensionEvent(
      services,
      body.threadId,
      body.enabled ? "extension.enabled" : "extension.disabled",
      {
        extensionId: extension.id,
        agentId: body.agentId,
        enabled: body.enabled,
      },
    );
    setExtensionRecordHeaders(context, extension);
    return context.json(extension);
  });

  app.post("/api/extensions/:extensionId/connect", async (context) => {
    let input: unknown;
    try {
      input = await readOptionalLimitedJson(
        context.req.raw,
        MAX_EXTENSION_ADMIN_REQUEST_BYTES,
        "Extension connect request",
      );
    } catch (error) {
      return jsonError(
        context,
        errorMessage(error),
        error instanceof RequestBodyTooLargeError ? 413 : 400,
      );
    }
    const body = parseExtensionThreadContextRequest(input);
    if (!body) {
      return jsonError(context, "Extension connect request is invalid", 400);
    }
    if (body?.threadId) services.store.getThread(body.threadId);
    const extension = await services.extensions.connect(
      context.req.param("extensionId"),
    );
    await appendExtensionEvent(
      services,
      body?.threadId,
      "extension.connected",
      {
        extensionId: extension.id,
        toolCount: extension.tools.length,
        status: extension.connection.status,
      },
    );
    setExtensionRecordHeaders(context, extension);
    return context.json(extension);
  });

  app.post("/api/extensions/:extensionId/disconnect", async (context) => {
    let input: unknown;
    try {
      input = await readOptionalLimitedJson(
        context.req.raw,
        MAX_EXTENSION_ADMIN_REQUEST_BYTES,
        "Extension disconnect request",
      );
    } catch (error) {
      return jsonError(
        context,
        errorMessage(error),
        error instanceof RequestBodyTooLargeError ? 413 : 400,
      );
    }
    const body = parseExtensionThreadContextRequest(input);
    if (!body) {
      return jsonError(context, "Extension disconnect request is invalid", 400);
    }
    if (body?.threadId) services.store.getThread(body.threadId);
    const extension = await services.extensions.disconnect(
      context.req.param("extensionId"),
    );
    await appendExtensionEvent(
      services,
      body?.threadId,
      "extension.disconnected",
      {
        extensionId: extension.id,
        status: extension.connection.status,
      },
    );
    setExtensionRecordHeaders(context, extension);
    return context.json(extension);
  });

  app.post("/api/extensions/:extensionId/tools/review", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(
        context.req.raw,
        MAX_EXTENSION_ADMIN_REQUEST_BYTES,
        "MCP tool review request",
      );
    } catch (error) {
      return jsonError(
        context,
        errorMessage(error),
        error instanceof RequestBodyTooLargeError ? 413 : 400,
      );
    }
    const body = parseReviewMcpToolRequest(input);
    if (!body) {
      return jsonError(context, "MCP tool review request is invalid", 400);
    }
    if (body.threadId) services.store.getThread(body.threadId);
    const extension = await services.store.reviewMcpTool(
      context.req.param("extensionId"),
      body.toolName,
      body,
    );
    const tool = extension.tools.find(
      (candidate) =>
        candidate.name === body.toolName ||
        candidate.directName === body.toolName,
    );
    await appendExtensionEvent(
      services,
      body.threadId,
      `extension.tool.${body.action === "approve" ? "approved" : "rejected"}`,
      {
        extensionId: extension.id,
        toolName: tool?.name ?? body.toolName,
        directName: tool?.directName ?? "",
        reviewStatus: tool?.reviewStatus ?? "missing",
        effect: tool?.effect ?? "unknown",
        schemaSha256: tool?.schemaSha256 ?? "",
      },
    );
    setExtensionRecordHeaders(context, extension);
    return context.json(extension);
  });

  app.post("/api/threads/:threadId/branches", async (context) => {
    const sourceThreadId = context.req.param("threadId");
    let input: unknown;
    try {
      input = await readLimitedJson(
        context.req.raw,
        MAX_BRANCH_REQUEST_BYTES,
        "Thread branch request",
      );
    } catch (error) {
      return jsonError(
        context,
        errorMessage(error),
        error instanceof RequestBodyTooLargeError ? 413 : 400,
      );
    }
    const body = parseCreateBranchRequest(input);
    if (!body) {
      return jsonError(context, "Thread branch request is invalid", 400);
    }
    try {
      const { detail } = await createThreadBranch(
        services.store,
        sourceThreadId,
        body,
      );
      setThreadDetailProjectionHeaders(context, detail);
      return context.json(detail, 201);
    } catch (error) {
      if (error instanceof ThreadBranchRequestError) {
        return jsonError(context, error.message, 400);
      }
      throw error;
    }
  });

  app.get(
    "/api/threads/:threadId/runs/:runId/control-messages",
    async (context) => {
      const threadId = context.req.param("threadId");
      const runId = context.req.param("runId");
      const run = services.store
        .listRuns(threadId)
        .find((candidate) => candidate.id === runId);
      if (!run) return jsonError(context, `Run not found: ${runId}`, 404);
      const messages = await services.store.listRunControlMessages(
        threadId,
        runId,
      );
      setRunControlMessageListHeaders(context, threadId, runId, messages);
      return context.json(messages);
    },
  );

  app.post(
    "/api/threads/:threadId/runs/:runId/control-messages",
    async (context) => {
      const threadId = context.req.param("threadId");
      const runId = context.req.param("runId");
      let input: unknown;
      try {
        input = await readLimitedJson(
          context.req.raw,
          MAX_RUN_CONTROL_MESSAGE_REQUEST_BYTES,
          "Run control message request",
        );
      } catch (error) {
        return jsonError(
          context,
          errorMessage(error),
          error instanceof RequestBodyTooLargeError ? 413 : 400,
        );
      }
      const body = parseQueueRunControlMessageRequest(input);
      if (!body) {
        return jsonError(
          context,
          "Run control message request is invalid",
          400,
        );
      }
      try {
        const message = await services.store.queueRunControlMessage({
          threadId,
          runId,
          mode: body.mode,
          text: body.text,
        });
        setRunControlMessageHeaders(context, message);
        return context.json(message, 202);
      } catch (error) {
        return jsonError(
          context,
          errorMessage(error),
          runControlMessageErrorStatus(error),
        );
      }
    },
  );

  app.post(
    "/api/threads/:threadId/runs/:runId/control-messages/:controlMessageId/cancel",
    async (context) => {
      const threadId = context.req.param("threadId");
      const runId = context.req.param("runId");
      const controlMessageId = context.req.param("controlMessageId");
      try {
        const message = await services.store.cancelRunControlMessage(
          threadId,
          runId,
          controlMessageId,
        );
        setRunControlMessageHeaders(context, message);
        return context.json(message);
      } catch (error) {
        return jsonError(
          context,
          errorMessage(error),
          runControlMessageErrorStatus(error),
        );
      }
    },
  );

  app.get("/api/threads/:threadId/operator-decisions", async (context) => {
    const threadId = context.req.param("threadId");
    const decisions = await services.store.listOperatorDecisions(threadId);
    setOperatorDecisionListHeaders(context, threadId, decisions);
    return context.json(decisions);
  });

  app.get("/api/threads/:threadId/agent-milestones", async (context) => {
    const threadId = context.req.param("threadId");
    const milestones = await services.store.listAgentMilestones(threadId);
    setAgentMilestoneListHeaders(context, threadId, milestones);
    return context.json(milestones);
  });

  app.post(
    "/api/threads/:threadId/operator-decisions/:decisionId/answer",
    async (context) => {
      const threadId = context.req.param("threadId");
      const decisionId = context.req.param("decisionId");
      let input: unknown;
      try {
        input = await readLimitedJson(
          context.req.raw,
          MAX_OPERATOR_DECISION_REQUEST_BYTES,
          "Operator decision answer request",
        );
      } catch (error) {
        return jsonError(
          context,
          errorMessage(error),
          error instanceof RequestBodyTooLargeError ? 413 : 400,
        );
      }
      const body = parseAnswerOperatorDecisionRequest(input);
      if (!body) {
        return jsonError(
          context,
          "Operator decision answer request is invalid",
          400,
        );
      }
      try {
        const mutation = await services.store.answerOperatorDecision(
          threadId,
          decisionId,
          body,
        );
        setOperatorDecisionHeaders(context, mutation.decision);
        return context.json(mutation.decision, 202);
      } catch (error) {
        return jsonError(
          context,
          errorMessage(error),
          operatorDecisionErrorStatus(error),
        );
      }
    },
  );

  app.post(
    "/api/threads/:threadId/operator-decisions/:decisionId/cancel",
    async (context) => {
      const threadId = context.req.param("threadId");
      const decisionId = context.req.param("decisionId");
      try {
        const mutation = await services.store.cancelOperatorDecision(
          threadId,
          decisionId,
        );
        setOperatorDecisionHeaders(context, mutation.decision);
        return context.json(mutation.decision);
      } catch (error) {
        return jsonError(
          context,
          errorMessage(error),
          operatorDecisionErrorStatus(error),
        );
      }
    },
  );

  app.post(
    "/api/threads/:threadId/operator-decisions/:decisionId/continue",
    (context) => {
      const threadId = context.req.param("threadId");
      const decisionId = context.req.param("decisionId");
      setOperatorDecisionContinueStreamHeaders(context, threadId, decisionId);
      return streamSSE(context, async (stream) => {
        const writeFrame = async (
          frame: StreamFrame,
          id?: string,
        ): Promise<void> => {
          await stream.writeSSE({
            event: frame.type,
            data: JSON.stringify(frame),
            ...(id ? { id } : {}),
          });
        };
        try {
          const run = await services.runtime.continueOperatorDecision({
            threadId,
            decisionId,
            onEvent: async (event) => {
              await writeFrame(streamEventFrame(event), String(event.seq));
            },
          });
          const snapshotFrame = streamSnapshotFrame(
            await services.store.getDetail(threadId),
          );
          const doneFrame = streamRunDoneFrame(
            threadId,
            run.id,
            run.status,
            snapshotFrame.detailSha256,
            snapshotFrame.detailBytes,
            snapshotFrame.detail.thread.eventCount,
            snapshotFrame.eventBytes,
            hashEventStream(snapshotFrame.detail.events),
          );
          await writeFrame(snapshotFrame);
          await writeFrame(doneFrame);
        } catch (error) {
          await writeFrame(streamRunErrorFrame(threadId, error));
        }
      });
    },
  );

  app.post("/api/threads/:threadId/stop", (context) => {
    const threadId = context.req.param("threadId");
    const receipt = { stopped: services.runtime.stop(threadId) };
    setThreadStopHeaders(context, threadId, receipt);
    return context.json(receipt, receipt.stopped ? 202 : 409);
  });

  app.post("/api/threads/:threadId/resume", async (context) => {
    const threadId = context.req.param("threadId");
    let input: unknown;
    try {
      input = await readOptionalLimitedJson(
        context.req.raw,
        MAX_RESUME_REQUEST_BYTES,
        "Resume request",
      );
    } catch (error) {
      return jsonError(
        context,
        errorMessage(error),
        error instanceof RequestBodyTooLargeError ? 413 : 400,
      );
    }
    const body = parseResumeRunRequest(input);
    if (!body) {
      return jsonError(context, "Resume request is invalid", 400);
    }
    if (body.model) {
      try {
        await assertAvailableModel(services, body.model);
      } catch (error) {
        return jsonError(context, errorMessage(error), 400);
      }
    }
    setThreadResumeStreamHeaders(context, threadId, body.runId, body.model);
    return streamSSE(context, async (stream) => {
      const writeFrame = async (
        frame: StreamFrame,
        id?: string,
      ): Promise<void> => {
        await stream.writeSSE({
          event: frame.type,
          data: JSON.stringify(frame),
          ...(id ? { id } : {}),
        });
      };
      try {
        const run = await services.runtime.resumeInterruptedRun({
          threadId,
          ...(body.runId ? { runId: body.runId } : {}),
          ...(body.model ? { model: body.model } : {}),
          onEvent: async (event) => {
            await writeFrame(streamEventFrame(event), String(event.seq));
          },
        });
        const snapshotFrame = streamSnapshotFrame(
          await services.store.getDetail(threadId),
        );
        const doneFrame = streamRunDoneFrame(
          threadId,
          run.id,
          run.status,
          snapshotFrame.detailSha256,
          snapshotFrame.detailBytes,
          snapshotFrame.detail.thread.eventCount,
          snapshotFrame.eventBytes,
          hashEventStream(snapshotFrame.detail.events),
        );
        await writeFrame(snapshotFrame);
        await writeFrame(doneFrame);
      } catch (error) {
        await writeFrame(streamRunErrorFrame(threadId, error));
      }
    });
  });

  app.post("/api/threads/:threadId/messages", async (context) => {
    const threadId = context.req.param("threadId");
    let input: unknown;
    try {
      input = await readLimitedJson(
        context.req.raw,
        MAX_PROMPT_REQUEST_BYTES,
        "Prompt request",
      );
    } catch (error) {
      return jsonError(
        context,
        errorMessage(error),
        error instanceof RequestBodyTooLargeError ? 413 : 400,
      );
    }
    const body = parsePromptRequest(input);
    if (!body) {
      return jsonError(context, "Prompt request is invalid", 400);
    }
    if (body.model) {
      try {
        await assertAvailableModel(services, body.model);
      } catch (error) {
        return jsonError(context, errorMessage(error), 400);
      }
    }
    setThreadPromptStreamHeaders(context, threadId, body.model);

    return streamSSE(context, async (stream) => {
      const writeFrame = async (
        frame: StreamFrame,
        id?: string,
      ): Promise<void> => {
        await stream.writeSSE({
          event: frame.type,
          data: JSON.stringify(frame),
          ...(id ? { id } : {}),
        });
      };
      try {
        const run = await services.runtime.runPrompt({
          threadId,
          text: body.text,
          ...(body.model ? { model: body.model } : {}),
          onEvent: async (event) => {
            await writeFrame(streamEventFrame(event), String(event.seq));
          },
        });
        const snapshotFrame = streamSnapshotFrame(
          await services.store.getDetail(threadId),
        );
        const doneFrame = streamRunDoneFrame(
          threadId,
          run.id,
          run.status,
          snapshotFrame.detailSha256,
          snapshotFrame.detailBytes,
          snapshotFrame.detail.thread.eventCount,
          snapshotFrame.eventBytes,
          hashEventStream(snapshotFrame.detail.events),
        );
        await writeFrame(snapshotFrame);
        await writeFrame(doneFrame);
      } catch (error) {
        await writeFrame(streamRunErrorFrame(threadId, error));
      }
    });
  });

  app.post("/api/threads/:threadId/workflows", (context) =>
    executeWorkflowHttp(context, services, {
      readJson: readLimitedJson,
      jsonError: (target, message, status) =>
        jsonError(target, message, status),
      isBodyTooLarge: (error) => error instanceof RequestBodyTooLargeError,
    }),
  );

  app.post("/api/threads/:threadId/agent-experiments/preview", (context) =>
    previewAgentMessageExperimentHttp(context, services, {
      readJson: readLimitedJson,
      jsonError: (target, message, status) =>
        jsonError(target, message, status),
      isBodyTooLarge: (error) => error instanceof RequestBodyTooLargeError,
    }),
  );

  app.post("/api/threads/:threadId/agent-experiments", (context) =>
    executeAgentMessageExperimentHttp(context, services, {
      readJson: readLimitedJson,
      jsonError: (target, message, status) =>
        jsonError(target, message, status),
      isBodyTooLarge: (error) => error instanceof RequestBodyTooLargeError,
    }),
  );

  app.post(
    "/api/threads/:threadId/model-invocation-experiments/preview",
    (context) =>
      previewModelInvocationExperimentHttp(context, services, {
        readJson: readLimitedJson,
        jsonError: (target, message, status) =>
          jsonError(target, message, status),
        isBodyTooLarge: (error) => error instanceof RequestBodyTooLargeError,
      }),
  );

  app.post("/api/threads/:threadId/model-invocation-experiments", (context) =>
    executeModelInvocationExperimentHttp(context, services, {
      readJson: readLimitedJson,
      jsonError: (target, message, status) =>
        jsonError(target, message, status),
      isBodyTooLarge: (error) => error instanceof RequestBodyTooLargeError,
    }),
  );

  app.post(
    "/api/threads/:threadId/workflows/:planId/experiments/preview",
    (context) =>
      previewWorkflowExperimentHttp(context, services, {
        readJson: readLimitedJson,
        jsonError: (target, message, status) =>
          jsonError(target, message, status),
        isBodyTooLarge: (error) => error instanceof RequestBodyTooLargeError,
      }),
  );

  app.post("/api/threads/:threadId/workflows/:planId/experiments", (context) =>
    executeWorkflowExperimentHttp(context, services, {
      readJson: readLimitedJson,
      jsonError: (target, message, status) =>
        jsonError(target, message, status),
      isBodyTooLarge: (error) => error instanceof RequestBodyTooLargeError,
    }),
  );

  app.notFound((context) => {
    const pathname = new URL(context.req.url).pathname;
    if (pathname === "/api" || pathname.startsWith("/api/")) {
      return jsonError(context, `API route not found: ${pathname}`, 404);
    }
    return context.text("Not Found", 404);
  });

  app.onError((error, context) => {
    const status = error.message.includes("not found")
      ? 404
      : isReceiptTrustConflict(error)
        ? 409
        : isExtensionPackageConflict(error)
          ? 409
          : isSkillPackageConflict(error)
            ? 409
            : isSkillContentConflict(error)
              ? 409
              : isPlanConflict(error)
                ? 409
                : isReceiptTrustClientError(error)
                  ? 400
                  : isExtensionPackageClientError(error)
                    ? 400
                    : isSkillContentClientError(error)
                      ? 400
                      : isPlanClientError(error)
                        ? 400
                        : 500;
    return jsonError(context, error.message, status);
  });

  return app;
}

export async function readProductionIndex(): Promise<string | undefined> {
  try {
    return await readFile(
      path.resolve(process.cwd(), "apps/web/dist/index.html"),
      "utf8",
    );
  } catch {
    return undefined;
  }
}

function normalizeTitle(title?: string): string {
  const normalized = title?.replace(/\s+/g, " ").trim();
  return normalized ? normalized.slice(0, 100) : "Untitled ledger";
}

function assertPlanThread(
  services: NapierServices,
  planId: string,
  threadId: string,
): void {
  const plan = services.store.getPlan(planId);
  if (plan.threadId !== threadId) {
    throw new Error(`Plan not found in thread: ${planId}`);
  }
}

function planStepEventSuffix(
  action: TransitionPlanStepRequest["action"],
): string {
  if (action === "start") return "started";
  if (action === "complete") return "completed";
  if (action === "block") return "blocked";
  if (action === "skip") return "skipped";
  return "reopened";
}

function parseVerifyUsagePriceTableCatalogRequest(
  input: unknown,
): VerifyUsagePriceTableCatalogRequest | undefined {
  if (!input || Array.isArray(input) || typeof input !== "object") {
    return undefined;
  }
  const record = input as Record<string, unknown>;
  const catalog = record["catalog"];
  if (!catalog || Array.isArray(catalog) || typeof catalog !== "object") {
    return undefined;
  }
  const requiredProviders = record["requiredProviders"];
  if (requiredProviders === undefined) {
    return {
      catalog: catalog as VerifyUsagePriceTableCatalogRequest["catalog"],
    };
  }
  if (
    !Array.isArray(requiredProviders) ||
    requiredProviders.length > 20 ||
    !requiredProviders.every(
      (provider) =>
        typeof provider === "string" &&
        /^[a-zA-Z0-9][a-zA-Z0-9._-]{1,80}$/.test(provider),
    )
  ) {
    return undefined;
  }
  return {
    catalog: catalog as VerifyUsagePriceTableCatalogRequest["catalog"],
    requiredProviders,
  };
}

function parseImportThreadReplayBundleRequest(
  input: unknown,
): ImportThreadReplayBundleRequest | undefined {
  const record = requestRecord(input, ["bundle", "title"]);
  if (!record || record["bundle"] === undefined) return undefined;
  const title = record["title"];
  const normalizedTitle =
    typeof title === "string" ? title.replace(/\s+/g, " ").trim() : undefined;
  if (
    title !== undefined &&
    (!normalizedTitle || !boundedString(normalizedTitle, 1, 100))
  ) {
    return undefined;
  }
  return {
    bundle: record["bundle"] as ThreadReplayBundle,
    ...(normalizedTitle ? { title: normalizedTitle } : {}),
  };
}

function parseVerifyThreadReplayBundleRequest(
  input: unknown,
): VerifyThreadReplayBundleRequest | undefined {
  const record = requestRecord(input, ["bundle"]);
  if (!record || record["bundle"] === undefined) return undefined;
  return {
    bundle: record["bundle"] as ThreadReplayBundle,
  };
}

function parseVerifyRunReplaySnapshotRequest(
  input: unknown,
): VerifyRunReplaySnapshotRequest | undefined {
  const record = requestRecord(input, ["snapshot"]);
  if (!record || record["snapshot"] === undefined) return undefined;
  return {
    snapshot: record["snapshot"] as RunReplaySnapshot,
  };
}

function parseVerifyOpenTelemetryTraceArtifactRequest(
  input: unknown,
): VerifyOpenTelemetryTraceArtifactRequest | undefined {
  const record = requestRecord(input, ["artifact"]);
  if (!record || record["artifact"] === undefined) return undefined;
  return {
    artifact: record["artifact"] as OpenTelemetryTraceArtifact,
  };
}

function parseCreateThreadRequest(
  input: unknown,
): CreateThreadRequest | undefined {
  if (input === undefined) return {};
  const record = requestRecord(input, ["title", "agentId"]);
  if (!record) return undefined;
  const title = record["title"];
  const normalizedTitle =
    typeof title === "string" ? title.replace(/\s+/g, " ").trim() : undefined;
  if (
    title !== undefined &&
    (!normalizedTitle || !boundedString(normalizedTitle, 1, 100))
  ) {
    return undefined;
  }
  const agentId = record["agentId"];
  if (agentId !== undefined && !validAgentId(agentId)) return undefined;
  return {
    ...(normalizedTitle ? { title: normalizedTitle } : {}),
    ...(typeof agentId === "string" ? { agentId } : {}),
  };
}

function parseCreateBranchRequest(
  input: unknown,
): CreateBranchRequest | undefined {
  const record = requestRecord(input, ["fromSeq", "title"]);
  const fromSeq = record?.["fromSeq"];
  const title = record?.["title"];
  const normalizedTitle =
    typeof title === "string" ? title.replace(/\s+/g, " ").trim() : undefined;
  if (
    !record ||
    typeof fromSeq !== "number" ||
    !Number.isSafeInteger(fromSeq) ||
    fromSeq < 1 ||
    (title !== undefined &&
      (!normalizedTitle || !boundedString(normalizedTitle, 1, 100)))
  ) {
    return undefined;
  }
  return {
    fromSeq,
    ...(normalizedTitle ? { title: normalizedTitle } : {}),
  };
}

function parseSetGoalRequest(input: unknown): SetGoalRequest | undefined {
  const record = requestRecord(input, ["objective", "maxContinuations"]);
  const objective =
    typeof record?.["objective"] === "string"
      ? record["objective"].replace(/\s+/g, " ").trim()
      : undefined;
  const maxContinuations = record?.["maxContinuations"];
  if (!objective || !boundedString(objective, 1, 4_000)) return undefined;
  if (
    maxContinuations !== undefined &&
    (typeof maxContinuations !== "number" ||
      !Number.isInteger(maxContinuations) ||
      maxContinuations < 0 ||
      maxContinuations > 8)
  ) {
    return undefined;
  }
  return {
    objective,
    ...(typeof maxContinuations === "number" ? { maxContinuations } : {}),
  };
}

function parseResumeRunRequest(input: unknown): ResumeRunRequest | undefined {
  if (input === undefined) return {};
  const record = requestRecord(input, ["runId", "model"]);
  if (!record) return undefined;
  const runId = record["runId"];
  if (runId !== undefined && !validRunId(runId)) return undefined;
  const model =
    record["model"] === undefined ? undefined : parseModelRef(record["model"]);
  if (record["model"] !== undefined && !model) return undefined;
  return {
    ...(typeof runId === "string" ? { runId } : {}),
    ...(model ? { model } : {}),
  };
}

function parsePromptRequest(input: unknown): PromptRequest | undefined {
  const record = requestRecord(input, ["text", "model"]);
  if (!record || !boundedString(record["text"], 1, 60_000)) return undefined;
  if (!record["text"].trim()) return undefined;
  const model =
    record["model"] === undefined ? undefined : parseModelRef(record["model"]);
  if (record["model"] !== undefined && !model) return undefined;
  return {
    text: record["text"],
    ...(model ? { model } : {}),
  };
}

function parseQueueRunControlMessageRequest(
  input: unknown,
): QueueRunControlMessageRequest | undefined {
  const record = requestRecord(input, ["mode", "text"]);
  const mode = record?.["mode"];
  const text =
    typeof record?.["text"] === "string" ? record["text"].trim() : undefined;
  if (
    (mode !== "steering" && mode !== "follow_up") ||
    !text ||
    Buffer.byteLength(text, "utf8") > MAX_RUN_CONTROL_MESSAGE_BYTES
  ) {
    return undefined;
  }
  return { mode, text };
}

function parseAnswerOperatorDecisionRequest(
  input: unknown,
): AnswerOperatorDecisionRequest | undefined {
  const record = requestRecord(input, ["selectedOptionIds", "customText"]);
  const selectedOptionIds = record?.["selectedOptionIds"];
  const customText =
    typeof record?.["customText"] === "string"
      ? record["customText"].trim()
      : undefined;
  if (
    !Array.isArray(selectedOptionIds) ||
    selectedOptionIds.length > 4 ||
    selectedOptionIds.some(
      (optionId) =>
        typeof optionId !== "string" || !/^option_[1-4]$/.test(optionId),
    ) ||
    new Set(selectedOptionIds).size !== selectedOptionIds.length ||
    (record?.["customText"] !== undefined &&
      typeof record["customText"] !== "string") ||
    (customText !== undefined &&
      Buffer.byteLength(customText, "utf8") > 4 * 1024) ||
    (selectedOptionIds.length === 0 && !customText)
  ) {
    return undefined;
  }
  return {
    selectedOptionIds,
    ...(customText ? { customText } : {}),
  };
}

function parseModelRef(input: unknown): PromptRequest["model"] | undefined {
  const record = requestRecord(input, ["provider", "id"]);
  const provider =
    typeof record?.["provider"] === "string"
      ? record["provider"].trim().toLowerCase()
      : undefined;
  const id =
    typeof record?.["id"] === "string" ? record["id"].trim() : undefined;
  if (
    !provider ||
    !id ||
    !/^[a-z0-9][a-z0-9._-]{1,80}$/.test(provider) ||
    !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/.test(id)
  ) {
    return undefined;
  }
  return { provider, id };
}

function parseReviewSubagentOutcomeRequest(
  input: unknown,
): ReviewSubagentOutcomeRequest | undefined {
  const record = requestRecord(input, ["model"]);
  const model = parseModelRef(record?.["model"]);
  return record && model ? { model } : undefined;
}

function parseUpdateAgentProfileRequest(
  input: unknown,
): UpdateAgentProfileRequest | undefined {
  const record = requestRecord(input, [
    "name",
    "description",
    "systemPrompt",
    "model",
    "thinkingLevel",
    "toolPolicy",
    "enabledTools",
    "enabledSkills",
    "enabledSubagents",
    "subagentLimits",
    "runLimits",
    "automaticRecovery",
    "modelAdvisor",
    "promptVariables",
    "toolLoopGuard",
    "threadId",
  ]);
  if (!record) return undefined;
  const name =
    record["name"] === undefined
      ? undefined
      : normalizeBoundedText(record["name"], 1, 80);
  const description =
    record["description"] === undefined
      ? undefined
      : normalizeBoundedText(record["description"], 1, 500);
  const systemPrompt =
    record["systemPrompt"] === undefined
      ? undefined
      : normalizeBoundedPrompt(record["systemPrompt"], 12_000);
  const model =
    record["model"] === undefined ? undefined : parseModelRef(record["model"]);
  const thinkingLevel = parseThinkingLevel(record["thinkingLevel"]);
  const toolPolicy = parseToolPolicy(record["toolPolicy"]);
  const enabledTools =
    record["enabledTools"] === undefined
      ? undefined
      : parseEnabledTools(record["enabledTools"]);
  const enabledSkills =
    record["enabledSkills"] === undefined
      ? undefined
      : parseAgentNameArray(record["enabledSkills"], 128);
  const enabledSubagents =
    record["enabledSubagents"] === undefined
      ? undefined
      : parseEnabledSubagents(record["enabledSubagents"]);
  const subagentLimits =
    record["subagentLimits"] === undefined
      ? undefined
      : parseSubagentLimits(record["subagentLimits"]);
  const runLimits =
    record["runLimits"] === undefined
      ? undefined
      : parseRunLimits(record["runLimits"]);
  const automaticRecovery =
    record["automaticRecovery"] === undefined
      ? undefined
      : parseAutomaticRecoveryPolicy(record["automaticRecovery"]);
  const modelAdvisor =
    record["modelAdvisor"] === undefined
      ? undefined
      : parseModelAdvisorPolicy(record["modelAdvisor"]);
  const promptVariables =
    record["promptVariables"] === undefined
      ? undefined
      : parsePromptVariableDefinitions(record["promptVariables"]);
  const toolLoopGuard =
    record["toolLoopGuard"] === undefined
      ? undefined
      : parseToolLoopGuardPolicy(record["toolLoopGuard"]);
  const threadId = record["threadId"];
  if (
    (record["name"] !== undefined && !name) ||
    (record["description"] !== undefined && !description) ||
    (record["systemPrompt"] !== undefined && !systemPrompt) ||
    (record["model"] !== undefined && !model) ||
    (record["thinkingLevel"] !== undefined && !thinkingLevel) ||
    (record["toolPolicy"] !== undefined && !toolPolicy) ||
    (record["enabledTools"] !== undefined && !enabledTools) ||
    (record["enabledSkills"] !== undefined && !enabledSkills) ||
    (record["enabledSubagents"] !== undefined && !enabledSubagents) ||
    (record["subagentLimits"] !== undefined && !subagentLimits) ||
    (record["runLimits"] !== undefined && !runLimits) ||
    (record["automaticRecovery"] !== undefined && !automaticRecovery) ||
    (record["modelAdvisor"] !== undefined && !modelAdvisor) ||
    (record["promptVariables"] !== undefined &&
      promptVariables === undefined) ||
    (record["toolLoopGuard"] !== undefined && toolLoopGuard === undefined) ||
    (threadId !== undefined && !validThreadId(threadId))
  ) {
    return undefined;
  }
  return {
    ...(name ? { name } : {}),
    ...(description ? { description } : {}),
    ...(systemPrompt ? { systemPrompt } : {}),
    ...(model ? { model } : {}),
    ...(thinkingLevel ? { thinkingLevel } : {}),
    ...(toolPolicy ? { toolPolicy } : {}),
    ...(enabledTools ? { enabledTools } : {}),
    ...(enabledSkills ? { enabledSkills } : {}),
    ...(enabledSubagents ? { enabledSubagents } : {}),
    ...(subagentLimits ? { subagentLimits } : {}),
    ...(runLimits ? { runLimits } : {}),
    ...(automaticRecovery ? { automaticRecovery } : {}),
    ...(modelAdvisor ? { modelAdvisor } : {}),
    ...(promptVariables !== undefined ? { promptVariables } : {}),
    ...(toolLoopGuard !== undefined ? { toolLoopGuard } : {}),
    ...(typeof threadId === "string" ? { threadId } : {}),
  };
}

function parseToolLoopGuardPolicy(
  input: unknown,
): ToolLoopGuardPolicy | undefined {
  try {
    return normalizeToolLoopGuardPolicy(input as ToolLoopGuardPolicy);
  } catch {
    return undefined;
  }
}

function parsePromptVariableDefinitions(
  input: unknown,
): PromptVariableDefinition[] | undefined {
  if (!Array.isArray(input)) return undefined;
  try {
    return normalizePromptVariableDefinitions(
      input as PromptVariableDefinition[],
    );
  } catch {
    return undefined;
  }
}

function parseModelAdvisorPolicy(
  input: unknown,
): UpdateAgentProfileRequest["modelAdvisor"] | undefined {
  const record = requestRecord(input, [
    "mode",
    "enabledRules",
    "maxCorrectionAttempts",
    "reviewModel",
  ]);
  const mode = record?.["mode"];
  const enabledRules = record?.["enabledRules"];
  const maxCorrectionAttempts = record?.["maxCorrectionAttempts"];
  const reviewModel =
    record?.["reviewModel"] === undefined
      ? undefined
      : parseModelRef(record["reviewModel"]);
  if (
    !record ||
    (mode !== "observe" && mode !== "enforce" && mode !== "off") ||
    !Array.isArray(enabledRules) ||
    enabledRules.length > 10 ||
    !enabledRules.every(
      (rule) =>
        rule === "unverified_verification_claim" ||
        rule === "destructive_command_reference",
    ) ||
    (maxCorrectionAttempts !== undefined &&
      (typeof maxCorrectionAttempts !== "number" ||
        !Number.isSafeInteger(maxCorrectionAttempts) ||
        maxCorrectionAttempts < 0 ||
        maxCorrectionAttempts > 3)) ||
    (record["reviewModel"] !== undefined && !reviewModel)
  ) {
    return undefined;
  }
  return {
    mode,
    enabledRules,
    ...(typeof maxCorrectionAttempts === "number"
      ? { maxCorrectionAttempts }
      : {}),
    ...(reviewModel ? { reviewModel } : {}),
  };
}

function parseRollbackAgentProfileRequest(
  input: unknown,
): RollbackAgentProfileRequest | undefined {
  const record = requestRecord(input, ["revision", "threadId"]);
  const revision = record?.["revision"];
  const threadId = record?.["threadId"];
  return record &&
    typeof revision === "number" &&
    Number.isSafeInteger(revision) &&
    revision >= 1 &&
    validThreadId(threadId)
    ? { revision, threadId }
    : undefined;
}

function parseThinkingLevel(
  input: unknown,
): UpdateAgentProfileRequest["thinkingLevel"] | undefined {
  return input === "off" ||
    input === "minimal" ||
    input === "low" ||
    input === "medium" ||
    input === "high"
    ? input
    : undefined;
}

function parseToolPolicy(
  input: unknown,
): UpdateAgentProfileRequest["toolPolicy"] | undefined {
  return input === "observe" ||
    input === "workspace" ||
    input === "unrestricted"
    ? input
    : undefined;
}

function parseEnabledTools(input: unknown): string[] | undefined {
  const allowed: ReadonlySet<string> = new Set(AGENT_TOOL_NAMES);
  if (
    !Array.isArray(input) ||
    input.length > allowed.size ||
    input.some((value) => typeof value !== "string" || !allowed.has(value))
  ) {
    return undefined;
  }
  const unique = new Set(input);
  return unique.size === input.length ? [...unique].sort() : undefined;
}

function parseAgentNameArray(
  input: unknown,
  maxItems: number,
): string[] | undefined {
  if (!Array.isArray(input) || input.length > maxItems) return undefined;
  const normalized: string[] = [];
  for (const value of input) {
    if (typeof value !== "string") return undefined;
    const item = value.trim().toLowerCase();
    if (!/^[a-z][a-z0-9_-]{0,63}$/.test(item)) return undefined;
    normalized.push(item);
  }
  const unique = new Set(normalized);
  return unique.size === normalized.length ? [...unique].sort() : undefined;
}

function parseEnabledSubagents(
  input: unknown,
): NonNullable<UpdateAgentProfileRequest["enabledSubagents"]> | undefined {
  if (!Array.isArray(input) || input.length > 3) return undefined;
  const allowed = new Set(["researcher", "reviewer", "general"]);
  if (input.some((value) => typeof value !== "string" || !allowed.has(value))) {
    return undefined;
  }
  const unique = new Set(input);
  return unique.size === input.length
    ? ([...unique].sort() as NonNullable<
        UpdateAgentProfileRequest["enabledSubagents"]
      >)
    : undefined;
}

function parseSubagentLimits(
  input: unknown,
): NonNullable<UpdateAgentProfileRequest["subagentLimits"]> | undefined {
  const record = requestRecord(input, [
    "maxConcurrent",
    "maxTotal",
    "maxTurns",
    "timeoutMs",
  ]);
  const maxConcurrent = parseBoundedInteger(record?.["maxConcurrent"], 1, 8);
  const maxTotal = parseBoundedInteger(record?.["maxTotal"], 1, 24);
  const maxTurns = parseBoundedInteger(record?.["maxTurns"], 1, 32);
  const timeoutMs = parseBoundedInteger(record?.["timeoutMs"], 1_000, 900_000);
  return record &&
    maxConcurrent !== undefined &&
    maxTotal !== undefined &&
    maxTurns !== undefined &&
    timeoutMs !== undefined
    ? { maxConcurrent, maxTotal, maxTurns, timeoutMs }
    : undefined;
}

function parseRunLimits(
  input: unknown,
): NonNullable<UpdateAgentProfileRequest["runLimits"]> | undefined {
  const record = requestRecord(input, [
    "maxTurns",
    "maxTotalTokens",
    "maxCostUsd",
    "timeoutMs",
  ]);
  const maxTurns = parseBoundedInteger(record?.["maxTurns"], 1, 128);
  const maxTotalTokens = parseBoundedInteger(
    record?.["maxTotalTokens"],
    1_000,
    10_000_000,
  );
  const maxCostUsd = parseBoundedFiniteNumber(
    record?.["maxCostUsd"],
    0.01,
    1_000,
  );
  const timeoutMs = parseBoundedInteger(
    record?.["timeoutMs"],
    10_000,
    3_600_000,
  );
  return record &&
    maxTurns !== undefined &&
    maxTotalTokens !== undefined &&
    maxCostUsd !== undefined &&
    timeoutMs !== undefined
    ? { maxTurns, maxTotalTokens, maxCostUsd, timeoutMs }
    : undefined;
}

function parseAutomaticRecoveryPolicy(
  input: unknown,
): NonNullable<UpdateAgentProfileRequest["automaticRecovery"]> | undefined {
  const record = requestRecord(input, ["mode", "maxAttempts", "backoffMs"]);
  const mode = record?.["mode"];
  const maxAttempts = parseBoundedInteger(record?.["maxAttempts"], 1, 3);
  const backoffMs = parseBoundedInteger(
    record?.["backoffMs"],
    1_000,
    3_600_000,
  );
  return record &&
    (mode === "manual" || mode === "safe_read_only") &&
    maxAttempts !== undefined &&
    backoffMs !== undefined
    ? { mode, maxAttempts, backoffMs }
    : undefined;
}

function parseBoundedInteger(
  input: unknown,
  minimum: number,
  maximum: number,
): number | undefined {
  return typeof input === "number" &&
    Number.isInteger(input) &&
    input >= minimum &&
    input <= maximum
    ? input
    : undefined;
}

function parseBoundedFiniteNumber(
  input: unknown,
  minimum: number,
  maximum: number,
): number | undefined {
  return typeof input === "number" &&
    Number.isFinite(input) &&
    input >= minimum &&
    input <= maximum
    ? input
    : undefined;
}

function parseCreateMcpExtensionRequest(
  input: unknown,
): CreateMcpExtensionRequest | undefined {
  const record = requestRecord(input, [
    "name",
    "description",
    "version",
    "transport",
    "requestedCapabilities",
    "threadId",
  ]);
  const name = normalizeBoundedText(record?.["name"], 1, 80);
  const description =
    record?.["description"] === undefined
      ? undefined
      : normalizeBoundedText(record["description"], 0, 500);
  const version =
    record?.["version"] === undefined
      ? undefined
      : normalizeBoundedText(record["version"], 1, 64);
  const transport = parseMcpTransport(record?.["transport"]);
  const requestedCapabilities =
    record?.["requestedCapabilities"] === undefined
      ? undefined
      : parseExtensionCapabilities(record["requestedCapabilities"]);
  const threadId = record?.["threadId"];
  if (
    !record ||
    !name ||
    (record["description"] !== undefined && description === undefined) ||
    (record["version"] !== undefined && !version) ||
    !transport ||
    (record["requestedCapabilities"] !== undefined && !requestedCapabilities) ||
    (threadId !== undefined && !validThreadId(threadId))
  ) {
    return undefined;
  }
  return {
    name,
    ...(description ? { description } : {}),
    ...(version ? { version } : {}),
    transport,
    ...(requestedCapabilities ? { requestedCapabilities } : {}),
    ...(typeof threadId === "string" ? { threadId } : {}),
  };
}

function parseReviewExtensionRequest(
  input: unknown,
): ReviewExtensionRequest | undefined {
  const record = requestRecord(input, [
    "action",
    "approvedCapabilities",
    "note",
    "threadId",
  ]);
  const action = record?.["action"];
  const approvedCapabilities =
    record?.["approvedCapabilities"] === undefined
      ? undefined
      : parseExtensionCapabilities(record["approvedCapabilities"]);
  const note = parseOptionalBoundedText(record?.["note"], 500);
  const threadId = record?.["threadId"];
  if (
    !record ||
    (action !== "approve" && action !== "reject") ||
    (record["approvedCapabilities"] !== undefined && !approvedCapabilities) ||
    (record["note"] !== undefined && note === undefined) ||
    (threadId !== undefined && !validThreadId(threadId))
  ) {
    return undefined;
  }
  return {
    action,
    ...(approvedCapabilities ? { approvedCapabilities } : {}),
    ...(note ? { note } : {}),
    ...(typeof threadId === "string" ? { threadId } : {}),
  };
}

function parseSetExtensionEnabledRequest(
  input: unknown,
): SetExtensionEnabledRequest | undefined {
  const record = requestRecord(input, ["agentId", "enabled", "threadId"]);
  const agentId = record?.["agentId"];
  const enabled = record?.["enabled"];
  const threadId = record?.["threadId"];
  return record &&
    validAgentId(agentId) &&
    typeof enabled === "boolean" &&
    (threadId === undefined || validThreadId(threadId))
    ? {
        agentId,
        enabled,
        ...(typeof threadId === "string" ? { threadId } : {}),
      }
    : undefined;
}

function parseExtensionThreadContextRequest(
  input: unknown,
): { threadId?: string } | undefined {
  if (input === undefined) return {};
  const record = requestRecord(input, ["threadId"]);
  const threadId = record?.["threadId"];
  return record && (threadId === undefined || validThreadId(threadId))
    ? {
        ...(typeof threadId === "string" ? { threadId } : {}),
      }
    : undefined;
}

function parseReviewMcpToolRequest(
  input: unknown,
): (ReviewMcpToolRequest & { toolName: string }) | undefined {
  const record = requestRecord(input, [
    "toolName",
    "action",
    "effect",
    "routingHint",
    "note",
    "threadId",
  ]);
  const toolName = parseProcessText(record?.["toolName"], 1, 160);
  const action = record?.["action"];
  const effect = parseMcpToolEffect(record?.["effect"]);
  const routingHint =
    record?.["routingHint"] === undefined
      ? undefined
      : parseReviewedRoutingHint(record["routingHint"]);
  const note = parseOptionalBoundedText(record?.["note"], 500);
  const threadId = record?.["threadId"];
  if (
    !record ||
    !toolName ||
    (action !== "approve" && action !== "reject") ||
    (record["effect"] !== undefined && !effect) ||
    (record["routingHint"] !== undefined && !routingHint) ||
    (record["note"] !== undefined && note === undefined) ||
    (threadId !== undefined && !validThreadId(threadId))
  ) {
    return undefined;
  }
  return {
    toolName,
    action,
    ...(effect ? { effect } : {}),
    ...(routingHint ? { routingHint } : {}),
    ...(note ? { note } : {}),
    ...(typeof threadId === "string" ? { threadId } : {}),
  };
}

function parseMcpTransport(input: unknown): McpTransportConfig | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return undefined;
  }
  const type = (input as Record<string, unknown>)["type"];
  if (type === "streamable_http") {
    const record = requestRecord(input, ["type", "url", "headerEnv"]);
    const url = parseProcessText(record?.["url"], 1, 2_000);
    const headerEnv =
      record?.["headerEnv"] === undefined
        ? undefined
        : parseEnvironmentMap(record["headerEnv"], {
            keyPattern: /^[!#$%&'*+\-.^_`|~0-9A-Za-z]{1,128}$/,
          });
    if (!record || !url || (record["headerEnv"] !== undefined && !headerEnv)) {
      return undefined;
    }
    return {
      type,
      url,
      ...(headerEnv ? { headerEnv } : {}),
    };
  }
  if (type === "stdio") {
    const record = requestRecord(input, [
      "type",
      "command",
      "args",
      "cwd",
      "env",
    ]);
    const command = parseProcessText(record?.["command"], 1, 500);
    const args =
      record?.["args"] === undefined
        ? undefined
        : parseProcessTextArray(record["args"], 50, 1_000, true);
    const cwd =
      record?.["cwd"] === undefined
        ? undefined
        : parseProcessText(record["cwd"], 1, 1_000);
    const env =
      record?.["env"] === undefined
        ? undefined
        : parseEnvironmentMap(record["env"]);
    if (
      !record ||
      !command ||
      (record["args"] !== undefined && !args) ||
      (record["cwd"] !== undefined && !cwd) ||
      (record["env"] !== undefined && !env)
    ) {
      return undefined;
    }
    return {
      type,
      command,
      ...(args ? { args } : {}),
      ...(cwd ? { cwd } : {}),
      ...(env ? { env } : {}),
    };
  }
  return undefined;
}

function parseExtensionCapabilities(
  input: unknown,
): ExtensionCapability[] | undefined {
  if (!Array.isArray(input) || input.length > 7) return undefined;
  const output: ExtensionCapability[] = [];
  for (const value of input) {
    if (
      value !== "network.connect" &&
      value !== "secrets.env" &&
      value !== "process.spawn" &&
      value !== "workspace.read" &&
      value !== "workspace.write" &&
      value !== "external.read" &&
      value !== "external.write"
    ) {
      return undefined;
    }
    output.push(value);
  }
  const unique = new Set(output);
  return unique.size === output.length ? [...unique].sort() : undefined;
}

function parseMcpToolEffect(input: unknown): McpToolEffect | undefined {
  return input === "read" || input === "write" || input === "unknown"
    ? input
    : undefined;
}

function parseEnvironmentMap(
  input: unknown,
  options: { keyPattern?: RegExp } = {},
): Record<string, string> | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return undefined;
  }
  const entries = Object.entries(input as Record<string, unknown>);
  if (entries.length > 64) return undefined;
  const keyPattern = options.keyPattern ?? /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
  const output: Record<string, string> = {};
  for (const [key, value] of entries) {
    if (
      !keyPattern.test(key) ||
      typeof value !== "string" ||
      !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(value)
    ) {
      return undefined;
    }
    output[key] = value;
  }
  return output;
}

function parseProcessTextArray(
  input: unknown,
  maxItems: number,
  maxLength: number,
  allowEmpty = false,
): string[] | undefined {
  if (!Array.isArray(input) || input.length > maxItems) return undefined;
  const output: string[] = [];
  for (const value of input) {
    const item = parseProcessText(value, allowEmpty ? 0 : 1, maxLength);
    if (item === undefined) return undefined;
    output.push(item);
  }
  return output;
}

function parseProcessText(
  input: unknown,
  minLength: number,
  maxLength: number,
): string | undefined {
  if (typeof input !== "string" || /[\u0000-\u001f\u007f]/.test(input)) {
    return undefined;
  }
  const normalized = input.trim();
  return normalized.length >= minLength && normalized.length <= maxLength
    ? normalized
    : undefined;
}

function parseReviewedRoutingHint(input: unknown): string | undefined {
  if (typeof input !== "string") return undefined;
  const normalized = input.replace(/\s+/g, " ").trim();
  return normalized.length > 0 &&
    normalized.length <= 500 &&
    !/[\u0000-\u001f\u007f<>]/.test(normalized)
    ? normalized
    : undefined;
}

function parseCreateRunEvaluationRequest(
  input: unknown,
): CreateRunEvaluationRequest | undefined {
  const record = requestRecord(input, [
    "leftRunId",
    "rightRunId",
    "rubric",
    "model",
  ]);
  const leftRunId = record?.["leftRunId"];
  const rightRunId = record?.["rightRunId"];
  const rubric =
    record?.["rubric"] === undefined
      ? undefined
      : parseEvaluationRubric(record["rubric"]);
  const model =
    record?.["model"] === undefined
      ? undefined
      : parseModelRef(record["model"]);
  if (
    !record ||
    !validRunId(leftRunId) ||
    !validRunId(rightRunId) ||
    leftRunId === rightRunId ||
    (record["rubric"] !== undefined && !rubric) ||
    (record["model"] !== undefined && !model)
  ) {
    return undefined;
  }
  return {
    leftRunId,
    rightRunId,
    ...(rubric ? { rubric } : {}),
    ...(model ? { model } : {}),
  };
}

function parseReviewRunEvaluationRequest(
  input: unknown,
): ReviewRunEvaluationRequest | undefined {
  const record = requestRecord(input, ["expectedVerdict", "note"]);
  const expectedVerdict = parseRunEvaluationVerdict(
    record?.["expectedVerdict"],
  );
  const note = parseOptionalBoundedText(record?.["note"], 1_000);
  if (
    !record ||
    !expectedVerdict ||
    (record["note"] !== undefined && note === undefined)
  ) {
    return undefined;
  }
  return {
    expectedVerdict,
    ...(note ? { note } : {}),
  };
}

function parseCreateEvaluationSuiteRequest(
  input: unknown,
): CreateEvaluationSuiteRequest | undefined {
  const record = requestRecord(input, [
    "name",
    "baselineRunId",
    "candidateRunIds",
    "rubric",
    "model",
    "gate",
  ]);
  const name = normalizeBoundedText(record?.["name"], 1, 100);
  const baselineRunId = record?.["baselineRunId"];
  const candidateRunIds = parseRunIdArray(record?.["candidateRunIds"], 1, 8);
  const rubric =
    record?.["rubric"] === undefined
      ? undefined
      : parseEvaluationRubric(record["rubric"]);
  const model =
    record?.["model"] === undefined
      ? undefined
      : parseModelRef(record["model"]);
  const gate =
    record?.["gate"] === undefined
      ? undefined
      : parseEvaluationSuiteGate(record["gate"]);
  if (
    !record ||
    !name ||
    !validRunId(baselineRunId) ||
    !candidateRunIds ||
    candidateRunIds.includes(baselineRunId) ||
    (record["rubric"] !== undefined && !rubric) ||
    (record["model"] !== undefined && !model) ||
    (record["gate"] !== undefined && !gate)
  ) {
    return undefined;
  }
  return {
    name,
    baselineRunId,
    candidateRunIds,
    ...(rubric ? { rubric } : {}),
    ...(model ? { model } : {}),
    ...(gate ? { gate } : {}),
  };
}

function parseUpdateEvaluationSuiteRequest(
  input: unknown,
): UpdateEvaluationSuiteRequest | undefined {
  const record = requestRecord(input, [
    "name",
    "baselineRunId",
    "candidateRunIds",
    "rubric",
    "model",
    "gate",
  ]);
  if (!record) return undefined;
  const name =
    record["name"] === undefined
      ? undefined
      : normalizeBoundedText(record["name"], 1, 100);
  const baselineRunId = record["baselineRunId"];
  const candidateRunIds =
    record["candidateRunIds"] === undefined
      ? undefined
      : parseRunIdArray(record["candidateRunIds"], 1, 8);
  const rubric =
    record["rubric"] === undefined
      ? undefined
      : parseEvaluationRubric(record["rubric"]);
  const model =
    record["model"] === undefined ? undefined : parseModelRef(record["model"]);
  const gate =
    record["gate"] === undefined
      ? undefined
      : parseEvaluationSuiteGate(record["gate"]);
  if (
    (record["name"] !== undefined && !name) ||
    (baselineRunId !== undefined && !validRunId(baselineRunId)) ||
    (record["candidateRunIds"] !== undefined && !candidateRunIds) ||
    (typeof baselineRunId === "string" &&
      candidateRunIds?.includes(baselineRunId)) ||
    (record["rubric"] !== undefined && !rubric) ||
    (record["model"] !== undefined && !model) ||
    (record["gate"] !== undefined && !gate)
  ) {
    return undefined;
  }
  return {
    ...(name ? { name } : {}),
    ...(typeof baselineRunId === "string" ? { baselineRunId } : {}),
    ...(candidateRunIds ? { candidateRunIds } : {}),
    ...(rubric ? { rubric } : {}),
    ...(model ? { model } : {}),
    ...(gate ? { gate } : {}),
  };
}

function parseEvaluationRubric(
  input: unknown,
): NonNullable<CreateRunEvaluationRequest["rubric"]> | undefined {
  const record = requestRecord(input, ["name", "criteria"]);
  const name = normalizeBoundedText(record?.["name"], 1, 80);
  const criteria = record
    ? parseEvaluationCriteria(record["criteria"])
    : undefined;
  return record && name && criteria ? { name, criteria } : undefined;
}

function parseEvaluationCriteria(
  input: unknown,
): NonNullable<CreateRunEvaluationRequest["rubric"]>["criteria"] | undefined {
  if (!Array.isArray(input) || input.length < 2 || input.length > 6) {
    return undefined;
  }
  const output: NonNullable<CreateRunEvaluationRequest["rubric"]>["criteria"] =
    [];
  const seenIds = new Set<string>();
  const seenNames = new Set<string>();
  for (const value of input) {
    const record = requestRecord(value, ["id", "name", "description"]);
    const id =
      typeof record?.["id"] === "string"
        ? record["id"].trim().toLowerCase()
        : undefined;
    const name = normalizeBoundedText(record?.["name"], 1, 80);
    const description = normalizeBoundedText(record?.["description"], 1, 300);
    const normalizedName = name?.toLowerCase();
    if (
      !record ||
      !id ||
      !/^[a-z][a-z0-9_-]{0,63}$/.test(id) ||
      !name ||
      !description ||
      !normalizedName ||
      seenIds.has(id) ||
      seenNames.has(normalizedName)
    ) {
      return undefined;
    }
    seenIds.add(id);
    seenNames.add(normalizedName);
    output.push({ id, name, description });
  }
  return output;
}

function parseEvaluationSuiteGate(
  input: unknown,
): NonNullable<CreateEvaluationSuiteRequest["gate"]> | undefined {
  const record = requestRecord(input, [
    "minimumPassRate",
    "minimumCandidateScore",
    "allowInconclusive",
  ]);
  const minimumPassRate = record?.["minimumPassRate"];
  const minimumCandidateScore = record?.["minimumCandidateScore"];
  const allowInconclusive = record?.["allowInconclusive"];
  if (
    !record ||
    (minimumPassRate !== undefined &&
      (typeof minimumPassRate !== "number" ||
        !Number.isFinite(minimumPassRate) ||
        minimumPassRate < 0 ||
        minimumPassRate > 1)) ||
    (minimumCandidateScore !== undefined &&
      (typeof minimumCandidateScore !== "number" ||
        !Number.isFinite(minimumCandidateScore) ||
        minimumCandidateScore < 1 ||
        minimumCandidateScore > 5)) ||
    (allowInconclusive !== undefined && typeof allowInconclusive !== "boolean")
  ) {
    return undefined;
  }
  return {
    ...(typeof minimumPassRate === "number" ? { minimumPassRate } : {}),
    ...(typeof minimumCandidateScore === "number"
      ? { minimumCandidateScore }
      : {}),
    ...(typeof allowInconclusive === "boolean" ? { allowInconclusive } : {}),
  };
}

function parseRunEvaluationVerdict(
  input: unknown,
): ReviewRunEvaluationRequest["expectedVerdict"] | undefined {
  return input === "left_better" ||
    input === "right_better" ||
    input === "tie" ||
    input === "inconclusive"
    ? input
    : undefined;
}

function parseRunIdArray(
  input: unknown,
  minItems: number,
  maxItems: number,
): string[] | undefined {
  if (
    !Array.isArray(input) ||
    input.length < minItems ||
    input.length > maxItems ||
    !input.every((value) => validRunId(value))
  ) {
    return undefined;
  }
  const unique = new Set(input);
  return unique.size === input.length ? [...unique] : undefined;
}

function parseCreateAutomationScheduleRequest(
  input: unknown,
): CreateAutomationScheduleRequest | undefined {
  const record = requestRecord(input, [
    "name",
    "threadId",
    "prompt",
    "model",
    "trigger",
    "status",
    "misfirePolicy",
  ]);
  const name = normalizeBoundedText(record?.["name"], 1, 100);
  const prompt = normalizeBoundedPrompt(record?.["prompt"], 20_000);
  const threadId = record?.["threadId"];
  const trigger = parseScheduleTrigger(record?.["trigger"]);
  const model =
    record?.["model"] === undefined
      ? undefined
      : parseModelRef(record["model"]);
  const status = record?.["status"];
  const misfirePolicy = record?.["misfirePolicy"];
  if (
    !record ||
    !name ||
    !prompt ||
    !validThreadId(threadId) ||
    !trigger ||
    (record["model"] !== undefined && !model) ||
    (status !== undefined && status !== "active" && status !== "paused") ||
    (misfirePolicy !== undefined &&
      misfirePolicy !== "run_once" &&
      misfirePolicy !== "skip")
  ) {
    return undefined;
  }
  return {
    name,
    threadId,
    prompt,
    trigger,
    ...(model ? { model } : {}),
    ...(typeof status === "string" ? { status } : {}),
    ...(typeof misfirePolicy === "string" ? { misfirePolicy } : {}),
  };
}

function parseUpdateAutomationScheduleRequest(
  input: unknown,
): UpdateAutomationScheduleRequest | undefined {
  const record = requestRecord(input, [
    "name",
    "prompt",
    "model",
    "trigger",
    "status",
    "misfirePolicy",
  ]);
  if (!record) return undefined;
  const name =
    record["name"] === undefined
      ? undefined
      : normalizeBoundedText(record["name"], 1, 100);
  const prompt =
    record["prompt"] === undefined
      ? undefined
      : normalizeBoundedPrompt(record["prompt"], 20_000);
  const model =
    record["model"] === undefined ? undefined : parseModelRef(record["model"]);
  const trigger =
    record["trigger"] === undefined
      ? undefined
      : parseScheduleTrigger(record["trigger"]);
  const status = record["status"];
  const misfirePolicy = record["misfirePolicy"];
  if (
    (record["name"] !== undefined && !name) ||
    (record["prompt"] !== undefined && !prompt) ||
    (record["model"] !== undefined && !model) ||
    (record["trigger"] !== undefined && !trigger) ||
    (status !== undefined && status !== "active" && status !== "paused") ||
    (misfirePolicy !== undefined &&
      misfirePolicy !== "run_once" &&
      misfirePolicy !== "skip")
  ) {
    return undefined;
  }
  return {
    ...(name ? { name } : {}),
    ...(prompt ? { prompt } : {}),
    ...(model ? { model } : {}),
    ...(trigger ? { trigger } : {}),
    ...(typeof status === "string" ? { status } : {}),
    ...(typeof misfirePolicy === "string" ? { misfirePolicy } : {}),
  };
}

function parseScheduleTrigger(
  input: unknown,
): CreateAutomationScheduleRequest["trigger"] | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return undefined;
  }
  const type = (input as Record<string, unknown>)["type"];
  try {
    if (type === "interval") {
      const record = requestRecord(input, ["type", "everyMs", "anchorAt"]);
      const everyMs = record?.["everyMs"];
      const anchorAt = record?.["anchorAt"];
      if (
        !record ||
        typeof everyMs !== "number" ||
        !Number.isSafeInteger(everyMs) ||
        everyMs < 60_000 ||
        everyMs > 30 * 24 * 60 * 60 * 1_000 ||
        (anchorAt !== undefined &&
          (typeof anchorAt !== "string" ||
            anchorAt.length > 80 ||
            !Number.isFinite(Date.parse(anchorAt))))
      ) {
        return undefined;
      }
      return normalizeScheduleTrigger({
        type,
        everyMs,
        ...(typeof anchorAt === "string" ? { anchorAt } : {}),
      });
    }
    if (type === "cron") {
      const record = requestRecord(input, ["type", "expression", "timezone"]);
      const expression = normalizeBoundedText(record?.["expression"], 1, 120);
      if (!record || !expression || record["timezone"] !== "UTC") {
        return undefined;
      }
      return normalizeScheduleTrigger({
        type,
        expression,
        timezone: "UTC",
      });
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function parseCreateInboundChannelRequest(
  input: unknown,
): CreateInboundChannelRequest | undefined {
  const record = requestRecord(input, [
    "name",
    "threadId",
    "adapter",
    "policyTemplate",
    "retryPolicy",
    "signaturePolicy",
  ]);
  const name = normalizeBoundedText(record?.["name"], 1, 100);
  const threadId = record?.["threadId"];
  const adapter =
    record?.["adapter"] === undefined
      ? undefined
      : parseInboundChannelAdapter(record["adapter"]);
  const policyTemplate =
    record?.["policyTemplate"] === undefined
      ? undefined
      : parseInboundChannelPolicyTemplate(record["policyTemplate"]);
  const retryPolicy =
    record?.["retryPolicy"] === undefined
      ? undefined
      : parseInboundRetryPolicy(record["retryPolicy"]);
  const signaturePolicy =
    record?.["signaturePolicy"] === undefined
      ? undefined
      : parseInboundSignaturePolicy(record["signaturePolicy"]);
  if (
    !record ||
    !name ||
    !validThreadId(threadId) ||
    (record["adapter"] !== undefined && !adapter) ||
    (record["policyTemplate"] !== undefined && !policyTemplate) ||
    (policyTemplate !== undefined &&
      policyTemplate !== "custom" &&
      (record["retryPolicy"] !== undefined ||
        record["signaturePolicy"] !== undefined)) ||
    (policyTemplate === "custom" &&
      record["retryPolicy"] === undefined &&
      record["signaturePolicy"] === undefined) ||
    (record["retryPolicy"] !== undefined && !retryPolicy) ||
    (record["signaturePolicy"] !== undefined && !signaturePolicy)
  ) {
    return undefined;
  }
  return {
    name,
    threadId,
    ...(adapter ? { adapter } : {}),
    ...(policyTemplate ? { policyTemplate } : {}),
    ...(retryPolicy ? { retryPolicy } : {}),
    ...(signaturePolicy ? { signaturePolicy } : {}),
  };
}

function parseInboundChannelAdapter(
  input: unknown,
): InboundChannelAdapter | undefined {
  return typeof input === "string" &&
    INBOUND_CHANNEL_ADAPTERS.some((adapter) => adapter.id === input)
    ? (input as InboundChannelAdapter)
    : undefined;
}

function parsePreviewInboundChannelAdapterRequest(
  input: unknown,
): PreviewInboundChannelAdapterRequest | undefined {
  const record = requestRecord(input, ["body", "headers"]);
  const body = record?.["body"];
  const headers =
    record?.["headers"] === undefined
      ? undefined
      : parsePreviewInboundHeaders(record["headers"]);
  if (
    !record ||
    typeof body !== "string" ||
    body.length === 0 ||
    Buffer.byteLength(body) > MAX_INBOUND_BODY_BYTES ||
    (record["headers"] !== undefined && !headers)
  ) {
    return undefined;
  }
  return {
    body,
    ...(headers && Object.keys(headers).length > 0 ? { headers } : {}),
  };
}

function parseVerifyInboundDeadLetterExportRequest(
  input: unknown,
): VerifyInboundDeadLetterExportRequest | undefined {
  const record = requestRecord(input, ["artifact"]);
  return record && record["artifact"] !== undefined
    ? { artifact: record["artifact"] }
    : undefined;
}

function parseVerifyInboundDeadLetterRetryHistoryRequest(
  input: unknown,
): VerifyInboundDeadLetterRetryHistoryRequest | undefined {
  const record = requestRecord(input, ["history"]);
  return record && record["history"] !== undefined
    ? { history: record["history"] }
    : undefined;
}

function parsePreviewInboundDeadLetterRetryRequest(
  input: unknown,
): PreviewInboundDeadLetterRetryRequest | undefined {
  const record = requestRecord(input, ["artifact"]);
  return record && record["artifact"] !== undefined
    ? { artifact: record["artifact"] }
    : undefined;
}

function parseApplyInboundDeadLetterRetryRequest(
  input: unknown,
): ApplyInboundDeadLetterRetryRequest | undefined {
  const record = requestRecord(input, [
    "artifact",
    "expectedPreviewSha256",
    "confirmReplay",
  ]);
  const expectedPreviewSha256 = record?.["expectedPreviewSha256"];
  const confirmReplay = record?.["confirmReplay"];
  if (
    !record ||
    record["artifact"] === undefined ||
    typeof expectedPreviewSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(expectedPreviewSha256) ||
    typeof confirmReplay !== "boolean"
  ) {
    return undefined;
  }
  return {
    artifact: record["artifact"],
    expectedPreviewSha256,
    confirmReplay,
  };
}

function parsePreviewInboundHeaders(
  input: unknown,
): Record<string, string> | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return undefined;
  }
  const entries = Object.entries(input as Record<string, unknown>);
  if (entries.length > 32) return undefined;
  const output: Record<string, string> = {};
  for (const [key, value] of entries) {
    const normalizedKey = key.trim().toLowerCase();
    if (
      !/^[a-z0-9][a-z0-9-]{0,79}$/.test(normalizedKey) ||
      typeof value !== "string" ||
      value.length > 1_000 ||
      /[\r\n\u0000]/.test(value)
    ) {
      return undefined;
    }
    output[normalizedKey] = value.trim();
  }
  return output;
}

function parseInboundChannelPolicyTemplate(
  input: unknown,
): InboundChannelPolicyTemplateId | undefined {
  return input === "legacy_bearer" ||
    input === "signed_standard" ||
    input === "signed_strict" ||
    input === "custom"
    ? input
    : undefined;
}

function parseInboundSignaturePolicy(
  input: unknown,
): CreateInboundChannelRequest["signaturePolicy"] | undefined {
  const record = requestRecord(input, ["required", "toleranceSeconds"]);
  const required = record?.["required"];
  const toleranceSeconds = record?.["toleranceSeconds"];
  if (
    !record ||
    typeof required !== "boolean" ||
    (toleranceSeconds !== undefined &&
      (typeof toleranceSeconds !== "number" ||
        !Number.isInteger(toleranceSeconds) ||
        toleranceSeconds < 30 ||
        toleranceSeconds > 900))
  ) {
    return undefined;
  }
  return {
    required,
    ...(typeof toleranceSeconds === "number" ? { toleranceSeconds } : {}),
  };
}

function parseSetInboundChannelStatusRequest(
  input: unknown,
): SetInboundChannelStatusRequest | undefined {
  const record = requestRecord(input, ["status"]);
  const status = record?.["status"];
  return record && (status === "active" || status === "disabled")
    ? { status }
    : undefined;
}

function parseUpdateInboundRetryPolicyRequest(
  input: unknown,
): UpdateInboundRetryPolicyRequest | undefined {
  const record = requestRecord(input, ["retryPolicy"]);
  const retryPolicy = parseInboundRetryPolicy(record?.["retryPolicy"]);
  return record && retryPolicy ? { retryPolicy } : undefined;
}

function parseUpdateInboundSignaturePolicyRequest(
  input: unknown,
): UpdateInboundSignaturePolicyRequest | undefined {
  const record = requestRecord(input, ["signaturePolicy"]);
  const signaturePolicy = parseInboundSignaturePolicy(
    record?.["signaturePolicy"],
  );
  return record && signaturePolicy ? { signaturePolicy } : undefined;
}

function parseInboundRetryPolicy(
  input: unknown,
): UpdateInboundRetryPolicyRequest["retryPolicy"] | undefined {
  const record = requestRecord(input, ["maxAttempts", "baseDelayMs"]);
  const maxAttempts = record?.["maxAttempts"];
  const baseDelayMs = record?.["baseDelayMs"];
  if (
    !record ||
    typeof maxAttempts !== "number" ||
    !Number.isInteger(maxAttempts) ||
    maxAttempts < 1 ||
    maxAttempts > 10 ||
    typeof baseDelayMs !== "number" ||
    !Number.isInteger(baseDelayMs) ||
    baseDelayMs < 250 ||
    baseDelayMs > 60_000
  ) {
    return undefined;
  }
  return { maxAttempts, baseDelayMs };
}

function normalizeBoundedText(
  input: unknown,
  minLength: number,
  maxLength: number,
): string | undefined {
  if (typeof input !== "string") return undefined;
  const normalized = input.replace(/\s+/g, " ").trim();
  return normalized.length >= minLength && normalized.length <= maxLength
    ? normalized
    : undefined;
}

function normalizeBoundedPrompt(
  input: unknown,
  maxLength: number,
): string | undefined {
  if (typeof input !== "string") return undefined;
  const normalized = input.replace(/\r\n?/g, "\n").trim();
  return normalized.length > 0 && normalized.length <= maxLength
    ? normalized
    : undefined;
}

function parseCreateMemoryRequest(
  input: unknown,
): CreateMemoryRequest | undefined {
  const record = requestRecord(input, [
    "content",
    "category",
    "scope",
    "agentId",
    "confidence",
    "reviewIntervalDays",
    "supersedesMemoryId",
    "consolidatesMemoryIds",
    "threadId",
  ]);
  const content = normalizeBoundedText(record?.["content"], 1, 2_000);
  const category =
    record?.["category"] === undefined
      ? undefined
      : parseMemoryCategory(record["category"]);
  const scope =
    record?.["scope"] === undefined
      ? undefined
      : parseMemoryScope(record["scope"]);
  const agentId = record?.["agentId"];
  const threadId = record?.["threadId"];
  const confidence = record?.["confidence"];
  const reviewIntervalDays = record?.["reviewIntervalDays"];
  const supersedesMemoryId = record?.["supersedesMemoryId"];
  const consolidatesMemoryIds =
    record?.["consolidatesMemoryIds"] === undefined
      ? undefined
      : parseMemoryIdArray(record["consolidatesMemoryIds"], 2, 8);
  if (
    !record ||
    !content ||
    (record["category"] !== undefined && !category) ||
    (record["scope"] !== undefined && !scope) ||
    (agentId !== undefined && !validAgentId(agentId)) ||
    (threadId !== undefined && !validThreadId(threadId)) ||
    (confidence !== undefined &&
      (typeof confidence !== "number" ||
        !Number.isFinite(confidence) ||
        confidence < 0 ||
        confidence > 1)) ||
    (reviewIntervalDays !== undefined &&
      (typeof reviewIntervalDays !== "number" ||
        !Number.isInteger(reviewIntervalDays) ||
        reviewIntervalDays < 1 ||
        reviewIntervalDays > 3_650)) ||
    (supersedesMemoryId !== undefined && !validMemoryId(supersedesMemoryId)) ||
    (record["consolidatesMemoryIds"] !== undefined && !consolidatesMemoryIds) ||
    (supersedesMemoryId !== undefined &&
      record["consolidatesMemoryIds"] !== undefined)
  ) {
    return undefined;
  }
  return {
    content,
    ...(category ? { category } : {}),
    ...(scope ? { scope } : {}),
    ...(typeof agentId === "string" ? { agentId } : {}),
    ...(typeof confidence === "number" ? { confidence } : {}),
    ...(typeof reviewIntervalDays === "number" ? { reviewIntervalDays } : {}),
    ...(typeof supersedesMemoryId === "string" ? { supersedesMemoryId } : {}),
    ...(consolidatesMemoryIds ? { consolidatesMemoryIds } : {}),
    ...(typeof threadId === "string" ? { threadId } : {}),
  };
}

function parseReviewMemoryRequest(
  input: unknown,
): ReviewMemoryRequest | undefined {
  const record = requestRecord(input, ["action", "note", "threadId"]);
  const action = parseMemoryReviewAction(record?.["action"]);
  const threadId = record?.["threadId"];
  const note = parseOptionalBoundedText(record?.["note"], 500);
  if (
    !record ||
    !action ||
    (record["note"] !== undefined && note === undefined) ||
    (threadId !== undefined && !validThreadId(threadId))
  ) {
    return undefined;
  }
  return {
    action,
    ...(note ? { note } : {}),
    ...(typeof threadId === "string" ? { threadId } : {}),
  };
}

function parseMemoryCategory(
  input: unknown,
): NonNullable<CreateMemoryRequest["category"]> | undefined {
  return input === "preference" ||
    input === "context" ||
    input === "goal" ||
    input === "constraint" ||
    input === "decision" ||
    input === "identity" ||
    input === "behavior" ||
    input === "correction" ||
    input === "other"
    ? input
    : undefined;
}

function parseMemoryScope(
  input: unknown,
): NonNullable<CreateMemoryRequest["scope"]> | undefined {
  return input === "workspace" || input === "agent" ? input : undefined;
}

function parseMemoryReviewAction(
  input: unknown,
): ReviewMemoryRequest["action"] | undefined {
  return input === "approve" ||
    input === "reject" ||
    input === "archive" ||
    input === "restore" ||
    input === "refresh" ||
    input === "mark_stale"
    ? input
    : undefined;
}

function parseMemoryIdArray(
  input: unknown,
  minItems: number,
  maxItems: number,
): string[] | undefined {
  if (
    !Array.isArray(input) ||
    input.length < minItems ||
    input.length > maxItems
  ) {
    return undefined;
  }
  if (!input.every((value) => validMemoryId(value))) return undefined;
  const unique = new Set(input);
  return unique.size === input.length ? [...unique].sort() : undefined;
}

function parseCreateCredentialReferenceRequest(
  input: unknown,
): CreateCredentialReferenceRequest | undefined {
  const record = requestRecord(input, [
    "providerId",
    "label",
    "source",
    "threadId",
  ]);
  const providerId = normalizeProviderId(record?.["providerId"]);
  const label = normalizeBoundedText(record?.["label"], 1, 100);
  const source = parseCredentialReferenceSource(record?.["source"]);
  const threadId = record?.["threadId"];
  if (
    !record ||
    !providerId ||
    !label ||
    !source ||
    (threadId !== undefined && !validThreadId(threadId))
  ) {
    return undefined;
  }
  return {
    providerId,
    label,
    source,
    ...(typeof threadId === "string" ? { threadId } : {}),
  };
}

function parseCreateMacOsKeychainCredentialRequest(
  input: unknown,
): CreateMacOsKeychainCredentialRequest | undefined {
  const record = requestRecord(input, [
    "providerId",
    "label",
    "service",
    "account",
    "secret",
    "replaceExisting",
    "threadId",
  ]);
  const providerId = normalizeProviderId(record?.["providerId"]);
  const label = normalizeBoundedText(record?.["label"], 1, 100);
  const service = parseSingleLineText(record?.["service"], 1, 200);
  const account = parseSingleLineText(record?.["account"], 1, 200);
  const secret = parseCredentialSecret(record?.["secret"]);
  const replaceExisting = record?.["replaceExisting"];
  const threadId = record?.["threadId"];
  if (
    !record ||
    !providerId ||
    !label ||
    !service ||
    !account ||
    !secret ||
    (replaceExisting !== undefined && typeof replaceExisting !== "boolean") ||
    (threadId !== undefined && !validThreadId(threadId))
  ) {
    return undefined;
  }
  return {
    providerId,
    label,
    service,
    account,
    secret,
    ...(typeof replaceExisting === "boolean" ? { replaceExisting } : {}),
    ...(typeof threadId === "string" ? { threadId } : {}),
  };
}

function parseCredentialThreadContextRequest(
  input: unknown,
): { threadId?: string } | undefined {
  if (input === undefined) return {};
  const record = requestRecord(input, ["threadId"]);
  const threadId = record?.["threadId"];
  return record && (threadId === undefined || validThreadId(threadId))
    ? {
        ...(typeof threadId === "string" ? { threadId } : {}),
      }
    : undefined;
}

function parseSetCredentialReferenceStatusRequest(
  input: unknown,
): SetCredentialReferenceStatusRequest | undefined {
  const record = requestRecord(input, ["status", "threadId"]);
  const status = record?.["status"];
  const threadId = record?.["threadId"];
  return record &&
    (status === "active" || status === "disabled") &&
    (threadId === undefined || validThreadId(threadId))
    ? {
        status,
        ...(typeof threadId === "string" ? { threadId } : {}),
      }
    : undefined;
}

function parseCredentialReferenceSource(
  input: unknown,
): CreateCredentialReferenceRequest["source"] | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return undefined;
  }
  const type = (input as Record<string, unknown>)["type"];
  if (type === "environment") {
    const record = requestRecord(input, ["type", "variable"]);
    const variable =
      typeof record?.["variable"] === "string"
        ? record["variable"].trim()
        : undefined;
    return variable && /^[A-Z_][A-Z0-9_]{1,127}$/.test(variable)
      ? { type, variable }
      : undefined;
  }
  if (type === "macos_keychain") {
    const record = requestRecord(input, ["type", "service", "account"]);
    const service = parseSingleLineText(record?.["service"], 1, 200);
    const account = parseSingleLineText(record?.["account"], 1, 200);
    return record && service && account
      ? { type, service, account }
      : undefined;
  }
  return undefined;
}

function parseCredentialSecret(input: unknown): string | undefined {
  if (typeof input !== "string") return undefined;
  const secret = input.trim();
  return secret.length >= 8 && secret.length <= 4096 && !/[\u0000]/.test(secret)
    ? secret
    : undefined;
}

function normalizeProviderId(input: unknown): string | undefined {
  if (typeof input !== "string") return undefined;
  const normalized = input.trim().toLowerCase();
  return /^[a-z][a-z0-9_-]{0,63}$/.test(normalized) ? normalized : undefined;
}

function parseOptionalBoundedText(
  input: unknown,
  maxLength: number,
): string | undefined {
  if (input === undefined) return "";
  if (typeof input !== "string") return undefined;
  const normalized = input.replace(/\s+/g, " ").trim();
  return normalized.length <= maxLength ? normalized : undefined;
}

function parseSingleLineText(
  input: unknown,
  minLength: number,
  maxLength: number,
): string | undefined {
  if (typeof input !== "string" || /[\u0000\r\n]/.test(input)) {
    return undefined;
  }
  const normalized = input.replace(/\s+/g, " ").trim();
  return normalized.length >= minLength && normalized.length <= maxLength
    ? normalized
    : undefined;
}

function parseCreateExecutionPlanRequest(
  input: unknown,
): CreateExecutionPlanRequest | undefined {
  const record = requestRecord(input, ["objective", "steps", "artifacts"]);
  if (!record || !boundedString(record["objective"], 1, 4_000)) {
    return undefined;
  }
  const steps = parsePlanStepInputs(record["steps"]);
  if (!steps) return undefined;
  const artifacts =
    record["artifacts"] === undefined
      ? undefined
      : parsePlanArtifactInputs(record["artifacts"]);
  if (record["artifacts"] !== undefined && !artifacts) return undefined;
  return {
    objective: record["objective"],
    steps,
    ...(artifacts ? { artifacts } : {}),
  };
}

function parseReplanExecutionPlanRequest(
  input: unknown,
): ReplanExecutionPlanRequest | undefined {
  const record = requestRecord(input, [
    "expectedRevision",
    "strategy",
    "reason",
    "evidence",
    "supersedeStepIds",
    "supersedeArtifactIds",
    "dependencyUpdates",
    "addSteps",
    "addArtifacts",
  ]);
  const expectedRevision = record?.["expectedRevision"];
  const strategy = record?.["strategy"];
  const reason = record?.["reason"];
  const evidence = record?.["evidence"];
  if (
    !record ||
    typeof expectedRevision !== "number" ||
    !Number.isSafeInteger(expectedRevision) ||
    expectedRevision < 1 ||
    (strategy !== "recover_blocked" &&
      strategy !== "scope_change" &&
      strategy !== "artifact_drift") ||
    !boundedString(reason, 1, 1_000) ||
    !boundedString(evidence, 1, 2_000)
  ) {
    return undefined;
  }
  const supersedeStepIds =
    record["supersedeStepIds"] === undefined
      ? undefined
      : parseBoundedStringArray(record["supersedeStepIds"], 30, 1, 64);
  if (record["supersedeStepIds"] !== undefined && !supersedeStepIds) {
    return undefined;
  }
  const supersedeArtifactIds =
    record["supersedeArtifactIds"] === undefined
      ? undefined
      : parseBoundedStringArray(record["supersedeArtifactIds"], 30, 1, 64);
  if (record["supersedeArtifactIds"] !== undefined && !supersedeArtifactIds) {
    return undefined;
  }
  const dependencyUpdates =
    record["dependencyUpdates"] === undefined
      ? undefined
      : parsePlanDependencyUpdates(record["dependencyUpdates"]);
  if (record["dependencyUpdates"] !== undefined && !dependencyUpdates) {
    return undefined;
  }
  const addSteps =
    record["addSteps"] === undefined
      ? undefined
      : parsePlanStepInputs(record["addSteps"]);
  if (record["addSteps"] !== undefined && !addSteps) return undefined;
  const addArtifacts =
    record["addArtifacts"] === undefined
      ? undefined
      : parsePlanArtifactInputs(record["addArtifacts"]);
  if (
    record["addArtifacts"] !== undefined &&
    (!addArtifacts || addArtifacts.length === 0)
  ) {
    return undefined;
  }
  if (
    (supersedeStepIds?.length ?? 0) === 0 &&
    (supersedeArtifactIds?.length ?? 0) === 0 &&
    (dependencyUpdates?.length ?? 0) === 0 &&
    (addSteps?.length ?? 0) === 0 &&
    (addArtifacts?.length ?? 0) === 0
  ) {
    return undefined;
  }
  return {
    expectedRevision,
    strategy,
    reason,
    evidence,
    ...(supersedeStepIds && supersedeStepIds.length > 0
      ? { supersedeStepIds }
      : {}),
    ...(supersedeArtifactIds && supersedeArtifactIds.length > 0
      ? { supersedeArtifactIds }
      : {}),
    ...(dependencyUpdates && dependencyUpdates.length > 0
      ? { dependencyUpdates }
      : {}),
    ...(addSteps ? { addSteps } : {}),
    ...(addArtifacts && addArtifacts.length > 0 ? { addArtifacts } : {}),
  };
}

function parseReviewExecutionPlanReplanDraftRequest(
  input: unknown,
): ReviewExecutionPlanReplanDraftRequest | undefined {
  if (input === undefined) return {};
  const record = requestRecord(input, ["model"]);
  if (!record) return undefined;
  const model =
    record["model"] === undefined ? undefined : parseModelRef(record["model"]);
  if (record["model"] !== undefined && !model) return undefined;
  return {
    ...(model ? { model } : {}),
  };
}

function parseVerifyExecutionPlanArchiveRequest(
  input: unknown,
): VerifyExecutionPlanArchiveRequest | undefined {
  const record = requestRecord(input, ["archive"]);
  if (!record || record["archive"] === undefined) return undefined;
  return {
    archive: record["archive"] as ExecutionPlanArchive,
  };
}

function parseVerifyExecutionPlanBlueprintRequest(
  input: unknown,
): VerifyExecutionPlanBlueprintRequest | undefined {
  const record = requestRecord(input, ["blueprint"]);
  if (!record || record["blueprint"] === undefined) return undefined;
  return {
    blueprint: record["blueprint"] as ExecutionPlanBlueprint,
  };
}

function parseVerifyExecutionPlanBlueprintRecordReplayHistoryRequest(
  input: unknown,
): VerifyExecutionPlanBlueprintRecordReplayHistoryRequest | undefined {
  const record = requestRecord(input, ["history"]);
  if (!record || record["history"] === undefined) return undefined;
  return {
    history: record["history"],
  };
}

function parseVerifyExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryRequest(
  input: unknown,
):
  | VerifyExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryRequest
  | undefined {
  const record = requestRecord(input, ["history"]);
  if (!record || record["history"] === undefined) return undefined;
  return {
    history: record["history"],
  };
}

function parseVerifyExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryProofBundleRequest(
  input: unknown,
):
  | VerifyExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryProofBundleRequest
  | undefined {
  const record = requestRecord(input, ["histories"]);
  if (!record || !Array.isArray(record["histories"])) return undefined;
  return {
    histories: record["histories"],
  };
}

function parseSignExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryProofBundleRequest(
  input: unknown,
):
  | SignExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryProofBundleRequest
  | undefined {
  const record = requestRecord(input, [
    "histories",
    "threadId",
    "trustAnchorId",
  ]);
  const threadId = record?.["threadId"];
  const trustAnchorId = record?.["trustAnchorId"];
  return record &&
    Array.isArray(record["histories"]) &&
    validThreadId(threadId) &&
    typeof trustAnchorId === "string" &&
    /^trustkey_[a-z0-9]{8,80}$/.test(trustAnchorId)
    ? {
        histories: record["histories"],
        threadId,
        trustAnchorId,
      }
    : undefined;
}

function parseVerifyExecutionPlanBlueprintRecordReplayOutcomesRequest(
  input: unknown,
): VerifyExecutionPlanBlueprintRecordReplayOutcomesRequest | undefined {
  const record = requestRecord(input, ["outcomes"]);
  if (!record || record["outcomes"] === undefined) return undefined;
  return {
    outcomes: record["outcomes"],
  };
}

function parsePromoteExecutionPlanBlueprintRecordOutcomeBaselineRequest(
  input: unknown,
): PromoteExecutionPlanBlueprintRecordOutcomeBaselineRequest | undefined {
  const record = requestRecord(input, [
    "outcomes",
    "policy",
    "review",
    "reviewGate",
  ]);
  if (!record || record["outcomes"] === undefined) return undefined;
  const policy = parseExecutionPlanBlueprintOutcomeBaselinePolicy(
    record["policy"],
  );
  if (record["policy"] !== undefined && !policy) return undefined;
  const reviewGate =
    record["reviewGate"] === undefined
      ? undefined
      : parseExecutionPlanBlueprintOutcomeBaselineReviewGate(
          record["reviewGate"],
        );
  if (record["reviewGate"] !== undefined && !reviewGate) return undefined;
  if (record["reviewGate"] !== undefined && record["review"] === undefined) {
    return undefined;
  }
  return {
    outcomes: record["outcomes"],
    ...(policy ? { policy } : {}),
    ...(record["review"] !== undefined ? { review: record["review"] } : {}),
    ...(reviewGate ? { reviewGate } : {}),
  };
}

function parseReviewExecutionPlanBlueprintRecordOutcomesRequest(
  input: unknown,
): ReviewExecutionPlanBlueprintRecordOutcomesRequest | undefined {
  const record = requestRecord(input, ["model", "criteria"]);
  const model = parseModelRef(record?.["model"]);
  if (!record || !model) return undefined;
  const criteria =
    record["criteria"] === undefined
      ? undefined
      : parseExecutionPlanBlueprintOutcomeReviewCriteria(record["criteria"]);
  if (record["criteria"] !== undefined && !criteria) return undefined;
  return {
    model,
    ...(criteria ? { criteria } : {}),
  };
}

function parseExecutionPlanBlueprintOutcomeReviewCriteria(
  input: unknown,
): ExecutionPlanBlueprintOutcomeReviewCriteria | undefined {
  const record = requestRecord(input, ["name", "criteria"]);
  if (!record || !boundedString(record["name"], 1, 100)) return undefined;
  const criteria = record["criteria"];
  if (!Array.isArray(criteria) || criteria.length < 2 || criteria.length > 6) {
    return undefined;
  }
  const parsedCriteria = criteria.map((value) => {
    const item = requestRecord(value, ["id", "name", "description"]);
    if (
      !item ||
      !boundedString(item["id"], 1, 64) ||
      !/^[a-z][a-z0-9_-]{0,63}$/.test(item["id"]) ||
      !boundedString(item["name"], 1, 80) ||
      !boundedString(item["description"], 1, 300)
    ) {
      return undefined;
    }
    return {
      id: item["id"].trim().toLowerCase(),
      name: item["name"].trim(),
      description: item["description"].trim(),
    };
  });
  if (parsedCriteria.some((criterion) => !criterion)) return undefined;
  const ids = new Set(parsedCriteria.map((criterion) => criterion!.id));
  if (ids.size !== parsedCriteria.length) return undefined;
  return {
    name: record["name"].trim(),
    criteria:
      parsedCriteria as ExecutionPlanBlueprintOutcomeReviewCriteria["criteria"],
  };
}

function parseExecutionPlanBlueprintOutcomeBaselinePolicy(
  input: unknown,
):
  | PromoteExecutionPlanBlueprintRecordOutcomeBaselineRequest["policy"]
  | undefined {
  if (input === undefined) return {};
  const record = requestRecord(input, [
    "minReplayCount",
    "minCompletionRateBps",
    "maxBlockedCount",
    "maxInvalidCount",
  ]);
  if (!record) return undefined;
  const policy: NonNullable<
    PromoteExecutionPlanBlueprintRecordOutcomeBaselineRequest["policy"]
  > = {};
  const minReplayCount = optionalBoundedInteger(
    record["minReplayCount"],
    1,
    10_000,
  );
  const minCompletionRateBps = optionalBoundedInteger(
    record["minCompletionRateBps"],
    0,
    10_000,
  );
  const maxBlockedCount = optionalBoundedInteger(
    record["maxBlockedCount"],
    0,
    10_000,
  );
  const maxInvalidCount = optionalBoundedInteger(
    record["maxInvalidCount"],
    0,
    10_000,
  );
  if (
    minReplayCount === false ||
    minCompletionRateBps === false ||
    maxBlockedCount === false ||
    maxInvalidCount === false
  ) {
    return undefined;
  }
  if (typeof minReplayCount === "number") {
    policy.minReplayCount = minReplayCount;
  }
  if (typeof minCompletionRateBps === "number") {
    policy.minCompletionRateBps = minCompletionRateBps;
  }
  if (typeof maxBlockedCount === "number") {
    policy.maxBlockedCount = maxBlockedCount;
  }
  if (typeof maxInvalidCount === "number") {
    policy.maxInvalidCount = maxInvalidCount;
  }
  return policy;
}

function parseExecutionPlanBlueprintOutcomeBaselineReviewGate(
  input: unknown,
):
  | PromoteExecutionPlanBlueprintRecordOutcomeBaselineRequest["reviewGate"]
  | undefined {
  if (input === undefined) return {};
  const record = requestRecord(input, ["minScore", "maxRisk"]);
  if (!record) return undefined;
  const minScore = optionalBoundedInteger(record["minScore"], 0, 100);
  const maxRisk = record["maxRisk"];
  if (
    minScore === false ||
    (maxRisk !== undefined &&
      maxRisk !== "low" &&
      maxRisk !== "medium" &&
      maxRisk !== "high")
  ) {
    return undefined;
  }
  return {
    ...(typeof minScore === "number" ? { minScore } : {}),
    ...(maxRisk ? { maxRisk } : {}),
  };
}

function optionalBoundedInteger(
  value: unknown,
  min: number,
  max: number,
): number | undefined | false {
  if (value === undefined) return undefined;
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= min &&
    value <= max
    ? value
    : false;
}

function parseVerifyExecutionPlanBlueprintRecordReplayEventRequest(
  input: unknown,
): VerifyExecutionPlanBlueprintRecordReplayEventRequest | undefined {
  const record = requestRecord(input, [
    "threadId",
    "eventId",
    "seq",
    "eventSha256",
  ]);
  if (
    !record ||
    !boundedString(record["threadId"], 1, 100) ||
    !boundedString(record["eventId"], 1, 100) ||
    typeof record["seq"] !== "number" ||
    !Number.isSafeInteger(record["seq"]) ||
    record["seq"] < 1 ||
    !isSha256Hex(record["eventSha256"])
  ) {
    return undefined;
  }
  return {
    threadId: record["threadId"],
    eventId: record["eventId"],
    seq: record["seq"],
    eventSha256: record["eventSha256"],
  };
}

function parseCreateExecutionPlanFromBlueprintRequest(
  input: unknown,
): CreateExecutionPlanFromBlueprintRequest | undefined {
  const record = requestRecord(input, ["blueprint", "objective"]);
  if (!record || record["blueprint"] === undefined) return undefined;
  const objective =
    record["objective"] === undefined ||
    !boundedString(record["objective"], 1, 4_000)
      ? undefined
      : record["objective"];
  if (record["objective"] !== undefined && !objective) return undefined;
  return {
    blueprint: record["blueprint"] as ExecutionPlanBlueprint,
    ...(objective ? { objective } : {}),
  };
}

function parseSaveExecutionPlanBlueprintRequest(
  input: unknown,
): SaveExecutionPlanBlueprintRequest | undefined {
  const record = requestRecord(input, ["blueprint", "name", "description"]);
  if (!record || record["blueprint"] === undefined) return undefined;
  const name =
    record["name"] === undefined || !boundedString(record["name"], 1, 120)
      ? undefined
      : record["name"];
  if (record["name"] !== undefined && !name) return undefined;
  const description =
    record["description"] === undefined ||
    !boundedString(record["description"], 0, 1_000)
      ? undefined
      : record["description"];
  if (record["description"] !== undefined && description === undefined) {
    return undefined;
  }
  return {
    blueprint: record["blueprint"] as ExecutionPlanBlueprint,
    ...(name ? { name } : {}),
    ...(description !== undefined ? { description } : {}),
  };
}

function parseSelectExecutionPlanBlueprintRecordRequest(
  input: unknown,
): SelectExecutionPlanBlueprintRecordRequest | undefined {
  const record = requestRecord(input, ["objective", "policyTemplate"]);
  if (!record) return undefined;
  const objective =
    record["objective"] === undefined
      ? undefined
      : typeof record["objective"] === "string"
        ? record["objective"].trim()
        : undefined;
  const policyTemplate = record["policyTemplate"];
  if (
    record["objective"] !== undefined &&
    (!objective || !boundedString(objective, 1, 4_000))
  ) {
    return undefined;
  }
  if (
    policyTemplate !== undefined &&
    policyTemplate !== "balanced" &&
    policyTemplate !== "delivery_first" &&
    policyTemplate !== "portfolio_first"
  ) {
    return undefined;
  }
  return {
    ...(objective ? { objective } : {}),
    ...(policyTemplate ? { policyTemplate } : {}),
  };
}

function parseSetExecutionPlanBlueprintRecommendationPolicyOverrideRequest(
  input: unknown,
): SetExecutionPlanBlueprintRecommendationPolicyOverrideRequest | undefined {
  const record = requestRecord(input, [
    "familySha256",
    "policyTemplate",
    "expectedPortfolioSetSha256",
  ]);
  if (!record) return undefined;
  const familySha256 = record["familySha256"];
  const policyTemplate = record["policyTemplate"];
  const expectedPortfolioSetSha256 = record["expectedPortfolioSetSha256"];
  if (
    !isSha256Hex(familySha256) ||
    (policyTemplate !== "balanced" &&
      policyTemplate !== "delivery_first" &&
      policyTemplate !== "portfolio_first") ||
    (expectedPortfolioSetSha256 !== undefined &&
      !isSha256Hex(expectedPortfolioSetSha256))
  ) {
    return undefined;
  }
  return {
    familySha256,
    policyTemplate,
    ...(expectedPortfolioSetSha256 ? { expectedPortfolioSetSha256 } : {}),
  };
}

function parseRetireExecutionPlanBlueprintRecommendationPolicyOverrideRequest(
  input: unknown,
): RetireExecutionPlanBlueprintRecommendationPolicyOverrideRequest | undefined {
  const record = requestRecord(input, [
    "familySha256",
    "expectedOverrideSha256",
    "expectedOverrideSetSha256",
    "expectedDriftReviewSetSha256",
    "expectedPortfolioSetSha256",
  ]);
  if (!record) return undefined;
  const familySha256 = record["familySha256"];
  const expectedOverrideSha256 = record["expectedOverrideSha256"];
  const expectedOverrideSetSha256 = record["expectedOverrideSetSha256"];
  const expectedDriftReviewSetSha256 = record["expectedDriftReviewSetSha256"];
  const expectedPortfolioSetSha256 = record["expectedPortfolioSetSha256"];
  if (
    !isSha256Hex(familySha256) ||
    !isSha256Hex(expectedOverrideSha256) ||
    !isSha256Hex(expectedOverrideSetSha256) ||
    !isSha256Hex(expectedDriftReviewSetSha256) ||
    !isSha256Hex(expectedPortfolioSetSha256)
  ) {
    return undefined;
  }
  return {
    familySha256,
    expectedOverrideSha256,
    expectedOverrideSetSha256,
    expectedDriftReviewSetSha256,
    expectedPortfolioSetSha256,
  };
}

function parseSetExecutionPlanBlueprintRecordStatusRequest(
  input: unknown,
): SetExecutionPlanBlueprintRecordStatusRequest | undefined {
  const record = requestRecord(input, ["status"]);
  const status = record?.["status"];
  if (!record || (status !== "active" && status !== "archived")) {
    return undefined;
  }
  return { status };
}

function parseCreateExecutionPlanFromBlueprintRecordRequest(
  input: unknown,
): CreateExecutionPlanFromBlueprintRecordRequest | undefined {
  const record = requestRecord(input, [
    "recordId",
    "objective",
    "expectedPreviewSha256",
  ]);
  if (!record || !boundedString(record["recordId"], 1, 100)) {
    return undefined;
  }
  const objective =
    record["objective"] === undefined ||
    !boundedString(record["objective"], 1, 4_000)
      ? undefined
      : record["objective"];
  if (record["objective"] !== undefined && !objective) return undefined;
  const expectedPreviewSha256 = record["expectedPreviewSha256"];
  if (
    expectedPreviewSha256 !== undefined &&
    (typeof expectedPreviewSha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(expectedPreviewSha256))
  ) {
    return undefined;
  }
  return {
    recordId: record["recordId"],
    ...(objective ? { objective } : {}),
    ...(expectedPreviewSha256 ? { expectedPreviewSha256 } : {}),
  };
}

function parsePlanStepInputs(
  input: unknown,
): CreateExecutionPlanRequest["steps"] | undefined {
  if (!Array.isArray(input) || input.length < 1 || input.length > 30) {
    return undefined;
  }
  const output: CreateExecutionPlanRequest["steps"] = [];
  for (const value of input) {
    const record = requestRecord(value, [
      "id",
      "title",
      "description",
      "verification",
      "dependsOn",
    ]);
    if (
      !record ||
      !boundedString(record["id"], 1, 64) ||
      !boundedString(record["title"], 1, 120) ||
      !boundedString(record["description"], 1, 1_500) ||
      !boundedString(record["verification"], 1, 1_000)
    ) {
      return undefined;
    }
    const dependsOn =
      record["dependsOn"] === undefined
        ? undefined
        : parseBoundedStringArray(record["dependsOn"], 30, 1, 64);
    if (record["dependsOn"] !== undefined && !dependsOn) return undefined;
    output.push({
      id: record["id"],
      title: record["title"],
      description: record["description"],
      verification: record["verification"],
      ...(dependsOn ? { dependsOn } : {}),
    });
  }
  return output;
}

function parsePlanDependencyUpdates(
  input: unknown,
): ReplanExecutionPlanRequest["dependencyUpdates"] | undefined {
  if (!Array.isArray(input) || input.length > 30) return undefined;
  const output: NonNullable<ReplanExecutionPlanRequest["dependencyUpdates"]> =
    [];
  for (const value of input) {
    const record = requestRecord(value, ["stepId", "dependsOn"]);
    if (!record || !boundedString(record["stepId"], 1, 64)) {
      return undefined;
    }
    const dependsOn = parseBoundedStringArray(record["dependsOn"], 30, 1, 64);
    if (!dependsOn) return undefined;
    output.push({
      stepId: record["stepId"],
      dependsOn,
    });
  }
  return output;
}

function parsePlanArtifactInputs(
  input: unknown,
): CreateExecutionPlanRequest["artifacts"] | undefined {
  if (!Array.isArray(input) || input.length > 30) return undefined;
  const output: NonNullable<CreateExecutionPlanRequest["artifacts"]> = [];
  for (const value of input) {
    const record = requestRecord(value, ["id", "path", "kind", "description"]);
    const kind = record?.["kind"];
    if (
      !record ||
      !boundedString(record["id"], 1, 64) ||
      !boundedString(record["path"], 1, 500) ||
      !boundedString(record["description"], 1, 1_000) ||
      (kind !== undefined &&
        kind !== "file" &&
        kind !== "directory" &&
        kind !== "url" &&
        kind !== "other")
    ) {
      return undefined;
    }
    output.push({
      id: record["id"],
      path: record["path"],
      description: record["description"],
      ...(typeof kind === "string" ? { kind } : {}),
    });
  }
  return output;
}

function parseTransitionPlanStepRequest(
  input: unknown,
): TransitionPlanStepRequest | undefined {
  const record = requestRecord(input, [
    "action",
    "runId",
    "evidence",
    "blocker",
  ]);
  const action = record?.["action"];
  const runId = record?.["runId"];
  const evidence = record?.["evidence"];
  const blocker = record?.["blocker"];
  if (
    !record ||
    (action !== "start" &&
      action !== "complete" &&
      action !== "block" &&
      action !== "skip" &&
      action !== "reopen") ||
    (runId !== undefined &&
      (typeof runId !== "string" || !/^run_[a-z0-9]{8,80}$/.test(runId))) ||
    (evidence !== undefined && !boundedString(evidence, 0, 2_000)) ||
    (blocker !== undefined && !boundedString(blocker, 0, 1_000))
  ) {
    return undefined;
  }
  return {
    action,
    ...(typeof runId === "string" ? { runId } : {}),
    ...(typeof evidence === "string" ? { evidence } : {}),
    ...(typeof blocker === "string" ? { blocker } : {}),
  };
}

function parseUpdateArtifactManifestRequest(
  input: unknown,
): UpdateArtifactManifestRequest | undefined {
  const record = requestRecord(input, [
    "status",
    "sha256",
    "sizeBytes",
    "sourceRunId",
    "evidence",
    "observeWorkspace",
  ]);
  const status = record?.["status"];
  const sha256 = record?.["sha256"];
  const sizeBytes = record?.["sizeBytes"];
  const sourceRunId = record?.["sourceRunId"];
  const evidence = record?.["evidence"];
  const observeWorkspace = record?.["observeWorkspace"];
  if (
    !record ||
    (status !== "expected" &&
      status !== "produced" &&
      status !== "verified" &&
      status !== "missing" &&
      status !== "superseded") ||
    (sha256 !== undefined &&
      (typeof sha256 !== "string" || !/^[a-f0-9]{64}$/.test(sha256))) ||
    (sizeBytes !== undefined &&
      (typeof sizeBytes !== "number" ||
        !Number.isSafeInteger(sizeBytes) ||
        sizeBytes < 0)) ||
    (sourceRunId !== undefined &&
      (typeof sourceRunId !== "string" ||
        !/^run_[a-z0-9]{8,80}$/.test(sourceRunId))) ||
    (evidence !== undefined && !boundedString(evidence, 0, 2_000)) ||
    (observeWorkspace !== undefined && typeof observeWorkspace !== "boolean") ||
    (observeWorkspace === true &&
      ((status !== "verified" && status !== "missing") ||
        sha256 !== undefined ||
        sizeBytes !== undefined))
  ) {
    return undefined;
  }
  return {
    status,
    ...(typeof sha256 === "string" ? { sha256 } : {}),
    ...(typeof sizeBytes === "number" ? { sizeBytes } : {}),
    ...(typeof sourceRunId === "string" ? { sourceRunId } : {}),
    ...(typeof evidence === "string" ? { evidence } : {}),
    ...(observeWorkspace === true ? { observeWorkspace } : {}),
  };
}

function parseBoundedStringArray(
  input: unknown,
  maxItems: number,
  minLength: number,
  maxLength: number,
): string[] | undefined {
  if (!Array.isArray(input) || input.length > maxItems) return undefined;
  return input.every((value) => boundedString(value, minLength, maxLength))
    ? input
    : undefined;
}

function boundedString(
  value: unknown,
  minLength: number,
  maxLength: number,
): value is string {
  return (
    typeof value === "string" &&
    value.length >= minLength &&
    value.length <= maxLength
  );
}

function isSha256Hex(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

async function assertAvailableModel(
  services: NapierServices,
  model: { provider: string; id: string },
): Promise<void> {
  const provider = model.provider.trim().toLowerCase();
  const id = model.id.trim();
  if (provider === "napier" && id === "demo") return;
  const ref = { provider, id };
  await services.models.resolveConfigured(ref);
}

async function assertAdvisorReviewModel(
  services: NapierServices,
  primaryModel: { provider: string; id: string },
  reviewModel: { provider: string; id: string } | undefined,
): Promise<void> {
  if (!reviewModel) return;
  const primaryProvider = primaryModel.provider.trim().toLowerCase();
  const primaryId = primaryModel.id.trim();
  const reviewerProvider = reviewModel.provider.trim().toLowerCase();
  const reviewerId = reviewModel.id.trim();
  if (reviewerProvider === primaryProvider && reviewerId === primaryId) {
    throw new Error(
      "Model Advisor review model must differ from the primary model",
    );
  }
  if (reviewerProvider === "napier" && reviewerId === "demo") {
    throw new Error("Model Advisor review model must use a live model");
  }
  await assertAvailableModel(services, {
    provider: reviewerProvider,
    id: reviewerId,
  });
}

function scheduleChangedFields(
  before: AutomationSchedule,
  after: AutomationSchedule,
): string[] {
  const fields: Array<keyof AutomationSchedule> = [
    "name",
    "prompt",
    "model",
    "trigger",
    "status",
    "misfirePolicy",
    "nextRunAt",
  ];
  return fields.filter(
    (field) => JSON.stringify(before[field]) !== JSON.stringify(after[field]),
  );
}

function isInboundRetryPolicyError(error: unknown): error is Error {
  return error instanceof Error && error.message.startsWith("Inbound retry ");
}

function isInboundSignaturePolicyError(error: unknown): error is Error {
  return (
    error instanceof Error && error.message.startsWith("Inbound signature ")
  );
}

function isInboundChannelPolicyTemplateError(error: unknown): error is Error {
  return (
    error instanceof Error &&
    error.message.startsWith("Inbound channel policy template")
  );
}

function isInboundMessageValidationError(error: unknown): error is Error {
  return (
    error instanceof Error &&
    (error.message.startsWith("Inbound idempotency ") ||
      error.message.startsWith("Inbound message ") ||
      error.message.startsWith("Inbound model "))
  );
}

function isCredentialReferenceMutationError(error: unknown): error is Error {
  if (!(error instanceof Error)) return false;
  return (
    error.message.startsWith("Provider already has an active credential") ||
    error.message.startsWith("Credential reference source already exists") ||
    error.message.startsWith("Credential secret") ||
    error.message.startsWith("macOS Keychain")
  );
}

async function appendAutomationEvent(
  services: NapierServices,
  schedule: AutomationSchedule,
  type: string,
  payload: Record<string, JsonValue>,
): Promise<void> {
  await services.store.appendEvent({
    threadId: schedule.threadId,
    runId: createId("runctl"),
    type,
    category: "automation",
    visibility: "user",
    payload,
  });
}

type InboundMessageParseResult =
  | { ok: true; body: InboundMessageRequest }
  | { ok: false; error: string };

function parseInboundMessageForAdapter(
  adapter: InboundChannelAdapter,
  source: string,
  headers: Headers,
): InboundMessageParseResult {
  if (adapter === "napier_json") return parseNapierJsonInboundMessage(source);
  if (adapter === "github_webhook") {
    return parseGitHubWebhookInboundMessage(source, headers);
  }
  if (adapter === "slack_event") return parseSlackEventInboundMessage(source);
  if (adapter === "linear_webhook") {
    return parseLinearWebhookInboundMessage(source);
  }
  return { ok: false, error: "Inbound channel adapter is invalid" };
}

function parseNapierJsonInboundMessage(
  source: string,
): InboundMessageParseResult {
  const parsed = parseJsonObject(source);
  if (!parsed.ok) return parsed;
  const record = requestRecord(parsed.record, [
    "idempotencyKey",
    "message",
    "model",
  ]);
  const idempotencyKey = normalizeInboundVisibleText(
    record?.["idempotencyKey"],
    8,
    200,
  );
  const message = normalizeInboundPromptText(record?.["message"], 20_000);
  const model =
    record?.["model"] === undefined
      ? undefined
      : parseModelRef(record["model"]);
  if (
    !record ||
    !idempotencyKey ||
    !message ||
    (record["model"] !== undefined && !model)
  ) {
    return { ok: false, error: "Inbound body is invalid" };
  }
  return {
    ok: true,
    body: {
      idempotencyKey,
      message,
      ...(model ? { model } : {}),
    },
  };
}

function parseGitHubWebhookInboundMessage(
  source: string,
  headers: Headers,
): InboundMessageParseResult {
  const delivery = normalizeInboundVisibleText(
    headers.get("x-github-delivery"),
    1,
    193,
  );
  if (!delivery) {
    return { ok: false, error: "GitHub delivery header is required" };
  }
  const event = normalizeInboundVisibleText(
    headers.get("x-github-event"),
    1,
    80,
  );
  if (!event) {
    return { ok: false, error: "GitHub event header is required" };
  }
  const parsed = parseJsonObject(source);
  if (!parsed.ok) return parsed;
  return {
    ok: true,
    body: {
      idempotencyKey: `github:${delivery}`,
      message: buildGitHubWebhookMessage(event, delivery, parsed.record),
    },
  };
}

function parseSlackEventInboundMessage(
  source: string,
): InboundMessageParseResult {
  const parsed = parseJsonObject(source);
  if (!parsed.ok) return parsed;
  const eventId = normalizeInboundVisibleText(
    parsed.record["event_id"],
    4,
    160,
  );
  if (!eventId) {
    return { ok: false, error: "Slack event_id is required" };
  }
  return {
    ok: true,
    body: {
      idempotencyKey: `slack:${eventId}`,
      message: buildSlackEventMessage(eventId, parsed.record),
    },
  };
}

function parseLinearWebhookInboundMessage(
  source: string,
): InboundMessageParseResult {
  const parsed = parseJsonObject(source);
  if (!parsed.ok) return parsed;
  const seed = linearWebhookSeed(parsed.record);
  if (!seed.ok) return { ok: false, error: seed.error };
  return {
    ok: true,
    body: {
      idempotencyKey: `linear:${sha256Text(seed.value).slice(0, 32)}`,
      message: buildLinearWebhookMessage(seed.value, parsed.record),
    },
  };
}

function previewHeaders(headers: Record<string, string> | undefined): Headers {
  const output = new Headers();
  for (const [key, value] of Object.entries(headers ?? {})) {
    output.set(key, value);
  }
  return output;
}

function createInboundChannelAdapterPreview(
  channelId: string,
  adapter: InboundChannelAdapter,
  source: string,
  body: InboundMessageRequest,
): InboundChannelAdapterPreview {
  const messagePreview = body.message.replace(/\s+/g, " ").trim().slice(0, 240);
  const content = {
    channelId,
    adapter,
    bodySha256: sha256Text(source),
    idempotencyFingerprint: sha256Text(
      `${channelId}\0${body.idempotencyKey}`,
    ).slice(0, 12),
    messageSha256: sha256Text(body.message),
    messagePreview,
    ...(body.model ? { model: body.model } : {}),
  };
  return {
    ...content,
    contentSha256: sha256Text(JSON.stringify(content)),
  };
}

function createInboundDeliveryQualification(
  delivery: InboundDelivery,
  currentAdapterCatalogSha256: string,
): InboundDeliveryQualification {
  const diagnostics: string[] = [];
  if (!delivery.bodySha256) {
    diagnostics.push("Inbound body SHA-256 evidence is missing.");
  }
  if (!delivery.adapterCatalogSha256) {
    diagnostics.push("Inbound adapter catalog SHA-256 evidence is missing.");
  }
  const status: InboundDeliveryQualification["status"] =
    diagnostics.length > 0
      ? "evidence_missing"
      : delivery.adapterCatalogSha256 !== currentAdapterCatalogSha256
        ? "adapter_catalog_drift"
        : "qualified";
  if (status === "adapter_catalog_drift") {
    diagnostics.push(
      "Inbound adapter catalog SHA-256 differs from the current server catalog.",
    );
  }
  if (status === "qualified") {
    diagnostics.push(
      "Inbound delivery evidence is present and matches the current adapter catalog.",
    );
  }
  const content = {
    schemaVersion: 1 as const,
    channelId: delivery.channelId,
    deliveryId: delivery.id,
    status,
    ...(delivery.bodySha256 ? { bodySha256: delivery.bodySha256 } : {}),
    ...(delivery.adapterCatalogSha256
      ? { adapterCatalogSha256: delivery.adapterCatalogSha256 }
      : {}),
    currentAdapterCatalogSha256,
    diagnostics,
  };
  return {
    ...content,
    contentSha256: sha256Json(content),
  };
}

function inboundDeadLetterQualificationSummary(
  artifact: InboundDeadLetterExport,
): Record<string, number> {
  if (
    artifact.qualifiedCount !== undefined &&
    artifact.evidenceMissingCount !== undefined &&
    artifact.adapterCatalogDriftCount !== undefined
  ) {
    return {
      qualifiedCount: artifact.qualifiedCount,
      evidenceMissingCount: artifact.evidenceMissingCount,
      adapterCatalogDriftCount: artifact.adapterCatalogDriftCount,
    };
  }
  return {
    qualifiedCount: artifact.deliveries.filter(
      (delivery) => delivery.qualificationStatus === "qualified",
    ).length,
    evidenceMissingCount: artifact.deliveries.filter(
      (delivery) => delivery.qualificationStatus === "evidence_missing",
    ).length,
    adapterCatalogDriftCount: artifact.deliveries.filter(
      (delivery) => delivery.qualificationStatus === "adapter_catalog_drift",
    ).length,
  };
}

function parseJsonObject(source: string):
  | {
      ok: true;
      record: Record<string, unknown>;
    }
  | { ok: false; error: string } {
  let input: unknown;
  try {
    input = JSON.parse(source);
  } catch {
    return { ok: false, error: "Inbound body must be valid JSON" };
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "Inbound body must be a JSON object" };
  }
  return { ok: true, record: input as Record<string, unknown> };
}

function normalizeInboundVisibleText(
  input: unknown,
  minLength: number,
  maxLength: number,
): string | undefined {
  if (typeof input !== "string") return undefined;
  const normalized = input.trim();
  if (
    normalized.length < minLength ||
    normalized.length > maxLength ||
    /[\u0000-\u001f\u007f]/.test(normalized)
  ) {
    return undefined;
  }
  return normalized;
}

function normalizeInboundPromptText(
  input: unknown,
  maxLength: number,
): string | undefined {
  if (typeof input !== "string") return undefined;
  const normalized = input.replace(/\r\n?/g, "\n").trim();
  return normalized && normalized.length <= maxLength ? normalized : undefined;
}

function buildGitHubWebhookMessage(
  event: string,
  delivery: string,
  payload: Record<string, unknown>,
): string {
  const deliveryFingerprint = sha256Text(delivery).slice(0, 12);
  const lines = [
    `GitHub ${event} webhook received.`,
    `Delivery fingerprint: ${deliveryFingerprint}.`,
  ];
  const repository = gitHubNestedString(payload, "repository", "full_name");
  const action = gitHubStringField(payload, "action", 120);
  const sender = gitHubNestedString(payload, "sender", "login");
  const ref = gitHubStringField(payload, "ref", 240);
  const compare = gitHubStringField(payload, "compare", 500);
  const subject = gitHubWebhookSubject(payload);

  if (repository) lines.push(`Repository: ${repository}.`);
  if (action) lines.push(`Action: ${action}.`);
  if (sender) lines.push(`Sender: ${sender}.`);
  if (subject) lines.push(subject);
  if (ref) lines.push(`Ref: ${ref}.`);
  if (compare) lines.push(`Compare: ${compare}.`);

  return lines.join("\n").slice(0, 4_000);
}

function buildSlackEventMessage(
  eventId: string,
  payload: Record<string, unknown>,
): string {
  const event = slackRecordField(payload, "event");
  const topLevelType = slackStringField(payload, "type", 120);
  const eventType = event
    ? slackStringField(event, "type", 120)
    : slackStringField(payload, "event_type", 120);
  const lines = [
    `Slack ${eventType ?? topLevelType ?? "event"} webhook received.`,
    `Event fingerprint: ${sha256Text(eventId).slice(0, 12)}.`,
  ];
  const team = slackStringField(payload, "team_id", 120);
  const app = slackStringField(payload, "api_app_id", 120);
  const channel = event ? slackStringField(event, "channel", 120) : undefined;
  const user =
    event &&
    (slackStringField(event, "user", 120) ??
      slackStringField(event, "bot_id", 120));
  const text = event ? slackStringField(event, "text", 500) : undefined;
  const ts =
    event &&
    (slackStringField(event, "event_ts", 80) ??
      slackStringField(event, "ts", 80));

  if (topLevelType) lines.push(`Envelope type: ${topLevelType}.`);
  if (team) lines.push(`Team: ${team}.`);
  if (app) lines.push(`App: ${app}.`);
  if (channel) lines.push(`Channel: ${channel}.`);
  if (user) lines.push(`Actor: ${user}.`);
  if (ts) lines.push(`Timestamp: ${ts}.`);
  if (text) lines.push(`Text: "${text}"`);

  return lines.join("\n").slice(0, 4_000);
}

function linearWebhookSeed(
  payload: Record<string, unknown>,
): { ok: true; value: string } | { ok: false; error: string } {
  const data = linearRecordField(payload, "data");
  const webhookId = linearStringField(payload, "webhookId", 160);
  const timestamp =
    linearStringField(payload, "createdAt", 80) ??
    linearStringField(payload, "webhookTimestamp", 80);
  const type = linearStringField(payload, "type", 120);
  const action = linearStringField(payload, "action", 120);
  const dataId = data ? linearStringField(data, "id", 160) : undefined;
  if (!webhookId) return { ok: false, error: "Linear webhookId is required" };
  if (!timestamp) {
    return { ok: false, error: "Linear webhook timestamp is required" };
  }
  if (!type || !action || !dataId) {
    return { ok: false, error: "Linear webhook event identity is incomplete" };
  }
  return {
    ok: true,
    value: [webhookId, timestamp, type, action, dataId].join("\0"),
  };
}

function buildLinearWebhookMessage(
  seed: string,
  payload: Record<string, unknown>,
): string {
  const data = linearRecordField(payload, "data");
  const type = linearStringField(payload, "type", 120);
  const action = linearStringField(payload, "action", 120);
  const organization = linearStringField(payload, "organizationId", 160);
  const identifier = data
    ? (linearStringField(data, "identifier", 120) ??
      linearStringField(data, "number", 120))
    : undefined;
  const title = data ? linearStringField(data, "title", 300) : undefined;
  const url = data ? linearStringField(data, "url", 500) : undefined;
  const state = linearNestedString(data, "state", "name", 160);
  const assignee = linearNestedString(data, "assignee", "name", 160);
  const team =
    linearNestedString(data, "team", "key", 80) ??
    linearNestedString(data, "team", "name", 160);
  const project = linearNestedString(data, "project", "name", 160);
  const lines = [
    `Linear ${type ?? "entity"} ${action ?? "changed"} webhook received.`,
    `Event fingerprint: ${sha256Text(seed).slice(0, 12)}.`,
  ];

  if (organization) lines.push(`Organization: ${organization}.`);
  if (team) lines.push(`Team: ${team}.`);
  if (project) lines.push(`Project: ${project}.`);
  if (identifier || title) {
    lines.push(
      `Subject: ${[identifier, title ? `"${title}"` : undefined]
        .filter(Boolean)
        .join(" ")}`,
    );
  }
  if (state) lines.push(`State: ${state}.`);
  if (assignee) lines.push(`Assignee: ${assignee}.`);
  if (url) lines.push(`URL: ${url}`);

  return lines.join("\n").slice(0, 4_000);
}

function gitHubWebhookSubject(
  payload: Record<string, unknown>,
): string | undefined {
  const pullRequest = gitHubRecordField(payload, "pull_request");
  if (pullRequest) return gitHubIssueLikeLine("Pull request", pullRequest);
  const issue = gitHubRecordField(payload, "issue");
  if (issue) return gitHubIssueLikeLine("Issue", issue);
  const release = gitHubRecordField(payload, "release");
  if (release) return gitHubIssueLikeLine("Release", release);
  const checkRun = gitHubRecordField(payload, "check_run");
  if (checkRun) return gitHubWorkflowLikeLine("Check run", checkRun);
  const checkSuite = gitHubRecordField(payload, "check_suite");
  if (checkSuite) return gitHubWorkflowLikeLine("Check suite", checkSuite);
  const workflowRun = gitHubRecordField(payload, "workflow_run");
  if (workflowRun) return gitHubWorkflowLikeLine("Workflow run", workflowRun);
  const headCommit = gitHubRecordField(payload, "head_commit");
  if (headCommit) return gitHubCommitLine(headCommit);
  return undefined;
}

function gitHubIssueLikeLine(
  label: string,
  record: Record<string, unknown>,
): string {
  const number = gitHubNumberField(record, "number");
  const title =
    gitHubStringField(record, "title", 220) ??
    gitHubStringField(record, "name", 220) ??
    gitHubStringField(record, "tag_name", 220);
  const url = gitHubStringField(record, "html_url", 500);
  return [
    `${label}${number === undefined ? "" : ` #${number}`}:`,
    title ? `"${title}"` : "untitled",
    url ? `(${url})` : undefined,
  ]
    .filter(Boolean)
    .join(" ");
}

function gitHubWorkflowLikeLine(
  label: string,
  record: Record<string, unknown>,
): string {
  const name =
    gitHubStringField(record, "name", 220) ??
    gitHubStringField(record, "workflow_name", 220);
  const status = gitHubStringField(record, "status", 120);
  const conclusion = gitHubStringField(record, "conclusion", 120);
  const url = gitHubStringField(record, "html_url", 500);
  return [
    `${label}:`,
    name ?? "unnamed",
    status ? `status=${status}` : undefined,
    conclusion ? `conclusion=${conclusion}` : undefined,
    url ? `(${url})` : undefined,
  ]
    .filter(Boolean)
    .join(" ");
}

function gitHubCommitLine(record: Record<string, unknown>): string {
  const id = gitHubStringField(record, "id", 80);
  const message = gitHubStringField(record, "message", 300)?.split("\n")[0];
  const url = gitHubStringField(record, "url", 500);
  return [
    "Head commit:",
    id ? id.slice(0, 12) : undefined,
    message ? `"${message}"` : undefined,
    url ? `(${url})` : undefined,
  ]
    .filter(Boolean)
    .join(" ");
}

function gitHubRecordField(
  record: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  const value = record[key];
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function gitHubNestedString(
  record: Record<string, unknown>,
  key: string,
  nestedKey: string,
): string | undefined {
  const nested = gitHubRecordField(record, key);
  return nested ? gitHubStringField(nested, nestedKey, 240) : undefined;
}

function gitHubStringField(
  record: Record<string, unknown>,
  key: string,
  maxLength: number,
): string | undefined {
  const value = record[key];
  if (typeof value !== "string") return undefined;
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized ? normalized.slice(0, maxLength) : undefined;
}

function gitHubNumberField(
  record: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = record[key];
  return typeof value === "number" && Number.isSafeInteger(value)
    ? value
    : undefined;
}

function slackRecordField(
  record: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  const value = record[key];
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function slackStringField(
  record: Record<string, unknown>,
  key: string,
  maxLength: number,
): string | undefined {
  const value = record[key];
  if (typeof value !== "string") return undefined;
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized ? normalized.slice(0, maxLength) : undefined;
}

function linearRecordField(
  record: Record<string, unknown> | undefined,
  key: string,
): Record<string, unknown> | undefined {
  if (!record) return undefined;
  const value = record[key];
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function linearNestedString(
  record: Record<string, unknown> | undefined,
  key: string,
  nestedKey: string,
  maxLength: number,
): string | undefined {
  const nested = linearRecordField(record, key);
  return nested ? linearStringField(nested, nestedKey, maxLength) : undefined;
}

function linearStringField(
  record: Record<string, unknown>,
  key: string,
  maxLength: number,
): string | undefined {
  const value = record[key];
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const normalized = String(value).replace(/\s+/g, " ").trim();
  return normalized ? normalized.slice(0, maxLength) : undefined;
}

function inboundChannelToken(headers: Headers): string | undefined {
  const authorization = headers.get("authorization")?.trim();
  const bearer = authorization?.match(/^Bearer ([A-Za-z0-9_-]{32,128})$/);
  if (bearer?.[1]) return bearer[1];
  const direct = headers.get("x-napier-channel-token")?.trim();
  return direct && /^[A-Za-z0-9_-]{32,128}$/.test(direct) ? direct : undefined;
}

function validInboundSignature(
  headers: Headers,
  body: string,
  token: string,
  toleranceSeconds: number,
): boolean {
  const timestamp = headers.get("x-napier-channel-timestamp")?.trim();
  const signature = headers.get("x-napier-channel-signature")?.trim();
  if (!timestamp || !signature) return false;
  const timestampMs = Date.parse(timestamp);
  if (
    !Number.isFinite(timestampMs) ||
    Math.abs(Date.now() - timestampMs) > toleranceSeconds * 1_000
  ) {
    return false;
  }
  const expected = createHmac("sha256", token)
    .update(`${timestamp}\n${body}`)
    .digest("hex");
  const normalized = signature.startsWith("sha256=")
    ? signature.slice("sha256=".length)
    : signature;
  if (!/^[a-f0-9]{64}$/i.test(normalized)) return false;
  const left = Buffer.from(expected, "hex");
  const right = Buffer.from(normalized.toLowerCase(), "hex");
  return right.byteLength === left.byteLength && timingSafeEqual(left, right);
}

function memoryReviewEventType(action: ReviewMemoryRequest["action"]): string {
  return {
    approve: "memory.approved",
    reject: "memory.rejected",
    archive: "memory.archived",
    restore: "memory.restored",
    refresh: "memory.refreshed",
    mark_stale: "memory.stale",
  }[action];
}

function evaluationSuiteEventPayload(
  suite: EvaluationSuite,
): Record<string, JsonValue> {
  return {
    suiteId: suite.id,
    name: suite.name,
    revision: suite.revision,
    baselineRunId: suite.baselineRunId,
    candidateRunIds: suite.candidateRunIds,
    rubric: suite.rubric.name,
    evaluatorModel: {
      provider: suite.evaluatorModel.provider,
      id: suite.evaluatorModel.id,
    },
    gate: {
      minimumPassRate: suite.gate.minimumPassRate,
      minimumCandidateScore: suite.gate.minimumCandidateScore,
      allowInconclusive: suite.gate.allowInconclusive,
    },
  };
}

function evaluationCasebookEventPayload(
  casebook: EvaluationCasebook,
): Record<string, JsonValue> {
  const revision = casebook.revisions.at(-1)!;
  return {
    casebookId: casebook.id,
    name: revision.name,
    revision: revision.revision,
    source: revision.source,
    caseCount: revision.caseIds.length,
    contentSha256: revision.contentSha256,
    ...(revision.caseId ? { caseId: revision.caseId } : {}),
    ...(revision.sourceEvaluationId
      ? { sourceEvaluationId: revision.sourceEvaluationId }
      : {}),
  };
}

function parseCreateEvaluationCasebookRequest(
  input: unknown,
): CreateEvaluationCasebookRequest | undefined {
  const record = requestRecord(input, ["threadId", "name", "description"]);
  if (
    !record ||
    typeof record["threadId"] !== "string" ||
    !record["threadId"].trim() ||
    !validCasebookName(record["name"]) ||
    !validCasebookDescription(record["description"])
  ) {
    return undefined;
  }
  return {
    threadId: record["threadId"],
    name: record["name"],
    ...(typeof record["description"] === "string"
      ? { description: record["description"] }
      : {}),
  };
}

function parseUpdateEvaluationCasebookRequest(
  input: unknown,
): UpdateEvaluationCasebookRequest | undefined {
  const record = requestRecord(input, ["threadId", "name", "description"]);
  if (
    !record ||
    typeof record["threadId"] !== "string" ||
    !record["threadId"].trim() ||
    (record["name"] !== undefined && !validCasebookName(record["name"])) ||
    !validCasebookDescription(record["description"])
  ) {
    return undefined;
  }
  return {
    threadId: record["threadId"],
    ...(typeof record["name"] === "string" ? { name: record["name"] } : {}),
    ...(typeof record["description"] === "string"
      ? { description: record["description"] }
      : {}),
  };
}

function parseCurateEvaluationCaseRequest(
  input: unknown,
): CurateEvaluationCaseRequest | undefined {
  const record = requestRecord(input, ["threadId", "evaluationId"]);
  return record &&
    typeof record["threadId"] === "string" &&
    record["threadId"].trim() &&
    typeof record["evaluationId"] === "string" &&
    record["evaluationId"].trim()
    ? {
        threadId: record["threadId"],
        evaluationId: record["evaluationId"],
      }
    : undefined;
}

function parseRemoveEvaluationCaseRequest(
  input: unknown,
): RemoveEvaluationCaseRequest | undefined {
  const record = requestRecord(input, ["threadId"]);
  return record &&
    typeof record["threadId"] === "string" &&
    record["threadId"].trim()
    ? { threadId: record["threadId"] }
    : undefined;
}

function parseExecuteEvaluationCasebookRequest(
  input: unknown,
): ExecuteEvaluationCasebookRequest | undefined {
  const record = requestRecord(input, ["threadId", "model", "gate"]);
  const model = requestRecord(record?.["model"], ["provider", "id"]);
  const gate =
    record?.["gate"] === undefined
      ? undefined
      : requestRecord(record["gate"], [
          "minimumAgreementRate",
          "allowInconclusive",
        ]);
  const minimumAgreementRate = gate?.["minimumAgreementRate"];
  const allowInconclusive = gate?.["allowInconclusive"];
  if (
    !record ||
    typeof record["threadId"] !== "string" ||
    !record["threadId"].trim() ||
    !model ||
    typeof model["provider"] !== "string" ||
    !model["provider"].trim() ||
    typeof model["id"] !== "string" ||
    !model["id"].trim() ||
    (record["gate"] !== undefined && !gate) ||
    (minimumAgreementRate !== undefined &&
      (typeof minimumAgreementRate !== "number" ||
        !Number.isFinite(minimumAgreementRate) ||
        minimumAgreementRate < 0 ||
        minimumAgreementRate > 1)) ||
    (allowInconclusive !== undefined && typeof allowInconclusive !== "boolean")
  ) {
    return undefined;
  }
  return {
    threadId: record["threadId"],
    model: {
      provider: model["provider"],
      id: model["id"],
    },
    ...(gate
      ? {
          gate: {
            ...(typeof minimumAgreementRate === "number"
              ? { minimumAgreementRate }
              : {}),
            ...(typeof allowInconclusive === "boolean"
              ? { allowInconclusive }
              : {}),
          },
        }
      : {}),
  };
}

function parseSubmitEvaluationReviewerBallotRequest(
  input: unknown,
): SubmitEvaluationReviewerBallotRequest | undefined {
  const record = requestRecord(input, [
    "reviewerId",
    "reviewerName",
    "expectedVerdict",
    "note",
  ]);
  const reviewerId = record?.["reviewerId"];
  const reviewerName = record?.["reviewerName"];
  const expectedVerdict = record?.["expectedVerdict"];
  const note = record?.["note"];
  if (
    !record ||
    typeof reviewerId !== "string" ||
    !/^[a-z][a-z0-9_-]{1,63}$/i.test(reviewerId.trim()) ||
    typeof reviewerName !== "string" ||
    !reviewerName.replace(/\s+/g, " ").trim() ||
    reviewerName.replace(/\s+/g, " ").trim().length > 80 ||
    typeof expectedVerdict !== "string" ||
    !["left_better", "right_better", "tie", "inconclusive"].includes(
      expectedVerdict,
    ) ||
    (note !== undefined && typeof note !== "string") ||
    (typeof note === "string" &&
      note.replace(/\s+/g, " ").trim().length > 1_000)
  ) {
    return undefined;
  }
  return {
    reviewerId,
    reviewerName,
    expectedVerdict:
      expectedVerdict as SubmitEvaluationReviewerBallotRequest["expectedVerdict"],
    ...(typeof note === "string" ? { note } : {}),
  };
}

function parseResolveEvaluationConsensusRequest(
  input: unknown,
): ResolveEvaluationConsensusRequest | undefined {
  const record = requestRecord(input, ["gate"]);
  const gate =
    record?.["gate"] === undefined
      ? undefined
      : requestRecord(record["gate"], [
          "minimumReviewers",
          "minimumAgreementRate",
          "allowInconclusive",
        ]);
  const minimumReviewers = gate?.["minimumReviewers"];
  const minimumAgreementRate = gate?.["minimumAgreementRate"];
  const allowInconclusive = gate?.["allowInconclusive"];
  if (
    !record ||
    (record["gate"] !== undefined && !gate) ||
    (minimumReviewers !== undefined &&
      (!Number.isInteger(minimumReviewers) ||
        Number(minimumReviewers) < 2 ||
        Number(minimumReviewers) > 9)) ||
    (minimumAgreementRate !== undefined &&
      (typeof minimumAgreementRate !== "number" ||
        !Number.isFinite(minimumAgreementRate) ||
        minimumAgreementRate < 0.5 ||
        minimumAgreementRate > 1)) ||
    (allowInconclusive !== undefined && typeof allowInconclusive !== "boolean")
  ) {
    return undefined;
  }
  const normalizedGate: Partial<EvaluationConsensusGate> = {
    ...(typeof minimumReviewers === "number" ? { minimumReviewers } : {}),
    ...(typeof minimumAgreementRate === "number"
      ? { minimumAgreementRate }
      : {}),
    ...(typeof allowInconclusive === "boolean" ? { allowInconclusive } : {}),
  };
  return gate ? { gate: normalizedGate } : {};
}

function parseCreateReceiptTrustAnchorRequest(
  input: unknown,
): CreateReceiptTrustAnchorRequest | undefined {
  const record = requestRecord(input, ["threadId", "label", "source"]);
  const threadId = record?.["threadId"];
  const label = record?.["label"];
  const source = requestRecord(record?.["source"], [
    "type",
    "variable",
    "publicKeySpki",
  ]);
  const type = source?.["type"];
  if (
    !record ||
    typeof threadId !== "string" ||
    !/^thread_[a-z0-9]{8,80}$/.test(threadId) ||
    typeof label !== "string" ||
    !label.replace(/\s+/g, " ").trim() ||
    label.replace(/\s+/g, " ").trim().length > 100 ||
    !source ||
    (type !== "environment" && type !== "public_key")
  ) {
    return undefined;
  }
  if (type === "environment") {
    const variable = source["variable"];
    if (
      Object.keys(source).some((key) => key !== "type" && key !== "variable") ||
      typeof variable !== "string" ||
      !/^[A-Z_][A-Z0-9_]{1,127}$/.test(variable.trim().toUpperCase())
    ) {
      return undefined;
    }
    return {
      threadId,
      label,
      source: { type, variable },
    };
  }
  const publicKeySpki = source["publicKeySpki"];
  if (
    Object.keys(source).some(
      (key) => key !== "type" && key !== "publicKeySpki",
    ) ||
    typeof publicKeySpki !== "string" ||
    publicKeySpki.length === 0 ||
    publicKeySpki.length > 4_096
  ) {
    return undefined;
  }
  return {
    threadId,
    label,
    source: { type, publicKeySpki },
  };
}

function parseRevokeReceiptTrustAnchorRequest(
  input: unknown,
): RevokeReceiptTrustAnchorRequest | undefined {
  const record = requestRecord(input, ["threadId"]);
  const threadId = record?.["threadId"];
  return record &&
    typeof threadId === "string" &&
    /^thread_[a-z0-9]{8,80}$/.test(threadId)
    ? { threadId }
    : undefined;
}

function parseSignTrustedReceiptRequest(
  input: unknown,
  requireThreadId: boolean,
): SignTrustedReceiptRequest | undefined {
  const record = requestRecord(
    input,
    requireThreadId ? ["trustAnchorId", "threadId"] : ["trustAnchorId"],
  );
  const trustAnchorId = record?.["trustAnchorId"];
  const threadId = record?.["threadId"];
  if (
    !record ||
    typeof trustAnchorId !== "string" ||
    !/^trustkey_[a-z0-9]{8,80}$/.test(trustAnchorId) ||
    (requireThreadId &&
      (typeof threadId !== "string" ||
        !/^thread_[a-z0-9]{8,80}$/.test(threadId)))
  ) {
    return undefined;
  }
  return {
    trustAnchorId,
    ...(typeof threadId === "string" ? { threadId } : {}),
  };
}

function parseSignReceiptTrustAnchorDirectoryMetadataRequest(
  input: unknown,
): SignReceiptTrustAnchorDirectoryMetadataRequest | undefined {
  const record = requestRecord(input, [
    "trustAnchorId",
    "threadId",
    "publisher",
    "sourceUrlSha256",
    "sourceOriginSha256",
    "expiresAt",
  ]);
  const trustAnchorId = record?.["trustAnchorId"];
  const threadId = record?.["threadId"];
  const publisher = record?.["publisher"];
  const sourceUrlSha256 = record?.["sourceUrlSha256"];
  const sourceOriginSha256 = record?.["sourceOriginSha256"];
  const expiresAt = record?.["expiresAt"];
  const normalizedPublisher =
    typeof publisher === "string"
      ? publisher.replace(/\s+/g, " ").trim()
      : undefined;
  if (
    !record ||
    typeof trustAnchorId !== "string" ||
    !/^trustkey_[a-z0-9]{8,80}$/.test(trustAnchorId) ||
    !validThreadId(threadId) ||
    !normalizedPublisher ||
    normalizedPublisher.length > 120 ||
    /[\u0000-\u001f\u007f<>]/.test(normalizedPublisher) ||
    (sourceUrlSha256 === undefined) !== (sourceOriginSha256 === undefined) ||
    (sourceUrlSha256 !== undefined && !isSha256Hex(sourceUrlSha256)) ||
    (sourceOriginSha256 !== undefined && !isSha256Hex(sourceOriginSha256)) ||
    (expiresAt !== undefined &&
      (typeof expiresAt !== "string" ||
        !Number.isFinite(Date.parse(expiresAt))))
  ) {
    return undefined;
  }
  return {
    trustAnchorId,
    threadId,
    publisher: normalizedPublisher,
    ...(typeof sourceUrlSha256 === "string" ? { sourceUrlSha256 } : {}),
    ...(typeof sourceOriginSha256 === "string" ? { sourceOriginSha256 } : {}),
    ...(typeof expiresAt === "string" ? { expiresAt } : {}),
  };
}

function parsePromoteEvaluationQualificationBaselineRequest(
  input: unknown,
): PromoteEvaluationQualificationBaselineRequest | undefined {
  const record = requestRecord(input, ["threadId", "trustAnchorId"]);
  const threadId = record?.["threadId"];
  const trustAnchorId = record?.["trustAnchorId"];
  return record &&
    typeof threadId === "string" &&
    /^thread_[a-z0-9]{8,80}$/.test(threadId) &&
    typeof trustAnchorId === "string" &&
    /^trustkey_[a-z0-9]{8,80}$/.test(trustAnchorId)
    ? { threadId, trustAnchorId }
    : undefined;
}

function parseVerifyTrustedReceiptRequest(
  input: unknown,
): VerifyTrustedReceiptRequest | undefined {
  const record = requestRecord(input, [
    "envelope",
    "directory",
    "directoryPolicy",
  ]);
  const directoryPolicy = parseReceiptTrustAnchorDirectoryVerificationPolicy(
    record?.["directoryPolicy"],
  );
  if (
    !record ||
    record["envelope"] === undefined ||
    (record["directoryPolicy"] !== undefined &&
      record["directory"] === undefined) ||
    (record["directoryPolicy"] !== undefined && !directoryPolicy)
  ) {
    return undefined;
  }
  return {
    envelope: record["envelope"],
    ...(record["directory"] !== undefined
      ? { directory: record["directory"] }
      : {}),
    ...(directoryPolicy ? { directoryPolicy } : {}),
  };
}

function parseVerifyReceiptTrustAnchorDirectoryMetadataRequest(
  input: unknown,
): VerifyReceiptTrustAnchorDirectoryMetadataRequest | undefined {
  const record = requestRecord(input, [
    "envelope",
    "directory",
    "directoryPolicy",
    "trustDirectory",
    "trustDirectoryPolicy",
  ]);
  const directoryPolicy = parseReceiptTrustAnchorDirectoryVerificationPolicy(
    record?.["directoryPolicy"],
  );
  const trustDirectoryPolicy =
    parseReceiptTrustAnchorDirectoryVerificationPolicy(
      record?.["trustDirectoryPolicy"],
    );
  if (
    !record ||
    record["envelope"] === undefined ||
    record["directory"] === undefined ||
    (record["directoryPolicy"] !== undefined && !directoryPolicy) ||
    (record["trustDirectoryPolicy"] !== undefined &&
      record["trustDirectory"] === undefined) ||
    (record["trustDirectoryPolicy"] !== undefined && !trustDirectoryPolicy)
  ) {
    return undefined;
  }
  return {
    envelope: record["envelope"],
    directory: record["directory"],
    ...(directoryPolicy ? { directoryPolicy } : {}),
    ...(record["trustDirectory"] !== undefined
      ? { trustDirectory: record["trustDirectory"] }
      : {}),
    ...(trustDirectoryPolicy ? { trustDirectoryPolicy } : {}),
  };
}

function parseVerifyReceiptTrustAnchorDirectoryQuorumPromotionBaselineRequest(
  input: unknown,
): VerifyReceiptTrustAnchorDirectoryQuorumPromotionBaselineRequest | undefined {
  const record = requestRecord(input, [
    "baseline",
    "trustDirectory",
    "trustDirectoryPolicy",
  ]);
  const trustDirectoryPolicy =
    parseReceiptTrustAnchorDirectoryVerificationPolicy(
      record?.["trustDirectoryPolicy"],
    );
  if (
    !record ||
    record["baseline"] === undefined ||
    (record["trustDirectoryPolicy"] !== undefined &&
      record["trustDirectory"] === undefined) ||
    (record["trustDirectoryPolicy"] !== undefined && !trustDirectoryPolicy)
  ) {
    return undefined;
  }
  return {
    baseline: record["baseline"],
    ...(record["trustDirectory"] !== undefined
      ? { trustDirectory: record["trustDirectory"] }
      : {}),
    ...(trustDirectoryPolicy ? { trustDirectoryPolicy } : {}),
  };
}

function parseVerifyReceiptTrustAnchorDirectoryQuorumActivationDecisionHistoryRequest(
  input: unknown,
):
  | VerifyReceiptTrustAnchorDirectoryQuorumActivationDecisionHistoryRequest
  | undefined {
  const record = requestRecord(input, ["history"]);
  if (!record || record["history"] === undefined) return undefined;
  return {
    history: record["history"],
  };
}

function parseVerifyReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRequest(
  input: unknown,
):
  | VerifyReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRequest
  | undefined {
  const record = requestRecord(input, ["checkpoint"]);
  if (!record || record["checkpoint"] === undefined) return undefined;
  return {
    checkpoint: record["checkpoint"],
  };
}

function parseDiscoverReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRequest(
  input: unknown,
):
  | DiscoverReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRequest
  | undefined {
  const record = requestRecord(input, [
    "sourceUrl",
    "policy",
    "trustDirectory",
    "trustDirectoryPolicy",
  ]);
  const policy =
    parseReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointDiscoveryPolicy(
      record?.["policy"],
    );
  const trustDirectoryPolicy =
    parseReceiptTrustAnchorDirectoryVerificationPolicy(
      record?.["trustDirectoryPolicy"],
    );
  if (
    !record ||
    typeof record["sourceUrl"] !== "string" ||
    record["sourceUrl"].length === 0 ||
    record["sourceUrl"].length > 2_048 ||
    (record["policy"] !== undefined && !policy) ||
    (record["trustDirectoryPolicy"] !== undefined &&
      record["trustDirectory"] === undefined) ||
    (record["trustDirectoryPolicy"] !== undefined && !trustDirectoryPolicy)
  ) {
    return undefined;
  }
  return {
    sourceUrl: record["sourceUrl"],
    ...(policy ? { policy } : {}),
    ...(record["trustDirectory"] !== undefined
      ? { trustDirectory: record["trustDirectory"] }
      : {}),
    ...(trustDirectoryPolicy ? { trustDirectoryPolicy } : {}),
  };
}

function parseSignReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRequest(
  input: unknown,
):
  | SignReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRequest
  | undefined {
  const record = requestRecord(input, ["threadId", "trustAnchorId"]);
  const threadId = record?.["threadId"];
  const trustAnchorId = record?.["trustAnchorId"];
  if (
    !record ||
    !validThreadId(threadId) ||
    typeof trustAnchorId !== "string" ||
    !/^trustkey_[a-f0-9]{20}$/.test(trustAnchorId)
  ) {
    return undefined;
  }
  return {
    threadId,
    trustAnchorId,
  };
}

function parseApplyReceiptTrustAnchorDirectoryQuorumActivationSelectionRequest(
  input: unknown,
):
  | ApplyReceiptTrustAnchorDirectoryQuorumActivationSelectionRequest
  | undefined {
  const record = requestRecord(input, [
    "threadId",
    "activationDecisionRecordId",
    "expectedCurrentSelectionSha256",
    "rotationProposalEnvelope",
  ]);
  const threadId = record?.["threadId"];
  const activationDecisionRecordId = record?.["activationDecisionRecordId"];
  const expectedCurrentSelectionSha256 =
    record?.["expectedCurrentSelectionSha256"];
  if (
    !record ||
    !validThreadId(threadId) ||
    typeof activationDecisionRecordId !== "string" ||
    !/^trustqad_[a-z0-9]{8,80}$/.test(activationDecisionRecordId) ||
    typeof expectedCurrentSelectionSha256 !== "string" ||
    (expectedCurrentSelectionSha256 !== "" &&
      !isSha256Hex(expectedCurrentSelectionSha256))
  ) {
    return undefined;
  }
  return {
    threadId,
    activationDecisionRecordId,
    expectedCurrentSelectionSha256,
    ...(record["rotationProposalEnvelope"] !== undefined
      ? {
          rotationProposalEnvelope: record[
            "rotationProposalEnvelope"
          ] as TrustedReceiptEnvelope<ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposal>,
        }
      : {}),
  };
}

function parseApplyReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalRequest(
  input: unknown,
):
  | ApplyReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalRequest
  | undefined {
  const record = requestRecord(input, [
    "threadId",
    "expectedSubscriptionRevision",
    "expectedSubscriptionSha256",
    "approvalEnvelope",
  ]);
  const threadId = record?.["threadId"];
  const expectedSubscriptionRevision = record?.["expectedSubscriptionRevision"];
  const expectedSubscriptionSha256 = record?.["expectedSubscriptionSha256"];
  if (
    !record ||
    !validThreadId(threadId) ||
    !isNonNegativeInteger(expectedSubscriptionRevision) ||
    expectedSubscriptionRevision < 1 ||
    typeof expectedSubscriptionSha256 !== "string" ||
    !isSha256Hex(expectedSubscriptionSha256) ||
    record["approvalEnvelope"] === undefined
  ) {
    return undefined;
  }
  return {
    threadId,
    expectedSubscriptionRevision,
    expectedSubscriptionSha256,
    approvalEnvelope: record[
      "approvalEnvelope"
    ] as TrustedReceiptEnvelope<ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApproval>,
  };
}

function parseReviewReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyRequest(
  input: unknown,
):
  | ReviewReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyRequest
  | undefined {
  const record = requestRecord(input, [
    "threadId",
    "expectedSubscriptionRevision",
    "expectedSubscriptionSha256",
    "approvalEnvelopes",
    "approvalPolicy",
  ]);
  const threadId = record?.["threadId"];
  const expectedSubscriptionRevision = record?.["expectedSubscriptionRevision"];
  const expectedSubscriptionSha256 = record?.["expectedSubscriptionSha256"];
  const approvalEnvelopes = record?.["approvalEnvelopes"];
  const approvalPolicyRecord = requestRecord(record?.["approvalPolicy"], [
    "minimumDistinctSignerCount",
    "requiredSignerKeyIds",
  ]);
  const minimumDistinctSignerCount =
    approvalPolicyRecord?.["minimumDistinctSignerCount"];
  const requiredSignerKeyIds = approvalPolicyRecord?.["requiredSignerKeyIds"];
  if (
    !record ||
    !validThreadId(threadId) ||
    !isNonNegativeInteger(expectedSubscriptionRevision) ||
    expectedSubscriptionRevision < 1 ||
    typeof expectedSubscriptionSha256 !== "string" ||
    !isSha256Hex(expectedSubscriptionSha256) ||
    !Array.isArray(approvalEnvelopes) ||
    approvalEnvelopes.length < 1 ||
    approvalEnvelopes.length > 10 ||
    !approvalPolicyRecord ||
    !isNonNegativeInteger(minimumDistinctSignerCount) ||
    minimumDistinctSignerCount < 1 ||
    minimumDistinctSignerCount > 10 ||
    (requiredSignerKeyIds !== undefined &&
      (!Array.isArray(requiredSignerKeyIds) ||
        requiredSignerKeyIds.length > 10 ||
        !requiredSignerKeyIds.every(isSha256Hex)))
  ) {
    return undefined;
  }
  const uniqueRequiredSignerKeyIds =
    requiredSignerKeyIds === undefined
      ? []
      : Array.from(new Set(requiredSignerKeyIds as string[])).sort();
  return {
    threadId,
    expectedSubscriptionRevision,
    expectedSubscriptionSha256,
    approvalEnvelopes:
      approvalEnvelopes as TrustedReceiptEnvelope<ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApproval>[],
    approvalPolicy: {
      minimumDistinctSignerCount,
      ...(uniqueRequiredSignerKeyIds.length > 0
        ? { requiredSignerKeyIds: uniqueRequiredSignerKeyIds }
        : {}),
    },
  };
}

function parseApplyReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyRequest(
  input: unknown,
):
  | ApplyReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyRequest
  | undefined {
  return parseReviewReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyRequest(
    input,
  );
}

function parseQueueReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyApplyRequest(
  input: unknown,
):
  | QueueReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyApplyRequest
  | undefined {
  const record = requestRecord(input, [
    "threadId",
    "expectedSubscriptionRevision",
    "expectedSubscriptionSha256",
    "approvalEnvelopes",
    "approvalPolicy",
    "approvalPolicyBaselineSha256",
    "applyAfter",
  ]);
  const reviewRequest =
    parseReviewReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyRequest(
      record
        ? {
            threadId: record["threadId"],
            expectedSubscriptionRevision:
              record["expectedSubscriptionRevision"],
            expectedSubscriptionSha256: record["expectedSubscriptionSha256"],
            approvalEnvelopes: record["approvalEnvelopes"],
            approvalPolicy: record["approvalPolicy"],
          }
        : undefined,
    );
  const approvalPolicyBaselineSha256 = record?.["approvalPolicyBaselineSha256"];
  const applyAfter = record?.["applyAfter"];
  if (
    !reviewRequest ||
    typeof approvalPolicyBaselineSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(approvalPolicyBaselineSha256) ||
    (applyAfter !== undefined &&
      (typeof applyAfter !== "string" ||
        !Number.isFinite(Date.parse(applyAfter))))
  ) {
    return undefined;
  }
  return {
    ...reviewRequest,
    approvalPolicyBaselineSha256,
    ...(typeof applyAfter === "string" ? { applyAfter } : {}),
  };
}

function parsePromoteReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaselineRequest(
  input: unknown,
):
  | PromoteReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaselineRequest
  | undefined {
  const record = requestRecord(input, [
    "threadId",
    "trustAnchorId",
    "expectedSubscriptionRevision",
    "expectedSubscriptionSha256",
    "approvalEnvelopes",
    "approvalPolicy",
  ]);
  const reviewRequest =
    parseReviewReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyRequest(
      record
        ? {
            threadId: record["threadId"],
            expectedSubscriptionRevision:
              record["expectedSubscriptionRevision"],
            expectedSubscriptionSha256: record["expectedSubscriptionSha256"],
            approvalEnvelopes: record["approvalEnvelopes"],
            approvalPolicy: record["approvalPolicy"],
          }
        : undefined,
    );
  const trustAnchorId = record?.["trustAnchorId"];
  if (
    !reviewRequest ||
    typeof trustAnchorId !== "string" ||
    !/^trustkey_[a-z0-9]{8,80}$/.test(trustAnchorId)
  ) {
    return undefined;
  }
  return {
    ...reviewRequest,
    trustAnchorId,
  };
}

function parseVerifyReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaselineRequest(
  input: unknown,
):
  | VerifyReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaselineRequest
  | undefined {
  const record = requestRecord(input, [
    "baseline",
    "trustDirectory",
    "trustDirectoryPolicy",
  ]);
  const trustDirectoryPolicy =
    parseReceiptTrustAnchorDirectoryVerificationPolicy(
      record?.["trustDirectoryPolicy"],
    );
  if (
    !record ||
    record["baseline"] === undefined ||
    (record["trustDirectoryPolicy"] !== undefined &&
      record["trustDirectory"] === undefined) ||
    (record["trustDirectoryPolicy"] !== undefined && !trustDirectoryPolicy)
  ) {
    return undefined;
  }
  return {
    baseline: record["baseline"],
    ...(record["trustDirectory"] !== undefined
      ? { trustDirectory: record["trustDirectory"] }
      : {}),
    ...(trustDirectoryPolicy ? { trustDirectoryPolicy } : {}),
  };
}

function parseImportReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaselineRequest(
  input: unknown,
):
  | ImportReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaselineRequest
  | undefined {
  const record = requestRecord(input, [
    "baseline",
    "threadId",
    "expectedCurrentBaselineSha256",
    "trustDirectory",
    "trustDirectoryPolicy",
  ]);
  const verifyRequest = record
    ? parseVerifyReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaselineRequest(
        {
          baseline: record["baseline"],
          ...(record["trustDirectory"] !== undefined
            ? { trustDirectory: record["trustDirectory"] }
            : {}),
          ...(record["trustDirectoryPolicy"] !== undefined
            ? { trustDirectoryPolicy: record["trustDirectoryPolicy"] }
            : {}),
        },
      )
    : undefined;
  const threadId = record?.["threadId"];
  const expectedCurrentBaselineSha256 =
    record?.["expectedCurrentBaselineSha256"];
  if (
    !record ||
    !verifyRequest ||
    !validThreadId(threadId) ||
    typeof expectedCurrentBaselineSha256 !== "string" ||
    (expectedCurrentBaselineSha256 !== "" &&
      !isSha256Hex(expectedCurrentBaselineSha256))
  ) {
    return undefined;
  }
  return {
    ...verifyRequest,
    threadId,
    expectedCurrentBaselineSha256,
  };
}

function parseReviewReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationRequest(
  input: unknown,
):
  | ReviewReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationRequest
  | undefined {
  const record = requestRecord(input, [
    "activationDecisionRecordId",
    "expectedCurrentSelectionSha256",
    "checkpointRegistryQuorumPolicy",
  ]);
  const activationDecisionRecordId = record?.["activationDecisionRecordId"];
  const expectedCurrentSelectionSha256 =
    record?.["expectedCurrentSelectionSha256"];
  const checkpointRegistryQuorumPolicyInput =
    record?.["checkpointRegistryQuorumPolicy"];
  const checkpointRegistryQuorumPolicy =
    checkpointRegistryQuorumPolicyInput === undefined
      ? undefined
      : parseReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumPolicy(
          checkpointRegistryQuorumPolicyInput,
        );
  if (
    !record ||
    (checkpointRegistryQuorumPolicyInput !== undefined &&
      !checkpointRegistryQuorumPolicy) ||
    typeof activationDecisionRecordId !== "string" ||
    !/^trustqad_[a-z0-9]{8,80}$/.test(activationDecisionRecordId) ||
    typeof expectedCurrentSelectionSha256 !== "string" ||
    (expectedCurrentSelectionSha256 !== "" &&
      !isSha256Hex(expectedCurrentSelectionSha256))
  ) {
    return undefined;
  }
  return {
    activationDecisionRecordId,
    expectedCurrentSelectionSha256,
    ...(checkpointRegistryQuorumPolicyInput !== undefined &&
    checkpointRegistryQuorumPolicy
      ? { checkpointRegistryQuorumPolicy }
      : {}),
  };
}

function parseProposeReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationRequest(
  input: unknown,
):
  | ProposeReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationRequest
  | undefined {
  const record = requestRecord(input, [
    "activationDecisionRecordId",
    "expectedCurrentSelectionSha256",
    "checkpointRegistryQuorumPolicy",
    "checkpointRegistryQuorumBaselineId",
    "expectedCheckpointRegistryQuorumBaselineSha256",
  ]);
  const reviewRequest = record
    ? parseReviewReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationRequest(
        {
          activationDecisionRecordId: record["activationDecisionRecordId"],
          expectedCurrentSelectionSha256:
            record["expectedCurrentSelectionSha256"],
          ...(record["checkpointRegistryQuorumPolicy"] !== undefined
            ? {
                checkpointRegistryQuorumPolicy:
                  record["checkpointRegistryQuorumPolicy"],
              }
            : {}),
        },
      )
    : undefined;
  const checkpointRegistryQuorumBaselineId =
    record?.["checkpointRegistryQuorumBaselineId"];
  const expectedCheckpointRegistryQuorumBaselineSha256 =
    record?.["expectedCheckpointRegistryQuorumBaselineSha256"];
  if (
    !record ||
    !reviewRequest ||
    (checkpointRegistryQuorumBaselineId !== undefined &&
      (typeof checkpointRegistryQuorumBaselineId !== "string" ||
        !/^trustcpqb_[a-z0-9]{8,80}$/.test(
          checkpointRegistryQuorumBaselineId,
        ))) ||
    (expectedCheckpointRegistryQuorumBaselineSha256 !== undefined &&
      (typeof expectedCheckpointRegistryQuorumBaselineSha256 !== "string" ||
        !isSha256Hex(expectedCheckpointRegistryQuorumBaselineSha256)))
  ) {
    return undefined;
  }
  return {
    ...reviewRequest,
    ...(typeof checkpointRegistryQuorumBaselineId === "string"
      ? { checkpointRegistryQuorumBaselineId }
      : {}),
    ...(typeof expectedCheckpointRegistryQuorumBaselineSha256 === "string"
      ? { expectedCheckpointRegistryQuorumBaselineSha256 }
      : {}),
  };
}

function parseSignReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalRequest(
  input: unknown,
):
  | SignReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalRequest
  | undefined {
  const record = requestRecord(input, [
    "threadId",
    "trustAnchorId",
    "activationDecisionRecordId",
    "expectedCurrentSelectionSha256",
    "checkpointRegistryQuorumPolicy",
    "checkpointRegistryQuorumBaselineId",
    "expectedCheckpointRegistryQuorumBaselineSha256",
  ]);
  const proposalRequest = record
    ? parseProposeReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationRequest(
        {
          activationDecisionRecordId: record["activationDecisionRecordId"],
          expectedCurrentSelectionSha256:
            record["expectedCurrentSelectionSha256"],
          ...(record["checkpointRegistryQuorumPolicy"] !== undefined
            ? {
                checkpointRegistryQuorumPolicy:
                  record["checkpointRegistryQuorumPolicy"],
              }
            : {}),
          ...(record["checkpointRegistryQuorumBaselineId"] !== undefined
            ? {
                checkpointRegistryQuorumBaselineId:
                  record["checkpointRegistryQuorumBaselineId"],
              }
            : {}),
          ...(record["expectedCheckpointRegistryQuorumBaselineSha256"] !==
          undefined
            ? {
                expectedCheckpointRegistryQuorumBaselineSha256:
                  record["expectedCheckpointRegistryQuorumBaselineSha256"],
              }
            : {}),
        },
      )
    : undefined;
  const threadId = record?.["threadId"];
  const trustAnchorId = record?.["trustAnchorId"];
  if (
    !record ||
    !proposalRequest ||
    !validThreadId(threadId) ||
    typeof trustAnchorId !== "string" ||
    !/^trustkey_[a-f0-9]{20}$/.test(trustAnchorId)
  ) {
    return undefined;
  }
  return {
    ...proposalRequest,
    threadId,
    trustAnchorId,
  };
}

function parseSignReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalRequest(
  input: unknown,
):
  | SignReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalRequest
  | undefined {
  const record = requestRecord(input, [
    "threadId",
    "trustAnchorId",
    "expectedSubscriptionRevision",
    "expectedSubscriptionSha256",
    "expectedDiscoverySha256",
    "expectedEnvelopeSha256",
    "expectedProposalSha256",
    "expiresAt",
    "queueForApply",
    "applyAfter",
  ]);
  const threadId = record?.["threadId"];
  const trustAnchorId = record?.["trustAnchorId"];
  const expectedSubscriptionRevision = record?.["expectedSubscriptionRevision"];
  const expectedSubscriptionSha256 = record?.["expectedSubscriptionSha256"];
  const expectedDiscoverySha256 = record?.["expectedDiscoverySha256"];
  const expectedEnvelopeSha256 = record?.["expectedEnvelopeSha256"];
  const expectedProposalSha256 = record?.["expectedProposalSha256"];
  const expiresAt = record?.["expiresAt"];
  const queueForApply = record?.["queueForApply"];
  const applyAfter = record?.["applyAfter"];
  if (
    !record ||
    !validThreadId(threadId) ||
    typeof trustAnchorId !== "string" ||
    !/^trustkey_[a-f0-9]{20}$/.test(trustAnchorId) ||
    !isNonNegativeInteger(expectedSubscriptionRevision) ||
    expectedSubscriptionRevision < 1 ||
    typeof expectedSubscriptionSha256 !== "string" ||
    !isSha256Hex(expectedSubscriptionSha256) ||
    (expectedDiscoverySha256 !== undefined &&
      (typeof expectedDiscoverySha256 !== "string" ||
        !isSha256Hex(expectedDiscoverySha256))) ||
    (expectedEnvelopeSha256 !== undefined &&
      (typeof expectedEnvelopeSha256 !== "string" ||
        !isSha256Hex(expectedEnvelopeSha256))) ||
    (expectedProposalSha256 !== undefined &&
      (typeof expectedProposalSha256 !== "string" ||
        !isSha256Hex(expectedProposalSha256))) ||
    (expiresAt !== undefined &&
      (typeof expiresAt !== "string" ||
        !Number.isFinite(Date.parse(expiresAt)))) ||
    (queueForApply !== undefined && typeof queueForApply !== "boolean") ||
    (applyAfter !== undefined &&
      (typeof applyAfter !== "string" ||
        !Number.isFinite(Date.parse(applyAfter))))
  ) {
    return undefined;
  }
  return {
    threadId,
    trustAnchorId,
    expectedSubscriptionRevision,
    expectedSubscriptionSha256,
    ...(typeof expectedDiscoverySha256 === "string"
      ? { expectedDiscoverySha256 }
      : {}),
    ...(typeof expectedEnvelopeSha256 === "string"
      ? { expectedEnvelopeSha256 }
      : {}),
    ...(typeof expectedProposalSha256 === "string"
      ? { expectedProposalSha256 }
      : {}),
    ...(typeof expiresAt === "string" ? { expiresAt } : {}),
    ...(typeof queueForApply === "boolean" ? { queueForApply } : {}),
    ...(typeof applyAfter === "string" ? { applyAfter } : {}),
  };
}

function parseDiscoverReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalRequest(
  input: unknown,
):
  | DiscoverReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalRequest
  | undefined {
  const record = requestRecord(input, ["threadId", "sourceUrl", "policy"]);
  const threadId = record?.["threadId"];
  const sourceUrl = record?.["sourceUrl"];
  const policy =
    parseReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalDiscoveryPolicy(
      record?.["policy"],
    );
  if (
    !record ||
    !validThreadId(threadId) ||
    typeof sourceUrl !== "string" ||
    sourceUrl.length === 0 ||
    sourceUrl.length > 2_048 ||
    (record["policy"] !== undefined && !policy)
  ) {
    return undefined;
  }
  return {
    threadId,
    sourceUrl,
    ...(policy ? { policy } : {}),
  };
}

function parseReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalDiscoveryPolicy(
  input: unknown,
):
  | ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalDiscoveryPolicy
  | undefined {
  if (input === undefined) return {};
  const record = requestRecord(input, [
    "maxEnvelopeAgeMs",
    "expectedEnvelopeSha256",
    "expectedProposalSha256",
    "expectedActivationDecisionRecordId",
    "expectedCurrentSelectionSha256",
    "requiredSignerKeyIds",
  ]);
  if (!record) return undefined;
  const maxEnvelopeAgeMs = record["maxEnvelopeAgeMs"];
  const expectedEnvelopeSha256 = record["expectedEnvelopeSha256"];
  const expectedProposalSha256 = record["expectedProposalSha256"];
  const expectedActivationDecisionRecordId =
    record["expectedActivationDecisionRecordId"];
  const expectedCurrentSelectionSha256 =
    record["expectedCurrentSelectionSha256"];
  const requiredSignerKeyIds = record["requiredSignerKeyIds"];
  if (
    (maxEnvelopeAgeMs !== undefined &&
      (!isNonNegativeInteger(maxEnvelopeAgeMs) ||
        maxEnvelopeAgeMs > 365 * 24 * 60 * 60 * 1_000)) ||
    (expectedEnvelopeSha256 !== undefined &&
      (typeof expectedEnvelopeSha256 !== "string" ||
        !isSha256Hex(expectedEnvelopeSha256))) ||
    (expectedProposalSha256 !== undefined &&
      (typeof expectedProposalSha256 !== "string" ||
        !isSha256Hex(expectedProposalSha256))) ||
    (expectedActivationDecisionRecordId !== undefined &&
      (typeof expectedActivationDecisionRecordId !== "string" ||
        !/^trustqad_[a-z0-9]{8,80}$/.test(
          expectedActivationDecisionRecordId,
        ))) ||
    (expectedCurrentSelectionSha256 !== undefined &&
      (typeof expectedCurrentSelectionSha256 !== "string" ||
        (expectedCurrentSelectionSha256 !== "" &&
          !isSha256Hex(expectedCurrentSelectionSha256)))) ||
    !validSha256List(
      requiredSignerKeyIds,
      MAX_RECEIPT_TRUST_DIRECTORY_SUBSCRIPTIONS,
    )
  ) {
    return undefined;
  }
  return {
    ...(maxEnvelopeAgeMs !== undefined ? { maxEnvelopeAgeMs } : {}),
    ...(typeof expectedEnvelopeSha256 === "string"
      ? { expectedEnvelopeSha256 }
      : {}),
    ...(typeof expectedProposalSha256 === "string"
      ? { expectedProposalSha256 }
      : {}),
    ...(typeof expectedActivationDecisionRecordId === "string"
      ? { expectedActivationDecisionRecordId }
      : {}),
    ...(typeof expectedCurrentSelectionSha256 === "string"
      ? { expectedCurrentSelectionSha256 }
      : {}),
    ...(Array.isArray(requiredSignerKeyIds) && requiredSignerKeyIds.length > 0
      ? { requiredSignerKeyIds: requiredSignerKeyIds as string[] }
      : {}),
  };
}

function parseVerifyReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalRequest(
  input: unknown,
):
  | VerifyReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalRequest
  | undefined {
  return parseApplyReceiptTrustAnchorDirectoryQuorumActivationSelectionRequest(
    input,
  ) as
    | VerifyReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalRequest
    | undefined;
}

function parseImportReceiptTrustAnchorDirectoryQuorumPromotionBaselineRequest(
  input: unknown,
): ImportReceiptTrustAnchorDirectoryQuorumPromotionBaselineRequest | undefined {
  const record = requestRecord(input, [
    "baseline",
    "threadId",
    "expectedCurrentBaselineSha256",
    "importPolicy",
    "trustDirectory",
    "trustDirectoryPolicy",
  ]);
  const threadId = record?.["threadId"];
  const expectedCurrentBaselineSha256 =
    record?.["expectedCurrentBaselineSha256"];
  const importPolicy =
    parseReceiptTrustAnchorDirectoryQuorumPromotionBaselineImportPolicy(
      record?.["importPolicy"],
    );
  const trustDirectoryPolicy =
    parseReceiptTrustAnchorDirectoryVerificationPolicy(
      record?.["trustDirectoryPolicy"],
    );
  if (
    !record ||
    record["baseline"] === undefined ||
    !validThreadId(threadId) ||
    typeof expectedCurrentBaselineSha256 !== "string" ||
    (expectedCurrentBaselineSha256 !== "" &&
      !isSha256Hex(expectedCurrentBaselineSha256)) ||
    (record["importPolicy"] !== undefined && !importPolicy) ||
    (record["trustDirectoryPolicy"] !== undefined &&
      record["trustDirectory"] === undefined) ||
    (record["trustDirectoryPolicy"] !== undefined && !trustDirectoryPolicy)
  ) {
    return undefined;
  }
  return {
    baseline: record["baseline"],
    threadId,
    expectedCurrentBaselineSha256,
    ...(importPolicy ? { importPolicy } : {}),
    ...(record["trustDirectory"] !== undefined
      ? { trustDirectory: record["trustDirectory"] }
      : {}),
    ...(trustDirectoryPolicy ? { trustDirectoryPolicy } : {}),
  };
}

function parseSignReceiptTrustAnchorDirectoryQuorumActivationDecisionRequest(
  input: unknown,
): SignReceiptTrustAnchorDirectoryQuorumActivationDecisionRequest | undefined {
  const record = requestRecord(input, [
    "threadId",
    "trustAnchorId",
    "baselineId",
    "importPolicy",
    "trustDirectory",
    "trustDirectoryPolicy",
  ]);
  const threadId = record?.["threadId"];
  const trustAnchorId = record?.["trustAnchorId"];
  const baselineId = record?.["baselineId"];
  const importPolicy =
    parseReceiptTrustAnchorDirectoryQuorumPromotionBaselineImportPolicy(
      record?.["importPolicy"],
    );
  const trustDirectoryPolicy =
    parseReceiptTrustAnchorDirectoryVerificationPolicy(
      record?.["trustDirectoryPolicy"],
    );
  if (
    !record ||
    !validThreadId(threadId) ||
    typeof trustAnchorId !== "string" ||
    !/^trustkey_[a-z0-9]{8,80}$/.test(trustAnchorId) ||
    (baselineId !== undefined &&
      (typeof baselineId !== "string" ||
        !/^trustqpb_[a-z0-9]{8,80}$/.test(baselineId))) ||
    !importPolicy ||
    (record["trustDirectoryPolicy"] !== undefined &&
      record["trustDirectory"] === undefined) ||
    (record["trustDirectoryPolicy"] !== undefined && !trustDirectoryPolicy)
  ) {
    return undefined;
  }
  return {
    threadId,
    trustAnchorId,
    ...(typeof baselineId === "string" ? { baselineId } : {}),
    importPolicy,
    ...(record["trustDirectory"] !== undefined
      ? { trustDirectory: record["trustDirectory"] }
      : {}),
    ...(trustDirectoryPolicy ? { trustDirectoryPolicy } : {}),
  };
}

function parseVerifyReceiptTrustAnchorDirectoryRequest(
  input: unknown,
): VerifyReceiptTrustAnchorDirectoryRequest | undefined {
  const record = requestRecord(input, ["directory", "policy"]);
  const policy = parseReceiptTrustAnchorDirectoryVerificationPolicy(
    record?.["policy"],
  );
  if (
    !record ||
    record["directory"] === undefined ||
    (record["policy"] !== undefined && !policy)
  ) {
    return undefined;
  }
  return {
    directory: record["directory"],
    ...(policy ? { policy } : {}),
  };
}

function parseDiscoverReceiptTrustAnchorDirectoryRequest(
  input: unknown,
): DiscoverReceiptTrustAnchorDirectoryRequest | undefined {
  const record = requestRecord(input, ["sourceUrl", "policy"]);
  const sourceUrl = record?.["sourceUrl"];
  const policy = parseReceiptTrustAnchorDirectoryVerificationPolicy(
    record?.["policy"],
  );
  if (
    !record ||
    typeof sourceUrl !== "string" ||
    sourceUrl.length === 0 ||
    sourceUrl.length > 2_048 ||
    (record["policy"] !== undefined && !policy)
  ) {
    return undefined;
  }
  return {
    sourceUrl,
    ...(policy ? { policy } : {}),
  };
}

function parseReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointDiscoveryPolicy(
  input: unknown,
):
  | ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointDiscoveryPolicy
  | undefined {
  if (input === undefined) return {};
  const record = requestRecord(input, [
    "maxEnvelopeAgeMs",
    "expectedCheckpointSha256",
    "expectedSelectionSetSha256",
    "expectedSelectionChainTailSha256",
    "minimumSelectionCount",
    "requiredSignerKeyIds",
    "rejectRollback",
  ]);
  if (!record) return undefined;
  const maxEnvelopeAgeMs = record["maxEnvelopeAgeMs"];
  const expectedCheckpointSha256 = record["expectedCheckpointSha256"];
  const expectedSelectionSetSha256 = record["expectedSelectionSetSha256"];
  const expectedSelectionChainTailSha256 =
    record["expectedSelectionChainTailSha256"];
  const minimumSelectionCount = record["minimumSelectionCount"];
  const requiredSignerKeyIds = record["requiredSignerKeyIds"];
  const rejectRollback = record["rejectRollback"];
  if (
    (maxEnvelopeAgeMs !== undefined &&
      (!isNonNegativeInteger(maxEnvelopeAgeMs) ||
        maxEnvelopeAgeMs > 365 * 24 * 60 * 60 * 1_000)) ||
    (typeof expectedCheckpointSha256 === "string"
      ? expectedCheckpointSha256 !== "" &&
        !isSha256Hex(expectedCheckpointSha256)
      : expectedCheckpointSha256 !== undefined) ||
    (typeof expectedSelectionSetSha256 === "string"
      ? expectedSelectionSetSha256 !== "" &&
        !isSha256Hex(expectedSelectionSetSha256)
      : expectedSelectionSetSha256 !== undefined) ||
    (typeof expectedSelectionChainTailSha256 === "string"
      ? expectedSelectionChainTailSha256 !== "" &&
        !isSha256Hex(expectedSelectionChainTailSha256)
      : expectedSelectionChainTailSha256 !== undefined) ||
    (minimumSelectionCount !== undefined &&
      (!isNonNegativeInteger(minimumSelectionCount) ||
        minimumSelectionCount >
          MAX_RECEIPT_TRUST_CHECKPOINT_SELECTION_COUNT)) ||
    !validSha256List(
      requiredSignerKeyIds,
      MAX_RECEIPT_TRUST_DIRECTORY_SUBSCRIPTIONS,
    ) ||
    (rejectRollback !== undefined && typeof rejectRollback !== "boolean")
  ) {
    return undefined;
  }
  return {
    ...(maxEnvelopeAgeMs !== undefined ? { maxEnvelopeAgeMs } : {}),
    ...(typeof expectedCheckpointSha256 === "string"
      ? { expectedCheckpointSha256 }
      : {}),
    ...(typeof expectedSelectionSetSha256 === "string"
      ? { expectedSelectionSetSha256 }
      : {}),
    ...(typeof expectedSelectionChainTailSha256 === "string"
      ? { expectedSelectionChainTailSha256 }
      : {}),
    ...(minimumSelectionCount !== undefined ? { minimumSelectionCount } : {}),
    ...(requiredSignerKeyIds !== undefined
      ? {
          requiredSignerKeyIds: Array.from(
            new Set(requiredSignerKeyIds as string[]),
          ).sort(),
        }
      : {}),
    ...(rejectRollback !== undefined ? { rejectRollback } : {}),
  };
}

function parseEvaluateReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumRequest(
  input: unknown,
):
  | EvaluateReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumRequest
  | undefined {
  const record = requestRecord(input, ["policy"]);
  const policy =
    parseReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumPolicy(
      record?.["policy"],
    );
  if (!record || (record["policy"] !== undefined && !policy)) {
    return undefined;
  }
  return {
    ...(policy ? { policy } : {}),
  };
}

function parsePromoteReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselineRequest(
  input: unknown,
):
  | PromoteReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselineRequest
  | undefined {
  const record = requestRecord(input, ["policy", "threadId", "trustAnchorId"]);
  const policy =
    parseReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumPolicy(
      record?.["policy"],
    );
  const threadId = record?.["threadId"];
  const trustAnchorId = record?.["trustAnchorId"];
  if (
    !record ||
    (record["policy"] !== undefined && !policy) ||
    !validThreadId(threadId) ||
    typeof trustAnchorId !== "string" ||
    !/^trustkey_[a-z0-9]{8,80}$/.test(trustAnchorId)
  ) {
    return undefined;
  }
  return {
    ...(policy ? { policy } : {}),
    threadId,
    trustAnchorId,
  };
}

function parseVerifyReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselineRequest(
  input: unknown,
):
  | VerifyReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselineRequest
  | undefined {
  const record = requestRecord(input, [
    "baseline",
    "trustDirectory",
    "trustDirectoryPolicy",
  ]);
  const trustDirectoryPolicy =
    parseReceiptTrustAnchorDirectoryVerificationPolicy(
      record?.["trustDirectoryPolicy"],
    );
  if (
    !record ||
    record["baseline"] === undefined ||
    (record["trustDirectoryPolicy"] !== undefined &&
      record["trustDirectory"] === undefined) ||
    (record["trustDirectoryPolicy"] !== undefined && !trustDirectoryPolicy)
  ) {
    return undefined;
  }
  return {
    baseline: record["baseline"],
    ...(record["trustDirectory"] !== undefined
      ? { trustDirectory: record["trustDirectory"] }
      : {}),
    ...(trustDirectoryPolicy ? { trustDirectoryPolicy } : {}),
  };
}

function parseImportReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselineRequest(
  input: unknown,
):
  | ImportReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselineRequest
  | undefined {
  const record = requestRecord(input, [
    "baseline",
    "threadId",
    "expectedCurrentBaselineSha256",
    "trustDirectory",
    "trustDirectoryPolicy",
  ]);
  const verifyRequest = record
    ? parseVerifyReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselineRequest(
        {
          baseline: record["baseline"],
          ...(record["trustDirectory"] !== undefined
            ? { trustDirectory: record["trustDirectory"] }
            : {}),
          ...(record["trustDirectoryPolicy"] !== undefined
            ? { trustDirectoryPolicy: record["trustDirectoryPolicy"] }
            : {}),
        },
      )
    : undefined;
  const threadId = record?.["threadId"];
  const expectedCurrentBaselineSha256 =
    record?.["expectedCurrentBaselineSha256"];
  if (
    !record ||
    !verifyRequest ||
    !validThreadId(threadId) ||
    typeof expectedCurrentBaselineSha256 !== "string" ||
    (expectedCurrentBaselineSha256 !== "" &&
      !isSha256Hex(expectedCurrentBaselineSha256))
  ) {
    return undefined;
  }
  return {
    ...verifyRequest,
    threadId,
    expectedCurrentBaselineSha256,
  };
}

function parseReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumPolicy(
  input: unknown,
):
  | ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumPolicy
  | undefined {
  if (input === undefined) return {};
  const record = requestRecord(input, [
    "minimumSources",
    "minimumAgreementCount",
    "minimumDistinctSourceOrigins",
    "maxObservationAgeMs",
    "expectedCheckpointSha256",
    "expectedSelectionSetSha256",
    "expectedSelectionChainTailSha256",
    "minimumSelectionCount",
    "requiredSourceOriginSha256s",
    "requiredSignerKeyIds",
  ]);
  if (!record) return undefined;
  const minimumSources = record["minimumSources"];
  const minimumAgreementCount = record["minimumAgreementCount"];
  const minimumDistinctSourceOrigins = record["minimumDistinctSourceOrigins"];
  const maxObservationAgeMs = record["maxObservationAgeMs"];
  const expectedCheckpointSha256 = record["expectedCheckpointSha256"];
  const expectedSelectionSetSha256 = record["expectedSelectionSetSha256"];
  const expectedSelectionChainTailSha256 =
    record["expectedSelectionChainTailSha256"];
  const minimumSelectionCount = record["minimumSelectionCount"];
  const requiredSourceOriginSha256s = record["requiredSourceOriginSha256s"];
  const requiredSignerKeyIds = record["requiredSignerKeyIds"];
  if (
    (minimumSources !== undefined &&
      (!isNonNegativeInteger(minimumSources) ||
        minimumSources < 1 ||
        minimumSources > MAX_RECEIPT_TRUST_DIRECTORY_SUBSCRIPTIONS)) ||
    (minimumAgreementCount !== undefined &&
      (!isNonNegativeInteger(minimumAgreementCount) ||
        minimumAgreementCount < 1 ||
        minimumAgreementCount > MAX_RECEIPT_TRUST_DIRECTORY_SUBSCRIPTIONS)) ||
    (minimumDistinctSourceOrigins !== undefined &&
      (!isNonNegativeInteger(minimumDistinctSourceOrigins) ||
        minimumDistinctSourceOrigins < 1 ||
        minimumDistinctSourceOrigins >
          MAX_RECEIPT_TRUST_DIRECTORY_SUBSCRIPTIONS)) ||
    (maxObservationAgeMs !== undefined &&
      (!isNonNegativeInteger(maxObservationAgeMs) ||
        maxObservationAgeMs > 365 * 24 * 60 * 60 * 1_000)) ||
    (typeof expectedCheckpointSha256 === "string"
      ? expectedCheckpointSha256 !== "" &&
        !isSha256Hex(expectedCheckpointSha256)
      : expectedCheckpointSha256 !== undefined) ||
    (typeof expectedSelectionSetSha256 === "string"
      ? expectedSelectionSetSha256 !== "" &&
        !isSha256Hex(expectedSelectionSetSha256)
      : expectedSelectionSetSha256 !== undefined) ||
    (typeof expectedSelectionChainTailSha256 === "string"
      ? expectedSelectionChainTailSha256 !== "" &&
        !isSha256Hex(expectedSelectionChainTailSha256)
      : expectedSelectionChainTailSha256 !== undefined) ||
    (minimumSelectionCount !== undefined &&
      (!isNonNegativeInteger(minimumSelectionCount) ||
        minimumSelectionCount >
          MAX_RECEIPT_TRUST_CHECKPOINT_SELECTION_COUNT)) ||
    !validSha256List(
      requiredSourceOriginSha256s,
      MAX_RECEIPT_TRUST_DIRECTORY_SUBSCRIPTIONS,
    ) ||
    !validSha256List(
      requiredSignerKeyIds,
      MAX_RECEIPT_TRUST_DIRECTORY_SUBSCRIPTIONS,
    )
  ) {
    return undefined;
  }
  return {
    ...(minimumSources !== undefined ? { minimumSources } : {}),
    ...(minimumAgreementCount !== undefined ? { minimumAgreementCount } : {}),
    ...(minimumDistinctSourceOrigins !== undefined
      ? { minimumDistinctSourceOrigins }
      : {}),
    ...(maxObservationAgeMs !== undefined ? { maxObservationAgeMs } : {}),
    ...(typeof expectedCheckpointSha256 === "string"
      ? { expectedCheckpointSha256 }
      : {}),
    ...(typeof expectedSelectionSetSha256 === "string"
      ? { expectedSelectionSetSha256 }
      : {}),
    ...(typeof expectedSelectionChainTailSha256 === "string"
      ? { expectedSelectionChainTailSha256 }
      : {}),
    ...(minimumSelectionCount !== undefined ? { minimumSelectionCount } : {}),
    ...(requiredSourceOriginSha256s !== undefined
      ? {
          requiredSourceOriginSha256s: Array.from(
            new Set(requiredSourceOriginSha256s as string[]),
          ).sort(),
        }
      : {}),
    ...(requiredSignerKeyIds !== undefined
      ? {
          requiredSignerKeyIds: Array.from(
            new Set(requiredSignerKeyIds as string[]),
          ).sort(),
        }
      : {}),
  };
}

function parseCreateReceiptTrustAnchorDirectorySubscriptionRequest(
  input: unknown,
): CreateReceiptTrustAnchorDirectorySubscriptionRequest | undefined {
  const record = requestRecord(input, [
    "threadId",
    "label",
    "sourceUrl",
    "refreshIntervalMs",
    "policy",
  ]);
  const threadId = record?.["threadId"];
  const label = record?.["label"];
  const sourceUrl = record?.["sourceUrl"];
  const refreshIntervalMs = record?.["refreshIntervalMs"];
  const policy = parseReceiptTrustAnchorDirectoryVerificationPolicy(
    record?.["policy"],
  );
  if (
    !record ||
    !validThreadId(threadId) ||
    typeof label !== "string" ||
    label.trim().length < 1 ||
    label.trim().length > 100 ||
    typeof sourceUrl !== "string" ||
    sourceUrl.length < 1 ||
    sourceUrl.length > 2_048 ||
    !isNonNegativeInteger(refreshIntervalMs) ||
    refreshIntervalMs < MIN_RECEIPT_TRUST_DIRECTORY_REFRESH_INTERVAL_MS ||
    refreshIntervalMs > MAX_RECEIPT_TRUST_DIRECTORY_REFRESH_INTERVAL_MS ||
    !policy
  ) {
    return undefined;
  }
  return {
    threadId,
    label,
    sourceUrl,
    refreshIntervalMs,
    policy,
  };
}

function parseCreateReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionRequest(
  input: unknown,
):
  | CreateReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionRequest
  | undefined {
  const record = requestRecord(input, [
    "threadId",
    "label",
    "sourceUrl",
    "refreshIntervalMs",
    "policy",
  ]);
  const threadId = record?.["threadId"];
  const label = record?.["label"];
  const sourceUrl = record?.["sourceUrl"];
  const refreshIntervalMs = record?.["refreshIntervalMs"];
  const policy =
    parseReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointDiscoveryPolicy(
      record?.["policy"],
    );
  if (
    !record ||
    record["policy"] === undefined ||
    !validThreadId(threadId) ||
    typeof label !== "string" ||
    label.trim().length < 1 ||
    label.trim().length > 100 ||
    typeof sourceUrl !== "string" ||
    sourceUrl.length < 1 ||
    sourceUrl.length > 2_048 ||
    !isNonNegativeInteger(refreshIntervalMs) ||
    refreshIntervalMs < MIN_RECEIPT_TRUST_DIRECTORY_REFRESH_INTERVAL_MS ||
    refreshIntervalMs > MAX_RECEIPT_TRUST_DIRECTORY_REFRESH_INTERVAL_MS ||
    !policy
  ) {
    return undefined;
  }
  return {
    threadId,
    label: label.trim(),
    sourceUrl,
    refreshIntervalMs,
    policy,
  };
}

function parseCreateReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionRequest(
  input: unknown,
):
  | CreateReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionRequest
  | undefined {
  const record = requestRecord(input, [
    "threadId",
    "label",
    "sourceUrl",
    "refreshIntervalMs",
    "policy",
  ]);
  const threadId = record?.["threadId"];
  const label = record?.["label"];
  const sourceUrl = record?.["sourceUrl"];
  const refreshIntervalMs = record?.["refreshIntervalMs"];
  const policy =
    parseReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalDiscoveryPolicy(
      record?.["policy"],
    );
  if (
    !record ||
    record["policy"] === undefined ||
    !validThreadId(threadId) ||
    typeof label !== "string" ||
    label.trim().length < 1 ||
    label.trim().length > 100 ||
    typeof sourceUrl !== "string" ||
    sourceUrl.length < 1 ||
    sourceUrl.length > 2_048 ||
    !isNonNegativeInteger(refreshIntervalMs) ||
    refreshIntervalMs < MIN_RECEIPT_TRUST_DIRECTORY_REFRESH_INTERVAL_MS ||
    refreshIntervalMs > MAX_RECEIPT_TRUST_DIRECTORY_REFRESH_INTERVAL_MS ||
    !policy
  ) {
    return undefined;
  }
  return {
    threadId,
    label: label.trim(),
    sourceUrl,
    refreshIntervalMs,
    policy,
  };
}

function parseEvaluateReceiptTrustAnchorDirectoryQuorumRequest(
  input: unknown,
): EvaluateReceiptTrustAnchorDirectoryQuorumRequest | undefined {
  const record = requestRecord(input, [
    "policy",
    "metadata",
    "trustDirectory",
    "trustDirectoryPolicy",
  ]);
  const policy = parseReceiptTrustAnchorDirectoryQuorumPolicy(
    record?.["policy"],
  );
  const metadata = parseReceiptTrustAnchorDirectoryQuorumMetadataInputs(
    record?.["metadata"],
  );
  const trustDirectoryPolicy =
    parseReceiptTrustAnchorDirectoryVerificationPolicy(
      record?.["trustDirectoryPolicy"],
    );
  if (
    !record ||
    (record["policy"] !== undefined && !policy) ||
    (record["metadata"] !== undefined && !metadata) ||
    (record["trustDirectoryPolicy"] !== undefined &&
      record["trustDirectory"] === undefined) ||
    (record["trustDirectoryPolicy"] !== undefined && !trustDirectoryPolicy)
  ) {
    return undefined;
  }
  return {
    ...(policy ? { policy } : {}),
    ...(metadata ? { metadata } : {}),
    ...(record["trustDirectory"] !== undefined
      ? { trustDirectory: record["trustDirectory"] }
      : {}),
    ...(trustDirectoryPolicy ? { trustDirectoryPolicy } : {}),
  };
}

function parsePromoteReceiptTrustAnchorDirectoryQuorumRequest(
  input: unknown,
): PromoteReceiptTrustAnchorDirectoryQuorumRequest | undefined {
  return parseEvaluateReceiptTrustAnchorDirectoryQuorumRequest(input);
}

function parsePromoteReceiptTrustAnchorDirectoryQuorumBaselineRequest(
  input: unknown,
): PromoteReceiptTrustAnchorDirectoryQuorumBaselineRequest | undefined {
  const record = requestRecord(input, [
    "policy",
    "metadata",
    "trustDirectory",
    "trustDirectoryPolicy",
    "threadId",
    "trustAnchorId",
  ]);
  const threadId = record?.["threadId"];
  const trustAnchorId = record?.["trustAnchorId"];
  const quorumRequest = record
    ? parseEvaluateReceiptTrustAnchorDirectoryQuorumRequest({
        ...(record["policy"] !== undefined ? { policy: record["policy"] } : {}),
        ...(record["metadata"] !== undefined
          ? { metadata: record["metadata"] }
          : {}),
        ...(record["trustDirectory"] !== undefined
          ? { trustDirectory: record["trustDirectory"] }
          : {}),
        ...(record["trustDirectoryPolicy"] !== undefined
          ? { trustDirectoryPolicy: record["trustDirectoryPolicy"] }
          : {}),
      })
    : undefined;
  return record &&
    quorumRequest &&
    validThreadId(threadId) &&
    typeof trustAnchorId === "string" &&
    /^trustkey_[a-z0-9]{8,80}$/.test(trustAnchorId)
    ? {
        ...quorumRequest,
        threadId,
        trustAnchorId,
      }
    : undefined;
}

function parseReceiptTrustAnchorDirectoryQuorumMetadataInputs(
  input: unknown,
): ReceiptTrustAnchorDirectoryQuorumMetadataInput[] | undefined {
  if (input === undefined) return undefined;
  if (
    !Array.isArray(input) ||
    input.length > MAX_RECEIPT_TRUST_DIRECTORY_SUBSCRIPTIONS
  ) {
    return undefined;
  }
  const seen = new Set<string>();
  const metadata: ReceiptTrustAnchorDirectoryQuorumMetadataInput[] = [];
  for (const item of input) {
    const record = requestRecord(item, ["subscriptionId", "envelope"]);
    const subscriptionId = record?.["subscriptionId"];
    if (
      !record ||
      typeof subscriptionId !== "string" ||
      !/^trustdir_[a-f0-9]{20}$/.test(subscriptionId) ||
      record["envelope"] === undefined ||
      seen.has(subscriptionId)
    ) {
      return undefined;
    }
    seen.add(subscriptionId);
    metadata.push({ subscriptionId, envelope: record["envelope"] });
  }
  return metadata.sort((left, right) =>
    left.subscriptionId.localeCompare(right.subscriptionId),
  );
}

function createReceiptTrustAnchorDirectoryQuorumMetadataEvidence(
  services: NapierServices,
  request: EvaluateReceiptTrustAnchorDirectoryQuorumRequest,
): ReceiptTrustAnchorDirectoryQuorumMetadataEvidence[] {
  if (!request.metadata?.length) return [];
  const trustDirectoryVerification =
    request.trustDirectory === undefined
      ? undefined
      : services.store.verifyReceiptTrustAnchorDirectory(
          request.trustDirectory,
          request.trustDirectoryPolicy,
        );
  const anchors =
    request.trustDirectory === undefined
      ? services.store.listReceiptTrustAnchors()
      : trustDirectoryVerification?.status === "valid"
        ? receiptTrustAnchorsFromDirectory(request.trustDirectory)
        : [];
  return request.metadata.map((metadata) => {
    const subscription =
      services.store.getReceiptTrustAnchorDirectorySubscription(
        metadata.subscriptionId,
      );
    const directory = subscription.lastGoodDiscovery?.directory;
    if (!directory) {
      throw new Error(
        "Receipt trust anchor directory quorum metadata subscription has no last-good directory",
      );
    }
    const verification = verifyReceiptTrustAnchorDirectoryMetadata(
      metadata.envelope,
      directory,
      anchors,
      {
        directoryPolicy: subscription.policy,
        ...(trustDirectoryVerification ? { trustDirectoryVerification } : {}),
      },
    );
    return {
      subscriptionId: metadata.subscriptionId,
      status: verification.status,
      signatureValid: verification.signatureValid,
      integrityValid: verification.integrityValid,
      directoryBindingValid: verification.directoryBindingValid,
      diagnosticCount: verification.diagnostics.length,
      diagnosticsSha256: sha256Json(verification.diagnostics),
      ...(verification.publisher
        ? { publisherSha256: sha256Text(verification.publisher) }
        : {}),
      ...(verification.signerKeyId
        ? { signerKeyId: verification.signerKeyId }
        : {}),
      ...(verification.envelopeSha256
        ? { envelopeSha256: verification.envelopeSha256 }
        : {}),
      verificationSha256: verification.contentSha256,
    };
  });
}

function parseReceiptTrustAnchorDirectoryQuorumPolicy(
  input: unknown,
): ReceiptTrustAnchorDirectoryQuorumPolicy | undefined {
  if (input === undefined) return undefined;
  const record = requestRecord(input, [
    "minimumSources",
    "minimumAgreementCount",
    "minimumDistinctSourceOrigins",
    "minimumAgreementWeight",
    "minimumMetadataPublisherCount",
    "expectedAnchorSetSha256",
    "requiredSourceOriginSha256s",
    "requiredMetadataPublisherSha256s",
    "sourceWeights",
  ]);
  if (!record) return undefined;
  const minimumSources = record["minimumSources"];
  const minimumAgreementCount = record["minimumAgreementCount"];
  const minimumDistinctSourceOrigins = record["minimumDistinctSourceOrigins"];
  const minimumAgreementWeight = record["minimumAgreementWeight"];
  const minimumMetadataPublisherCount = record["minimumMetadataPublisherCount"];
  const expectedAnchorSetSha256 = record["expectedAnchorSetSha256"];
  const requiredSourceOriginSha256s = record["requiredSourceOriginSha256s"];
  const requiredMetadataPublisherSha256s =
    record["requiredMetadataPublisherSha256s"];
  const sourceWeights = record["sourceWeights"];
  const effectiveMinimumSources =
    typeof minimumSources === "number" ? minimumSources : 2;
  const sourceWeightOrigins = new Set<string>();
  if (
    (minimumSources !== undefined &&
      (!isNonNegativeInteger(minimumSources) ||
        minimumSources < 1 ||
        minimumSources > MAX_RECEIPT_TRUST_DIRECTORY_SUBSCRIPTIONS)) ||
    (minimumAgreementCount !== undefined &&
      (!isNonNegativeInteger(minimumAgreementCount) ||
        minimumAgreementCount < 1 ||
        minimumAgreementCount > MAX_RECEIPT_TRUST_DIRECTORY_SUBSCRIPTIONS)) ||
    (minimumDistinctSourceOrigins !== undefined &&
      (!isNonNegativeInteger(minimumDistinctSourceOrigins) ||
        minimumDistinctSourceOrigins < 1 ||
        minimumDistinctSourceOrigins >
          MAX_RECEIPT_TRUST_DIRECTORY_SUBSCRIPTIONS)) ||
    (minimumAgreementWeight !== undefined &&
      (!isNonNegativeInteger(minimumAgreementWeight) ||
        minimumAgreementWeight < 1 ||
        minimumAgreementWeight >
          MAX_RECEIPT_TRUST_DIRECTORY_SUBSCRIPTIONS *
            MAX_RECEIPT_TRUST_DIRECTORY_SOURCE_WEIGHT)) ||
    (minimumMetadataPublisherCount !== undefined &&
      (!isNonNegativeInteger(minimumMetadataPublisherCount) ||
        minimumMetadataPublisherCount >
          MAX_RECEIPT_TRUST_DIRECTORY_SUBSCRIPTIONS)) ||
    (minimumAgreementCount !== undefined &&
      minimumAgreementCount > effectiveMinimumSources) ||
    (expectedAnchorSetSha256 !== undefined &&
      (typeof expectedAnchorSetSha256 !== "string" ||
        (expectedAnchorSetSha256 !== "" &&
          !isSha256Hex(expectedAnchorSetSha256)))) ||
    (requiredSourceOriginSha256s !== undefined &&
      (!Array.isArray(requiredSourceOriginSha256s) ||
        requiredSourceOriginSha256s.length >
          MAX_RECEIPT_TRUST_DIRECTORY_SUBSCRIPTIONS ||
        requiredSourceOriginSha256s.some((origin) => !isSha256Hex(origin)))) ||
    (requiredMetadataPublisherSha256s !== undefined &&
      (!Array.isArray(requiredMetadataPublisherSha256s) ||
        requiredMetadataPublisherSha256s.length >
          MAX_RECEIPT_TRUST_DIRECTORY_SUBSCRIPTIONS ||
        requiredMetadataPublisherSha256s.some(
          (publisherSha256) => !isSha256Hex(publisherSha256),
        ))) ||
    (sourceWeights !== undefined &&
      (!Array.isArray(sourceWeights) ||
        sourceWeights.length > MAX_RECEIPT_TRUST_DIRECTORY_SUBSCRIPTIONS ||
        !sourceWeights.every((item) => {
          const recordItem = requestRecord(item, [
            "sourceOriginSha256",
            "weight",
          ]);
          const sourceOriginSha256 = recordItem?.["sourceOriginSha256"];
          const weight = recordItem?.["weight"];
          if (
            !recordItem ||
            !isSha256Hex(sourceOriginSha256) ||
            !isNonNegativeInteger(weight) ||
            weight < 1 ||
            weight > MAX_RECEIPT_TRUST_DIRECTORY_SOURCE_WEIGHT ||
            sourceWeightOrigins.has(sourceOriginSha256)
          ) {
            return false;
          }
          sourceWeightOrigins.add(sourceOriginSha256);
          return true;
        })))
  ) {
    return undefined;
  }
  const normalizedRequiredSourceOrigins =
    requiredSourceOriginSha256s === undefined
      ? undefined
      : Array.from(new Set(requiredSourceOriginSha256s as string[])).sort();
  const normalizedRequiredMetadataPublishers =
    requiredMetadataPublisherSha256s === undefined
      ? undefined
      : Array.from(
          new Set(requiredMetadataPublisherSha256s as string[]),
        ).sort();
  const normalizedSourceWeights =
    sourceWeights === undefined
      ? undefined
      : (sourceWeights as Record<string, unknown>[])
          .map((item) => ({
            sourceOriginSha256: item["sourceOriginSha256"] as string,
            weight: item["weight"] as number,
          }))
          .sort((left, right) =>
            left.sourceOriginSha256.localeCompare(right.sourceOriginSha256),
          );
  return {
    ...(minimumSources !== undefined ? { minimumSources } : {}),
    ...(minimumAgreementCount !== undefined ? { minimumAgreementCount } : {}),
    ...(minimumDistinctSourceOrigins !== undefined
      ? { minimumDistinctSourceOrigins }
      : {}),
    ...(minimumAgreementWeight !== undefined ? { minimumAgreementWeight } : {}),
    ...(minimumMetadataPublisherCount !== undefined
      ? { minimumMetadataPublisherCount }
      : {}),
    ...(typeof expectedAnchorSetSha256 === "string"
      ? { expectedAnchorSetSha256 }
      : {}),
    ...(normalizedRequiredSourceOrigins !== undefined
      ? { requiredSourceOriginSha256s: normalizedRequiredSourceOrigins }
      : {}),
    ...(normalizedRequiredMetadataPublishers !== undefined
      ? {
          requiredMetadataPublisherSha256s:
            normalizedRequiredMetadataPublishers,
        }
      : {}),
    ...(normalizedSourceWeights !== undefined
      ? { sourceWeights: normalizedSourceWeights }
      : {}),
  };
}

function parseReceiptTrustAnchorDirectoryQuorumPromotionBaselineImportPolicy(
  input: unknown,
): ReceiptTrustAnchorDirectoryQuorumPromotionBaselineImportPolicy | undefined {
  if (input === undefined) return undefined;
  const record = requestRecord(input, [
    "maxBaselineAgeMs",
    "maxReceiptAgeMs",
    "maxSourceObservedAgeMs",
    "minimumAgreementCount",
    "minimumAgreementWeight",
    "minimumDistinctSourceOrigins",
    "minimumMetadataPublisherCount",
    "minimumSelectedMetadataCount",
    "expectedAnchorSetSha256",
    "expectedDirectorySha256",
    "requiredSourceOriginSha256s",
    "requiredMetadataPublisherSha256s",
    "requiredMetadataSignerKeyIds",
  ]);
  if (!record) return undefined;
  const maxBaselineAgeMs = record["maxBaselineAgeMs"];
  const maxReceiptAgeMs = record["maxReceiptAgeMs"];
  const maxSourceObservedAgeMs = record["maxSourceObservedAgeMs"];
  const minimumAgreementCount = record["minimumAgreementCount"];
  const minimumAgreementWeight = record["minimumAgreementWeight"];
  const minimumDistinctSourceOrigins = record["minimumDistinctSourceOrigins"];
  const minimumMetadataPublisherCount = record["minimumMetadataPublisherCount"];
  const minimumSelectedMetadataCount = record["minimumSelectedMetadataCount"];
  const expectedAnchorSetSha256 = record["expectedAnchorSetSha256"];
  const expectedDirectorySha256 = record["expectedDirectorySha256"];
  const requiredSourceOriginSha256s = record["requiredSourceOriginSha256s"];
  const requiredMetadataPublisherSha256s =
    record["requiredMetadataPublisherSha256s"];
  const requiredMetadataSignerKeyIds = record["requiredMetadataSignerKeyIds"];
  if (
    (maxBaselineAgeMs !== undefined &&
      !isNonNegativeInteger(maxBaselineAgeMs)) ||
    (maxReceiptAgeMs !== undefined && !isNonNegativeInteger(maxReceiptAgeMs)) ||
    (maxSourceObservedAgeMs !== undefined &&
      !isNonNegativeInteger(maxSourceObservedAgeMs)) ||
    (minimumAgreementCount !== undefined &&
      (!isNonNegativeInteger(minimumAgreementCount) ||
        minimumAgreementCount > MAX_RECEIPT_TRUST_DIRECTORY_SUBSCRIPTIONS)) ||
    (minimumAgreementWeight !== undefined &&
      (!isNonNegativeInteger(minimumAgreementWeight) ||
        minimumAgreementWeight >
          MAX_RECEIPT_TRUST_DIRECTORY_SUBSCRIPTIONS *
            MAX_RECEIPT_TRUST_DIRECTORY_SOURCE_WEIGHT)) ||
    (minimumDistinctSourceOrigins !== undefined &&
      (!isNonNegativeInteger(minimumDistinctSourceOrigins) ||
        minimumDistinctSourceOrigins >
          MAX_RECEIPT_TRUST_DIRECTORY_SUBSCRIPTIONS)) ||
    (minimumMetadataPublisherCount !== undefined &&
      (!isNonNegativeInteger(minimumMetadataPublisherCount) ||
        minimumMetadataPublisherCount >
          MAX_RECEIPT_TRUST_DIRECTORY_SUBSCRIPTIONS)) ||
    (minimumSelectedMetadataCount !== undefined &&
      (!isNonNegativeInteger(minimumSelectedMetadataCount) ||
        minimumSelectedMetadataCount >
          MAX_RECEIPT_TRUST_DIRECTORY_SUBSCRIPTIONS)) ||
    (expectedAnchorSetSha256 !== undefined &&
      (typeof expectedAnchorSetSha256 !== "string" ||
        (expectedAnchorSetSha256 !== "" &&
          !isSha256Hex(expectedAnchorSetSha256)))) ||
    (expectedDirectorySha256 !== undefined &&
      (typeof expectedDirectorySha256 !== "string" ||
        (expectedDirectorySha256 !== "" &&
          !isSha256Hex(expectedDirectorySha256)))) ||
    !validSha256List(
      requiredSourceOriginSha256s,
      MAX_RECEIPT_TRUST_DIRECTORY_SUBSCRIPTIONS,
    ) ||
    !validSha256List(
      requiredMetadataPublisherSha256s,
      MAX_RECEIPT_TRUST_DIRECTORY_SUBSCRIPTIONS,
    ) ||
    !validSha256List(
      requiredMetadataSignerKeyIds,
      MAX_RECEIPT_TRUST_DIRECTORY_SUBSCRIPTIONS,
    )
  ) {
    return undefined;
  }
  return {
    ...(maxBaselineAgeMs !== undefined ? { maxBaselineAgeMs } : {}),
    ...(maxReceiptAgeMs !== undefined ? { maxReceiptAgeMs } : {}),
    ...(maxSourceObservedAgeMs !== undefined ? { maxSourceObservedAgeMs } : {}),
    ...(minimumAgreementCount !== undefined ? { minimumAgreementCount } : {}),
    ...(minimumAgreementWeight !== undefined ? { minimumAgreementWeight } : {}),
    ...(minimumDistinctSourceOrigins !== undefined
      ? { minimumDistinctSourceOrigins }
      : {}),
    ...(minimumMetadataPublisherCount !== undefined
      ? { minimumMetadataPublisherCount }
      : {}),
    ...(minimumSelectedMetadataCount !== undefined
      ? { minimumSelectedMetadataCount }
      : {}),
    ...(typeof expectedAnchorSetSha256 === "string"
      ? { expectedAnchorSetSha256 }
      : {}),
    ...(typeof expectedDirectorySha256 === "string"
      ? { expectedDirectorySha256 }
      : {}),
    ...(requiredSourceOriginSha256s !== undefined
      ? {
          requiredSourceOriginSha256s: Array.from(
            new Set(requiredSourceOriginSha256s as string[]),
          ).sort(),
        }
      : {}),
    ...(requiredMetadataPublisherSha256s !== undefined
      ? {
          requiredMetadataPublisherSha256s: Array.from(
            new Set(requiredMetadataPublisherSha256s as string[]),
          ).sort(),
        }
      : {}),
    ...(requiredMetadataSignerKeyIds !== undefined
      ? {
          requiredMetadataSignerKeyIds: Array.from(
            new Set(requiredMetadataSignerKeyIds as string[]),
          ).sort(),
        }
      : {}),
  };
}

function validSha256List(value: unknown, maxLength: number): boolean {
  return (
    value === undefined ||
    (Array.isArray(value) &&
      value.length <= maxLength &&
      value.every((item) => isSha256Hex(item)))
  );
}

function parseRefreshReceiptTrustAnchorDirectorySubscriptionRequest(
  input: unknown,
): RefreshReceiptTrustAnchorDirectorySubscriptionRequest | undefined {
  const record = requestRecord(input, ["threadId", "expectedRevision"]);
  const threadId = record?.["threadId"];
  const expectedRevision = record?.["expectedRevision"];
  return record &&
    validThreadId(threadId) &&
    isNonNegativeInteger(expectedRevision) &&
    expectedRevision >= 1
    ? { threadId, expectedRevision }
    : undefined;
}

function parseRefreshReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionRequest(
  input: unknown,
):
  | RefreshReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionRequest
  | undefined {
  const record = requestRecord(input, ["threadId", "expectedRevision"]);
  const threadId = record?.["threadId"];
  const expectedRevision = record?.["expectedRevision"];
  return record &&
    validThreadId(threadId) &&
    isNonNegativeInteger(expectedRevision) &&
    expectedRevision >= 1
    ? { threadId, expectedRevision }
    : undefined;
}

function parseRefreshReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionRequest(
  input: unknown,
):
  | RefreshReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionRequest
  | undefined {
  const record = requestRecord(input, ["threadId", "expectedRevision"]);
  const threadId = record?.["threadId"];
  const expectedRevision = record?.["expectedRevision"];
  return record &&
    validThreadId(threadId) &&
    isNonNegativeInteger(expectedRevision) &&
    expectedRevision >= 1
    ? { threadId, expectedRevision }
    : undefined;
}

function parseUpdateReceiptTrustAnchorDirectorySubscriptionRequest(
  input: unknown,
): UpdateReceiptTrustAnchorDirectorySubscriptionRequest | undefined {
  const record = requestRecord(input, [
    "threadId",
    "expectedRevision",
    "status",
  ]);
  const threadId = record?.["threadId"];
  const expectedRevision = record?.["expectedRevision"];
  const status = record?.["status"];
  return record &&
    validThreadId(threadId) &&
    isNonNegativeInteger(expectedRevision) &&
    expectedRevision >= 1 &&
    (status === "active" || status === "paused")
    ? { threadId, expectedRevision, status }
    : undefined;
}

function parseUpdateReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionRequest(
  input: unknown,
):
  | UpdateReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionRequest
  | undefined {
  const record = requestRecord(input, [
    "threadId",
    "expectedRevision",
    "status",
  ]);
  const threadId = record?.["threadId"];
  const expectedRevision = record?.["expectedRevision"];
  const status = record?.["status"];
  return record &&
    validThreadId(threadId) &&
    isNonNegativeInteger(expectedRevision) &&
    expectedRevision >= 1 &&
    (status === "active" || status === "paused")
    ? { threadId, expectedRevision, status }
    : undefined;
}

function parseUpdateReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionRequest(
  input: unknown,
):
  | UpdateReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionRequest
  | undefined {
  const record = requestRecord(input, [
    "threadId",
    "expectedRevision",
    "status",
  ]);
  const threadId = record?.["threadId"];
  const expectedRevision = record?.["expectedRevision"];
  const status = record?.["status"];
  return record &&
    validThreadId(threadId) &&
    isNonNegativeInteger(expectedRevision) &&
    expectedRevision >= 1 &&
    (status === "active" || status === "paused")
    ? { threadId, expectedRevision, status }
    : undefined;
}

function parseReceiptTrustAnchorDirectoryVerificationPolicy(
  input: unknown,
): ReceiptTrustAnchorDirectoryVerificationPolicy | undefined {
  if (input === undefined) return undefined;
  const record = requestRecord(input, [
    "maxAgeMs",
    "expectedAnchorSetSha256",
    "minimumTrustedCount",
    "requiredTrustedKeyIds",
  ]);
  if (!record) return undefined;
  const maxAgeMs = record["maxAgeMs"];
  const expectedAnchorSetSha256 = record["expectedAnchorSetSha256"];
  const minimumTrustedCount = record["minimumTrustedCount"];
  const requiredTrustedKeyIds = record["requiredTrustedKeyIds"];
  if (
    (maxAgeMs !== undefined && !isNonNegativeInteger(maxAgeMs)) ||
    (expectedAnchorSetSha256 !== undefined &&
      !isSha256Hex(expectedAnchorSetSha256)) ||
    (minimumTrustedCount !== undefined &&
      !isNonNegativeInteger(minimumTrustedCount)) ||
    (requiredTrustedKeyIds !== undefined &&
      (!Array.isArray(requiredTrustedKeyIds) ||
        requiredTrustedKeyIds.length > MAX_RECEIPT_TRUST_ANCHORS ||
        requiredTrustedKeyIds.some((keyId) => !isSha256Hex(keyId))))
  ) {
    return undefined;
  }
  const normalizedRequiredTrustedKeyIds =
    requiredTrustedKeyIds === undefined
      ? undefined
      : Array.from(new Set(requiredTrustedKeyIds as string[])).sort();
  return {
    ...(maxAgeMs !== undefined ? { maxAgeMs } : {}),
    ...(expectedAnchorSetSha256 !== undefined
      ? { expectedAnchorSetSha256 }
      : {}),
    ...(minimumTrustedCount !== undefined ? { minimumTrustedCount } : {}),
    ...(normalizedRequiredTrustedKeyIds !== undefined
      ? { requiredTrustedKeyIds: normalizedRequiredTrustedKeyIds }
      : {}),
  };
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function parseCreateExtensionPublisherTrustAnchorRequest(
  input: unknown,
): CreateExtensionPublisherTrustAnchorRequest | undefined {
  const record = requestRecord(input, ["threadId", "label", "source"]);
  const threadId = record?.["threadId"];
  const label = record?.["label"];
  const source = requestRecord(record?.["source"], [
    "type",
    "variable",
    "publicKeySpki",
  ]);
  const type = source?.["type"];
  if (
    !record ||
    !validThreadId(threadId) ||
    typeof label !== "string" ||
    !label.replace(/\s+/g, " ").trim() ||
    label.replace(/\s+/g, " ").trim().length > 100 ||
    !source ||
    (type !== "environment" && type !== "public_key")
  ) {
    return undefined;
  }
  if (type === "environment") {
    const variable = source["variable"];
    if (
      Object.keys(source).some((key) => key !== "type" && key !== "variable") ||
      typeof variable !== "string" ||
      !/^[A-Z_][A-Z0-9_]{1,127}$/.test(variable.trim().toUpperCase())
    ) {
      return undefined;
    }
    return {
      threadId,
      label,
      source: { type, variable },
    };
  }
  const publicKeySpki = source["publicKeySpki"];
  if (
    Object.keys(source).some(
      (key) => key !== "type" && key !== "publicKeySpki",
    ) ||
    typeof publicKeySpki !== "string" ||
    publicKeySpki.length === 0 ||
    publicKeySpki.length > 4_096
  ) {
    return undefined;
  }
  return {
    threadId,
    label,
    source: { type, publicKeySpki },
  };
}

function parseRevokeExtensionPublisherTrustAnchorRequest(
  input: unknown,
): RevokeExtensionPublisherTrustAnchorRequest | undefined {
  const record = requestRecord(input, ["threadId"]);
  const threadId = record?.["threadId"];
  return record && validThreadId(threadId) ? { threadId } : undefined;
}

function parseSignExtensionPackageRequest(
  input: unknown,
): SignExtensionPackageRequest | undefined {
  const record = requestRecord(input, [
    "threadId",
    "trustAnchorId",
    "publisher",
    "dependencies",
    "expiresAt",
  ]);
  const threadId = record?.["threadId"];
  const trustAnchorId = record?.["trustAnchorId"];
  const publisher = record?.["publisher"];
  const dependenciesInput = record?.["dependencies"];
  const dependencies = parseExtensionPackageDependencies(dependenciesInput);
  const expiresAt = record?.["expiresAt"];
  if (
    !record ||
    !validThreadId(threadId) ||
    typeof trustAnchorId !== "string" ||
    !/^publisherkey_[a-z0-9]{8,80}$/.test(trustAnchorId) ||
    typeof publisher !== "string" ||
    !publisher.replace(/\s+/g, " ").trim() ||
    publisher.replace(/\s+/g, " ").trim().length > 120 ||
    /[\u0000-\u001f\u007f<>]/.test(publisher) ||
    (dependenciesInput !== undefined && dependencies === undefined) ||
    (expiresAt !== undefined &&
      (typeof expiresAt !== "string" ||
        !Number.isFinite(Date.parse(expiresAt))))
  ) {
    return undefined;
  }
  return {
    threadId,
    trustAnchorId,
    publisher,
    ...(dependencies ? { dependencies } : {}),
    ...(typeof expiresAt === "string" ? { expiresAt } : {}),
  };
}

function parseSignSkillPackageRequest(
  input: unknown,
): SignSkillPackageRequest | undefined {
  const record = requestRecord(input, [
    "threadId",
    "trustAnchorId",
    "publisher",
    "skillNames",
    "expiresAt",
  ]);
  const threadId = record?.["threadId"];
  const trustAnchorId = record?.["trustAnchorId"];
  const publisher = record?.["publisher"];
  const skillNames = record?.["skillNames"];
  const expiresAt = record?.["expiresAt"];
  if (
    !record ||
    !validThreadId(threadId) ||
    typeof trustAnchorId !== "string" ||
    !/^publisherkey_[a-z0-9]{8,80}$/.test(trustAnchorId) ||
    typeof publisher !== "string" ||
    !publisher.replace(/\s+/g, " ").trim() ||
    publisher.replace(/\s+/g, " ").trim().length > 120 ||
    /[\u0000-\u001f\u007f<>]/.test(publisher) ||
    (skillNames !== undefined &&
      (!Array.isArray(skillNames) ||
        skillNames.length > 128 ||
        skillNames.some(
          (name) =>
            typeof name !== "string" ||
            !/^[a-z0-9][a-z0-9_-]{0,79}$/.test(name),
        ) ||
        new Set(skillNames).size !== skillNames.length)) ||
    (expiresAt !== undefined &&
      (typeof expiresAt !== "string" ||
        !Number.isFinite(Date.parse(expiresAt))))
  ) {
    return undefined;
  }
  return {
    threadId,
    trustAnchorId,
    publisher,
    ...(Array.isArray(skillNames) ? { skillNames } : {}),
    ...(typeof expiresAt === "string" ? { expiresAt } : {}),
  };
}

function parseSignPromptPackageRequest(
  input: unknown,
): SignPromptPackageRequest | undefined {
  const record = requestRecord(input, [
    "threadId",
    "trustAnchorId",
    "publisher",
    "agentId",
    "expiresAt",
  ]);
  const threadId = record?.["threadId"];
  const trustAnchorId = record?.["trustAnchorId"];
  const publisher = record?.["publisher"];
  const agentId = record?.["agentId"];
  const expiresAt = record?.["expiresAt"];
  if (
    !record ||
    !validThreadId(threadId) ||
    typeof trustAnchorId !== "string" ||
    !/^publisherkey_[a-z0-9]{8,80}$/.test(trustAnchorId) ||
    typeof publisher !== "string" ||
    !publisher.replace(/\s+/g, " ").trim() ||
    publisher.replace(/\s+/g, " ").trim().length > 120 ||
    /[\u0000-\u001f\u007f<>]/.test(publisher) ||
    typeof agentId !== "string" ||
    !validAgentId(agentId) ||
    (expiresAt !== undefined &&
      (typeof expiresAt !== "string" ||
        !Number.isFinite(Date.parse(expiresAt))))
  ) {
    return undefined;
  }
  return {
    threadId,
    trustAnchorId,
    publisher,
    agentId,
    ...(typeof expiresAt === "string" ? { expiresAt } : {}),
  };
}

function parseSignInspectorPackageRequest(
  input: unknown,
): SignInspectorPackageRequest | undefined {
  const record = requestRecord(input, [
    "threadId",
    "trustAnchorId",
    "publisher",
    "expiresAt",
  ]);
  const threadId = record?.["threadId"];
  const trustAnchorId = record?.["trustAnchorId"];
  const publisher = record?.["publisher"];
  const expiresAt = record?.["expiresAt"];
  if (
    !record ||
    !validThreadId(threadId) ||
    typeof trustAnchorId !== "string" ||
    !/^publisherkey_[a-z0-9]{8,80}$/.test(trustAnchorId) ||
    typeof publisher !== "string" ||
    !publisher.replace(/\s+/g, " ").trim() ||
    publisher.replace(/\s+/g, " ").trim().length > 120 ||
    /[\u0000-\u001f\u007f<>]/.test(publisher) ||
    (expiresAt !== undefined &&
      (typeof expiresAt !== "string" ||
        !Number.isFinite(Date.parse(expiresAt))))
  ) {
    return undefined;
  }
  return {
    threadId,
    trustAnchorId,
    publisher,
    ...(typeof expiresAt === "string" ? { expiresAt } : {}),
  };
}

function parseSignExtensionPackageChannelIndexRequest(
  input: unknown,
): SignExtensionPackageChannelIndexRequest | undefined {
  const record = requestRecord(input, [
    "threadId",
    "trustAnchorId",
    "publisher",
    "channelIds",
    "lockfileBaseUrl",
    "expiresAt",
  ]);
  const threadId = record?.["threadId"];
  const trustAnchorId = record?.["trustAnchorId"];
  const publisher = record?.["publisher"];
  const channelIds = record?.["channelIds"];
  const lockfileBaseUrl = record?.["lockfileBaseUrl"];
  const expiresAt = record?.["expiresAt"];
  if (
    !record ||
    !validThreadId(threadId) ||
    typeof trustAnchorId !== "string" ||
    !/^publisherkey_[a-z0-9]{8,80}$/.test(trustAnchorId) ||
    typeof publisher !== "string" ||
    !publisher.replace(/\s+/g, " ").trim() ||
    publisher.replace(/\s+/g, " ").trim().length > 120 ||
    /[\u0000-\u001f\u007f<>]/.test(publisher) ||
    (channelIds !== undefined &&
      (!Array.isArray(channelIds) ||
        channelIds.length < 1 ||
        channelIds.length > MAX_EXTENSION_PACKAGE_DEPLOYMENT_CANDIDATES ||
        channelIds.some(
          (id) =>
            typeof id !== "string" || !/^rollout_[a-z0-9]{8,80}$/.test(id),
        ) ||
        new Set(channelIds).size !== channelIds.length)) ||
    (lockfileBaseUrl !== undefined &&
      (typeof lockfileBaseUrl !== "string" ||
        lockfileBaseUrl.length > 500 ||
        /[\u0000-\u001f\u007f<>]/.test(lockfileBaseUrl))) ||
    (expiresAt !== undefined &&
      (typeof expiresAt !== "string" ||
        !Number.isFinite(Date.parse(expiresAt))))
  ) {
    return undefined;
  }
  return {
    threadId,
    trustAnchorId,
    publisher,
    ...(Array.isArray(channelIds) ? { channelIds } : {}),
    ...(typeof lockfileBaseUrl === "string" ? { lockfileBaseUrl } : {}),
    ...(typeof expiresAt === "string" ? { expiresAt } : {}),
  };
}

function parseExtensionPackageDependencies(
  input: unknown,
): SignExtensionPackageRequest["dependencies"] | undefined {
  if (input === undefined) return undefined;
  if (
    !Array.isArray(input) ||
    input.length < 1 ||
    input.length > MAX_EXTENSION_PACKAGE_DEPENDENCIES
  ) {
    return undefined;
  }
  const dependencies: NonNullable<SignExtensionPackageRequest["dependencies"]> =
    [];
  for (const value of input) {
    const record = requestRecord(value, ["normalizedName", "versionRange"]);
    const normalizedName = record?.["normalizedName"];
    const versionRange = record?.["versionRange"];
    if (
      !record ||
      typeof normalizedName !== "string" ||
      !/^[a-z0-9][a-z0-9_-]{0,23}$/.test(normalizedName) ||
      typeof versionRange !== "string" ||
      !versionRange.trim() ||
      versionRange.length > 120
    ) {
      return undefined;
    }
    dependencies.push({ normalizedName, versionRange });
  }
  return dependencies;
}

function parseVerifySignedExtensionPackageRequest(
  input: unknown,
): VerifySignedExtensionPackageRequest | undefined {
  const record = requestRecord(input, ["envelope"]);
  return record && record["envelope"] !== undefined
    ? { envelope: record["envelope"] }
    : undefined;
}

function parseVerifySkillPackageRequest(
  input: unknown,
): VerifySkillPackageRequest | undefined {
  const record = requestRecord(input, ["envelope"]);
  return record && record["envelope"] !== undefined
    ? { envelope: record["envelope"] }
    : undefined;
}

function parseVerifyPromptPackageRequest(
  input: unknown,
): VerifyPromptPackageRequest | undefined {
  const record = requestRecord(input, ["envelope"]);
  return record && record["envelope"] !== undefined
    ? { envelope: record["envelope"] }
    : undefined;
}

function parseVerifyInspectorPackageRequest(
  input: unknown,
): VerifyInspectorPackageRequest | undefined {
  const record = requestRecord(input, ["envelope"]);
  return record && record["envelope"] !== undefined
    ? { envelope: record["envelope"] }
    : undefined;
}

function parseQualifySkillPackageRequest(
  input: unknown,
): QualifySkillPackageRequest | undefined {
  const record = requestRecord(input, ["envelope", "threadId"]);
  const threadId = record?.["threadId"];
  if (
    !record ||
    record["envelope"] === undefined ||
    (threadId !== undefined && !validThreadId(threadId))
  ) {
    return undefined;
  }
  return {
    envelope: record["envelope"],
    ...(typeof threadId === "string" ? { threadId } : {}),
  };
}

function parseInstallSkillPackageRequest(
  input: unknown,
): InstallSkillPackageRequest | undefined {
  const record = requestRecord(input, [
    "threadId",
    "envelope",
    "replaceInstallationId",
    "confirmReplacement",
    "confirmPublisherChange",
    "confirmSkillSetChange",
  ]);
  const threadId = record?.["threadId"];
  const replaceInstallationId = record?.["replaceInstallationId"];
  const confirmReplacement = record?.["confirmReplacement"];
  const confirmPublisherChange = record?.["confirmPublisherChange"];
  const confirmSkillSetChange = record?.["confirmSkillSetChange"];
  if (
    !record ||
    !validThreadId(threadId) ||
    record["envelope"] === undefined ||
    (replaceInstallationId !== undefined &&
      (typeof replaceInstallationId !== "string" ||
        !/^skillinstall_[a-z0-9]{8,80}$/.test(replaceInstallationId))) ||
    (confirmReplacement !== undefined &&
      typeof confirmReplacement !== "boolean") ||
    (confirmPublisherChange !== undefined &&
      typeof confirmPublisherChange !== "boolean") ||
    (confirmSkillSetChange !== undefined &&
      typeof confirmSkillSetChange !== "boolean")
  ) {
    return undefined;
  }
  return {
    threadId,
    envelope: record["envelope"],
    ...(typeof replaceInstallationId === "string"
      ? { replaceInstallationId }
      : {}),
    ...(typeof confirmReplacement === "boolean" ? { confirmReplacement } : {}),
    ...(typeof confirmPublisherChange === "boolean"
      ? { confirmPublisherChange }
      : {}),
    ...(typeof confirmSkillSetChange === "boolean"
      ? { confirmSkillSetChange }
      : {}),
  };
}

function parsePreviewSkillContentRequest(
  input: unknown,
): PreviewSkillContentRequest | undefined {
  const record = requestRecord(input, ["threadId", "content"]);
  const threadId = record?.["threadId"];
  const content = record?.["content"];
  if (!record || !validThreadId(threadId) || typeof content !== "string") {
    return undefined;
  }
  return { threadId, content };
}

function parseApplySkillContentRequest(
  input: unknown,
): ApplySkillContentRequest | undefined {
  const record = requestRecord(input, [
    "threadId",
    "content",
    "expectedReviewSha256",
    "confirmInstall",
    "confirmReplacement",
  ]);
  const threadId = record?.["threadId"];
  const content = record?.["content"];
  const expectedReviewSha256 = record?.["expectedReviewSha256"];
  const confirmInstall = record?.["confirmInstall"];
  const confirmReplacement = record?.["confirmReplacement"];
  if (
    !record ||
    !validThreadId(threadId) ||
    typeof content !== "string" ||
    typeof expectedReviewSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(expectedReviewSha256) ||
    (confirmInstall !== undefined && typeof confirmInstall !== "boolean") ||
    (confirmReplacement !== undefined &&
      typeof confirmReplacement !== "boolean")
  ) {
    return undefined;
  }
  return {
    threadId,
    content,
    expectedReviewSha256,
    ...(typeof confirmInstall === "boolean" ? { confirmInstall } : {}),
    ...(typeof confirmReplacement === "boolean" ? { confirmReplacement } : {}),
  };
}

function parseQualifyPromptPackageRequest(
  input: unknown,
): QualifyPromptPackageRequest | undefined {
  const record = requestRecord(input, ["envelope", "agentId", "threadId"]);
  const threadId = record?.["threadId"];
  const agentId = record?.["agentId"];
  if (
    !record ||
    record["envelope"] === undefined ||
    (threadId !== undefined && !validThreadId(threadId)) ||
    (agentId !== undefined && !validAgentId(agentId))
  ) {
    return undefined;
  }
  return {
    envelope: record["envelope"],
    ...(typeof agentId === "string" ? { agentId } : {}),
    ...(typeof threadId === "string" ? { threadId } : {}),
  };
}

function parseQualifyInspectorPackageRequest(
  input: unknown,
): QualifyInspectorPackageRequest | undefined {
  const record = requestRecord(input, ["envelope", "threadId"]);
  const threadId = record?.["threadId"];
  if (
    !record ||
    record["envelope"] === undefined ||
    (threadId !== undefined && !validThreadId(threadId))
  ) {
    return undefined;
  }
  return {
    envelope: record["envelope"],
    ...(typeof threadId === "string" ? { threadId } : {}),
  };
}

function parseVerifyExtensionPackageChannelIndexRequest(
  input: unknown,
): VerifyExtensionPackageChannelIndexRequest | undefined {
  const record = requestRecord(input, ["envelope"]);
  return record && record["envelope"] !== undefined
    ? { envelope: record["envelope"] }
    : undefined;
}

function parseExportExtensionPackageLockfileRequest(
  input: unknown,
): ExportExtensionPackageLockfileRequest | undefined {
  const record = requestRecord(input, ["threadId", "extensionIds"]);
  const threadId = record?.["threadId"];
  const extensionIds = record?.["extensionIds"];
  if (
    !record ||
    !validThreadId(threadId) ||
    (extensionIds !== undefined &&
      (!Array.isArray(extensionIds) ||
        extensionIds.length < 1 ||
        extensionIds.length > MAX_EXTENSION_PACKAGE_DEPLOYMENT_CANDIDATES ||
        extensionIds.some(
          (id) => typeof id !== "string" || !/^ext_[a-z0-9]{8,80}$/.test(id),
        ) ||
        new Set(extensionIds).size !== extensionIds.length))
  ) {
    return undefined;
  }
  return {
    threadId,
    ...(Array.isArray(extensionIds) ? { extensionIds } : {}),
  };
}

function parseVerifyExtensionPackageLockfileRequest(
  input: unknown,
): VerifyExtensionPackageLockfileRequest | undefined {
  const record = requestRecord(input, ["lockfile"]);
  return record && record["lockfile"] !== undefined
    ? { lockfile: record["lockfile"] }
    : undefined;
}

function parsePublishExtensionPackageRolloutChannelRequest(
  input: unknown,
): PublishExtensionPackageRolloutChannelRequest | undefined {
  const record = requestRecord(input, [
    "threadId",
    "name",
    "description",
    "extensionIds",
    "expectedRevision",
    "policy",
  ]);
  const threadId = record?.["threadId"];
  const name = record?.["name"];
  const description = record?.["description"];
  const extensionIds = record?.["extensionIds"];
  const expectedRevision = record?.["expectedRevision"];
  const policy = parseExtensionPackageRolloutPolicy(record?.["policy"]);
  if (
    !record ||
    !validThreadId(threadId) ||
    typeof name !== "string" ||
    !name.replace(/\s+/g, " ").trim() ||
    name.replace(/\s+/g, " ").trim().length > 80 ||
    /[\u0000-\u001f\u007f<>]/.test(name) ||
    (description !== undefined &&
      (typeof description !== "string" ||
        description.replace(/\s+/g, " ").trim().length > 240 ||
        /[\u0000-\u001f\u007f<>]/.test(description))) ||
    (extensionIds !== undefined &&
      (!Array.isArray(extensionIds) ||
        extensionIds.length < 1 ||
        extensionIds.length > MAX_EXTENSION_PACKAGE_DEPLOYMENT_CANDIDATES ||
        extensionIds.some(
          (id) => typeof id !== "string" || !/^ext_[a-z0-9]{8,80}$/.test(id),
        ) ||
        new Set(extensionIds).size !== extensionIds.length)) ||
    (expectedRevision !== undefined &&
      (typeof expectedRevision !== "number" ||
        !Number.isSafeInteger(expectedRevision) ||
        expectedRevision < 1)) ||
    (record["policy"] !== undefined && policy === undefined)
  ) {
    return undefined;
  }
  return {
    threadId,
    name,
    ...(typeof description === "string" ? { description } : {}),
    ...(Array.isArray(extensionIds) ? { extensionIds } : {}),
    ...(typeof expectedRevision === "number" ? { expectedRevision } : {}),
    ...(policy ? { policy } : {}),
  };
}

function parseExtensionPackageRolloutPolicy(
  input: unknown,
): PublishExtensionPackageRolloutChannelRequest["policy"] | undefined {
  if (input === undefined) return undefined;
  const record = requestRecord(input, [
    "maxPackages",
    "allowedPublisherKeyIds",
    "allowedPackageNames",
  ]);
  const maxPackages = record?.["maxPackages"];
  const allowedPublisherKeyIds = record?.["allowedPublisherKeyIds"];
  const allowedPackageNames = record?.["allowedPackageNames"];
  if (
    !record ||
    (maxPackages !== undefined &&
      (typeof maxPackages !== "number" ||
        !Number.isSafeInteger(maxPackages) ||
        maxPackages < 1 ||
        maxPackages > MAX_EXTENSION_PACKAGE_DEPLOYMENT_CANDIDATES)) ||
    (allowedPublisherKeyIds !== undefined &&
      (!Array.isArray(allowedPublisherKeyIds) ||
        allowedPublisherKeyIds.length < 1 ||
        allowedPublisherKeyIds.length > 32 ||
        allowedPublisherKeyIds.some(
          (keyId) => typeof keyId !== "string" || !/^[a-f0-9]{64}$/.test(keyId),
        ) ||
        new Set(allowedPublisherKeyIds).size !==
          allowedPublisherKeyIds.length)) ||
    (allowedPackageNames !== undefined &&
      (!Array.isArray(allowedPackageNames) ||
        allowedPackageNames.length < 1 ||
        allowedPackageNames.length >
          MAX_EXTENSION_PACKAGE_DEPLOYMENT_CANDIDATES ||
        allowedPackageNames.some(
          (name) =>
            typeof name !== "string" ||
            !/^[a-z0-9][a-z0-9_-]{0,23}$/.test(name),
        ) ||
        new Set(allowedPackageNames).size !== allowedPackageNames.length))
  ) {
    return undefined;
  }
  return {
    ...(typeof maxPackages === "number" ? { maxPackages } : {}),
    ...(Array.isArray(allowedPublisherKeyIds)
      ? { allowedPublisherKeyIds }
      : {}),
    ...(Array.isArray(allowedPackageNames) ? { allowedPackageNames } : {}),
  };
}

function parsePreviewExtensionPackageRolloutChannelRequest(
  input: unknown,
): PreviewExtensionPackageRolloutChannelRequest | undefined {
  const record = requestRecord(input, ["channelId"]);
  const channelId = record?.["channelId"];
  return record &&
    typeof channelId === "string" &&
    /^rollout_[a-z0-9]{8,80}$/.test(channelId)
    ? { channelId }
    : undefined;
}

function parseApplyExtensionPackageRolloutChannelRequest(
  input: unknown,
): ApplyExtensionPackageRolloutChannelRequest | undefined {
  const record = requestRecord(input, [
    "threadId",
    "channelId",
    "expectedRolloutSha256",
    "expectedDeploymentSha256",
    "confirmPublisherChanges",
    "confirmVersionOverrides",
  ]);
  const threadId = record?.["threadId"];
  const channelId = record?.["channelId"];
  const expectedRolloutSha256 = record?.["expectedRolloutSha256"];
  const expectedDeploymentSha256 = record?.["expectedDeploymentSha256"];
  const confirmPublisherChanges = record?.["confirmPublisherChanges"];
  const confirmVersionOverrides = record?.["confirmVersionOverrides"];
  if (
    !record ||
    !validThreadId(threadId) ||
    typeof channelId !== "string" ||
    !/^rollout_[a-z0-9]{8,80}$/.test(channelId) ||
    typeof expectedRolloutSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(expectedRolloutSha256) ||
    typeof expectedDeploymentSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(expectedDeploymentSha256) ||
    (confirmPublisherChanges !== undefined &&
      typeof confirmPublisherChanges !== "boolean") ||
    (confirmVersionOverrides !== undefined &&
      typeof confirmVersionOverrides !== "boolean")
  ) {
    return undefined;
  }
  return {
    threadId,
    channelId,
    expectedRolloutSha256,
    expectedDeploymentSha256,
    ...(confirmPublisherChanges === true
      ? { confirmPublisherChanges: true }
      : {}),
    ...(confirmVersionOverrides === true
      ? { confirmVersionOverrides: true }
      : {}),
  };
}

function parsePreviewExtensionPackageDeploymentRequest(
  input: unknown,
): PreviewExtensionPackageDeploymentRequest | undefined {
  const record = requestRecord(input, ["envelopes"]);
  const envelopes = record?.["envelopes"];
  return record &&
    Array.isArray(envelopes) &&
    envelopes.length >= 1 &&
    envelopes.length <= MAX_EXTENSION_PACKAGE_DEPLOYMENT_CANDIDATES
    ? { envelopes }
    : undefined;
}

function parseApplyExtensionPackageDeploymentRequest(
  input: unknown,
): ApplyExtensionPackageDeploymentRequest | undefined {
  const record = requestRecord(input, [
    "threadId",
    "envelopes",
    "expectedDeploymentSha256",
    "confirmPublisherChanges",
    "confirmVersionOverrides",
  ]);
  const threadId = record?.["threadId"];
  const envelopes = record?.["envelopes"];
  const expectedDeploymentSha256 = record?.["expectedDeploymentSha256"];
  const confirmPublisherChanges = record?.["confirmPublisherChanges"];
  const confirmVersionOverrides = record?.["confirmVersionOverrides"];
  if (
    !record ||
    !validThreadId(threadId) ||
    !Array.isArray(envelopes) ||
    envelopes.length < 1 ||
    envelopes.length > MAX_EXTENSION_PACKAGE_DEPLOYMENT_CANDIDATES ||
    typeof expectedDeploymentSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(expectedDeploymentSha256) ||
    (confirmPublisherChanges !== undefined &&
      typeof confirmPublisherChanges !== "boolean") ||
    (confirmVersionOverrides !== undefined &&
      typeof confirmVersionOverrides !== "boolean")
  ) {
    return undefined;
  }
  return {
    threadId,
    envelopes,
    expectedDeploymentSha256,
    ...(confirmPublisherChanges === true
      ? { confirmPublisherChanges: true }
      : {}),
    ...(confirmVersionOverrides === true
      ? { confirmVersionOverrides: true }
      : {}),
  };
}

function parsePreviewExtensionPackageUpdateRequest(
  input: unknown,
): PreviewExtensionPackageUpdateRequest | undefined {
  const record = requestRecord(input, ["envelope"]);
  return record && record["envelope"] !== undefined
    ? { envelope: record["envelope"] }
    : undefined;
}

function parseApplyExtensionPackageUpdateRequest(
  input: unknown,
): ApplyExtensionPackageUpdateRequest | undefined {
  const record = requestRecord(input, [
    "threadId",
    "envelope",
    "expectedPackageBindingSha256",
    "confirmPublisherChange",
    "confirmVersionOverride",
  ]);
  const threadId = record?.["threadId"];
  const expectedPackageBindingSha256 = record?.["expectedPackageBindingSha256"];
  const confirmPublisherChange = record?.["confirmPublisherChange"];
  const confirmVersionOverride = record?.["confirmVersionOverride"];
  if (
    !record ||
    !validThreadId(threadId) ||
    record["envelope"] === undefined ||
    typeof expectedPackageBindingSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(expectedPackageBindingSha256) ||
    (confirmPublisherChange !== undefined &&
      typeof confirmPublisherChange !== "boolean") ||
    (confirmVersionOverride !== undefined &&
      typeof confirmVersionOverride !== "boolean")
  ) {
    return undefined;
  }
  return {
    threadId,
    envelope: record["envelope"],
    expectedPackageBindingSha256,
    ...(confirmPublisherChange === true
      ? { confirmPublisherChange: true }
      : {}),
    ...(confirmVersionOverride === true
      ? { confirmVersionOverride: true }
      : {}),
  };
}

function parseImportSignedExtensionPackageRequest(
  input: unknown,
): ImportSignedExtensionPackageRequest | undefined {
  const record = requestRecord(input, ["threadId", "envelope"]);
  const threadId = record?.["threadId"];
  return record && validThreadId(threadId) && record["envelope"] !== undefined
    ? { threadId, envelope: record["envelope"] }
    : undefined;
}

function parseExportOpenTelemetryTraceRequest(
  input: unknown,
): ExportOpenTelemetryTraceRequest | undefined {
  if (input === undefined) return {};
  const record = requestRecord(input, ["runId"]);
  const runId = record?.["runId"];
  if (
    !record ||
    (runId !== undefined &&
      (typeof runId !== "string" || !/^run_[a-z0-9]{8,80}$/.test(runId)))
  ) {
    return undefined;
  }
  return typeof runId === "string" ? { runId } : {};
}

function isReceiptTrustConflict(error: Error): boolean {
  return [
    "signing key is unavailable",
    "trust anchor is revoked",
    "trust anchor is verify-only",
    "does not match the trust anchor",
    "qualification baseline receipt is not trusted",
    "directory subscription revision changed",
    "directory subscription refresh is in progress",
    "directory subscription claim expired",
    "directory subscription source already exists",
  ].some((message) => error.message.toLowerCase().includes(message));
}

function isReceiptTrustClientError(error: Error): boolean {
  return [
    "receipt trust anchor",
    "receipt signing environment variable",
    "receipt signing key is not a valid",
    "trusted receipt",
  ].some((message) => error.message.toLowerCase().includes(message));
}

function isExtensionPackageConflict(error: Error): boolean {
  return [
    "signing key is unavailable",
    "trust anchor is revoked",
    "trust anchor is verify-only",
    "does not match the trust anchor",
    "signed extension package is not trusted",
    "signed extension package update is not trusted",
    "changed since the update preview",
    "changed since the deployment preview",
    "requires explicit confirmation",
    "requires explicit override",
    "already exists",
  ].some((message) => error.message.toLowerCase().includes(message));
}

function isExtensionPackageClientError(error: Error): boolean {
  return [
    "extension publisher",
    "extension package",
    "signed extension package",
  ].some((message) => error.message.toLowerCase().includes(message));
}

function isSkillPackageConflict(error: Error): boolean {
  return [
    "skill package cannot be installed",
    "skill package replacement requires confirmation",
    "skill package replacement target is not active",
    "skill package publisher change requires explicit confirmation",
    "skill package skill set change requires explicit confirmation",
  ].some((message) => error.message.toLowerCase().includes(message));
}

function isSkillContentConflict(error: Error): boolean {
  return [
    "skill content review has changed",
    "skill content install requires confirmation",
    "skill content replacement requires confirmation",
    "skill content write hash mismatch",
    "skill content target parent is invalid",
    "skill content target is invalid",
    "apply_patch create target already exists",
    "apply_patch replace target does not exist",
    "apply_patch precondition",
    "apply_patch target disappeared",
  ].some((message) => error.message.toLowerCase().includes(message));
}

function isSkillContentClientError(error: Error): boolean {
  return [
    "skill content review sha-256 is invalid",
    "skill content must",
    "skill content frontmatter",
  ].some((message) => error.message.toLowerCase().includes(message));
}

function isPlanConflict(error: Error): boolean {
  return [
    "plan revision mismatch",
    "thread already has an active execution plan",
  ].some((message) => error.message.toLowerCase().includes(message));
}

function isPlanClientError(error: Error): boolean {
  return [
    "plan objective",
    "plan step",
    "plan steps",
    "plans require",
    "plans allow",
    "plan artifact",
    "artifact",
    "cannot start plan step",
    "cannot complete plan step",
    "cannot block plan step",
    "cannot skip plan step",
    "cannot reopen plan step",
    "cannot replan",
    "replanning requires",
    "duplicate dependency update",
    "unknown replan strategy",
  ].some((message) => error.message.toLowerCase().includes(message));
}

function validThreadId(value: unknown): value is string {
  return typeof value === "string" && /^thread_[a-z0-9]{8,80}$/.test(value);
}

function validAgentId(value: unknown): value is string {
  return typeof value === "string" && /^agent_[a-z0-9_]{2,80}$/.test(value);
}

function validRunId(value: unknown): value is string {
  return typeof value === "string" && /^run_[a-z0-9]{8,80}$/.test(value);
}

function validWorkspaceProcessId(value: unknown): value is string {
  return typeof value === "string" && /^process_[a-z0-9]{8,80}$/.test(value);
}

function parseWorkspaceProcessInputRequest(input: unknown):
  | {
      text: string;
      appendNewline?: boolean;
      close?: boolean;
    }
  | undefined {
  const record = requestRecord(input, ["text", "appendNewline", "close"]);
  if (
    !record ||
    typeof record["text"] !== "string" ||
    (record["appendNewline"] !== undefined &&
      typeof record["appendNewline"] !== "boolean") ||
    (record["close"] !== undefined && typeof record["close"] !== "boolean") ||
    (record["text"].length === 0 &&
      record["appendNewline"] !== true &&
      record["close"] !== true)
  ) {
    return undefined;
  }
  return {
    text: record["text"],
    ...(record["appendNewline"] === true ? { appendNewline: true } : {}),
    ...(record["close"] === true ? { close: true } : {}),
  };
}

function validWorkspaceTrashId(value: unknown): value is string {
  return typeof value === "string" && /^trash_[a-z0-9]{8,80}$/.test(value);
}

function validMemoryId(value: unknown): value is string {
  return typeof value === "string" && /^memory_[a-z0-9]{8,80}$/.test(value);
}

type ContentSha256Mode = "body" | "stable";

function setContentSha256Header(
  context: Context,
  digest: string,
  mode: ContentSha256Mode,
): void {
  context.header("X-Napier-Content-SHA256", digest);
  context.header("X-Napier-Content-SHA256-Mode", mode);
}

function setBodyContentSha256Header(context: Context, body: unknown): void {
  setContentSha256Header(context, sha256Text(JSON.stringify(body)), "body");
}

function setStableContentSha256Header(context: Context, digest: string): void {
  setContentSha256Header(context, digest, "stable");
}

function setOptionalHeader(
  context: Context,
  name: string,
  value: string | undefined,
): void {
  if (value !== undefined) context.header(name, value);
}

function setOptionalNumberHeader(
  context: Context,
  name: string,
  value: number | undefined,
): void {
  if (value !== undefined) context.header(name, String(value));
}

function setHealthProjectionHeaders(
  context: Context,
  response: HealthResponse,
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, response);
  context.header("X-Napier-Service", response.service);
  context.header("X-Napier-Health-Status", response.status);
  context.header("X-Napier-Node-Version", response.runtime.node.version);
  context.header("X-Napier-Node-Platform", response.runtime.node.platform);
  context.header("X-Napier-Node-Arch", response.runtime.node.arch);
  context.header(
    "X-Napier-Runtime-Component-Count",
    String(HEALTH_RUNTIME_COMPONENTS.length),
  );
  context.header(
    "X-Napier-Runtime-Components-SHA256",
    sha256Json(response.runtime.components),
  );
  context.header(
    "X-Napier-Runtime-Sqlite-Version",
    response.runtime.components.sqlite,
  );
  context.header(
    "X-Napier-Runtime-OpenSSL-Version",
    response.runtime.components.openssl,
  );
  context.header("X-Napier-Runtime-Uv-Version", response.runtime.components.uv);
  context.header("X-Napier-Runtime-V8-Version", response.runtime.components.v8);
  context.header(
    "X-Napier-Ledger-Schema-Version",
    String(response.ledger.schemaVersion),
  );
  context.header("X-Napier-Ledger-Quick-Check", response.ledger.quickCheck);
  context.header(
    "X-Napier-Ledger-Migration-Count",
    String(response.ledger.migrations.length),
  );
  context.header(
    "X-Napier-Ledger-Migrations-SHA256",
    sha256Json(
      response.ledger.migrations.map((migration) => ({
        version: migration.version,
        name: migration.name,
        appliedAt: migration.appliedAt,
      })),
    ),
  );
  context.header(
    "X-Napier-Store-Persistence-SHA256",
    sha256Text(JSON.stringify(response.store.persistence)),
  );
  context.header(
    "X-Napier-Store-Commit-Count",
    String(response.store.persistence.commitCount),
  );
  context.header(
    "X-Napier-Store-Failed-Commit-Count",
    String(response.store.persistence.failedCommitCount),
  );
  context.header(
    "X-Napier-Store-Projection-Failure-Count",
    String(response.store.persistence.projectionFailureCount),
  );
  context.header(
    "X-Napier-Store-State-Bytes-Written",
    String(response.store.persistence.stateBytesWritten),
  );
  context.header(
    "X-Napier-Store-Event-Bytes-Written",
    String(response.store.persistence.eventBytesWritten),
  );
  context.header(
    "X-Napier-Store-Projection-Bytes-Written",
    String(response.store.persistence.projectionBytesWritten),
  );
  const lastPersistence = response.store.persistence.last;
  if (lastPersistence) {
    context.header(
      "X-Napier-Store-Last-Commit-Duration-Ms",
      String(lastPersistence.ledgerCommitDurationMs),
    );
    context.header(
      "X-Napier-Store-Last-Persist-Duration-Ms",
      String(lastPersistence.totalDurationMs),
    );
    context.header(
      "X-Napier-Store-Last-State-Bytes",
      String(lastPersistence.stateBytes),
    );
    context.header(
      "X-Napier-Store-Last-Event-Bytes",
      String(lastPersistence.eventBytes),
    );
    context.header(
      "X-Napier-Store-Last-Projection-Bytes",
      String(
        lastPersistence.stateProjectionBytes +
          lastPersistence.eventProjectionBytes,
      ),
    );
  }
  const latestMigration = response.ledger.migrations.at(-1);
  if (latestMigration) {
    context.header(
      "X-Napier-Ledger-Latest-Migration-Version",
      String(latestMigration.version),
    );
    context.header(
      "X-Napier-Ledger-Latest-Migration-Name",
      latestMigration.name,
    );
  }
}

function createHealthRuntimeProjection() {
  return {
    node: {
      version: process.versions.node,
      platform: process.platform,
      arch: process.arch,
    },
    components: Object.fromEntries(
      HEALTH_RUNTIME_COMPONENTS.map((component) => [
        component,
        process.versions[component] ?? "unavailable",
      ]),
    ) as Record<(typeof HEALTH_RUNTIME_COMPONENTS)[number], string>,
  } satisfies HealthResponse["runtime"];
}

function setJsonErrorProjectionHeaders(
  context: Context,
  body: { error: string },
  status: ContentfulStatusCode,
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, body);
  context.header("X-Napier-Error-Status", String(status));
  context.header("X-Napier-Error-Code", jsonErrorCode(status));
  context.header("X-Napier-Error-Message-SHA256", sha256Text(body.error));
}

function jsonError(
  context: Context,
  message: string,
  status: ContentfulStatusCode,
): Response {
  const body = { error: message };
  setJsonErrorProjectionHeaders(context, body, status);
  return context.json(body, status);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function jsonErrorCode(status: ContentfulStatusCode): string {
  switch (status) {
    case 400:
      return "invalid_request";
    case 401:
      return "unauthorized";
    case 403:
      return "forbidden";
    case 404:
      return "not_found";
    case 409:
      return "conflict";
    case 413:
      return "request_too_large";
    case 429:
      return "rate_limited";
    default:
      return status >= 500 ? "server_error" : "http_error";
  }
}

function setAgentProfileHeaders(
  context: Context,
  agent: AgentProfile,
  revision: AgentProfileRevision,
  changedFieldCount?: number,
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, agent);
  context.header("X-Napier-Agent-Id", agent.id);
  context.header("X-Napier-Agent-Revision", String(agent.revision));
  context.header(
    "X-Napier-Agent-Profile-Revision-SHA256",
    revision.contentSha256,
  );
  context.header("X-Napier-System-Prompt-SHA256", revision.systemPromptSha256);
  if (changedFieldCount !== undefined) {
    context.header(
      "X-Napier-Agent-Changed-Field-Count",
      String(changedFieldCount),
    );
  }
}

function setAgentRevisionListHeaders(
  context: Context,
  agentId: string,
  revisions: readonly AgentProfileRevision[],
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, revisions);
  context.header("X-Napier-Agent-Id", agentId);
  context.header("X-Napier-Agent-Revision-Count", String(revisions.length));
  const latest = revisions[0];
  if (latest) {
    context.header("X-Napier-Agent-Revision", String(latest.revision));
    context.header(
      "X-Napier-Agent-Profile-Revision-SHA256",
      latest.contentSha256,
    );
    context.header("X-Napier-System-Prompt-SHA256", latest.systemPromptSha256);
  }
}

function setAgentRollbackHeaders(
  context: Context,
  result: AgentProfileRollbackResult,
  restoredSnapshot: AgentProfileRevision,
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, result);
  context.header("X-Napier-Agent-Id", result.agent.id);
  context.header("X-Napier-Agent-Revision", String(result.agent.revision));
  context.header(
    "X-Napier-Agent-Restored-From-Revision",
    String(restoredSnapshot.revision),
  );
  context.header(
    "X-Napier-Agent-Profile-Revision-SHA256",
    result.revision.contentSha256,
  );
  context.header(
    "X-Napier-Agent-Restored-Snapshot-SHA256",
    restoredSnapshot.contentSha256,
  );
  context.header(
    "X-Napier-System-Prompt-SHA256",
    result.revision.systemPromptSha256,
  );
  context.header(
    "X-Napier-Agent-Changed-Field-Count",
    String(result.revision.changedFields.length),
  );
}

function setExecutionPlanListHeaders(
  context: Context,
  threadId: string,
  plans: readonly ExecutionPlan[],
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, plans);
  context.header("X-Napier-Thread-Id", threadId);
  context.header("X-Napier-Plan-Count", String(plans.length));
  for (const status of [
    "active",
    "completed",
    "blocked",
    "cancelled",
  ] satisfies ExecutionPlan["status"][]) {
    context.header(
      `X-Napier-Plan-${status[0]!.toUpperCase()}${status.slice(1)}-Count`,
      String(plans.filter((plan) => plan.status === status).length),
    );
  }
  context.header(
    "X-Napier-Plan-Step-Count",
    String(plans.reduce((total, plan) => total + plan.steps.length, 0)),
  );
  context.header(
    "X-Napier-Plan-Artifact-Count",
    String(plans.reduce((total, plan) => total + plan.artifacts.length, 0)),
  );
  context.header(
    "X-Napier-Plan-Replan-Count",
    String(plans.reduce((total, plan) => total + plan.replans.length, 0)),
  );
}

function setExecutionPlanHeaders(context: Context, plan: ExecutionPlan): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, plan);
  context.header("X-Napier-Thread-Id", plan.threadId);
  context.header("X-Napier-Plan-Id", plan.id);
  context.header("X-Napier-Plan-Status", plan.status);
  context.header("X-Napier-Plan-Revision", String(plan.revision));
  context.header("X-Napier-Plan-Step-Count", String(plan.steps.length));
  context.header("X-Napier-Plan-Artifact-Count", String(plan.artifacts.length));
  context.header("X-Napier-Plan-Replan-Count", String(plan.replans.length));
  context.header(
    "X-Napier-Plan-Critical-Path-Count",
    String(plan.criticalPathStepIds.length),
  );
  context.header(
    "X-Napier-Plan-Ready-Step-Count",
    String(plan.readyStepIds.length),
  );
  context.header(
    "X-Napier-Plan-Blocked-Step-Count",
    String(plan.blockedStepIds.length),
  );
  context.header("X-Napier-Plan-Phase-Count", String(plan.phaseWaves.length));
  context.header(
    "X-Napier-Plan-Active-Phase-Index",
    plan.activePhaseIndex === null ? "" : String(plan.activePhaseIndex),
  );
  context.header(
    "X-Napier-Plan-Parallel-Ready-Step-Count",
    String(plan.parallelReadyStepIds.length),
  );
  context.header(
    "X-Napier-Plan-Phase-Projection-SHA256",
    plan.phaseProjectionSha256,
  );
  if (plan.replanRecommendation) {
    context.header("X-Napier-Replan-Recommendation", "true");
    context.header(
      "X-Napier-Replan-Recommendation-SHA256",
      plan.replanRecommendation.recommendationSha256,
    );
    context.header(
      "X-Napier-Replan-Recommendation-Strategy",
      plan.replanRecommendation.strategy,
    );
  } else {
    context.header("X-Napier-Replan-Recommendation", "false");
  }
}

type LedgerEventReceiptProjection = {
  ledgerEventId: string;
  ledgerEventSeq: number;
  ledgerEventSha256: string;
};

function createLedgerEventReceiptProjection(
  event: RunEvent,
): LedgerEventReceiptProjection {
  return {
    ledgerEventId: event.id,
    ledgerEventSeq: event.seq,
    ledgerEventSha256: sha256Json(event as unknown as JsonValue),
  };
}

function setLedgerEventReceiptHeaders(
  context: Context,
  receipt: Partial<LedgerEventReceiptProjection>,
): void {
  if (receipt.ledgerEventId) {
    context.header("X-Napier-Ledger-Event-Id", receipt.ledgerEventId);
  }
  if (receipt.ledgerEventSeq !== undefined) {
    context.header("X-Napier-Ledger-Event-Seq", String(receipt.ledgerEventSeq));
  }
  if (receipt.ledgerEventSha256) {
    context.header("X-Napier-Ledger-Event-SHA256", receipt.ledgerEventSha256);
  }
}

function setPlanArtifactFileExportHeaders(
  context: Context,
  plan: ExecutionPlan,
  artifact: ExecutionPlan["artifacts"][number],
  exported: {
    sha256: string;
    sizeBytes: number;
  } & Partial<LedgerEventReceiptProjection>,
): void {
  context.header("Cache-Control", "no-store");
  context.header(
    "Content-Disposition",
    `attachment; filename="${planArtifactDownloadFilename(artifact, exported.sha256)}"`,
  );
  setStableContentSha256Header(context, exported.sha256);
  context.header("X-Napier-Thread-Id", plan.threadId);
  context.header("X-Napier-Plan-Id", plan.id);
  context.header("X-Napier-Plan-Revision", String(plan.revision));
  context.header("X-Napier-Plan-Artifact-Id", artifact.id);
  context.header("X-Napier-Plan-Artifact-Status", artifact.status);
  context.header(
    "X-Napier-Plan-Artifact-Path-SHA256",
    sha256Text(artifact.path),
  );
  context.header("X-Napier-Plan-Artifact-SHA256", exported.sha256);
  context.header(
    "X-Napier-Plan-Artifact-Size-Bytes",
    String(exported.sizeBytes),
  );
  setLedgerEventReceiptHeaders(context, exported);
}

function setPlanArtifactFileVerificationHeaders(
  context: Context,
  verification: {
    verificationStatus: "valid" | "drifted";
    diagnostics: string[];
    threadId: string;
    planId: string;
    artifactId: string;
    expectedSha256: string;
    observedSha256: string;
    expectedSizeBytes: number;
    observedSizeBytes: number;
    ledgerEventId?: string;
    ledgerEventSeq?: number;
    ledgerEventSha256?: string;
  },
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, verification);
  context.header(
    "X-Napier-Verification-Status",
    verification.verificationStatus,
  );
  context.header("X-Napier-Thread-Id", verification.threadId);
  context.header("X-Napier-Plan-Id", verification.planId);
  context.header("X-Napier-Plan-Artifact-Id", verification.artifactId);
  context.header(
    "X-Napier-Diagnostic-Count",
    String(verification.diagnostics.length),
  );
  context.header(
    "X-Napier-Diagnostics-SHA256",
    sha256Json(verification.diagnostics),
  );
  context.header(
    "X-Napier-Expected-Artifact-SHA256",
    verification.expectedSha256,
  );
  context.header(
    "X-Napier-Observed-Artifact-SHA256",
    verification.observedSha256,
  );
  context.header(
    "X-Napier-Expected-Artifact-Size-Bytes",
    String(verification.expectedSizeBytes),
  );
  context.header(
    "X-Napier-Observed-Artifact-Size-Bytes",
    String(verification.observedSizeBytes),
  );
  setLedgerEventReceiptHeaders(context, verification);
}

function verifyPlanArtifactFileProjection(
  plan: ExecutionPlan,
  artifact: ExecutionPlan["artifacts"][number],
  observed: { sha256: string; sizeBytes: number },
) {
  if (
    artifact.kind !== "file" ||
    artifact.status !== "verified" ||
    !artifact.sha256 ||
    artifact.sizeBytes === undefined
  ) {
    throw new Error(
      "Only verified file artifacts with recorded digests can be verified",
    );
  }
  const diagnostics = [
    ...(observed.sha256 === artifact.sha256 ? [] : ["artifact_hash_mismatch"]),
    ...(observed.sizeBytes === artifact.sizeBytes ? [] : ["size_mismatch"]),
  ];
  return {
    kind: "napier.plan-artifact-file-verification" as const,
    schemaVersion: 1 as const,
    threadId: plan.threadId,
    planId: plan.id,
    artifactId: artifact.id,
    planRevision: plan.revision,
    status: artifact.status,
    artifactKind: artifact.kind,
    verificationStatus:
      diagnostics.length === 0 ? ("valid" as const) : ("drifted" as const),
    diagnostics,
    pathSha256: sha256Text(artifact.path),
    expectedSha256: artifact.sha256,
    observedSha256: observed.sha256,
    expectedSizeBytes: artifact.sizeBytes,
    observedSizeBytes: observed.sizeBytes,
  };
}

function createPlanArtifactFileVerificationEventPayload(
  verification: ReturnType<typeof verifyPlanArtifactFileProjection>,
) {
  return {
    planId: verification.planId,
    artifactId: verification.artifactId,
    planRevision: verification.planRevision,
    status: verification.status,
    kind: verification.artifactKind,
    pathSha256: verification.pathSha256,
    verificationStatus: verification.verificationStatus,
    diagnosticCount: verification.diagnostics.length,
    diagnosticsSha256: sha256Json(verification.diagnostics),
    expectedSha256: verification.expectedSha256,
    observedSha256: verification.observedSha256,
    expectedSizeBytes: verification.expectedSizeBytes,
    observedSizeBytes: verification.observedSizeBytes,
  };
}

function setPlanArtifactTextPreviewHeaders(
  context: Context,
  plan: ExecutionPlan,
  artifact: ExecutionPlan["artifacts"][number],
  preview: {
    sha256: string;
    sizeBytes: number;
    lineCount: number;
    textSha256: string;
  } & Partial<LedgerEventReceiptProjection>,
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, preview);
  context.header("X-Napier-Thread-Id", plan.threadId);
  context.header("X-Napier-Plan-Id", plan.id);
  context.header("X-Napier-Plan-Revision", String(plan.revision));
  context.header("X-Napier-Plan-Artifact-Id", artifact.id);
  context.header("X-Napier-Plan-Artifact-Status", artifact.status);
  context.header(
    "X-Napier-Plan-Artifact-Path-SHA256",
    sha256Text(artifact.path),
  );
  context.header("X-Napier-Plan-Artifact-SHA256", preview.sha256);
  context.header(
    "X-Napier-Plan-Artifact-Size-Bytes",
    String(preview.sizeBytes),
  );
  context.header(
    "X-Napier-Plan-Artifact-Line-Count",
    String(preview.lineCount),
  );
  context.header("X-Napier-Plan-Artifact-Text-SHA256", preview.textSha256);
  setLedgerEventReceiptHeaders(context, preview);
}

function setPlanArtifactDataProfileHeaders(
  context: Context,
  plan: ExecutionPlan,
  artifact: ExecutionPlan["artifacts"][number],
  profile: {
    sha256: string;
    sizeBytes: number;
    format: string;
    rowCount: number;
    columnCount: number;
    truncated: boolean;
    columnSetSha256: string;
    sampleSha256: string;
  } & Partial<LedgerEventReceiptProjection>,
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, profile);
  context.header("X-Napier-Thread-Id", plan.threadId);
  context.header("X-Napier-Plan-Id", plan.id);
  context.header("X-Napier-Plan-Revision", String(plan.revision));
  context.header("X-Napier-Plan-Artifact-Id", artifact.id);
  context.header("X-Napier-Plan-Artifact-Status", artifact.status);
  context.header(
    "X-Napier-Plan-Artifact-Path-SHA256",
    sha256Text(artifact.path),
  );
  context.header("X-Napier-Plan-Artifact-SHA256", profile.sha256);
  context.header(
    "X-Napier-Plan-Artifact-Size-Bytes",
    String(profile.sizeBytes),
  );
  context.header("X-Napier-Plan-Artifact-Data-Format", profile.format);
  context.header("X-Napier-Plan-Artifact-Row-Count", String(profile.rowCount));
  context.header(
    "X-Napier-Plan-Artifact-Column-Count",
    String(profile.columnCount),
  );
  context.header(
    "X-Napier-Plan-Artifact-Data-Truncated",
    String(profile.truncated),
  );
  context.header(
    "X-Napier-Plan-Artifact-Column-Set-SHA256",
    profile.columnSetSha256,
  );
  context.header("X-Napier-Plan-Artifact-Sample-SHA256", profile.sampleSha256);
  setLedgerEventReceiptHeaders(context, profile);
}

type PlanArtifactDataProfilePayload = {
  kind: "napier.plan-artifact-data-profile";
  schemaVersion: 1;
  planId: string;
  artifactId: string;
  planRevision: number;
  status: string;
  artifactKind: string;
  pathSha256: string;
  sha256: string;
  sizeBytes: number;
  format: string;
  rowCount: number;
  columnCount: number;
  truncated: boolean;
  columnSetSha256: string;
  sampleSha256: string;
  columns: string[];
  sampleRows: Array<Record<string, string | number | boolean | null>>;
};

function setPlanArtifactDataProfileVerificationHeaders(
  context: Context,
  verification: {
    verificationStatus: "valid" | "drifted";
    diagnostics: string[];
    threadId: string;
    planId: string;
    artifactId: string;
    observedSha256: string;
    declaredSha256: string;
    observedColumnSetSha256: string;
    declaredColumnSetSha256: string;
    observedSampleSha256: string;
    declaredSampleSha256: string;
    ledgerEventId?: string;
    ledgerEventSeq?: number;
    ledgerEventSha256?: string;
  },
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, verification);
  context.header(
    "X-Napier-Verification-Status",
    verification.verificationStatus,
  );
  context.header("X-Napier-Thread-Id", verification.threadId);
  context.header("X-Napier-Plan-Id", verification.planId);
  context.header("X-Napier-Plan-Artifact-Id", verification.artifactId);
  context.header(
    "X-Napier-Diagnostic-Count",
    String(verification.diagnostics.length),
  );
  context.header(
    "X-Napier-Diagnostics-SHA256",
    sha256Json(verification.diagnostics),
  );
  context.header(
    "X-Napier-Declared-Artifact-SHA256",
    verification.declaredSha256,
  );
  context.header(
    "X-Napier-Observed-Artifact-SHA256",
    verification.observedSha256,
  );
  context.header(
    "X-Napier-Declared-Column-Set-SHA256",
    verification.declaredColumnSetSha256,
  );
  context.header(
    "X-Napier-Observed-Column-Set-SHA256",
    verification.observedColumnSetSha256,
  );
  context.header(
    "X-Napier-Declared-Sample-SHA256",
    verification.declaredSampleSha256,
  );
  context.header(
    "X-Napier-Observed-Sample-SHA256",
    verification.observedSampleSha256,
  );
  setLedgerEventReceiptHeaders(context, verification);
}

function verifyPlanArtifactDataProfileProjection(
  plan: ExecutionPlan,
  artifact: ExecutionPlan["artifacts"][number],
  declared: PlanArtifactDataProfilePayload,
  observed: {
    sha256: string;
    sizeBytes: number;
    format: string;
    rowCount: number;
    columnCount: number;
    truncated: boolean;
    columnSetSha256: string;
    sampleSha256: string;
  },
) {
  const pathSha256 = sha256Text(artifact.path);
  const recomputedDeclaredColumnSetSha256 = sha256Text(
    canonicalJson(declared.columns),
  );
  const recomputedDeclaredSampleSha256 = sha256Text(
    canonicalJson(declared.sampleRows),
  );
  const diagnostics = [
    ...(declared.planId === plan.id ? [] : ["plan_id_mismatch"]),
    ...(declared.artifactId === artifact.id ? [] : ["artifact_id_mismatch"]),
    ...(declared.planRevision === plan.revision
      ? []
      : ["plan_revision_mismatch"]),
    ...(declared.status === artifact.status ? [] : ["status_mismatch"]),
    ...(declared.artifactKind === artifact.kind ? [] : ["kind_mismatch"]),
    ...(declared.pathSha256 === pathSha256 ? [] : ["path_hash_mismatch"]),
    ...(declared.sha256 === observed.sha256 ? [] : ["artifact_hash_mismatch"]),
    ...(declared.sizeBytes === observed.sizeBytes ? [] : ["size_mismatch"]),
    ...(declared.format === observed.format ? [] : ["format_mismatch"]),
    ...(declared.rowCount === observed.rowCount ? [] : ["row_count_mismatch"]),
    ...(declared.columnCount === observed.columnCount
      ? []
      : ["column_count_mismatch"]),
    ...(declared.truncated === observed.truncated
      ? []
      : ["truncated_mismatch"]),
    ...(declared.columnSetSha256 === observed.columnSetSha256
      ? []
      : ["column_set_mismatch"]),
    ...(declared.sampleSha256 === observed.sampleSha256
      ? []
      : ["sample_mismatch"]),
    ...(declared.columnSetSha256 === recomputedDeclaredColumnSetSha256
      ? []
      : ["declared_column_set_hash_mismatch"]),
    ...(declared.sampleSha256 === recomputedDeclaredSampleSha256
      ? []
      : ["declared_sample_hash_mismatch"]),
  ];
  return {
    kind: "napier.plan-artifact-data-profile-verification" as const,
    schemaVersion: 1 as const,
    threadId: plan.threadId,
    planId: plan.id,
    artifactId: artifact.id,
    planRevision: plan.revision,
    status: artifact.status,
    artifactKind: artifact.kind,
    verificationStatus:
      diagnostics.length === 0 ? ("valid" as const) : ("drifted" as const),
    diagnostics,
    pathSha256,
    declaredSha256: declared.sha256,
    observedSha256: observed.sha256,
    declaredSizeBytes: declared.sizeBytes,
    observedSizeBytes: observed.sizeBytes,
    declaredFormat: declared.format,
    observedFormat: observed.format,
    declaredRowCount: declared.rowCount,
    observedRowCount: observed.rowCount,
    declaredColumnCount: declared.columnCount,
    observedColumnCount: observed.columnCount,
    declaredTruncated: declared.truncated,
    observedTruncated: observed.truncated,
    declaredColumnSetSha256: declared.columnSetSha256,
    recomputedDeclaredColumnSetSha256,
    observedColumnSetSha256: observed.columnSetSha256,
    declaredSampleSha256: declared.sampleSha256,
    recomputedDeclaredSampleSha256,
    observedSampleSha256: observed.sampleSha256,
  };
}

function createPlanArtifactDataProfileVerificationEventPayload(
  verification: ReturnType<typeof verifyPlanArtifactDataProfileProjection>,
) {
  return {
    planId: verification.planId,
    artifactId: verification.artifactId,
    planRevision: verification.planRevision,
    status: verification.status,
    kind: verification.artifactKind,
    pathSha256: verification.pathSha256,
    verificationStatus: verification.verificationStatus,
    diagnosticCount: verification.diagnostics.length,
    diagnosticsSha256: sha256Json(verification.diagnostics),
    declaredSha256: verification.declaredSha256,
    observedSha256: verification.observedSha256,
    declaredSizeBytes: verification.declaredSizeBytes,
    observedSizeBytes: verification.observedSizeBytes,
    declaredFormat: verification.declaredFormat,
    observedFormat: verification.observedFormat,
    declaredRowCount: verification.declaredRowCount,
    observedRowCount: verification.observedRowCount,
    declaredColumnCount: verification.declaredColumnCount,
    observedColumnCount: verification.observedColumnCount,
    declaredTruncated: verification.declaredTruncated,
    observedTruncated: verification.observedTruncated,
    declaredColumnSetSha256: verification.declaredColumnSetSha256,
    recomputedDeclaredColumnSetSha256:
      verification.recomputedDeclaredColumnSetSha256,
    observedColumnSetSha256: verification.observedColumnSetSha256,
    declaredSampleSha256: verification.declaredSampleSha256,
    recomputedDeclaredSampleSha256: verification.recomputedDeclaredSampleSha256,
    observedSampleSha256: verification.observedSampleSha256,
  };
}

function planArtifactDataProfileVerificationRequest(
  input: unknown,
): PlanArtifactDataProfilePayload | undefined {
  const record = requestRecord(input, ["profile"]);
  if (!record) return undefined;
  return planArtifactDataProfilePayload(record["profile"]);
}

function planArtifactDataProfilePayload(
  input: unknown,
): PlanArtifactDataProfilePayload | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return undefined;
  }
  const record = input as Record<string, unknown>;
  if (
    record["kind"] !== "napier.plan-artifact-data-profile" ||
    record["schemaVersion"] !== 1 ||
    typeof record["planId"] !== "string" ||
    typeof record["artifactId"] !== "string" ||
    !nonNegativeSafeInteger(record["planRevision"]) ||
    typeof record["status"] !== "string" ||
    typeof record["artifactKind"] !== "string" ||
    !isSha256String(record["pathSha256"]) ||
    !isSha256String(record["sha256"]) ||
    !nonNegativeSafeInteger(record["sizeBytes"]) ||
    !validPlanArtifactDataFormat(record["format"]) ||
    !nonNegativeSafeInteger(record["rowCount"]) ||
    !nonNegativeSafeInteger(record["columnCount"]) ||
    typeof record["truncated"] !== "boolean" ||
    !isSha256String(record["columnSetSha256"]) ||
    !isSha256String(record["sampleSha256"]) ||
    !isStringArray(record["columns"]) ||
    !isDataProfileSampleRows(record["sampleRows"])
  ) {
    return undefined;
  }
  return {
    kind: record["kind"],
    schemaVersion: 1,
    planId: record["planId"],
    artifactId: record["artifactId"],
    planRevision: record["planRevision"],
    status: record["status"],
    artifactKind: record["artifactKind"],
    pathSha256: record["pathSha256"],
    sha256: record["sha256"],
    sizeBytes: record["sizeBytes"],
    format: record["format"],
    rowCount: record["rowCount"],
    columnCount: record["columnCount"],
    truncated: record["truncated"],
    columnSetSha256: record["columnSetSha256"],
    sampleSha256: record["sampleSha256"],
    columns: record["columns"],
    sampleRows: record["sampleRows"],
  };
}

function validPlanArtifactDataFormat(value: unknown): value is string {
  return (
    value === "json" ||
    value === "jsonl" ||
    value === "csv" ||
    value === "tsv" ||
    value === "markdown_table"
  );
}

function isDataProfileSampleRows(
  value: unknown,
): value is Array<Record<string, string | number | boolean | null>> {
  return (
    Array.isArray(value) &&
    value.every(
      (row) =>
        row &&
        typeof row === "object" &&
        !Array.isArray(row) &&
        Object.values(row).every(
          (cell) =>
            cell === null ||
            typeof cell === "string" ||
            (typeof cell === "number" && Number.isFinite(cell)) ||
            typeof cell === "boolean",
        ),
    )
  );
}

type PlanArtifactDirectoryManifestEntryPayload =
  | {
      kind: "directory";
      path: string;
    }
  | {
      kind: "file";
      path: string;
      sha256: string;
      sizeBytes: number;
    };

type PlanArtifactDirectoryManifestPayload = {
  kind: "napier.plan-artifact-directory-manifest";
  schemaVersion: 1;
  planId: string;
  artifactId: string;
  planRevision: number;
  status: string;
  artifactKind: string;
  pathSha256: string;
  sha256: string;
  sizeBytes: number;
  entryCount: number;
  fileCount: number;
  directoryCount: number;
  entries: PlanArtifactDirectoryManifestEntryPayload[];
};

function planArtifactDirectoryManifestVerificationRequest(
  input: unknown,
): PlanArtifactDirectoryManifestPayload | undefined {
  const record = requestRecord(input, ["manifest"]);
  if (!record) return undefined;
  return planArtifactDirectoryManifestPayload(record["manifest"]);
}

function planArtifactDirectoryManifestPayload(
  input: unknown,
): PlanArtifactDirectoryManifestPayload | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return undefined;
  }
  const record = input as Record<string, unknown>;
  const entries = directoryManifestEntries(record["entries"]);
  if (
    record["kind"] !== "napier.plan-artifact-directory-manifest" ||
    record["schemaVersion"] !== 1 ||
    typeof record["planId"] !== "string" ||
    typeof record["artifactId"] !== "string" ||
    !nonNegativeSafeInteger(record["planRevision"]) ||
    typeof record["status"] !== "string" ||
    typeof record["artifactKind"] !== "string" ||
    !isSha256String(record["pathSha256"]) ||
    !isSha256String(record["sha256"]) ||
    !nonNegativeSafeInteger(record["sizeBytes"]) ||
    !nonNegativeSafeInteger(record["entryCount"]) ||
    !nonNegativeSafeInteger(record["fileCount"]) ||
    !nonNegativeSafeInteger(record["directoryCount"]) ||
    !entries
  ) {
    return undefined;
  }
  return {
    kind: record["kind"],
    schemaVersion: 1,
    planId: record["planId"],
    artifactId: record["artifactId"],
    planRevision: record["planRevision"],
    status: record["status"],
    artifactKind: record["artifactKind"],
    pathSha256: record["pathSha256"],
    sha256: record["sha256"],
    sizeBytes: record["sizeBytes"],
    entryCount: record["entryCount"],
    fileCount: record["fileCount"],
    directoryCount: record["directoryCount"],
    entries,
  };
}

function directoryManifestEntries(
  input: unknown,
): PlanArtifactDirectoryManifestEntryPayload[] | undefined {
  if (!Array.isArray(input) || input.length > 5_000) return undefined;
  const entries: PlanArtifactDirectoryManifestEntryPayload[] = [];
  for (const entry of input) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return undefined;
    }
    const record = entry as Record<string, unknown>;
    if (!validDirectoryManifestEntryPath(record["path"])) return undefined;
    if (record["kind"] === "directory") {
      if (
        Object.keys(record).length !== 2 ||
        !("kind" in record) ||
        !("path" in record)
      ) {
        return undefined;
      }
      entries.push({ kind: "directory", path: record["path"] });
      continue;
    }
    if (
      record["kind"] === "file" &&
      Object.keys(record).length === 4 &&
      "kind" in record &&
      "path" in record &&
      isSha256String(record["sha256"]) &&
      nonNegativeSafeInteger(record["sizeBytes"])
    ) {
      entries.push({
        kind: "file",
        path: record["path"],
        sha256: record["sha256"],
        sizeBytes: record["sizeBytes"],
      });
      continue;
    }
    return undefined;
  }
  return entries;
}

function validDirectoryManifestEntryPath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 1_000 &&
    !value.includes("\0")
  );
}

function verifyPlanArtifactDirectoryManifestProjection(
  plan: ExecutionPlan,
  artifact: ExecutionPlan["artifacts"][number],
  declared: PlanArtifactDirectoryManifestPayload,
  observed: {
    sha256: string;
    sizeBytes: number;
    entryCount: number;
    fileCount: number;
    directoryCount: number;
    entries: Array<{
      kind: "directory" | "file";
      path: string;
      sha256?: string;
      sizeBytes?: number;
    }>;
  },
) {
  const pathSha256 = sha256Text(artifact.path);
  const recomputedDeclaredSha256 = directoryManifestDigestSha256(
    declared.entries,
  );
  const declaredEntrySetSha256 = directoryManifestEntrySetSha256(
    declared.entries,
  );
  const observedEntrySetSha256 = directoryManifestEntrySetSha256(
    observed.entries,
  );
  const declaredFileCount = declared.entries.filter(
    (entry) => entry.kind === "file",
  ).length;
  const declaredDirectoryCount = declared.entries.filter(
    (entry) => entry.kind === "directory",
  ).length;
  const diagnostics = [
    ...(declared.planId === plan.id ? [] : ["plan_id_mismatch"]),
    ...(declared.artifactId === artifact.id ? [] : ["artifact_id_mismatch"]),
    ...(declared.planRevision === plan.revision
      ? []
      : ["plan_revision_mismatch"]),
    ...(declared.status === artifact.status ? [] : ["status_mismatch"]),
    ...(declared.artifactKind === artifact.kind ? [] : ["kind_mismatch"]),
    ...(declared.pathSha256 === pathSha256 ? [] : ["path_hash_mismatch"]),
    ...(declared.sha256 === observed.sha256 ? [] : ["artifact_hash_mismatch"]),
    ...(declared.sha256 === recomputedDeclaredSha256
      ? []
      : ["declared_manifest_hash_mismatch"]),
    ...(declared.sizeBytes === observed.sizeBytes ? [] : ["size_mismatch"]),
    ...(declared.entryCount === declared.entries.length
      ? []
      : ["declared_entry_count_mismatch"]),
    ...(declared.fileCount === declaredFileCount
      ? []
      : ["declared_file_count_mismatch"]),
    ...(declared.directoryCount === declaredDirectoryCount
      ? []
      : ["declared_directory_count_mismatch"]),
    ...(declared.entryCount === observed.entryCount
      ? []
      : ["entry_count_mismatch"]),
    ...(declared.fileCount === observed.fileCount
      ? []
      : ["file_count_mismatch"]),
    ...(declared.directoryCount === observed.directoryCount
      ? []
      : ["directory_count_mismatch"]),
    ...(declaredEntrySetSha256 === observedEntrySetSha256
      ? []
      : ["entry_set_mismatch"]),
  ];
  return {
    kind: "napier.plan-artifact-directory-manifest-verification" as const,
    schemaVersion: 1 as const,
    threadId: plan.threadId,
    planId: plan.id,
    artifactId: artifact.id,
    planRevision: plan.revision,
    status: artifact.status,
    artifactKind: artifact.kind,
    verificationStatus:
      diagnostics.length === 0 ? ("valid" as const) : ("drifted" as const),
    diagnostics,
    pathSha256,
    declaredSha256: declared.sha256,
    recomputedDeclaredSha256,
    observedSha256: observed.sha256,
    declaredSizeBytes: declared.sizeBytes,
    observedSizeBytes: observed.sizeBytes,
    declaredEntryCount: declared.entryCount,
    observedEntryCount: observed.entryCount,
    declaredFileCount: declared.fileCount,
    observedFileCount: observed.fileCount,
    declaredDirectoryCount: declared.directoryCount,
    observedDirectoryCount: observed.directoryCount,
    declaredEntrySetSha256,
    observedEntrySetSha256,
  };
}

function createPlanArtifactDirectoryManifestVerificationEventPayload(
  verification: ReturnType<
    typeof verifyPlanArtifactDirectoryManifestProjection
  >,
) {
  return {
    planId: verification.planId,
    artifactId: verification.artifactId,
    planRevision: verification.planRevision,
    status: verification.status,
    kind: verification.artifactKind,
    pathSha256: verification.pathSha256,
    verificationStatus: verification.verificationStatus,
    diagnosticCount: verification.diagnostics.length,
    diagnosticsSha256: sha256Json(verification.diagnostics),
    declaredSha256: verification.declaredSha256,
    recomputedDeclaredSha256: verification.recomputedDeclaredSha256,
    observedSha256: verification.observedSha256,
    declaredSizeBytes: verification.declaredSizeBytes,
    observedSizeBytes: verification.observedSizeBytes,
    declaredEntryCount: verification.declaredEntryCount,
    observedEntryCount: verification.observedEntryCount,
    declaredFileCount: verification.declaredFileCount,
    observedFileCount: verification.observedFileCount,
    declaredDirectoryCount: verification.declaredDirectoryCount,
    observedDirectoryCount: verification.observedDirectoryCount,
    declaredEntrySetSha256: verification.declaredEntrySetSha256,
    observedEntrySetSha256: verification.observedEntrySetSha256,
  };
}

function directoryManifestDigestSha256(
  entries: Array<{
    kind: "directory" | "file";
    path: string;
    sha256?: string;
    sizeBytes?: number;
  }>,
): string {
  return sha256Text(
    canonicalJson({
      kind: "napier.plan-directory-digest",
      schemaVersion: 1,
      entries,
    }),
  );
}

function directoryManifestEntrySetSha256(
  entries: Array<{
    kind: "directory" | "file";
    path: string;
    sha256?: string;
    sizeBytes?: number;
  }>,
): string {
  return sha256Text(canonicalJson(entries));
}

function setPlanArtifactDirectoryManifestVerificationHeaders(
  context: Context,
  verification: {
    verificationStatus: "valid" | "drifted";
    diagnostics: string[];
    threadId: string;
    planId: string;
    artifactId: string;
    declaredSha256: string;
    observedSha256: string;
    declaredEntrySetSha256: string;
    observedEntrySetSha256: string;
    ledgerEventId?: string;
    ledgerEventSeq?: number;
    ledgerEventSha256?: string;
  },
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, verification);
  context.header(
    "X-Napier-Verification-Status",
    verification.verificationStatus,
  );
  context.header("X-Napier-Thread-Id", verification.threadId);
  context.header("X-Napier-Plan-Id", verification.planId);
  context.header("X-Napier-Plan-Artifact-Id", verification.artifactId);
  context.header(
    "X-Napier-Diagnostic-Count",
    String(verification.diagnostics.length),
  );
  context.header(
    "X-Napier-Diagnostics-SHA256",
    sha256Json(verification.diagnostics),
  );
  context.header(
    "X-Napier-Declared-Artifact-SHA256",
    verification.declaredSha256,
  );
  context.header(
    "X-Napier-Observed-Artifact-SHA256",
    verification.observedSha256,
  );
  context.header(
    "X-Napier-Declared-Entry-Set-SHA256",
    verification.declaredEntrySetSha256,
  );
  context.header(
    "X-Napier-Observed-Entry-Set-SHA256",
    verification.observedEntrySetSha256,
  );
  setLedgerEventReceiptHeaders(context, verification);
}

function setPlanArtifactDirectoryManifestHeaders(
  context: Context,
  plan: ExecutionPlan,
  artifact: ExecutionPlan["artifacts"][number],
  manifest: {
    sha256: string;
    sizeBytes: number;
    entryCount: number;
    fileCount: number;
    directoryCount: number;
  } & Partial<LedgerEventReceiptProjection>,
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, manifest);
  context.header("X-Napier-Thread-Id", plan.threadId);
  context.header("X-Napier-Plan-Id", plan.id);
  context.header("X-Napier-Plan-Revision", String(plan.revision));
  context.header("X-Napier-Plan-Artifact-Id", artifact.id);
  context.header("X-Napier-Plan-Artifact-Status", artifact.status);
  context.header(
    "X-Napier-Plan-Artifact-Path-SHA256",
    sha256Text(artifact.path),
  );
  context.header("X-Napier-Plan-Artifact-SHA256", manifest.sha256);
  context.header(
    "X-Napier-Plan-Artifact-Size-Bytes",
    String(manifest.sizeBytes),
  );
  context.header(
    "X-Napier-Plan-Artifact-Entry-Count",
    String(manifest.entryCount),
  );
  context.header(
    "X-Napier-Plan-Artifact-File-Count",
    String(manifest.fileCount),
  );
  context.header(
    "X-Napier-Plan-Artifact-Directory-Count",
    String(manifest.directoryCount),
  );
  setLedgerEventReceiptHeaders(context, manifest);
}

function setPlanArtifactDriftCheckHeaders(
  context: Context,
  plan: ExecutionPlan,
  artifact: ExecutionPlan["artifacts"][number],
  inspection: {
    expectedSha256: string;
    result: string;
    observedSha256?: string;
    sizeBytes?: number;
  } & Partial<LedgerEventReceiptProjection>,
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, inspection);
  context.header("X-Napier-Thread-Id", plan.threadId);
  context.header("X-Napier-Plan-Id", plan.id);
  context.header("X-Napier-Plan-Revision", String(plan.revision));
  context.header("X-Napier-Plan-Artifact-Id", artifact.id);
  context.header("X-Napier-Plan-Artifact-Status", artifact.status);
  context.header(
    "X-Napier-Plan-Artifact-Path-SHA256",
    sha256Text(artifact.path),
  );
  context.header(
    "X-Napier-Plan-Artifact-Expected-SHA256",
    inspection.expectedSha256,
  );
  context.header("X-Napier-Plan-Artifact-Drift-Result", inspection.result);
  setOptionalHeader(
    context,
    "X-Napier-Plan-Artifact-Observed-SHA256",
    inspection.observedSha256,
  );
  if (inspection.sizeBytes !== undefined) {
    context.header(
      "X-Napier-Plan-Artifact-Size-Bytes",
      String(inspection.sizeBytes),
    );
  }
  setLedgerEventReceiptHeaders(context, inspection);
}

function planArtifactDownloadFilename(
  artifact: ExecutionPlan["artifacts"][number],
  sha256: string,
): string {
  const safeArtifactId = safePlanArtifactFilenameSegment(
    artifact.id,
    "artifact",
  );
  const safeName = safePlanArtifactFilenameSegment(
    path.basename(artifact.path),
    safeArtifactId,
  );
  return `napier-artifact-${safeArtifactId}-${sha256.slice(0, 12)}-${safeName}`;
}

function safePlanArtifactFilenameSegment(
  value: string,
  fallback: string,
): string {
  const normalized = value.replace(/[^A-Za-z0-9._-]/g, "_");
  return normalized.length > 0 && normalized !== "." && normalized !== ".."
    ? normalized
    : fallback;
}

function setExecutionPlanReplanDraftReviewHeaders(
  context: Context,
  review: ExecutionPlanReplanDraftModelReview,
): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, review.reviewSha256);
  context.header("X-Napier-Thread-Id", review.threadId);
  context.header("X-Napier-Plan-Id", review.planId);
  context.header(
    "X-Napier-Plan-Expected-Revision",
    String(review.expectedRevision),
  );
  context.header(
    "X-Napier-Replan-Recommendation-SHA256",
    review.recommendationSha256,
  );
  context.header("X-Napier-Replan-Draft-SHA256", review.draftSha256);
  context.header(
    "X-Napier-Replan-Draft-Evaluation-SHA256",
    review.deterministicEvaluationSha256,
  );
  context.header("X-Napier-Replan-Review-Verdict", review.verdict);
  context.header("X-Napier-Replan-Review-Risk", review.risk);
  context.header("X-Napier-Replan-Review-Score", String(review.score));
  if (review.modelContextEnvelope) {
    context.header(
      "X-Napier-Replan-Review-Model-Context-Envelope-SHA256",
      review.modelContextEnvelope.contentSha256,
    );
  }
}

function setExecutionPlanArchiveHeaders(
  context: Context,
  archive: ExecutionPlanArchive,
): void {
  context.header("Cache-Control", "no-store");
  context.header(
    "Content-Disposition",
    `attachment; filename="${executionPlanArchiveFilename(archive)}"`,
  );
  setStableContentSha256Header(context, archive.contentSha256);
  context.header("X-Napier-Thread-Id", archive.threadId);
  context.header("X-Napier-Plan-Id", archive.plan.id);
  context.header("X-Napier-Plan-Status", archive.plan.status);
  context.header("X-Napier-Plan-Revision", String(archive.plan.revision));
  context.header("X-Napier-Plan-Archive-SHA256", archive.contentSha256);
  context.header("X-Napier-Event-Stream-SHA256", archive.eventStreamSha256);
  context.header("X-Napier-Event-Count", String(archive.events.length));
  context.header("X-Napier-Plan-Step-Count", String(archive.plan.steps.length));
  context.header(
    "X-Napier-Plan-Artifact-Count",
    String(archive.plan.artifacts.length),
  );
  context.header(
    "X-Napier-Plan-Replan-Count",
    String(archive.plan.replans.length),
  );
  setEventBoundaryHeaders(context, archive.events);
}

function setExecutionPlanBlueprintHeaders(
  context: Context,
  blueprint: ExecutionPlanBlueprint,
): void {
  context.header("Cache-Control", "no-store");
  context.header(
    "Content-Disposition",
    `attachment; filename="${executionPlanBlueprintFilename(blueprint)}"`,
  );
  setStableContentSha256Header(context, blueprint.contentSha256);
  setExecutionPlanBlueprintSourceHeaders(context, blueprint);
  context.header("X-Napier-Plan-Step-Count", String(blueprint.stepCount));
  context.header(
    "X-Napier-Plan-Artifact-Count",
    String(blueprint.artifactCount),
  );
}

function executionPlanArchiveFilename(archive: ExecutionPlanArchive): string {
  const safePlanId = safeFilenameSegment(archive.plan.id, "plan");
  return `napier-plan-${safePlanId}-r${archive.plan.revision}-${archive.contentSha256.slice(0, 12)}.json`;
}

function executionPlanBlueprintFilename(
  blueprint: ExecutionPlanBlueprint,
): string {
  const safePlanId = safeFilenameSegment(blueprint.source.planId, "plan");
  return `napier-plan-blueprint-${safePlanId}-r${blueprint.source.planRevision}-${blueprint.contentSha256.slice(0, 12)}.json`;
}

function bindExecutionPlanArchiveVerification(
  verification: ExecutionPlanArchiveVerification,
  threadId: string,
  planId: string,
): ExecutionPlanArchiveVerification {
  if (verification.status !== "valid") return verification;
  if (verification.threadId === threadId && verification.planId === planId) {
    return verification;
  }
  return {
    ...verification,
    status: "invalid",
    diagnostics: ["path_mismatch"],
  };
}

function setExecutionPlanArchiveVerificationHeaders(
  context: Context,
  verification: ExecutionPlanArchiveVerification,
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, verification);
  context.header("X-Napier-Verification-Status", verification.status);
  context.header("X-Napier-Event-Count", String(verification.eventCount));
  context.header("X-Napier-Plan-Step-Count", String(verification.stepCount));
  context.header(
    "X-Napier-Plan-Artifact-Count",
    String(verification.artifactCount),
  );
  context.header(
    "X-Napier-Plan-Replan-Count",
    String(verification.replanCount),
  );
  context.header(
    "X-Napier-Diagnostic-Count",
    String(verification.diagnostics.length),
  );
  context.header(
    "X-Napier-Diagnostics-SHA256",
    sha256Json(verification.diagnostics),
  );
  if (verification.threadId) {
    context.header("X-Napier-Thread-Id", verification.threadId);
  }
  if (verification.planId) {
    context.header("X-Napier-Plan-Id", verification.planId);
  }
  if (verification.revision !== undefined) {
    context.header("X-Napier-Plan-Revision", String(verification.revision));
  }
  if (verification.contentSha256) {
    context.header("X-Napier-Plan-Archive-SHA256", verification.contentSha256);
  }
  if (verification.eventStreamSha256) {
    context.header(
      "X-Napier-Event-Stream-SHA256",
      verification.eventStreamSha256,
    );
  }
}

function setExecutionPlanBlueprintVerificationHeaders(
  context: Context,
  verification: ExecutionPlanBlueprintVerification,
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, verification);
  context.header("X-Napier-Verification-Status", verification.status);
  context.header("X-Napier-Plan-Step-Count", String(verification.stepCount));
  context.header(
    "X-Napier-Plan-Artifact-Count",
    String(verification.artifactCount),
  );
  context.header(
    "X-Napier-Diagnostic-Count",
    String(verification.diagnostics.length),
  );
  context.header(
    "X-Napier-Diagnostics-SHA256",
    sha256Json(verification.diagnostics),
  );
  if (verification.contentSha256) {
    context.header(
      "X-Napier-Plan-Blueprint-SHA256",
      verification.contentSha256,
    );
  }
  if (verification.sourceThreadId) {
    context.header(
      "X-Napier-Blueprint-Source-Thread-Id",
      verification.sourceThreadId,
    );
  }
  if (verification.sourcePlanId) {
    context.header(
      "X-Napier-Blueprint-Source-Plan-Id",
      verification.sourcePlanId,
    );
  }
  if (verification.sourcePlanRevision !== undefined) {
    context.header(
      "X-Napier-Blueprint-Source-Plan-Revision",
      String(verification.sourcePlanRevision),
    );
  }
  if (verification.sourcePlanArchiveSha256) {
    context.header(
      "X-Napier-Blueprint-Source-Archive-SHA256",
      verification.sourcePlanArchiveSha256,
    );
  }
  if (verification.sourceEventStreamSha256) {
    context.header(
      "X-Napier-Blueprint-Source-Event-Stream-SHA256",
      verification.sourceEventStreamSha256,
    );
  }
}

function setExecutionPlanFromBlueprintHeaders(
  context: Context,
  plan: ExecutionPlan,
  blueprint: ExecutionPlanBlueprint,
): void {
  setExecutionPlanHeaders(context, plan);
  setExecutionPlanBlueprintSourceHeaders(context, blueprint);
}

function setExecutionPlanBlueprintSourceHeaders(
  context: Context,
  blueprint: ExecutionPlanBlueprint,
): void {
  context.header("X-Napier-Plan-Blueprint-SHA256", blueprint.contentSha256);
  context.header(
    "X-Napier-Blueprint-Source-Thread-Id",
    blueprint.source.threadId,
  );
  context.header("X-Napier-Blueprint-Source-Plan-Id", blueprint.source.planId);
  context.header(
    "X-Napier-Blueprint-Source-Plan-Revision",
    String(blueprint.source.planRevision),
  );
  context.header(
    "X-Napier-Blueprint-Source-Archive-SHA256",
    blueprint.source.planArchiveSha256,
  );
  context.header(
    "X-Napier-Blueprint-Source-Event-Stream-SHA256",
    blueprint.source.eventStreamSha256,
  );
}

function setExecutionPlanBlueprintRecordListHeaders(
  context: Context,
  records: readonly ExecutionPlanBlueprintRecord[],
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, records);
  context.header("X-Napier-Plan-Blueprint-Count", String(records.length));
  context.header(
    "X-Napier-Plan-Blueprint-Active-Count",
    String(records.filter((record) => record.status === "active").length),
  );
  context.header(
    "X-Napier-Plan-Blueprint-Archived-Count",
    String(records.filter((record) => record.status === "archived").length),
  );
  context.header(
    "X-Napier-Plan-Blueprint-Set-SHA256",
    sha256Json(records.map((record) => record.blueprintSha256).sort()),
  );
}

function setExecutionPlanBlueprintRecordHeaders(
  context: Context,
  record: ExecutionPlanBlueprintRecord,
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, record);
  context.header("X-Napier-Plan-Blueprint-Record-Id", record.id);
  context.header("X-Napier-Plan-Blueprint-Status", record.status);
  context.header("X-Napier-Plan-Blueprint-SHA256", record.blueprintSha256);
  context.header("X-Napier-Blueprint-Source-Thread-Id", record.sourceThreadId);
  context.header("X-Napier-Blueprint-Source-Plan-Id", record.sourcePlanId);
  context.header(
    "X-Napier-Blueprint-Source-Plan-Revision",
    String(record.sourcePlanRevision),
  );
  context.header(
    "X-Napier-Blueprint-Source-Archive-SHA256",
    record.sourcePlanArchiveSha256,
  );
  context.header(
    "X-Napier-Blueprint-Source-Event-Stream-SHA256",
    record.sourceEventStreamSha256,
  );
  context.header(
    "X-Napier-Plan-Step-Count",
    String(record.blueprint.stepCount),
  );
  context.header(
    "X-Napier-Plan-Artifact-Count",
    String(record.blueprint.artifactCount),
  );
}

function setExecutionPlanBlueprintRecordQualificationHeaders(
  context: Context,
  qualification: ExecutionPlanBlueprintRecordQualification,
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, qualification);
  context.header("X-Napier-Qualification-Status", qualification.status);
  context.header("X-Napier-Plan-Blueprint-Record-Id", qualification.recordId);
  context.header(
    "X-Napier-Diagnostic-Count",
    String(qualification.diagnostics.length),
  );
  context.header(
    "X-Napier-Diagnostics-SHA256",
    sha256Json(qualification.diagnostics),
  );
  context.header("X-Napier-Plan-Step-Count", String(qualification.stepCount));
  context.header(
    "X-Napier-Plan-Artifact-Count",
    String(qualification.artifactCount),
  );
  if (qualification.recordStatus) {
    context.header(
      "X-Napier-Plan-Blueprint-Status",
      qualification.recordStatus,
    );
  }
  if (qualification.blueprintSha256) {
    context.header(
      "X-Napier-Plan-Blueprint-SHA256",
      qualification.blueprintSha256,
    );
  }
  if (qualification.sourceThreadId) {
    context.header(
      "X-Napier-Blueprint-Source-Thread-Id",
      qualification.sourceThreadId,
    );
  }
  if (qualification.sourcePlanId) {
    context.header(
      "X-Napier-Blueprint-Source-Plan-Id",
      qualification.sourcePlanId,
    );
  }
  if (qualification.sourcePlanRevision !== undefined) {
    context.header(
      "X-Napier-Blueprint-Source-Plan-Revision",
      String(qualification.sourcePlanRevision),
    );
  }
  if (qualification.expectedPlanArchiveSha256) {
    context.header(
      "X-Napier-Blueprint-Source-Archive-SHA256",
      qualification.expectedPlanArchiveSha256,
    );
  }
  if (qualification.expectedEventStreamSha256) {
    context.header(
      "X-Napier-Blueprint-Source-Event-Stream-SHA256",
      qualification.expectedEventStreamSha256,
    );
  }
  if (qualification.actualSourcePlanRevision !== undefined) {
    context.header(
      "X-Napier-Blueprint-Actual-Source-Plan-Revision",
      String(qualification.actualSourcePlanRevision),
    );
  }
  if (qualification.actualPlanArchiveSha256) {
    context.header(
      "X-Napier-Blueprint-Actual-Source-Archive-SHA256",
      qualification.actualPlanArchiveSha256,
    );
  }
  if (qualification.actualEventStreamSha256) {
    context.header(
      "X-Napier-Blueprint-Actual-Source-Event-Stream-SHA256",
      qualification.actualEventStreamSha256,
    );
  }
}

function setExecutionPlanBlueprintSaveResultHeaders(
  context: Context,
  result: SaveExecutionPlanBlueprintResult,
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, result);
  context.header("X-Napier-Plan-Blueprint-Created", String(result.created));
  setExecutionPlanBlueprintRecordMetadataHeaders(context, result.record);
}

function setExecutionPlanBlueprintRecordPreviewHeaders(
  context: Context,
  preview: ExecutionPlanBlueprintRecordPreview,
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, preview);
  context.header("X-Napier-Plan-Blueprint-Preview-Status", preview.status);
  context.header("X-Napier-Blueprint-Preview-SHA256", preview.previewSha256);
  context.header("X-Napier-Plan-Blueprint-Record-Id", preview.recordId);
  context.header("X-Napier-Thread-Id", preview.threadId);
  context.header("X-Napier-Has-Open-Plan", String(preview.hasOpenPlan));
  context.header(
    "X-Napier-Diagnostic-Count",
    String(preview.diagnostics.length),
  );
  context.header(
    "X-Napier-Diagnostics-SHA256",
    sha256Json(preview.diagnostics),
  );
  setExecutionPlanBlueprintRecordQualificationMetadataHeaders(
    context,
    preview.qualification,
  );
  if (preview.plan) {
    context.header("X-Napier-Plan-Id", preview.plan.id);
    context.header(
      "X-Napier-Plan-Step-Count",
      String(preview.plan.steps.length),
    );
    context.header(
      "X-Napier-Plan-Artifact-Count",
      String(preview.plan.artifacts.length),
    );
  }
}

function setExecutionPlanBlueprintRecordReplayHistoryHeaders(
  context: Context,
  history: ExecutionPlanBlueprintRecordReplayHistory,
): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, history.contentSha256);
  context.header("X-Napier-Plan-Blueprint-Record-Id", history.recordId);
  context.header(
    "X-Napier-Blueprint-Replay-Count",
    String(history.replayCount),
  );
  context.header(
    "X-Napier-Blueprint-Replay-Thread-Count",
    String(history.threadCount),
  );
  context.header(
    "X-Napier-Blueprint-Replay-Plan-Count",
    String(history.planCount),
  );
  context.header(
    "X-Napier-Blueprint-Replay-Event-Set-SHA256",
    history.eventSetSha256,
  );
  if (history.firstSeq !== undefined) {
    context.header("X-Napier-First-Event-Seq", String(history.firstSeq));
  }
  if (history.lastSeq !== undefined) {
    context.header("X-Napier-Last-Event-Seq", String(history.lastSeq));
  }
  if (history.replays[0]?.blueprintSha256) {
    context.header(
      "X-Napier-Plan-Blueprint-SHA256",
      history.replays[0].blueprintSha256,
    );
  }
  const latestReplay = history.replays.at(-1);
  if (latestReplay?.previewSha256) {
    context.header(
      "X-Napier-Blueprint-Latest-Preview-SHA256",
      latestReplay.previewSha256,
    );
  }
}

function setExecutionPlanBlueprintRecordReplayHistoryVerificationHeaders(
  context: Context,
  verification: ExecutionPlanBlueprintRecordReplayHistoryVerification,
): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, verification.contentSha256);
  context.header("X-Napier-Verification-Status", verification.status);
  context.header(
    "X-Napier-Diagnostic-Count",
    String(verification.diagnostics.length),
  );
  context.header(
    "X-Napier-Diagnostics-SHA256",
    sha256Json(verification.diagnostics),
  );
  if (verification.recordId) {
    context.header("X-Napier-Plan-Blueprint-Record-Id", verification.recordId);
  }
  if (verification.expectedRecordId) {
    context.header(
      "X-Napier-Expected-Plan-Blueprint-Record-Id",
      verification.expectedRecordId,
    );
  }
  if (verification.declaredContentSha256) {
    context.header(
      "X-Napier-Declared-Content-SHA256",
      verification.declaredContentSha256,
    );
  }
  if (verification.recomputedContentSha256) {
    context.header(
      "X-Napier-Recomputed-Content-SHA256",
      verification.recomputedContentSha256,
    );
  }
  if (verification.observedContentSha256) {
    context.header(
      "X-Napier-Observed-Content-SHA256",
      verification.observedContentSha256,
    );
  }
  if (verification.declaredEventSetSha256) {
    context.header(
      "X-Napier-Declared-Event-Set-SHA256",
      verification.declaredEventSetSha256,
    );
  }
  if (verification.observedEventSetSha256) {
    context.header(
      "X-Napier-Observed-Event-Set-SHA256",
      verification.observedEventSetSha256,
    );
  }
  if (verification.replayCount !== undefined) {
    context.header("X-Napier-Replay-Count", String(verification.replayCount));
  }
  if (verification.observedReplayCount !== undefined) {
    context.header(
      "X-Napier-Observed-Replay-Count",
      String(verification.observedReplayCount),
    );
  }
  if (verification.threadCount !== undefined) {
    context.header("X-Napier-Thread-Count", String(verification.threadCount));
  }
  if (verification.observedThreadCount !== undefined) {
    context.header(
      "X-Napier-Observed-Thread-Count",
      String(verification.observedThreadCount),
    );
  }
  if (verification.planCount !== undefined) {
    context.header("X-Napier-Plan-Count", String(verification.planCount));
  }
  if (verification.observedPlanCount !== undefined) {
    context.header(
      "X-Napier-Observed-Plan-Count",
      String(verification.observedPlanCount),
    );
  }
}

function setExecutionPlanBlueprintRecordReplayOutcomesHeaders(
  context: Context,
  outcomes: ExecutionPlanBlueprintRecordReplayOutcomes,
): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, outcomes.contentSha256);
  context.header("X-Napier-Plan-Blueprint-Record-Id", outcomes.recordId);
  context.header(
    "X-Napier-Blueprint-Replay-History-SHA256",
    outcomes.replayHistorySha256,
  );
  context.header(
    "X-Napier-Blueprint-Replay-Outcome-Set-SHA256",
    outcomes.outcomeSetSha256,
  );
  context.header(
    "X-Napier-Blueprint-Replay-Count",
    String(outcomes.replayCount),
  );
  context.header(
    "X-Napier-Blueprint-Replay-Active-Count",
    String(outcomes.activeCount),
  );
  context.header(
    "X-Napier-Blueprint-Replay-Completed-Count",
    String(outcomes.completedCount),
  );
  context.header(
    "X-Napier-Blueprint-Replay-Blocked-Count",
    String(outcomes.blockedCount),
  );
  context.header(
    "X-Napier-Blueprint-Replay-Cancelled-Count",
    String(outcomes.cancelledCount),
  );
  context.header(
    "X-Napier-Blueprint-Replay-Invalid-Count",
    String(outcomes.invalidCount),
  );
  context.header(
    "X-Napier-Blueprint-Replay-Completion-Rate-BPS",
    String(outcomes.completionRateBps),
  );
}

function setExecutionPlanBlueprintRecordReplayOutcomesVerificationHeaders(
  context: Context,
  verification: ExecutionPlanBlueprintRecordReplayOutcomesVerification,
): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, verification.contentSha256);
  context.header("X-Napier-Verification-Status", verification.status);
  context.header(
    "X-Napier-Diagnostic-Count",
    String(verification.diagnostics.length),
  );
  context.header(
    "X-Napier-Diagnostics-SHA256",
    sha256Json(verification.diagnostics),
  );
  if (verification.recordId) {
    context.header("X-Napier-Plan-Blueprint-Record-Id", verification.recordId);
  }
  if (verification.expectedRecordId) {
    context.header(
      "X-Napier-Expected-Plan-Blueprint-Record-Id",
      verification.expectedRecordId,
    );
  }
  setOptionalHeader(
    context,
    "X-Napier-Declared-Content-SHA256",
    verification.declaredContentSha256,
  );
  setOptionalHeader(
    context,
    "X-Napier-Recomputed-Content-SHA256",
    verification.recomputedContentSha256,
  );
  setOptionalHeader(
    context,
    "X-Napier-Observed-Content-SHA256",
    verification.observedContentSha256,
  );
  setOptionalHeader(
    context,
    "X-Napier-Declared-Replay-History-SHA256",
    verification.declaredReplayHistorySha256,
  );
  setOptionalHeader(
    context,
    "X-Napier-Observed-Replay-History-SHA256",
    verification.observedReplayHistorySha256,
  );
  setOptionalHeader(
    context,
    "X-Napier-Declared-Outcome-Set-SHA256",
    verification.declaredOutcomeSetSha256,
  );
  setOptionalHeader(
    context,
    "X-Napier-Observed-Outcome-Set-SHA256",
    verification.observedOutcomeSetSha256,
  );
  setOptionalNumberHeader(
    context,
    "X-Napier-Replay-Count",
    verification.replayCount,
  );
  setOptionalNumberHeader(
    context,
    "X-Napier-Observed-Replay-Count",
    verification.observedReplayCount,
  );
  setOptionalNumberHeader(
    context,
    "X-Napier-Completed-Count",
    verification.completedCount,
  );
  setOptionalNumberHeader(
    context,
    "X-Napier-Observed-Completed-Count",
    verification.observedCompletedCount,
  );
  setOptionalNumberHeader(
    context,
    "X-Napier-Blocked-Count",
    verification.blockedCount,
  );
  setOptionalNumberHeader(
    context,
    "X-Napier-Observed-Blocked-Count",
    verification.observedBlockedCount,
  );
  setOptionalNumberHeader(
    context,
    "X-Napier-Invalid-Count",
    verification.invalidCount,
  );
  setOptionalNumberHeader(
    context,
    "X-Napier-Observed-Invalid-Count",
    verification.observedInvalidCount,
  );
}

function setExecutionPlanBlueprintRecordOutcomeReviewHeaders(
  context: Context,
  review: ExecutionPlanBlueprintRecordOutcomeReview,
): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, review.reviewSha256);
  context.header("X-Napier-Plan-Blueprint-Record-Id", review.recordId);
  context.header("X-Napier-Plan-Blueprint-SHA256", review.blueprintSha256);
  context.header("X-Napier-Blueprint-Outcome-Review-Verdict", review.verdict);
  context.header("X-Napier-Blueprint-Outcome-Review-Risk", review.risk);
  context.header(
    "X-Napier-Blueprint-Outcome-Review-Score",
    String(review.score),
  );
  context.header(
    "X-Napier-Blueprint-Outcome-Review-SHA256",
    review.reviewSha256,
  );
  context.header(
    "X-Napier-Blueprint-Outcome-Review-Input-SHA256",
    review.inputSha256,
  );
  context.header(
    "X-Napier-Blueprint-Outcome-Review-Prompt-SHA256",
    review.promptSha256,
  );
  context.header(
    "X-Napier-Blueprint-Outcome-Review-Response-SHA256",
    review.responseSha256,
  );
  context.header(
    "X-Napier-Blueprint-Outcome-Review-Schema-SHA256",
    review.reviewSchemaSha256,
  );
  if (review.modelContextEnvelope) {
    context.header(
      "X-Napier-Blueprint-Outcome-Review-Model-Context-Envelope-SHA256",
      review.modelContextEnvelope.contentSha256,
    );
  }
  context.header("X-Napier-Model-Provider", review.model.provider);
  context.header("X-Napier-Model-Id", review.model.id);
  context.header(
    "X-Napier-Blueprint-Source-Qualification-Status",
    review.sourceQualificationStatus,
  );
  context.header(
    "X-Napier-Blueprint-Outcome-Qualification-Status",
    review.outcomeQualificationStatus,
  );
  context.header(
    "X-Napier-Blueprint-Replay-Outcomes-SHA256",
    review.replayOutcomesSha256,
  );
  context.header(
    "X-Napier-Blueprint-Replay-History-SHA256",
    review.replayHistorySha256,
  );
  context.header(
    "X-Napier-Blueprint-Replay-Outcome-Set-SHA256",
    review.outcomeSetSha256,
  );
  context.header("X-Napier-Blueprint-Replay-Count", String(review.replayCount));
  context.header(
    "X-Napier-Blueprint-Replay-Completed-Count",
    String(review.completedCount),
  );
  context.header(
    "X-Napier-Blueprint-Replay-Blocked-Count",
    String(review.blockedCount),
  );
  context.header(
    "X-Napier-Blueprint-Replay-Invalid-Count",
    String(review.invalidCount),
  );
  context.header(
    "X-Napier-Blueprint-Replay-Completion-Rate-BPS",
    String(review.completionRateBps),
  );
  setOptionalHeader(
    context,
    "X-Napier-Blueprint-Outcome-Baseline-Id",
    review.baselineId,
  );
  setOptionalHeader(
    context,
    "X-Napier-Blueprint-Outcome-Baseline-SHA256",
    review.baselineSha256,
  );
  setOptionalHeader(
    context,
    "X-Napier-Blueprint-Baseline-Outcomes-SHA256",
    review.baselineOutcomesSha256,
  );
}

function setExecutionPlanBlueprintRecordOutcomeBaselineListHeaders(
  context: Context,
  baselines: readonly ExecutionPlanBlueprintRecordOutcomeBaseline[],
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, baselines);
  context.header(
    "X-Napier-Blueprint-Outcome-Baseline-Count",
    String(baselines.length),
  );
  const latest = baselines.at(-1);
  if (latest) {
    setExecutionPlanBlueprintRecordOutcomeBaselineMetadataHeaders(
      context,
      latest,
    );
  }
}

function setExecutionPlanBlueprintRecordOutcomeBaselinePromotionHeaders(
  context: Context,
  result: PromoteExecutionPlanBlueprintRecordOutcomeBaselineResult,
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, result);
  context.header(
    "X-Napier-Blueprint-Outcome-Baseline-Created",
    String(result.created),
  );
  setExecutionPlanBlueprintRecordOutcomeBaselineMetadataHeaders(
    context,
    result.baseline,
  );
}

function setExecutionPlanBlueprintRecordOutcomeBaselineMetadataHeaders(
  context: Context,
  baseline: ExecutionPlanBlueprintRecordOutcomeBaseline,
): void {
  context.header("X-Napier-Plan-Blueprint-Record-Id", baseline.recordId);
  context.header("X-Napier-Blueprint-Outcome-Baseline-Id", baseline.id);
  context.header(
    "X-Napier-Blueprint-Outcome-Baseline-SHA256",
    baseline.contentSha256,
  );
  context.header(
    "X-Napier-Blueprint-Replay-Outcomes-SHA256",
    baseline.replayOutcomesSha256,
  );
  context.header(
    "X-Napier-Blueprint-Replay-History-SHA256",
    baseline.replayHistorySha256,
  );
  context.header(
    "X-Napier-Blueprint-Replay-Outcome-Set-SHA256",
    baseline.outcomeSetSha256,
  );
  context.header(
    "X-Napier-Blueprint-Replay-Count",
    String(baseline.replayCount),
  );
  context.header(
    "X-Napier-Blueprint-Replay-Completed-Count",
    String(baseline.completedCount),
  );
  context.header(
    "X-Napier-Blueprint-Replay-Blocked-Count",
    String(baseline.blockedCount),
  );
  context.header(
    "X-Napier-Blueprint-Replay-Invalid-Count",
    String(baseline.invalidCount),
  );
  context.header(
    "X-Napier-Blueprint-Replay-Completion-Rate-BPS",
    String(baseline.completionRateBps),
  );
  context.header(
    "X-Napier-Blueprint-Outcome-Policy-Min-Replay-Count",
    String(baseline.policy.minReplayCount),
  );
  context.header(
    "X-Napier-Blueprint-Outcome-Policy-Min-Completion-Rate-BPS",
    String(baseline.policy.minCompletionRateBps),
  );
  context.header(
    "X-Napier-Blueprint-Outcome-Policy-Max-Blocked-Count",
    String(baseline.policy.maxBlockedCount),
  );
  context.header(
    "X-Napier-Blueprint-Outcome-Policy-Max-Invalid-Count",
    String(baseline.policy.maxInvalidCount),
  );
  if (baseline.reviewGate) {
    context.header(
      "X-Napier-Blueprint-Outcome-Review-Gate-Min-Score",
      String(baseline.reviewGate.minScore),
    );
    context.header(
      "X-Napier-Blueprint-Outcome-Review-Gate-Max-Risk",
      baseline.reviewGate.maxRisk,
    );
  }
  setOptionalHeader(
    context,
    "X-Napier-Blueprint-Outcome-Review-SHA256",
    baseline.reviewSha256,
  );
  setOptionalHeader(
    context,
    "X-Napier-Blueprint-Outcome-Review-Input-SHA256",
    baseline.reviewInputSha256,
  );
  setOptionalHeader(
    context,
    "X-Napier-Blueprint-Outcome-Review-Response-SHA256",
    baseline.reviewResponseSha256,
  );
  setOptionalHeader(
    context,
    "X-Napier-Blueprint-Outcome-Review-Verdict",
    baseline.reviewVerdict,
  );
  setOptionalNumberHeader(
    context,
    "X-Napier-Blueprint-Outcome-Review-Score",
    baseline.reviewScore,
  );
  setOptionalHeader(
    context,
    "X-Napier-Blueprint-Outcome-Review-Risk",
    baseline.reviewRisk,
  );
  if (baseline.reviewModel) {
    context.header(
      "X-Napier-Blueprint-Outcome-Review-Model",
      `${baseline.reviewModel.provider}/${baseline.reviewModel.id}`,
    );
  }
  setOptionalHeader(
    context,
    "X-Napier-Blueprint-Outcome-Supersedes-Baseline-Id",
    baseline.supersedesBaselineId,
  );
}

function setExecutionPlanBlueprintRecordOutcomeQualificationHeaders(
  context: Context,
  qualification: ExecutionPlanBlueprintRecordOutcomeQualification,
): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, qualification.contentSha256);
  context.header("X-Napier-Qualification-Status", qualification.status);
  context.header(
    "X-Napier-Diagnostic-Count",
    String(qualification.diagnostics.length),
  );
  context.header(
    "X-Napier-Diagnostics-SHA256",
    sha256Json(qualification.diagnostics),
  );
  context.header("X-Napier-Plan-Blueprint-Record-Id", qualification.recordId);
  setOptionalHeader(
    context,
    "X-Napier-Blueprint-Outcome-Baseline-Id",
    qualification.baselineId,
  );
  setOptionalHeader(
    context,
    "X-Napier-Blueprint-Outcome-Baseline-SHA256",
    qualification.baselineSha256,
  );
  setOptionalHeader(
    context,
    "X-Napier-Blueprint-Baseline-Outcomes-SHA256",
    qualification.baselineOutcomesSha256,
  );
  context.header(
    "X-Napier-Blueprint-Current-Outcomes-SHA256",
    qualification.currentOutcomesSha256,
  );
  context.header(
    "X-Napier-Blueprint-Replay-History-SHA256",
    qualification.currentReplayHistorySha256,
  );
  context.header(
    "X-Napier-Blueprint-Replay-Outcome-Set-SHA256",
    qualification.currentOutcomeSetSha256,
  );
  context.header(
    "X-Napier-Blueprint-Replay-Count",
    String(qualification.replayCount),
  );
  context.header(
    "X-Napier-Blueprint-Replay-Completed-Count",
    String(qualification.completedCount),
  );
  context.header(
    "X-Napier-Blueprint-Replay-Blocked-Count",
    String(qualification.blockedCount),
  );
  context.header(
    "X-Napier-Blueprint-Replay-Invalid-Count",
    String(qualification.invalidCount),
  );
  context.header(
    "X-Napier-Blueprint-Replay-Completion-Rate-BPS",
    String(qualification.completionRateBps),
  );
  if (qualification.policy) {
    context.header(
      "X-Napier-Blueprint-Outcome-Policy-Min-Replay-Count",
      String(qualification.policy.minReplayCount),
    );
    context.header(
      "X-Napier-Blueprint-Outcome-Policy-Min-Completion-Rate-BPS",
      String(qualification.policy.minCompletionRateBps),
    );
    context.header(
      "X-Napier-Blueprint-Outcome-Policy-Max-Blocked-Count",
      String(qualification.policy.maxBlockedCount),
    );
    context.header(
      "X-Napier-Blueprint-Outcome-Policy-Max-Invalid-Count",
      String(qualification.policy.maxInvalidCount),
    );
  }
}

function setExecutionPlanBlueprintRecordSelectionHeaders(
  context: Context,
  selection: ExecutionPlanBlueprintRecordSelection,
): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, selection.contentSha256);
  context.header("X-Napier-Thread-Id", selection.threadId);
  context.header(
    "X-Napier-Plan-Blueprint-Candidate-Count",
    String(selection.candidateCount),
  );
  context.header(
    "X-Napier-Plan-Blueprint-Qualified-Candidate-Count",
    String(selection.qualifiedCandidateCount),
  );
  context.header(
    "X-Napier-Plan-Blueprint-Rejected-Candidate-Count",
    String(selection.rejectedCandidateCount),
  );
  context.header(
    "X-Napier-Plan-Blueprint-Selection-Set-SHA256",
    selection.selectionSetSha256,
  );
  context.header(
    "X-Napier-Blueprint-Portfolio-Set-SHA256",
    selection.portfolioSetSha256,
  );
  context.header(
    "X-Napier-Blueprint-Recommendation-Policy-Template",
    selection.recommendationPolicy.templateId,
  );
  context.header(
    "X-Napier-Blueprint-Recommendation-Policy-SHA256",
    selection.recommendationPolicySha256,
  );
  context.header(
    "X-Napier-Blueprint-Family-Policy-Override-Count",
    String(selection.familyPolicyOverrideCount),
  );
  context.header(
    "X-Napier-Blueprint-Family-Policy-Override-Set-SHA256",
    selection.familyPolicyOverrideSetSha256,
  );
  setOptionalHeader(
    context,
    "X-Napier-Objective-SHA256",
    selection.objectiveSha256,
  );
  setOptionalHeader(
    context,
    "X-Napier-Selected-Plan-Blueprint-Record-Id",
    selection.selectedRecordId,
  );
  setOptionalHeader(
    context,
    "X-Napier-Selected-Blueprint-Preview-SHA256",
    selection.selectedPreviewSha256,
  );
  setOptionalHeader(
    context,
    "X-Napier-Selected-Blueprint-Outcome-Baseline-Id",
    selection.selectedBaselineId,
  );
  setOptionalHeader(
    context,
    "X-Napier-Selected-Blueprint-Outcome-Baseline-SHA256",
    selection.selectedBaselineSha256,
  );
  setOptionalNumberHeader(
    context,
    "X-Napier-Selected-Blueprint-Score-BPS",
    selection.selectedScoreBps,
  );
  setOptionalHeader(
    context,
    "X-Napier-Selected-Blueprint-Family-SHA256",
    selection.selectedFamilySha256,
  );
  setOptionalNumberHeader(
    context,
    "X-Napier-Selected-Blueprint-Family-Completion-Rate-BPS",
    selection.selectedFamilyCompletionRateBps,
  );
  setOptionalNumberHeader(
    context,
    "X-Napier-Selected-Blueprint-Recommendation-Score-BPS",
    selection.selectedRecommendationScoreBps,
  );
  setOptionalHeader(
    context,
    "X-Napier-Selected-Blueprint-Recommendation-Policy-Template",
    selection.selectedRecommendationPolicyTemplate,
  );
  setOptionalHeader(
    context,
    "X-Napier-Selected-Blueprint-Recommendation-Policy-SHA256",
    selection.selectedRecommendationPolicySha256,
  );
  setOptionalHeader(
    context,
    "X-Napier-Selected-Blueprint-Recommendation-Policy-Source",
    selection.selectedRecommendationPolicySource,
  );
  setOptionalHeader(
    context,
    "X-Napier-Selected-Blueprint-Family-Policy-Override-SHA256",
    selection.selectedFamilyPolicyOverrideSha256,
  );
}

function setExecutionPlanBlueprintPortfolioCalibrationHeaders(
  context: Context,
  calibration: ExecutionPlanBlueprintPortfolioCalibration,
): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, calibration.contentSha256);
  context.header(
    "X-Napier-Blueprint-Portfolio-Record-Count",
    String(calibration.recordCount),
  );
  context.header(
    "X-Napier-Blueprint-Portfolio-Active-Count",
    String(calibration.activeCount),
  );
  context.header(
    "X-Napier-Blueprint-Portfolio-Archived-Count",
    String(calibration.archivedCount),
  );
  context.header(
    "X-Napier-Blueprint-Portfolio-Family-Count",
    String(calibration.familyCount),
  );
  context.header(
    "X-Napier-Blueprint-Portfolio-Source-Qualified-Count",
    String(calibration.sourceQualifiedCount),
  );
  context.header(
    "X-Napier-Blueprint-Portfolio-Outcome-Qualified-Count",
    String(calibration.outcomeQualifiedCount),
  );
  context.header(
    "X-Napier-Blueprint-Portfolio-Reviewed-Baseline-Count",
    String(calibration.reviewedBaselineCount),
  );
  context.header(
    "X-Napier-Blueprint-Portfolio-Missing-Baseline-Count",
    String(calibration.missingBaselineCount),
  );
  context.header(
    "X-Napier-Blueprint-Portfolio-Policy-Failed-Count",
    String(calibration.policyFailedCount),
  );
  context.header(
    "X-Napier-Blueprint-Portfolio-Set-SHA256",
    calibration.portfolioSetSha256,
  );
}

function setExecutionPlanBlueprintRecommendationPolicyBacktestHeaders(
  context: Context,
  backtest: ExecutionPlanBlueprintRecommendationPolicyBacktest,
): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, backtest.contentSha256);
  context.header(
    "X-Napier-Blueprint-Portfolio-Record-Count",
    String(backtest.recordCount),
  );
  context.header(
    "X-Napier-Blueprint-Portfolio-Active-Count",
    String(backtest.activeCount),
  );
  context.header(
    "X-Napier-Blueprint-Recommendation-Policy-Count",
    String(backtest.policyCount),
  );
  context.header(
    "X-Napier-Blueprint-Recommendation-Policy-Divergent-Selection-Count",
    String(backtest.divergentSelectionCount),
  );
  context.header(
    "X-Napier-Blueprint-Portfolio-Set-SHA256",
    backtest.portfolioSetSha256,
  );
  context.header(
    "X-Napier-Blueprint-Recommendation-Policy-Set-SHA256",
    backtest.policySetSha256,
  );
}

function setExecutionPlanBlueprintRecommendationPolicyOverrideHeaders(
  context: Context,
  override: ExecutionPlanBlueprintRecommendationPolicyOverride,
): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, override.contentSha256);
  context.header("X-Napier-Blueprint-Family-SHA256", override.familySha256);
  context.header(
    "X-Napier-Blueprint-Recommendation-Policy-Template",
    override.recommendationPolicy.templateId,
  );
  context.header(
    "X-Napier-Blueprint-Recommendation-Policy-SHA256",
    override.recommendationPolicySha256,
  );
  context.header(
    "X-Napier-Blueprint-Portfolio-Set-SHA256",
    override.portfolioSetSha256,
  );
  context.header(
    "X-Napier-Blueprint-Family-Record-Count",
    String(override.familyRecordCount),
  );
  context.header(
    "X-Napier-Blueprint-Family-Outcome-Qualified-Count",
    String(override.familyOutcomeQualifiedCount),
  );
  context.header(
    "X-Napier-Blueprint-Family-Completion-Rate-BPS",
    String(override.familyCompletionRateBps),
  );
}

function setExecutionPlanBlueprintRecommendationPolicyOverrideListHeaders(
  context: Context,
  overrides: ExecutionPlanBlueprintRecommendationPolicyOverrideList,
): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, overrides.contentSha256);
  context.header(
    "X-Napier-Blueprint-Family-Policy-Override-Count",
    String(overrides.overrideCount),
  );
  context.header(
    "X-Napier-Blueprint-Family-Policy-Override-Set-SHA256",
    overrides.overrideSetSha256,
  );
  context.header(
    "X-Napier-Blueprint-Portfolio-Set-SHA256",
    overrides.portfolioSetSha256,
  );
}

function setExecutionPlanBlueprintRecommendationPolicyOverrideDriftReviewHeaders(
  context: Context,
  review: ExecutionPlanBlueprintRecommendationPolicyOverrideDriftReview,
): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, review.contentSha256);
  context.header(
    "X-Napier-Blueprint-Family-Policy-Override-Count",
    String(review.overrideCount),
  );
  context.header(
    "X-Napier-Blueprint-Family-Policy-Override-Aligned-Count",
    String(review.alignedCount),
  );
  context.header(
    "X-Napier-Blueprint-Family-Policy-Override-Retire-Recommended-Count",
    String(review.retireRecommendedCount),
  );
  context.header(
    "X-Napier-Blueprint-Family-Policy-Override-Missing-Family-Count",
    String(review.missingFamilyCount),
  );
  context.header(
    "X-Napier-Blueprint-Portfolio-Set-SHA256",
    review.portfolioSetSha256,
  );
  context.header(
    "X-Napier-Blueprint-Family-Policy-Override-Set-SHA256",
    review.overrideSetSha256,
  );
  context.header(
    "X-Napier-Blueprint-Family-Policy-Override-Drift-Review-Set-SHA256",
    review.reviewSetSha256,
  );
}

function setExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHeaders(
  context: Context,
  result: RetireExecutionPlanBlueprintRecommendationPolicyOverrideResult,
): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, result.contentSha256);
  context.header("X-Napier-Blueprint-Family-SHA256", result.familySha256);
  context.header(
    "X-Napier-Blueprint-Family-Policy-Override-Retired-SHA256",
    result.retiredOverrideSha256,
  );
  context.header(
    "X-Napier-Blueprint-Recommendation-Policy-Template",
    result.retiredRecommendationPolicyTemplate,
  );
  context.header(
    "X-Napier-Blueprint-Recommendation-Policy-SHA256",
    result.retiredRecommendationPolicySha256,
  );
  context.header(
    "X-Napier-Blueprint-Portfolio-Set-SHA256",
    result.portfolioSetSha256,
  );
  context.header(
    "X-Napier-Blueprint-Family-Policy-Override-Set-SHA256",
    result.overrideSetSha256,
  );
  context.header(
    "X-Napier-Blueprint-Family-Policy-Override-Drift-Review-Set-SHA256",
    result.driftReviewSetSha256,
  );
  context.header(
    "X-Napier-Blueprint-Family-Policy-Override-Remaining-Set-SHA256",
    result.remainingOverrideSetSha256,
  );
}

function setExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryHeaders(
  context: Context,
  history: ExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistory,
): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, history.contentSha256);
  context.header(
    "X-Napier-Blueprint-Family-Policy-Override-Retirement-Count",
    String(history.retirementCount),
  );
  context.header(
    "X-Napier-Blueprint-Family-Policy-Override-Retirement-Set-SHA256",
    history.retirementSetSha256,
  );
  context.header(
    "X-Napier-Blueprint-Family-Policy-Override-Current-Set-SHA256",
    history.currentOverrideSetSha256,
  );
  context.header(
    "X-Napier-Blueprint-Portfolio-Set-SHA256",
    history.portfolioSetSha256,
  );
  setOptionalHeader(
    context,
    "X-Napier-Blueprint-Family-Policy-Override-Latest-Retired-At",
    history.latestRetiredAt,
  );
}

function setExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryVerificationHeaders(
  context: Context,
  verification: ExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryVerification,
): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, verification.contentSha256);
  context.header("X-Napier-Verification-Status", verification.status);
  context.header(
    "X-Napier-Diagnostic-Count",
    String(verification.diagnostics.length),
  );
  context.header(
    "X-Napier-Diagnostics-SHA256",
    sha256Json(verification.diagnostics),
  );
  setOptionalHeader(
    context,
    "X-Napier-Declared-Content-SHA256",
    verification.declaredContentSha256,
  );
  setOptionalHeader(
    context,
    "X-Napier-Recomputed-Content-SHA256",
    verification.recomputedContentSha256,
  );
  context.header(
    "X-Napier-Observed-Content-SHA256",
    verification.observedContentSha256,
  );
  setOptionalHeader(
    context,
    "X-Napier-Declared-Blueprint-Portfolio-Set-SHA256",
    verification.declaredPortfolioSetSha256,
  );
  context.header(
    "X-Napier-Observed-Blueprint-Portfolio-Set-SHA256",
    verification.observedPortfolioSetSha256,
  );
  setOptionalHeader(
    context,
    "X-Napier-Declared-Blueprint-Family-Policy-Override-Current-Set-SHA256",
    verification.declaredCurrentOverrideSetSha256,
  );
  context.header(
    "X-Napier-Observed-Blueprint-Family-Policy-Override-Current-Set-SHA256",
    verification.observedCurrentOverrideSetSha256,
  );
  setOptionalHeader(
    context,
    "X-Napier-Declared-Blueprint-Family-Policy-Override-Retirement-Set-SHA256",
    verification.declaredRetirementSetSha256,
  );
  setOptionalHeader(
    context,
    "X-Napier-Recomputed-Blueprint-Family-Policy-Override-Retirement-Set-SHA256",
    verification.recomputedRetirementSetSha256,
  );
  context.header(
    "X-Napier-Observed-Blueprint-Family-Policy-Override-Retirement-Set-SHA256",
    verification.observedRetirementSetSha256,
  );
  setOptionalHeader(
    context,
    "X-Napier-Blueprint-Family-Policy-Override-Retirement-Count",
    verification.retirementCount?.toString(),
  );
  context.header(
    "X-Napier-Observed-Blueprint-Family-Policy-Override-Retirement-Count",
    String(verification.observedRetirementCount),
  );
  setOptionalHeader(
    context,
    "X-Napier-Blueprint-Family-Policy-Override-Latest-Retired-At",
    verification.latestRetiredAt,
  );
  setOptionalHeader(
    context,
    "X-Napier-Observed-Blueprint-Family-Policy-Override-Latest-Retired-At",
    verification.observedLatestRetiredAt,
  );
}

function setExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryProofBundleHeaders(
  context: Context,
  proofBundle: ExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryProofBundle,
): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, proofBundle.contentSha256);
  context.header("X-Napier-Verification-Status", proofBundle.status);
  context.header(
    "X-Napier-Diagnostic-Count",
    String(proofBundle.diagnostics.length),
  );
  context.header(
    "X-Napier-Diagnostics-SHA256",
    sha256Json(proofBundle.diagnostics),
  );
  context.header(
    "X-Napier-Blueprint-Family-Policy-Override-Retirement-History-Count",
    String(proofBundle.historyCount),
  );
  context.header(
    "X-Napier-Blueprint-Family-Policy-Override-Retirement-History-Valid-Count",
    String(proofBundle.validHistoryCount),
  );
  context.header(
    "X-Napier-Blueprint-Family-Policy-Override-Retirement-History-Invalid-Count",
    String(proofBundle.invalidHistoryCount),
  );
  context.header(
    "X-Napier-Blueprint-Family-Policy-Override-Retirement-History-Distinct-Count",
    String(proofBundle.distinctHistoryCount),
  );
  context.header(
    "X-Napier-Blueprint-Portfolio-Set-Distinct-Count",
    String(proofBundle.distinctPortfolioSetCount),
  );
  context.header(
    "X-Napier-Blueprint-Family-Policy-Override-Current-Set-Distinct-Count",
    String(proofBundle.distinctCurrentOverrideSetCount),
  );
  context.header(
    "X-Napier-Blueprint-Family-Policy-Override-Retirement-Set-Distinct-Count",
    String(proofBundle.distinctRetirementSetCount),
  );
  context.header(
    "X-Napier-Blueprint-Family-Policy-Override-Retirement-History-Set-SHA256",
    proofBundle.historySetSha256,
  );
  context.header(
    "X-Napier-Blueprint-Portfolio-Set-Bundle-SHA256",
    proofBundle.portfolioSetBundleSha256,
  );
  context.header(
    "X-Napier-Blueprint-Family-Policy-Override-Current-Set-Bundle-SHA256",
    proofBundle.currentOverrideSetBundleSha256,
  );
  context.header(
    "X-Napier-Blueprint-Family-Policy-Override-Retirement-Set-Bundle-SHA256",
    proofBundle.retirementSetBundleSha256,
  );
}

function setExecutionPlanBlueprintRecordReplayEventVerificationHeaders(
  context: Context,
  verification: ExecutionPlanBlueprintRecordReplayEventVerification,
): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, verification.contentSha256);
  context.header("X-Napier-Verification-Status", verification.status);
  context.header(
    "X-Napier-Diagnostic-Count",
    String(verification.diagnostics.length),
  );
  context.header(
    "X-Napier-Diagnostics-SHA256",
    sha256Json(verification.diagnostics),
  );
  context.header(
    "X-Napier-Expected-Plan-Blueprint-Record-Id",
    verification.expectedRecordId,
  );
  context.header("X-Napier-Thread-Id", verification.threadId);
  context.header("X-Napier-Blueprint-Replay-Event-Id", verification.eventId);
  context.header(
    "X-Napier-Blueprint-Replay-Event-Seq",
    String(verification.seq),
  );
  context.header(
    "X-Napier-Declared-Event-SHA256",
    verification.declaredEventSha256,
  );
  if (verification.observedEventSha256) {
    context.header(
      "X-Napier-Observed-Event-SHA256",
      verification.observedEventSha256,
    );
  }
  if (verification.observedReplay) {
    context.header(
      "X-Napier-Plan-Blueprint-Record-Id",
      verification.observedReplay.recordId,
    );
    context.header("X-Napier-Plan-Id", verification.observedReplay.planId);
    context.header(
      "X-Napier-Plan-Blueprint-SHA256",
      verification.observedReplay.blueprintSha256,
    );
    context.header(
      "X-Napier-Blueprint-Preview-SHA256",
      verification.observedReplay.previewSha256,
    );
  }
}

function setExecutionPlanFromBlueprintRecordHeaders(
  context: Context,
  plan: ExecutionPlan,
  record: ExecutionPlanBlueprintRecord,
  qualification: ExecutionPlanBlueprintRecordQualification,
  previewSha256: string,
  replayEvent: RunEvent,
): void {
  setExecutionPlanHeaders(context, plan);
  setExecutionPlanBlueprintRecordMetadataHeaders(context, record);
  setExecutionPlanBlueprintRecordQualificationMetadataHeaders(
    context,
    qualification,
  );
  context.header("X-Napier-Blueprint-Preview-SHA256", previewSha256);
  context.header("X-Napier-Blueprint-Replay-Event-Id", replayEvent.id);
  context.header(
    "X-Napier-Blueprint-Replay-Event-Seq",
    String(replayEvent.seq),
  );
  context.header(
    "X-Napier-Blueprint-Replay-Event-SHA256",
    sha256Json(replayEvent as unknown as JsonValue),
  );
}

function setExecutionPlanBlueprintRecordQualificationMetadataHeaders(
  context: Context,
  qualification: ExecutionPlanBlueprintRecordQualification,
): void {
  context.header("X-Napier-Qualification-Status", qualification.status);
  context.header(
    "X-Napier-Blueprint-Qualification-SHA256",
    sha256Json(qualification as unknown as JsonValue),
  );
  context.header(
    "X-Napier-Blueprint-Qualification-Diagnostics-SHA256",
    sha256Json(qualification.diagnostics),
  );
  if (qualification.actualPlanArchiveSha256) {
    context.header(
      "X-Napier-Blueprint-Actual-Source-Archive-SHA256",
      qualification.actualPlanArchiveSha256,
    );
  }
  if (qualification.actualEventStreamSha256) {
    context.header(
      "X-Napier-Blueprint-Actual-Source-Event-Stream-SHA256",
      qualification.actualEventStreamSha256,
    );
  }
}

function setExecutionPlanBlueprintRecordMetadataHeaders(
  context: Context,
  record: ExecutionPlanBlueprintRecord,
): void {
  context.header("X-Napier-Plan-Blueprint-Record-Id", record.id);
  context.header("X-Napier-Plan-Blueprint-Status", record.status);
  context.header("X-Napier-Plan-Blueprint-SHA256", record.blueprintSha256);
  context.header("X-Napier-Blueprint-Source-Thread-Id", record.sourceThreadId);
  context.header("X-Napier-Blueprint-Source-Plan-Id", record.sourcePlanId);
  context.header(
    "X-Napier-Blueprint-Source-Plan-Revision",
    String(record.sourcePlanRevision),
  );
  context.header(
    "X-Napier-Blueprint-Source-Archive-SHA256",
    record.sourcePlanArchiveSha256,
  );
  context.header(
    "X-Napier-Blueprint-Source-Event-Stream-SHA256",
    record.sourceEventStreamSha256,
  );
}

function setExtensionListHeaders(
  context: Context,
  extensions: readonly ExtensionRecord[],
  agentId: string | undefined,
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, extensions);
  if (agentId) {
    context.header("X-Napier-Agent-Id", agentId);
  }
  context.header("X-Napier-Extension-Count", String(extensions.length));
  for (const status of [
    "pending",
    "approved",
    "rejected",
  ] satisfies ExtensionRecord["trustStatus"][]) {
    context.header(
      `X-Napier-Extension-Trust-${status.replaceAll("_", "-")}-Count`,
      String(
        extensions.filter((extension) => extension.trustStatus === status)
          .length,
      ),
    );
  }
  context.header(
    "X-Napier-Extension-Enabled-Agent-Count",
    String(
      extensions.reduce(
        (total, extension) => total + extension.enabledAgentIds.length,
        0,
      ),
    ),
  );
  context.header(
    "X-Napier-Extension-Tool-Count",
    String(
      extensions.reduce(
        (total, extension) => total + extension.tools.length,
        0,
      ),
    ),
  );
}

function setExtensionRecordHeaders(
  context: Context,
  extension: ExtensionRecord,
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, extension);
  context.header("X-Napier-Extension-Id", extension.id);
  context.header("X-Napier-Extension-Kind", extension.kind);
  context.header("X-Napier-Extension-Trust-Status", extension.trustStatus);
  context.header(
    "X-Napier-Extension-Connection-Status",
    extension.connection.status,
  );
  context.header("X-Napier-Extension-Revision", String(extension.revision));
  context.header(
    "X-Napier-Extension-Requested-Capability-Count",
    String(extension.requestedCapabilities.length),
  );
  context.header(
    "X-Napier-Extension-Approved-Capability-Count",
    String(extension.approvedCapabilities.length),
  );
  context.header(
    "X-Napier-Extension-Enabled-Agent-Count",
    String(extension.enabledAgentIds.length),
  );
  context.header(
    "X-Napier-Extension-Tool-Count",
    String(extension.tools.length),
  );
  context.header(
    "X-Napier-Extension-Reviewed-Tool-Count",
    String(
      extension.tools.filter((tool) => tool.reviewStatus !== "pending").length,
    ),
  );
  if (extension.packageBinding) {
    context.header(
      "X-Napier-Extension-Package-Binding-SHA256",
      extension.packageBinding.contentSha256,
    );
  }
}

function setMemoryListHeaders(
  context: Context,
  memories: readonly MemoryFact[],
  agentId: string | undefined,
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, memories);
  if (agentId) {
    context.header("X-Napier-Agent-Id", agentId);
  }
  context.header("X-Napier-Memory-Count", String(memories.length));
  for (const status of [
    "proposed",
    "active",
    "stale",
    "rejected",
    "archived",
  ] satisfies MemoryFact["status"][]) {
    context.header(
      `X-Napier-Memory-${status[0]!.toUpperCase()}${status.slice(1)}-Count`,
      String(memories.filter((memory) => memory.status === status).length),
    );
  }
}

function setMemoryProjectionHeaders(
  context: Context,
  memory: MemoryFact,
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, memory);
  context.header("X-Napier-Memory-Id", memory.id);
  context.header("X-Napier-Memory-Status", memory.status);
  context.header("X-Napier-Memory-Revision", String(memory.revision));
  context.header("X-Napier-Memory-Scope", memory.scope);
  context.header("X-Napier-Memory-Category", memory.category);
  context.header(
    "X-Napier-Memory-Review-Interval-Days",
    String(memory.reviewIntervalDays),
  );
  context.header("X-Napier-Memory-Use-Count", String(memory.useCount));
  if (memory.agentId) {
    context.header("X-Napier-Agent-Id", memory.agentId);
  }
  if (memory.reviewDueAt) {
    context.header("X-Napier-Memory-Review-Due-At", memory.reviewDueAt);
  }
  if (memory.supersedesMemoryId) {
    context.header("X-Napier-Memory-Supersedes-Id", memory.supersedesMemoryId);
  }
  if (memory.supersededByMemoryId) {
    context.header(
      "X-Napier-Memory-Superseded-By-Id",
      memory.supersededByMemoryId,
    );
  }
  if (memory.consolidatesMemoryIds) {
    context.header(
      "X-Napier-Memory-Consolidates-Count",
      String(memory.consolidatesMemoryIds.length),
    );
  }
}

function setCredentialReferenceListHeaders(
  context: Context,
  references: readonly CredentialReference[],
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, references);
  context.header("X-Napier-Credential-Count", String(references.length));
  for (const status of [
    "active",
    "disabled",
  ] satisfies CredentialReference["status"][]) {
    context.header(
      `X-Napier-Credential-${status[0]!.toUpperCase()}${status.slice(1)}-Count`,
      String(
        references.filter((reference) => reference.status === status).length,
      ),
    );
  }
  for (const availability of [
    "unknown",
    "available",
    "missing",
    "error",
  ] satisfies CredentialReference["availability"][]) {
    context.header(
      `X-Napier-Credential-${availability[0]!.toUpperCase()}${availability.slice(1)}-Count`,
      String(
        references.filter(
          (reference) => reference.availability === availability,
        ).length,
      ),
    );
  }
}

function setCredentialReferenceHeaders(
  context: Context,
  reference: CredentialReference,
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, reference);
  context.header("X-Napier-Credential-Id", reference.id);
  context.header("X-Napier-Credential-Provider", reference.providerId);
  context.header("X-Napier-Credential-Source-Type", reference.source.type);
  context.header("X-Napier-Credential-Status", reference.status);
  context.header("X-Napier-Credential-Availability", reference.availability);
  context.header("X-Napier-Credential-Revision", String(reference.revision));
  if (reference.lastCheckedAt) {
    context.header(
      "X-Napier-Credential-Last-Checked-At",
      reference.lastCheckedAt,
    );
  }
}

function setThreadDetailProjectionHeaders(
  context: Context,
  detail: ThreadDetail,
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, detail);
  context.header("X-Napier-Thread-Id", detail.thread.id);
  context.header(
    "X-Napier-Thread-Detail-Bytes",
    String(jsonByteLength(detail)),
  );
  context.header(
    "X-Napier-Thread-Event-Bytes",
    String(jsonByteLength(detail.events)),
  );
  context.header("X-Napier-Run-Count", String(detail.runs.length));
  context.header("X-Napier-Event-Count", String(detail.events.length));
  context.header("X-Napier-Plan-Count", String(detail.plans.length));
  context.header(
    "X-Napier-Evaluation-Count",
    String(detail.evaluations.length),
  );
  context.header("X-Napier-Subagent-Count", String(detail.subagents.length));
  context.header(
    "X-Napier-Run-Control-Message-Count",
    String(detail.runControlMessages.length),
  );
  context.header(
    "X-Napier-Operator-Decision-Count",
    String(detail.operatorDecisions.length),
  );
  context.header(
    "X-Napier-Recovery-Assessment-Count",
    String(detail.automaticRecoveryAssessments.length),
  );
  context.header(
    "X-Napier-Recovery-Attempt-Count",
    String(detail.automaticRecoveryAttempts.length),
  );
  const provenance = detail.thread.importProvenance;
  if (!provenance) return;
  context.header("X-Napier-Import-Source-Thread-Id", provenance.sourceThreadId);
  context.header(
    "X-Napier-Import-Source-API-Version",
    provenance.sourceApiVersion,
  );
  context.header(
    "X-Napier-Import-Source-Content-SHA256",
    provenance.sourceContentSha256,
  );
  context.header(
    "X-Napier-Import-Source-Event-Stream-SHA256",
    provenance.sourceEventStreamSha256,
  );
  context.header(
    "X-Napier-Import-Source-Event-Count",
    String(provenance.sourceEventCount),
  );
  if (provenance.localImportedThroughSeq !== undefined) {
    context.header(
      "X-Napier-Import-Local-Imported-Through-Seq",
      String(provenance.localImportedThroughSeq),
    );
  }
  if (provenance.sourceModelContextEnvelopeCount !== undefined) {
    context.header(
      "X-Napier-Import-Source-Model-Context-Envelope-Count",
      String(provenance.sourceModelContextEnvelopeCount),
    );
  }
  if (provenance.sourceEmbeddedModelContextEnvelopeCount !== undefined) {
    context.header(
      "X-Napier-Import-Source-Embedded-Model-Context-Envelope-Count",
      String(provenance.sourceEmbeddedModelContextEnvelopeCount),
    );
  }
  context.header("X-Napier-Imported-At", provenance.importedAt);
  const receipt = importProvenanceReceipt(detail);
  if (receipt) {
    context.header("X-Napier-Import-Receipt-Seq", String(receipt.seq));
    context.header("X-Napier-Import-Receipt-SHA256", receipt.payloadSha256);
  }
}

function setWorkspaceProcessProjectionHeaders(
  context: Context,
  projection: unknown,
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, projection);
}

function setWorkspaceFileProjectionHeaders(
  context: Context,
  projection: unknown,
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, projection);
}

function importProvenanceReceipt(
  detail: ThreadDetail,
): { seq: number; payloadSha256: string } | undefined {
  const provenance = detail.thread.importProvenance;
  if (provenance?.localImportedThroughSeq === undefined) return undefined;
  const event = detail.events.find(
    (candidate) =>
      candidate.type === "thread.imported" &&
      candidate.seq === provenance.localImportedThroughSeq &&
      candidate.category === "lifecycle" &&
      candidate.visibility === "debug" &&
      candidate.createdAt === provenance.importedAt,
  );
  if (!event) return undefined;
  return {
    seq: event.seq,
    payloadSha256: sha256Json(event.payload),
  };
}

function setSubagentOutcomeEvidenceVerificationHeaders(
  context: Context,
  verification: SubagentOutcomeEvidenceVerification,
): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, verification.contentSha256);
  context.header("X-Napier-Evidence-Verification-Status", verification.status);
  context.header("X-Napier-Subagent-Task-Id", verification.taskId);
  context.header(
    "X-Napier-Subagent-Outcome-SHA256",
    verification.outcomeSha256,
  );
  context.header("X-Napier-Evidence-Count", String(verification.evidenceCount));
  context.header(
    "X-Napier-Evidence-Aligned-Count",
    String(verification.alignedCount),
  );
  context.header(
    "X-Napier-Evidence-Divergent-Count",
    String(verification.divergentCount),
  );
  context.header(
    "X-Napier-Evidence-Missing-Count",
    String(verification.missingCount),
  );
}

function setSubagentOutcomeReviewHeaders(
  context: Context,
  review: SubagentOutcomeReview,
): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, review.reviewSha256);
  context.header("X-Napier-Subagent-Task-Id", review.taskId);
  context.header("X-Napier-Subagent-Outcome-SHA256", review.outcomeSha256);
  context.header("X-Napier-Subagent-Review-Verdict", review.verdict);
  context.header("X-Napier-Subagent-Review-Score", String(review.score));
  context.header("X-Napier-Subagent-Review-Risk", review.risk);
  context.header(
    "X-Napier-Subagent-Review-Concern-Count",
    String(review.concerns.length),
  );
  context.header(
    "X-Napier-Subagent-Review-Input-Tokens",
    String(review.usage.inputTokens),
  );
  context.header(
    "X-Napier-Subagent-Review-Output-Tokens",
    String(review.usage.outputTokens),
  );
  context.header(
    "X-Napier-Subagent-Review-Cost-USD",
    String(review.usage.costUsd),
  );
  if (review.modelContextEnvelope) {
    context.header(
      "X-Napier-Subagent-Review-Model-Context-Envelope-SHA256",
      review.modelContextEnvelope.contentSha256,
    );
  }
}

function setRunControlMessageHeaders(
  context: Context,
  message: RunControlMessage,
): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, message.contentSha256);
  context.header("X-Napier-Thread-Id", message.threadId);
  context.header("X-Napier-Run-Id", message.runId);
  context.header("X-Napier-Run-Control-Message-Id", message.id);
  context.header("X-Napier-Run-Control-Mode", message.mode);
  context.header("X-Napier-Run-Control-Status", message.status);
  context.header("X-Napier-Run-Control-Text-SHA256", message.textSha256);
  context.header("X-Napier-Run-Control-Text-Bytes", String(message.textBytes));
  context.header(
    "X-Napier-Run-Control-Queued-Event-Seq",
    String(message.queuedEventSeq),
  );
  if (message.deliveredEventSeq !== undefined) {
    context.header(
      "X-Napier-Run-Control-Delivered-Event-Seq",
      String(message.deliveredEventSeq),
    );
  }
  if (message.messageEventSeq !== undefined) {
    context.header(
      "X-Napier-Run-Control-Message-Event-Seq",
      String(message.messageEventSeq),
    );
  }
  if (message.cancellationEventSeq !== undefined) {
    context.header(
      "X-Napier-Run-Control-Cancellation-Event-Seq",
      String(message.cancellationEventSeq),
    );
  }
  if (message.cancellationReason) {
    context.header(
      "X-Napier-Run-Control-Cancellation-Reason",
      message.cancellationReason,
    );
  }
}

function setRunControlMessageListHeaders(
  context: Context,
  threadId: string,
  runId: string,
  messages: RunControlMessage[],
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, messages);
  context.header("X-Napier-Thread-Id", threadId);
  context.header("X-Napier-Run-Id", runId);
  context.header("X-Napier-Run-Control-Message-Count", String(messages.length));
  for (const status of [
    "queued",
    "delivered",
    "cancelled",
  ] satisfies RunControlMessage["status"][]) {
    context.header(
      `X-Napier-Run-Control-${status[0]!.toUpperCase()}${status.slice(1)}-Count`,
      String(messages.filter((message) => message.status === status).length),
    );
  }
  for (const mode of [
    "steering",
    "follow_up",
  ] satisfies RunControlMessage["mode"][]) {
    context.header(
      `X-Napier-Run-Control-${mode === "steering" ? "Steering" : "Follow-Up"}-Count`,
      String(messages.filter((message) => message.mode === mode).length),
    );
  }
}

function runControlMessageErrorStatus(error: unknown): 400 | 404 | 409 {
  const message = errorMessage(error).toLowerCase();
  if (message.includes("not found")) return 404;
  if (
    message.includes("active thread run") ||
    message.includes("cannot be cancelled") ||
    message.includes("limit reached") ||
    message.includes("demo model")
  ) {
    return 409;
  }
  return 400;
}

function setOperatorDecisionHeaders(
  context: Context,
  decision: OperatorDecision,
): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, decision.contentSha256);
  context.header("X-Napier-Thread-Id", decision.threadId);
  context.header("X-Napier-Run-Id", decision.runId);
  context.header("X-Napier-Operator-Decision-Id", decision.id);
  context.header("X-Napier-Operator-Decision-Status", decision.status);
  context.header(
    "X-Napier-Operator-Decision-Question-SHA256",
    decision.questionSha256,
  );
  context.header(
    "X-Napier-Operator-Decision-Option-Count",
    String(decision.options.length),
  );
  context.header(
    "X-Napier-Operator-Decision-Requested-Event-Seq",
    String(decision.requestedEventSeq),
  );
  setOptionalNumberHeader(
    context,
    "X-Napier-Operator-Decision-Answered-Event-Seq",
    decision.answeredEventSeq,
  );
  setOptionalNumberHeader(
    context,
    "X-Napier-Operator-Decision-Continued-Event-Seq",
    decision.continuedEventSeq,
  );
  setOptionalNumberHeader(
    context,
    "X-Napier-Operator-Decision-Cancellation-Event-Seq",
    decision.cancellationEventSeq,
  );
  setOptionalHeader(
    context,
    "X-Napier-Operator-Decision-Answer-SHA256",
    decision.answerSha256,
  );
  setOptionalHeader(
    context,
    "X-Napier-Operator-Decision-Continuation-Run-Id",
    decision.continuationRunId,
  );
  setOptionalHeader(
    context,
    "X-Napier-Operator-Decision-Cancellation-Reason",
    decision.cancellationReason,
  );
}

function setOperatorDecisionListHeaders(
  context: Context,
  threadId: string,
  decisions: OperatorDecision[],
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, decisions);
  context.header("X-Napier-Thread-Id", threadId);
  context.header("X-Napier-Operator-Decision-Count", String(decisions.length));
  for (const status of [
    "pending",
    "answered",
    "continued",
    "cancelled",
  ] satisfies OperatorDecision["status"][]) {
    context.header(
      `X-Napier-Operator-Decision-${status[0]!.toUpperCase()}${status.slice(1)}-Count`,
      String(decisions.filter((decision) => decision.status === status).length),
    );
  }
}

function setAgentMilestoneListHeaders(
  context: Context,
  threadId: string,
  milestones: AgentMilestone[],
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, milestones);
  context.header("X-Napier-Thread-Id", threadId);
  context.header("X-Napier-Agent-Milestone-Count", String(milestones.length));
  context.header(
    "X-Napier-Agent-Milestone-Evidence-Event-Count",
    String(
      milestones.reduce(
        (total, milestone) => total + milestone.evidence.eventCount,
        0,
      ),
    ),
  );
  const latest = milestones.at(-1);
  setOptionalHeader(context, "X-Napier-Agent-Milestone-Latest-Id", latest?.id);
  setOptionalHeader(
    context,
    "X-Napier-Agent-Milestone-Latest-Content-SHA256",
    latest?.contentSha256,
  );
  for (const phase of [
    "planning",
    "execution",
    "verification",
    "delivery",
  ] satisfies AgentMilestone["phase"][]) {
    context.header(
      `X-Napier-Agent-Milestone-${phase[0]!.toUpperCase()}${phase.slice(1)}-Count`,
      String(
        milestones.filter((milestone) => milestone.phase === phase).length,
      ),
    );
  }
}

function setOperatorDecisionContinueStreamHeaders(
  context: Context,
  threadId: string,
  decisionId: string,
): void {
  context.header("X-Accel-Buffering", "no");
  context.header("X-Napier-Thread-Id", threadId);
  context.header("X-Napier-Operator-Decision-Id", decisionId);
  context.header("X-Napier-Run-Intent", "operator-decision-continuation");
  setThreadRunStreamErrorHeaders(context);
}

function operatorDecisionErrorStatus(error: unknown): 400 | 404 | 409 {
  const message = errorMessage(error).toLowerCase();
  if (message.includes("not found")) return 404;
  if (
    message.includes("requires a waiting thread") ||
    message.includes("already been answered") ||
    message.includes("cannot be answered") ||
    message.includes("cannot be cancelled") ||
    message.includes("cannot continue") ||
    message.includes("while the thread is running")
  ) {
    return 409;
  }
  return 400;
}

function setThreadEventsProjectionHeaders(
  context: Context,
  threadId: string,
  events: readonly RunEvent[],
  afterSeq: number,
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, events);
  context.header("X-Napier-Thread-Id", threadId);
  context.header("X-Napier-After-Seq", String(afterSeq));
  context.header("X-Napier-Event-Count", String(events.length));
  context.header("X-Napier-Event-Bytes", String(jsonByteLength(events)));
  const firstSeq = events[0]?.seq;
  const lastSeq = events.at(-1)?.seq;
  if (firstSeq !== undefined) {
    context.header("X-Napier-First-Event-Seq", String(firstSeq));
  }
  if (lastSeq !== undefined) {
    context.header("X-Napier-Last-Event-Seq", String(lastSeq));
  }
}

function setThreadStopHeaders(
  context: Context,
  threadId: string,
  receipt: { stopped: boolean },
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, receipt);
  context.header("X-Napier-Thread-Id", threadId);
  context.header("X-Napier-Thread-Stopped", String(receipt.stopped));
}

function setThreadResumeStreamHeaders(
  context: Context,
  threadId: string,
  runId: string | undefined,
  model: ResumeRunRequest["model"] | undefined,
): void {
  context.header("X-Napier-Thread-Id", threadId);
  context.header("X-Napier-Resume-Requested", "true");
  setThreadRunStreamErrorHeaders(context);
  if (runId) {
    context.header("X-Napier-Run-Id", runId);
  }
  setThreadRunStreamModelHeaders(context, model);
}

function setThreadPromptStreamHeaders(
  context: Context,
  threadId: string,
  model: PromptRequest["model"] | undefined,
): void {
  context.header("X-Napier-Thread-Id", threadId);
  context.header("X-Napier-Prompt-Requested", "true");
  setThreadRunStreamErrorHeaders(context);
  setThreadRunStreamModelHeaders(context, model);
}

function setThreadRunStreamModelHeaders(
  context: Context,
  model: PromptRequest["model"] | ResumeRunRequest["model"] | undefined,
): void {
  if (model) {
    context.header("X-Napier-Model-Provider", model.provider);
    context.header("X-Napier-Model-Id", model.id);
  }
}

function setThreadRunStreamErrorHeaders(context: Context): void {
  context.header("X-Napier-Stream-Error-Code", RUN_STREAM_ERROR_CODE);
  context.header("X-Napier-Stream-Error-Diagnostic", "sha256");
  context.header(
    "X-Napier-Stream-Error-Message-SHA256",
    sha256Text(RUN_STREAM_ERROR_MESSAGE),
  );
}

function setThreadReplayBundleHeaders(
  context: Context,
  bundle: ThreadReplayBundle,
  verification: ThreadReplayBundleVerification,
): void {
  context.header("Cache-Control", "no-store");
  context.header(
    "Content-Disposition",
    `attachment; filename="${threadReplayBundleFilename(bundle)}"`,
  );
  setStableContentSha256Header(context, bundle.contentSha256);
  context.header("X-Napier-Thread-Id", bundle.thread.id);
  context.header("X-Napier-Event-Stream-SHA256", bundle.eventStreamSha256);
  context.header("X-Napier-Verification-Status", verification.status);
  context.header("X-Napier-Event-Count", String(verification.eventCount));
  context.header("X-Napier-Run-Count", String(verification.runCount));
  context.header("X-Napier-Plan-Count", String(verification.planCount));
  context.header(
    "X-Napier-Evaluation-Count",
    String(verification.evaluationCount),
  );
  context.header(
    "X-Napier-Model-Context-Envelope-Count",
    String(verification.modelContextEnvelopeCount),
  );
  context.header(
    "X-Napier-Embedded-Model-Context-Envelope-Count",
    String(verification.embeddedModelContextEnvelopeCount),
  );
  setEventBoundaryHeaders(context, bundle.events);
}

function threadReplayBundleFilename(bundle: ThreadReplayBundle): string {
  const safeThreadId = safeFilenameSegment(bundle.thread.id, "thread");
  return `napier-thread-${safeThreadId}-${bundle.contentSha256.slice(0, 12)}.json`;
}

function setThreadReplayBundleVerificationHeaders(
  context: Context,
  verification: ThreadReplayBundleVerification,
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, verification);
  context.header("X-Napier-Verification-Status", verification.status);
  context.header("X-Napier-Event-Count", String(verification.eventCount));
  context.header("X-Napier-Run-Count", String(verification.runCount));
  context.header("X-Napier-Plan-Count", String(verification.planCount));
  context.header(
    "X-Napier-Evaluation-Count",
    String(verification.evaluationCount),
  );
  context.header(
    "X-Napier-Model-Context-Envelope-Count",
    String(verification.modelContextEnvelopeCount),
  );
  context.header(
    "X-Napier-Embedded-Model-Context-Envelope-Count",
    String(verification.embeddedModelContextEnvelopeCount),
  );
  context.header(
    "X-Napier-Diagnostic-Count",
    String(verification.diagnostics.length),
  );
  context.header(
    "X-Napier-Diagnostics-SHA256",
    sha256Json(verification.diagnostics),
  );
  if (verification.threadId) {
    context.header("X-Napier-Thread-Id", verification.threadId);
  }
  if (verification.agentId) {
    context.header("X-Napier-Agent-Id", verification.agentId);
  }
  if (verification.contentSha256) {
    context.header("X-Napier-Bundle-SHA256", verification.contentSha256);
  }
  if (verification.eventStreamSha256) {
    context.header(
      "X-Napier-Event-Stream-SHA256",
      verification.eventStreamSha256,
    );
  }
}

function bindOpenTelemetryTraceArtifactVerification(
  verification: OpenTelemetryTraceArtifactVerification,
  threadId: string,
): OpenTelemetryTraceArtifactVerification {
  if (verification.status !== "valid") return verification;
  if (verification.threadId === threadId) return verification;
  return {
    ...verification,
    status: "invalid",
    diagnostics: ["path_mismatch"],
  };
}

function setOpenTelemetryTraceArtifactVerificationHeaders(
  context: Context,
  verification: OpenTelemetryTraceArtifactVerification,
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, verification);
  context.header("X-Napier-Verification-Status", verification.status);
  context.header("X-Napier-Span-Count", String(verification.spanCount));
  context.header("X-Napier-Event-Count", String(verification.eventCount));
  context.header(
    "X-Napier-Diagnostic-Count",
    String(verification.diagnostics.length),
  );
  context.header(
    "X-Napier-Diagnostics-SHA256",
    sha256Json(verification.diagnostics),
  );
  if (verification.threadId) {
    context.header("X-Napier-Thread-Id", verification.threadId);
  }
  if (verification.runId) {
    context.header("X-Napier-Run-Id", verification.runId);
  }
  if (verification.traceId) {
    context.header("X-Napier-Trace-Id", verification.traceId);
  }
  if (verification.contentSha256) {
    context.header("X-Napier-Trace-SHA256", verification.contentSha256);
  }
  if (verification.eventStreamSha256) {
    context.header(
      "X-Napier-Event-Stream-SHA256",
      verification.eventStreamSha256,
    );
  }
  if (verification.eventAnchorSetSha256) {
    context.header(
      "X-Napier-Event-Anchor-Set-SHA256",
      verification.eventAnchorSetSha256,
    );
  }
}

function bindRunReplaySnapshotVerification(
  verification: RunReplaySnapshotVerification,
  threadId: string,
  runId: string,
): RunReplaySnapshotVerification {
  if (verification.status !== "valid") return verification;
  if (verification.threadId === threadId && verification.runId === runId) {
    return verification;
  }
  return {
    ...verification,
    status: "invalid",
    diagnostics: ["path_mismatch"],
  };
}

function setRunReplaySnapshotHeaders(
  context: Context,
  snapshot: RunReplaySnapshot,
): void {
  context.header("Cache-Control", "no-store");
  context.header(
    "Content-Disposition",
    `attachment; filename="${runReplaySnapshotFilename(snapshot)}"`,
  );
  setBodyContentSha256Header(context, snapshot);
  context.header("X-Napier-Thread-Id", snapshot.threadId);
  context.header("X-Napier-Run-Id", snapshot.run.id);
  context.header("X-Napier-Snapshot-SHA256", snapshot.contentSha256);
  context.header("X-Napier-Event-Stream-SHA256", snapshot.eventStreamSha256);
  context.header("X-Napier-Event-Count", String(snapshot.events.length));
  context.header("X-Napier-Subagent-Count", String(snapshot.subagents.length));
  setRunMetricsHeaders(context, "X-Napier-Run", snapshot.metrics);
  if (snapshot.configurationSha256) {
    context.header(
      "X-Napier-Configuration-SHA256",
      snapshot.configurationSha256,
    );
  }
  setEventBoundaryHeaders(context, snapshot.events);
}

function runReplaySnapshotFilename(snapshot: RunReplaySnapshot): string {
  const safeRunId = safeFilenameSegment(snapshot.run.id, "run");
  return `napier-${safeRunId}-replay-${snapshot.contentSha256.slice(0, 12)}.json`;
}

function safeFilenameSegment(value: string, fallback: string): string {
  const normalized = value.replace(/[^A-Za-z0-9._-]/g, "_");
  return normalized.length > 0 ? normalized : fallback;
}

function setRunReplaySnapshotVerificationHeaders(
  context: Context,
  verification: RunReplaySnapshotVerification,
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, verification);
  context.header("X-Napier-Verification-Status", verification.status);
  context.header("X-Napier-Event-Count", String(verification.eventCount));
  context.header("X-Napier-Subagent-Count", String(verification.subagentCount));
  context.header(
    "X-Napier-Model-Context-Envelope-Count",
    String(verification.modelContextEnvelopeCount),
  );
  context.header(
    "X-Napier-Embedded-Model-Context-Envelope-Count",
    String(verification.embeddedModelContextEnvelopeCount),
  );
  context.header(
    "X-Napier-Diagnostic-Count",
    String(verification.diagnostics.length),
  );
  context.header(
    "X-Napier-Diagnostics-SHA256",
    sha256Json(verification.diagnostics),
  );
  if (verification.threadId) {
    context.header("X-Napier-Thread-Id", verification.threadId);
  }
  if (verification.runId) {
    context.header("X-Napier-Run-Id", verification.runId);
  }
  if (verification.contentSha256) {
    context.header("X-Napier-Snapshot-SHA256", verification.contentSha256);
  }
  if (verification.eventStreamSha256) {
    context.header(
      "X-Napier-Event-Stream-SHA256",
      verification.eventStreamSha256,
    );
  }
  if (verification.configurationSha256) {
    context.header(
      "X-Napier-Configuration-SHA256",
      verification.configurationSha256,
    );
  }
  if (verification.assistantTextSha256) {
    context.header(
      "X-Napier-Assistant-Text-SHA256",
      verification.assistantTextSha256,
    );
  }
}

function setRunComparisonHeaders(
  context: Context,
  comparison: RunComparison,
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, comparison);
  context.header("X-Napier-Thread-Id", comparison.threadId);
  context.header("X-Napier-Left-Run-Id", comparison.left.run.id);
  context.header("X-Napier-Right-Run-Id", comparison.right.run.id);
  context.header(
    "X-Napier-Left-Event-Stream-SHA256",
    comparison.left.eventStreamSha256,
  );
  context.header(
    "X-Napier-Right-Event-Stream-SHA256",
    comparison.right.eventStreamSha256,
  );
  context.header(
    "X-Napier-Left-Event-Count",
    String(comparison.left.events.length),
  );
  context.header(
    "X-Napier-Right-Event-Count",
    String(comparison.right.events.length),
  );
  setRunMetricsHeaders(context, "X-Napier-Left-Run", comparison.left.metrics);
  setRunMetricsHeaders(context, "X-Napier-Right-Run", comparison.right.metrics);
  setRunMetricsHeaders(context, "X-Napier-Run-Delta", comparison.metricDelta);
  context.header("X-Napier-Output-Changed", String(comparison.outputChanged));
  context.header(
    "X-Napier-Configuration-Delta-Status",
    comparison.configurationDelta.status,
  );
  context.header(
    "X-Napier-Context-Coverage-Status",
    comparison.contextCoverageDelta.status,
  );
  context.header(
    "X-Napier-Context-Coverage-Left-Rate",
    String(comparison.contextCoverageDelta.left.coverageRate),
  );
  context.header(
    "X-Napier-Context-Coverage-Right-Rate",
    String(comparison.contextCoverageDelta.right.coverageRate),
  );
  context.header(
    "X-Napier-Context-Coverage-Rate-Delta",
    String(comparison.contextCoverageDelta.coverageRateDelta),
  );
  context.header(
    "X-Napier-Context-Coverage-Left-Embedded-Envelope-Count",
    String(comparison.contextCoverageDelta.left.embeddedEnvelopeCount),
  );
  context.header(
    "X-Napier-Context-Coverage-Right-Embedded-Envelope-Count",
    String(comparison.contextCoverageDelta.right.embeddedEnvelopeCount),
  );
  context.header(
    "X-Napier-Context-Coverage-Embedded-Envelope-Delta",
    String(comparison.contextCoverageDelta.embeddedEnvelopeDelta),
  );
  context.header(
    "X-Napier-Context-Coverage-Diagnostic-Count",
    String(comparison.contextCoverageDelta.diagnostics.length),
  );
  context.header(
    "X-Napier-Context-Coverage-Diagnostics-SHA256",
    sha256Json(comparison.contextCoverageDelta.diagnostics),
  );
  context.header(
    "X-Napier-Trace-Summary-Boundary-Status",
    comparison.traceSummaryBoundaryDelta.status,
  );
  context.header(
    "X-Napier-Trace-Summary-Boundary-Left-Generic-Count",
    String(comparison.traceSummaryBoundaryDelta.left.generic),
  );
  context.header(
    "X-Napier-Trace-Summary-Boundary-Right-Generic-Count",
    String(comparison.traceSummaryBoundaryDelta.right.generic),
  );
  context.header(
    "X-Napier-Trace-Summary-Boundary-Generic-Delta",
    String(comparison.traceSummaryBoundaryDelta.genericDelta),
  );
  context.header(
    "X-Napier-Trace-Summary-Boundary-Diagnostic-Count",
    String(comparison.traceSummaryBoundaryDelta.diagnostics.length),
  );
  context.header(
    "X-Napier-Trace-Summary-Boundary-Diagnostics-SHA256",
    sha256Json(comparison.traceSummaryBoundaryDelta.diagnostics),
  );
  context.header(
    "X-Napier-Event-Type-Delta-SHA256",
    sha256Json(comparison.eventTypeDelta),
  );
  context.header(
    "X-Napier-Added-Tool-Count",
    String(comparison.addedToolNames.length),
  );
  context.header(
    "X-Napier-Removed-Tool-Count",
    String(comparison.removedToolNames.length),
  );
  context.header(
    "X-Napier-Added-Tools-SHA256",
    sha256Json(comparison.addedToolNames),
  );
  context.header(
    "X-Napier-Removed-Tools-SHA256",
    sha256Json(comparison.removedToolNames),
  );
  setRunConfigurationDeltaHeaders(context, comparison.configurationDelta);
  if (comparison.left.configurationSha256) {
    context.header(
      "X-Napier-Left-Configuration-SHA256",
      comparison.left.configurationSha256,
    );
  }
  if (comparison.right.configurationSha256) {
    context.header(
      "X-Napier-Right-Configuration-SHA256",
      comparison.right.configurationSha256,
    );
  }
}

function setRunConfigurationDeltaHeaders(
  context: Context,
  delta: RunComparison["configurationDelta"],
): void {
  context.header(
    "X-Napier-Configuration-Changed-Field-Count",
    String(delta.changedFields.length),
  );
  context.header(
    "X-Napier-Configuration-Changed-Fields-SHA256",
    sha256Json(delta.changedFields),
  );
  context.header(
    "X-Napier-Configuration-Added-Tool-Count",
    String(delta.addedTools.length),
  );
  context.header(
    "X-Napier-Configuration-Removed-Tool-Count",
    String(delta.removedTools.length),
  );
  context.header(
    "X-Napier-Configuration-Added-Tools-SHA256",
    sha256Json(delta.addedTools),
  );
  context.header(
    "X-Napier-Configuration-Removed-Tools-SHA256",
    sha256Json(delta.removedTools),
  );
  context.header(
    "X-Napier-Configuration-Added-Skill-Count",
    String(delta.addedSkills.length),
  );
  context.header(
    "X-Napier-Configuration-Removed-Skill-Count",
    String(delta.removedSkills.length),
  );
  context.header(
    "X-Napier-Configuration-Added-Skills-SHA256",
    sha256Json(delta.addedSkills),
  );
  context.header(
    "X-Napier-Configuration-Removed-Skills-SHA256",
    sha256Json(delta.removedSkills),
  );
  context.header(
    "X-Napier-Configuration-Added-Subagent-Count",
    String(delta.addedSubagents.length),
  );
  context.header(
    "X-Napier-Configuration-Removed-Subagent-Count",
    String(delta.removedSubagents.length),
  );
  context.header(
    "X-Napier-Configuration-Added-Subagents-SHA256",
    sha256Json(delta.addedSubagents),
  );
  context.header(
    "X-Napier-Configuration-Removed-Subagents-SHA256",
    sha256Json(delta.removedSubagents),
  );
}

function setRunMetricsHeaders(
  context: Context,
  prefix: string,
  metrics: Omit<RunMetrics, "assistantTextSha256"> & {
    assistantTextSha256?: string;
  },
): void {
  context.header(`${prefix}-Duration-Ms`, String(metrics.durationMs));
  context.header(`${prefix}-Event-Count`, String(metrics.eventCount));
  context.header(`${prefix}-Message-Count`, String(metrics.messageCount));
  context.header(
    `${prefix}-Model-Response-Count`,
    String(metrics.modelResponseCount),
  );
  context.header(
    `${prefix}-Model-Context-Envelope-Count`,
    String(metrics.modelContextEnvelopeCount),
  );
  context.header(
    `${prefix}-Embedded-Model-Context-Envelope-Count`,
    String(metrics.embeddedModelContextEnvelopeCount),
  );
  context.header(
    `${prefix}-Model-Context-Bound-Response-Count`,
    String(metrics.modelContextBoundResponseCount),
  );
  context.header(
    `${prefix}-Model-Context-Unbound-Response-Count`,
    String(metrics.modelContextUnboundResponseCount),
  );
  context.header(`${prefix}-Tool-Call-Count`, String(metrics.toolCallCount));
  context.header(
    `${prefix}-Tool-Completed-Count`,
    String(metrics.toolCompletedCount),
  );
  context.header(
    `${prefix}-Tool-Failed-Count`,
    String(metrics.toolFailedCount),
  );
  context.header(
    `${prefix}-Tool-Blocked-Count`,
    String(metrics.toolBlockedCount),
  );
  context.header(`${prefix}-Subagent-Count`, String(metrics.subagentCount));
  context.header(`${prefix}-Input-Tokens`, String(metrics.inputTokens));
  context.header(`${prefix}-Output-Tokens`, String(metrics.outputTokens));
  context.header(
    `${prefix}-Cache-Read-Tokens`,
    String(metrics.cacheReadTokens),
  );
  context.header(
    `${prefix}-Cache-Write-Tokens`,
    String(metrics.cacheWriteTokens),
  );
  context.header(`${prefix}-Cost-Usd`, String(metrics.costUsd));
  if (metrics.assistantTextSha256) {
    context.header(
      `${prefix}-Assistant-Text-SHA256`,
      metrics.assistantTextSha256,
    );
  }
}

function setRunEvaluationListHeaders(
  context: Context,
  threadId: string,
  evaluations: readonly RunEvaluationRecord[],
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, evaluations);
  context.header("X-Napier-Thread-Id", threadId);
  context.header("X-Napier-Evaluation-Count", String(evaluations.length));
}

function setRunEvaluationRecordHeaders(
  context: Context,
  evaluation: RunEvaluationRecord,
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, evaluation);
  context.header("X-Napier-Thread-Id", evaluation.threadId);
  context.header("X-Napier-Evaluation-Id", evaluation.id);
  context.header("X-Napier-Left-Run-Id", evaluation.leftRunId);
  context.header("X-Napier-Right-Run-Id", evaluation.rightRunId);
  context.header("X-Napier-Evaluation-Verdict", evaluation.verdict);
  context.header(
    "X-Napier-Left-Snapshot-SHA256",
    evaluation.leftSnapshotSha256,
  );
  context.header(
    "X-Napier-Right-Snapshot-SHA256",
    evaluation.rightSnapshotSha256,
  );
  context.header(
    "X-Napier-Evaluation-Criterion-Count",
    String(evaluation.scores.length),
  );
  if (evaluation.comparisonGovernance) {
    context.header(
      "X-Napier-Comparison-Governance-SHA256",
      evaluation.comparisonGovernance.contentSha256,
    );
    context.header(
      "X-Napier-Context-Coverage-Status",
      evaluation.comparisonGovernance.contextCoverageStatus,
    );
    context.header(
      "X-Napier-Context-Coverage-Diagnostics-SHA256",
      evaluation.comparisonGovernance.contextCoverageDiagnosticsSha256,
    );
    if (
      evaluation.comparisonGovernance.traceSummaryBoundaryStatus &&
      evaluation.comparisonGovernance.traceSummaryBoundaryDiagnosticsSha256
    ) {
      context.header(
        "X-Napier-Trace-Summary-Boundary-Status",
        evaluation.comparisonGovernance.traceSummaryBoundaryStatus,
      );
      context.header(
        "X-Napier-Trace-Summary-Boundary-Diagnostics-SHA256",
        evaluation.comparisonGovernance.traceSummaryBoundaryDiagnosticsSha256,
      );
    }
  }
}

function setEvaluationAdjudicationListHeaders(
  context: Context,
  threadId: string,
  adjudications: readonly EvaluationAdjudication[],
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, adjudications);
  context.header("X-Napier-Thread-Id", threadId);
  context.header("X-Napier-Adjudication-Count", String(adjudications.length));
  context.header(
    "X-Napier-Adjudication-Revision-Count",
    String(
      adjudications.reduce(
        (total, adjudication) => total + adjudication.revisions.length,
        0,
      ),
    ),
  );
}

function setEvaluationAdjudicationHeaders(
  context: Context,
  adjudication: EvaluationAdjudication,
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, adjudication);
  context.header("X-Napier-Thread-Id", adjudication.threadId);
  context.header("X-Napier-Evaluation-Id", adjudication.evaluationId);
  context.header("X-Napier-Adjudication-Id", adjudication.id);
  context.header(
    "X-Napier-Adjudication-Revision",
    String(adjudication.currentRevision),
  );
  context.header(
    "X-Napier-Adjudication-Revision-Count",
    String(adjudication.revisions.length),
  );
  const latest = adjudication.revisions.at(-1);
  if (latest) {
    context.header("X-Napier-Adjudication-SHA256", latest.contentSha256);
    context.header("X-Napier-Expected-Verdict", latest.expectedVerdict);
    context.header("X-Napier-Evaluation-SHA256", latest.evaluationSha256);
  }
}

function setEvaluationReviewerBallotListHeaders(
  context: Context,
  threadId: string,
  evaluationId: string,
  ballots: readonly EvaluationReviewerBallot[],
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, ballots);
  context.header("X-Napier-Thread-Id", threadId);
  context.header("X-Napier-Evaluation-Id", evaluationId);
  context.header("X-Napier-Reviewer-Ballot-Count", String(ballots.length));
  context.header(
    "X-Napier-Reviewer-Ballot-Revision-Count",
    String(
      ballots.reduce((total, ballot) => total + ballot.revisions.length, 0),
    ),
  );
}

function setEvaluationReviewerBallotHeaders(
  context: Context,
  ballot: EvaluationReviewerBallot,
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, ballot);
  context.header("X-Napier-Thread-Id", ballot.threadId);
  context.header("X-Napier-Evaluation-Id", ballot.evaluationId);
  context.header("X-Napier-Reviewer-Ballot-Id", ballot.id);
  context.header("X-Napier-Reviewer-Id", ballot.reviewerId);
  context.header(
    "X-Napier-Reviewer-Ballot-Revision",
    String(ballot.currentRevision),
  );
  context.header(
    "X-Napier-Reviewer-Ballot-Revision-Count",
    String(ballot.revisions.length),
  );
  const latest = ballot.revisions.at(-1);
  if (latest) {
    context.header("X-Napier-Reviewer-Ballot-SHA256", latest.contentSha256);
    context.header("X-Napier-Expected-Verdict", latest.expectedVerdict);
    context.header("X-Napier-Evaluation-SHA256", latest.evaluationSha256);
  }
}

function setEvaluationConsensusReportHeaders(
  context: Context,
  report: EvaluationConsensusReport,
): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, report.contentSha256);
  context.header("X-Napier-Thread-Id", report.threadId);
  context.header("X-Napier-Evaluation-Id", report.evaluationId);
  context.header("X-Napier-Consensus-Status", report.status);
  context.header("X-Napier-Reviewer-Count", String(report.reviewerCount));
  context.header("X-Napier-Consensus-Count", String(report.consensusCount));
  context.header("X-Napier-Agreement-Rate", String(report.agreementRate));
  if (report.consensusVerdict) {
    context.header("X-Napier-Consensus-Verdict", report.consensusVerdict);
  }
}

function setEvaluationConsensusResolutionListHeaders(
  context: Context,
  threadId: string,
  evaluationId: string,
  resolutions: readonly EvaluationConsensusResolution[],
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, resolutions);
  context.header("X-Napier-Thread-Id", threadId);
  context.header("X-Napier-Evaluation-Id", evaluationId);
  context.header(
    "X-Napier-Consensus-Resolution-Count",
    String(resolutions.length),
  );
}

function setEvaluationConsensusResolutionResultHeaders(
  context: Context,
  result: ResolveEvaluationConsensusResult,
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, result);
  context.header("X-Napier-Thread-Id", result.report.threadId);
  context.header("X-Napier-Evaluation-Id", result.report.evaluationId);
  context.header(
    "X-Napier-Consensus-Resolution-Created",
    String(result.created),
  );
  context.header("X-Napier-Consensus-Status", result.report.status);
  context.header(
    "X-Napier-Reviewer-Count",
    String(result.report.reviewerCount),
  );
  context.header(
    "X-Napier-Consensus-Count",
    String(result.report.consensusCount),
  );
  context.header(
    "X-Napier-Agreement-Rate",
    String(result.report.agreementRate),
  );
  context.header(
    "X-Napier-Consensus-Report-SHA256",
    result.report.contentSha256,
  );
  context.header("X-Napier-Adjudication-Id", result.adjudication.id);
  context.header(
    "X-Napier-Adjudication-Revision",
    String(result.adjudication.currentRevision),
  );
  if (result.report.consensusVerdict) {
    context.header(
      "X-Napier-Consensus-Verdict",
      result.report.consensusVerdict,
    );
  }
  context.header("X-Napier-Consensus-Resolution-Id", result.resolution.id);
  context.header(
    "X-Napier-Consensus-Resolution-SHA256",
    result.resolution.contentSha256,
  );
}

function setEvaluationSuiteListHeaders(
  context: Context,
  threadId: string,
  suites: readonly EvaluationSuite[],
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, suites);
  context.header("X-Napier-Thread-Id", threadId);
  context.header("X-Napier-Evaluation-Suite-Count", String(suites.length));
  context.header(
    "X-Napier-Evaluation-Suite-Revision-Count",
    String(suites.reduce((total, suite) => total + suite.revision, 0)),
  );
  context.header(
    "X-Napier-Evaluation-Suite-Candidate-Count",
    String(
      suites.reduce((total, suite) => total + suite.candidateRunIds.length, 0),
    ),
  );
}

function setEvaluationSuiteProjectionHeaders(
  context: Context,
  suite: EvaluationSuite,
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, suite);
  context.header("X-Napier-Thread-Id", suite.threadId);
  context.header("X-Napier-Evaluation-Suite-Id", suite.id);
  context.header("X-Napier-Evaluation-Suite-Revision", String(suite.revision));
  context.header(
    "X-Napier-Evaluation-Suite-Candidate-Count",
    String(suite.candidateRunIds.length),
  );
  context.header("X-Napier-Baseline-Run-Id", suite.baselineRunId);
}

function setEvaluationSuiteExecutionListHeaders(
  context: Context,
  threadId: string,
  suiteId: string | undefined,
  executions: readonly EvaluationSuiteExecution[],
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, executions);
  context.header("X-Napier-Thread-Id", threadId);
  if (suiteId) {
    context.header("X-Napier-Evaluation-Suite-Id", suiteId);
  }
  context.header(
    "X-Napier-Evaluation-Suite-Execution-Count",
    String(executions.length),
  );
  context.header(
    "X-Napier-Evaluation-Suite-Case-Count",
    String(
      executions.reduce(
        (total, execution) => total + execution.results.length,
        0,
      ),
    ),
  );
  context.header(
    "X-Napier-Evaluation-Suite-Passed-Count",
    String(
      executions.reduce((total, execution) => total + execution.passedCount, 0),
    ),
  );
  context.header(
    "X-Napier-Evaluation-Suite-Failed-Count",
    String(
      executions.reduce((total, execution) => total + execution.failedCount, 0),
    ),
  );
  context.header(
    "X-Napier-Evaluation-Suite-Inconclusive-Count",
    String(
      executions.reduce(
        (total, execution) => total + execution.inconclusiveCount,
        0,
      ),
    ),
  );
}

function setEvaluationSuiteExecutionHeaders(
  context: Context,
  execution: EvaluationSuiteExecution,
): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, execution.contentSha256);
  context.header("X-Napier-Thread-Id", execution.threadId);
  context.header("X-Napier-Evaluation-Suite-Id", execution.suiteId);
  context.header("X-Napier-Evaluation-Suite-Execution-Id", execution.id);
  context.header(
    "X-Napier-Evaluation-Suite-Revision",
    String(execution.suiteRevision),
  );
  context.header(
    "X-Napier-Evaluation-Suite-Execution-Status",
    execution.status,
  );
  context.header(
    "X-Napier-Evaluation-Suite-Case-Count",
    String(execution.results.length),
  );
  context.header(
    "X-Napier-Evaluation-Suite-Passed-Count",
    String(execution.passedCount),
  );
  context.header(
    "X-Napier-Evaluation-Suite-Failed-Count",
    String(execution.failedCount),
  );
  context.header(
    "X-Napier-Evaluation-Suite-Inconclusive-Count",
    String(execution.inconclusiveCount),
  );
  context.header(
    "X-Napier-Evaluation-Suite-Pass-Rate",
    String(execution.passRate),
  );
}

function setEvaluationSuiteGateReceiptHeaders(
  context: Context,
  receipt: EvaluationSuiteGateReceipt,
): void {
  context.header("Cache-Control", "no-store");
  context.header(
    "Content-Disposition",
    `attachment; filename="${evaluationSuiteGateReceiptFilename(receipt)}"`,
  );
  setStableContentSha256Header(context, receipt.contentSha256);
  context.header("X-Napier-Thread-Id", receipt.suite.threadId);
  context.header("X-Napier-Evaluation-Suite-Id", receipt.suite.id);
  context.header(
    "X-Napier-Evaluation-Suite-Revision",
    String(receipt.suite.revision),
  );
  context.header("X-Napier-Evaluation-Gate-State", receipt.state);
  context.header(
    "X-Napier-Evaluation-Count",
    String(receipt.evaluations.length),
  );
  if (receipt.execution) {
    context.header(
      "X-Napier-Evaluation-Suite-Execution-Id",
      receipt.execution.id,
    );
    context.header(
      "X-Napier-Evaluation-Suite-Execution-Status",
      receipt.execution.status,
    );
    context.header(
      "X-Napier-Evaluation-Suite-Execution-SHA256",
      receipt.execution.contentSha256,
    );
  }
}

function evaluationSuiteGateReceiptFilename(
  receipt: EvaluationSuiteGateReceipt,
): string {
  const safeSuiteId = safeFilenameSegment(receipt.suite.id, "suite");
  return `napier-gate-${safeSuiteId}-r${receipt.suite.revision}-${receipt.contentSha256.slice(0, 12)}.json`;
}

function setEvaluationCalibrationHeaders(
  context: Context,
  report: EvaluationCalibrationReport,
): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, report.contentSha256);
  context.header("X-Napier-Thread-Id", report.threadId);
  context.header(
    "X-Napier-Calibration-Sample-Count",
    String(report.sampleCount),
  );
  context.header(
    "X-Napier-Calibration-Agreement-Count",
    String(report.agreementCount),
  );
  context.header(
    "X-Napier-Calibration-Agreement-Rate",
    String(report.agreementRate),
  );
  context.header(
    "X-Napier-Calibration-Group-Count",
    String(report.groups.length),
  );
}

function setContextCheckpointCalibrationHeaders(
  context: Context,
  report: ContextCheckpointCalibrationReport,
): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, report.contentSha256);
  context.header("X-Napier-Thread-Id", report.threadId);
  context.header("X-Napier-Event-Stream-SHA256", report.eventStreamSha256);
  context.header(
    "X-Napier-Message-Event-Count",
    String(report.messageEventCount),
  );
  context.header("X-Napier-Checkpoint-Count", String(report.checkpointCount));
  context.header(
    "X-Napier-Verified-Checkpoint-Count",
    String(report.verifiedCheckpointCount),
  );
  context.header(
    "X-Napier-Drifted-Checkpoint-Count",
    String(report.driftedCheckpointCount),
  );
  context.header(
    "X-Napier-Malformed-Checkpoint-Count",
    String(report.malformedCheckpointCount),
  );
  context.header(
    "X-Napier-Context-Compaction-Failure-Count",
    String(report.failureCount),
  );
  context.header(
    "X-Napier-Covered-Message-Count",
    String(report.coveredMessageCount),
  );
  context.header("X-Napier-Coverage-Rate", String(report.coverageRate));
  context.header("X-Napier-Compression-Ratio", String(report.compressionRatio));
  context.header(
    "X-Napier-Fallback-Omitted-Message-Count",
    String(report.fallbackOmittedMessageCount),
  );
  if (report.latestValidCheckpointId) {
    context.header(
      "X-Napier-Latest-Checkpoint-Id",
      report.latestValidCheckpointId,
    );
  }
  if (report.latestValidCheckpointSampleSha256) {
    context.header(
      "X-Napier-Latest-Checkpoint-Sample-SHA256",
      report.latestValidCheckpointSampleSha256,
    );
  }
}

function setEvaluationCasebookListHeaders(
  context: Context,
  casebooks: readonly EvaluationCasebook[],
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, casebooks);
  context.header("X-Napier-Casebook-Count", String(casebooks.length));
  context.header(
    "X-Napier-Casebook-Revision-Count",
    String(
      casebooks.reduce(
        (total, casebook) => total + casebook.revisions.length,
        0,
      ),
    ),
  );
  context.header(
    "X-Napier-Case-Count",
    String(
      casebooks.reduce((total, casebook) => total + casebook.cases.length, 0),
    ),
  );
}

function setEvaluationCasebookProjectionHeaders(
  context: Context,
  casebook: EvaluationCasebook,
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, casebook);
  context.header("X-Napier-Casebook-Id", casebook.id);
  context.header(
    "X-Napier-Casebook-Revision",
    String(casebook.currentRevision),
  );
  context.header("X-Napier-Case-Count", String(casebook.cases.length));
  context.header(
    "X-Napier-Casebook-Revision-Count",
    String(casebook.revisions.length),
  );
}

function setEvaluationCasebookCalibrationHeaders(
  context: Context,
  report: EvaluationCasebookCalibrationReport,
): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, report.contentSha256);
  context.header("X-Napier-Casebook-Id", report.casebookId);
  context.header("X-Napier-Casebook-Revision", String(report.casebookRevision));
  context.header(
    "X-Napier-Calibration-Sample-Count",
    String(report.sampleCount),
  );
  context.header(
    "X-Napier-Calibration-Agreement-Count",
    String(report.agreementCount),
  );
  context.header(
    "X-Napier-Calibration-Agreement-Rate",
    String(report.agreementRate),
  );
  context.header(
    "X-Napier-Calibration-Group-Count",
    String(report.groups.length),
  );
}

function setEvaluationCasebookArtifactHeaders(
  context: Context,
  artifact: EvaluationCasebookArtifact,
): void {
  context.header("Cache-Control", "no-store");
  context.header(
    "Content-Disposition",
    `attachment; filename="${evaluationCasebookArtifactFilename(artifact)}"`,
  );
  setStableContentSha256Header(context, artifact.contentSha256);
  context.header("X-Napier-Casebook-Id", artifact.casebook.id);
  context.header(
    "X-Napier-Casebook-Revision",
    String(artifact.casebook.currentRevision),
  );
  context.header("X-Napier-Case-Count", String(artifact.casebook.cases.length));
  context.header(
    "X-Napier-Casebook-Revision-Count",
    String(artifact.casebook.revisions.length),
  );
  context.header(
    "X-Napier-Calibration-Sample-Count",
    String(artifact.calibration.sampleCount),
  );
  context.header(
    "X-Napier-Calibration-Agreement-Rate",
    String(artifact.calibration.agreementRate),
  );
}

function evaluationCasebookArtifactFilename(
  artifact: EvaluationCasebookArtifact,
): string {
  const safeCasebookId = safeFilenameSegment(artifact.casebook.id, "casebook");
  return `napier-casebook-${safeCasebookId}-r${artifact.casebook.currentRevision}-${artifact.contentSha256.slice(0, 12)}.json`;
}

function setEvaluationCasebookQualificationListHeaders(
  context: Context,
  casebookId: string,
  qualifications: readonly EvaluationCasebookQualificationExecution[],
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, qualifications);
  context.header("X-Napier-Casebook-Id", casebookId);
  context.header(
    "X-Napier-Qualification-Execution-Count",
    String(qualifications.length),
  );
  context.header(
    "X-Napier-Qualification-Sample-Count",
    String(
      qualifications.reduce(
        (total, qualification) => total + qualification.sampleCount,
        0,
      ),
    ),
  );
  context.header(
    "X-Napier-Qualification-Agreement-Count",
    String(
      qualifications.reduce(
        (total, qualification) => total + qualification.agreementCount,
        0,
      ),
    ),
  );
  context.header(
    "X-Napier-Qualification-Inconclusive-Count",
    String(
      qualifications.reduce(
        (total, qualification) => total + qualification.inconclusiveCount,
        0,
      ),
    ),
  );
  context.header(
    "X-Napier-Qualification-Unverified-Count",
    String(
      qualifications.reduce(
        (total, qualification) => total + qualification.unverifiedCount,
        0,
      ),
    ),
  );
}

function setEvaluationCasebookQualificationExecutionHeaders(
  context: Context,
  execution: EvaluationCasebookQualificationExecution,
): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, execution.contentSha256);
  context.header("X-Napier-Casebook-Id", execution.casebookId);
  context.header(
    "X-Napier-Casebook-Revision",
    String(execution.casebookRevision),
  );
  context.header("X-Napier-Qualification-Execution-Id", execution.id);
  context.header("X-Napier-Qualification-Execution-Status", execution.status);
  context.header("X-Napier-Audit-Thread-Id", execution.auditThreadId);
  context.header(
    "X-Napier-Qualification-Sample-Count",
    String(execution.sampleCount),
  );
  context.header(
    "X-Napier-Qualification-Agreement-Count",
    String(execution.agreementCount),
  );
  context.header(
    "X-Napier-Qualification-Inconclusive-Count",
    String(execution.inconclusiveCount),
  );
  context.header(
    "X-Napier-Qualification-Unverified-Count",
    String(execution.unverifiedCount),
  );
  context.header(
    "X-Napier-Qualification-Agreement-Rate",
    String(execution.agreementRate),
  );
}

function setEvaluationCasebookQualificationReceiptHeaders(
  context: Context,
  receipt: EvaluationCasebookQualificationReceipt,
): void {
  context.header("Cache-Control", "no-store");
  context.header(
    "Content-Disposition",
    `attachment; filename="${evaluationCasebookQualificationReceiptFilename(receipt)}"`,
  );
  setStableContentSha256Header(context, receipt.contentSha256);
  context.header("X-Napier-Casebook-Id", receipt.casebook.id);
  context.header(
    "X-Napier-Casebook-Revision",
    String(receipt.casebook.currentRevision),
  );
  context.header("X-Napier-Qualification-State", receipt.state);
  context.header("X-Napier-Case-Count", String(receipt.casebook.cases.length));
  context.header(
    "X-Napier-Casebook-Revision-Count",
    String(receipt.casebook.revisions.length),
  );
  if (receipt.execution) {
    context.header("X-Napier-Qualification-Execution-Id", receipt.execution.id);
    context.header(
      "X-Napier-Qualification-Execution-Status",
      receipt.execution.status,
    );
    context.header(
      "X-Napier-Qualification-Execution-SHA256",
      receipt.execution.contentSha256,
    );
    context.header("X-Napier-Audit-Thread-Id", receipt.execution.auditThreadId);
    context.header(
      "X-Napier-Qualification-Sample-Count",
      String(receipt.execution.sampleCount),
    );
    context.header(
      "X-Napier-Qualification-Agreement-Count",
      String(receipt.execution.agreementCount),
    );
    context.header(
      "X-Napier-Qualification-Inconclusive-Count",
      String(receipt.execution.inconclusiveCount),
    );
    context.header(
      "X-Napier-Qualification-Unverified-Count",
      String(receipt.execution.unverifiedCount),
    );
  }
}

function evaluationCasebookQualificationReceiptFilename(
  receipt: EvaluationCasebookQualificationReceipt,
): string {
  const safeCasebookId = safeFilenameSegment(receipt.casebook.id, "casebook");
  return `napier-casebook-qualification-${safeCasebookId}-r${receipt.casebook.currentRevision}-${receipt.contentSha256.slice(0, 12)}.json`;
}

function setEvaluationQualificationBaselineListHeaders(
  context: Context,
  casebookId: string,
  baselines: readonly EvaluationQualificationBaseline[],
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, baselines);
  context.header("X-Napier-Casebook-Id", casebookId);
  context.header(
    "X-Napier-Qualification-Baseline-Count",
    String(baselines.length),
  );
  const current = baselines.at(-1);
  if (current) {
    context.header("X-Napier-Qualification-Baseline-Id", current.id);
    context.header(
      "X-Napier-Qualification-Baseline-SHA256",
      current.contentSha256,
    );
    context.header(
      "X-Napier-Qualification-Execution-Id",
      current.qualificationExecutionId,
    );
    context.header(
      "X-Napier-Qualification-Execution-SHA256",
      current.qualificationExecutionSha256,
    );
  }
}

function setPromoteEvaluationQualificationBaselineResultHeaders(
  context: Context,
  result: PromoteEvaluationQualificationBaselineResult,
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, result);
  context.header("X-Napier-Casebook-Id", result.baseline.casebookId);
  context.header(
    "X-Napier-Casebook-Revision",
    String(result.baseline.casebookRevision),
  );
  context.header(
    "X-Napier-Qualification-Baseline-Created",
    String(result.created),
  );
  context.header("X-Napier-Qualification-Baseline-Id", result.baseline.id);
  context.header(
    "X-Napier-Qualification-Baseline-SHA256",
    result.baseline.contentSha256,
  );
  context.header(
    "X-Napier-Qualification-Execution-Id",
    result.baseline.qualificationExecutionId,
  );
  context.header(
    "X-Napier-Qualification-Execution-SHA256",
    result.baseline.qualificationExecutionSha256,
  );
  context.header(
    "X-Napier-Receipt-SHA256",
    result.baseline.envelope.receipt.contentSha256,
  );
  context.header(
    "X-Napier-Receipt-Artifact-SHA256",
    result.baseline.envelope.signature.receiptArtifactSha256,
  );
  context.header(
    "X-Napier-Envelope-SHA256",
    result.baseline.envelope.contentSha256,
  );
  context.header(
    "X-Napier-Signature-Key-Id",
    result.baseline.envelope.signature.keyId,
  );
}

function setReceiptTrustAnchorListHeaders(
  context: Context,
  anchors: readonly ReceiptTrustAnchor[],
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, anchors);
  context.header("X-Napier-Receipt-Trust-Anchor-Count", String(anchors.length));
  context.header(
    "X-Napier-Receipt-Trust-Trusted-Count",
    String(anchors.filter((anchor) => anchor.status === "trusted").length),
  );
  context.header(
    "X-Napier-Receipt-Trust-Revoked-Count",
    String(anchors.filter((anchor) => anchor.status === "revoked").length),
  );
  context.header(
    "X-Napier-Receipt-Trust-Signing-Capable-Count",
    String(anchors.filter((anchor) => Boolean(anchor.signingSource)).length),
  );
}

function setReceiptTrustAnchorDirectoryHeaders(
  context: Context,
  directory: ReceiptTrustAnchorDirectory,
): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, directory.contentSha256);
  context.header(
    "X-Napier-Receipt-Trust-Anchor-Directory-SHA256",
    directory.contentSha256,
  );
  context.header(
    "X-Napier-Receipt-Trust-Anchor-Directory-Anchor-Set-SHA256",
    directory.anchorSetSha256,
  );
  context.header(
    "X-Napier-Receipt-Trust-Anchor-Count",
    String(directory.anchorCount),
  );
  context.header(
    "X-Napier-Receipt-Trust-Trusted-Count",
    String(directory.trustedCount),
  );
  context.header(
    "X-Napier-Receipt-Trust-Revoked-Count",
    String(directory.revokedCount),
  );
}

function setReceiptTrustAnchorDirectoryQuorumHeaders(
  context: Context,
  quorum: ReceiptTrustAnchorDirectoryQuorum,
): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, quorum.contentSha256);
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-SHA256",
    quorum.contentSha256,
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Status",
    quorum.status,
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Policy-SHA256",
    quorum.policySha256,
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Source-Count",
    String(quorum.sourceCount),
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Candidate-Count",
    String(quorum.candidateCount),
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Agreement-Count",
    String(quorum.agreementCount),
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Agreement-Weight",
    String(quorum.agreementWeight),
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Distinct-Origin-Count",
    String(quorum.agreementDistinctSourceOriginCount),
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Metadata-Publisher-Count",
    String(quorum.agreementMetadataPublisherCount),
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Metadata-Publisher-Set-SHA256",
    quorum.agreementMetadataPublisherSetSha256,
  );
  context.header(
    "X-Napier-Diagnostic-Count",
    String(quorum.diagnostics.length),
  );
  context.header("X-Napier-Diagnostics-SHA256", sha256Json(quorum.diagnostics));
  if (quorum.selectedAnchorSetSha256) {
    context.header(
      "X-Napier-Receipt-Trust-Anchor-Directory-Anchor-Set-SHA256",
      quorum.selectedAnchorSetSha256,
    );
  }
  if (quorum.selectedDirectorySha256) {
    context.header(
      "X-Napier-Receipt-Trust-Anchor-Directory-SHA256",
      quorum.selectedDirectorySha256,
    );
  }
}

function setReceiptTrustAnchorDirectoryQuorumPromotionHeaders(
  context: Context,
  promotion: ReceiptTrustAnchorDirectoryQuorumPromotionReceipt,
): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, promotion.contentSha256);
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Promotion-SHA256",
    promotion.contentSha256,
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-SHA256",
    promotion.quorum.contentSha256,
  );
  context.header(
    "X-Napier-Receipt-Trust-Anchor-Directory-Anchor-Set-SHA256",
    promotion.selectedAnchorSetSha256,
  );
  context.header(
    "X-Napier-Receipt-Trust-Anchor-Directory-SHA256",
    promotion.selectedDirectorySha256,
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Selected-Subscription-Count",
    String(promotion.selectedSubscriptionCount),
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Selected-Metadata-Count",
    String(promotion.selectedMetadataCount),
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Selected-Metadata-Envelope-Set-SHA256",
    promotion.selectedMetadataEnvelopeSetSha256,
  );
}

function setReceiptTrustAnchorDirectoryQuorumPromotionBaselineListHeaders(
  context: Context,
  baselines: readonly ReceiptTrustAnchorDirectoryQuorumPromotionBaseline[],
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, baselines);
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Promotion-Baseline-Count",
    String(baselines.length),
  );
  const current = baselines.at(-1);
  if (current) {
    context.header(
      "X-Napier-Receipt-Trust-Directory-Quorum-Promotion-Baseline-Id",
      current.id,
    );
    context.header(
      "X-Napier-Receipt-Trust-Directory-Quorum-Promotion-Baseline-SHA256",
      current.contentSha256,
    );
    context.header(
      "X-Napier-Receipt-Trust-Directory-Quorum-Promotion-SHA256",
      current.envelope.receipt.contentSha256,
    );
    context.header("X-Napier-Envelope-SHA256", current.envelope.contentSha256);
  }
}

function setPromoteReceiptTrustAnchorDirectoryQuorumPromotionBaselineResultHeaders(
  context: Context,
  result: PromoteReceiptTrustAnchorDirectoryQuorumBaselineResult,
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, result);
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Promotion-Baseline-Created",
    String(result.created),
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Promotion-Baseline-Id",
    result.baseline.id,
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Promotion-Baseline-SHA256",
    result.baseline.contentSha256,
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Promotion-SHA256",
    result.baseline.envelope.receipt.contentSha256,
  );
  context.header(
    "X-Napier-Receipt-Artifact-SHA256",
    result.baseline.envelope.signature.receiptArtifactSha256,
  );
  context.header(
    "X-Napier-Envelope-SHA256",
    result.baseline.envelope.contentSha256,
  );
  context.header(
    "X-Napier-Signature-Key-Id",
    result.baseline.envelope.signature.keyId,
  );
  context.header(
    "X-Napier-Receipt-Trust-Anchor-Directory-Anchor-Set-SHA256",
    result.baseline.selectedAnchorSetSha256,
  );
  context.header(
    "X-Napier-Receipt-Trust-Anchor-Directory-SHA256",
    result.baseline.selectedDirectorySha256,
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Selected-Subscription-Set-SHA256",
    result.baseline.selectedSubscriptionSetSha256,
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Selected-Metadata-Envelope-Set-SHA256",
    result.baseline.selectedMetadataEnvelopeSetSha256,
  );
}

function setImportReceiptTrustAnchorDirectoryQuorumPromotionBaselineResultHeaders(
  context: Context,
  result: ImportReceiptTrustAnchorDirectoryQuorumPromotionBaselineResult,
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, result);
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Promotion-Baseline-Imported",
    String(result.imported),
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Promotion-Baseline-Expected-Current-SHA256",
    result.expectedCurrentBaselineSha256,
  );
  if (result.previousBaselineSha256) {
    context.header(
      "X-Napier-Receipt-Trust-Directory-Quorum-Promotion-Baseline-Previous-SHA256",
      result.previousBaselineSha256,
    );
  }
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Promotion-Baseline-Id",
    result.baseline.id,
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Promotion-Baseline-SHA256",
    result.baseline.contentSha256,
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Promotion-Baseline-Verification-SHA256",
    result.verification.contentSha256,
  );
  if (result.policyReview) {
    context.header(
      "X-Napier-Receipt-Trust-Directory-Quorum-Promotion-Baseline-Import-Policy-SHA256",
      result.policyReview.policySha256,
    );
    context.header(
      "X-Napier-Receipt-Trust-Directory-Quorum-Promotion-Baseline-Import-Policy-Review-SHA256",
      result.policyReview.contentSha256,
    );
  }
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Promotion-SHA256",
    result.baseline.envelope.receipt.contentSha256,
  );
  context.header(
    "X-Napier-Envelope-SHA256",
    result.baseline.envelope.contentSha256,
  );
  context.header(
    "X-Napier-Signature-Key-Id",
    result.baseline.envelope.signature.keyId,
  );
}

function setReceiptTrustAnchorDirectoryQuorumActivationDecisionResultHeaders(
  context: Context,
  result: SignReceiptTrustAnchorDirectoryQuorumActivationDecisionResult,
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, result);
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Decision",
    result.envelope.receipt.decision,
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Decision-SHA256",
    result.envelope.receipt.contentSha256,
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Promotion-Baseline-Id",
    result.baseline.id,
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Promotion-Baseline-SHA256",
    result.baseline.contentSha256,
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Promotion-Baseline-Verification-SHA256",
    result.verification.contentSha256,
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Promotion-Baseline-Import-Policy-SHA256",
    result.policyReview.policySha256,
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Promotion-Baseline-Import-Policy-Review-SHA256",
    result.policyReview.contentSha256,
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Source-Alignment-SHA256",
    result.sourceAlignment.contentSha256,
  );
  context.header("X-Napier-Envelope-SHA256", result.envelope.contentSha256);
  context.header("X-Napier-Signature-Key-Id", result.envelope.signature.keyId);
}

function setReceiptTrustAnchorDirectoryQuorumActivationDecisionHistoryHeaders(
  context: Context,
  history: ReceiptTrustAnchorDirectoryQuorumActivationDecisionHistory,
): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, history.contentSha256);
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Decision-Count",
    String(history.decisionCount),
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Approved-Count",
    String(history.approvedCount),
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Rejected-Count",
    String(history.rejectedCount),
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Distinct-Baseline-Count",
    String(history.distinctBaselineCount),
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Decision-Set-SHA256",
    history.decisionSetSha256,
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Baseline-Set-SHA256",
    history.baselineSetSha256,
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Policy-Review-Set-SHA256",
    history.policyReviewSetSha256,
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Source-Alignment-Set-SHA256",
    history.sourceAlignmentSetSha256,
  );
  setOptionalHeader(
    context,
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Latest-Decision-At",
    history.latestDecisionAt,
  );
}

function setReceiptTrustAnchorDirectoryQuorumActivationDecisionHistoryVerificationHeaders(
  context: Context,
  verification: ReceiptTrustAnchorDirectoryQuorumActivationDecisionHistoryVerification,
): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, verification.contentSha256);
  context.header("X-Napier-Verification-Status", verification.status);
  context.header(
    "X-Napier-Diagnostic-Count",
    String(verification.diagnostics.length),
  );
  context.header(
    "X-Napier-Diagnostics-SHA256",
    sha256Json(verification.diagnostics),
  );
  setOptionalHeader(
    context,
    "X-Napier-Declared-Content-SHA256",
    verification.declaredContentSha256,
  );
  setOptionalHeader(
    context,
    "X-Napier-Recomputed-Content-SHA256",
    verification.recomputedContentSha256,
  );
  context.header(
    "X-Napier-Current-Content-SHA256",
    verification.currentContentSha256,
  );
  setOptionalHeader(
    context,
    "X-Napier-Declared-Decision-Set-SHA256",
    verification.declaredDecisionSetSha256,
  );
  context.header(
    "X-Napier-Current-Decision-Set-SHA256",
    verification.currentDecisionSetSha256,
  );
  if (verification.declaredDecisionCount !== undefined) {
    context.header(
      "X-Napier-Declared-Decision-Count",
      String(verification.declaredDecisionCount),
    );
  }
  context.header(
    "X-Napier-Current-Decision-Count",
    String(verification.currentDecisionCount),
  );
}

function setReceiptTrustAnchorDirectoryQuorumActivationSelectionStateHeaders(
  context: Context,
  state: ReceiptTrustAnchorDirectoryQuorumActivationSelectionState,
): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, state.contentSha256);
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Active",
    String(state.hasSelection),
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Current-SHA256",
    state.currentSelectionSha256,
  );
  if (state.selection) {
    context.header(
      "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Id",
      state.selection.id,
    );
    context.header(
      "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Decision-Record-Id",
      state.selection.activationDecisionRecordId,
    );
    context.header(
      "X-Napier-Receipt-Trust-Directory-Quorum-Promotion-Baseline-Id",
      state.selection.baselineId,
    );
    context.header(
      "X-Napier-Receipt-Trust-Directory-Quorum-Promotion-Baseline-SHA256",
      state.selection.baselineSha256,
    );
    context.header(
      "X-Napier-Receipt-Trust-Anchor-Directory-Anchor-Set-SHA256",
      state.selection.selectedAnchorSetSha256,
    );
    context.header(
      "X-Napier-Receipt-Trust-Anchor-Directory-SHA256",
      state.selection.selectedDirectorySha256,
    );
  }
}

function setReceiptTrustAnchorDirectoryQuorumActivationSelectionDriftAuditHeaders(
  context: Context,
  audit: ReceiptTrustAnchorDirectoryQuorumActivationSelectionDriftAudit,
): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, audit.contentSha256);
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Drift-Status",
    audit.status,
  );
  context.header("X-Napier-Diagnostic-Count", String(audit.diagnostics.length));
  context.header("X-Napier-Diagnostics-SHA256", sha256Json(audit.diagnostics));
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Active",
    String(audit.hasSelection),
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-State-SHA256",
    audit.selectionStateSha256,
  );
  setOptionalHeader(
    context,
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Id",
    audit.selectionId,
  );
  setOptionalHeader(
    context,
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Current-SHA256",
    audit.selectionSha256,
  );
  setOptionalHeader(
    context,
    "X-Napier-Receipt-Trust-Anchor-Directory-Anchor-Set-SHA256",
    audit.selectedAnchorSetSha256,
  );
  setOptionalHeader(
    context,
    "X-Napier-Receipt-Trust-Anchor-Directory-SHA256",
    audit.selectedDirectorySha256,
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Status",
    audit.currentQuorumStatus,
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-SHA256",
    audit.currentQuorumSha256,
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Source-Count",
    String(audit.currentSourceCount),
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Agreement-Count",
    String(audit.currentAgreementCount),
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Agreement-Weight",
    String(audit.currentAgreementWeight),
  );
  setOptionalHeader(
    context,
    "X-Napier-Receipt-Trust-Directory-Quorum-Current-Anchor-Set-SHA256",
    audit.currentAnchorSetSha256,
  );
  setOptionalHeader(
    context,
    "X-Napier-Receipt-Trust-Directory-Quorum-Current-Directory-SHA256",
    audit.currentDirectorySha256,
  );
}

function setReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointHeaders(
  context: Context,
  checkpoint: ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpoint,
): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, checkpoint.contentSha256);
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Active",
    String(checkpoint.hasSelection),
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Count",
    String(checkpoint.selectionCount),
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Set-SHA256",
    checkpoint.selectionSetSha256,
  );
  setOptionalHeader(
    context,
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Chain-Tail-SHA256",
    checkpoint.selectionChainTailSha256,
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Current-SHA256",
    checkpoint.currentSelectionSha256,
  );
  setOptionalHeader(
    context,
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Id",
    checkpoint.currentSelectionId,
  );
  setOptionalHeader(
    context,
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Entry-SHA256",
    checkpoint.currentSelectionEntrySha256,
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Decision-Count",
    String(checkpoint.activationDecisionCount),
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Decision-Set-SHA256",
    checkpoint.activationDecisionSetSha256,
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Baseline-Set-SHA256",
    checkpoint.baselineSetSha256,
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Policy-Review-Set-SHA256",
    checkpoint.policyReviewSetSha256,
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Source-Alignment-Set-SHA256",
    checkpoint.sourceAlignmentSetSha256,
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Drift-Audit-SHA256",
    checkpoint.driftAuditSha256,
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Drift-Status",
    checkpoint.driftStatus,
  );
}

function setReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointVerificationHeaders(
  context: Context,
  verification: ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointVerification,
): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, verification.contentSha256);
  context.header("X-Napier-Verification-Status", verification.status);
  context.header(
    "X-Napier-Diagnostic-Count",
    String(verification.diagnostics.length),
  );
  context.header(
    "X-Napier-Diagnostics-SHA256",
    sha256Json(verification.diagnostics),
  );
  setOptionalHeader(
    context,
    "X-Napier-Declared-Content-SHA256",
    verification.declaredContentSha256,
  );
  setOptionalHeader(
    context,
    "X-Napier-Recomputed-Content-SHA256",
    verification.recomputedContentSha256,
  );
  context.header(
    "X-Napier-Current-Content-SHA256",
    verification.currentContentSha256,
  );
  setOptionalHeader(
    context,
    "X-Napier-Declared-Selection-Set-SHA256",
    verification.declaredSelectionSetSha256,
  );
  context.header(
    "X-Napier-Current-Selection-Set-SHA256",
    verification.currentSelectionSetSha256,
  );
  setOptionalHeader(
    context,
    "X-Napier-Declared-Selection-Chain-Tail-SHA256",
    verification.declaredSelectionChainTailSha256,
  );
  setOptionalHeader(
    context,
    "X-Napier-Current-Selection-Chain-Tail-SHA256",
    verification.currentSelectionChainTailSha256,
  );
  if (verification.declaredSelectionCount !== undefined) {
    context.header(
      "X-Napier-Declared-Selection-Count",
      String(verification.declaredSelectionCount),
    );
  }
  context.header(
    "X-Napier-Current-Selection-Count",
    String(verification.currentSelectionCount),
  );
  setOptionalHeader(
    context,
    "X-Napier-Declared-Selection-Current-SHA256",
    verification.declaredCurrentSelectionSha256,
  );
  context.header(
    "X-Napier-Current-Selection-SHA256",
    verification.currentSelectionSha256,
  );
}

function setReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointDiscoveryHeaders(
  context: Context,
  discovery: ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointDiscovery,
): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, discovery.contentSha256);
  context.header("X-Napier-Discovery-Status", discovery.status);
  context.header(
    "X-Napier-Diagnostic-Count",
    String(discovery.diagnostics.length),
  );
  context.header(
    "X-Napier-Diagnostics-SHA256",
    sha256Json(discovery.diagnostics),
  );
  context.header(
    "X-Napier-Receipt-Trust-Anchor-Directory-Source-URL-SHA256",
    discovery.sourceUrlSha256,
  );
  context.header(
    "X-Napier-Receipt-Trust-Anchor-Directory-Source-Origin-SHA256",
    discovery.sourceOriginSha256,
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Checkpoint-Discovery-Policy-SHA256",
    discovery.policySha256,
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Checkpoint-Verification-SHA256",
    discovery.checkpointVerification.contentSha256,
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Checkpoint-Verification-Status",
    discovery.checkpointVerification.status,
  );
  setOptionalHeader(
    context,
    "X-Napier-Envelope-SHA256",
    discovery.envelopeSha256,
  );
  setOptionalHeader(
    context,
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Checkpoint-SHA256",
    discovery.checkpointSha256,
  );
  setOptionalHeader(
    context,
    "X-Napier-Signature-Key-Id",
    discovery.signerKeyId,
  );
  if (discovery.selectionCount !== undefined) {
    context.header(
      "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Count",
      String(discovery.selectionCount),
    );
  }
  setOptionalHeader(
    context,
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Set-SHA256",
    discovery.selectionSetSha256,
  );
  setOptionalHeader(
    context,
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Chain-Tail-SHA256",
    discovery.selectionChainTailSha256,
  );
  context.header(
    "X-Napier-Current-Selection-Count",
    String(discovery.currentSelectionCount),
  );
  setOptionalHeader(
    context,
    "X-Napier-Current-Selection-Chain-Tail-SHA256",
    discovery.currentSelectionChainTailSha256,
  );
}

function setReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionListHeaders(
  context: Context,
  subscriptions: ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription[],
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, subscriptions);
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Checkpoint-Subscription-Count",
    String(subscriptions.length),
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Checkpoint-Subscription-Set-SHA256",
    sha256Json(
      subscriptions.map((subscription) => subscription.contentSha256).sort(),
    ),
  );
}

function setReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumHeaders(
  context: Context,
  quorum: ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorum,
): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, quorum.contentSha256);
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Checkpoint-Registry-Quorum-Status",
    quorum.status,
  );
  context.header(
    "X-Napier-Diagnostic-Count",
    String(quorum.diagnostics.length),
  );
  context.header("X-Napier-Diagnostics-SHA256", sha256Json(quorum.diagnostics));
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Checkpoint-Registry-Quorum-Policy-SHA256",
    quorum.policySha256,
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Checkpoint-Registry-Source-Count",
    String(quorum.sourceCount),
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Checkpoint-Registry-Eligible-Source-Count",
    String(quorum.eligibleSourceCount),
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Checkpoint-Registry-Stale-Source-Count",
    String(quorum.staleSourceCount),
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Checkpoint-Registry-Candidate-Count",
    String(quorum.candidateCount),
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Checkpoint-Registry-Agreement-Count",
    String(quorum.agreementCount),
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Checkpoint-Registry-Agreement-Distinct-Origin-Count",
    String(quorum.agreementDistinctSourceOriginCount),
  );
  setOptionalHeader(
    context,
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Checkpoint-SHA256",
    quorum.selectedCheckpointSha256,
  );
  setOptionalHeader(
    context,
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Set-SHA256",
    quorum.selectedSelectionSetSha256,
  );
  setOptionalHeader(
    context,
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Chain-Tail-SHA256",
    quorum.selectedSelectionChainTailSha256,
  );
}

function setReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselineListHeaders(
  context: Context,
  baselines: readonly ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaseline[],
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, baselines);
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Checkpoint-Registry-Quorum-Baseline-Count",
    String(baselines.length),
  );
  const current = baselines.at(-1);
  if (current) {
    context.header(
      "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Checkpoint-Registry-Quorum-Baseline-Id",
      current.id,
    );
    context.header(
      "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Checkpoint-Registry-Quorum-Baseline-SHA256",
      current.contentSha256,
    );
    context.header(
      "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Checkpoint-Registry-Quorum-SHA256",
      current.envelope.receipt.contentSha256,
    );
    context.header("X-Napier-Envelope-SHA256", current.envelope.contentSha256);
  }
}

function setPromoteReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselineResultHeaders(
  context: Context,
  result: PromoteReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselineResult,
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, result);
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Checkpoint-Registry-Quorum-Baseline-Created",
    String(result.created),
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Checkpoint-Registry-Quorum-Baseline-Id",
    result.baseline.id,
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Checkpoint-Registry-Quorum-Baseline-SHA256",
    result.baseline.contentSha256,
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Checkpoint-Registry-Quorum-SHA256",
    result.baseline.envelope.receipt.contentSha256,
  );
  context.header(
    "X-Napier-Receipt-Artifact-SHA256",
    result.baseline.envelope.signature.receiptArtifactSha256,
  );
  context.header(
    "X-Napier-Envelope-SHA256",
    result.baseline.envelope.contentSha256,
  );
  context.header(
    "X-Napier-Signature-Key-Id",
    result.baseline.envelope.signature.keyId,
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Checkpoint-SHA256",
    result.baseline.selectedCheckpointSha256,
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Set-SHA256",
    result.baseline.selectedSelectionSetSha256,
  );
  setOptionalHeader(
    context,
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Chain-Tail-SHA256",
    result.baseline.selectedSelectionChainTailSha256,
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Checkpoint-Registry-Subscription-Set-SHA256",
    result.baseline.selectedSubscriptionSetSha256,
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Checkpoint-Registry-Source-Origin-Set-SHA256",
    result.baseline.selectedSourceOriginSetSha256,
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Checkpoint-Registry-Signer-Set-SHA256",
    result.baseline.selectedSignerSetSha256,
  );
}

function setReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselineVerificationHeaders(
  context: Context,
  verification: ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselineVerification,
): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, verification.contentSha256);
  context.header("X-Napier-Verification-Status", verification.status);
  context.header(
    "X-Napier-Diagnostic-Count",
    String(verification.diagnostics.length),
  );
  context.header(
    "X-Napier-Diagnostics-SHA256",
    sha256Json(verification.diagnostics),
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Checkpoint-Registry-Quorum-Baseline-Valid",
    String(verification.baselineValid),
  );
  context.header(
    "X-Napier-Signature-Valid",
    String(verification.signatureValid),
  );
  context.header(
    "X-Napier-Integrity-Valid",
    String(verification.integrityValid),
  );
  setOptionalHeader(
    context,
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Checkpoint-Registry-Quorum-Baseline-SHA256",
    verification.baselineSha256,
  );
  setOptionalHeader(
    context,
    "X-Napier-Envelope-SHA256",
    verification.envelopeSha256,
  );
  setOptionalHeader(
    context,
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Checkpoint-Registry-Quorum-SHA256",
    verification.quorumSha256,
  );
  setOptionalHeader(
    context,
    "X-Napier-Receipt-Artifact-SHA256",
    verification.receiptArtifactSha256,
  );
  setOptionalHeader(context, "X-Napier-Signature-Key-Id", verification.keyId);
  setOptionalHeader(
    context,
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Checkpoint-SHA256",
    verification.selectedCheckpointSha256,
  );
  setOptionalHeader(
    context,
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Set-SHA256",
    verification.selectedSelectionSetSha256,
  );
  setOptionalHeader(
    context,
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Chain-Tail-SHA256",
    verification.selectedSelectionChainTailSha256,
  );
  setOptionalHeader(
    context,
    "X-Napier-Receipt-Trust-Anchor-Directory-SHA256",
    verification.anchorDirectorySha256,
  );
  setOptionalHeader(
    context,
    "X-Napier-Receipt-Trust-Anchor-Directory-Verification-SHA256",
    verification.anchorDirectoryVerificationSha256,
  );
  setOptionalHeader(
    context,
    "X-Napier-Receipt-Trust-Anchor-Directory-Policy-SHA256",
    verification.anchorDirectoryPolicySha256,
  );
}

function setImportReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselineResultHeaders(
  context: Context,
  result: ImportReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselineResult,
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, result);
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Checkpoint-Registry-Quorum-Baseline-Imported",
    String(result.imported),
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Checkpoint-Registry-Quorum-Baseline-Expected-Current-SHA256",
    result.expectedCurrentBaselineSha256,
  );
  setOptionalHeader(
    context,
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Checkpoint-Registry-Quorum-Baseline-Previous-SHA256",
    result.previousBaselineSha256,
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Checkpoint-Registry-Quorum-Baseline-Id",
    result.baseline.id,
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Checkpoint-Registry-Quorum-Baseline-SHA256",
    result.baseline.contentSha256,
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Checkpoint-Registry-Quorum-Baseline-Verification-SHA256",
    result.verification.contentSha256,
  );
  context.header(
    "X-Napier-Envelope-SHA256",
    result.baseline.envelope.contentSha256,
  );
  context.header(
    "X-Napier-Signature-Key-Id",
    result.baseline.envelope.signature.keyId,
  );
}

function setReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionHeaders(
  context: Context,
  subscription: ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription,
): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, subscription.contentSha256);
  setReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionEvidenceHeaders(
    context,
    subscription,
  );
}

function setReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionRefreshHeaders(
  context: Context,
  result: ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionRefreshResult,
): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, result.contentSha256);
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Checkpoint-Subscription-Refresh-SHA256",
    result.contentSha256,
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Checkpoint-Subscription-Refresh-Status",
    result.status,
  );
  if (result.discovery) {
    context.header(
      "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Checkpoint-Discovery-SHA256",
      result.discovery.contentSha256,
    );
  }
  if (result.failureSha256) {
    context.header(
      "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Checkpoint-Subscription-Failure-SHA256",
      result.failureSha256,
    );
  }
  setReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionEvidenceHeaders(
    context,
    result.subscription,
  );
}

function setReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionEvidenceHeaders(
  context: Context,
  subscription: ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription,
): void {
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Checkpoint-Subscription-Id",
    subscription.id,
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Checkpoint-Subscription-SHA256",
    subscription.contentSha256,
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Checkpoint-Subscription-Revision",
    String(subscription.revision),
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Checkpoint-Subscription-Status",
    subscription.status,
  );
  context.header(
    "X-Napier-Receipt-Trust-Anchor-Directory-Source-URL-SHA256",
    subscription.sourceUrlSha256,
  );
  context.header(
    "X-Napier-Receipt-Trust-Anchor-Directory-Source-Origin-SHA256",
    subscription.sourceOriginSha256,
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Checkpoint-Subscription-Policy-SHA256",
    subscription.policySha256,
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Checkpoint-Subscription-Next-Refresh-At",
    subscription.nextRefreshAt,
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Checkpoint-Subscription-Transparency-Entry-Count",
    String(subscription.transparencyEntryCount),
  );
  setOptionalHeader(
    context,
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Checkpoint-Subscription-Transparency-Tail-SHA256",
    subscription.transparencyTailSha256,
  );
  if (subscription.lastRefreshStatus) {
    context.header(
      "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Checkpoint-Subscription-Last-Refresh-Status",
      subscription.lastRefreshStatus,
    );
  }
  setOptionalHeader(
    context,
    "X-Napier-Envelope-SHA256",
    subscription.lastGoodDiscovery?.envelopeSha256,
  );
  setOptionalHeader(
    context,
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Checkpoint-SHA256",
    subscription.lastGoodDiscovery?.checkpointSha256,
  );
  if (subscription.lastGoodDiscovery?.selectionCount !== undefined) {
    context.header(
      "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Count",
      String(subscription.lastGoodDiscovery.selectionCount),
    );
  }
  setOptionalHeader(
    context,
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Set-SHA256",
    subscription.lastGoodDiscovery?.selectionSetSha256,
  );
  setOptionalHeader(
    context,
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Chain-Tail-SHA256",
    subscription.lastGoodDiscovery?.selectionChainTailSha256,
  );
}

function setReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationReviewHeaders(
  context: Context,
  review: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationReview,
): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, review.contentSha256);
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Review-Status",
    review.status,
  );
  context.header(
    "X-Napier-Diagnostic-Count",
    String(review.diagnostics.length),
  );
  context.header("X-Napier-Diagnostics-SHA256", sha256Json(review.diagnostics));
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Expected-Current-SHA256",
    review.expectedCurrentSelectionSha256,
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Current-SHA256",
    review.currentSelectionSha256,
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Decision-Record-Id",
    review.activationDecisionRecordId,
  );
  setOptionalHeader(
    context,
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Decision-Record-SHA256",
    review.activationDecisionRecordSha256,
  );
  setOptionalHeader(
    context,
    "X-Napier-Receipt-Trust-Directory-Quorum-Promotion-Baseline-SHA256",
    review.baselineSha256,
  );
  setOptionalHeader(
    context,
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Source-Alignment-SHA256",
    review.sourceAlignmentSha256,
  );
  setOptionalHeader(
    context,
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Current-Source-Alignment-SHA256",
    review.currentSourceAlignmentSha256,
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Drift-Audit-SHA256",
    review.driftAudit.contentSha256,
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Drift-Status",
    review.driftAudit.status,
  );
  setOptionalHeader(
    context,
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Checkpoint-Registry-Quorum-Status",
    review.checkpointRegistryQuorum?.status,
  );
  setOptionalHeader(
    context,
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Checkpoint-Registry-Quorum-SHA256",
    review.checkpointRegistryQuorum?.contentSha256,
  );
}

function setReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalHeaders(
  context: Context,
  proposal: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposal,
): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, proposal.contentSha256);
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Status",
    proposal.status,
  );
  context.header(
    "X-Napier-Diagnostic-Count",
    String(proposal.diagnostics.length),
  );
  context.header(
    "X-Napier-Diagnostics-SHA256",
    sha256Json(proposal.diagnostics),
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Review-SHA256",
    proposal.rotationReviewSha256,
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Expected-Current-SHA256",
    proposal.expectedCurrentSelectionSha256,
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Current-SHA256",
    proposal.currentSelectionSha256,
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Decision-Record-Id",
    proposal.activationDecisionRecordId,
  );
  setOptionalHeader(
    context,
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Decision-Record-SHA256",
    proposal.activationDecisionRecordSha256,
  );
  setOptionalHeader(
    context,
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Checkpoint-Registry-Quorum-Baseline-Id",
    proposal.checkpointRegistryQuorumBaselineId,
  );
  setOptionalHeader(
    context,
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Checkpoint-Registry-Quorum-Baseline-SHA256",
    proposal.checkpointRegistryQuorumBaselineSha256,
  );
  setOptionalHeader(
    context,
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Checkpoint-Registry-Quorum-Baseline-Expected-SHA256",
    proposal.expectedCheckpointRegistryQuorumBaselineSha256,
  );
  setOptionalHeader(
    context,
    "X-Napier-Envelope-SHA256",
    proposal.checkpointRegistryQuorumBaselineEnvelopeSha256,
  );
  setOptionalHeader(
    context,
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Checkpoint-Registry-Quorum-SHA256",
    proposal.checkpointRegistryQuorumSha256,
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Checkpoint-SHA256",
    proposal.currentCheckpointSha256,
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Set-SHA256",
    proposal.currentSelectionSetSha256,
  );
  setOptionalHeader(
    context,
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Chain-Tail-SHA256",
    proposal.currentSelectionChainTailSha256,
  );
}

function setReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalPreflightHeaders(
  context: Context,
  preflight: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalPreflight,
): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, preflight.contentSha256);
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Preflight-Status",
    preflight.status,
  );
  context.header(
    "X-Napier-Diagnostic-Count",
    String(preflight.diagnostics.length),
  );
  context.header(
    "X-Napier-Diagnostics-SHA256",
    sha256Json(preflight.diagnostics),
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Expected-Current-SHA256",
    preflight.expectedCurrentSelectionSha256,
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Current-SHA256",
    preflight.currentSelectionSha256,
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Decision-Record-Id",
    preflight.activationDecisionRecordId,
  );
  setOptionalHeader(
    context,
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Active-SHA256",
    preflight.activeSelectionSha256,
  );
  setOptionalHeader(
    context,
    "X-Napier-Envelope-SHA256",
    preflight.rotationProposalEnvelopeSha256,
  );
  setOptionalHeader(
    context,
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-SHA256",
    preflight.rotationProposalSha256,
  );
  setOptionalHeader(
    context,
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Review-SHA256",
    preflight.rotationProposalReviewSha256,
  );
  setOptionalHeader(
    context,
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Checkpoint-Registry-Quorum-Baseline-SHA256",
    preflight.rotationProposalCheckpointRegistryQuorumBaselineSha256,
  );
  setOptionalHeader(
    context,
    "X-Napier-Receipt-Trust-Verification-Status",
    preflight.trustedReceiptVerificationStatus,
  );
  setOptionalHeader(
    context,
    "X-Napier-Receipt-Trust-Key-Id",
    preflight.trustedReceiptVerificationKeyId,
  );
}

function setReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalDiscoveryHeaders(
  context: Context,
  discovery: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalDiscovery,
): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, discovery.contentSha256);
  context.header("X-Napier-Discovery-Status", discovery.status);
  context.header(
    "X-Napier-Diagnostic-Count",
    String(discovery.diagnostics.length),
  );
  context.header(
    "X-Napier-Diagnostics-SHA256",
    sha256Json(discovery.diagnostics),
  );
  context.header(
    "X-Napier-Receipt-Trust-Anchor-Directory-Source-URL-SHA256",
    discovery.sourceUrlSha256,
  );
  context.header(
    "X-Napier-Receipt-Trust-Anchor-Directory-Source-Origin-SHA256",
    discovery.sourceOriginSha256,
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Discovery-Policy-SHA256",
    discovery.policySha256,
  );
  context.header(
    "X-Napier-Receipt-Trust-Anchor-Directory-Source-Response-SHA256",
    discovery.responseBodySha256,
  );
  context.header(
    "X-Napier-Receipt-Trust-Anchor-Directory-Source-Response-Bytes",
    String(discovery.responseBytes),
  );
  setOptionalHeader(
    context,
    "X-Napier-Envelope-SHA256",
    discovery.envelopeSha256,
  );
  setOptionalHeader(
    context,
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-SHA256",
    discovery.proposalSha256,
  );
  setOptionalHeader(
    context,
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Review-SHA256",
    discovery.proposalReviewSha256,
  );
  setOptionalHeader(
    context,
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Checkpoint-Registry-Quorum-Baseline-SHA256",
    discovery.checkpointRegistryQuorumBaselineSha256,
  );
  setOptionalHeader(
    context,
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Decision-Record-Id",
    discovery.activationDecisionRecordId,
  );
  setOptionalHeader(
    context,
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Expected-Current-SHA256",
    discovery.expectedCurrentSelectionSha256,
  );
  setOptionalHeader(
    context,
    "X-Napier-Signature-Key-Id",
    discovery.signerKeyId,
  );
  setOptionalHeader(
    context,
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Preflight-Status",
    discovery.preflight?.status,
  );
  setOptionalHeader(
    context,
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Preflight-SHA256",
    discovery.preflight?.contentSha256,
  );
}

function setReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionListHeaders(
  context: Context,
  subscriptions: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription[],
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, subscriptions);
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Subscription-Count",
    String(subscriptions.length),
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Subscription-Set-SHA256",
    sha256Json(
      subscriptions.map((subscription) => subscription.contentSha256).sort(),
    ),
  );
}

function setReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionHeaders(
  context: Context,
  subscription: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription,
): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, subscription.contentSha256);
  setReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionEvidenceHeaders(
    context,
    subscription,
  );
}

function setReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionRefreshHeaders(
  context: Context,
  result: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionRefreshResult,
): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, result.contentSha256);
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Subscription-Refresh-SHA256",
    result.contentSha256,
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Subscription-Refresh-Status",
    result.status,
  );
  if (result.discovery) {
    context.header(
      "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Discovery-SHA256",
      result.discovery.contentSha256,
    );
  }
  if (result.failureSha256) {
    context.header(
      "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Subscription-Failure-SHA256",
      result.failureSha256,
    );
  }
  setReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionEvidenceHeaders(
    context,
    result.subscription,
  );
}

function setReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionEvidenceHeaders(
  context: Context,
  subscription: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription,
): void {
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Subscription-Id",
    subscription.id,
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Subscription-SHA256",
    subscription.contentSha256,
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Subscription-Revision",
    String(subscription.revision),
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Subscription-Status",
    subscription.status,
  );
  context.header(
    "X-Napier-Receipt-Trust-Anchor-Directory-Source-URL-SHA256",
    subscription.sourceUrlSha256,
  );
  context.header(
    "X-Napier-Receipt-Trust-Anchor-Directory-Source-Origin-SHA256",
    subscription.sourceOriginSha256,
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Subscription-Policy-SHA256",
    subscription.policySha256,
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Subscription-Next-Refresh-At",
    subscription.nextRefreshAt,
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Subscription-Transparency-Entry-Count",
    String(subscription.transparencyEntryCount),
  );
  setOptionalHeader(
    context,
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Subscription-Transparency-Tail-SHA256",
    subscription.transparencyTailSha256,
  );
  if (subscription.lastRefreshStatus) {
    context.header(
      "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Subscription-Last-Refresh-Status",
      subscription.lastRefreshStatus,
    );
  }
  setOptionalHeader(
    context,
    "X-Napier-Envelope-SHA256",
    subscription.lastGoodDiscovery?.envelopeSha256,
  );
  setOptionalHeader(
    context,
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-SHA256",
    subscription.lastGoodDiscovery?.proposalSha256,
  );
  setOptionalHeader(
    context,
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Preflight-SHA256",
    subscription.lastGoodDiscovery?.preflight?.contentSha256,
  );
}

function setApplyReceiptTrustAnchorDirectoryQuorumActivationSelectionResultHeaders(
  context: Context,
  result: ApplyReceiptTrustAnchorDirectoryQuorumActivationSelectionResult,
): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, result.contentSha256);
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Applied",
    String(result.applied),
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Expected-Current-SHA256",
    result.expectedCurrentSelectionSha256,
  );
  setOptionalHeader(
    context,
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Previous-SHA256",
    result.previousSelectionSha256,
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Current-SHA256",
    result.selection.contentSha256,
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-State-SHA256",
    result.selectionState.contentSha256,
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Id",
    result.selection.id,
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Decision-Record-Id",
    result.selection.activationDecisionRecordId,
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Promotion-Baseline-Id",
    result.selection.baselineId,
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Promotion-Baseline-SHA256",
    result.selection.baselineSha256,
  );
}

function setApplyReceiptTrustAnchorDirectoryQuorumActivationSelectionApprovalResultHeaders(
  context: Context,
  result: ApplyReceiptTrustAnchorDirectoryQuorumActivationSelectionResult,
  approvalGate: Extract<
    RotationProposalSubscriptionApprovalApplyGateResult,
    { status: "accepted" }
  >,
): void {
  setApplyReceiptTrustAnchorDirectoryQuorumActivationSelectionResultHeaders(
    context,
    result,
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Approval-Envelope-SHA256",
    approvalGate.approvalEnvelope.contentSha256,
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Approval-SHA256",
    approvalGate.approval.contentSha256,
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Approval-Preflight-SHA256",
    approvalGate.approval.approvalPreflightSha256,
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Approval-Current-Preflight-SHA256",
    approvalGate.preflight.contentSha256,
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Subscription-Id",
    approvalGate.approval.subscriptionId,
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Subscription-SHA256",
    approvalGate.approval.subscriptionSha256,
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Subscription-Revision",
    String(approvalGate.approval.subscriptionRevision),
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-SHA256",
    approvalGate.proposal.contentSha256,
  );
  context.header(
    "X-Napier-Envelope-SHA256",
    approvalGate.proposalEnvelope.contentSha256,
  );
  context.header(
    "X-Napier-Signature-Key-Id",
    approvalGate.approvalEnvelope.signature.keyId,
  );
}

function setReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyReviewHeaders(
  context: Context,
  review: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyReview,
): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, review.contentSha256);
  context.header("X-Napier-Verification-Status", review.status);
  context.header(
    "X-Napier-Diagnostic-Count",
    String(review.diagnostics.length),
  );
  context.header("X-Napier-Diagnostics-SHA256", sha256Json(review.diagnostics));
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Subscription-Id",
    review.subscriptionId,
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Subscription-Revision",
    String(review.subscriptionRevision),
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Subscription-SHA256",
    review.subscriptionSha256,
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Approval-Policy-SHA256",
    review.approvalPolicySha256,
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Approval-Minimum-Distinct-Signer-Count",
    String(review.approvalPolicy.minimumDistinctSignerCount),
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Approval-Envelope-Count",
    String(review.approvalEnvelopeCount),
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Approval-Accepted-Count",
    String(review.acceptedApprovalCount),
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Approval-Distinct-Signer-Count",
    String(review.distinctSignerCount),
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Approval-Signer-Set-SHA256",
    review.signerSetSha256,
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Approval-Envelope-Set-SHA256",
    review.approvalEnvelopeSetSha256,
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Approval-Accepted-Envelope-Set-SHA256",
    review.acceptedApprovalEnvelopeSetSha256,
  );
  setOptionalHeader(
    context,
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Approval-Required-Signer-Set-SHA256",
    review.requiredSignerSetSha256,
  );
  setOptionalHeader(
    context,
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Decision-Record-Id",
    review.activationDecisionRecordId,
  );
  setOptionalHeader(
    context,
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Expected-Current-SHA256",
    review.expectedCurrentSelectionSha256,
  );
  setOptionalHeader(
    context,
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-SHA256",
    review.proposalSha256,
  );
  setOptionalHeader(
    context,
    "X-Napier-Envelope-SHA256",
    review.proposalEnvelopeSha256,
  );
  setOptionalHeader(
    context,
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Approval-Current-Preflight-SHA256",
    review.currentPreflightSha256,
  );
}

function setReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyApplyResultHeaders(
  context: Context,
  applyResult: ApplyReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyResult,
): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, applyResult.contentSha256);
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Applied",
    String(applyResult.result.applied),
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Approval-Policy-Review-SHA256",
    applyResult.policyReviewSha256,
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Approval-Policy-Apply-Result-SHA256",
    applyResult.resultSha256,
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Current-SHA256",
    applyResult.result.selection.contentSha256,
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-State-SHA256",
    applyResult.result.selectionState.contentSha256,
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Decision-Record-Id",
    applyResult.result.selection.activationDecisionRecordId,
  );
  context.header(
    "X-Napier-Verification-Status",
    applyResult.policyReview.status,
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Approval-Distinct-Signer-Count",
    String(applyResult.policyReview.distinctSignerCount),
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Approval-Signer-Set-SHA256",
    applyResult.policyReview.signerSetSha256,
  );
}

function setQueueReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyApplyResultHeaders(
  context: Context,
  queueResult: QueueReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyApplyResult,
): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, queueResult.contentSha256);
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Approval-Policy-Apply-Queued-At",
    queueResult.queuedAt,
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Approval-Policy-Apply-After",
    queueResult.applyAfter,
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Approval-Policy-Baseline-SHA256",
    queueResult.approvalPolicyBaselineSha256,
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Approval-Policy-Review-SHA256",
    queueResult.policyReviewSha256,
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Approval-Policy-SHA256",
    queueResult.approvalPolicySha256,
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Subscription-SHA256",
    queueResult.subscriptionSha256,
  );
  context.header(
    "X-Napier-Verification-Status",
    queueResult.policyReview.status,
  );
}

function setReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaselineListHeaders(
  context: Context,
  baselines: readonly ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaseline[],
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, baselines);
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Approval-Policy-Baseline-Count",
    String(baselines.length),
  );
  const current = baselines.at(-1);
  if (current) {
    context.header(
      "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Approval-Policy-Baseline-Id",
      current.id,
    );
    context.header(
      "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Approval-Policy-Baseline-SHA256",
      current.contentSha256,
    );
    context.header(
      "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Approval-Policy-Review-SHA256",
      current.envelope.receipt.contentSha256,
    );
    context.header("X-Napier-Envelope-SHA256", current.envelope.contentSha256);
  }
}

function setPromoteReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaselineResultHeaders(
  context: Context,
  result: PromoteReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaselineResult,
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, result);
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Approval-Policy-Baseline-Created",
    String(result.created),
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Approval-Policy-Baseline-Id",
    result.baseline.id,
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Approval-Policy-Baseline-SHA256",
    result.baseline.contentSha256,
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Approval-Policy-SHA256",
    result.baseline.approvalPolicySha256,
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Approval-Signer-Set-SHA256",
    result.baseline.signerSetSha256,
  );
  context.header(
    "X-Napier-Envelope-SHA256",
    result.baseline.envelope.contentSha256,
  );
  context.header(
    "X-Napier-Signature-Key-Id",
    result.baseline.envelope.signature.keyId,
  );
}

function setReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaselineVerificationHeaders(
  context: Context,
  verification: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaselineVerification,
): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, verification.contentSha256);
  context.header("X-Napier-Verification-Status", verification.status);
  context.header(
    "X-Napier-Diagnostic-Count",
    String(verification.diagnostics.length),
  );
  context.header(
    "X-Napier-Diagnostics-SHA256",
    sha256Json(verification.diagnostics),
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Approval-Policy-Baseline-Valid",
    String(verification.baselineValid),
  );
  context.header(
    "X-Napier-Signature-Valid",
    String(verification.signatureValid),
  );
  context.header(
    "X-Napier-Integrity-Valid",
    String(verification.integrityValid),
  );
  setOptionalHeader(
    context,
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Approval-Policy-Baseline-SHA256",
    verification.baselineSha256,
  );
  setOptionalHeader(
    context,
    "X-Napier-Envelope-SHA256",
    verification.envelopeSha256,
  );
  setOptionalHeader(
    context,
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Approval-Policy-Review-SHA256",
    verification.policyReviewSha256,
  );
  setOptionalHeader(context, "X-Napier-Signature-Key-Id", verification.keyId);
  setOptionalHeader(
    context,
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Approval-Policy-SHA256",
    verification.approvalPolicySha256,
  );
  setOptionalHeader(
    context,
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Approval-Signer-Set-SHA256",
    verification.signerSetSha256,
  );
}

function setImportReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaselineResultHeaders(
  context: Context,
  result: ImportReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaselineResult,
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, result);
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Approval-Policy-Baseline-Imported",
    String(result.imported),
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Approval-Policy-Baseline-Expected-Current-SHA256",
    result.expectedCurrentBaselineSha256,
  );
  setOptionalHeader(
    context,
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Approval-Policy-Baseline-Previous-SHA256",
    result.previousBaselineSha256,
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Approval-Policy-Baseline-Id",
    result.baseline.id,
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Approval-Policy-Baseline-SHA256",
    result.baseline.contentSha256,
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Approval-Policy-Baseline-Verification-SHA256",
    result.verification.contentSha256,
  );
  context.header(
    "X-Napier-Envelope-SHA256",
    result.baseline.envelope.contentSha256,
  );
  context.header(
    "X-Napier-Signature-Key-Id",
    result.baseline.envelope.signature.keyId,
  );
}

function setReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalApplyReplayHeaders(
  context: Context,
  replay: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalApplyReplay,
): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, replay.contentSha256);
  context.header("X-Napier-Verification-Status", replay.status);
  context.header(
    "X-Napier-Diagnostic-Count",
    String(replay.diagnostics.length),
  );
  context.header("X-Napier-Diagnostics-SHA256", sha256Json(replay.diagnostics));
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Subscription-Id",
    replay.subscriptionId,
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Subscription-Revision",
    String(replay.subscriptionRevision),
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Subscription-SHA256",
    replay.subscriptionSha256,
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Current-SHA256",
    replay.currentSelectionSha256,
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-State-SHA256",
    replay.selectionStateSha256,
  );
  setOptionalHeader(
    context,
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Active-SHA256",
    replay.activeSelectionSha256,
  );
  setOptionalHeader(
    context,
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Decision-Record-Id",
    replay.activeActivationDecisionRecordId,
  );
  setOptionalHeader(
    context,
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Approval-Verifier-Selection-SHA256",
    replay.approvalVerifierSelectionSha256,
  );
  setOptionalHeader(
    context,
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Approval-Verifier-Directory-SHA256",
    replay.approvalVerifierDirectorySha256,
  );
  setOptionalHeader(
    context,
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Approval-Envelope-SHA256",
    replay.approvalEnvelopeSha256,
  );
  setOptionalHeader(
    context,
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Approval-SHA256",
    replay.approvalSha256,
  );
  setOptionalHeader(
    context,
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Approval-Verification-Status",
    replay.approvalTrustedReceiptVerificationStatus,
  );
  setOptionalHeader(
    context,
    "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-SHA256",
    replay.proposalSha256,
  );
  setOptionalHeader(
    context,
    "X-Napier-Envelope-SHA256",
    replay.proposalEnvelopeSha256,
  );
}

function setReceiptTrustAnchorDirectoryQuorumPromotionBaselineVerificationHeaders(
  context: Context,
  verification: ReceiptTrustAnchorDirectoryQuorumPromotionBaselineVerification,
): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, verification.contentSha256);
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Promotion-Baseline-Verification-Status",
    verification.status,
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Quorum-Promotion-Baseline-Valid",
    String(verification.baselineValid),
  );
  context.header(
    "X-Napier-Receipt-Signature-Valid",
    String(verification.signatureValid),
  );
  context.header(
    "X-Napier-Receipt-Integrity-Valid",
    String(verification.integrityValid),
  );
  context.header(
    "X-Napier-Diagnostic-Count",
    String(verification.diagnostics.length),
  );
  context.header(
    "X-Napier-Diagnostics-SHA256",
    sha256Json(verification.diagnostics),
  );
  if (verification.baselineSha256) {
    context.header(
      "X-Napier-Receipt-Trust-Directory-Quorum-Promotion-Baseline-SHA256",
      verification.baselineSha256,
    );
  }
  if (verification.receiptSha256) {
    context.header(
      "X-Napier-Receipt-Trust-Directory-Quorum-Promotion-SHA256",
      verification.receiptSha256,
    );
  }
  if (verification.envelopeSha256) {
    context.header("X-Napier-Envelope-SHA256", verification.envelopeSha256);
  }
  if (verification.keyId) {
    context.header("X-Napier-Signature-Key-Id", verification.keyId);
  }
  if (verification.anchorDirectoryVerificationSha256) {
    context.header(
      "X-Napier-Receipt-Trust-Anchor-Directory-Verification-SHA256",
      verification.anchorDirectoryVerificationSha256,
    );
  }
}

function setReceiptTrustAnchorDirectorySubscriptionListHeaders(
  context: Context,
  subscriptions: ReceiptTrustAnchorDirectorySubscription[],
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, subscriptions);
  context.header(
    "X-Napier-Receipt-Trust-Directory-Subscription-Count",
    String(subscriptions.length),
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Subscription-Active-Count",
    String(
      subscriptions.filter((subscription) => subscription.status === "active")
        .length,
    ),
  );
}

function setReceiptTrustAnchorDirectorySubscriptionHeaders(
  context: Context,
  subscription: ReceiptTrustAnchorDirectorySubscription,
): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, subscription.contentSha256);
  setReceiptTrustAnchorDirectorySubscriptionEvidenceHeaders(
    context,
    subscription,
  );
}

function setReceiptTrustAnchorDirectorySubscriptionRefreshHeaders(
  context: Context,
  result: ReceiptTrustAnchorDirectorySubscriptionRefreshResult,
): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, result.contentSha256);
  context.header(
    "X-Napier-Receipt-Trust-Directory-Subscription-Refresh-SHA256",
    result.contentSha256,
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Subscription-Refresh-Status",
    result.status,
  );
  if (result.discovery) {
    context.header(
      "X-Napier-Receipt-Trust-Anchor-Directory-Discovery-SHA256",
      result.discovery.contentSha256,
    );
  }
  if (result.failureSha256) {
    context.header(
      "X-Napier-Receipt-Trust-Directory-Subscription-Failure-SHA256",
      result.failureSha256,
    );
  }
  setReceiptTrustAnchorDirectorySubscriptionEvidenceHeaders(
    context,
    result.subscription,
  );
}

function setReceiptTrustAnchorDirectorySubscriptionEvidenceHeaders(
  context: Context,
  subscription: ReceiptTrustAnchorDirectorySubscription,
): void {
  context.header(
    "X-Napier-Receipt-Trust-Directory-Subscription-Id",
    subscription.id,
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Subscription-SHA256",
    subscription.contentSha256,
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Subscription-Revision",
    String(subscription.revision),
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Subscription-Status",
    subscription.status,
  );
  context.header(
    "X-Napier-Receipt-Trust-Anchor-Directory-Source-URL-SHA256",
    subscription.sourceUrlSha256,
  );
  context.header(
    "X-Napier-Receipt-Trust-Anchor-Directory-Source-Origin-SHA256",
    subscription.sourceOriginSha256,
  );
  context.header(
    "X-Napier-Receipt-Trust-Anchor-Directory-Policy-SHA256",
    subscription.policySha256,
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Subscription-Next-Refresh-At",
    subscription.nextRefreshAt,
  );
  context.header(
    "X-Napier-Receipt-Trust-Directory-Subscription-Transparency-Entry-Count",
    String(subscription.transparencyEntryCount),
  );
  if (subscription.transparencyTailSha256) {
    context.header(
      "X-Napier-Receipt-Trust-Directory-Subscription-Transparency-Tail-SHA256",
      subscription.transparencyTailSha256,
    );
  }
  if (subscription.lastRefreshStatus) {
    context.header(
      "X-Napier-Receipt-Trust-Directory-Subscription-Last-Refresh-Status",
      subscription.lastRefreshStatus,
    );
  }
  if (subscription.lastGoodDiscovery?.directory) {
    context.header(
      "X-Napier-Receipt-Trust-Anchor-Directory-SHA256",
      subscription.lastGoodDiscovery.directory.contentSha256,
    );
    context.header(
      "X-Napier-Receipt-Trust-Anchor-Directory-Anchor-Set-SHA256",
      subscription.lastGoodDiscovery.directory.anchorSetSha256,
    );
  }
}

function setReceiptTrustAnchorDirectoryDiscoveryHeaders(
  context: Context,
  discovery: ReceiptTrustAnchorDirectoryDiscovery,
): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, discovery.contentSha256);
  context.header(
    "X-Napier-Receipt-Trust-Anchor-Directory-Discovery-SHA256",
    discovery.contentSha256,
  );
  context.header(
    "X-Napier-Receipt-Trust-Anchor-Directory-Source-URL-SHA256",
    discovery.sourceUrlSha256,
  );
  context.header(
    "X-Napier-Receipt-Trust-Anchor-Directory-Source-Origin-SHA256",
    discovery.sourceOriginSha256,
  );
  context.header(
    "X-Napier-Receipt-Trust-Anchor-Directory-Response-SHA256",
    discovery.responseBodySha256,
  );
  context.header(
    "X-Napier-Receipt-Trust-Anchor-Directory-Response-Bytes",
    String(discovery.responseBytes),
  );
  context.header(
    "X-Napier-Receipt-Trust-Anchor-Directory-HTTP-Status",
    String(discovery.httpStatus),
  );
  context.header("X-Napier-Verification-Status", discovery.status);
  context.header(
    "X-Napier-Diagnostic-Count",
    String(discovery.verification.diagnostics.length),
  );
  context.header(
    "X-Napier-Diagnostics-SHA256",
    sha256Json(discovery.verification.diagnostics),
  );
  context.header(
    "X-Napier-Receipt-Trust-Anchor-Directory-Verification-SHA256",
    discovery.verification.contentSha256,
  );
  if (discovery.verification.policySha256) {
    context.header(
      "X-Napier-Receipt-Trust-Anchor-Directory-Policy-SHA256",
      discovery.verification.policySha256,
    );
  }
  if (discovery.verification.directoryAgeMs !== undefined) {
    context.header(
      "X-Napier-Receipt-Trust-Anchor-Directory-Age-Ms",
      String(discovery.verification.directoryAgeMs),
    );
  }
  if (discovery.directory) {
    context.header(
      "X-Napier-Receipt-Trust-Anchor-Directory-SHA256",
      discovery.directory.contentSha256,
    );
    context.header(
      "X-Napier-Receipt-Trust-Anchor-Directory-Anchor-Set-SHA256",
      discovery.directory.anchorSetSha256,
    );
    context.header(
      "X-Napier-Receipt-Trust-Anchor-Count",
      String(discovery.directory.anchorCount),
    );
  }
}

function setReceiptTrustAnchorDirectoryVerificationHeaders(
  context: Context,
  verification: ReceiptTrustAnchorDirectoryVerification,
): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, verification.contentSha256);
  context.header("X-Napier-Verification-Status", verification.status);
  context.header(
    "X-Napier-Diagnostic-Count",
    String(verification.diagnostics.length),
  );
  context.header(
    "X-Napier-Diagnostics-SHA256",
    sha256Json(verification.diagnostics),
  );
  if (verification.declaredContentSha256) {
    context.header(
      "X-Napier-Receipt-Trust-Anchor-Directory-SHA256",
      verification.declaredContentSha256,
    );
  }
  context.header(
    "X-Napier-Receipt-Trust-Anchor-Directory-Verification-SHA256",
    verification.contentSha256,
  );
  if (verification.policySha256) {
    context.header(
      "X-Napier-Receipt-Trust-Anchor-Directory-Policy-SHA256",
      verification.policySha256,
    );
  }
  if (verification.directoryGeneratedAt) {
    context.header(
      "X-Napier-Receipt-Trust-Anchor-Directory-Generated-At",
      verification.directoryGeneratedAt,
    );
  }
  if (verification.directoryAgeMs !== undefined) {
    context.header(
      "X-Napier-Receipt-Trust-Anchor-Directory-Age-Ms",
      String(verification.directoryAgeMs),
    );
  }
  if (verification.declaredAnchorSetSha256) {
    context.header(
      "X-Napier-Receipt-Trust-Anchor-Directory-Anchor-Set-SHA256",
      verification.declaredAnchorSetSha256,
    );
  }
  if (verification.recomputedAnchorSetSha256) {
    context.header(
      "X-Napier-Recomputed-Receipt-Trust-Anchor-Directory-Anchor-Set-SHA256",
      verification.recomputedAnchorSetSha256,
    );
  }
  if (verification.anchorCount !== undefined) {
    context.header(
      "X-Napier-Receipt-Trust-Anchor-Count",
      String(verification.anchorCount),
    );
  }
  if (verification.trustedCount !== undefined) {
    context.header(
      "X-Napier-Receipt-Trust-Trusted-Count",
      String(verification.trustedCount),
    );
  }
  if (verification.revokedCount !== undefined) {
    context.header(
      "X-Napier-Receipt-Trust-Revoked-Count",
      String(verification.revokedCount),
    );
  }
}

function setReceiptTrustAnchorDirectoryMetadataVerificationHeaders(
  context: Context,
  verification: ReceiptTrustAnchorDirectoryMetadataVerification,
): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, verification.contentSha256);
  context.header("X-Napier-Verification-Status", verification.status);
  context.header(
    "X-Napier-Receipt-Trust-Anchor-Directory-Metadata-Verification-SHA256",
    verification.contentSha256,
  );
  context.header(
    "X-Napier-Diagnostic-Count",
    String(verification.diagnostics.length),
  );
  context.header(
    "X-Napier-Diagnostics-SHA256",
    sha256Json(verification.diagnostics),
  );
  context.header(
    "X-Napier-Signature-Valid",
    String(verification.signatureValid),
  );
  context.header(
    "X-Napier-Integrity-Valid",
    String(verification.integrityValid),
  );
  context.header(
    "X-Napier-Directory-Binding-Valid",
    String(verification.directoryBindingValid),
  );
  if (verification.publisher) {
    context.header(
      "X-Napier-Receipt-Trust-Anchor-Directory-Publisher-SHA256",
      sha256Text(verification.publisher),
    );
  }
  if (verification.signerKeyId) {
    context.header("X-Napier-Signature-Key-Id", verification.signerKeyId);
  }
  if (verification.envelopeSha256) {
    context.header("X-Napier-Envelope-SHA256", verification.envelopeSha256);
  }
  if (verification.directorySha256) {
    context.header(
      "X-Napier-Receipt-Trust-Anchor-Directory-SHA256",
      verification.directorySha256,
    );
  }
  if (verification.anchorSetSha256) {
    context.header(
      "X-Napier-Receipt-Trust-Anchor-Directory-Anchor-Set-SHA256",
      verification.anchorSetSha256,
    );
  }
  if (verification.expiresAt) {
    context.header(
      "X-Napier-Receipt-Trust-Anchor-Directory-Metadata-Expires-At",
      verification.expiresAt,
    );
  }
}

function setReceiptTrustAnchorHeaders(
  context: Context,
  anchor: ReceiptTrustAnchor,
): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, anchor.contentSha256);
  context.header("X-Napier-Receipt-Trust-Anchor-Id", anchor.id);
  context.header("X-Napier-Signature-Key-Id", anchor.keyId);
  context.header("X-Napier-Receipt-Trust-Anchor-Status", anchor.status);
  context.header(
    "X-Napier-Receipt-Trust-Signing-Capable",
    String(Boolean(anchor.signingSource)),
  );
}

function setTrustedReceiptVerificationHeaders(
  context: Context,
  verification: TrustedReceiptVerification,
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, verification);
  context.header("X-Napier-Receipt-Verification-Status", verification.status);
  context.header(
    "X-Napier-Signature-Valid",
    String(verification.signatureValid),
  );
  context.header(
    "X-Napier-Integrity-Valid",
    String(verification.integrityValid),
  );
  if (verification.receiptKind) {
    context.header("X-Napier-Receipt-Kind", verification.receiptKind);
  }
  if (verification.receiptContentSha256) {
    context.header(
      "X-Napier-Receipt-SHA256",
      verification.receiptContentSha256,
    );
  }
  if (verification.receiptArtifactSha256) {
    context.header(
      "X-Napier-Receipt-Artifact-SHA256",
      verification.receiptArtifactSha256,
    );
  }
  if (verification.keyId) {
    context.header("X-Napier-Signature-Key-Id", verification.keyId);
  }
  if (verification.envelopeSha256) {
    context.header("X-Napier-Envelope-SHA256", verification.envelopeSha256);
  }
  if (verification.anchorDirectorySha256) {
    context.header(
      "X-Napier-Receipt-Trust-Anchor-Directory-SHA256",
      verification.anchorDirectorySha256,
    );
  }
  if (verification.anchorDirectorySource) {
    context.header(
      "X-Napier-Receipt-Trust-Anchor-Directory-Source",
      verification.anchorDirectorySource,
    );
  }
  if (verification.anchorDirectorySelectionId) {
    context.header(
      "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Id",
      verification.anchorDirectorySelectionId,
    );
  }
  if (verification.anchorDirectorySelectionSha256) {
    context.header(
      "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-SHA256",
      verification.anchorDirectorySelectionSha256,
    );
  }
  if (verification.anchorDirectorySelectionStateSha256) {
    context.header(
      "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-State-SHA256",
      verification.anchorDirectorySelectionStateSha256,
    );
  }
  if (verification.anchorDirectoryVerificationSha256) {
    context.header(
      "X-Napier-Receipt-Trust-Anchor-Directory-Verification-SHA256",
      verification.anchorDirectoryVerificationSha256,
    );
  }
  if (verification.anchorDirectoryPolicySha256) {
    context.header(
      "X-Napier-Receipt-Trust-Anchor-Directory-Policy-SHA256",
      verification.anchorDirectoryPolicySha256,
    );
  }
  if (verification.anchorDirectoryGeneratedAt) {
    context.header(
      "X-Napier-Receipt-Trust-Anchor-Directory-Generated-At",
      verification.anchorDirectoryGeneratedAt,
    );
  }
  if (verification.anchorDirectoryAgeMs !== undefined) {
    context.header(
      "X-Napier-Receipt-Trust-Anchor-Directory-Age-Ms",
      String(verification.anchorDirectoryAgeMs),
    );
  }
  if (verification.anchorDirectoryAnchorCount !== undefined) {
    context.header(
      "X-Napier-Receipt-Trust-Anchor-Directory-Anchor-Count",
      String(verification.anchorDirectoryAnchorCount),
    );
  }
}

function setUsagePriceTableCatalogHeaders(
  context: Context,
  catalog: UsagePriceTableCatalog,
): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, catalog.contentSha256);
  context.header(
    "X-Napier-Usage-Price-Table-Count",
    String(catalog.tables.length),
  );
  context.header(
    "X-Napier-Usage-Price-Provider-Count",
    String(new Set(catalog.tables.map((table) => table.provider)).size),
  );
  context.header(
    "X-Napier-Usage-Price-Providers-SHA256",
    sha256Json(catalog.tables.map((table) => table.provider).sort()),
  );
}

function setUsagePriceTableVerificationHeaders(
  context: Context,
  verification: UsagePriceTableVerification,
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, verification);
  context.header(
    "X-Napier-Usage-Price-Verification-Status",
    verification.status,
  );
  context.header(
    "X-Napier-Usage-Price-Table-Count",
    String(verification.tableCount),
  );
  context.header(
    "X-Napier-Usage-Price-Provider-Count",
    String(verification.providers.length),
  );
  context.header(
    "X-Napier-Usage-Price-Diagnostic-Count",
    String(verification.diagnostics.length),
  );
  context.header(
    "X-Napier-Usage-Price-Providers-SHA256",
    sha256Json(verification.providers),
  );
  context.header(
    "X-Napier-Usage-Price-Diagnostics-SHA256",
    sha256Json(verification.diagnostics),
  );
  if (verification.catalogSha256) {
    context.header(
      "X-Napier-Usage-Price-Catalog-SHA256",
      verification.catalogSha256,
    );
  }
}

function setOpenTelemetryTraceArtifactHeaders(
  context: Context,
  artifact: OpenTelemetryTraceArtifact,
): void {
  context.header("Cache-Control", "no-store");
  context.header(
    "Content-Disposition",
    `attachment; filename="${openTelemetryTraceArtifactFilename(artifact)}"`,
  );
  setStableContentSha256Header(context, artifact.contentSha256);
  context.header("X-Napier-Trace-Id", artifact.traceId);
  context.header("X-Napier-Thread-Id", artifact.threadId);
  if (artifact.runId) {
    context.header("X-Napier-Run-Id", artifact.runId);
  }
  context.header("X-Napier-Span-Count", String(artifact.spanCount));
  context.header(
    "X-Napier-Event-Count",
    String(artifact.eventRange.eventCount),
  );
  context.header(
    "X-Napier-First-Event-Seq",
    String(artifact.eventRange.fromSeq),
  );
  context.header("X-Napier-Last-Event-Seq", String(artifact.eventRange.toSeq));
  context.header(
    "X-Napier-Event-Stream-SHA256",
    artifact.eventRange.eventStreamSha256,
  );
  context.header(
    "X-Napier-Event-Anchor-Set-SHA256",
    openTelemetryTraceArtifactEventAnchorSetSha256(artifact),
  );
  context.header("X-Napier-Trace-Redaction-Mode", artifact.redaction.mode);
  context.header(
    "X-Napier-Trace-Content-Capture",
    String(artifact.redaction.contentCapture),
  );
  context.header(
    "X-Napier-Trace-Excluded-Event-Type-Count",
    String(artifact.redaction.excludedEventTypes.length),
  );
  context.header(
    "X-Napier-Trace-Excluded-Payload-Key-Count",
    String(artifact.redaction.excludedPayloadKeys.length),
  );
}

function openTelemetryTraceArtifactFilename(
  artifact: OpenTelemetryTraceArtifact,
): string {
  const sourceId = artifact.runId ?? artifact.threadId;
  const safeSourceId = safeFilenameSegment(sourceId, "trace");
  return `napier-otel-${safeSourceId}-${artifact.contentSha256.slice(0, 12)}.json`;
}

function setExtensionPublisherTrustAnchorListHeaders(
  context: Context,
  anchors: readonly ExtensionPublisherTrustAnchor[],
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, anchors);
  context.header(
    "X-Napier-Extension-Publisher-Trust-Anchor-Count",
    String(anchors.length),
  );
  context.header(
    "X-Napier-Extension-Publisher-Trust-Trusted-Count",
    String(anchors.filter((anchor) => anchor.status === "trusted").length),
  );
  context.header(
    "X-Napier-Extension-Publisher-Trust-Revoked-Count",
    String(anchors.filter((anchor) => anchor.status === "revoked").length),
  );
  context.header(
    "X-Napier-Extension-Publisher-Trust-Signing-Capable-Count",
    String(anchors.filter((anchor) => Boolean(anchor.signingSource)).length),
  );
}

function setExtensionPublisherTrustAnchorHeaders(
  context: Context,
  anchor: ExtensionPublisherTrustAnchor,
): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, anchor.contentSha256);
  context.header("X-Napier-Extension-Publisher-Trust-Anchor-Id", anchor.id);
  context.header("X-Napier-Signature-Key-Id", anchor.keyId);
  context.header(
    "X-Napier-Extension-Publisher-Trust-Anchor-Status",
    anchor.status,
  );
  context.header(
    "X-Napier-Extension-Publisher-Trust-Signing-Capable",
    String(Boolean(anchor.signingSource)),
  );
}

function setEventBoundaryHeaders(
  context: Context,
  events: readonly RunEvent[],
): void {
  const firstSeq = events[0]?.seq;
  const lastSeq = events.at(-1)?.seq;
  if (firstSeq !== undefined) {
    context.header("X-Napier-First-Event-Seq", String(firstSeq));
  }
  if (lastSeq !== undefined) {
    context.header("X-Napier-Last-Event-Seq", String(lastSeq));
  }
}

function setAutomaticRecoveryProjectionHeaders(
  context: Context,
  recovery: {
    assessments: readonly unknown[];
    attempts: readonly unknown[];
  },
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, recovery);
  context.header(
    "X-Napier-Recovery-Assessment-Count",
    String(recovery.assessments.length),
  );
  context.header(
    "X-Napier-Recovery-Attempt-Count",
    String(recovery.attempts.length),
  );
}

function automationScheduleSha256(schedule: AutomationSchedule): string {
  return sha256Text(JSON.stringify(schedule));
}

function automationScheduleListSha256(
  schedules: readonly AutomationSchedule[],
): string {
  return sha256Text(JSON.stringify(schedules));
}

function setAutomationScheduleProjectionHeaders(
  context: Context,
  schedule: AutomationSchedule,
): void {
  const scheduleSha256 = automationScheduleSha256(schedule);
  context.header("Cache-Control", "no-store");
  setContentSha256Header(context, scheduleSha256, "body");
  context.header("X-Napier-Schedule-SHA256", scheduleSha256);
  context.header("X-Napier-Schedule-Id", schedule.id);
  context.header("X-Napier-Schedule-Status", schedule.status);
  context.header("X-Napier-Schedule-Revision", String(schedule.revision));
  context.header("X-Napier-Schedule-Next-Run-At", schedule.nextRunAt);
}

function setAutomationScheduleListHeaders(
  context: Context,
  schedules: readonly AutomationSchedule[],
): void {
  const scheduleListSha256 = automationScheduleListSha256(schedules);
  context.header("Cache-Control", "no-store");
  setContentSha256Header(context, scheduleListSha256, "body");
  context.header("X-Napier-Schedule-List-SHA256", scheduleListSha256);
  setAutomationScheduleCountHeaders(context, schedules);
}

function setAutomationScheduleCountHeaders(
  context: Context,
  schedules: readonly AutomationSchedule[],
): void {
  context.header("X-Napier-Schedule-Count", String(schedules.length));
  context.header(
    "X-Napier-Active-Schedule-Count",
    String(schedules.filter((schedule) => schedule.status === "active").length),
  );
  context.header(
    "X-Napier-Paused-Schedule-Count",
    String(schedules.filter((schedule) => schedule.status === "paused").length),
  );
}

function setInboundChannelProjectionHeaders(
  context: Context,
  channel: InboundChannel,
  options: { includeContentSha256?: boolean } = {},
): void {
  const channelSha256 = sha256Text(JSON.stringify(channel));
  context.header("Cache-Control", "no-store");
  context.header("X-Napier-Channel-SHA256", channelSha256);
  if (options.includeContentSha256) {
    setContentSha256Header(context, channelSha256, "body");
  }
  context.header("X-Napier-Channel-Status", channel.status);
  context.header("X-Napier-Channel-Revision", String(channel.revision));
  context.header("X-Napier-Token-Fingerprint", channel.tokenFingerprint);
  context.header("X-Napier-Policy-Template", channel.policyTemplate);
}

function inboundChannelListSha256(channels: readonly InboundChannel[]): string {
  return sha256Text(JSON.stringify(channels));
}

function setInboundChannelListHeaders(
  context: Context,
  channels: readonly InboundChannel[],
): void {
  const channelListSha256 = inboundChannelListSha256(channels);
  context.header("Cache-Control", "no-store");
  setContentSha256Header(context, channelListSha256, "body");
  context.header("X-Napier-Channel-List-SHA256", channelListSha256);
  setInboundChannelCountHeaders(context, channels);
}

function setInboundChannelCountHeaders(
  context: Context,
  channels: readonly InboundChannel[],
): void {
  context.header("X-Napier-Channel-Count", String(channels.length));
  context.header(
    "X-Napier-Active-Channel-Count",
    String(channels.filter((channel) => channel.status === "active").length),
  );
  context.header(
    "X-Napier-Disabled-Channel-Count",
    String(channels.filter((channel) => channel.status === "disabled").length),
  );
}

function setInboundChannelAdapterPreviewHeaders(
  context: Context,
  preview: InboundChannelAdapterPreview,
): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, preview.contentSha256);
  context.header("X-Napier-Channel-Id", preview.channelId);
  context.header("X-Napier-Adapter", preview.adapter);
  context.header("X-Napier-Body-SHA256", preview.bodySha256);
  context.header(
    "X-Napier-Idempotency-Fingerprint",
    preview.idempotencyFingerprint,
  );
  context.header("X-Napier-Message-SHA256", preview.messageSha256);
}

function setInboundDeliveryListHeaders(
  context: Context,
  channelId: string,
  deliveries: readonly InboundDelivery[],
): void {
  const deliveryListSha256 = sha256Text(JSON.stringify(deliveries));
  context.header("Cache-Control", "no-store");
  setContentSha256Header(context, deliveryListSha256, "body");
  context.header("X-Napier-Delivery-List-SHA256", deliveryListSha256);
  context.header("X-Napier-Channel-Id", channelId);
  context.header("X-Napier-Delivery-Count", String(deliveries.length));
  context.header(
    "X-Napier-Delivery-Ids-SHA256",
    sha256Json(deliveries.map((delivery) => delivery.id).sort()),
  );
  for (const status of [
    "accepted",
    "running",
    "retrying",
    "completed",
    "failed",
  ] satisfies InboundDelivery["status"][]) {
    context.header(
      `X-Napier-${status[0]!.toUpperCase()}${status.slice(1)}-Delivery-Count`,
      String(
        deliveries.filter((delivery) => delivery.status === status).length,
      ),
    );
  }
}

function setInboundDeliveryProjectionHeaders(
  context: Context,
  delivery: InboundDelivery,
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, delivery);
  context.header("X-Napier-Channel-Id", delivery.channelId);
  context.header("X-Napier-Thread-Id", delivery.threadId);
  context.header("X-Napier-Delivery-Id", delivery.id);
  context.header("X-Napier-Trigger-Id", delivery.triggerId);
  context.header("X-Napier-Delivery-Status", delivery.status);
  context.header("X-Napier-Attempt-Count", String(delivery.attemptCount));
  context.header("X-Napier-Max-Attempts", String(delivery.maxAttempts));
  context.header("X-Napier-Delivery-Revision", String(delivery.revision));
  context.header(
    "X-Napier-Idempotency-Fingerprint",
    delivery.idempotencyFingerprint,
  );
  if (delivery.runId) {
    context.header("X-Napier-Run-Id", delivery.runId);
  }
  if (delivery.nextAttemptAt) {
    context.header("X-Napier-Next-Attempt-At", delivery.nextAttemptAt);
  }
  if (delivery.bodySha256) {
    context.header("X-Napier-Body-SHA256", delivery.bodySha256);
  }
  if (delivery.adapterCatalogSha256) {
    context.header(
      "X-Napier-Adapter-Catalog-SHA256",
      delivery.adapterCatalogSha256,
    );
  }
}

function setInboundReceiptHeaders(
  context: Context,
  receipt: InboundReceipt,
): void {
  setInboundDeliveryProjectionHeaders(context, receipt.delivery);
  setBodyContentSha256Header(context, receipt);
  context.header("X-Napier-Duplicate", String(receipt.duplicate));
}

function setInboundDeliveryQualificationHeaders(
  context: Context,
  qualification: InboundDeliveryQualification,
): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, qualification.contentSha256);
  context.header("X-Napier-Channel-Id", qualification.channelId);
  context.header("X-Napier-Delivery-Id", qualification.deliveryId);
  context.header("X-Napier-Qualification-Status", qualification.status);
  context.header(
    "X-Napier-Diagnostic-Count",
    String(qualification.diagnostics.length),
  );
  context.header(
    "X-Napier-Current-Adapter-Catalog-SHA256",
    qualification.currentAdapterCatalogSha256,
  );
  if (qualification.bodySha256) {
    context.header("X-Napier-Body-SHA256", qualification.bodySha256);
  }
  if (qualification.adapterCatalogSha256) {
    context.header(
      "X-Napier-Adapter-Catalog-SHA256",
      qualification.adapterCatalogSha256,
    );
  }
}

function setInboundDeadLetterExportHeaders(
  context: Context,
  artifact: InboundDeadLetterExport,
): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, artifact.contentSha256);
  context.header("X-Napier-Channel-Id", artifact.channel.id);
  context.header("X-Napier-Thread-Id", artifact.channel.threadId);
  context.header("X-Napier-Channel-Status", artifact.channel.status);
  context.header(
    "X-Napier-Channel-Revision",
    String(artifact.channel.revision),
  );
  context.header("X-Napier-Delivery-Count", String(artifact.deliveryCount));
  context.header(
    "X-Napier-Delivery-Ids-SHA256",
    sha256Json(
      artifact.deliveries.map((delivery) => delivery.deliveryId).sort(),
    ),
  );
  context.header(
    "X-Napier-Manual-Retry-Available-Count",
    String(
      artifact.deliveries.filter(
        (delivery) => delivery.retryDisposition === "manual_retry_available",
      ).length,
    ),
  );
  context.header(
    "X-Napier-Retry-Exhausted-Count",
    String(
      artifact.deliveries.filter(
        (delivery) => delivery.retryDisposition === "retry_exhausted",
      ).length,
    ),
  );
  if (artifact.currentAdapterCatalogSha256) {
    context.header(
      "X-Napier-Current-Adapter-Catalog-SHA256",
      artifact.currentAdapterCatalogSha256,
    );
  }
  if (artifact.qualifiedCount !== undefined) {
    context.header("X-Napier-Qualified-Count", String(artifact.qualifiedCount));
  }
  if (artifact.evidenceMissingCount !== undefined) {
    context.header(
      "X-Napier-Evidence-Missing-Count",
      String(artifact.evidenceMissingCount),
    );
  }
  if (artifact.adapterCatalogDriftCount !== undefined) {
    context.header(
      "X-Napier-Adapter-Catalog-Drift-Count",
      String(artifact.adapterCatalogDriftCount),
    );
  }
  context.header(
    "Content-Disposition",
    `attachment; filename="${inboundDeadLetterExportFilename(artifact)}"`,
  );
}

function inboundDeadLetterExportFilename(
  artifact: InboundDeadLetterExport,
): string {
  const safeChannelId = safeFilenameSegment(artifact.channel.id, "channel");
  return `napier-dead-letters-${safeChannelId}-${artifact.contentSha256.slice(0, 12)}.json`;
}

function setInboundDeadLetterExportVerificationHeaders(
  context: Context,
  verification: InboundDeadLetterExportVerification,
): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, verification.contentSha256);
  context.header("X-Napier-Verification-Status", verification.status);
  if (verification.channelId) {
    context.header("X-Napier-Channel-Id", verification.channelId);
  }
  if (verification.expectedChannelId) {
    context.header(
      "X-Napier-Expected-Channel-Id",
      verification.expectedChannelId,
    );
  }
  if (verification.declaredContentSha256) {
    context.header(
      "X-Napier-Declared-Content-SHA256",
      verification.declaredContentSha256,
    );
  }
  if (verification.recomputedContentSha256) {
    context.header(
      "X-Napier-Recomputed-Content-SHA256",
      verification.recomputedContentSha256,
    );
  }
  if (verification.observedDeliveryCount !== undefined) {
    context.header(
      "X-Napier-Observed-Delivery-Count",
      String(verification.observedDeliveryCount),
    );
  }
  if (verification.observedQualifiedCount !== undefined) {
    context.header(
      "X-Napier-Observed-Qualified-Count",
      String(verification.observedQualifiedCount),
    );
  }
  if (verification.observedEvidenceMissingCount !== undefined) {
    context.header(
      "X-Napier-Observed-Evidence-Missing-Count",
      String(verification.observedEvidenceMissingCount),
    );
  }
  if (verification.observedAdapterCatalogDriftCount !== undefined) {
    context.header(
      "X-Napier-Observed-Adapter-Catalog-Drift-Count",
      String(verification.observedAdapterCatalogDriftCount),
    );
  }
}

function setInboundDeadLetterRetryPreviewHeaders(
  context: Context,
  preview: InboundDeadLetterRetryPreview,
): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, preview.contentSha256);
  context.header("X-Napier-Channel-Id", preview.channelId);
  context.header("X-Napier-Verification-Status", preview.verificationStatus);
  if (preview.artifactSha256) {
    context.header("X-Napier-Artifact-SHA256", preview.artifactSha256);
  }
  context.header("X-Napier-Retryable-Count", String(preview.retryableCount));
  context.header("X-Napier-Blocked-Count", String(preview.blockedCount));
  context.header("X-Napier-Candidate-Count", String(preview.candidates.length));
  context.header(
    "X-Napier-Diagnostic-Count",
    String(preview.diagnostics.length),
  );
  context.header("X-Napier-Candidate-Set-SHA256", preview.candidateSetSha256);
  context.header(
    "X-Napier-Retryable-Delivery-Ids-SHA256",
    preview.retryableDeliveryIdsSha256,
  );
  context.header(
    "X-Napier-Blocked-Delivery-Ids-SHA256",
    preview.blockedDeliveryIdsSha256,
  );
}

function setInboundDeadLetterRetryApplyResultHeaders(
  context: Context,
  result: InboundDeadLetterRetryApplyResult,
): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, result.contentSha256);
  context.header("X-Napier-Channel-Id", result.channelId);
  context.header("X-Napier-Preview-SHA256", result.previewSha256);
  if (result.artifactSha256) {
    context.header("X-Napier-Artifact-SHA256", result.artifactSha256);
  }
  context.header("X-Napier-Retried-Count", String(result.retriedCount));
  context.header("X-Napier-Skipped-Count", String(result.skippedCount));
  context.header(
    "X-Napier-Retried-Delivery-Count",
    String(result.deliveries.length),
  );
  context.header(
    "X-Napier-Skipped-Delivery-Count",
    String(result.skipped.length),
  );
  context.header(
    "X-Napier-Preview-Candidate-Set-SHA256",
    result.previewCandidateSetSha256,
  );
  context.header(
    "X-Napier-Preview-Retryable-Delivery-Ids-SHA256",
    result.previewRetryableDeliveryIdsSha256,
  );
  context.header(
    "X-Napier-Preview-Blocked-Delivery-Ids-SHA256",
    result.previewBlockedDeliveryIdsSha256,
  );
  context.header(
    "X-Napier-Retried-Delivery-Ids-SHA256",
    result.retriedDeliveryIdsSha256,
  );
  context.header(
    "X-Napier-Skipped-Delivery-Ids-SHA256",
    result.skippedDeliveryIdsSha256,
  );
}

function setInboundDeadLetterRetryHistoryHeaders(
  context: Context,
  history: InboundDeadLetterRetryHistory,
  channel: InboundChannel,
): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, history.contentSha256);
  context.header("X-Napier-Channel-Id", history.channelId);
  context.header("X-Napier-Thread-Id", channel.threadId);
  context.header("X-Napier-Event-Set-SHA256", history.eventSetSha256);
  context.header("X-Napier-Event-Count", String(history.eventCount));
  if (history.fromSeq !== undefined) {
    context.header("X-Napier-First-Event-Seq", String(history.fromSeq));
  }
  if (history.toSeq !== undefined) {
    context.header("X-Napier-Last-Event-Seq", String(history.toSeq));
  }
  context.header(
    "Content-Disposition",
    `attachment; filename="${inboundDeadLetterRetryHistoryFilename(history)}"`,
  );
}

function inboundDeadLetterRetryHistoryFilename(
  history: InboundDeadLetterRetryHistory,
): string {
  const safeChannelId = safeFilenameSegment(history.channelId, "channel");
  return `napier-dead-letter-retry-history-${safeChannelId}-${history.contentSha256.slice(0, 12)}.json`;
}

function setInboundDeadLetterRetryHistoryVerificationHeaders(
  context: Context,
  verification: InboundDeadLetterRetryHistoryVerification,
): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, verification.contentSha256);
  context.header("X-Napier-Verification-Status", verification.status);
  if (verification.channelId) {
    context.header("X-Napier-Channel-Id", verification.channelId);
  }
  if (verification.expectedChannelId) {
    context.header(
      "X-Napier-Expected-Channel-Id",
      verification.expectedChannelId,
    );
  }
  if (verification.observedContentSha256) {
    context.header(
      "X-Napier-Observed-Content-SHA256",
      verification.observedContentSha256,
    );
  }
  if (verification.observedEventSetSha256) {
    context.header(
      "X-Napier-Observed-Event-Set-SHA256",
      verification.observedEventSetSha256,
    );
  }
  if (verification.observedEventCount !== undefined) {
    context.header(
      "X-Napier-Observed-Event-Count",
      String(verification.observedEventCount),
    );
  }
  if (verification.observedFromSeq !== undefined) {
    context.header(
      "X-Napier-Observed-First-Event-Seq",
      String(verification.observedFromSeq),
    );
  }
  if (verification.observedToSeq !== undefined) {
    context.header(
      "X-Napier-Observed-Last-Event-Seq",
      String(verification.observedToSeq),
    );
  }
}

function inboundChannelAdapterIdsSha256(
  adapters: readonly InboundChannelAdapterDescriptor[],
): string {
  return sha256Json(adapters.map((adapter) => adapter.id).sort());
}

function setInboundChannelAdapterCatalogHeaders(
  context: Context,
  adapters: readonly InboundChannelAdapterDescriptor[],
): void {
  context.header("Cache-Control", "no-store");
  setContentSha256Header(context, inboundChannelAdapterCatalogSha256(), "body");
  context.header(
    "X-Napier-Adapter-Catalog-SHA256",
    inboundChannelAdapterCatalogSha256(),
  );
  context.header("X-Napier-Adapter-Count", String(adapters.length));
  context.header(
    "X-Napier-Adapter-Ids-SHA256",
    inboundChannelAdapterIdsSha256(adapters),
  );
}

function setBootstrapProjectionHeaders(
  context: Context,
  response: BootstrapResponse,
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, response);
  context.header("X-Napier-Bootstrap-Bytes", String(jsonByteLength(response)));
  if (response.activeThread) {
    context.header(
      "X-Napier-Bootstrap-Active-Thread-Bytes",
      String(jsonByteLength(response.activeThread)),
    );
    context.header(
      "X-Napier-Bootstrap-Active-Thread-Event-Bytes",
      String(jsonByteLength(response.activeThread.events)),
    );
  }
  context.header(
    "X-Napier-Schedule-List-SHA256",
    automationScheduleListSha256(response.schedules),
  );
  setAutomationScheduleCountHeaders(context, response.schedules);
  context.header(
    "X-Napier-Channel-List-SHA256",
    inboundChannelListSha256(response.channels),
  );
  setInboundChannelCountHeaders(context, response.channels);
  context.header(
    "X-Napier-Adapter-Catalog-SHA256",
    response.inboundChannelAdapterCatalogSha256,
  );
  context.header(
    "X-Napier-Adapter-Count",
    String(response.inboundChannelAdapters.length),
  );
  context.header(
    "X-Napier-Adapter-Ids-SHA256",
    inboundChannelAdapterIdsSha256(response.inboundChannelAdapters),
  );
}

function sha256Json(value: JsonValue): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function jsonByteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function sha256Text(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function sha256Bytes(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function requestRecord(
  input: unknown,
  supportedKeys: string[],
): Record<string, unknown> | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return undefined;
  }
  const record = input as Record<string, unknown>;
  return Object.keys(record).every((key) => supportedKeys.includes(key))
    ? record
    : undefined;
}

function nonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isSha256String(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

function validCasebookName(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 0 && normalized.length <= 100;
}

function validCasebookDescription(value: unknown): boolean {
  return (
    value === undefined ||
    (typeof value === "string" &&
      value.replace(/\s+/g, " ").trim().length <= 1_000)
  );
}

function trustedReceiptEventPayload(
  envelope: TrustedReceiptEnvelope,
): Record<string, JsonValue> {
  return {
    receiptKind: envelope.receiptKind,
    receiptSha256: envelope.receipt.contentSha256,
    receiptArtifactSha256: envelope.signature.receiptArtifactSha256,
    keyId: envelope.signature.keyId,
    signedAt: envelope.signature.signedAt,
    statementSha256: envelope.signature.statementSha256,
    envelopeSha256: envelope.contentSha256,
  };
}

function signedExtensionPackageEventPayload(
  extensionId: string,
  envelope: SignedExtensionPackageEnvelope,
): Record<string, JsonValue> {
  return {
    extensionId,
    keyId: envelope.signature.keyId,
    signedAt: envelope.signature.signedAt,
    statementSha256: envelope.signature.statementSha256,
    manifestSha256: envelope.manifest.contentSha256,
    manifestArtifactSha256: envelope.signature.manifestArtifactSha256,
    transportSha256: envelope.manifest.transportSha256,
    envelopeSha256: envelope.contentSha256,
  };
}

function setTrustedReceiptHeaders(
  context: Context,
  envelope: TrustedReceiptEnvelope,
  filename: string,
): void {
  context.header("Cache-Control", "no-store");
  context.header("Content-Disposition", `attachment; filename="${filename}"`);
  setStableContentSha256Header(context, envelope.contentSha256);
  context.header("X-Napier-Receipt-SHA256", envelope.receipt.contentSha256);
  context.header(
    "X-Napier-Receipt-Artifact-SHA256",
    envelope.signature.receiptArtifactSha256,
  );
  context.header("X-Napier-Signature-Key-Id", envelope.signature.keyId);
}

function setSignedExtensionPackageHeaders(
  context: Context,
  envelope: SignedExtensionPackageEnvelope,
  normalizedName: string,
): void {
  context.header("Cache-Control", "no-store");
  context.header(
    "Content-Disposition",
    `attachment; filename="${signedExtensionPackageFilename(normalizedName, envelope)}"`,
  );
  setStableContentSha256Header(context, envelope.contentSha256);
  context.header("X-Napier-Manifest-SHA256", envelope.manifest.contentSha256);
  context.header(
    "X-Napier-Manifest-Artifact-SHA256",
    envelope.signature.manifestArtifactSha256,
  );
  context.header("X-Napier-Signature-Key-Id", envelope.signature.keyId);
}

function signedExtensionPackageFilename(
  normalizedName: string,
  envelope: SignedExtensionPackageEnvelope,
): string {
  const safeName = safeFilenameSegment(normalizedName, "extension");
  return `${safeName}-${envelope.contentSha256.slice(0, 12)}.napier-extension.json`;
}

function setSkillPackageHeaders(
  context: Context,
  envelope: SignedSkillPackageEnvelope,
  filename: string,
): void {
  context.header("Cache-Control", "no-store");
  context.header("Content-Disposition", `attachment; filename="${filename}"`);
  setStableContentSha256Header(context, envelope.contentSha256);
  context.header("X-Napier-Manifest-SHA256", envelope.manifest.contentSha256);
  context.header(
    "X-Napier-Skill-Catalog-SHA256",
    envelope.manifest.skillCatalogSha256,
  );
  context.header(
    "X-Napier-Skill-Count",
    String(envelope.manifest.skills.length),
  );
  context.header("X-Napier-Signature-Key-Id", envelope.signature.keyId);
}

function setPromptPackageHeaders(
  context: Context,
  envelope: SignedPromptPackageEnvelope,
  filename: string,
): void {
  context.header("Cache-Control", "no-store");
  context.header("Content-Disposition", `attachment; filename="${filename}"`);
  setStableContentSha256Header(context, envelope.contentSha256);
  context.header("X-Napier-Manifest-SHA256", envelope.manifest.contentSha256);
  context.header(
    "X-Napier-System-Prompt-SHA256",
    envelope.manifest.systemPromptSha256,
  );
  context.header(
    "X-Napier-Agent-Revision",
    String(envelope.manifest.agentRevision),
  );
  context.header("X-Napier-Signature-Key-Id", envelope.signature.keyId);
}

function setInspectorPackageHeaders(
  context: Context,
  envelope: SignedInspectorPackageEnvelope,
  filename: string,
): void {
  context.header("Cache-Control", "no-store");
  context.header("Content-Disposition", `attachment; filename="${filename}"`);
  setStableContentSha256Header(context, envelope.contentSha256);
  context.header("X-Napier-Manifest-SHA256", envelope.manifest.contentSha256);
  context.header(
    "X-Napier-Inspector-Catalog-SHA256",
    envelope.manifest.inspectorCatalogSha256,
  );
  context.header(
    "X-Napier-Inspector-Count",
    String(envelope.manifest.panels.length),
  );
  context.header("X-Napier-Signature-Key-Id", envelope.signature.keyId);
}

function setSkillPackageVerificationHeaders(
  context: Context,
  verification: SkillPackageVerification,
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, verification);
  context.header("X-Napier-Skill-Package-Status", verification.status);
  context.header("X-Napier-Skill-Count", String(verification.skillCount));
  if (verification.manifestSha256) {
    context.header("X-Napier-Manifest-SHA256", verification.manifestSha256);
  }
  if (verification.envelopeSha256) {
    context.header(
      "X-Napier-Skill-Package-Envelope-SHA256",
      verification.envelopeSha256,
    );
  }
  if (verification.keyId) {
    context.header("X-Napier-Signature-Key-Id", verification.keyId);
  }
}

function setSkillPackageQualificationHeaders(
  context: Context,
  qualification: SkillPackageQualification,
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, qualification);
  context.header("X-Napier-Skill-Package-Status", qualification.status);
  context.header(
    "X-Napier-Skill-Package-Verification-Status",
    qualification.verificationStatus,
  );
  context.header("X-Napier-Skill-Count", String(qualification.skillCount));
  if (qualification.manifestSha256) {
    context.header("X-Napier-Manifest-SHA256", qualification.manifestSha256);
  }
  if (qualification.envelopeSha256) {
    context.header(
      "X-Napier-Skill-Package-Envelope-SHA256",
      qualification.envelopeSha256,
    );
  }
  if (qualification.skillCatalogSha256) {
    context.header(
      "X-Napier-Skill-Catalog-SHA256",
      qualification.skillCatalogSha256,
    );
  }
  if (qualification.observedSkillCatalogSha256) {
    context.header(
      "X-Napier-Observed-Skill-Catalog-SHA256",
      qualification.observedSkillCatalogSha256,
    );
  }
  if (qualification.keyId) {
    context.header("X-Napier-Signature-Key-Id", qualification.keyId);
  }
}

function setSkillPackageInstallationListHeaders(
  context: Context,
  installations: readonly SkillPackageInstallation[],
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, installations);
  context.header(
    "X-Napier-Skill-Package-Installation-Count",
    String(installations.length),
  );
  context.header(
    "X-Napier-Skill-Package-Active-Installation-Count",
    String(
      installations.filter((installation) => installation.status === "active")
        .length,
    ),
  );
  context.header(
    "X-Napier-Skill-Package-Replaced-Installation-Count",
    String(
      installations.filter((installation) => installation.status === "replaced")
        .length,
    ),
  );
  context.header(
    "X-Napier-Skill-Count",
    String(
      installations.reduce(
        (total, installation) => total + installation.loadedSkillNames.length,
        0,
      ),
    ),
  );
}

function setSkillPackageInstallationResultHeaders(
  context: Context,
  result: InstallSkillPackageResult,
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, result);
  context.header(
    "X-Napier-Skill-Package-Installation-Id",
    result.installation.id,
  );
  context.header(
    "X-Napier-Skill-Package-Installation-Status",
    result.installation.status,
  );
  context.header(
    "X-Napier-Skill-Package-Installation-Created",
    String(result.created),
  );
  context.header("X-Napier-Skill-Package-Status", result.qualification.status);
  context.header(
    "X-Napier-Skill-Package-Verification-Status",
    result.qualification.verificationStatus,
  );
  context.header(
    "X-Napier-Skill-Count",
    String(result.installation.loadedSkillNames.length),
  );
  context.header(
    "X-Napier-Skill-Catalog-SHA256",
    result.installation.skillCatalogSha256,
  );
  context.header(
    "X-Napier-Manifest-SHA256",
    result.installation.manifestSha256,
  );
  context.header(
    "X-Napier-Skill-Package-Envelope-SHA256",
    result.installation.envelopeSha256,
  );
  context.header(
    "X-Napier-Skill-Names-SHA256",
    result.installation.skillNamesSha256,
  );
  context.header("X-Napier-Signature-Key-Id", result.installation.keyId);
  if (result.replacedInstallation) {
    context.header(
      "X-Napier-Skill-Package-Replaced-Installation-Id",
      result.replacedInstallation.id,
    );
  }
}

function setSkillContentReviewHeaders(
  context: Context,
  review: SkillContentReview,
): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, review.reviewSha256);
  context.header("X-Napier-Skill-Content-Review-SHA256", review.reviewSha256);
  context.header("X-Napier-Skill-Content-SHA256", review.contentSha256);
  context.header(
    "X-Napier-Skill-Content-Frontmatter-SHA256",
    review.frontmatterSha256,
  );
  context.header("X-Napier-Skill-Content-Body-SHA256", review.bodySha256);
  context.header("X-Napier-Skill-Content-Action", review.action);
  context.header("X-Napier-Skill-Content-Size-Bytes", String(review.sizeBytes));
  context.header("X-Napier-Skill-Content-Line-Count", String(review.lineCount));
  if (review.currentContentSha256) {
    context.header(
      "X-Napier-Skill-Content-Current-SHA256",
      review.currentContentSha256,
    );
  }
}

function setSkillContentApplyResultHeaders(
  context: Context,
  result: ApplySkillContentResult,
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, result);
  context.header(
    "X-Napier-Skill-Content-Review-SHA256",
    result.review.reviewSha256,
  );
  context.header("X-Napier-Skill-Content-SHA256", result.review.contentSha256);
  context.header("X-Napier-Skill-Content-Action", result.review.action);
  context.header("X-Napier-Skill-Content-Applied", String(result.applied));
  context.header(
    "X-Napier-Skill-Content-Size-Bytes",
    String(result.review.sizeBytes),
  );
  context.header(
    "X-Napier-Skill-Content-Line-Count",
    String(result.review.lineCount),
  );
}

function setPromptPackageVerificationHeaders(
  context: Context,
  verification: PromptPackageVerification,
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, verification);
  context.header("X-Napier-Prompt-Package-Status", verification.status);
  if (verification.manifestSha256) {
    context.header("X-Napier-Manifest-SHA256", verification.manifestSha256);
  }
  if (verification.envelopeSha256) {
    context.header(
      "X-Napier-Prompt-Package-Envelope-SHA256",
      verification.envelopeSha256,
    );
  }
  if (verification.keyId) {
    context.header("X-Napier-Signature-Key-Id", verification.keyId);
  }
}

function setPromptPackageQualificationHeaders(
  context: Context,
  qualification: PromptPackageQualification,
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, qualification);
  context.header("X-Napier-Prompt-Package-Status", qualification.status);
  context.header(
    "X-Napier-Prompt-Package-Verification-Status",
    qualification.verificationStatus,
  );
  if (qualification.manifestSha256) {
    context.header("X-Napier-Manifest-SHA256", qualification.manifestSha256);
  }
  if (qualification.envelopeSha256) {
    context.header(
      "X-Napier-Prompt-Package-Envelope-SHA256",
      qualification.envelopeSha256,
    );
  }
  if (qualification.systemPromptSha256) {
    context.header(
      "X-Napier-System-Prompt-SHA256",
      qualification.systemPromptSha256,
    );
  }
  if (qualification.observedSystemPromptSha256) {
    context.header(
      "X-Napier-Observed-System-Prompt-SHA256",
      qualification.observedSystemPromptSha256,
    );
  }
  if (qualification.sourceAgentId) {
    context.header("X-Napier-Agent-Id", qualification.sourceAgentId);
  }
  if (qualification.observedAgentId) {
    context.header("X-Napier-Observed-Agent-Id", qualification.observedAgentId);
  }
  if (qualification.observedAgentRevision !== undefined) {
    context.header(
      "X-Napier-Observed-Agent-Revision",
      String(qualification.observedAgentRevision),
    );
  }
  if (qualification.keyId) {
    context.header("X-Napier-Signature-Key-Id", qualification.keyId);
  }
}

function setInspectorPackageVerificationHeaders(
  context: Context,
  verification: InspectorPackageVerification,
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, verification);
  context.header("X-Napier-Inspector-Package-Status", verification.status);
  context.header("X-Napier-Inspector-Count", String(verification.panelCount));
  if (verification.manifestSha256) {
    context.header("X-Napier-Manifest-SHA256", verification.manifestSha256);
  }
  if (verification.envelopeSha256) {
    context.header(
      "X-Napier-Inspector-Package-Envelope-SHA256",
      verification.envelopeSha256,
    );
  }
  if (verification.keyId) {
    context.header("X-Napier-Signature-Key-Id", verification.keyId);
  }
}

function setInspectorPackageQualificationHeaders(
  context: Context,
  qualification: InspectorPackageQualification,
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, qualification);
  context.header("X-Napier-Inspector-Package-Status", qualification.status);
  context.header(
    "X-Napier-Inspector-Package-Verification-Status",
    qualification.verificationStatus,
  );
  context.header("X-Napier-Inspector-Count", String(qualification.panelCount));
  if (qualification.manifestSha256) {
    context.header("X-Napier-Manifest-SHA256", qualification.manifestSha256);
  }
  if (qualification.envelopeSha256) {
    context.header(
      "X-Napier-Inspector-Package-Envelope-SHA256",
      qualification.envelopeSha256,
    );
  }
  if (qualification.inspectorCatalogSha256) {
    context.header(
      "X-Napier-Inspector-Catalog-SHA256",
      qualification.inspectorCatalogSha256,
    );
  }
  if (qualification.observedInspectorCatalogSha256) {
    context.header(
      "X-Napier-Observed-Inspector-Catalog-SHA256",
      qualification.observedInspectorCatalogSha256,
    );
  }
  if (qualification.keyId) {
    context.header("X-Napier-Signature-Key-Id", qualification.keyId);
  }
}

function setExtensionPackageChannelIndexHeaders(
  context: Context,
  envelope: SignedExtensionPackageChannelIndexEnvelope,
  filename: string,
): void {
  context.header("Cache-Control", "no-store");
  context.header("Content-Disposition", `attachment; filename="${filename}"`);
  setStableContentSha256Header(context, envelope.contentSha256);
  context.header("X-Napier-Index-SHA256", envelope.index.contentSha256);
  context.header(
    "X-Napier-Index-Artifact-SHA256",
    envelope.signature.indexArtifactSha256,
  );
  context.header(
    "X-Napier-Channel-Count",
    String(envelope.index.channels.length),
  );
  context.header("X-Napier-Signature-Key-Id", envelope.signature.keyId);
}

function setExtensionPackageLockfileHeaders(
  context: Context,
  lockfile: ExtensionPackageLockfile,
  filename: string,
): void {
  context.header("Cache-Control", "no-store");
  context.header("Content-Disposition", `attachment; filename="${filename}"`);
  setStableContentSha256Header(context, lockfile.contentSha256);
  context.header("X-Napier-Package-Count", String(lockfile.packages.length));
  context.header(
    "X-Napier-Extension-Package-Dependency-Count",
    String(
      lockfile.packages.reduce(
        (total, entry) => total + entry.dependencies.length,
        0,
      ),
    ),
  );
  context.header(
    "X-Napier-Extension-Package-Envelope-Set-SHA256",
    sha256Json(lockfile.packages.map((entry) => entry.envelopeSha256).sort()),
  );
  context.header(
    "X-Napier-Extension-Package-Name-Set-SHA256",
    sha256Json(lockfile.packages.map((entry) => entry.normalizedName).sort()),
  );
  context.header(
    "X-Napier-Extension-Package-Publisher-Key-Set-SHA256",
    sha256Json(
      [...new Set(lockfile.packages.map((entry) => entry.keyId))].sort(),
    ),
  );
}

function setExtensionPackageVerificationHeaders(
  context: Context,
  verification: ExtensionPackageVerification,
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, verification);
  context.header("X-Napier-Extension-Package-Status", verification.status);
  context.header(
    "X-Napier-Extension-Package-Signature-Valid",
    String(verification.signatureValid),
  );
  context.header(
    "X-Napier-Extension-Package-Integrity-Valid",
    String(verification.integrityValid),
  );
  context.header(
    "X-Napier-Extension-Package-Configuration-Valid",
    String(verification.configurationValid),
  );
  if (verification.executableValid !== undefined) {
    context.header(
      "X-Napier-Extension-Package-Executable-Valid",
      String(verification.executableValid),
    );
  }
  if (verification.keyId) {
    context.header("X-Napier-Signature-Key-Id", verification.keyId);
  }
  if (verification.manifestSha256) {
    context.header("X-Napier-Manifest-SHA256", verification.manifestSha256);
  }
  if (verification.envelopeSha256) {
    context.header(
      "X-Napier-Extension-Package-Envelope-SHA256",
      verification.envelopeSha256,
    );
  }
  if (verification.transportSha256) {
    context.header(
      "X-Napier-Extension-Package-Transport-SHA256",
      verification.transportSha256,
    );
  }
}

function setExtensionPackageDeploymentPreviewHeaders(
  context: Context,
  preview: ExtensionPackageDeploymentPreview,
): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, preview.contentSha256);
  context.header(
    "X-Napier-Extension-Package-Deployment-SHA256",
    preview.contentSha256,
  );
  context.header(
    "X-Napier-Extension-Package-Candidate-Count",
    String(preview.candidateCount),
  );
  context.header(
    "X-Napier-Extension-Package-Install-Count",
    String(preview.installCount),
  );
  context.header(
    "X-Napier-Extension-Package-Update-Count",
    String(preview.updateCount),
  );
  context.header(
    "X-Napier-Extension-Package-Dependency-Resolution-Count",
    String(preview.resolutions.length),
  );
  context.header(
    "X-Napier-Extension-Package-Requires-Publisher-Confirmation",
    String(preview.requiresPublisherConfirmation),
  );
  context.header(
    "X-Napier-Extension-Package-Requires-Version-Override",
    String(preview.requiresVersionOverride),
  );
  context.header(
    "X-Napier-Extension-Package-No-Changes",
    String(preview.noChanges),
  );
}

function setExtensionPackageDeploymentResultHeaders(
  context: Context,
  result: ApplyExtensionPackageDeploymentResult,
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, result);
  context.header(
    "X-Napier-Extension-Package-Deployment-SHA256",
    result.preview.contentSha256,
  );
  context.header(
    "X-Napier-Extension-Package-Candidate-Count",
    String(result.preview.candidateCount),
  );
  context.header(
    "X-Napier-Extension-Package-Applied-Extension-Count",
    String(result.extensions.length),
  );
  context.header(
    "X-Napier-Extension-Package-Installed-Extension-Count",
    String(result.installedExtensionIds.length),
  );
  context.header(
    "X-Napier-Extension-Package-Updated-Extension-Count",
    String(result.updatedExtensionIds.length),
  );
  context.header(
    "X-Napier-Extension-Package-No-Changes",
    String(result.preview.noChanges),
  );
}

function setExtensionPackageLockfileVerificationHeaders(
  context: Context,
  verification: ExtensionPackageLockfileVerification,
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, verification);
  context.header(
    "X-Napier-Extension-Package-Lockfile-Status",
    verification.status,
  );
  context.header("X-Napier-Package-Count", String(verification.packageCount));
  context.header(
    "X-Napier-Extension-Package-Envelope-Count",
    String(verification.packageEnvelopeSha256es.length),
  );
  if (verification.lockfileSha256) {
    context.header(
      "X-Napier-Extension-Package-Lockfile-SHA256",
      verification.lockfileSha256,
    );
  }
}

function setExtensionPackageChannelIndexVerificationHeaders(
  context: Context,
  verification: ExtensionPackageChannelIndexVerification,
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, verification);
  context.header(
    "X-Napier-Extension-Package-Channel-Index-Status",
    verification.status,
  );
  context.header("X-Napier-Channel-Count", String(verification.channelCount));
  if (verification.indexSha256) {
    context.header("X-Napier-Index-SHA256", verification.indexSha256);
  }
  if (verification.envelopeSha256) {
    context.header(
      "X-Napier-Extension-Package-Envelope-SHA256",
      verification.envelopeSha256,
    );
  }
  if (verification.keyId) {
    context.header("X-Napier-Signature-Key-Id", verification.keyId);
  }
}

function setExtensionPackageRolloutChannelListHeaders(
  context: Context,
  channels: readonly ExtensionPackageRolloutChannel[],
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, channels);
  context.header(
    "X-Napier-Extension-Package-Rollout-Count",
    String(channels.length),
  );
  context.header(
    "X-Napier-Extension-Package-Active-Rollout-Count",
    String(channels.filter((channel) => channel.status === "active").length),
  );
  context.header(
    "X-Napier-Package-Count",
    String(
      channels.reduce((total, channel) => total + channel.packageCount, 0),
    ),
  );
  context.header(
    "X-Napier-Extension-Package-Dependency-Count",
    String(
      channels.reduce((total, channel) => total + channel.dependencyCount, 0),
    ),
  );
}

function setExtensionPackageRolloutChannelHeaders(
  context: Context,
  channel: ExtensionPackageRolloutChannel,
): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, channel.contentSha256);
  context.header("X-Napier-Extension-Package-Rollout-Id", channel.id);
  context.header("X-Napier-Extension-Package-Rollout-Status", channel.status);
  context.header(
    "X-Napier-Extension-Package-Rollout-Revision",
    String(channel.revision),
  );
  context.header(
    "X-Napier-Extension-Package-Lockfile-SHA256",
    channel.lockfileSha256,
  );
  context.header("X-Napier-Package-Count", String(channel.packageCount));
  context.header(
    "X-Napier-Extension-Package-Dependency-Count",
    String(channel.dependencyCount),
  );
  context.header(
    "X-Napier-Extension-Package-Envelope-Set-SHA256",
    channel.packageEnvelopeIdsSha256,
  );
  context.header(
    "X-Napier-Extension-Package-Rollout-Policy-SHA256",
    sha256Text(JSON.stringify(channel.policy)),
  );
}

function setExtensionPackageRolloutPreviewHeaders(
  context: Context,
  preview: ExtensionPackageRolloutPreview,
): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, preview.contentSha256);
  context.header(
    "X-Napier-Extension-Package-Rollout-SHA256",
    preview.contentSha256,
  );
  context.header("X-Napier-Extension-Package-Rollout-Id", preview.channelId);
  context.header(
    "X-Napier-Extension-Package-Rollout-Revision",
    String(preview.channelRevision),
  );
  context.header(
    "X-Napier-Extension-Package-Lockfile-SHA256",
    preview.lockfileSha256,
  );
  context.header(
    "X-Napier-Extension-Package-Lockfile-Status",
    preview.verification.status,
  );
  context.header(
    "X-Napier-Extension-Package-Deployment-SHA256",
    preview.deploymentPreview.contentSha256,
  );
  context.header(
    "X-Napier-Extension-Package-Candidate-Count",
    String(preview.deploymentPreview.candidateCount),
  );
  context.header(
    "X-Napier-Extension-Package-Install-Count",
    String(preview.deploymentPreview.installCount),
  );
  context.header(
    "X-Napier-Extension-Package-Update-Count",
    String(preview.deploymentPreview.updateCount),
  );
}

function setExtensionPackageRolloutApplyResultHeaders(
  context: Context,
  result: ApplyExtensionPackageRolloutChannelResult,
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, result);
  context.header(
    "X-Napier-Extension-Package-Rollout-SHA256",
    result.rolloutPreview.contentSha256,
  );
  context.header(
    "X-Napier-Extension-Package-Deployment-SHA256",
    result.deployment.preview.contentSha256,
  );
  context.header("X-Napier-Extension-Package-Rollout-Id", result.channel.id);
  context.header(
    "X-Napier-Extension-Package-Rollout-Revision",
    String(result.channel.revision),
  );
  context.header(
    "X-Napier-Extension-Package-Lockfile-SHA256",
    result.channel.lockfileSha256,
  );
  context.header(
    "X-Napier-Extension-Package-Applied-Extension-Count",
    String(result.deployment.extensions.length),
  );
  context.header(
    "X-Napier-Extension-Package-Installed-Extension-Count",
    String(result.deployment.installedExtensionIds.length),
  );
  context.header(
    "X-Napier-Extension-Package-Updated-Extension-Count",
    String(result.deployment.updatedExtensionIds.length),
  );
}

function setExtensionPackageUpdatePreviewHeaders(
  context: Context,
  preview: ExtensionPackageUpdatePreview,
): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, preview.contentSha256);
  context.header("X-Napier-Extension-Id", preview.extensionId);
  context.header(
    "X-Napier-Extension-Package-Update-SHA256",
    preview.contentSha256,
  );
  context.header(
    "X-Napier-Extension-Package-Binding-SHA256",
    preview.expectedPackageBindingSha256,
  );
  context.header(
    "X-Napier-Extension-Package-Current-Manifest-SHA256",
    preview.current.manifestSha256,
  );
  context.header(
    "X-Napier-Extension-Package-Next-Manifest-SHA256",
    preview.next.manifestSha256,
  );
  context.header(
    "X-Napier-Extension-Package-Version-Direction",
    preview.versionDirection,
  );
  context.header(
    "X-Napier-Extension-Package-Requires-Publisher-Confirmation",
    String(preview.requiresPublisherConfirmation),
  );
  context.header(
    "X-Napier-Extension-Package-Requires-Version-Override",
    String(preview.requiresVersionOverride),
  );
  context.header(
    "X-Napier-Extension-Package-Change-Count",
    String(preview.changes.length),
  );
  context.header(
    "X-Napier-Extension-Package-Added-Capability-Count",
    String(preview.capabilitiesAdded.length),
  );
  context.header(
    "X-Napier-Extension-Package-Removed-Capability-Count",
    String(preview.capabilitiesRemoved.length),
  );
  context.header(
    "X-Napier-Extension-Package-Tool-Added-Count",
    String(preview.tools.added.length),
  );
  context.header(
    "X-Napier-Extension-Package-Tool-Removed-Count",
    String(preview.tools.removed.length),
  );
  context.header(
    "X-Napier-Extension-Package-No-Changes",
    String(preview.noChanges),
  );
}

function setExtensionPackageUpdateResultHeaders(
  context: Context,
  result: ApplyExtensionPackageUpdateResult,
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, result);
  context.header("X-Napier-Extension-Id", result.extension.id);
  context.header(
    "X-Napier-Extension-Package-Update-SHA256",
    result.preview.contentSha256,
  );
  context.header(
    "X-Napier-Extension-Package-Binding-SHA256",
    result.preview.expectedPackageBindingSha256,
  );
  context.header("X-Napier-Extension-Package-Updated", String(result.updated));
  context.header(
    "X-Napier-Extension-Package-Version-Direction",
    result.preview.versionDirection,
  );
  context.header(
    "X-Napier-Extension-Package-History-Count",
    String(result.extension.packageHistory?.length ?? 0),
  );
  context.header(
    "X-Napier-Extension-Revision",
    String(result.extension.revision),
  );
}

async function appendReceiptTrustEvent(
  services: NapierServices,
  threadId: string,
  type: string,
  payload: Record<string, JsonValue>,
): Promise<void> {
  await services.store.appendEvent({
    threadId,
    runId: createId("runctl"),
    type,
    category: "evaluation",
    visibility: "user",
    payload,
  });
}

async function appendChannelEvent(
  services: NapierServices,
  threadId: string,
  type: string,
  payload: Record<string, JsonValue>,
): Promise<void> {
  await services.store.appendEvent({
    threadId,
    runId: createId("runctl"),
    type,
    category: "channel",
    visibility: "user",
    payload,
  });
}

async function appendExtensionEvent(
  services: NapierServices,
  threadId: string | undefined,
  type: string,
  payload: Record<string, JsonValue>,
): Promise<void> {
  if (!threadId) return;
  await services.store.appendEvent({
    threadId,
    runId: createId("runctl"),
    type,
    category: "extension",
    visibility: "user",
    payload,
  });
}

async function appendCredentialEvent(
  services: NapierServices,
  threadId: string | undefined,
  type: string,
  reference: CredentialReference,
): Promise<void> {
  if (!threadId) return;
  await services.store.appendEvent({
    threadId,
    runId: createId("runctl"),
    type,
    category: "credential",
    visibility: "user",
    payload: {
      referenceId: reference.id,
      providerId: reference.providerId,
      label: reference.label,
      sourceType: reference.source.type,
      status: reference.status,
      availability: reference.availability,
      revision: reference.revision,
      ...(reference.lastError ? { error: reference.lastError } : {}),
    },
  });
}

async function readOptionalLimitedJson(
  request: Request,
  maximumBytes: number,
  subject: string,
): Promise<unknown | undefined> {
  const declaredLength = request.headers.get("content-length");
  if (
    declaredLength &&
    Number.isFinite(Number(declaredLength)) &&
    Number(declaredLength) > maximumBytes
  ) {
    throw new RequestBodyTooLargeError(
      `${subject} exceeds ${maximumBytes} bytes`,
    );
  }
  if (!request.body) return undefined;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > maximumBytes) {
        await reader.cancel();
        throw new RequestBodyTooLargeError(
          `${subject} exceeds ${maximumBytes} bytes`,
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (byteLength === 0) return undefined;
  const source = Buffer.concat(chunks).toString("utf8");
  return source.trim() ? (JSON.parse(source) as unknown) : undefined;
}

class RequestBodyTooLargeError extends Error {}

async function readLimitedBytes(
  request: Request,
  maximumBytes: number,
  subject: string,
): Promise<Buffer> {
  const declaredLength = request.headers.get("content-length");
  if (
    declaredLength &&
    Number.isFinite(Number(declaredLength)) &&
    Number(declaredLength) > maximumBytes
  ) {
    throw new RequestBodyTooLargeError(
      `${subject} exceeds ${maximumBytes} bytes`,
    );
  }
  if (!request.body) throw new Error("request body is required");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > maximumBytes) {
        await reader.cancel();
        throw new RequestBodyTooLargeError(
          `${subject} exceeds ${maximumBytes} bytes`,
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}

async function readLimitedJson(
  request: Request,
  maximumBytes: number,
  subject = "Thread replay import",
): Promise<unknown> {
  const declaredLength = request.headers.get("content-length");
  if (
    declaredLength &&
    Number.isFinite(Number(declaredLength)) &&
    Number(declaredLength) > maximumBytes
  ) {
    throw new RequestBodyTooLargeError(
      `${subject} exceeds ${maximumBytes} bytes`,
    );
  }
  if (!request.body) throw new Error("request body is required");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > maximumBytes) {
        await reader.cancel();
        throw new RequestBodyTooLargeError(
          `${subject} exceeds ${maximumBytes} bytes`,
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (byteLength === 0) throw new Error("request body is required");
  const body = Buffer.concat(chunks).toString("utf8");
  return JSON.parse(body) as unknown;
}
