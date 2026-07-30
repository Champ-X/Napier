import { AgentKernelRuntime } from "./agent-kernels.js";
import { NodeDebuggerManager } from "./node-debugger.js";
import { createNodeDebuggerTool } from "./node-debugger-tool.js";
import type { WorkspaceProcessManager } from "./workspace-processes.js";

export class AgentSessionRuntime {
  private readonly kernels: AgentKernelRuntime;
  private readonly debuggerManager: NodeDebuggerManager | undefined;

  constructor(
    processes: WorkspaceProcessManager | undefined,
    workspaceRoot: string,
  ) {
    this.kernels = new AgentKernelRuntime(processes);
    this.debuggerManager = processes
      ? new NodeDebuggerManager(processes, workspaceRoot)
      : undefined;
  }

  createTools(
    enabledTools: readonly string[],
    context: { threadId: string; runId: string },
  ): Array<
    | ReturnType<AgentKernelRuntime["createTools"]>[number]
    | ReturnType<typeof createNodeDebuggerTool>
  > {
    const tools: Array<
      | ReturnType<AgentKernelRuntime["createTools"]>[number]
      | ReturnType<typeof createNodeDebuggerTool>
    > = [...this.kernels.createTools(enabledTools, context)];
    if (enabledTools.includes("node_debugger") && this.debuggerManager) {
      tools.push(createNodeDebuggerTool(this.debuggerManager, context));
    }
    return tools;
  }

  async cancelRun(request: { threadId: string; runId: string }): Promise<void> {
    const settlements = await Promise.allSettled([
      this.kernels.cancelRun(request),
      ...(this.debuggerManager
        ? [this.debuggerManager.cancelRun(request)]
        : []),
    ]);
    const failure = settlements.find(
      (settlement): settlement is PromiseRejectedResult =>
        settlement.status === "rejected",
    );
    if (failure) throw failure.reason;
  }
}
