import type {
  AgentProfile,
  AgentProfileRevision,
  AutomaticRecoveryAssessment,
  AutomationSchedule,
  CreateExecutionPlanFromBlueprintRecordRequest,
  EvaluationAdjudication,
  EvaluationCasebook,
  EvaluationCasebookQualificationExecution,
  EvaluationConsensusResolution,
  EvaluationQualificationBaseline,
  EvaluationReviewerBallot,
  EvaluationSuite,
  EvaluationSuiteExecution,
  ExecutionPlan,
  ExecutionPlanBlueprintRecommendationPolicyOverride,
  ExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistory,
  ExecutionPlanBlueprintRecord,
  ExecutionPlanBlueprintRecordOutcomeBaseline,
  ExecutionPlanBlueprintRecordOutcomeQualification,
  ExecutionPlanBlueprintRecordPreview,
  ExecutionPlanBlueprintRecordQualification,
  ExecutionPlanBlueprintRecordReplayHistory,
  ExecutionPlanBlueprintRecordReplayOutcomes,
  ExtensionPackageRolloutChannel,
  ExtensionPublisherTrustAnchor,
  ExtensionRecord,
  InboundChannel,
  InboundDelivery,
  InboundMessageRequest,
  ReceiptTrustAnchor,
  ReceiptTrustAnchorDirectoryQuorum,
  ReceiptTrustAnchorDirectoryQuorumActivationDecisionRecord,
  ReceiptTrustAnchorDirectoryQuorumActivationSelection,
  ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaseline,
  ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorum,
  ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaseline,
  ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumPolicy,
  ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription,
  ReceiptTrustAnchorDirectoryQuorumMetadataEvidence,
  ReceiptTrustAnchorDirectoryQuorumPolicy,
  ReceiptTrustAnchorDirectoryQuorumPromotionBaseline,
  RetireExecutionPlanBlueprintRecommendationPolicyOverrideResult,
  RunEvaluationRecord,
  RunEvent,
  RunRecord,
  SkillPackageInstallation,
  SubagentTask,
  ThreadDetail,
  ThreadRecord,
} from "@napier/contracts";
import type { PersistedAutomaticRecoveryAttempt } from "./automatic-recovery-store-records.js";
import type {
  PersistedReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription,
  PersistedReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription,
  PersistedReceiptTrustAnchorDirectorySubscription,
} from "./receipt-trust-directory-subscriptions.js";
import type { AppendEventInput } from "./run-event-registry.js";

export interface StorePersistedRunRecord extends RunRecord {
  leaseTokenSha256?: string;
}

export interface StorePersistedAutomationSchedule extends AutomationSchedule {
  claimTokenSha256?: string;
}

export interface StorePersistedInboundChannel extends InboundChannel {
  tokenSha256: string;
}

export interface StorePersistedInboundDelivery extends InboundDelivery {
  idempotencySha256: string;
  message: string;
  model?: InboundMessageRequest["model"];
}

export interface StoreRepositoryState {
  agents: AgentProfile[];
  agentRevisions: AgentProfileRevision[];
  threads: ThreadRecord[];
  runs: StorePersistedRunRecord[];
  automaticRecoveryAssessments: AutomaticRecoveryAssessment[];
  automaticRecoveryAttempts: PersistedAutomaticRecoveryAttempt[];
  plans: ExecutionPlan[];
  executionPlanBlueprints: ExecutionPlanBlueprintRecord[];
  executionPlanBlueprintOutcomeBaselines: ExecutionPlanBlueprintRecordOutcomeBaseline[];
  executionPlanBlueprintRecommendationPolicyOverrides: ExecutionPlanBlueprintRecommendationPolicyOverride[];
  executionPlanBlueprintRecommendationPolicyOverrideRetirements: RetireExecutionPlanBlueprintRecommendationPolicyOverrideResult[];
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
  evaluationQualificationBaselines: EvaluationQualificationBaseline[];
  evaluationSuites: EvaluationSuite[];
  evaluationSuiteExecutions: EvaluationSuiteExecution[];
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
  schedules: StorePersistedAutomationSchedule[];
  channels: StorePersistedInboundChannel[];
  inboundDeliveries: StorePersistedInboundDelivery[];
}

export interface StoreRepositoryQueue {
  run<T>(operation: () => Promise<T>): Promise<T>;
}

export interface StoreRepositoryLedger {
  listEvents(threadId: string, afterSeq?: number): RunEvent[];
}

export interface StoreExecutionPlanBlueprintPortfolioCalibrationEntry {
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

export interface StoreRepositoryHost {
  dataRoot: string;
  workspaceRoot: string;
  state: StoreRepositoryState;
  stateQueue: StoreRepositoryQueue;
  assertInitialized(): void;
  persistState(
    eventOrEvents?: RunEvent | RunEvent[],
    mode?: "snapshot" | "event",
  ): Promise<void>;
  requireLedger(): StoreRepositoryLedger;
  getThread(threadId: string): ThreadRecord;
  mutableRun(runId: string): StorePersistedRunRecord;
  threadQueue(threadId: string): StoreRepositoryQueue;
  validateResourceId(id: string): void;
  appendEventsToThread(
    thread: ThreadRecord,
    inputs: AppendEventInput[],
    options?: { createdAt?: string },
  ): RunEvent[];
  appendEvent(input: AppendEventInput): Promise<RunEvent>;
  getDetail(
    threadId: string,
    options?: { kernelProjections?: boolean },
  ): Promise<ThreadDetail>;
  getPlan(planId: string): ExecutionPlan;
  getAgent(agentId: string): AgentProfile;
  getAgentRevision(agentId: string, revision: number): AgentProfileRevision;
  getEvaluationCasebook(casebookId: string): EvaluationCasebook;
  getExecutionPlanBlueprintRecord(
    recordId: string,
  ): ExecutionPlanBlueprintRecord;
  qualifyExecutionPlanBlueprintRecord(
    recordId: string,
  ): Promise<ExecutionPlanBlueprintRecordQualification>;
  getExecutionPlanBlueprintRecordReplayHistory(
    recordId: string,
  ): Promise<ExecutionPlanBlueprintRecordReplayHistory>;
  getExecutionPlanBlueprintRecordReplayOutcomes(
    recordId: string,
  ): Promise<ExecutionPlanBlueprintRecordReplayOutcomes>;
  qualifyExecutionPlanBlueprintRecordOutcomes(
    recordId: string,
  ): Promise<ExecutionPlanBlueprintRecordOutcomeQualification>;
  previewPlanFromBlueprintRecord(
    threadId: string,
    request: CreateExecutionPlanFromBlueprintRecordRequest,
  ): Promise<ExecutionPlanBlueprintRecordPreview>;
  listExecutionPlanBlueprintPortfolioCalibrationEntries(): Promise<
    StoreExecutionPlanBlueprintPortfolioCalibrationEntry[]
  >;
  listExecutionPlanBlueprintRecommendationPolicyOverrideRetirements(): Promise<ExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistory>;
  listEvents(threadId: string, afterSeq?: number): Promise<RunEvent[]>;
  mutableThread(threadId: string): ThreadRecord;
  mutableSchedule(scheduleId: string): StorePersistedAutomationSchedule;
  mutableInboundChannel(channelId: string): StorePersistedInboundChannel;
  mutableInboundDelivery(deliveryId: string): StorePersistedInboundDelivery;
  getExtension(extensionId: string): ExtensionRecord;
  getExtensionPublisherTrustAnchor(
    anchorId: string,
  ): ExtensionPublisherTrustAnchor;
  getExtensionPackageRolloutChannel(
    channelId: string,
  ): ExtensionPackageRolloutChannel;
  getReceiptTrustAnchorDirectorySubscriptionQuorum(
    policy?: ReceiptTrustAnchorDirectoryQuorumPolicy,
    metadataEvidence?: ReceiptTrustAnchorDirectoryQuorumMetadataEvidence[],
  ): ReceiptTrustAnchorDirectoryQuorum;
  listReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptions(): ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription[];
  getReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorum(
    policy?: ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumPolicy,
  ): ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorum;
  updateExtension(
    extensionId: string,
    update: (current: ExtensionRecord) => ExtensionRecord,
  ): Promise<ExtensionRecord>;
}
