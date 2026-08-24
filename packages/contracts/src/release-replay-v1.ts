import type { AgentProfileRevision, AutomaticRecoveryAssessment, AutomaticRecoveryAttempt, ThreadRecord } from "./agent-thread-control-v1.js";
import type { EvaluationAdjudication, EvaluationCasebookQualificationReceipt, EvaluationConsensusResolution, EvaluationReviewerBallot, EvaluationSuite, EvaluationSuiteExecution, RunEvaluationRecord } from "./evaluation-v1.js";
import type { RunEvent } from "./execution-core.js";
import type { ExecutionPlan } from "./execution-plan-v1.js";
import type { AgentProfile, RunRecord } from "./execution-runs.js";
import type { TrustedReceiptEnvelopeBase as TrustedReceiptEnvelope } from "./receipt-trust-core-v1.js";
import type { SubagentTask } from "./subagent-supervisor.js";

export interface EvaluationQualificationBaseline {
  id: string;
  casebookId: string;
  casebookRevision: number;
  casebookRevisionSha256: string;
  qualificationExecutionId: string;
  qualificationExecutionSha256: string;
  envelope: TrustedReceiptEnvelope<EvaluationCasebookQualificationReceipt>;
  promotedByThreadId: string;
  supersedesBaselineId?: string;
  createdAt: string;
  contentSha256: string;
}

export interface PromoteEvaluationQualificationBaselineRequest {
  threadId: string;
  trustAnchorId: string;
}

export interface PromoteEvaluationQualificationBaselineResult {
  baseline: EvaluationQualificationBaseline;
  created: boolean;
}

export interface ThreadReplayBundle {
  kind: "napier.thread-replay";
  schemaVersion: 1;
  apiVersion: string;
  generatedAt: string;
  thread: ThreadRecord;
  agent: AgentProfile;
  agentRevisions?: AgentProfileRevision[];
  runs: RunRecord[];
  plans: ExecutionPlan[];
  evaluations: RunEvaluationRecord[];
  evaluationAdjudications?: EvaluationAdjudication[];
  evaluationReviewerBallots?: EvaluationReviewerBallot[];
  evaluationConsensusResolutions?: EvaluationConsensusResolution[];
  evaluationSuites?: EvaluationSuite[];
  evaluationSuiteExecutions?: EvaluationSuiteExecution[];
  automaticRecoveryAssessments?: AutomaticRecoveryAssessment[];
  automaticRecoveryAttempts?: AutomaticRecoveryAttempt[];
  subagents: SubagentTask[];
  events: RunEvent[];
  eventStreamSha256: string;
  contentSha256: string;
}

export interface ImportThreadReplayBundleRequest {
  bundle: ThreadReplayBundle;
  title?: string;
}

export interface VerifyThreadReplayBundleRequest {
  bundle: ThreadReplayBundle;
}

export type ThreadReplayBundleVerificationStatus = "valid" | "invalid";

export interface ThreadReplayBundleVerification {
  status: ThreadReplayBundleVerificationStatus;
  diagnostics: string[];
  eventCount: number;
  runCount: number;
  planCount: number;
  evaluationCount: number;
  modelContextEnvelopeCount: number;
  embeddedModelContextEnvelopeCount: number;
  threadId?: string;
  agentId?: string;
  contentSha256?: string;
  eventStreamSha256?: string;
}
