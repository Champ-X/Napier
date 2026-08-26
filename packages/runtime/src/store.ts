import { mkdir, readdir, readFile } from "node:fs/promises";
import path from "node:path";

import {
  emptyUsage,
  type AgentMilestone,
  type AgentProfile,
  type AgentProfileRevision,
  type AgentProfileRollbackResult,
  type AnswerOperatorDecisionRequest,
  type ApplyExtensionPackageDeploymentRequest,
  type ApplyExtensionPackageDeploymentResult,
  type ApplyExtensionPackageRolloutChannelRequest,
  type ApplyExtensionPackageRolloutChannelResult,
  type ApplyExtensionPackageUpdateRequest,
  type ApplyExtensionPackageUpdateResult,
  type ApplyReceiptTrustAnchorDirectoryQuorumActivationSelectionResult,
  type ApplySkillContentRequest,
  type ApplySkillContentResult,
  type AutomaticRecoveryAssessment,
  type AutomaticRecoveryAttempt,
  type AutomaticRecoveryClaim,
  type AutomationSchedule,
  type ContextCheckpointCalibrationReport,
  type CreateAutomationScheduleRequest,
  type CreateCredentialReferenceRequest,
  type CreatedInboundChannel,
  type CreateEvaluationCasebookRequest,
  type CreateEvaluationSuiteRequest,
  type CreateExecutionPlanFromBlueprintRecordRequest,
  type CreateExecutionPlanRequest,
  type CreateExtensionPublisherTrustAnchorRequest,
  type CreateInboundChannelRequest,
  type CreateMcpExtensionRequest,
  type CreateMemoryRequest,
  type CreateReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionRequest,
  type CreateReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionRequest,
  type CreateReceiptTrustAnchorDirectorySubscriptionRequest,
  type CreateReceiptTrustAnchorRequest,
  type CredentialAvailability,
  type CredentialReference,
  type CurateEvaluationCaseRequest,
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
  type EvaluationQualificationBaseline,
  type EvaluationReviewerBallot,
  type EvaluationSuite,
  type EvaluationSuiteExecution,
  type ExecutionPlan,
  type ExecutionPlanBlueprintPortfolioCalibration,
  type ExecutionPlanBlueprintRecommendationPolicyBacktest,
  type ExecutionPlanBlueprintRecommendationPolicyOverride,
  type ExecutionPlanBlueprintRecommendationPolicyOverrideDriftReview,
  type ExecutionPlanBlueprintRecommendationPolicyOverrideList,
  type ExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistory,
  type ExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryProofBundle,
  type ExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryVerification,
  type ExecutionPlanBlueprintRecord,
  type ExecutionPlanBlueprintRecordOutcomeBaseline,
  type ExecutionPlanBlueprintRecordOutcomeQualification,
  type ExecutionPlanBlueprintRecordPreview,
  type ExecutionPlanBlueprintRecordQualification,
  type ExecutionPlanBlueprintRecordReplayEventVerification,
  type ExecutionPlanBlueprintRecordReplayHistory,
  type ExecutionPlanBlueprintRecordReplayHistoryVerification,
  type ExecutionPlanBlueprintRecordReplayOutcomes,
  type ExecutionPlanBlueprintRecordReplayOutcomesVerification,
  type ExecutionPlanBlueprintRecordSelection,
  type ExportExtensionPackageLockfileRequest,
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
  type GoalState,
  type ImportSignedExtensionPackageRequest,
  type InboundChannel,
  type InboundDeadLetterExport,
  type InboundDelivery,
  type InboundMessageRequest,
  type InboundReceipt,
  type InboundRetryPolicy,
  type InspectorPackageQualification,
  type InspectorPackageVerification,
  type InstallSkillPackageRequest,
  type InstallSkillPackageResult,
  type MemoryFact,
  type MemorySource,
  type OperatorDecision,
  type OperatorDecisionCancellationReason,
  type PreviewExtensionPackageRolloutChannelRequest,
  type PreviewSkillContentRequest,
  type PromoteEvaluationQualificationBaselineResult,
  type PromoteExecutionPlanBlueprintRecordOutcomeBaselineRequest,
  type PromoteExecutionPlanBlueprintRecordOutcomeBaselineResult,
  type PromoteReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselineResult,
  type PromoteReceiptTrustAnchorDirectoryQuorumBaselineResult,
  type PromptPackageQualification,
  type PromptPackageVerification,
  type PublishExtensionPackageRolloutChannelRequest,
  type QualifyInspectorPackageRequest,
  type QualifyPromptPackageRequest,
  type QualifySkillPackageRequest,
  type ReceiptTrustAnchor,
  type ReceiptTrustAnchorDirectory,
  type ReceiptTrustAnchorDirectoryDiscovery,
  type ReceiptTrustAnchorDirectoryQuorum,
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
  type ReceiptTrustAnchorDirectoryQuorumMetadataEvidence,
  type ReceiptTrustAnchorDirectoryQuorumPolicy,
  type ReceiptTrustAnchorDirectoryQuorumPromotionBaseline,
  type ReceiptTrustAnchorDirectoryQuorumPromotionBaselineImportPolicy,
  type ReceiptTrustAnchorDirectoryQuorumPromotionBaselineImportPolicyReview,
  type ReceiptTrustAnchorDirectoryQuorumPromotionReceipt,
  type ReceiptTrustAnchorDirectorySubscription,
  type ReceiptTrustAnchorDirectorySubscriptionRefreshResult,
  type ReceiptTrustAnchorDirectoryVerification,
  type ReceiptTrustAnchorDirectoryVerificationPolicy,
  type RemoveEvaluationCaseRequest,
  type ReplanExecutionPlanRequest,
  type ResolveEvaluationConsensusRequest,
  type ResolveEvaluationConsensusResult,
  type RetireExecutionPlanBlueprintRecommendationPolicyOverrideRequest,
  type RetireExecutionPlanBlueprintRecommendationPolicyOverrideResult,
  type ReviewExtensionRequest,
  type ReviewMcpToolRequest,
  type ReviewMemoryRequest,
  type ReviewRunEvaluationRequest,
  type RunControlMessage,
  type RunControlMessageMode,
  type RunEvaluationRecord,
  type RunEvent,
  type RunExecutionMode,
  type RunInvocationSource,
  type RunLeaseHandle,
  type RunRecord,
  type RunStatus,
  type SaveExecutionPlanBlueprintRequest,
  type SaveExecutionPlanBlueprintResult,
  type ScheduleClaim,
  type SelectExecutionPlanBlueprintRecordRequest,
  type SetExecutionPlanBlueprintRecommendationPolicyOverrideRequest,
  type SetExecutionPlanBlueprintRecordStatusRequest,
  type SignedExtensionPackageChannelIndexEnvelope,
  type SignedExtensionPackageEnvelope,
  type SignedInspectorPackageEnvelope,
  type SignedPromptPackageEnvelope,
  type SignedSkillPackageEnvelope,
  type SignExtensionPackageChannelIndexRequest,
  type SignExtensionPackageRequest,
  type SignInspectorPackageRequest,
  type SignPromptPackageRequest,
  type SignReceiptTrustAnchorDirectoryQuorumActivationDecisionResult,
  type SignSkillPackageRequest,
  type SkillContentReview,
  type SkillPackageInstallation,
  type SkillPackageQualification,
  type SkillPackageVerification,
  type StorePersistenceMetrics,
  type SubagentTask,
  type SubmitEvaluationReviewerBallotRequest,
  type ThreadDetail,
  type ThreadImportProvenance,
  type ThreadRecord,
  type ThreadReplayBundle,
  type ThreadStatus,
  type ThreadSummary,
  type TrustedReceiptEnvelope,
  type UpdateAgentProfileRequest,
  type UpdateArtifactManifestRequest,
  type UpdateAutomationScheduleRequest,
  type UpdateEvaluationCasebookRequest,
  type UpdateEvaluationSuiteRequest,
  type UpdateInboundSignaturePolicyRequest,
  type UpdateReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionRequest,
  type UpdateReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionRequest,
  type UpdateReceiptTrustAnchorDirectorySubscriptionRequest,
  type VerifyExecutionPlanBlueprintRecordReplayEventRequest,
  type VerifyExtensionPackageChannelIndexRequest,
  type VerifyInspectorPackageRequest,
  type VerifyPromptPackageRequest,
  type VerifySkillPackageRequest,
  type WorkspaceSummary,
} from "@napier/contracts";
import type { AgentCapabilityPresetId } from "@napier/contracts/agent-capabilities";
import type {
  RestoreRecommendedCapabilitiesRequestV1,
  UpgradeRecommendedCapabilitiesRequestV1,
} from "@napier/contracts/agent-capability-contract";
import {
  compatibilityCheckpointRequired,
  StoreCompatibilityProjectionWriter,
} from "./store-compatibility-projections.js";
import { recordCompatibilityHit } from "./compatibility-telemetry.js";
import { assertArtifactReceiptEventBoundary } from "./artifact-receipts.js";
import { persistStoreMutation } from "./store-persistence.js";
import {
  replayThreadSummaryTails,
  threadMessagePreview,
} from "./store-thread-summary-projection.js";
import { loadThreadDetail } from "./thread-detail.js";
import {
  createThreadRecord,
  findThread,
  sortedThreads,
  threadRuns,
} from "./thread-records.js";
import {
  isDefaultThreadTitle,
  migrateDefaultThreadTitles,
} from "./thread-title.js";
import { mutateThreadTrash, visibleThreads } from "./thread-trash.js";
import { createWorkspaceSeed } from "./workspace-seed.js";

import {
  createSeededCapabilityBinding,
  type CapabilityBindingLookup,
} from "./agent-capability-bindings.js";
import { assertOperatorDecisionCapabilityContinuation } from "./agent-capability-override.js";
import {
  commitRecommendedCapabilitiesState,
  type CapabilityCommitOperation,
  type CapabilityRestoreCommit,
} from "./agent-capability-store-mutations.js";
import {
  rolledBackAgentCapabilityBinding,
  storedAgentCapabilityBinding,
  updatedAgentCapabilityBinding,
} from "./agent-capability-store-state.js";
import {
  AGENT_MESSAGE_EXPERIMENT_EXECUTION,
  type AgentMessageExperimentExecution,
} from "./agent-message-experiment-execution.js";
import { validateAgentMessageExperimentToolResultRunGate } from "./agent-message-experiment-run-gate.js";
import {
  changedAgentFields,
  createAgentProfileRevision,
  DEFAULT_RUN_LIMITS,
  normalizeRunLimits,
  rollbackAgentProfile,
  updateAgentProfile,
} from "./agents.js";
import { AutomaticRecoveryRepository } from "./automatic-recovery-repository.js";
import { AutomationScheduleRepository } from "./automation-schedule-repository.js";
import {
  createCredentialReference as createCredentialReferenceRecord,
  credentialSourceKey,
  recordCredentialAvailability,
  setCredentialReferenceStatus,
} from "./credential-references.js";
import { EvaluationCasebookRepository } from "./evaluation-casebook-repository.js";
import { assertRunEvaluationCompletedEventBindings } from "./evaluation-governance.js";
import { EvaluationReviewRepository } from "./evaluation-review-repository.js";
import { EvaluationSuiteRepository } from "./evaluation-suite-repository.js";
import { ExtensionDistributionRepository } from "./extension-distribution-repository.js";
import { ExtensionRecordRepository } from "./extension-record-repository.js";
import { type DiscoveredMcpTool } from "./extensions.js";
import { createId, nowIso } from "./ids.js";
import { InboundChannelRepository } from "./inbound-channel-repository.js";
import { InboundDeliveryRepository } from "./inbound-delivery-repository.js";
import { resolveStoredRunCapabilityProfile } from "./internal-research-recovery-authorization.js";
import { MemoryRepository } from "./memory-repository.js";
import {
  MODEL_INVOCATION_EXPERIMENT_EXECUTION,
  type ModelInvocationExperimentExecution,
} from "./model-invocation-experiment-execution.js";
import { validateModelInvocationExperimentRunGate } from "./model-invocation-experiment-run-gate.js";
import { projectOperatorDecisions } from "./operator-decisions.js";
import { PlanBlueprintOutcomeRepository } from "./plan-blueprint-outcome-repository.js";
import { PlanBlueprintPolicyRepository } from "./plan-blueprint-policy-repository.js";
import { type ExecutionPlanBlueprintPortfolioCalibrationEntry } from "./plan-blueprint-portfolio-model.js";
import { PlanBlueprintRepository } from "./plan-blueprint-repository.js";
import { PlanLifecycleRepository } from "./plan-lifecycle-repository.js";
import {
  assertPlanArtifactEventBindings,
  type InternalPlanStepRequest,
} from "./plans.js";
import { ReceiptTrustActivationRepository } from "./receipt-trust-activation-repository.js";
import { ReceiptTrustAnchorRepository } from "./receipt-trust-anchor-repository.js";
import { ReceiptTrustApprovalApplyRepository } from "./receipt-trust-approval-apply-repository.js";
import { ReceiptTrustCheckpointBaselineRepository } from "./receipt-trust-checkpoint-baseline-repository.js";
import { ReceiptTrustCheckpointSubscriptionRepository } from "./receipt-trust-checkpoint-subscription-repository.js";
import { ReceiptTrustDirectorySubscriptionRepository } from "./receipt-trust-directory-subscription-repository.js";
import {
  type ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalApprovalApplyClaim,
  type ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalApprovalPolicyApplyClaim,
  type ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionClaim,
  type ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionClaim,
  type ReceiptTrustAnchorDirectorySubscriptionClaim,
} from "./receipt-trust-directory-subscriptions.js";
import { ReceiptTrustRotationSubscriptionRepository } from "./receipt-trust-rotation-subscription-repository.js";
import { NAPIER_RELEASE_IDENTITY_SHA256 } from "./release-product-identity-policy.js";
import {
  createRunConfigurationFingerprint,
  type PromptVariableFingerprintInput,
} from "./run-config.js";
import type {
  QueueRunControlMessageInput,
  RunControlMessageDelivery,
} from "./run-control-repository.js";
import { RunControlRepository } from "./run-control-repository.js";
import {
  resolveCompatibilityEventInput,
  resolveExtensionEventInput,
  resolveRegisteredEventInput,
  type AppendCompatibilityEventInput,
  type AppendEventInput,
  type AppendExtensionEventInput,
  type ResolvedRunEventInput,
} from "./run-event-registry.js";
import {
  appendRegisteredEventsToThread,
  appendResolvedRunEvent,
} from "./run-event-writer.js";
import {
  createRunLeaseBinding,
  renewNormalizedRunLease,
  validateRunLeaseTtl,
  type RunLeaseOptions,
} from "./run-lease-renewal.js";
import { applyNormalizedRunLeases } from "./run-lease-state.js";
import { RunLifecycleRepository } from "./run-lifecycle-repository.js";
import { initialRunStatus } from "./run-state-machine.js";
import { SignedPackageRepository } from "./signed-package-repository.js";
import {
  ConcurrentRunLeaseUpdateError,
  ConcurrentStoreUpdateError,
  LEDGER_DATABASE_FILENAME,
  SqliteLedger,
  type LedgerSchemaReport,
} from "./sqlite-ledger.js";
import { storeSha256 as sha256 } from "./store-hashing.js";
import { StorePersistenceMonitor } from "./store-observability.js";
import type { ChannelDeliveryExecution } from "./store-port.js";
import { validatePersistedStoreState } from "./store-state-validation.js";
import { EMPTY_STORE_STATE, type PersistedStoreState } from "./store-state.js";
import {
  SubagentRepository,
  type CreateSubagentTaskInput,
  type FinishSubagentTaskInput,
} from "./subagent-repository.js";
import { validateThreadImportProvenanceLedgerReceipt } from "./thread-import-provenance-validation.js";
import type {
  AgentMilestoneMutation,
  OperatorDecisionMutation,
  RecordAgentMilestoneStoreInput,
  RequestOperatorDecisionStoreInput,
} from "./thread-interaction-repository.js";
import { ThreadInteractionRepository } from "./thread-interaction-repository.js";
import { ThreadReplayImportRepository } from "./thread-replay-import-repository.js";
import {
  TOOL_INVOCATION_EXPERIMENT_EXECUTION,
  type ToolInvocationExperimentExecution,
} from "./tool-invocation-experiment-execution.js";
import { validateToolInvocationExperimentRunGate } from "./tool-invocation-experiment-run-gate.js";
import {
  WORKFLOW_NODE_EXECUTION,
  type WorkflowNodeExecution,
} from "./workflow-node-execution.js";
import {
  isWorkflowReadOnlyChildExecutionMode,
  validateWorkflowReadOnlyChildRunGate,
} from "./workflow-read-only-child-run-gate.js";
import {
  WORKFLOW_SIMULATION_EXECUTION,
  type WorkflowSimulationExecution,
} from "./workflow-simulation-execution.js";
import { validateWorkflowSimulationRunGate } from "./workflow-simulation-run-gate.js";
export {
  DEFAULT_INBOUND_CHANNEL_ADAPTER,
  DEFAULT_INBOUND_RETRY_POLICY,
  DEFAULT_INBOUND_SIGNATURE_POLICY,
} from "./inbound-channel-policy.js";
export type * from "./run-event-registry.js";
export type { RunLeaseOptions } from "./run-lease-renewal.js";
const MAX_CONCURRENT_WORKFLOW_RUNS_PER_THREAD = 4;
type PersistedRunRecord = PersistedStoreState["runs"][number];
type PersistedAutomationSchedule = PersistedStoreState["schedules"][number];
type PersistedInboundChannel = PersistedStoreState["channels"][number];
type PersistedInboundDelivery =
  PersistedStoreState["inboundDeliveries"][number];
type PersistedState = PersistedStoreState;

export type {
  QueueRunControlMessageInput,
  RunControlMessageDelivery,
} from "./run-control-repository.js";
export type {
  AgentMilestoneMutation,
  OperatorDecisionMutation,
  RecordAgentMilestoneStoreInput,
  RequestOperatorDecisionStoreInput,
} from "./thread-interaction-repository.js";

export interface CreateRunInput {
  threadId: string;
  agentId: string;
  model?: AgentProfile["model"];
  agentRevision?: number;
  capabilityPreset?: AgentCapabilityPresetId;
  executionMode?: RunExecutionMode;
  skillCatalogSha256?: string;
  promptVariables?: PromptVariableFingerprintInput;
  parentRunId?: string;
  operatorDecisionId?: string;
  branchFromSeq?: number;
  source?: RunInvocationSource;
  triggerId?: string;
  [WORKFLOW_NODE_EXECUTION]?: WorkflowNodeExecution;
  [WORKFLOW_SIMULATION_EXECUTION]?: WorkflowSimulationExecution;
  [AGENT_MESSAGE_EXPERIMENT_EXECUTION]?: AgentMessageExperimentExecution;
  [MODEL_INVOCATION_EXPERIMENT_EXECUTION]?: ModelInvocationExperimentExecution;
  [TOOL_INVOCATION_EXPERIMENT_EXECUTION]?: ToolInvocationExperimentExecution;
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

export type InboundExecution = ChannelDeliveryExecution;

const EMPTY_STATE: PersistedState = EMPTY_STORE_STATE;

export type { CreateSubagentTaskInput } from "./subagent-store-records.js";

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
            (!(error instanceof ConcurrentStoreUpdateError) &&
              !(error instanceof ConcurrentRunLeaseUpdateError)) ||
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
  private readonly compatibilityProjections: StoreCompatibilityProjectionWriter;
  private ledger: SqliteLedger | undefined;
  private state: PersistedState = structuredClone(EMPTY_STATE);
  private stateRevision = 0;
  private initialized = false;
  readonly subagentRepository: SubagentRepository;
  readonly threadInteractionRepository: ThreadInteractionRepository;
  readonly runControlRepository: RunControlRepository;
  readonly runLifecycleRepository: RunLifecycleRepository;
  readonly threadReplayImportRepository: ThreadReplayImportRepository;
  readonly planBlueprintRepository: PlanBlueprintRepository;
  readonly planBlueprintOutcomeRepository: PlanBlueprintOutcomeRepository;
  readonly planBlueprintPolicyRepository: PlanBlueprintPolicyRepository;
  readonly planLifecycleRepository: PlanLifecycleRepository;
  readonly automaticRecoveryRepository: AutomaticRecoveryRepository;
  readonly receiptTrustAnchorRepository: ReceiptTrustAnchorRepository;
  readonly receiptTrustActivationRepository: ReceiptTrustActivationRepository;
  readonly receiptTrustDirectorySubscriptionRepository: ReceiptTrustDirectorySubscriptionRepository;
  readonly receiptTrustRotationSubscriptionRepository: ReceiptTrustRotationSubscriptionRepository;
  readonly receiptTrustApprovalApplyRepository: ReceiptTrustApprovalApplyRepository;
  readonly receiptTrustCheckpointBaselineRepository: ReceiptTrustCheckpointBaselineRepository;
  readonly receiptTrustCheckpointSubscriptionRepository: ReceiptTrustCheckpointSubscriptionRepository;
  readonly automationScheduleRepository: AutomationScheduleRepository;
  readonly inboundChannelRepository: InboundChannelRepository;
  readonly inboundDeliveryRepository: InboundDeliveryRepository;
  readonly evaluationReviewRepository: EvaluationReviewRepository;
  readonly evaluationCasebookRepository: EvaluationCasebookRepository;
  readonly evaluationSuiteRepository: EvaluationSuiteRepository;
  readonly extensionRecordRepository: ExtensionRecordRepository;
  readonly signedPackageRepository: SignedPackageRepository;
  readonly extensionDistributionRepository: ExtensionDistributionRepository;
  readonly memoryRepository: MemoryRepository;

  constructor(options: LocalStoreOptions) {
    this.dataRoot = path.resolve(options.dataRoot);
    this.workspaceRoot = path.resolve(options.workspaceRoot);
    this.statePath = path.join(this.dataRoot, "workspace.json");
    this.eventsRoot = path.join(this.dataRoot, "events");
    this.databasePath = path.join(this.dataRoot, LEDGER_DATABASE_FILENAME);
    this.stateQueue = new SerialQueue(() => this.refreshStateFromLedger(), 4);
    this.subagentRepository = new SubagentRepository({
      assertReady: () => this.assertInitialized(),
      read: () => this.state,
      mutate: (operation) =>
        this.stateQueue.run(async () => {
          const mutation = operation(this.state);
          if (mutation.changed) await this.persistState();
          return mutation.value;
        }),
    });
    this.memoryRepository = new MemoryRepository({
      assertReady: () => this.assertInitialized(),
      read: () => this.state,
      mutate: (operation) =>
        this.stateQueue.run(async () => {
          const mutation = operation(this.state);
          if (mutation.changed) await this.persistState();
          return mutation.value;
        }),
    });
    const repositoryHost =
      this as unknown as import("./store-repository-host.js").StoreRepositoryHost;
    this.automationScheduleRepository = new AutomationScheduleRepository(
      repositoryHost,
    );
    this.inboundChannelRepository = new InboundChannelRepository(
      repositoryHost,
    );
    this.inboundDeliveryRepository = new InboundDeliveryRepository(
      repositoryHost,
    );
    this.evaluationReviewRepository = new EvaluationReviewRepository(
      repositoryHost,
    );
    this.evaluationCasebookRepository = new EvaluationCasebookRepository(
      repositoryHost,
    );
    this.evaluationSuiteRepository = new EvaluationSuiteRepository(
      repositoryHost,
    );
    this.extensionRecordRepository = new ExtensionRecordRepository(
      repositoryHost,
    );
    this.signedPackageRepository = new SignedPackageRepository(repositoryHost);
    this.extensionDistributionRepository = new ExtensionDistributionRepository(
      repositoryHost,
    );
    this.receiptTrustAnchorRepository = new ReceiptTrustAnchorRepository(
      repositoryHost,
    );
    this.receiptTrustActivationRepository =
      new ReceiptTrustActivationRepository(repositoryHost);
    this.receiptTrustDirectorySubscriptionRepository =
      new ReceiptTrustDirectorySubscriptionRepository(repositoryHost);
    this.receiptTrustRotationSubscriptionRepository =
      new ReceiptTrustRotationSubscriptionRepository(repositoryHost);
    this.receiptTrustApprovalApplyRepository =
      new ReceiptTrustApprovalApplyRepository(repositoryHost);
    this.receiptTrustCheckpointBaselineRepository =
      new ReceiptTrustCheckpointBaselineRepository(repositoryHost);
    this.receiptTrustCheckpointSubscriptionRepository =
      new ReceiptTrustCheckpointSubscriptionRepository(repositoryHost);
    this.automaticRecoveryRepository = new AutomaticRecoveryRepository(
      repositoryHost,
    );
    this.planBlueprintRepository = new PlanBlueprintRepository(repositoryHost);
    this.planBlueprintOutcomeRepository = new PlanBlueprintOutcomeRepository(
      repositoryHost,
    );
    this.planBlueprintPolicyRepository = new PlanBlueprintPolicyRepository(
      repositoryHost,
    );
    this.planLifecycleRepository = new PlanLifecycleRepository(repositoryHost);
    this.threadReplayImportRepository = new ThreadReplayImportRepository(
      repositoryHost,
    );
    this.threadInteractionRepository = new ThreadInteractionRepository(
      repositoryHost,
    );
    this.runControlRepository = new RunControlRepository(repositoryHost);
    this.runLifecycleRepository = new RunLifecycleRepository(repositoryHost);
    this.compatibilityProjections = new StoreCompatibilityProjectionWriter(
      this.statePath,
      this.eventsRoot,
      (threadId, afterSeq) =>
        this.requireLedger().listEvents(threadId, afterSeq),
    );
  }

  async initialize(interruptActiveRuns = false): Promise<void> {
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
          this.restoreSnapshot(imported); recordCompatibilityHit("compat.store.legacy_json_read"); restored = true;
          await this.compatibilityProjections.writeAll(
            imported.stateJson,
            this.state.threads.map((thread) => thread.id),
          );
        } catch (error) {
          if (!isMissingFileError(error)) throw error;
          this.state = structuredClone(EMPTY_STATE);
          await this.seedWorkspace();
        }
      }
      this.validateLedgerConsistency();
      requiresStateMigration ||= migrateDefaultThreadTitles(
        this.state.threads,
        (threadId) => this.requireLedger().listEvents(threadId),
      );
      if (requiresStateMigration) {
        await this.stateQueue.run(() => this.persistState());
      }
      this.initialized = true;
      if (restored) await this.reconcileInterruptedRuns(interruptActiveRuns);
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

  async shutdown(): Promise<void> {
    try {
      await this.flushCompatibilityProjections();
    } finally {
      this.close();
    }
  }

  async flushCompatibilityProjections(): Promise<void> {
    this.assertInitialized();
    await this.stateQueue.run(() =>
      this.compatibilityProjections.flush(
        JSON.stringify(this.state, null, 2),
        this.state.threads.map((thread) => thread.id),
      ),
    );
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

  getAgentCapabilityBinding(
    agentId: string,
    revision: number,
  ): CapabilityBindingLookup {
    this.assertInitialized();
    this.getAgent(agentId);
    return storedAgentCapabilityBinding(this.state, agentId, revision);
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
      const binding = updatedAgentCapabilityBinding(
        this.state,
        current,
        updated,
      );
      this.state.agents[index] = updated;
      if (updated.revision !== current.revision) {
        this.state.agentRevisions.push(
          createAgentProfileRevision(updated, {
            source: "updated",
            changedFields: changedAgentFields(current, updated),
          }),
        );
        if (binding) this.state.agentCapabilityBindings.push(binding);
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
      const binding = rolledBackAgentCapabilityBinding(
        this.state,
        target,
        agent,
      );
      if (binding) this.state.agentCapabilityBindings.push(binding);
      await this.persistState();
      return structuredClone({ agent, revision });
    });
  }

  async restoreRecommendedAgentCapabilities(
    agentId: string,
    request:
      | RestoreRecommendedCapabilitiesRequestV1
      | UpgradeRecommendedCapabilitiesRequestV1,
    operation: CapabilityCommitOperation = "restore",
  ): Promise<CapabilityRestoreCommit> {
    this.assertInitialized();
    return this.stateQueue.run(() =>
      commitRecommendedCapabilitiesState({
        state: this.state,
        agentId,
        request,
        operation,
        persist: () => this.persistState(),
        isConflict: (error) => error instanceof ConcurrentStoreUpdateError,
      }),
    );
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
    return this.receiptTrustAnchorRepository.listReceiptTrustAnchors();
  }

  getReceiptTrustAnchorDirectory(): ReceiptTrustAnchorDirectory {
    return this.receiptTrustAnchorRepository.getReceiptTrustAnchorDirectory();
  }

  verifyReceiptTrustAnchorDirectory(
    input: unknown,
    policy?: ReceiptTrustAnchorDirectoryVerificationPolicy,
  ): ReceiptTrustAnchorDirectoryVerification {
    return this.receiptTrustAnchorRepository.verifyReceiptTrustAnchorDirectory(
      input,
      policy,
    );
  }

  getReceiptTrustAnchor(anchorId: string): ReceiptTrustAnchor {
    return this.receiptTrustAnchorRepository.getReceiptTrustAnchor(anchorId);
  }

  async createReceiptTrustAnchor(
    request: CreateReceiptTrustAnchorRequest,
  ): Promise<ReceiptTrustAnchor> {
    return this.receiptTrustAnchorRepository.createReceiptTrustAnchor(request);
  }

  async revokeReceiptTrustAnchor(
    anchorId: string,
  ): Promise<ReceiptTrustAnchor> {
    return this.receiptTrustAnchorRepository.revokeReceiptTrustAnchor(anchorId);
  }

  listReceiptTrustAnchorDirectorySubscriptions(): ReceiptTrustAnchorDirectorySubscription[] {
    return this.receiptTrustAnchorRepository.listReceiptTrustAnchorDirectorySubscriptions();
  }

  getReceiptTrustAnchorDirectorySubscription(
    subscriptionId: string,
  ): ReceiptTrustAnchorDirectorySubscription {
    return this.receiptTrustAnchorRepository.getReceiptTrustAnchorDirectorySubscription(
      subscriptionId,
    );
  }

  getReceiptTrustAnchorDirectorySubscriptionQuorum(
    policy?: ReceiptTrustAnchorDirectoryQuorumPolicy,
    metadataEvidence?: ReceiptTrustAnchorDirectoryQuorumMetadataEvidence[],
  ): ReceiptTrustAnchorDirectoryQuorum {
    return this.receiptTrustAnchorRepository.getReceiptTrustAnchorDirectorySubscriptionQuorum(
      policy,
      metadataEvidence,
    );
  }

  listReceiptTrustAnchorDirectoryQuorumPromotionBaselines(): ReceiptTrustAnchorDirectoryQuorumPromotionBaseline[] {
    return this.receiptTrustAnchorRepository.listReceiptTrustAnchorDirectoryQuorumPromotionBaselines();
  }

  async promoteReceiptTrustAnchorDirectoryQuorumPromotionBaseline(
    promotedByThreadId: string,
    envelope: TrustedReceiptEnvelope<ReceiptTrustAnchorDirectoryQuorumPromotionReceipt>,
  ): Promise<PromoteReceiptTrustAnchorDirectoryQuorumBaselineResult> {
    return this.receiptTrustAnchorRepository.promoteReceiptTrustAnchorDirectoryQuorumPromotionBaseline(
      promotedByThreadId,
      envelope,
    );
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
    return this.receiptTrustAnchorRepository.importReceiptTrustAnchorDirectoryQuorumPromotionBaseline(
      importedByThreadId,
      baselineInput,
      expectedCurrentBaselineSha256,
      trustedAnchors,
      importPolicy,
    );
  }

  listReceiptTrustAnchorDirectoryQuorumActivationDecisionRecords(): ReceiptTrustAnchorDirectoryQuorumActivationDecisionRecord[] {
    return this.receiptTrustActivationRepository.listReceiptTrustAnchorDirectoryQuorumActivationDecisionRecords();
  }

  getReceiptTrustAnchorDirectoryQuorumActivationDecisionHistory(): ReceiptTrustAnchorDirectoryQuorumActivationDecisionHistory {
    return this.receiptTrustActivationRepository.getReceiptTrustAnchorDirectoryQuorumActivationDecisionHistory();
  }

  verifyReceiptTrustAnchorDirectoryQuorumActivationDecisionHistory(
    value: unknown,
  ): ReceiptTrustAnchorDirectoryQuorumActivationDecisionHistoryVerification {
    return this.receiptTrustActivationRepository.verifyReceiptTrustAnchorDirectoryQuorumActivationDecisionHistory(
      value,
    );
  }

  getReceiptTrustAnchorDirectoryQuorumActivationSelectionState(): ReceiptTrustAnchorDirectoryQuorumActivationSelectionState {
    return this.receiptTrustActivationRepository.getReceiptTrustAnchorDirectoryQuorumActivationSelectionState();
  }

  getReceiptTrustAnchorDirectoryQuorumActivationSelectionBySha256(
    selectionSha256: string,
  ): ReceiptTrustAnchorDirectoryQuorumActivationSelection | undefined {
    return this.receiptTrustActivationRepository.getReceiptTrustAnchorDirectoryQuorumActivationSelectionBySha256(
      selectionSha256,
    );
  }

  getReceiptTrustAnchorDirectoryQuorumActivationSelectionDriftAudit(): ReceiptTrustAnchorDirectoryQuorumActivationSelectionDriftAudit {
    return this.receiptTrustActivationRepository.getReceiptTrustAnchorDirectoryQuorumActivationSelectionDriftAudit();
  }

  getReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpoint(): ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpoint {
    return this.receiptTrustActivationRepository.getReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpoint();
  }

  verifyReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpoint(
    value: unknown,
  ): ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointVerification {
    return this.receiptTrustActivationRepository.verifyReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpoint(
      value,
    );
  }

  reviewReceiptTrustAnchorDirectoryQuorumActivationSelectionRotation(
    activationDecisionRecordId: string,
    expectedCurrentSelectionSha256: string,
    checkpointRegistryQuorumPolicy?: ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumPolicy,
  ): ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationReview {
    return this.receiptTrustActivationRepository.reviewReceiptTrustAnchorDirectoryQuorumActivationSelectionRotation(
      activationDecisionRecordId,
      expectedCurrentSelectionSha256,
      checkpointRegistryQuorumPolicy,
    );
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
    return this.receiptTrustActivationRepository.proposeReceiptTrustAnchorDirectoryQuorumActivationSelectionRotation(
      activationDecisionRecordId,
      expectedCurrentSelectionSha256,
      options,
    );
  }

  async applyReceiptTrustAnchorDirectoryQuorumActivationSelection(
    threadId: string,
    activationDecisionRecordId: string,
    expectedCurrentSelectionSha256: string,
  ): Promise<ApplyReceiptTrustAnchorDirectoryQuorumActivationSelectionResult> {
    return this.receiptTrustActivationRepository.applyReceiptTrustAnchorDirectoryQuorumActivationSelection(
      threadId,
      activationDecisionRecordId,
      expectedCurrentSelectionSha256,
    );
  }

  async recordReceiptTrustAnchorDirectoryQuorumActivationDecision(
    signedByThreadId: string,
    result: SignReceiptTrustAnchorDirectoryQuorumActivationDecisionResult,
  ): Promise<ReceiptTrustAnchorDirectoryQuorumActivationDecisionRecord> {
    return this.receiptTrustActivationRepository.recordReceiptTrustAnchorDirectoryQuorumActivationDecision(
      signedByThreadId,
      result,
    );
  }

  async createReceiptTrustAnchorDirectorySubscription(
    request: CreateReceiptTrustAnchorDirectorySubscriptionRequest,
    discovery: ReceiptTrustAnchorDirectoryDiscovery,
  ): Promise<ReceiptTrustAnchorDirectorySubscription> {
    return this.receiptTrustDirectorySubscriptionRepository.createReceiptTrustAnchorDirectorySubscription(
      request,
      discovery,
    );
  }

  async updateReceiptTrustAnchorDirectorySubscription(
    subscriptionId: string,
    request: UpdateReceiptTrustAnchorDirectorySubscriptionRequest,
  ): Promise<ReceiptTrustAnchorDirectorySubscription> {
    return this.receiptTrustDirectorySubscriptionRepository.updateReceiptTrustAnchorDirectorySubscription(
      subscriptionId,
      request,
    );
  }

  async claimReceiptTrustAnchorDirectorySubscription(
    subscriptionId: string,
    expectedRevision: number,
    ownerId: string,
    options: { now?: Date; leaseMs?: number } = {},
  ): Promise<ReceiptTrustAnchorDirectorySubscriptionClaim> {
    return this.receiptTrustDirectorySubscriptionRepository.claimReceiptTrustAnchorDirectorySubscription(
      subscriptionId,
      expectedRevision,
      ownerId,
      options,
    );
  }

  async claimDueReceiptTrustAnchorDirectorySubscriptions(
    ownerId: string,
    options: {
      now?: Date;
      leaseMs?: number;
      limit?: number;
    } = {},
  ): Promise<DueReceiptTrustAnchorDirectorySubscriptionClaims> {
    return this.receiptTrustDirectorySubscriptionRepository.claimDueReceiptTrustAnchorDirectorySubscriptions(
      ownerId,
      options,
    );
  }

  async settleReceiptTrustAnchorDirectorySubscriptionClaim(
    subscriptionId: string,
    token: string,
    outcome:
      | { discovery: ReceiptTrustAnchorDirectoryDiscovery }
      | { failureSha256: string },
  ): Promise<ReceiptTrustAnchorDirectorySubscriptionRefreshResult> {
    return this.receiptTrustDirectorySubscriptionRepository.settleReceiptTrustAnchorDirectorySubscriptionClaim(
      subscriptionId,
      token,
      outcome,
    );
  }

  listReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptions(): ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription[] {
    return this.receiptTrustCheckpointSubscriptionRepository.listReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptions();
  }

  getReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription(
    subscriptionId: string,
  ): ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription {
    return this.receiptTrustCheckpointSubscriptionRepository.getReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription(
      subscriptionId,
    );
  }

  listReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptions(): ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription[] {
    return this.receiptTrustRotationSubscriptionRepository.listReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptions();
  }

  getReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription(
    subscriptionId: string,
  ): ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription {
    return this.receiptTrustRotationSubscriptionRepository.getReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription(
      subscriptionId,
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
    return this.receiptTrustRotationSubscriptionRepository.getReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionRefreshSource(
      subscriptionId,
      threadId,
      expectedRevision,
    );
  }

  async createReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription(
    request: CreateReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionRequest,
    discovery: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalDiscovery,
  ): Promise<ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription> {
    return this.receiptTrustRotationSubscriptionRepository.createReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription(
      request,
      discovery,
    );
  }

  async updateReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription(
    subscriptionId: string,
    request: UpdateReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionRequest,
  ): Promise<ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription> {
    return this.receiptTrustRotationSubscriptionRepository.updateReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription(
      subscriptionId,
      request,
    );
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
    return this.receiptTrustRotationSubscriptionRepository.refreshReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription(
      subscriptionId,
      threadId,
      expectedRevision,
      outcome,
    );
  }

  async claimReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription(
    subscriptionId: string,
    expectedRevision: number,
    ownerId: string,
    options: { now?: Date; leaseMs?: number } = {},
  ): Promise<ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionClaim> {
    return this.receiptTrustRotationSubscriptionRepository.claimReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription(
      subscriptionId,
      expectedRevision,
      ownerId,
      options,
    );
  }

  async claimDueReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptions(
    ownerId: string,
    options: {
      now?: Date;
      leaseMs?: number;
      limit?: number;
    } = {},
  ): Promise<DueReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionClaims> {
    return this.receiptTrustRotationSubscriptionRepository.claimDueReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptions(
      ownerId,
      options,
    );
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
    return this.receiptTrustRotationSubscriptionRepository.settleReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionClaim(
      subscriptionId,
      token,
      outcome,
    );
  }

  async queueReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalApprovalApply(
    subscriptionId: string,
    threadId: string,
    expectedRevision: number,
    expectedSubscriptionSha256: string,
    approvalEnvelope: TrustedReceiptEnvelope<ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApproval>,
    applyAfter = new Date().toISOString(),
  ): Promise<ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription> {
    return this.receiptTrustApprovalApplyRepository.queueReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalApprovalApply(
      subscriptionId,
      threadId,
      expectedRevision,
      expectedSubscriptionSha256,
      approvalEnvelope,
      applyAfter,
    );
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
    return this.receiptTrustApprovalApplyRepository.queueReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalApprovalPolicyApply(
      subscriptionId,
      threadId,
      expectedRevision,
      expectedSubscriptionSha256,
      approvalEnvelopes,
      approvalPolicyInput,
      approvalPolicyBaselineSha256,
      applyAfter,
    );
  }

  async claimDueReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalApprovalApplies(
    ownerId: string,
    options: {
      now?: Date;
      leaseMs?: number;
      limit?: number;
    } = {},
  ): Promise<DueReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalApprovalApplyClaims> {
    return this.receiptTrustApprovalApplyRepository.claimDueReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalApprovalApplies(
      ownerId,
      options,
    );
  }

  async settleReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalApprovalApplyClaim(
    subscriptionId: string,
    token: string,
    outcome: { resultSha256: string } | { failureSha256: string },
  ): Promise<ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription> {
    return this.receiptTrustApprovalApplyRepository.settleReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalApprovalApplyClaim(
      subscriptionId,
      token,
      outcome,
    );
  }

  async claimDueReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalApprovalPolicyApplies(
    ownerId: string,
    options: {
      now?: Date;
      leaseMs?: number;
      limit?: number;
    } = {},
  ): Promise<DueReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalApprovalPolicyApplyClaims> {
    return this.receiptTrustApprovalApplyRepository.claimDueReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalApprovalPolicyApplies(
      ownerId,
      options,
    );
  }

  async settleReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalApprovalPolicyApplyClaim(
    subscriptionId: string,
    token: string,
    outcome: { resultSha256: string } | { failureSha256: string },
  ): Promise<ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription> {
    return this.receiptTrustApprovalApplyRepository.settleReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalApprovalPolicyApplyClaim(
      subscriptionId,
      token,
      outcome,
    );
  }

  getReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorum(
    policy?: ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumPolicy,
  ): ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorum {
    return this.receiptTrustCheckpointBaselineRepository.getReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorum(
      policy,
    );
  }

  listReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselines(): ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaseline[] {
    return this.receiptTrustCheckpointBaselineRepository.listReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselines();
  }

  async promoteReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaseline(
    promotedByThreadId: string,
    envelope: TrustedReceiptEnvelope<ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorum>,
  ): Promise<PromoteReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselineResult> {
    return this.receiptTrustCheckpointBaselineRepository.promoteReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaseline(
      promotedByThreadId,
      envelope,
    );
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
    return this.receiptTrustCheckpointBaselineRepository.importReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaseline(
      importedByThreadId,
      baselineInput,
      expectedCurrentBaselineSha256,
      trustedAnchors,
    );
  }

  listReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaselines(): ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaseline[] {
    return this.receiptTrustCheckpointBaselineRepository.listReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaselines();
  }

  async promoteReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaseline(
    promotedByThreadId: string,
    envelope: TrustedReceiptEnvelope<ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyReview>,
  ): Promise<{
    baseline: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaseline;
    created: boolean;
  }> {
    return this.receiptTrustCheckpointBaselineRepository.promoteReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaseline(
      promotedByThreadId,
      envelope,
    );
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
    return this.receiptTrustCheckpointBaselineRepository.importReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaseline(
      importedByThreadId,
      baselineInput,
      expectedCurrentBaselineSha256,
      trustedAnchors,
    );
  }

  async createReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription(
    request: CreateReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionRequest,
    discovery: ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointDiscovery,
  ): Promise<ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription> {
    return this.receiptTrustCheckpointSubscriptionRepository.createReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription(
      request,
      discovery,
    );
  }

  async updateReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription(
    subscriptionId: string,
    request: UpdateReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionRequest,
  ): Promise<ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription> {
    return this.receiptTrustCheckpointSubscriptionRepository.updateReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription(
      subscriptionId,
      request,
    );
  }

  async claimReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription(
    subscriptionId: string,
    expectedRevision: number,
    ownerId: string,
    options: { now?: Date; leaseMs?: number } = {},
  ): Promise<ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionClaim> {
    return this.receiptTrustCheckpointSubscriptionRepository.claimReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription(
      subscriptionId,
      expectedRevision,
      ownerId,
      options,
    );
  }

  async claimDueReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptions(
    ownerId: string,
    options: {
      now?: Date;
      leaseMs?: number;
      limit?: number;
    } = {},
  ): Promise<DueReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionClaims> {
    return this.receiptTrustCheckpointSubscriptionRepository.claimDueReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptions(
      ownerId,
      options,
    );
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
    return this.receiptTrustCheckpointSubscriptionRepository.settleReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionClaim(
      subscriptionId,
      token,
      outcome,
    );
  }

  listSchedules(threadId?: string): AutomationSchedule[] {
    return this.automationScheduleRepository.listSchedules(threadId);
  }

  getSchedule(scheduleId: string): AutomationSchedule {
    return this.automationScheduleRepository.getSchedule(scheduleId);
  }

  async createSchedule(
    request: CreateAutomationScheduleRequest,
  ): Promise<AutomationSchedule> {
    return this.automationScheduleRepository.createSchedule(request);
  }

  async updateSchedule(
    scheduleId: string,
    request: UpdateAutomationScheduleRequest,
  ): Promise<AutomationSchedule> {
    return this.automationScheduleRepository.updateSchedule(
      scheduleId,
      request,
    );
  }

  async claimDueSchedules(
    ownerId: string,
    options: {
      now?: Date;
      leaseMs?: number;
      limit?: number;
    } = {},
  ): Promise<DueScheduleClaims> {
    return this.automationScheduleRepository.claimDueSchedules(
      ownerId,
      options,
    );
  }

  async renewScheduleClaim(
    scheduleId: string,
    token: string,
    ttlMs: number,
  ): Promise<AutomationSchedule> {
    return this.automationScheduleRepository.renewScheduleClaim(
      scheduleId,
      token,
      ttlMs,
    );
  }

  async settleScheduleClaim(
    scheduleId: string,
    token: string,
    input: SettleScheduleClaimInput,
  ): Promise<AutomationSchedule> {
    return this.automationScheduleRepository.settleScheduleClaim(
      scheduleId,
      token,
      input,
    );
  }

  listInboundChannels(): InboundChannel[] {
    return this.inboundChannelRepository.listInboundChannels();
  }

  getInboundChannel(channelId: string): InboundChannel {
    return this.inboundChannelRepository.getInboundChannel(channelId);
  }

  async createInboundChannel(
    request: CreateInboundChannelRequest,
  ): Promise<CreatedInboundChannel> {
    return this.inboundChannelRepository.createInboundChannel(request);
  }

  async setInboundChannelStatus(
    channelId: string,
    status: InboundChannel["status"],
  ): Promise<InboundChannel> {
    return this.inboundChannelRepository.setInboundChannelStatus(
      channelId,
      status,
    );
  }

  async updateInboundRetryPolicy(
    channelId: string,
    retryPolicy: InboundRetryPolicy,
  ): Promise<InboundChannel> {
    return this.inboundChannelRepository.updateInboundRetryPolicy(
      channelId,
      retryPolicy,
    );
  }

  async updateInboundSignaturePolicy(
    channelId: string,
    signaturePolicy: UpdateInboundSignaturePolicyRequest["signaturePolicy"],
  ): Promise<InboundChannel> {
    return this.inboundChannelRepository.updateInboundSignaturePolicy(
      channelId,
      signaturePolicy,
    );
  }

  async rotateInboundChannelToken(
    channelId: string,
  ): Promise<CreatedInboundChannel> {
    return this.inboundChannelRepository.rotateInboundChannelToken(channelId);
  }

  async acceptInboundDelivery(
    channelId: string,
    token: string,
    request: InboundMessageRequest,
  ): Promise<InboundReceipt> {
    return this.inboundChannelRepository.acceptInboundDelivery(
      channelId,
      token,
      request,
    );
  }

  listInboundDeliveries(channelId?: string): InboundDelivery[] {
    return this.inboundDeliveryRepository.listInboundDeliveries(channelId);
  }

  exportInboundDeadLetters(
    channelId: string,
    now = new Date(),
    currentAdapterCatalogSha256?: string,
  ): InboundDeadLetterExport {
    return this.inboundDeliveryRepository.exportInboundDeadLetters(
      channelId,
      now,
      currentAdapterCatalogSha256,
    );
  }

  async claimInboundDelivery(
    deliveryId: string,
    now = new Date(),
  ): Promise<InboundExecution | undefined> {
    return this.inboundDeliveryRepository.claimInboundDelivery(deliveryId, now);
  }

  async finishInboundDelivery(
    deliveryId: string,
    input:
      | { status: "completed"; runId: string }
      | { status: "failed"; error: string; runId?: string },
  ): Promise<InboundDelivery> {
    return this.inboundDeliveryRepository.finishInboundDelivery(
      deliveryId,
      input,
    );
  }

  async scheduleInboundDeliveryRetry(
    deliveryId: string,
    error: string,
    delayMs: number,
    now = new Date(),
  ): Promise<InboundDelivery> {
    return this.inboundDeliveryRepository.scheduleInboundDeliveryRetry(
      deliveryId,
      error,
      delayMs,
      now,
    );
  }

  async retryInboundDelivery(
    channelId: string,
    deliveryId: string,
    now = new Date(),
  ): Promise<InboundDelivery> {
    return this.inboundDeliveryRepository.retryInboundDelivery(
      channelId,
      deliveryId,
      now,
    );
  }

  listRunnableInboundDeliveryIds(now = new Date()): string[] {
    return this.inboundDeliveryRepository.listRunnableInboundDeliveryIds(now);
  }

  listThreads(): ThreadSummary[] {
    this.assertInitialized();
    return structuredClone(sortedThreads(this.state.threads));
  }

  listVisibleThreads(): ThreadSummary[] {
    this.assertInitialized();
    return structuredClone(
      visibleThreads(this.state.threads, (threadId) =>
        this.requireLedger().listEvents(threadId),
      ),
    );
  }

  getThread(threadId: string): ThreadRecord {
    this.assertInitialized();
    return structuredClone(findThread(this.state.threads, threadId));
  }

  async trashThread(threadId: string): Promise<ThreadRecord> {
    return this.setThreadTrashed(threadId, true);
  }

  async restoreThread(threadId: string): Promise<ThreadRecord> {
    return this.setThreadTrashed(threadId, false);
  }

  private async setThreadTrashed(
    threadId: string,
    trashed: boolean,
  ): Promise<ThreadRecord> {
    this.assertInitialized();
    return this.threadQueue(threadId).run(() =>
      this.stateQueue.run(async () => {
        const thread = this.mutableThread(threadId);
        return mutateThreadTrash({
          action: trashed ? "trash" : "restore",
          thread,
          runs: this.state.runs,
          events: this.requireLedger().listEvents(threadId),
          append: (input) => this.appendEventsToThread(thread, [input])[0]!,
          persist: (event) => this.persistState(event),
        });
      }),
    );
  }

  listRuns(threadId: string): RunRecord[] {
    this.assertInitialized();
    return structuredClone(
      threadRuns(this.state.runs, threadId).map(stripRunSecrets),
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
    return this.automaticRecoveryRepository.listAutomaticRecoveryAssessments(
      threadId,
    );
  }

  listAutomaticRecoveryAttempts(threadId?: string): AutomaticRecoveryAttempt[] {
    return this.automaticRecoveryRepository.listAutomaticRecoveryAttempts(
      threadId,
    );
  }

  getAutomaticRecoveryAttempt(attemptId: string): AutomaticRecoveryAttempt {
    return this.automaticRecoveryRepository.getAutomaticRecoveryAttempt(
      attemptId,
    );
  }

  async claimAutomaticRecoveries(
    ownerId: string,
    options: {
      now?: Date;
      leaseMs?: number;
      limit?: number;
    } = {},
  ): Promise<AutomaticRecoveryClaims> {
    return this.automaticRecoveryRepository.claimAutomaticRecoveries(
      ownerId,
      options,
    );
  }

  async renewAutomaticRecoveryClaim(
    attemptId: string,
    token: string,
    ttlMs: number,
  ): Promise<AutomaticRecoveryAttempt> {
    return this.automaticRecoveryRepository.renewAutomaticRecoveryClaim(
      attemptId,
      token,
      ttlMs,
    );
  }

  async bindAutomaticRecoveryRun(
    attemptId: string,
    token: string,
    recoveryRunId: string,
  ): Promise<AutomaticRecoveryAttempt> {
    return this.automaticRecoveryRepository.bindAutomaticRecoveryRun(
      attemptId,
      token,
      recoveryRunId,
    );
  }

  async settleAutomaticRecoveryAttempt(
    attemptId: string,
    token: string,
    recoveryRunId: string,
  ): Promise<AutomaticRecoveryAttempt> {
    return this.automaticRecoveryRepository.settleAutomaticRecoveryAttempt(
      attemptId,
      token,
      recoveryRunId,
    );
  }

  async abandonAutomaticRecoveryAttempt(
    attemptId: string,
    token: string,
    error: string,
  ): Promise<AutomaticRecoveryAttempt> {
    return this.automaticRecoveryRepository.abandonAutomaticRecoveryAttempt(
      attemptId,
      token,
      error,
    );
  }

  listPlans(threadId: string): ExecutionPlan[] {
    return this.planBlueprintRepository.listPlans(threadId);
  }

  getPlan(planId: string): ExecutionPlan {
    return this.planBlueprintRepository.getPlan(planId);
  }

  listExecutionPlanBlueprints(
    status?: ExecutionPlanBlueprintRecord["status"],
  ): ExecutionPlanBlueprintRecord[] {
    return this.planBlueprintRepository.listExecutionPlanBlueprints(status);
  }

  getExecutionPlanBlueprintRecord(
    recordId: string,
  ): ExecutionPlanBlueprintRecord {
    return this.planBlueprintRepository.getExecutionPlanBlueprintRecord(
      recordId,
    );
  }

  async saveExecutionPlanBlueprint(
    threadId: string,
    request: SaveExecutionPlanBlueprintRequest,
  ): Promise<SaveExecutionPlanBlueprintResult> {
    return this.planBlueprintRepository.saveExecutionPlanBlueprint(
      threadId,
      request,
    );
  }

  async setExecutionPlanBlueprintRecordStatus(
    recordId: string,
    request: SetExecutionPlanBlueprintRecordStatusRequest,
  ): Promise<ExecutionPlanBlueprintRecord> {
    return this.planBlueprintRepository.setExecutionPlanBlueprintRecordStatus(
      recordId,
      request,
    );
  }

  async qualifyExecutionPlanBlueprintRecord(
    recordId: string,
  ): Promise<ExecutionPlanBlueprintRecordQualification> {
    return this.planBlueprintRepository.qualifyExecutionPlanBlueprintRecord(
      recordId,
    );
  }

  async getExecutionPlanBlueprintRecordReplayHistory(
    recordId: string,
  ): Promise<ExecutionPlanBlueprintRecordReplayHistory> {
    return this.planBlueprintRepository.getExecutionPlanBlueprintRecordReplayHistory(
      recordId,
    );
  }

  async verifyExecutionPlanBlueprintRecordReplayHistory(
    recordId: string,
    input: unknown,
  ): Promise<ExecutionPlanBlueprintRecordReplayHistoryVerification> {
    return this.planBlueprintRepository.verifyExecutionPlanBlueprintRecordReplayHistory(
      recordId,
      input,
    );
  }

  async getExecutionPlanBlueprintRecordReplayOutcomes(
    recordId: string,
  ): Promise<ExecutionPlanBlueprintRecordReplayOutcomes> {
    return this.planBlueprintRepository.getExecutionPlanBlueprintRecordReplayOutcomes(
      recordId,
    );
  }

  async verifyExecutionPlanBlueprintRecordReplayOutcomes(
    recordId: string,
    input: unknown,
  ): Promise<ExecutionPlanBlueprintRecordReplayOutcomesVerification> {
    return this.planBlueprintRepository.verifyExecutionPlanBlueprintRecordReplayOutcomes(
      recordId,
      input,
    );
  }

  listExecutionPlanBlueprintRecordOutcomeBaselines(
    recordId: string,
  ): ExecutionPlanBlueprintRecordOutcomeBaseline[] {
    return this.planBlueprintOutcomeRepository.listExecutionPlanBlueprintRecordOutcomeBaselines(
      recordId,
    );
  }

  async promoteExecutionPlanBlueprintRecordOutcomeBaseline(
    recordId: string,
    request: PromoteExecutionPlanBlueprintRecordOutcomeBaselineRequest,
  ): Promise<PromoteExecutionPlanBlueprintRecordOutcomeBaselineResult> {
    return this.planBlueprintOutcomeRepository.promoteExecutionPlanBlueprintRecordOutcomeBaseline(
      recordId,
      request,
    );
  }

  async qualifyExecutionPlanBlueprintRecordOutcomes(
    recordId: string,
  ): Promise<ExecutionPlanBlueprintRecordOutcomeQualification> {
    return this.planBlueprintOutcomeRepository.qualifyExecutionPlanBlueprintRecordOutcomes(
      recordId,
    );
  }

  async selectExecutionPlanBlueprintRecord(
    threadId: string,
    request: SelectExecutionPlanBlueprintRecordRequest = {},
  ): Promise<ExecutionPlanBlueprintRecordSelection> {
    return this.planBlueprintOutcomeRepository.selectExecutionPlanBlueprintRecord(
      threadId,
      request,
    );
  }

  async calibrateExecutionPlanBlueprintPortfolio(): Promise<ExecutionPlanBlueprintPortfolioCalibration> {
    return this.planBlueprintOutcomeRepository.calibrateExecutionPlanBlueprintPortfolio();
  }

  async backtestExecutionPlanBlueprintRecommendationPolicies(): Promise<ExecutionPlanBlueprintRecommendationPolicyBacktest> {
    return this.planBlueprintOutcomeRepository.backtestExecutionPlanBlueprintRecommendationPolicies();
  }

  async listExecutionPlanBlueprintRecommendationPolicyOverrides(): Promise<ExecutionPlanBlueprintRecommendationPolicyOverrideList> {
    return this.planBlueprintPolicyRepository.listExecutionPlanBlueprintRecommendationPolicyOverrides();
  }

  async reviewExecutionPlanBlueprintRecommendationPolicyOverrideDrift(): Promise<ExecutionPlanBlueprintRecommendationPolicyOverrideDriftReview> {
    return this.planBlueprintPolicyRepository.reviewExecutionPlanBlueprintRecommendationPolicyOverrideDrift();
  }

  async listExecutionPlanBlueprintRecommendationPolicyOverrideRetirements(): Promise<ExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistory> {
    return this.planBlueprintPolicyRepository.listExecutionPlanBlueprintRecommendationPolicyOverrideRetirements();
  }

  async verifyExecutionPlanBlueprintRecommendationPolicyOverrideRetirements(
    input: unknown,
  ): Promise<ExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryVerification> {
    return this.planBlueprintPolicyRepository.verifyExecutionPlanBlueprintRecommendationPolicyOverrideRetirements(
      input,
    );
  }

  verifyExecutionPlanBlueprintRecommendationPolicyOverrideRetirementProofBundle(
    histories: unknown[],
  ): ExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryProofBundle {
    return this.planBlueprintPolicyRepository.verifyExecutionPlanBlueprintRecommendationPolicyOverrideRetirementProofBundle(
      histories,
    );
  }

  async setExecutionPlanBlueprintRecommendationPolicyOverride(
    request: SetExecutionPlanBlueprintRecommendationPolicyOverrideRequest,
  ): Promise<ExecutionPlanBlueprintRecommendationPolicyOverride> {
    return this.planBlueprintPolicyRepository.setExecutionPlanBlueprintRecommendationPolicyOverride(
      request,
    );
  }

  async retireExecutionPlanBlueprintRecommendationPolicyOverride(
    request: RetireExecutionPlanBlueprintRecommendationPolicyOverrideRequest,
  ): Promise<RetireExecutionPlanBlueprintRecommendationPolicyOverrideResult> {
    return this.planBlueprintPolicyRepository.retireExecutionPlanBlueprintRecommendationPolicyOverride(
      request,
    );
  }

  async listExecutionPlanBlueprintPortfolioCalibrationEntries(): Promise<
    ExecutionPlanBlueprintPortfolioCalibrationEntry[]
  > {
    return this.planBlueprintPolicyRepository.listExecutionPlanBlueprintPortfolioCalibrationEntries();
  }

  async verifyExecutionPlanBlueprintRecordReplayEvent(
    recordId: string,
    request: VerifyExecutionPlanBlueprintRecordReplayEventRequest,
  ): Promise<ExecutionPlanBlueprintRecordReplayEventVerification> {
    return this.planLifecycleRepository.verifyExecutionPlanBlueprintRecordReplayEvent(
      recordId,
      request,
    );
  }

  async previewPlanFromBlueprintRecord(
    threadId: string,
    request: CreateExecutionPlanFromBlueprintRecordRequest,
  ): Promise<ExecutionPlanBlueprintRecordPreview> {
    return this.planLifecycleRepository.previewPlanFromBlueprintRecord(
      threadId,
      request,
    );
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
    return this.planLifecycleRepository.createPlanFromBlueprintRecord(
      threadId,
      request,
    );
  }

  async createPlan(
    threadId: string,
    request: CreateExecutionPlanRequest,
  ): Promise<ExecutionPlan> {
    return this.planLifecycleRepository.createPlan(threadId, request);
  }

  async replanPlan(
    planId: string,
    request: ReplanExecutionPlanRequest,
  ): Promise<ExecutionPlan> {
    return this.planLifecycleRepository.replanPlan(planId, request);
  }

  async transitionPlanStep(
    planId: string,
    stepId: string,
    request: InternalPlanStepRequest,
  ): Promise<ExecutionPlan> {
    return this.planLifecycleRepository.transitionPlanStep(
      planId,
      stepId,
      request,
    );
  }

  async recoverCompletedWorkflowPlanStep(
    planId: string,
    stepId: string,
    runId: string,
    evidence: string,
  ): Promise<ExecutionPlan> {
    return this.planLifecycleRepository.recoverCompletedWorkflowPlanStep(
      planId,
      stepId,
      runId,
      evidence,
    );
  }

  async updatePlanArtifact(
    planId: string,
    artifactId: string,
    request: UpdateArtifactManifestRequest,
  ): Promise<ExecutionPlan> {
    return this.planLifecycleRepository.updatePlanArtifact(
      planId,
      artifactId,
      request,
    );
  }

  listRunEvaluations(threadId: string): RunEvaluationRecord[] {
    return this.evaluationReviewRepository.listRunEvaluations(threadId);
  }

  listEvaluationAdjudications(threadId: string): EvaluationAdjudication[] {
    return this.evaluationReviewRepository.listEvaluationAdjudications(
      threadId,
    );
  }

  async reviewRunEvaluation(
    threadId: string,
    evaluationId: string,
    request: ReviewRunEvaluationRequest,
  ): Promise<EvaluationAdjudication> {
    return this.evaluationReviewRepository.reviewRunEvaluation(
      threadId,
      evaluationId,
      request,
    );
  }

  listEvaluationReviewerBallots(
    threadId: string,
    evaluationId?: string,
  ): EvaluationReviewerBallot[] {
    return this.evaluationReviewRepository.listEvaluationReviewerBallots(
      threadId,
      evaluationId,
    );
  }

  async submitEvaluationReviewerBallot(
    threadId: string,
    evaluationId: string,
    request: SubmitEvaluationReviewerBallotRequest,
  ): Promise<EvaluationReviewerBallot> {
    return this.evaluationReviewRepository.submitEvaluationReviewerBallot(
      threadId,
      evaluationId,
      request,
    );
  }

  getEvaluationConsensusReport(
    threadId: string,
    evaluationId: string,
    gate?: Partial<EvaluationConsensusGate>,
  ): EvaluationConsensusReport {
    return this.evaluationReviewRepository.getEvaluationConsensusReport(
      threadId,
      evaluationId,
      gate,
    );
  }

  listEvaluationConsensusResolutions(
    threadId: string,
    evaluationId?: string,
  ): EvaluationConsensusResolution[] {
    return this.evaluationReviewRepository.listEvaluationConsensusResolutions(
      threadId,
      evaluationId,
    );
  }

  async resolveEvaluationConsensus(
    threadId: string,
    evaluationId: string,
    request: ResolveEvaluationConsensusRequest,
  ): Promise<ResolveEvaluationConsensusResult> {
    return this.evaluationReviewRepository.resolveEvaluationConsensus(
      threadId,
      evaluationId,
      request,
    );
  }

  getEvaluationCalibration(threadId: string): EvaluationCalibrationReport {
    return this.evaluationReviewRepository.getEvaluationCalibration(threadId);
  }

  async getContextCheckpointCalibration(
    threadId: string,
  ): Promise<ContextCheckpointCalibrationReport> {
    return this.evaluationReviewRepository.getContextCheckpointCalibration(
      threadId,
    );
  }

  listEvaluationCasebooks(): EvaluationCasebook[] {
    return this.evaluationCasebookRepository.listEvaluationCasebooks();
  }

  getEvaluationCasebook(casebookId: string): EvaluationCasebook {
    return this.evaluationCasebookRepository.getEvaluationCasebook(casebookId);
  }

  async createEvaluationCasebook(
    request: CreateEvaluationCasebookRequest,
  ): Promise<EvaluationCasebook> {
    return this.evaluationCasebookRepository.createEvaluationCasebook(request);
  }

  async updateEvaluationCasebook(
    casebookId: string,
    request: UpdateEvaluationCasebookRequest,
  ): Promise<EvaluationCasebook> {
    return this.evaluationCasebookRepository.updateEvaluationCasebook(
      casebookId,
      request,
    );
  }

  async curateEvaluationCasebookCase(
    casebookId: string,
    request: CurateEvaluationCaseRequest,
  ): Promise<EvaluationCasebook> {
    return this.evaluationCasebookRepository.curateEvaluationCasebookCase(
      casebookId,
      request,
    );
  }

  async removeEvaluationCasebookCase(
    casebookId: string,
    caseId: string,
    request: RemoveEvaluationCaseRequest,
  ): Promise<EvaluationCasebook> {
    return this.evaluationCasebookRepository.removeEvaluationCasebookCase(
      casebookId,
      caseId,
      request,
    );
  }

  getEvaluationCasebookCalibration(
    casebookId: string,
  ): EvaluationCasebookCalibrationReport {
    return this.evaluationCasebookRepository.getEvaluationCasebookCalibration(
      casebookId,
    );
  }

  exportEvaluationCasebook(casebookId: string): EvaluationCasebookArtifact {
    return this.evaluationCasebookRepository.exportEvaluationCasebook(
      casebookId,
    );
  }

  listEvaluationCasebookQualificationExecutions(
    casebookId: string,
  ): EvaluationCasebookQualificationExecution[] {
    return this.evaluationCasebookRepository.listEvaluationCasebookQualificationExecutions(
      casebookId,
    );
  }

  async saveEvaluationCasebookQualificationExecution(
    execution: EvaluationCasebookQualificationExecution,
  ): Promise<EvaluationCasebookQualificationExecution> {
    return this.evaluationCasebookRepository.saveEvaluationCasebookQualificationExecution(
      execution,
    );
  }

  listEvaluationQualificationBaselines(
    casebookId?: string,
  ): EvaluationQualificationBaseline[] {
    return this.evaluationCasebookRepository.listEvaluationQualificationBaselines(
      casebookId,
    );
  }

  async promoteEvaluationQualificationBaseline(
    casebookId: string,
    promotedByThreadId: string,
    envelope: TrustedReceiptEnvelope<EvaluationCasebookQualificationReceipt>,
  ): Promise<PromoteEvaluationQualificationBaselineResult> {
    return this.evaluationCasebookRepository.promoteEvaluationQualificationBaseline(
      casebookId,
      promotedByThreadId,
      envelope,
    );
  }

  async saveRunEvaluation(
    evaluation: RunEvaluationRecord,
  ): Promise<RunEvaluationRecord> {
    return this.evaluationCasebookRepository.saveRunEvaluation(evaluation);
  }

  listEvaluationSuites(threadId: string): EvaluationSuite[] {
    return this.evaluationSuiteRepository.listEvaluationSuites(threadId);
  }

  getEvaluationSuite(suiteId: string): EvaluationSuite {
    return this.evaluationSuiteRepository.getEvaluationSuite(suiteId);
  }

  async createEvaluationSuite(
    threadId: string,
    request: CreateEvaluationSuiteRequest,
  ): Promise<EvaluationSuite> {
    return this.evaluationSuiteRepository.createEvaluationSuite(
      threadId,
      request,
    );
  }

  async updateEvaluationSuite(
    suiteId: string,
    request: UpdateEvaluationSuiteRequest,
  ): Promise<EvaluationSuite> {
    return this.evaluationSuiteRepository.updateEvaluationSuite(
      suiteId,
      request,
    );
  }

  listEvaluationSuiteExecutions(
    threadId: string,
    suiteId?: string,
  ): EvaluationSuiteExecution[] {
    return this.evaluationSuiteRepository.listEvaluationSuiteExecutions(
      threadId,
      suiteId,
    );
  }

  async saveEvaluationSuiteExecution(
    execution: EvaluationSuiteExecution,
  ): Promise<EvaluationSuiteExecution> {
    return this.evaluationSuiteRepository.saveEvaluationSuiteExecution(
      execution,
    );
  }

  listSubagentTasks(threadId: string, runId?: string): SubagentTask[] {
    return this.subagentRepository.list(threadId, runId);
  }

  async createSubagentTask(
    input: CreateSubagentTaskInput,
  ): Promise<SubagentTask> {
    return this.subagentRepository.create(input);
  }

  async startSubagentTask(taskId: string): Promise<SubagentTask> {
    return this.subagentRepository.start(taskId);
  }

  async recordSubagentProgress(
    taskId: string,
    input: {
      stepDelta?: number;
      turnDelta?: number;
      usage?: SubagentTask["usage"];
    },
  ): Promise<SubagentTask> {
    return this.subagentRepository.progress(taskId, input);
  }

  async finishSubagentTask(
    taskId: string,
    input: FinishSubagentTaskInput,
  ): Promise<SubagentTask> {
    return this.subagentRepository.finish(taskId, input);
  }

  async setSubagentSupervisorStatus(
    taskId: string,
    status: NonNullable<SubagentTask["supervisorStatus"]>,
  ): Promise<SubagentTask> {
    return this.subagentRepository.setSupervisorStatus(taskId, status);
  }

  listExtensions(options: { agentId?: string } = {}): ExtensionRecord[] {
    return this.extensionRecordRepository.listExtensions(options);
  }

  getExtension(extensionId: string): ExtensionRecord {
    return this.extensionRecordRepository.getExtension(extensionId);
  }

  async createMcpExtension(
    request: CreateMcpExtensionRequest,
  ): Promise<ExtensionRecord> {
    return this.extensionRecordRepository.createMcpExtension(request);
  }

  listExtensionPublisherTrustAnchors(): ExtensionPublisherTrustAnchor[] {
    return this.extensionRecordRepository.listExtensionPublisherTrustAnchors();
  }

  getExtensionPublisherTrustAnchor(
    anchorId: string,
  ): ExtensionPublisherTrustAnchor {
    return this.extensionRecordRepository.getExtensionPublisherTrustAnchor(
      anchorId,
    );
  }

  async createExtensionPublisherTrustAnchor(
    request: CreateExtensionPublisherTrustAnchorRequest,
  ): Promise<ExtensionPublisherTrustAnchor> {
    return this.extensionRecordRepository.createExtensionPublisherTrustAnchor(
      request,
    );
  }

  async revokeExtensionPublisherTrustAnchor(
    anchorId: string,
  ): Promise<ExtensionPublisherTrustAnchor> {
    return this.extensionRecordRepository.revokeExtensionPublisherTrustAnchor(
      anchorId,
    );
  }

  async signExtensionPackage(
    extensionId: string,
    request: SignExtensionPackageRequest,
  ): Promise<SignedExtensionPackageEnvelope> {
    return this.signedPackageRepository.signExtensionPackage(
      extensionId,
      request,
    );
  }

  async signSkillPackage(
    request: SignSkillPackageRequest,
  ): Promise<SignedSkillPackageEnvelope> {
    return this.signedPackageRepository.signSkillPackage(request);
  }

  verifySkillPackage(
    request: VerifySkillPackageRequest,
  ): SkillPackageVerification {
    return this.signedPackageRepository.verifySkillPackage(request);
  }

  async qualifySkillPackage(
    request: QualifySkillPackageRequest,
  ): Promise<SkillPackageQualification> {
    return this.signedPackageRepository.qualifySkillPackage(request);
  }

  listSkillPackageInstallations(): SkillPackageInstallation[] {
    return this.signedPackageRepository.listSkillPackageInstallations();
  }

  async installSkillPackage(
    request: InstallSkillPackageRequest,
  ): Promise<InstallSkillPackageResult> {
    return this.signedPackageRepository.installSkillPackage(request);
  }

  async previewSkillContent(
    request: PreviewSkillContentRequest,
  ): Promise<SkillContentReview> {
    return this.signedPackageRepository.previewSkillContent(request);
  }

  async applySkillContent(
    request: ApplySkillContentRequest,
  ): Promise<ApplySkillContentResult> {
    return this.signedPackageRepository.applySkillContent(request);
  }

  signPromptPackage(
    request: SignPromptPackageRequest,
  ): SignedPromptPackageEnvelope {
    return this.signedPackageRepository.signPromptPackage(request);
  }

  verifyPromptPackage(
    request: VerifyPromptPackageRequest,
  ): PromptPackageVerification {
    return this.signedPackageRepository.verifyPromptPackage(request);
  }

  qualifyPromptPackage(
    request: QualifyPromptPackageRequest,
  ): PromptPackageQualification {
    return this.signedPackageRepository.qualifyPromptPackage(request);
  }

  signInspectorPackage(
    request: SignInspectorPackageRequest,
  ): SignedInspectorPackageEnvelope {
    return this.signedPackageRepository.signInspectorPackage(request);
  }

  verifyInspectorPackage(
    request: VerifyInspectorPackageRequest,
  ): InspectorPackageVerification {
    return this.signedPackageRepository.verifyInspectorPackage(request);
  }

  qualifyInspectorPackage(
    request: QualifyInspectorPackageRequest,
  ): InspectorPackageQualification {
    return this.signedPackageRepository.qualifyInspectorPackage(request);
  }

  async importSignedExtensionPackage(
    request: ImportSignedExtensionPackageRequest,
  ): Promise<ExtensionRecord> {
    return this.extensionDistributionRepository.importSignedExtensionPackage(
      request,
    );
  }

  previewExtensionPackageUpdate(
    extensionId: string,
    envelope: unknown,
  ): ExtensionPackageUpdatePreview {
    return this.extensionDistributionRepository.previewExtensionPackageUpdate(
      extensionId,
      envelope,
    );
  }

  async applyExtensionPackageUpdate(
    extensionId: string,
    request: ApplyExtensionPackageUpdateRequest,
  ): Promise<ApplyExtensionPackageUpdateResult> {
    return this.extensionDistributionRepository.applyExtensionPackageUpdate(
      extensionId,
      request,
    );
  }

  previewExtensionPackageDeployment(
    envelopes: unknown[],
  ): ExtensionPackageDeploymentPreview {
    return this.extensionDistributionRepository.previewExtensionPackageDeployment(
      envelopes,
    );
  }

  async applyExtensionPackageDeployment(
    request: ApplyExtensionPackageDeploymentRequest,
  ): Promise<ApplyExtensionPackageDeploymentResult> {
    return this.extensionDistributionRepository.applyExtensionPackageDeployment(
      request,
    );
  }

  exportExtensionPackageLockfile(
    request: ExportExtensionPackageLockfileRequest,
  ): ExtensionPackageLockfile {
    return this.extensionDistributionRepository.exportExtensionPackageLockfile(
      request,
    );
  }

  verifyExtensionPackageLockfile(
    lockfile: unknown,
  ): ExtensionPackageLockfileVerification {
    return this.extensionDistributionRepository.verifyExtensionPackageLockfile(
      lockfile,
    );
  }

  async signExtensionPackageChannelIndex(
    request: SignExtensionPackageChannelIndexRequest,
  ): Promise<SignedExtensionPackageChannelIndexEnvelope> {
    return this.extensionDistributionRepository.signExtensionPackageChannelIndex(
      request,
    );
  }

  verifyExtensionPackageChannelIndex(
    request: VerifyExtensionPackageChannelIndexRequest,
  ): ExtensionPackageChannelIndexVerification {
    return this.extensionDistributionRepository.verifyExtensionPackageChannelIndex(
      request,
    );
  }

  listExtensionPackageRolloutChannels(): ExtensionPackageRolloutChannel[] {
    return this.extensionDistributionRepository.listExtensionPackageRolloutChannels();
  }

  getExtensionPackageRolloutChannel(
    channelId: string,
  ): ExtensionPackageRolloutChannel {
    return this.extensionDistributionRepository.getExtensionPackageRolloutChannel(
      channelId,
    );
  }

  getExtensionPackageRolloutLockfile(
    lockfileSha256: string,
  ): ExtensionPackageLockfile {
    return this.extensionDistributionRepository.getExtensionPackageRolloutLockfile(
      lockfileSha256,
    );
  }

  async publishExtensionPackageRolloutChannel(
    request: PublishExtensionPackageRolloutChannelRequest,
  ): Promise<ExtensionPackageRolloutChannel> {
    return this.extensionDistributionRepository.publishExtensionPackageRolloutChannel(
      request,
    );
  }

  previewExtensionPackageRolloutChannel(
    request: PreviewExtensionPackageRolloutChannelRequest,
  ): ExtensionPackageRolloutPreview {
    return this.extensionDistributionRepository.previewExtensionPackageRolloutChannel(
      request,
    );
  }

  async applyExtensionPackageRolloutChannel(
    request: ApplyExtensionPackageRolloutChannelRequest,
  ): Promise<ApplyExtensionPackageRolloutChannelResult> {
    return this.extensionDistributionRepository.applyExtensionPackageRolloutChannel(
      request,
    );
  }

  async reviewExtension(
    extensionId: string,
    request: ReviewExtensionRequest,
  ): Promise<ExtensionRecord> {
    return this.extensionRecordRepository.reviewExtension(extensionId, request);
  }

  async setExtensionEnabled(
    extensionId: string,
    agentId: string,
    enabled: boolean,
  ): Promise<ExtensionRecord> {
    return this.extensionRecordRepository.setExtensionEnabled(
      extensionId,
      agentId,
      enabled,
    );
  }

  async setExtensionConnection(
    extensionId: string,
    connection: ExtensionConnection,
  ): Promise<ExtensionRecord> {
    return this.extensionRecordRepository.setExtensionConnection(
      extensionId,
      connection,
    );
  }

  async replaceDiscoveredMcpTools(
    extensionId: string,
    tools: DiscoveredMcpTool[],
  ): Promise<ExtensionRecord> {
    return this.extensionRecordRepository.replaceDiscoveredMcpTools(
      extensionId,
      tools,
    );
  }

  async reviewMcpTool(
    extensionId: string,
    toolName: string,
    request: ReviewMcpToolRequest,
  ): Promise<ExtensionRecord> {
    return this.extensionRecordRepository.reviewMcpTool(
      extensionId,
      toolName,
      request,
    );
  }

  listMemories(options: { agentId?: string } = {}): MemoryFact[] {
    return this.memoryRepository.list(options);
  }

  async proposeMemory(
    input: CreateMemoryRequest,
    source: MemorySource,
  ): Promise<MemoryFact> {
    return this.memoryRepository.propose(input, source);
  }

  async reviewMemory(
    memoryId: string,
    request: ReviewMemoryRequest,
  ): Promise<MemoryFact> {
    return this.memoryRepository.review(memoryId, request);
  }

  async expireDueMemories(
    options: { agentId?: string; now?: Date } = {},
  ): Promise<MemoryFact[]> {
    return this.memoryRepository.expireDue(options);
  }

  async recordMemoryUsage(
    memoryIds: string[],
    runId: string,
    usedAt = nowIso(),
  ): Promise<MemoryFact[]> {
    return this.memoryRepository.recordUsage(memoryIds, runId, usedAt);
  }

  async getDetail(
    threadId: string,
    options?: { kernelProjections?: boolean },
  ): Promise<ThreadDetail> {
    return loadThreadDetail(this, threadId, options);
  }

  async listRunControlMessages(
    threadId: string,
    runId?: string,
  ): Promise<RunControlMessage[]> {
    return this.runControlRepository.listRunControlMessages(threadId, runId);
  }

  async listOperatorDecisions(
    threadId: string,
    runId?: string,
  ): Promise<OperatorDecision[]> {
    return this.threadInteractionRepository.listOperatorDecisions(
      threadId,
      runId,
    );
  }

  async listAgentMilestones(
    threadId: string,
    runId?: string,
  ): Promise<AgentMilestone[]> {
    return this.threadInteractionRepository.listAgentMilestones(
      threadId,
      runId,
    );
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
      const thread = createThreadRecord(input);
      this.state.threads.push(thread);
      await this.persistState();
      return structuredClone(thread);
    });
  }

  async setThreadTitleIfDefault(
    threadId: string,
    title: string,
  ): Promise<ThreadRecord | undefined> {
    this.assertInitialized();
    const normalized = title.replace(/\s+/gu, " ").trim().slice(0, 100);
    if (!normalized) return undefined;
    return this.stateQueue.run(async () => {
      const thread = this.mutableThread(threadId);
      if (!isDefaultThreadTitle(thread.title)) {
        return structuredClone(thread);
      }
      thread.title = normalized;
      thread.updatedAt = nowIso();
      await this.persistState();
      return structuredClone(thread);
    });
  }

  async importThreadReplayBundle(
    input: ThreadReplayBundle,
    title?: string,
  ): Promise<ThreadDetail> {
    return this.threadReplayImportRepository.importThreadReplayBundle(
      input,
      title,
    );
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
    const lease = createRunLeaseBinding(leaseOptions);
    return this.stateQueue.run(async () => {
      const run = this.createRunRecord(input, lease.binding);
      await this.persistState();
      return {
        run: structuredClone(stripRunSecrets(run)),
        token: lease.token,
      };
    });
  }

  async renewRunLease(
    runId: string,
    token: string,
    ttlMs: number,
  ): Promise<RunRecord> {
    this.assertInitialized();
    const normalizedTtl = validateRunLeaseTtl(ttlMs);
    return this.stateQueue.run(async () => {
      return renewNormalizedRunLease({
        run: this.mutableRun(runId),
        token,
        ttlMs: normalizedTtl,
        workspaceRevision: this.stateRevision,
        ledger: this.requireLedger(),
        monitor: this.persistenceMonitor,
      });
    });
  }

  async recordAgentMilestone(
    input: RecordAgentMilestoneStoreInput,
  ): Promise<AgentMilestoneMutation> {
    return this.threadInteractionRepository.recordAgentMilestone(input);
  }

  async requestOperatorDecision(
    input: RequestOperatorDecisionStoreInput,
  ): Promise<OperatorDecisionMutation> {
    return this.threadInteractionRepository.requestOperatorDecision(input);
  }

  async answerOperatorDecision(
    threadId: string,
    decisionId: string,
    answer: AnswerOperatorDecisionRequest,
  ): Promise<OperatorDecisionMutation> {
    return this.threadInteractionRepository.answerOperatorDecision(
      threadId,
      decisionId,
      answer,
    );
  }

  async continueOperatorDecision(
    threadId: string,
    decisionId: string,
    continuationRunId: string,
  ): Promise<OperatorDecisionMutation> {
    return this.threadInteractionRepository.continueOperatorDecision(
      threadId,
      decisionId,
      continuationRunId,
    );
  }

  async cancelOperatorDecision(
    threadId: string,
    decisionId: string,
    reason: OperatorDecisionCancellationReason = "operator_cancelled",
  ): Promise<OperatorDecisionMutation> {
    return this.threadInteractionRepository.cancelOperatorDecision(
      threadId,
      decisionId,
      reason,
    );
  }

  async queueRunControlMessage(
    input: QueueRunControlMessageInput,
  ): Promise<RunControlMessage> {
    return this.runControlRepository.queueRunControlMessage(input);
  }

  async deliverNextRunControlMessage(
    threadId: string,
    runId: string,
    mode: RunControlMessageMode,
  ): Promise<RunControlMessageDelivery | undefined> {
    return this.runControlRepository.deliverNextRunControlMessage(
      threadId,
      runId,
      mode,
    );
  }

  async cancelRunControlMessage(
    threadId: string,
    runId: string,
    controlMessageId: string,
  ): Promise<RunControlMessage> {
    return this.runControlRepository.cancelRunControlMessage(
      threadId,
      runId,
      controlMessageId,
    );
  }

  async finishRun(
    runId: string,
    status: Exclude<RunStatus, "queued" | "running">,
    options: {
      error?: string;
      outcome?: NonNullable<RunRecord["outcome"]>;
      usage?: RunRecord["usage"];
      leaseToken?: string;
      waitForOperatorDecisionId?: string;
    } = {},
  ): Promise<RunRecord> {
    return this.runLifecycleRepository.finishRun(runId, status, options);
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
    return this.appendResolvedEvent(resolveRegisteredEventInput(input));
  }

  async appendExtensionEvent(input: AppendExtensionEventInput): Promise<RunEvent> {
    return this.appendResolvedEvent(resolveExtensionEventInput(input));
  }

  async appendCompatibilityEvent(input: AppendCompatibilityEventInput): Promise<RunEvent> {
    return this.appendResolvedEvent(resolveCompatibilityEventInput(input));
  }

  private async appendResolvedEvent(
    input: ResolvedRunEventInput,
  ): Promise<RunEvent> {
    this.assertInitialized();
    return appendResolvedRunEvent(
      {
        runStatus: (runId) => this.state.runs.find((run) => run.id === runId),
        mutableThread: (threadId) => this.mutableThread(threadId),
        runInThreadQueue: (threadId, operation) =>
          this.threadQueue(threadId).run(operation),
        runInStateQueue: (operation) => this.stateQueue.run(operation),
        persistEvent: (event) => this.persistState(event, "event"),
        validateResourceId: (id) => this.validateResourceId(id),
      },
      input,
    );
  }

  private async reconcileInterruptedRuns(
    interruptActiveLeases = false,
  ): Promise<void> {
    await this.runLifecycleRepository.reconcileInterruptedRuns(
      interruptActiveLeases,
    );
  }

  private async seedWorkspace(): Promise<void> {
    const { agent, events, thread, run } = createWorkspaceSeed();
    const state: PersistedState = {
      ...structuredClone(EMPTY_STATE),
      agents: [agent],
      agentRevisions: [
        createAgentProfileRevision(agent, { source: "created" }),
      ],
      agentCapabilityBindings: [createSeededCapabilityBinding(agent)],
      threads: [thread],
      runs: [run],
    };
    const snapshot = this.requireLedger().bootstrap(
      JSON.stringify(state),
      events,
    );
    this.restoreSnapshot(snapshot);
    await this.compatibilityProjections.writeAll(
      JSON.stringify(this.state, null, 2),
      this.state.threads.map((item) => item.id),
    );
  }

  private validateState(
    state: PersistedState,
    sourceBindingEvents?: readonly RunEvent[],
  ): PersistedState {
    return validatePersistedStoreState(
      state,
      this.statePath,
      sourceBindingEvents,
    );
  }

  async updateExtension(
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

  private appendEventsToThread(
    thread: ThreadRecord,
    inputs: AppendEventInput[],
    options: { createdAt?: string } = {},
  ): RunEvent[] {
    return appendRegisteredEventsToThread(thread, inputs, options);
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
    const simulationExecution = validateWorkflowSimulationRunGate({
      source: input.source,
      threadId: thread.id,
      execution: input[WORKFLOW_SIMULATION_EXECUTION],
      plans: this.state.plans,
    });
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
    const workflowPlanId =
      workflowExecution?.planId ?? simulationExecution?.planId;
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
          run.source === "workflow" && run.workflowPlanId === workflowPlanId,
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
    const effectiveRunAgent = resolveStoredRunCapabilityProfile({
      agents: this.state.agents,
      revisions: this.state.agentRevisions,
      runs: this.state.runs,
      events: this.requireLedger().listEvents(thread.id),
      threadId: thread.id,
      agentId: input.agentId,
      agentRevision: input.agentRevision,
      capabilityPreset: input.capabilityPreset,
      parentRunId: input.parentRunId,
      source: input.source ?? "user",
      authorizationCarrier: input,
    });
    const executionMode = input.executionMode ?? "standard";
    if (openOperatorDecision) {
      const originRun = this.state.runs.find(
        (candidate) => candidate.id === openOperatorDecision.runId,
      );
      if (
        !originRun ||
        originRun.threadId !== thread.id ||
        originRun.agentId !== input.agentId
      ) {
        throw new Error(
          "Operator decision origin Run configuration is unavailable",
        );
      }
      assertOperatorDecisionCapabilityContinuation(
        effectiveRunAgent,
        originRun,
        input.model,
      );
    }
    const messageExperiment = input[AGENT_MESSAGE_EXPERIMENT_EXECUTION];
    const modelInvocationExperiment =
      input[MODEL_INVOCATION_EXPERIMENT_EXECUTION];
    const toolInvocationExperiment =
      input[TOOL_INVOCATION_EXPERIMENT_EXECUTION];
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
        targetAgentRevision: effectiveRunAgent.revision,
        targetModel: input.model ?? effectiveRunAgent.model,
        execution: modelInvocationExperiment,
        runs: this.state.runs,
        sourceEvents: modelInvocationExperiment
          ? this.requireLedger().listEvents(
              modelInvocationExperiment.sourceThreadId,
            )
          : [],
      });
    }
    if (
      input.source === "tool_experiment" ||
      executionMode === "tool_experiment_read_only" ||
      toolInvocationExperiment
    ) {
      validateToolInvocationExperimentRunGate({
        source: input.source,
        executionMode,
        targetThreadId: input.threadId,
        targetAgentId: input.agentId,
        targetAgentRevision: effectiveRunAgent.revision,
        targetModel: input.model ?? effectiveRunAgent.model,
        execution: toolInvocationExperiment,
        runs: this.state.runs,
        sourceEvents: toolInvocationExperiment
          ? this.requireLedger().listEvents(
              toolInvocationExperiment.sourceThreadId,
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
      if (messageExperiment) {
        validateAgentMessageExperimentToolResultRunGate({
          execution: messageExperiment,
          sourceEvents,
        });
      }
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
        sourceRun.agentRevision !== effectiveRunAgent.revision ||
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
    } else if (isWorkflowReadOnlyChildExecutionMode(executionMode)) {
      validateWorkflowReadOnlyChildRunGate({
        executionMode,
        source: input.source ?? "user",
        threadId: input.threadId,
        agentId: input.agentId,
        ...(input.parentRunId ? { parentRunId: input.parentRunId } : {}),
        ...(workflowExecution
          ? { workflowPlanId: workflowExecution.planId }
          : {}),
        runs: this.state.runs,
        events: this.requireLedger().listEvents(input.threadId),
      });
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
      status: initialRunStatus(),
      ...(input.source ? { source: input.source } : {}),
      ...(workflowPlanId ? { workflowPlanId } : {}),
      ...(input.triggerId ? { triggerId: input.triggerId } : {}),
      releaseIdentitySha256: NAPIER_RELEASE_IDENTITY_SHA256,
      startedAt: nowIso(),
      usage: emptyUsage(),
      agentRevision: effectiveRunAgent.revision,
      limits: normalizeRunLimits(
        effectiveRunAgent.runLimits ?? structuredClone(DEFAULT_RUN_LIMITS),
      ),
      configuration: createRunConfigurationFingerprint(
        effectiveRunAgent,
        input.model ?? effectiveRunAgent.model,
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
    return findThread(this.state.threads, threadId);
  }

  private mutableRun(runId: string): PersistedRunRecord {
    const run = this.state.runs.find((item) => item.id === runId);
    if (!run) throw new Error(`Run not found: ${runId}`);
    return run;
  }

  mutableSchedule(scheduleId: string): PersistedAutomationSchedule {
    const schedule = this.state.schedules.find(
      (item) => item.id === scheduleId,
    );
    if (!schedule) throw new Error(`Schedule not found: ${scheduleId}`);
    return schedule;
  }

  mutableInboundChannel(channelId: string): PersistedInboundChannel {
    const channel = this.state.channels.find((item) => item.id === channelId);
    if (!channel) throw new Error(`Inbound channel not found: ${channelId}`);
    return channel;
  }

  mutableInboundDelivery(deliveryId: string): PersistedInboundDelivery {
    const delivery = this.state.inboundDeliveries.find(
      (item) => item.id === deliveryId,
    );
    if (!delivery) {
      throw new Error(`Inbound delivery not found: ${deliveryId}`);
    }
    return delivery;
  }

  private threadQueue(threadId: string): SerialQueue {
    const existing = this.threadQueues.get(threadId);
    if (existing) return existing;
    const queue = new SerialQueue();
    this.threadQueues.set(threadId, queue);
    return queue;
  }

  private validateResourceId(id: string): void {
    if (!/^[a-z][a-z0-9_]{2,80}$/.test(id)) {
      throw new Error(`Invalid resource ID: ${id}`);
    }
  }

  private async persistState(
    eventOrEvents?: RunEvent | RunEvent[],
    mode: "snapshot" | "event" = "snapshot",
  ): Promise<void> {
    const events = Array.isArray(eventOrEvents)
      ? eventOrEvents
      : eventOrEvents
        ? [eventOrEvents]
        : [];
    const snapshotRequired =
      mode === "snapshot" || compatibilityCheckpointRequired(events);
    this.stateRevision = await persistStoreMutation({
      expectedRevision: this.stateRevision,
      ...(snapshotRequired
        ? { snapshotJson: () => JSON.stringify(this.state) }
        : {}),
      compatibilityStateJson: () => JSON.stringify(this.state, null, 2),
      events,
      ledger: this.requireLedger(),
      monitor: this.persistenceMonitor,
      compatibility: this.compatibilityProjections,
      onCommitFailure: () => this.refreshStateFromLedger(true),
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
    if (!snapshot) return;
    if (!force && snapshot.revision === this.stateRevision) {
      applyNormalizedRunLeases(this.state.runs, snapshot.runLeases);
      return;
    }
    this.restoreSnapshot(snapshot);
  }

  private restoreSnapshot(snapshot: {
    revision: number;
    snapshotRevision: number;
    stateJson: string;
    runLeases: import("./sqlite-run-leases.js").LedgerRunLease[];
  }): boolean {
    if (
      !Number.isSafeInteger(snapshot.snapshotRevision) ||
      snapshot.snapshotRevision < 1 ||
      snapshot.snapshotRevision > snapshot.revision
    ) {
      throw new Error("SQLite ledger snapshot watermark is invalid");
    }
    const parsed = JSON.parse(snapshot.stateJson) as PersistedState;
    const capabilityBindingMetadataPresent = Object.hasOwn(
      parsed,
      "agentCapabilityBindings",
    );
    const capabilityBindingContent = JSON.stringify(
      parsed.agentCapabilityBindings,
    );
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
    applyNormalizedRunLeases(this.state.runs, snapshot.runLeases);
    replayThreadSummaryTails({
      threads: this.state.threads,
      expectedEventCount: snapshot.revision - snapshot.snapshotRevision,
      listEvents: (threadId, afterSeq) =>
        this.requireLedger().listEvents(threadId, afterSeq),
    });
    this.compatibilityProjections.markSnapshotDirty(
      this.state.threads.map((thread) => thread.id),
    );
    this.stateRevision = snapshot.revision;
    return (
      requiresStateMigration ||
      !capabilityBindingMetadataPresent ||
      capabilityBindingContent !==
        JSON.stringify(this.state.agentCapabilityBindings)
    );
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
            const message = threadMessagePreview(threadEvents[index]!);
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
}

function stripRunSecrets(run: PersistedRunRecord): RunRecord {
  const output = structuredClone(run);
  delete output.leaseTokenSha256;
  return output;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
