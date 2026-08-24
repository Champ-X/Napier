import { JavascriptKernelManager } from "./javascript-kernel.js";
import { createJavascriptKernelTool } from "./javascript-kernel-tool.js";
import { PythonKernelManager } from "./python-kernel.js";
import { createPythonKernelTool } from "./python-kernel-tool.js";
import type { WorkspaceProcessManager } from "./workspace-processes.js";
import type { GovernedCodeBridgeDispatcher } from "./governed-code-bridge-model.js";

export class AgentKernelRuntime {
  private readonly javascript: JavascriptKernelManager | undefined;
  private readonly python: PythonKernelManager | undefined;

  constructor(processes?: WorkspaceProcessManager) {
    this.javascript = processes
      ? new JavascriptKernelManager(processes)
      : undefined;
    this.python = processes ? new PythonKernelManager(processes) : undefined;
  }

  createTools(
    enabledTools: readonly string[],
    context: { threadId: string; runId: string },
    codeBridge?: GovernedCodeBridgeDispatcher,
  ): Array<
    | ReturnType<typeof createJavascriptKernelTool>
    | ReturnType<typeof createPythonKernelTool>
  > {
    const tools: Array<
      | ReturnType<typeof createJavascriptKernelTool>
      | ReturnType<typeof createPythonKernelTool>
    > = [];
    if (enabledTools.includes("javascript_kernel") && this.javascript) {
      tools.push(
        createJavascriptKernelTool(this.javascript, context, codeBridge),
      );
    }
    if (enabledTools.includes("python_kernel") && this.python) {
      tools.push(createPythonKernelTool(this.python, context, codeBridge));
    }
    return tools;
  }

  async cancelRun(request: { threadId: string; runId: string }): Promise<void> {
    const settlements = await Promise.allSettled([
      ...(this.javascript ? [this.javascript.cancelRun(request)] : []),
      ...(this.python ? [this.python.cancelRun(request)] : []),
    ]);
    const failure = settlements.find(
      (settlement): settlement is PromiseRejectedResult =>
        settlement.status === "rejected",
    );
    if (failure) throw failure.reason;
  }
}
