import { AgentKernelRuntime } from "./agent-kernels.js";
import type { BrowserLiveViewReceipt } from "@napier/contracts/browser-live-view";
import { RunBrowserSessionManager } from "./browser-session.js";
import type {
  BrowserSessionOperationResult,
  BrowserSessionRequest,
} from "./browser-session-model.js";
import { createBrowserTool } from "./browser-tool.js";
import {
  type LspSessionOwner,
  RunLspSessionManager,
} from "./lsp-persistent-session.js";
import { NodeDebuggerManager } from "./node-debugger.js";
import { createNodeDebuggerTool } from "./node-debugger-tool.js";
import { createResearchSourceTool } from "./research-source-tool.js";
import {
  type BrowserSourceCaptureProvider,
  RunResearchSourceManager,
} from "./research-sources.js";
import type { OsSandboxAdapter } from "./sandbox.js";
import type { WebFetchResearchCaptureProvider } from "./web-fetch-model.js";
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
    researchSourceCaptures?: BrowserSourceCaptureProvider,
    webFetchCaptures?: WebFetchResearchCaptureProvider,
  ) {
    this.kernels = new AgentKernelRuntime(processes);
    this.languageServers = new RunLspSessionManager(sandbox, workspaceRoot);
    this.browsers =
      browserSessions ?? new RunBrowserSessionManager({ workspaceRoot });
    this.researchSources = new RunResearchSourceManager(
      researchSourceCaptures ?? this.browsers,
      workspaceRoot,
      webFetchCaptures,
    );
    this.debuggerManager = processes
      ? new NodeDebuggerManager(processes, workspaceRoot)
      : undefined;
  }

  lspSession(owner: LspSessionOwner) {
    return this.languageServers.forRun(owner);
  }

  createProcessTools(
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

  createNetworkTools(
    enabledTools: readonly string[],
    context: { threadId: string; runId: string },
    options: { readOnlyBrowser: boolean },
  ): Array<
    | ReturnType<typeof createBrowserTool>
    | ReturnType<typeof createResearchSourceTool>
  > {
    const tools: Array<
      | ReturnType<typeof createBrowserTool>
      | ReturnType<typeof createResearchSourceTool>
    > = [];
    if (enabledTools.includes("browser")) {
      tools.push(
        createBrowserTool(this.browsers, context, {
          readOnly: options.readOnlyBrowser,
        }),
      );
    }
    if (enabledTools.includes("research_source")) {
      tools.push(createResearchSourceTool(this.researchSources, context));
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

  captureBrowserLiveView(
    owner: { threadId: string; runId: string },
    signal?: AbortSignal,
  ): Promise<{ image: Buffer; receipt: BrowserLiveViewReceipt }> {
    return this.browsers.captureLiveView(owner, signal);
  }

  captureBrowserTakeoverSnapshot(
    owner: { threadId: string; runId: string },
    signal?: AbortSignal,
  ): Promise<{
    snapshot: BrowserSessionOperationResult;
    tabs: BrowserSessionOperationResult;
  }> {
    return this.browsers.captureTakeoverSnapshot(owner, signal);
  }

  executeBrowserTakeoverAction(
    owner: { threadId: string; runId: string },
    request: Extract<
      BrowserSessionRequest,
      {
        action:
          | "click"
          | "visual_click"
          | "keypress"
          | "type"
          | "select"
          | "download"
          | "save_screenshot"
          | "scroll"
          | "back"
          | "forward"
          | "tab_new"
          | "tab_switch"
          | "tab_close"
          | "wait";
      }
    >,
    signal?: AbortSignal,
  ): Promise<BrowserSessionOperationResult> {
    return this.browsers.executeTakeoverAction(owner, request, signal);
  }

  hasActiveBrowserSession(owner: { threadId: string; runId: string }): boolean {
    return this.browsers.hasActiveSession(owner);
  }

  async cancelDebuggerRun(request: {
    threadId: string;
    runId: string;
  }): Promise<void> {
    await this.debuggerManager?.cancelRun(request);
  }

  debuggerWriteBarrier(request: { threadId: string; id: string }) {
    return () =>
      this.cancelDebuggerRun({
        threadId: request.threadId,
        runId: request.id,
      });
  }
}
