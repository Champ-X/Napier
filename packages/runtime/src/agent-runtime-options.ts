import type {
  AutomaticRecoveryAssessment,
  AutomaticRecoveryAttempt,
  ModelRef,
  RunExecutionMode,
  RunInvocationSource,
  RunRecord,
} from "@napier/contracts";
import type { AgentCapabilityPresetId } from "@napier/contracts/agent-capabilities";

import type { EventSink } from "./event-sink.js";
import {
  AGENT_MESSAGE_EXPERIMENT_EXECUTION,
  type AgentMessageExperimentExecution,
} from "./agent-message-experiment-execution.js";
import {
  AGENT_MESSAGE_TOOL_RESULT_REPLAY,
  type FrozenToolResultReplayController,
} from "./agent-message-tool-result-replay.js";
import {
  SKILL_CONTINUATION_SNAPSHOT,
  type SkillContinuationSnapshot,
} from "./skill-load-replay.js";
import {
  WORKFLOW_NODE_EXECUTION,
  type WorkflowNodeExecution,
} from "./workflow-node-execution.js";

export interface RunPromptOptions {
  threadId: string;
  text: string;
  model?: ModelRef;
  agentRevision?: number;
  capabilityPreset?: AgentCapabilityPresetId | undefined;
  sourceContinuityRunId?: string;
  executionMode?: RunExecutionMode;
  signal?: AbortSignal;
  onEvent?: EventSink;
  onRunCreated?: (run: RunRecord) => Promise<void> | void;
  parentRunId?: string;
  operatorDecisionId?: string;
  source?: Exclude<
    RunInvocationSource,
    "workflow_reuse" | "workflow_simulation"
  >;
  triggerId?: string;
  [WORKFLOW_NODE_EXECUTION]?: WorkflowNodeExecution;
  [AGENT_MESSAGE_EXPERIMENT_EXECUTION]?: AgentMessageExperimentExecution;
  [AGENT_MESSAGE_TOOL_RESULT_REPLAY]?: FrozenToolResultReplayController;
  [SKILL_CONTINUATION_SNAPSHOT]?: SkillContinuationSnapshot;
  recovery?: {
    mode: "manual" | "automatic";
    attemptId?: string;
    assessmentSha256?: string;
  };
}

export interface ResumeInterruptedRunOptions {
  threadId: string;
  runId?: string;
  model?: ModelRef;
  signal?: AbortSignal;
  onEvent?: EventSink;
}

export interface ResumeInterruptedRunAutomaticallyOptions {
  assessment: AutomaticRecoveryAssessment;
  attempt: AutomaticRecoveryAttempt;
  signal?: AbortSignal;
  onEvent?: EventSink;
  onRunCreated?: (run: RunRecord) => Promise<void> | void;
}

export interface ContinueOperatorDecisionOptions {
  threadId: string;
  decisionId: string;
  signal?: AbortSignal;
  onEvent?: EventSink;
  onRunCreated?: (run: RunRecord) => Promise<void> | void;
}
