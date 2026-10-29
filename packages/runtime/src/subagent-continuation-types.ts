import type { Message, Tool } from "@earendil-works/pi-ai";
import type { AgentProfile, RunRecord, SubagentContinuationBudget, SubagentContinuationGrant,
  SubagentContinuationReceipt, SubagentRole, SubagentTask } from "@napier/contracts";
import type { SubagentMessage } from "@napier/contracts/subagent-supervisor";
import type { SubagentChildRunState } from "./subagent-execution-fence-types.js";
import type { SubagentMailboxAcceptedBinding, SubagentMailboxConsumedBinding } from "./subagent-working-set-types.js";

declare const preparedBrand: unique symbol;
declare const authorizationBrand: unique symbol;
declare const restoreBrand: unique symbol;
export interface PreparedSubagentChildContinuation { readonly [preparedBrand]: true }
export interface SubagentChildContinuationAuthorization { readonly [authorizationBrand]: true }
export interface SubagentChildRestoreSource { readonly [restoreBrand]: true }

export interface SubagentChildContinuationAssessment {
  kind: "napier.subagent-continuation-assessment";
  schemaVersion: 1;
  threadId: string;
  sourceTaskId: string;
  sourceRunId: string;
  sourceExecutionId: string;
  sourceParentRunId: string;
  sourceTaskRevision: number;
  sourceExecutionRevision: number;
  sourceRunHeadSeq: number;
  sourceParentHeadSeq: number;
  sourceConfigurationSha256: string;
  sourceParentConfigurationSha256: string;
  targetParentRunId: string;
  targetParentConfigurationSha256: string;
  sourceCheckpointRevision: number;
  checkpointOwner: { taskId: string; runId: string; executionId: string; parentRunId: string };
  sourceCapsuleSha256: string;
  sourceMessageCount: number;
  sourceMessageSetSha256: string;
  role: SubagentRole;
  promptSha256: string;
  outputSchemaSha256?: string;
  systemPromptSha256: string;
  toolDefinitionSetSha256: string;
  toolNames: string[];
  mode: "continue" | "finalize";
  budget: SubagentContinuationBudget;
  mailboxSnapshotSha256: string;
  contentSha256: string;
}

export type SubagentContinuationUnavailableReason = "source_not_interrupted" | "source_missing"
  | "source_already_completed" | "private_state_unavailable" | "checkpoint_tail_uncovered"
  | "usage_incomplete" | "unsafe_tool_frontier" | "unsupported_coder" | "deadline_exhausted"
  | "budget_exhausted" | "workspace_context_unverifiable" | "parent_authority_unavailable" | "completion_reconciliation_required"
  | "source_tail_unresumable";
export interface PrepareSubagentChildContinuationInput { sourceTaskId: string; targetParentRunId: string }
export type PrepareSubagentChildContinuationResult =
  | { kind: "ready"; prepared: PreparedSubagentChildContinuation; assessment: SubagentChildContinuationAssessment }
  | { kind: "unavailable"; reason: SubagentContinuationUnavailableReason };

export interface StartSubagentChildContinuationInput {
  prepared: PreparedSubagentChildContinuation;
  authorization: SubagentChildContinuationAuthorization;
  lease: { ownerId: string; ttlMs: number };
}
export interface StartedSubagentChildContinuation {
  kind: "started";
  execution: SubagentChildRunState & { token: string; profile: AgentProfile };
  restore: SubagentChildRestoreSource;
  budget: SubagentContinuationBudget;
}
export type StartSubagentChildContinuationResult = StartedSubagentChildContinuation
  | { kind: "existing"; run: RunRecord; task: SubagentTask; continuation: SubagentContinuationReceipt };

export interface RestoredSubagentMailboxMessage {
  message: SubagentMessage;
  accepted: SubagentMailboxAcceptedBinding;
}
/** Private process capability output; never serialize this to Run/Task/event/API projections. */
export interface SubagentChildRestoreData {
  runId: string;
  taskId: string;
  executionId: string;
  messages: Message[];
  systemPrompt: string;
  tools: Tool[];
  mode: "continue" | "finalize";
  continuation: SubagentContinuationReceipt;
  budget: SubagentContinuationBudget;
  mailbox: {
    accepted: SubagentMailboxAcceptedBinding[];
    consumed: SubagentMailboxConsumedBinding[];
    pending: RestoredSubagentMailboxMessage[];
  };
}

/** Root-owned authorization resolves against fresh durable records inside the claim transaction. */
export interface ResolveSubagentContinuationAuthorizationInput {
  authorization: SubagentChildContinuationAuthorization;
  assessment: SubagentChildContinuationAssessment;
  sourceRun: RunRecord;
  sourceTask: SubagentTask;
  sourceParent: RunRecord;
  targetParent: RunRecord;
  currentConfiguredProfile: AgentProfile;
}
export interface ResolvedSubagentContinuationAuthorization {
  profile: AgentProfile;
  grant: SubagentContinuationGrant;
}
