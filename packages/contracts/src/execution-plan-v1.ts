import type { JsonValue, ModelRef, RunEvent } from "./execution-core.js";
import type { ModelInvocationPurpose } from "./execution-experiments.js";
import type { AgentProfile } from "./execution-runs.js";
import type { ArtifactManifestEntry, ArtifactManifestStatus, CreateExecutionPlanRequest, ExecutionPlanBlueprint, ExecutionPlanStatus, ExecutionPlanWorkflowManifest, PlanStepStatus, WorkflowObjectSchema } from "./execution-workflows.js";
import type { ModelContextEnvelopeReceipt } from "./model-context-envelope.js";

export type ExecutionPlanReplanStrategy = "recover_blocked" | "scope_change" | "artifact_drift";

export interface PlanStep {
  id: string;
  title: string;
  description: string;
  verification: string;
  dependsOn: string[];
  status: PlanStepStatus;
  evidence: string;
  blocker?: string;
  runId?: string;
  startedAt?: string;
  finishedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ExecutionPlanReplanRecord {
  id: string;
  strategy: ExecutionPlanReplanStrategy;
  reason: string;
  evidence: string;
  supersededStepIds: string[];
  supersededArtifactIds: string[];
  dependencyUpdatedStepIds: string[];
  addedStepIds: string[];
  addedArtifactIds: string[];
  addedStepsSha256: string;
  addedArtifactsSha256: string;
  dependencyUpdatesSha256: string;
  fromRevision: number;
  toRevision: number;
  replanSha256: string;
  createdAt: string;
}

export type ExecutionPlanReplanPolicyPosture = "conservative" | "balanced" | "expansive";

export type ExecutionPlanReplanDraftEvaluationRisk = "low" | "medium" | "high";

export type ExecutionPlanReplanDraftEvaluationSeverity = "info" | "warning" | "blocking";

export interface ExecutionPlanReplanDraftEvaluationCheck {
  id: string;
  severity: ExecutionPlanReplanDraftEvaluationSeverity;
  passed: boolean;
  detail: string;
}

export interface ExecutionPlanReplanDraftEvaluation {
  policyId: string;
  posture: ExecutionPlanReplanPolicyPosture;
  score: number;
  risk: ExecutionPlanReplanDraftEvaluationRisk;
  maxDraftSteps: number;
  addStepCount: number;
  addArtifactCount: number;
  dependencyUpdateCount: number;
  supersedeStepCount: number;
  supersedeArtifactCount: number;
  checks: ExecutionPlanReplanDraftEvaluationCheck[];
  evaluationSha256: string;
}

export type ExecutionPlanReplanDraftReviewVerdict = "approve" | "revise" | "reject" | "inconclusive";

export interface ExecutionPlanReplanDraftModelReview {
  kind: "napier.execution-plan-replan-draft-review";
  schemaVersion: 1;
  policyId: string;
  planId: string;
  threadId: string;
  expectedRevision: number;
  recommendationSha256: string;
  draftSha256: string;
  deterministicEvaluationSha256: string;
  model: ModelRef;
  verdict: ExecutionPlanReplanDraftReviewVerdict;
  score: number;
  risk: ExecutionPlanReplanDraftEvaluationRisk;
  reason: string;
  concerns: string[];
  inputSha256: string;
  promptSha256: string;
  responseSha256: string;
  reviewSchemaSha256: string;
  modelContextEnvelope?: ModelContextEnvelopeReceipt;
  reviewSha256: string;
  createdAt: string;
}

export interface ExecutionPlanReplanDraft {
  policyId: string;
  request: ReplanExecutionPlanRequest;
  draftSha256: string;
  evaluation: ExecutionPlanReplanDraftEvaluation;
}

export interface ExecutionPlanReplanPolicyTemplate {
  id: string;
  label: string;
  model: ModelRef;
  thinkingLevel: AgentProfile["thinkingLevel"];
  posture: ExecutionPlanReplanPolicyPosture;
  maxDraftSteps: number;
  checklist: string[];
  instruction: string;
  templateSha256: string;
}

export interface ExecutionPlanReplanRecommendation {
  strategy: ExecutionPlanReplanStrategy;
  reason: string;
  evidence: string;
  expectedRevision: number;
  supersedeStepIds: string[];
  supersedeArtifactIds: string[];
  affectedStepIds: string[];
  affectedArtifactIds: string[];
  draft: ExecutionPlanReplanDraft;
  recommendationSha256: string;
}

export interface ExecutionPlanPhaseWave {
  index: number;
  stepIds: string[];
  pendingStepIds: string[];
  readyStepIds: string[];
  runningStepIds: string[];
  blockedStepIds: string[];
  terminalStepIds: string[];
  waveSha256: string;
}

export interface ExecutionPlan {
  id: string;
  threadId: string;
  objective: string;
  status: ExecutionPlanStatus;
  steps: PlanStep[];
  artifacts: ArtifactManifestEntry[];
  replans: ExecutionPlanReplanRecord[];
  replanRecommendation: ExecutionPlanReplanRecommendation | null;
  criticalPathStepIds: string[];
  readyStepIds: string[];
  blockedStepIds: string[];
  phaseWaves: ExecutionPlanPhaseWave[];
  activePhaseIndex: number | null;
  parallelReadyStepIds: string[];
  phaseProjectionSha256: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface ReplanExecutionPlanRequest {
  expectedRevision: number;
  strategy: ExecutionPlanReplanStrategy;
  reason: string;
  evidence: string;
  supersedeStepIds?: string[];
  supersedeArtifactIds?: string[];
  dependencyUpdates?: Array<{
    stepId: string;
    dependsOn: string[];
  }>;
  addSteps?: CreateExecutionPlanRequest["steps"];
  addArtifacts?: CreateExecutionPlanRequest["artifacts"];
}

export interface ReviewExecutionPlanReplanDraftRequest {
  model?: ModelRef;
}

export interface TransitionPlanStepRequest {
  action: "start" | "complete" | "block" | "skip" | "reopen";
  runId?: string;
  evidence?: string;
  blocker?: string;
}

export interface UpdateArtifactManifestRequest {
  status: ArtifactManifestStatus;
  sha256?: string;
  sizeBytes?: number;
  sourceRunId?: string;
  evidence?: string;
  observeWorkspace?: boolean;
  confirmedDrift?: boolean;
}

export interface ExecutionPlanArchive {
  kind: "napier.execution-plan-archive";
  schemaVersion: 1;
  apiVersion: string;
  generatedAt: string;
  threadId: string;
  plan: ExecutionPlan;
  events: RunEvent[];
  eventStreamSha256: string;
  contentSha256: string;
}

export interface VerifyExecutionPlanArchiveRequest {
  archive: ExecutionPlanArchive;
}

export type ExecutionPlanArchiveVerificationStatus = "valid" | "invalid";

export interface ExecutionPlanArchiveVerification {
  status: ExecutionPlanArchiveVerificationStatus;
  diagnostics: string[];
  eventCount: number;
  stepCount: number;
  artifactCount: number;
  replanCount: number;
  threadId?: string;
  planId?: string;
  revision?: number;
  contentSha256?: string;
  eventStreamSha256?: string;
}

export interface VerifyExecutionPlanBlueprintRequest {
  blueprint: ExecutionPlanBlueprint;
}

export type ExecutionPlanBlueprintVerificationStatus = "valid" | "invalid";

export interface ExecutionPlanBlueprintVerification {
  status: ExecutionPlanBlueprintVerificationStatus;
  diagnostics: string[];
  stepCount: number;
  artifactCount: number;
  contentSha256?: string;
  sourceThreadId?: string;
  sourcePlanId?: string;
  sourcePlanRevision?: number;
  sourcePlanArchiveSha256?: string;
  sourceEventStreamSha256?: string;
}

export interface CreateExecutionPlanFromBlueprintRequest {
  blueprint: ExecutionPlanBlueprint;
  objective?: string;
}

export const EXECUTION_PLAN_WORKFLOW_APPROVAL_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    approved: { type: "boolean" },
    decisionId: { type: "string", minLength: 17, maxLength: 89 },
    selectedOptionId: {
      type: "string",
      enum: ["option_1"],
      minLength: 8,
      maxLength: 8,
    },
    answerSha256: { type: "string", minLength: 64, maxLength: 64 },
    customText: { type: "string", minLength: 0, maxLength: 4_096 },
  },
  required: ["approved", "decisionId", "selectedOptionId", "answerSha256", "customText"],
  additionalProperties: false,
} as const satisfies WorkflowObjectSchema;

export interface ExecutionPlanWorkflowManifestVerification {
  status: "valid" | "invalid";
  diagnostics: string[];
  nodeCount: number;
  contentSha256?: string;
  blueprintSha256?: string;
  inputSchemaSha256?: string;
  outputSchemaSha256?: string;
}

export type ExecuteExecutionPlanWorkflowRequest =
  | {
      manifest: ExecutionPlanWorkflowManifest;
      input: JsonValue;
      breakBeforeNodeIds?: string[];
      planId?: never;
      retryBlocked?: never;
      continueBreakpoint?: never;
    }
  | {
      manifest: ExecutionPlanWorkflowManifest;
      planId: string;
      retryBlocked?: boolean;
      continueBreakpoint?: boolean;
      input?: never;
      breakBeforeNodeIds?: never;
    };

export interface ModelInvocationCapsuleReceipt {
  kind: "napier.model-invocation-capsule-receipt";
  schemaVersion: 1;
  turnIndex: number;
  purpose: ModelInvocationPurpose;
  model: ModelRef;
  contextEnvelopeSha256: string;
  contextSha256: string;
  capsuleSha256: string;
  capsuleBytes: number;
  storage: "local_only";
  contentSha256: string;
}

export interface ToolInvocationCapsuleReceipt {
  kind: "napier.tool-invocation-capsule-receipt";
  schemaVersion: 1;
  callId: string;
  toolName: string;
  effect: "read";
  toolDefinitionSha256: string;
  argumentsSha256: string;
  workspaceScopeSha256: string;
  capsuleSha256: string;
  capsuleBytes: number;
  storage: "local_only";
  contentSha256: string;
}

export interface ToolInvocationResultCapsuleReceipt {
  kind: "napier.tool-invocation-result-capsule-receipt";
  schemaVersion: 1;
  callId: string;
  toolName: string;
  invocationCapsuleSha256: string;
  toolDefinitionSha256: string;
  argumentsSha256: string;
  isError: boolean;
  resultSha256: string;
  outputTextSha256: string;
  outputTextBytes: number;
  capsuleSha256: string;
  capsuleBytes: number;
  storage: "local_only";
  contentSha256: string;
}
