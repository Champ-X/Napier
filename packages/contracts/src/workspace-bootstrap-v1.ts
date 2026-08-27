import type { AutomaticRecoveryAssessment, AutomaticRecoveryAttempt, AutomaticRecoveryAttemptStatus, AutomaticRecoveryBlockReason, RunControlMessage, ThreadRecord, ThreadSummary } from "./agent-thread-control-v1.js";
import type { EvaluationAdjudication, EvaluationConsensusResolution, EvaluationReviewerBallot, EvaluationSuite, EvaluationSuiteExecution, RunEvaluationRecord } from "./evaluation-v1.js";
import type { InboundChannel, InboundChannelAdapterDescriptor } from "./execution-channels.js";
import type { AutomaticRecoveryPolicy, ModelRef, OperatorDecision, RunEvent, SubagentRole } from "./execution-core.js";
import type { ExecutionPlan, PlanStep } from "./execution-plan-v1.js";
import type { AgentProfile, RunRecord } from "./execution-runs.js";
import type { ArtifactManifestEntry, ExecutionPlanStatus, PlanStepStatus } from "./execution-workflows.js";
import type { ExtensionPublisherTrustAnchor, ExtensionRecord } from "./extension-package-core-v1.js";
import type { ExtensionPackageRolloutChannel } from "./extension-package-distribution-v1.js";
import type { CredentialReference, MemoryFact } from "./memory-credential-v1.js";
import type { ModelSummary } from "./prompt-inspector-package-v1.js";
import type { UsagePriceTableCatalog } from "./protocol-v1-core.js";
import type { SkillPackageInstallation, SkillSummary } from "./skill-package-v1.js";
import type { SubagentOutcomeItemKind, SubagentOutcomeSeverity, SubagentStopReason, SubagentTask, SubagentTaskStatus } from "./subagent-supervisor.js";
import type { SubagentHubProjectionV1 } from "./subagent-hub-v1.js";
import type { AutomationSchedule, ContextCheckpointCalibrationReport } from "./workspace-control-v1.js";

export interface WorkspaceSummary {
  root: string;
  dataRoot: string;
  localFirst: true;
  isolation: "workspace";
}

export type HealthStatus = "ok" | "degraded" | "failed";

export interface StorePersistenceSample {
  status: "committed" | "failed";
  recordedAt: string;
  revision: number;
  stateBytes: number;
  eventCount: number;
  eventBytes: number;
  touchedThreadCount: number;
  stateProjectionBytes: number;
  eventProjectionBytes: number;
  serializationDurationMs: number;
  ledgerCommitDurationMs: number;
  projectionDurationMs: number;
  totalDurationMs: number;
  projectionFailureCount: number;
}

export interface StorePersistenceMetrics {
  schemaVersion: 1;
  startedAt: string;
  commitCount: number;
  failedCommitCount: number;
  projectionFailureCount: number;
  stateBytesWritten: number;
  eventBytesWritten: number;
  projectionBytesWritten: number;
  maxCommitDurationMs: number;
  last?: StorePersistenceSample;
}

export interface CompatibilityTelemetrySnapshot {
  schemaVersion: 1;
  privacy: "fixed_id_count_only";
  metrics: Array<{ id: string; count: number }>;
}

export interface HealthResponse {
  status: HealthStatus;
  service: "napier";
  time: string;
  runtime: {
    node: {
      version: string;
      platform: string;
      arch: string;
    };
    components: {
      sqlite: string;
      openssl: string;
      uv: string;
      v8: string;
    };
  };
  ledger: {
    schemaVersion: number;
    quickCheck: string;
    migrations: {
      version: number;
      name: string;
      appliedAt: string;
    }[];
  };
  store: {
    persistence: StorePersistenceMetrics;
  };
  compatibility: CompatibilityTelemetrySnapshot;
}

export interface BootstrapResponse {
  apiVersion: string;
  workspace: WorkspaceSummary;
  agents: AgentProfile[];
  threads: ThreadSummary[];
  skills: SkillSummary[];
  models: ModelSummary[];
  memories: MemoryFact[];
  extensions: ExtensionRecord[];
  plugins?: import("./kernel-plugins.js").KernelPluginInspection[];
  extensionPublisherTrustAnchors: ExtensionPublisherTrustAnchor[];
  extensionPackageRolloutChannels: ExtensionPackageRolloutChannel[];
  skillPackageInstallations: SkillPackageInstallation[];
  credentials: CredentialReference[];
  usagePriceTableCatalog: UsagePriceTableCatalog;
  schedules: AutomationSchedule[];
  channels: InboundChannel[];
  inboundChannelAdapters: InboundChannelAdapterDescriptor[];
  inboundChannelAdapterCatalogSha256: string;
  activeThread?: ThreadDetail;
}

export interface ThreadDetail {
  thread: ThreadRecord;
  agent: AgentProfile;
  runs: RunRecord[];
  plans: ExecutionPlan[];
  evaluations: RunEvaluationRecord[];
  evaluationAdjudications: EvaluationAdjudication[];
  evaluationReviewerBallots: EvaluationReviewerBallot[];
  evaluationConsensusResolutions: EvaluationConsensusResolution[];
  evaluationSuites: EvaluationSuite[];
  evaluationSuiteExecutions: EvaluationSuiteExecution[];
  automaticRecoveryAssessments: AutomaticRecoveryAssessment[];
  automaticRecoveryAttempts: AutomaticRecoveryAttempt[];
  subagents: SubagentTask[];
  runControlMessages: RunControlMessage[];
  operatorDecisions: OperatorDecision[];
  contextCheckpointCalibration: ContextCheckpointCalibrationReport;
  events: RunEvent[];
  taskNarrative?: {
    phase: "ready" | "working" | "waiting" | "blocked" | "completed" | "failed";
    phaseLabel: string;
    currentAction: string;
    completedItems: string[];
    metricRunId?: string;
    nextStep?: string;
    blocker?: string;
  };
  activePlan?: {
    planId: string;
    revision: number;
    status: ExecutionPlanStatus;
    objective: string;
    completedStepCount: number;
    settledStepCount: number;
    stepCount: number;
    runningStep?: PlanStep;
    blockedStep?: PlanStep;
    nextStep?: PlanStep;
    verifiedArtifactCount: number;
    producedArtifactCount: number;
    missingArtifactCount: number;
    outputPaths: string[];
    activePhaseIndex: number | null;
    phaseCount: number;
    eventWatermark: number;
  };
  messages?: Array<{ id: string; seq: number; role: "user" | "assistant" | "system"; text: string; model: string; createdAt: string }>;
  artifacts?: Array<{
    id: string;
    seq: number;
    createdAt: string;
    attemptScope: "current" | "previous";
    threadId: string;
    runId: string;
    planId: string;
    planRevision: number;
    artifact: ArtifactManifestEntry;
  }>;
  activityEvents?: RunEvent[];
  citations?: Array<{
    id: string;
    seq: number;
    createdAt: string;
    callId: string;
    citationId: string;
    sourceId: string;
    sourceKind: "browser" | "web_fetch";
    startLine: number;
    endLine: number;
    sourceContentSha256: string;
    sourceTitleSha256: string;
    quoteSha256: string;
    claimSha256: string;
  }>;
  recoveries?: Array<{
    id: string;
    seq: number;
    createdAt: string;
    status: AutomaticRecoveryAttemptStatus | "skipped";
    assessment: {
      contentSha256: string;
      interruptedRunId: string;
      rootRunId: string;
      eligible: boolean;
      blockReasons: AutomaticRecoveryBlockReason[];
      policy: AutomaticRecoveryPolicy;
      toolCalls: AutomaticRecoveryAssessment["toolCalls"];
      eventRange: AutomaticRecoveryAssessment["eventRange"];
      priorAttempts: number;
      assessedAt: string;
    };
    attempt?: {
      id: string;
      status: AutomaticRecoveryAttemptStatus;
      attempt: number;
      maxAttempts: number;
      recoveryRunId?: string;
      revision: number;
    };
    settlement?: {
      budgetReason: "turns" | "tokens" | "cost" | "timeout";
      limit?: number;
      observedTurns?: number;
      observedTotalTokens?: number;
      observedCostUsd?: number;
      observedElapsedMs?: number;
    };
    eventIds: string[];
  }>;
  subagentCards?: Array<{
    id: string;
    seq: number;
    createdAt: string;
    task: {
      id: string;
      role: SubagentRole;
      description: string;
      status: SubagentTaskStatus;
      model: ModelRef;
      stepCount: number;
      turnCount: number;
      usage: { inputTokens: number; outputTokens: number };
      stopReason?: SubagentStopReason;
      hasError?: true;
      outcome?: {
        summary: string;
        items: Array<{ kind: SubagentOutcomeItemKind; severity: SubagentOutcomeSeverity; title: string; evidenceCount: number }>;
      };
    };
    itemCount: number;
    evidenceCount: number;
    unknownCount: number;
    blockerCount: number;
    warningCount: number;
  }>;
  subagentHub?: SubagentHubProjectionV1;
  activityCandidates?: Array<{
    id: string;
    seq: number;
    type: string;
    label: string;
    summary: string;
    tone: "working" | "completed" | "waiting" | "blocked" | "info";
    createdAt: string;
    callId?: string;
    planId?: string;
    decisionId?: string;
    taskId?: string;
    artifactKey?: string;
  }>;
  conversationPlans?: Array<{
    id: string;
    seq: number;
    createdAt: string;
    attemptScope: "current" | "previous";
    plan: {
      id: string;
      status: ExecutionPlanStatus;
      revision: number;
      objective: string;
      steps: Array<{ id: string; title: string; status: PlanStepStatus; evidenceRecorded: boolean; blocker?: string }>;
      activePhaseIndex: number | null;
      phaseCount: number;
    };
    completedStepCount: number;
    settledStepCount: number;
    runningStep?: { id: string; title: string; status: PlanStepStatus; evidenceRecorded: boolean; blocker?: string };
    blockedStep?: { id: string; title: string; status: PlanStepStatus; evidenceRecorded: boolean; blocker?: string };
    nextStep?: { id: string; title: string; status: PlanStepStatus; evidenceRecorded: boolean; blocker?: string };
    verifiedArtifactCount: number;
    producedArtifactCount: number;
    missingArtifactCount: number;
  }>;
}

export interface CreateThreadRequest {
  title?: string;
  agentId?: string;
}

export interface SetGoalRequest {
  objective: string;
  maxContinuations?: number;
}

export interface CreateBranchRequest {
  fromSeq: number;
  title?: string;
}
