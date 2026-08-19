import type { RunRecord } from "@napier/contracts";

import type { RunPromptOptions } from "./agent-runtime-options.js";
import type { OsSandboxAdapter } from "./sandbox.js";
import type { WorkspaceFileMutationManager } from "./workspace-file-mutations.js";
import type { WorkspaceProcessManager } from "./workspace-processes.js";

/** Agent-backed Workflow nodes use the Kernel-owned production entry point. */
export interface WorkflowAgentExecutionPort {
  runPrompt(options: RunPromptOptions): Promise<RunRecord>;
}

/**
 * Deterministic Workflow nodes keep their concrete safety dependencies separate
 * from model execution so Kernel composition cannot replace or bypass them.
 */
export interface WorkflowRuntimeEnvironment {
  readonly verificationSandbox: OsSandboxAdapter;
  readonly workspaceProcesses?: WorkspaceProcessManager | undefined;
  readonly workspaceFileMutations?: WorkspaceFileMutationManager | undefined;
}

export function resolveWorkflowRuntimeEnvironment(
  execution: WorkflowAgentExecutionPort,
  environment?: WorkflowRuntimeEnvironment,
): WorkflowRuntimeEnvironment {
  if (environment) return environment;
  if (hasWorkflowRuntimeEnvironment(execution)) return execution;
  throw new Error(
    "Workflow runtime environment is required when execution is Kernel-owned",
  );
}

function hasWorkflowRuntimeEnvironment(
  value: WorkflowAgentExecutionPort,
): value is WorkflowAgentExecutionPort & WorkflowRuntimeEnvironment {
  return (
    "verificationSandbox" in value &&
    typeof value.verificationSandbox === "object" &&
    value.verificationSandbox !== null
  );
}
