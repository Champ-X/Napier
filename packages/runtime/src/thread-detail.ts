import type {
  AgentProfile,
  AutomaticRecoveryAssessment,
  AutomaticRecoveryAttempt,
  EvaluationAdjudication,
  EvaluationConsensusResolution,
  EvaluationReviewerBallot,
  EvaluationSuite,
  EvaluationSuiteExecution,
  ExecutionPlan,
  RunEvaluationRecord,
  RunEvent,
  RunRecord,
  SubagentTask,
  ThreadDetail,
  ThreadRecord,
} from "@napier/contracts";

import { inspectTaskDeliverables } from "./task-deliverable-inspection.js";
import { recoveryCheckpointFromOrchestration } from "./run-recovery-checkpoint.js";
import { projectRunOrchestrationState } from "./run-orchestration-projection.js";
import { latestPrimaryRun } from "./primary-run-selection.js";
import { createContextCheckpointCalibrationReport } from "./checkpoint-calibration.js";
import { projectOperatorDecisions } from "./operator-decisions.js";
import { projectRunControlMessages } from "./run-control-messages.js";
import { projectTaskNarrative } from "./task-narrative-projection.js";
import {
  activePlanEventWatermark,
  projectActivePlan,
} from "./active-plan-projection.js";
import { projectConversationMessages } from "./conversation-messages-projection.js";
import {
  applyConversationArtifactEvent,
  createConversationArtifactEventState,
  projectConversationArtifacts,
} from "./conversation-artifacts-projection.js";
import { projectConversationActivityEvents } from "./conversation-activity-events-projection.js";
import { projectConversationActivityCandidates } from "./conversation-activity-candidates-projection.js";
import { projectConversationCitations } from "./conversation-citations-projection.js";
import {
  applyConversationRecoveryEvent,
  createConversationRecoveryEventState,
  projectConversationRecoveries,
} from "./conversation-recoveries-projection.js";
import {
  applyConversationSubagentEvent,
  createConversationSubagentEventState,
  projectConversationSubagents,
} from "./conversation-subagents-projection.js";
import {
  applyConversationPlanEvent,
  createConversationPlanEventState,
  projectConversationPlans,
} from "./conversation-plans-projection.js";

interface ThreadDetailSource {
  workspaceRoot?: string;
  getThread(threadId: string): ThreadRecord;
  getAgent(agentId: string): AgentProfile;
  listRuns(threadId: string): RunRecord[];
  listPlans(threadId: string): ExecutionPlan[];
  listRunEvaluations(threadId: string): RunEvaluationRecord[];
  listEvaluationAdjudications(threadId: string): EvaluationAdjudication[];
  listEvaluationReviewerBallots(threadId: string): EvaluationReviewerBallot[];
  listEvaluationConsensusResolutions(
    threadId: string,
  ): EvaluationConsensusResolution[];
  listEvaluationSuites(threadId: string): EvaluationSuite[];
  listEvaluationSuiteExecutions(threadId: string): EvaluationSuiteExecution[];
  listAutomaticRecoveryAssessments(
    threadId: string,
  ): AutomaticRecoveryAssessment[];
  listAutomaticRecoveryAttempts(threadId: string): AutomaticRecoveryAttempt[];
  listSubagentTasks(threadId: string): SubagentTask[];
  listEvents(threadId: string): Promise<RunEvent[]>;
}

function foldConversationProjectionStates(events: readonly RunEvent[]) {
  let artifactState = createConversationArtifactEventState();
  let recoveryState = createConversationRecoveryEventState();
  let subagentState = createConversationSubagentEventState();
  let conversationPlanState = createConversationPlanEventState();
  let activePlanWatermark = 0;
  for (const event of events) {
    artifactState = applyConversationArtifactEvent(artifactState, event);
    recoveryState = applyConversationRecoveryEvent(recoveryState, event);
    subagentState = applyConversationSubagentEvent(subagentState, event);
    conversationPlanState = applyConversationPlanEvent(
      conversationPlanState,
      event,
    );
    activePlanWatermark = activePlanEventWatermark(activePlanWatermark, event);
  }
  return {
    artifactState,
    recoveryState,
    subagentState,
    conversationPlanState,
    activePlanWatermark,
  };
}

export async function loadThreadDetail(
  source: ThreadDetailSource,
  threadId: string,
  options?: { kernelProjections?: boolean },
): Promise<ThreadDetail> {
  const thread = source.getThread(threadId);
  const events = await source.listEvents(threadId);
  const detail = createThreadDetail(
    {
      thread,
      agent: source.getAgent(thread.agentId),
      runs: source.listRuns(threadId),
      plans: source.listPlans(threadId),
      evaluations: source.listRunEvaluations(threadId),
      evaluationAdjudications: source.listEvaluationAdjudications(threadId),
      evaluationReviewerBallots: source.listEvaluationReviewerBallots(threadId),
      evaluationConsensusResolutions:
        source.listEvaluationConsensusResolutions(threadId),
      evaluationSuites: source.listEvaluationSuites(threadId),
      evaluationSuiteExecutions: source.listEvaluationSuiteExecutions(threadId),
      automaticRecoveryAssessments:
        source.listAutomaticRecoveryAssessments(threadId),
      automaticRecoveryAttempts: source.listAutomaticRecoveryAttempts(threadId),
      subagents: source.listSubagentTasks(threadId),
      events,
    },
    options,
  );
  if (detail.taskNarrative)
    detail.taskNarrative = await inspectTaskDeliverables(
      detail.taskNarrative,
      source.workspaceRoot,
    );
  return detail;
}

export function createThreadDetail(
  input: {
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
    events: RunEvent[];
  },
  options?: { kernelProjections?: boolean },
): ThreadDetail {
  const primaryRun = latestPrimaryRun(input.runs);
  const orchestrationState =
    primaryRun &&
    ["interrupted", "failed", "running", "queued"].includes(primaryRun.status)
      ? projectRunOrchestrationState(primaryRun, input.events, input.runs)
      : undefined;
  const recoveryCheckpoint =
    orchestrationState &&
    (primaryRun?.status === "interrupted" || primaryRun?.status === "failed")
      ? recoveryCheckpointFromOrchestration(orchestrationState)
      : undefined;
  const detail = {
    ...input,
    ...(recoveryCheckpoint ? { recoveryCheckpoint } : {}),
    ...(orchestrationState ? { orchestrationState } : {}),
    runControlMessages: projectRunControlMessages(input.events),
    operatorDecisions:
      options?.kernelProjections === false
        ? []
        : projectOperatorDecisions(input.events),
    contextCheckpointCalibration: createContextCheckpointCalibrationReport(
      input.thread.id,
      input.events,
    ),
  };
  if (options?.kernelProjections === false) return detail;
  const folded = foldConversationProjectionStates(input.events);
  const activePlan = projectActivePlan(input.plans, folded.activePlanWatermark);
  const artifactState = folded.artifactState;
  const recoveryState = folded.recoveryState;
  const subagentState = folded.subagentState;
  const conversationPlanState = folded.conversationPlanState;
  return {
    ...detail,
    messages: projectConversationMessages(input.events),
    artifacts: projectConversationArtifacts(
      input.plans,
      input.runs,
      artifactState,
    ),
    activityEvents: projectConversationActivityEvents(input.events),
    activityCandidates: projectConversationActivityCandidates(input.events),
    citations: projectConversationCitations(input.events),
    recoveries: projectConversationRecoveries(
      input.automaticRecoveryAssessments,
      input.automaticRecoveryAttempts,
      recoveryState,
    ),
    subagentCards: projectConversationSubagents(input.subagents, subagentState),
    conversationPlans: projectConversationPlans(
      input.plans,
      input.runs,
      conversationPlanState,
      activePlan,
    ),
    taskNarrative: projectTaskNarrative(detail, input.events),
    ...(activePlan ? { activePlan } : {}),
  };
}
