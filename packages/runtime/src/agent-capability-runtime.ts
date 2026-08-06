import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { AgentProfile } from "@napier/contracts";
import type { BrowserLiveViewReceipt } from "@napier/contracts/browser-live-view";
import type { ExecuteBrowserTakeoverActionRequest } from "@napier/contracts/browser-takeover";

import { AgentSessionRuntime } from "./agent-sessions.js";
import type { EventSink } from "./event-sink.js";
import type { BrowserInteractionConfirmationManager } from "./browser-interaction-confirmations.js";
import { RunBrowserSessionManager } from "./browser-session.js";
import type { BrowserSessionPauseManager } from "./browser-session-pause.js";
import { gitStageMutationManagerFor } from "./git-stage.js";
import type { BrowserSourceCaptureProvider } from "./research-sources.js";
import { ResearchSourceCapsuleStore } from "./research-source-capsule-store.js";
import type { OsSandboxAdapter } from "./sandbox.js";
import { createStatelessAgentTools } from "./stateless-agent-tools.js";
import type { LocalStore } from "./store.js";
import type { WebSearchExecutor } from "./web-search-model.js";
import { WebSearchProviderRegistry } from "./web-search-providers.js";
import type { WebFetchExecutor } from "./web-fetch-model.js";
import type { WebFetchResearchCaptureProvider } from "./web-fetch-model.js";
import { createWebFetchBrowserFallbackProvider } from "./web-fetch-browser-fallback.js";
import {
  RunWebFetchSourceManager,
  type RunWebFetchSourceManagerOptions,
} from "./web-fetch-sources.js";
import { WebFetchCapsuleStore } from "./web-fetch-capsule-store.js";
import { createWebFetchTool } from "./web-fetch-tool.js";
import { RunWebFetchSaveManager } from "./web-fetch-save.js";
import { createWebFetchSaveTool } from "./web-fetch-save-tool.js";
import { prepareNetworkSourceContinuity } from "./research-source-recovery-context.js";
import { appendSourceContinuityGuidance } from "./source-continuity-guidance.js";
import type { WorkspaceFileMutationManager } from "./workspace-file-mutations.js";
import { createWorkspaceProcessTool } from "./workspace-process-tool.js";
import type { WorkspaceProcessManager } from "./workspace-processes.js";

interface AgentCapabilityOwner {
  threadId: string;
  runId: string;
}

export interface CreateAgentCapabilityToolsOptions extends AgentCapabilityOwner {
  profile: AgentProfile;
  browserInteractionConfirmationAllowed?: boolean;
  restrictedReadOnlyExecution?: boolean;
  advisorCorrection?: boolean;
}

export interface AgentNetworkCapabilities {
  webSearch?: WebSearchExecutor;
  webFetch?: WebFetchExecutor;
  webFetchHttp?: RunWebFetchSourceManagerOptions["http"];
}

export class AgentCapabilityRuntime {
  private readonly sessions: AgentSessionRuntime;
  private readonly webSearch: WebSearchExecutor;
  private readonly webFetch: WebFetchExecutor;
  private readonly webFetchSave: RunWebFetchSaveManager;

  constructor(
    private readonly store: LocalStore,
    private readonly sandbox: OsSandboxAdapter,
    private readonly processes?: WorkspaceProcessManager,
    private readonly workspaceFileMutations?: WorkspaceFileMutationManager,
    private readonly browserInteractionConfirmations?: BrowserInteractionConfirmationManager,
    private readonly browserSessionPauses?: BrowserSessionPauseManager,
    browserSessions?: RunBrowserSessionManager,
    researchSourceCaptures?: BrowserSourceCaptureProvider,
    network: AgentNetworkCapabilities = {},
  ) {
    this.webSearch = network.webSearch ?? new WebSearchProviderRegistry();
    const resolvedBrowserSessions =
      browserSessions ??
      new RunBrowserSessionManager({ workspaceRoot: store.workspaceRoot });
    this.webFetch =
      network.webFetch ??
      new RunWebFetchSourceManager({
        ...(network.webFetchHttp ? { http: network.webFetchHttp } : {}),
        browserFallback: createWebFetchBrowserFallbackProvider(
          resolvedBrowserSessions,
        ),
        capsules: new WebFetchCapsuleStore(store.dataRoot),
        store,
      });
    this.webFetchSave = new RunWebFetchSaveManager({
      workspaceRoot: store.workspaceRoot,
      store,
      ...(network.webFetchHttp ? { http: network.webFetchHttp } : {}),
    });
    const webFetchCapture = webFetchResearchCaptureProvider(this.webFetch);
    this.sessions = new AgentSessionRuntime(
      processes,
      store.workspaceRoot,
      sandbox,
      resolvedBrowserSessions,
      researchSourceCaptures,
      webFetchCapture,
      new ResearchSourceCapsuleStore(store.dataRoot),
      store,
    );
  }

  createTools(options: CreateAgentCapabilityToolsOptions): AgentTool[] {
    const owner = {
      threadId: options.threadId,
      runId: options.runId,
    };
    const tools = createStatelessAgentTools({
      store: this.store,
      profile: options.profile,
      threadId: options.threadId,
      runId: options.runId,
      sandbox: this.sandbox,
      lspSession: this.sessions.lspSession(owner),
      ...(this.workspaceFileMutations
        ? { workspaceFileMutations: this.workspaceFileMutations }
        : {}),
      gitStageMutations: gitStageMutationManagerFor(this.store, this.sandbox),
      beforeWorkspaceWrite: this.sessions.debuggerWriteBarrier({
        threadId: options.threadId,
        id: options.runId,
      }),
      ...(options.restrictedReadOnlyExecution !== undefined
        ? {
            restrictedReadOnlyExecution: options.restrictedReadOnlyExecution,
          }
        : {}),
      ...(options.advisorCorrection !== undefined
        ? { advisorCorrection: options.advisorCorrection }
        : {}),
      webSearch: this.webSearch,
    });
    if (
      !options.advisorCorrection &&
      options.profile.enabledTools.includes("web_fetch")
    ) {
      tools.push(
        createWebFetchTool(this.webFetch, owner, {
          browserFallbackAllowed:
            networkSessionToolsAllowed(options) &&
            options.profile.enabledTools.includes("browser"),
        }),
      );
    }
    if (
      sessionToolsAllowed(options) &&
      options.profile.enabledTools.includes("web_fetch_save")
    ) {
      tools.push(
        createWebFetchSaveTool(
          this.webFetchSave,
          owner,
          this.sessions.debuggerWriteBarrier({
            threadId: owner.threadId,
            id: owner.runId,
          }),
        ),
      );
    }
    if (networkSessionToolsAllowed(options)) {
      tools.push(
        ...this.sessions.createNetworkTools(
          options.profile.enabledTools,
          owner,
          {
            readOnlyBrowser:
              options.profile.toolPolicy === "observe" ||
              options.browserInteractionConfirmationAllowed !== true ||
              this.browserInteractionConfirmations?.available !== true,
          },
        ),
      );
    }
    if (sessionToolsAllowed(options)) {
      tools.push(
        ...this.sessions.createProcessTools(
          options.profile.enabledTools,
          owner,
        ),
      );
    }
    if (
      sessionToolsAllowed(options) &&
      options.profile.enabledTools.includes("workspace_process") &&
      this.processes
    ) {
      tools.push(createWorkspaceProcessTool(this.processes, owner));
    }
    return tools;
  }

  async cancelRun(owner: AgentCapabilityOwner): Promise<void> {
    const settlements = await Promise.allSettled([
      this.sessions.cancelRun(owner),
      this.webFetch.cancelRun(owner),
      ...(this.browserInteractionConfirmations
        ? [this.browserInteractionConfirmations.cancelRun(owner)]
        : []),
      ...(this.browserSessionPauses
        ? [this.browserSessionPauses.cancelRun(owner)]
        : []),
    ]);
    const failure = settlements.find(
      (settlement): settlement is PromiseRejectedResult =>
        settlement.status === "rejected",
    );
    if (failure) throw failure.reason;
  }

  prepareResearchSourceRecovery(
    owner: AgentCapabilityOwner,
    explicitRunId?: string,
  ) {
    return this.sessions.prepareResearchSourceRecovery(owner, explicitRunId);
  }

  prepareWebFetchRecovery(owner: AgentCapabilityOwner, explicitRunId?: string) {
    return (
      this.webFetch.prepareRecovery?.(owner, explicitRunId) ??
      Promise.resolve(undefined)
    );
  }

  prepareNetworkSourceRecovery(
    owner: AgentCapabilityOwner,
    enabled: { researchSource: boolean; webFetch: boolean },
    explicitRunId?: string,
  ) {
    return Promise.all([
      enabled.researchSource
        ? this.prepareResearchSourceRecovery(owner, explicitRunId)
        : Promise.resolve(undefined),
      enabled.webFetch
        ? this.prepareWebFetchRecovery(owner, explicitRunId)
        : Promise.resolve(undefined),
    ]).then(([research, webFetch]) => ({ research, webFetch }));
  }

  prepareSourceContinuity(input: {
    owner: AgentCapabilityOwner;
    invocationSource: string;
    automaticRecovery: boolean;
    sourceContinuityRequired: boolean;
    sourceContinuityRunId: string | undefined;
    enabledTools: readonly string[];
    systemPrompt: string;
    onEvent: EventSink | undefined;
  }): Promise<string> {
    return prepareNetworkSourceContinuity({
      threadId: input.owner.threadId,
      runId: input.owner.runId,
      invocationSource: input.invocationSource,
      automaticRecovery: input.automaticRecovery,
      sourceContinuityRequired: input.sourceContinuityRequired,
      enabledTools: input.enabledTools,
      prepare: (enabled) =>
        this.prepareNetworkSourceRecovery(
          input.owner,
          enabled,
          input.sourceContinuityRunId,
        ),
      record: async (event) => {
        const recorded = await this.store.appendEvent(event);
        try {
          await input.onEvent?.(recorded);
        } catch {
          // A disconnected stream cannot cancel durable Source continuity.
        }
        return recorded;
      },
    }).then((guidance) =>
      appendSourceContinuityGuidance(input.systemPrompt, guidance),
    );
  }

  captureBrowserLiveView(
    owner: AgentCapabilityOwner,
    signal?: AbortSignal,
  ): Promise<{ image: Buffer; receipt: BrowserLiveViewReceipt }> {
    return this.sessions.captureBrowserLiveView(owner, signal);
  }

  captureBrowserTakeoverSnapshot(
    owner: AgentCapabilityOwner,
    signal?: AbortSignal,
  ) {
    return this.sessions.captureBrowserTakeoverSnapshot(owner, signal);
  }

  executeBrowserTakeoverAction(
    owner: AgentCapabilityOwner,
    request: ExecuteBrowserTakeoverActionRequest,
    signal?: AbortSignal,
  ) {
    return this.sessions.executeBrowserTakeoverAction(
      owner,
      takeoverSessionRequest(request),
      signal,
    );
  }

  hasActiveBrowserSession(owner: AgentCapabilityOwner): boolean {
    return this.sessions.hasActiveBrowserSession(owner);
  }
}

function takeoverSessionRequest(request: ExecuteBrowserTakeoverActionRequest) {
  if (request.action === "click") {
    return {
      action: request.action,
      target: { ref: request.ref },
      ...(request.allowCrossOrigin === true
        ? { allowCrossOrigin: true as const }
        : {}),
    };
  }
  if (request.action === "visual_click") {
    return {
      action: request.action,
      x: request.x,
      y: request.y,
      ...(request.allowCrossOrigin === true
        ? { allowCrossOrigin: true as const }
        : {}),
    };
  }
  if (request.action === "keypress") {
    return {
      action: request.action,
      key: request.key,
      ...(request.allowCrossOrigin === true
        ? { allowCrossOrigin: true as const }
        : {}),
    };
  }
  if (request.action === "type") {
    return {
      action: request.action,
      target: { ref: request.ref },
      text: request.text,
    };
  }
  if (request.action === "select") {
    return {
      action: request.action,
      target: { ref: request.ref },
      values: request.values,
    };
  }
  if (request.action === "download") {
    return {
      action: request.action,
      target: { ref: request.ref },
      path: request.path,
      ...(request.allowCrossOrigin === true
        ? { allowCrossOrigin: true as const }
        : {}),
    };
  }
  if (request.action === "save_screenshot") {
    return {
      action: request.action,
      path: request.path,
      expectedLiveImageSha256: request.expectedLiveImageSha256,
    };
  }
  if (request.action === "scroll") {
    return {
      action: request.action,
      direction: request.direction,
      ...(request.pixels !== undefined ? { pixels: request.pixels } : {}),
    };
  }
  if (request.action === "back" || request.action === "forward") {
    return {
      action: request.action,
      ...(request.allowCrossOrigin === true
        ? { allowCrossOrigin: true as const }
        : {}),
    };
  }
  if (request.action === "tab_new") {
    return {
      action: request.action,
      url: request.url,
      ...(request.allowCrossOrigin === true
        ? { allowCrossOrigin: true as const }
        : {}),
    };
  }
  if (request.action === "tab_switch" || request.action === "tab_close") {
    return { action: request.action, tabId: request.tabId };
  }
  return {
    action: request.action,
    ...(request.durationMs !== undefined
      ? { durationMs: request.durationMs }
      : {}),
  };
}

function webFetchResearchCaptureProvider(
  executor: WebFetchExecutor,
): WebFetchResearchCaptureProvider | undefined {
  if (!executor.captureWebSource) return undefined;
  return {
    captureWebSource: (owner, request, signal) =>
      executor.captureWebSource!(owner, request, signal),
  };
}

function sessionToolsAllowed(
  options: CreateAgentCapabilityToolsOptions,
): boolean {
  return (
    !options.restrictedReadOnlyExecution &&
    !options.advisorCorrection &&
    options.profile.toolPolicy !== "observe"
  );
}

function networkSessionToolsAllowed(
  options: CreateAgentCapabilityToolsOptions,
): boolean {
  return !options.restrictedReadOnlyExecution && !options.advisorCorrection;
}
