import type { PrivateWorkspaceProcessLaunchRequest } from "./workspace-process-launch.js";
import type { WorkspaceProcessManager } from "./workspace-processes.js";

export type NodeDebuggerProcessManager = Pick<
  WorkspaceProcessManager,
  | "resolveNodeDebuggerRuntime"
  | "startPrivateProtocol"
  | "writePrivateProtocolInput"
  | "outputPrivateProtocol"
  | "cancel"
>;

export function createPrivateWorkspaceNodeDebuggerProcesses(options: {
  processes: WorkspaceProcessManager;
  workspaceRoot: string;
  runtimeReadPaths?: readonly string[];
}): NodeDebuggerProcessManager {
  const runtimeReadPaths = [...(options.runtimeReadPaths ?? [])];
  return {
    resolveNodeDebuggerRuntime(request = {}) {
      return options.processes.resolveNodeDebuggerRuntime({
        ...request,
        workspaceRoot: options.workspaceRoot,
        ...(runtimeReadPaths.length > 0 ? { runtimeReadPaths } : {}),
      });
    },
    startPrivateProtocol(request) {
      const scoped: PrivateWorkspaceProcessLaunchRequest = {
        ...request,
        privateWorkspace: {
          workspaceRoot: options.workspaceRoot,
          ...(runtimeReadPaths.length > 0 ? { runtimeReadPaths } : {}),
        },
      };
      return options.processes.startPrivateProtocol(scoped);
    },
    writePrivateProtocolInput: (request) =>
      options.processes.writePrivateProtocolInput(request),
    outputPrivateProtocol: (threadId, processId, outputOptions) =>
      options.processes.outputPrivateProtocol(
        threadId,
        processId,
        outputOptions,
      ),
    cancel: (threadId, processId) =>
      options.processes.cancel(threadId, processId),
  };
}
