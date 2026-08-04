import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { AgentProfile } from "@napier/contracts";

import { AgentSessionRuntime } from "./agent-sessions.js";
import type { RunBrowserSessionManager } from "./browser-session.js";
import { gitStageMutationManagerFor } from "./git-stage.js";
import type { BrowserSourceCaptureProvider } from "./research-sources.js";
import type { OsSandboxAdapter } from "./sandbox.js";
import { createStatelessAgentTools } from "./stateless-agent-tools.js";
import type { LocalStore } from "./store.js";
import type { WebSearchExecutor } from "./web-search-model.js";
import { WebSearchProviderRegistry } from "./web-search-providers.js";
import type { WorkspaceFileMutationManager } from "./workspace-file-mutations.js";
import { createWorkspaceProcessTool } from "./workspace-process-tool.js";
import type { WorkspaceProcessManager } from "./workspace-processes.js";

interface AgentCapabilityOwner {
  threadId: string;
  runId: string;
}

export interface CreateAgentCapabilityToolsOptions extends AgentCapabilityOwner {
  profile: AgentProfile;
  restrictedReadOnlyExecution?: boolean;
  advisorCorrection?: boolean;
}

export class AgentCapabilityRuntime {
  private readonly sessions: AgentSessionRuntime;
  private readonly webSearch: WebSearchExecutor;

  constructor(
    private readonly store: LocalStore,
    private readonly sandbox: OsSandboxAdapter,
    private readonly processes?: WorkspaceProcessManager,
    private readonly workspaceFileMutations?: WorkspaceFileMutationManager,
    browserSessions?: RunBrowserSessionManager,
    researchSourceCaptures?: BrowserSourceCaptureProvider,
    webSearch: WebSearchExecutor = new WebSearchProviderRegistry(),
  ) {
    this.webSearch = webSearch;
    this.sessions = new AgentSessionRuntime(
      processes,
      store.workspaceRoot,
      sandbox,
      browserSessions,
      researchSourceCaptures,
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
    if (sessionToolsAllowed(options)) {
      tools.push(
        ...this.sessions.createTools(options.profile.enabledTools, owner),
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

  cancelRun(owner: AgentCapabilityOwner): Promise<void> {
    return this.sessions.cancelRun(owner);
  }
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
