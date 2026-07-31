import { AgentKernelRuntime } from "./agent-kernels.js";
import { RunBrowserSessionManager } from "./browser-session.js";
import { createBrowserTool } from "./browser-tool.js";
import {
  type LspSessionOwner,
  RunLspSessionManager,
} from "./lsp-persistent-session.js";
import { NodeDebuggerManager } from "./node-debugger.js";
import { createNodeDebuggerTool } from "./node-debugger-tool.js";
import { createResearchSourceTool } from "./research-source-tool.js";
import { RunResearchSourceManager } from "./research-sources.js";
import type { OsSandboxAdapter } from "./sandbox.js";
import type { WorkspaceProcessManager } from "./workspace-processes.js";

export class AgentSessionRuntime {
  private readonly kernels: AgentKernelRuntime;
  private readonly debuggerManager: NodeDebuggerManager | undefined;
  private readonly languageServers: RunLspSessionManager;
  private readonly browsers: RunBrowserSessionManager;
  private readonly researchSources: RunResearchSourceManager;

  constructor(
    processes: WorkspaceProcessManager | undefined,
    workspaceRoot: string,
    sandbox: OsSandboxAdapter,
    browserSessions?: RunBrowserSessionManager,
  ) {
    this.kernels = new AgentKernelRuntime(processes);
    this.languageServers = new RunLspSessionManager(sandbox, workspaceRoot);
    this.browsers =
      browserSessions ?? new RunBrowserSessionManager({ workspaceRoot });
    this.researchSources = new RunResearchSourceManager(
      this.browsers,
      workspaceRoot,
    );
    this.debuggerManager = processes
      ? new NodeDebuggerManager(processes, workspaceRoot)
      : undefined;
  }

  lspSession(owner: LspSessionOwner) {
    return this.languageServers.forRun(owner);
  }

  createTools(
    enabledTools: readonly string[],
    context: { threadId: string; runId: string },
  ): Array<
    | ReturnType<AgentKernelRuntime["createTools"]>[number]
    | ReturnType<typeof createBrowserTool>
    | ReturnType<typeof createResearchSourceTool>
    | ReturnType<typeof createNodeDebuggerTool>
  > {
    const tools: Array<
      | ReturnType<AgentKernelRuntime["createTools"]>[number]
      | ReturnType<typeof createBrowserTool>
      | ReturnType<typeof createResearchSourceTool>
      | ReturnType<typeof createNodeDebuggerTool>
    > = [...this.kernels.createTools(enabledTools, context)];
    if (enabledTools.includes("browser")) {
      tools.push(createBrowserTool(this.browsers, context));
    }
    if (enabledTools.includes("research_source")) {
      tools.push(createResearchSourceTool(this.researchSources, context));
    }
    if (enabledTools.includes("node_debugger") && this.debuggerManager) {
      tools.push(createNodeDebuggerTool(this.debuggerManager, context));
    }
    return tools;
  }

  async cancelRun(request: { threadId: string; runId: string }): Promise<void> {
    const settlements = await Promise.allSettled([
      this.kernels.cancelRun(request),
      this.languageServers.cancelRun(request),
      this.browsers.cancelRun(request),
      this.researchSources.cancelRun(request),
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
