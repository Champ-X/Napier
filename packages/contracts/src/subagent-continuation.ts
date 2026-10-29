import type { RunLimits, Usage } from "./execution-core.js";

/** Logical identity spans continuation attempts; a user-requested retry starts a new root. */
export interface SubagentLogicalIdentity {
  logicalTaskId: string;
  rootChildRunId: string;
  rootParentRunId: string;
  rootExecutionId: string;
  rootIntentSha256: string;
}

/** Admission baseline only. Never add inherited usage to a successor's canonical Run usage. */
export interface SubagentContinuationBudget extends SubagentLogicalIdentity {
  inheritedUsage: Usage;
  inheritedTurnCount: number;
  inheritedStepCount: number;
  originalStartedAt: string;
  deadlineAt: string;
  limits: RunLimits;
  delegationOrdinal: number;
  continuationOrdinal: number;
}

export interface SubagentContinuationGrant {
  kind: "napier.subagent-continuation-grant";
  schemaVersion: 1;
  assessmentSha256: string;
  sourceTaskId: string;
  sourceRunId: string;
  sourceExecutionId: string;
  sourceParentRunId: string;
  sourceParentConfigurationSha256: string;
  sourceConfigurationSha256: string;
  targetParentRunId: string;
  targetParentConfigurationSha256: string;
  systemPromptSha256: string;
  toolDefinitionSetSha256: string;
  toolNames: string[];
  contentSha256: string;
}

/** Public provenance only; the raw transcript and mailbox bodies remain private. */
export interface SubagentContinuationReceipt {
  kind: "napier.subagent-continuation";
  schemaVersion: 1;
  predecessorTaskId: string;
  predecessorRunId: string;
  predecessorExecutionId: string;
  predecessorTaskRevision: number;
  predecessorRunHeadSeq: number;
  sourceTaskId: string;
  sourceRunId: string;
  sourceExecutionId: string;
  sourceParentRunId: string;
  sourceCheckpointRevision: number;
  sourceCapsuleSha256: string;
  sourceMessageCount: number;
  sourceMessageSetSha256: string;
  targetTaskId: string;
  targetRunId: string;
  targetExecutionId: string;
  targetParentRunId: string;
  grant: SubagentContinuationGrant;
  budget: SubagentContinuationBudget;
  mailboxSnapshotSha256: string;
  contentSha256: string;
}
