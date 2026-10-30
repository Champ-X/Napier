import type { Tool } from "@earendil-works/pi-ai";
import type { RunEvent } from "@napier/contracts";
import type { SubagentMessage } from "@napier/contracts/subagent-supervisor";
import type { SubagentChildCheckpointFence, SubagentChildRunFence, SubagentChildRunState } from "./subagent-execution-fence-types.js";

export interface SubagentWorkingSetReceipt {
  schemaVersion: 1;
  capsuleSha256: string;
  capsuleBytes: number;
  messageCount: number;
  messageSetSha256: string;
}

/** Captured before publishing the checkpoint itself; heartbeat revision is separate. */
export interface SubagentCheckpointFrontier {
  threadId: string;
  runId: string;
  taskId: string;
  executionId: string;
  parentRunId: string;
  parentConfigurationSha256: string;
  configurationSha256: string;
  executionRevision: number;
  checkpointRevision: number;
  runHeadSeq: number;
  nextInvocationIndex: number;
  usageSha256: string;
  turnCount: number;
  stepCount: number;
}
export interface SubagentMailboxAcceptedBinding {
  id: string;
  acceptedSeq: number;
  contentSha256: string;
  /** Digest of the deterministic user message for this accepted payload. */
  messageSha256: string;
  /** Present for immutable acceptance inherited from a predecessor Task. */
  originTaskId?: string;
  originParentRunId?: string;
}
export interface SubagentMailboxConsumedBinding extends SubagentMailboxAcceptedBinding {
  /** Original exact user-message digest; retained when later compaction projects it. */
  messageSha256: string;
  messageIndex: number;
}
export interface SubagentWorkingSetTranscriptEvidence {
  users: Array<{ messageIndex: number; messageSha256: string; contentSha256: string }>;
  /** Successful primary assistant messages only; route errors and auxiliary replies are excluded. */
  assistantMessageSha256s: string[];
  toolResults: Array<{ providerCallId: string; toolName: string; isError: boolean; outputTextSha256: string;
    resultContentSha256: string; resultDetailsSha256: string; resultPayloadSha256: string }>;
}
export interface SubagentWorkingSetBinding {
  transcript: SubagentWorkingSetTranscriptEvidence;
  receipt: SubagentWorkingSetReceipt;
  previousCapsuleSha256: string;
  previousMessageSetSha256: string;
  systemPromptSha256: string;
  toolDefinitionSetSha256: string;
  toolNames: string[];
  /** Derived from the validated private capsule; never a new authority grant. */
  tools: Tool[];
  frontier: SubagentCheckpointFrontier;
  mailbox: {
    /** Derived contiguous accepted prefix, never the maximum sparse entry. */
    consumedThroughSeq: number;
    entries: SubagentMailboxConsumedBinding[];
  };
}

declare const preparedWorkingSetBrand: unique symbol;
/** Minted by subagent-working-set-capsule only after the immutable file is durable. */
export interface PreparedSubagentWorkingSet { readonly [preparedWorkingSetBrand]: true }

export interface PrepareSubagentChildCheckpointResult {
  frontier: SubagentCheckpointFrontier;
  previousCheckpoint?: SubagentWorkingSetReceipt;
  mailbox: {
    accepted: SubagentMailboxAcceptedBinding[];
    consumed: SubagentMailboxConsumedBinding[];
    consumedThroughSeq: number;
  };
}
export interface CommitSubagentChildCheckpointInput extends SubagentChildCheckpointFence {
  prepared: PreparedSubagentWorkingSet;
}
export interface AcceptSubagentMessageInput {
  taskId: string;
  executionId: string;
  message: SubagentMessage;
}
export interface AcceptSubagentMessageResult { event: RunEvent; appended: boolean }
export interface SubagentCheckpointStore {
  prepareSubagentChildCheckpoint(input: SubagentChildRunFence): Promise<PrepareSubagentChildCheckpointResult>;
  commitSubagentChildCheckpoint(input: CommitSubagentChildCheckpointInput): Promise<SubagentChildRunState>;
}
