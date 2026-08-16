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

import { createContextCheckpointCalibrationReport } from "./checkpoint-calibration.js";
import { projectOperatorDecisions } from "./operator-decisions.js";
import { projectRunControlMessages } from "./run-control-messages.js";
import { projectTaskNarrative } from "./task-narrative-projection.js";
import {
  projectActivePlan,
  projectActivePlanEventWatermark,
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

export async function loadThreadDetail(
  source: ThreadDetailSource,
  threadId: string,
  options?: { kernelProjections?: boolean },
): Promise<ThreadDetail> {
  const thread = source.getThread(threadId);
  const events = await source.listEvents(threadId);
  return createThreadDetail(
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
  const detail = {
    ...input,
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
  const activePlan = projectActivePlan(
    input.plans,
    projectActivePlanEventWatermark(input.events),
  );
  const artifactState = input.events.reduce(
    applyConversationArtifactEvent,
    createConversationArtifactEventState(),
  );
  const recoveryState = input.events.reduce(
    applyConversationRecoveryEvent,
    createConversationRecoveryEventState(),
  );
  const subagentState = input.events.reduce(
    applyConversationSubagentEvent,
    createConversationSubagentEventState(),
  );
  const conversationPlanState = input.events.reduce(
    applyConversationPlanEvent,
    createConversationPlanEventState(),
  );
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
