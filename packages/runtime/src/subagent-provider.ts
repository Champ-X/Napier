import type {
  SubagentCollectedOutcome,
  SubagentHandle,
  SubagentMessage,
  SubagentRequest,
  SubagentSnapshot,
} from "@napier/contracts/subagent-supervisor";

export interface SubagentContext {
  signal?: AbortSignal;
  failureContextSha256?: string;
}

/** Provider-neutral lifecycle boundary for supervised child execution. */
export interface SubagentProvider {
  readonly id: string;
  start(
    request: SubagentRequest,
    context: SubagentContext,
  ): Promise<SubagentHandle>;
  send(handle: SubagentHandle, message: SubagentMessage): Promise<void>;
  inspect(handle: SubagentHandle): Promise<SubagentSnapshot>;
  cancel(handle: SubagentHandle, reason: string): Promise<void>;
  collect(handle: SubagentHandle): Promise<SubagentCollectedOutcome>;
}
