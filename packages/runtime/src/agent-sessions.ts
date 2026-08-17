import { AgentKernelRuntime } from "./agent-kernels.js";
import type { BrowserLiveViewReceipt } from "@napier/contracts/browser-live-view";
import type { BrowserSessionPort } from "./browser-session-port.js";
import type {
  BrowserSessionOperationResult,
  BrowserSessionRequest,
} from "./browser-session-model.js";
import { createBrowserTool } from "./browser-tool.js";
import type { BrowserInteractionConfirmationManager } from "./browser-interaction-confirmations.js";
import { BrowserOutputArtifactRegistrar } from "./browser-output-artifact.js";
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
import type { ResearchSourceCapsuleStore } from "./research-source-capsule-store.js";
import type { RunBoundFileArtifactStore } from "./run-bound-file-artifact.js";
import type { LocalStore } from "./store.js";

export class AgentSessionRuntime {
  private readonly kernels: AgentKernelRuntime;
  private readonly debuggerManager: NodeDebuggerManager | undefined;
  private readonly languageServers: RunLspSessionManager;
  private readonly browsers: BrowserSessionPort;
  private readonly browserOutputArtifacts:
    | BrowserOutputArtifactRegistrar
    | undefined;
  private readonly researchSources: RunResearchSourceManager;
  private readonly researchSourcesRequireBrowser: boolean;

  constructor(
    processes: WorkspaceProcessManager | undefined,
    workspaceRoot: string,
    sandbox: OsSandboxAdapter,
    browserSessions: BrowserSessionPort,
    researchSourceCaptures?: BrowserSourceCaptureProvider,
    webFetchCaptures?: WebFetchResearchCaptureProvider,
    researchSourceCapsules?: ResearchSourceCapsuleStore,
    store?: Pick<LocalStore, "listRuns" | "listEvents" | "getThread"> &
      RunBoundFileArtifactStore,
    private readonly browserConfirmations?: BrowserInteractionConfirmationManager,
  ) {
    this.kernels = new AgentKernelRuntime(processes);
    this.languageServers = new RunLspSessionManager(sandbox, workspaceRoot);
    this.browsers = browserSessions;
    this.browserOutputArtifacts = store
      ? new BrowserOutputArtifactRegistrar(store)
      : undefined;
    this.researchSourcesRequireBrowser = researchSourceCaptures === undefined;
    this.researchSources = new RunResearchSourceManager(
      researchSourceCaptures ?? this.browsers,
      workspaceRoot,
      webFetchCaptures,
      researchSourceCapsules,
      store,
      store,
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
    if (
      enabledTools.includes("browser") &&
      this.browsers.available?.() !== false
    ) {
      tools.push(
        createBrowserTool(this.browsers, context, {
          readOnly: options.readOnlyBrowser,
          ...(this.browserOutputArtifacts
            ? { outputArtifacts: this.browserOutputArtifacts }
            : {}),
          ...(this.browserConfirmations
            ? {
                actionConfirmations: this.browserConfirmations.actions,
                uploadAuthorizations: this.browserConfirmations.uploads,
              }
            : {}),
        }),
      );
    }
    if (
      enabledTools.includes("research_source") &&
      (!this.researchSourcesRequireBrowser ||
        this.browsers.available?.() !== false)
    ) {
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

  prepareResearchSourceRecovery(
    request: { threadId: string; runId: string },
    explicitRunId?: string,
  ) {
    return this.researchSources.prepareRecovery(request, explicitRunId);
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

  captureBrowserConfirmationPageState(
    owner: { threadId: string; runId: string },
    request: Extract<
      BrowserSessionRequest,
      { action: "click" | "type" | "select" | "upload" | "download" }
    >,
    signal?: AbortSignal,
  ) {
    return this.browsers.captureConfirmationPageState(owner, request, signal);
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

  hasWorkspaceBrowserPreview(owner: {
    threadId: string;
    runId: string;
  }): boolean {
    return this.browsers.hasWorkspacePreview?.(owner) === true;
  }

  browserAvailable(): boolean {
    return this.browsers.available?.() !== false;
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
