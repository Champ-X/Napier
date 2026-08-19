import type { RunRecord } from "@napier/contracts";

import type {
  ContinueOperatorDecisionOptions,
  ResumeInterruptedRunAutomaticallyOptions,
  ResumeInterruptedRunOptions,
  RunPromptOptions,
} from "./agent-runtime-options.js";
import type { ModelRegistry } from "./models.js";
import type { ToolInvocationResultCapsuleStore } from "./tool-invocation-result-capsule-store.js";

/**
 * Narrow production execution port shared by AgentRuntime and AgentKernel.
 * Product entry points depend on this contract so Kernel can own composition
 * without coupling callers to Runtime internals.
 */
export interface AgentExecutionPort {
  readonly modelRegistry: ModelRegistry;
  readonly toolInvocationResultCapsules: ToolInvocationResultCapsuleStore;
  runPrompt(options: RunPromptOptions): Promise<RunRecord>;
  resumeInterruptedRun(
    options: ResumeInterruptedRunOptions,
  ): Promise<RunRecord>;
  continueOperatorDecision(
    options: ContinueOperatorDecisionOptions,
  ): Promise<RunRecord>;
  resumeInterruptedRunAutomatically(
    options: ResumeInterruptedRunAutomaticallyOptions,
  ): Promise<RunRecord>;
  stop(threadId: string): boolean;
}
