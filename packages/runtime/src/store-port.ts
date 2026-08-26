import type {
  AgentProfile,
  AgentProfileRevision,
  EvaluationCasebook,
  EvaluationCasebookQualificationExecution,
  EvaluationSuite,
  EvaluationSuiteExecution,
  ExecutionPlan,
  ExecutionPlanBlueprintRecord,
  InboundChannel,
  InboundDelivery,
  InboundMessageRequest,
  InboundReceipt,
  ModelRef,
  RunEvaluationRecord,
  RunEvent,
  RunRecord,
  SubagentTask,
  TerminalRunStatus,
  ThreadDetail,
  ThreadRecord,
} from "@napier/contracts";
import type { AppendEventInput } from "./run-event-registry.js";

export type StoreAppendEventInput = AppendEventInput;

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
      outcome?: NonNullable<RunRecord["outcome"]>;
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

export interface ChannelDeliveryExecution {
  delivery: InboundDelivery;
  message: string;
  model?: InboundMessageRequest["model"];
}

export interface ChannelStorePort extends Pick<
  RuntimeStorePort,
  "appendEvent" | "getAgent" | "getThread"
> {
  acceptInboundDelivery(
    channelId: string,
    token: string,
    request: InboundMessageRequest,
  ): Promise<InboundReceipt>;
  retryInboundDelivery(
    channelId: string,
    deliveryId: string,
    now?: Date,
  ): Promise<InboundDelivery>;
  getInboundChannel(channelId: string): InboundChannel;
  listInboundDeliveries(channelId?: string): InboundDelivery[];
  listRunnableInboundDeliveryIds(now?: Date): string[];
  claimInboundDelivery(
    deliveryId: string,
    now?: Date,
  ): Promise<ChannelDeliveryExecution | undefined>;
  getRunByTriggerId(triggerId: string): RunRecord | undefined;
  finishInboundDelivery(
    deliveryId: string,
    input:
      | { status: "completed"; runId: string }
      | { status: "failed"; error: string; runId?: string },
  ): Promise<InboundDelivery>;
  scheduleInboundDeliveryRetry(
    deliveryId: string,
    error: string,
    delayMs: number,
    now?: Date,
  ): Promise<InboundDelivery>;
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

export type CasebookReceiptStorePort = Pick<
  RuntimeStorePort,
  "getEvaluationCasebook" | "listEvaluationCasebookQualificationExecutions"
>;

export type SuiteGateReceiptStorePort = Pick<
  RuntimeStorePort,
  "getEvaluationSuite" | "listEvaluationSuiteExecutions" | "listRunEvaluations"
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
