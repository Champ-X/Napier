import { NodeDebuggerManager } from "./node-debugger.js";
import { createPrivateWorkspaceNodeDebuggerProcesses } from "./node-debugger-process.js";
import type { SubagentWorktreeSession } from "./subagent-worktree-files.js";
import type { SubagentWorktreeToolchain } from "./subagent-worktree-toolchain.js";
import type { SubagentWorktreeOperationCoordinator } from "./subagent-worktree-verification.js";
import type { WorkspaceProcessManager } from "./workspace-processes.js";

export interface SubagentWorktreeDebuggerOwner {
  threadId: string;
  runId: string;
}

export interface SubagentWorktreeDebugger {
  manager: NodeDebuggerManager;
  owner: SubagentWorktreeDebuggerOwner;
}

export function createSubagentWorktreeDebugger(options: {
  processes: WorkspaceProcessManager;
  session: SubagentWorktreeSession;
  owner: SubagentWorktreeDebuggerOwner;
  toolchain?: SubagentWorktreeToolchain;
}): SubagentWorktreeDebugger {
  const runtimeReadPaths = options.toolchain
    ? [options.toolchain.sourceNodeModulesRoot]
    : [];
  return {
    manager: new NodeDebuggerManager(
      createPrivateWorkspaceNodeDebuggerProcesses({
        processes: options.processes,
        workspaceRoot: options.session.root,
        ...(runtimeReadPaths.length > 0 ? { runtimeReadPaths } : {}),
      }),
      options.session.root,
    ),
    owner: { ...options.owner },
  };
}

export async function settleSubagentWorktreeDebugger(options: {
  debugger: SubagentWorktreeDebugger;
  operations: SubagentWorktreeOperationCoordinator;
  session: SubagentWorktreeSession;
}): Promise<void> {
  await options.operations.runReadOnlyOperation(
    "node_debugger_cleanup",
    options.session,
    () => options.debugger.manager.cancelRun(options.debugger.owner),
  );
}
