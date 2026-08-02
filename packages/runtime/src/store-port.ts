import type {
  AgentProfile,
  AgentProfileRevision,
  EvaluationCasebook,
  EvaluationCasebookQualificationExecution,
  EvaluationSuite,
  EvaluationSuiteExecution,
  EventCategory,
  EventVisibility,
  ExecutionPlan,
  ExecutionPlanBlueprintRecord,
  JsonValue,
  ModelRef,
  RunEvaluationRecord,
  RunEvent,
  RunRecord,
  SubagentTask,
  TerminalRunStatus,
  ThreadDetail,
  ThreadRecord,
} from "@napier/contracts";

export interface StoreAppendEventInput {
  threadId: string;
  runId: string;
  type: string;
  category: EventCategory;
  visibility?: EventVisibility;
  payload: JsonValue;
}

export interface StoreCreateRunInput {
  threadId: string;
  agentId: string;
  model?: ModelRef;
}

export interface RuntimeStorePort {
  appendEvent(input: StoreAppendEventInput): Promise<RunEvent>;
  createRun(input: StoreCreateRunInput): Promise<RunRecord>;
  finishRun(
    runId: string,
    status: TerminalRunStatus,
    options?: {
      error?: string;
      usage?: RunRecord["usage"];
    },
  ): Promise<RunRecord>;
  getAgent(agentId: string): AgentProfile;
  getDetail(threadId: string): Promise<ThreadDetail>;
  getEvaluationCasebook(casebookId: string): EvaluationCasebook;
  getEvaluationSuite(suiteId: string): EvaluationSuite;
  getExecutionPlanBlueprintRecord(
    recordId: string,
  ): ExecutionPlanBlueprintRecord;
  getPlan(planId: string): ExecutionPlan;
  getThread(threadId: string): ThreadRecord;
  listAgentRevisions(agentId: string): AgentProfileRevision[];
  listEvaluationCasebookQualificationExecutions(
    casebookId: string,
  ): EvaluationCasebookQualificationExecution[];
  listEvaluationSuiteExecutions(
    threadId: string,
    suiteId?: string,
  ): EvaluationSuiteExecution[];
  listEvents(threadId: string, afterSeq?: number): Promise<RunEvent[]>;
  listRunEvaluations(threadId: string): RunEvaluationRecord[];
  listRuns(threadId: string): RunRecord[];
  listSubagentTasks(threadId: string, runId?: string): SubagentTask[];
  saveEvaluationCasebookQualificationExecution(
    execution: EvaluationCasebookQualificationExecution,
  ): Promise<EvaluationCasebookQualificationExecution>;
  saveEvaluationSuiteExecution(
    execution: EvaluationSuiteExecution,
  ): Promise<EvaluationSuiteExecution>;
  saveRunEvaluation(
    evaluation: RunEvaluationRecord,
  ): Promise<RunEvaluationRecord>;
}

type ReplayStoreMethod =
  | "getDetail"
  | "getThread"
  | "listAgentRevisions"
  | "listEvents"
  | "listRuns"
  | "listSubagentTasks";

type RunEvaluationStoreMethod =
  | ReplayStoreMethod
  | "appendEvent"
  | "createRun"
  | "finishRun"
  | "getAgent"
  | "saveRunEvaluation";

export type EvaluationSuiteStorePort = Pick<
  RuntimeStorePort,
  | RunEvaluationStoreMethod
  | "getEvaluationSuite"
  | "listEvaluationSuiteExecutions"
  | "listRunEvaluations"
  | "saveEvaluationSuiteExecution"
>;

export type RunEvaluationStorePort = Pick<
  RuntimeStorePort,
  RunEvaluationStoreMethod
>;

export type EvaluationCasebookQualificationStorePort = Pick<
  RuntimeStorePort,
  | RunEvaluationStoreMethod
  | "getEvaluationCasebook"
  | "listEvaluationCasebookQualificationExecutions"
  | "saveEvaluationCasebookQualificationExecution"
>;

export type PlanArchiveStorePort = Pick<
  RuntimeStorePort,
  "getPlan" | "getThread" | "listEvents"
>;

export type ReplayStorePort = Pick<RuntimeStorePort, ReplayStoreMethod>;

export type WorkflowBlueprintStorePort = Pick<
  RuntimeStorePort,
  "getExecutionPlanBlueprintRecord" | "getPlan" | "getThread" | "listEvents"
>;
