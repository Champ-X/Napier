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
): Promise<ThreadDetail> {
  const thread = source.getThread(threadId);
  const events = await source.listEvents(threadId);
  return createThreadDetail({
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
  });
}

export function createThreadDetail(input: {
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
}): ThreadDetail {
  return {
    ...input,
    runControlMessages: projectRunControlMessages(input.events),
    operatorDecisions: projectOperatorDecisions(input.events),
    contextCheckpointCalibration: createContextCheckpointCalibrationReport(
      input.thread.id,
      input.events,
    ),
  };
}
