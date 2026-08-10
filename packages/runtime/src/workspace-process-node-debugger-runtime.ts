import type { CommandRunnerOptions } from "./command-execution.js";
import {
  resolveNodeDebuggerRuntime,
  type NodeDebuggerRuntimeIdentity,
} from "./node-debugger-runtime.js";

export async function resolveWorkspaceProcessNodeDebuggerRuntime(
  manager: CommandRunnerOptions,
  options: WorkspaceProcessNodeDebuggerRuntimeOptions,
): Promise<NodeDebuggerRuntimeIdentity> {
  const runtimeReadPaths = [
    ...(manager.runtimeReadPaths ?? []),
    ...(options.runtimeReadPaths ?? []),
  ];
  return resolveNodeDebuggerRuntime({
    sandbox: manager.sandbox,
    workspaceRoot: options.workspaceRoot ?? manager.workspaceRoot,
    ...(manager.executables?.node
      ? { nodeExecutable: manager.executables.node }
      : {}),
    ...(runtimeReadPaths.length > 0 ? { runtimeReadPaths } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  });
}

export interface WorkspaceProcessNodeDebuggerRuntimeOptions {
  workspaceRoot?: string;
  runtimeReadPaths?: readonly string[];
  signal?: AbortSignal;
}
