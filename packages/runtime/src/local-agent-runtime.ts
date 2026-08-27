import { mkdir, realpath } from "node:fs/promises";
import path from "node:path";

import type { KeychainSecretStore } from "./credentials.js";
import { CredentialReferenceStore } from "./credentials.js";
import { AgentCapabilityRuntime } from "./agent-capability-runtime.js";
import { AgentCapabilityService } from "./agent-capability-service.js";
import type { AgentKernel } from "./agent-kernel.js";
import { AgentRuntime } from "./agent-runtime.js";
import { BrowserInteractionConfirmationManager } from "./browser-interaction-confirmations.js";
import { RunBrowserSessionManager } from "./browser-session.js";
import { BrowserSessionPauseManager } from "./browser-session-pause.js";
import { AgentMessageExperimentRuntime } from "./agent-message-experiments.js";
import { EmbeddedAgentService } from "./embedded-agents.js";
import { EmbeddedWorkflowService } from "./embedded-workflows.js";
import { McpExtensionManager } from "./mcp.js";
import { ModelRegistry } from "./models.js";
import { ModelInvocationExperimentRuntime } from "./model-invocation-experiments.js";
import { ProviderSetupService } from "./provider-setup.js";
import { ToolInvocationExperimentRuntime } from "./tool-invocation-experiments.js";
import type { BrowserSourceCaptureProvider } from "./research-sources.js";
import type { OsSandboxAdapter } from "./sandbox.js";
import {
  createConfiguredSandboxAdapter,
  createInvalidSandboxInstallationAdapter,
  createSandboxFallbackAdapter,
  inspectSandboxInstallationBinding,
} from "./sandbox-installation.js";
import {
  SandboxSetupService,
  type SandboxSetupServiceDependencies,
} from "./sandbox-setup-service.js";
import { SwitchableSandboxAdapter } from "./sandbox-switchable.js";
import { LocalStore } from "./store.js";
import { SubagentHubControlService } from "./subagent-hub-control.js";
import type { WebSearchExecutor } from "./web-search-model.js";
import { WebSearchProviderRegistry } from "./web-search-providers.js";
import { DynamicWebSearchExecutor } from "./kernel-search-plugin.js";
import { DynamicBrowserSessionPort } from "./kernel-browser-plugin.js";
import type { WebFetchExecutor } from "./web-fetch-model.js";
import type { RunWebFetchSourceManagerOptions } from "./web-fetch-sources.js";
import { WorkspaceFileMutationManager } from "./workspace-file-mutations.js";
import { WorkspaceProcessManager } from "./workspace-processes.js";
import { ExecutionPlanWorkflowExperimentRuntime } from "./workflow-experiments.js";
import { ExecutionPlanWorkflowRuntime } from "./workflow-runtime.js";
import { createPersistedAgentKernel } from "./kernel-plugin-runtime.js";

export interface LocalAgentRuntimeOptions {
  kernelProfile?: import("./kernel-profile.js").KernelProfileId;
  workspaceRoot?: string;
  dataRoot?: string;
  env?: Readonly<Record<string, string | undefined>>;
  keychain?: KeychainSecretStore;
  sandbox?: OsSandboxAdapter;
  sandboxSetup?: SandboxSetupServiceDependencies;
  browserSessions?: RunBrowserSessionManager;
  browserInteractionConfirmation?: {
    available?: boolean;
    timeoutMs?: number;
  };
  researchSourceCaptures?: BrowserSourceCaptureProvider;
  webSearch?: WebSearchExecutor;
  webFetch?: WebFetchExecutor;
  webFetchHttp?: RunWebFetchSourceManagerOptions["http"];
}

export interface LocalAgentRuntimeServices {
  workspaceRoot: string;
  dataRoot: string;
  store: LocalStore;
  credentials: CredentialReferenceStore;
  models: ModelRegistry;
  extensions: McpExtensionManager;
  sandbox: OsSandboxAdapter;
  workspaceProcesses: WorkspaceProcessManager;
  workspaceFileMutations: WorkspaceFileMutationManager;
  browserInteractionConfirmations: BrowserInteractionConfirmationManager;
  browserSessionPauses: BrowserSessionPauseManager;
  providerSetup: ProviderSetupService;
  sandboxSetup: SandboxSetupService;
  runtime: AgentRuntime;
  subagentHubControls: SubagentHubControlService;
  kernel: AgentKernel;
  agentCapabilities: AgentCapabilityService;
  embeddedAgents: EmbeddedAgentService;
  agentMessageExperiments: AgentMessageExperimentRuntime;
  modelInvocationExperiments: ModelInvocationExperimentRuntime;
  toolInvocationExperiments: ToolInvocationExperimentRuntime;
  workflows: ExecutionPlanWorkflowRuntime;
  embeddedWorkflows: EmbeddedWorkflowService;
  workflowExperiments: ExecutionPlanWorkflowExperimentRuntime;
  shutdown(): Promise<void>;
}

export async function createLocalAgentRuntime(
  options: LocalAgentRuntimeOptions = {},
): Promise<LocalAgentRuntimeServices> {
  const workspaceRoot = path.resolve(options.workspaceRoot ?? process.cwd());
  const requestedDataRoot = path.resolve(
    options.dataRoot ?? path.join(workspaceRoot, ".napier"),
  );
  await mkdir(requestedDataRoot, { recursive: true });
  const dataRoot = await realpath(requestedDataRoot);
  const store = new LocalStore({ dataRoot, workspaceRoot });
  let extensions: McpExtensionManager | undefined;
  let workspaceProcesses: WorkspaceProcessManager | undefined;
  try {
    await store.initialize(true);
    const credentials = new CredentialReferenceStore({
      store,
      ...(options.env ? { env: options.env } : {}),
      ...(options.keychain ? { keychain: options.keychain } : {}),
    });
    const models = new ModelRegistry(credentials);
    const fallbackSandbox =
      options.sandbox ??
      createSandboxFallbackAdapter({
        ...(options.env ? { env: options.env } : {}),
      });
    const configuredSandbox = options.sandbox
      ? undefined
      : await createConfiguredSandboxAdapter({
          dataRoot,
          ...(options.env ? { env: options.env } : {}),
        }).catch(async (error) => {
          const binding = await inspectSandboxInstallationBinding(dataRoot);
          if (binding.status === "invalid") {
            return createInvalidSandboxInstallationAdapter();
          }
          throw error;
        });
    const initialSandbox =
      options.sandbox ?? configuredSandbox ?? fallbackSandbox;
    const sandbox = new SwitchableSandboxAdapter(initialSandbox);
    extensions = new McpExtensionManager({ store, sandbox });
    workspaceProcesses = new WorkspaceProcessManager({
      store,
      workspaceRoot,
      dataRoot,
      sandbox,
    });
    await workspaceProcesses.initialize();
    const initializedExtensions = extensions;
    const initializedProcesses = workspaceProcesses;
    const workspaceFileMutations = new WorkspaceFileMutationManager({
      store,
      workspaceRoot,
      dataRoot,
    });
    await workspaceFileMutations.initialize();
    const browserInteractionConfirmations =
      new BrowserInteractionConfirmationManager(
        store,
        options.browserInteractionConfirmation,
      );
    const browserSessionPauses = new BrowserSessionPauseManager(store);
    const providerSetup = new ProviderSetupService(
      store,
      credentials,
      models,
      options.env ?? process.env,
    );
    const sandboxSetup = new SandboxSetupService(
      workspaceRoot,
      dataRoot,
      sandbox,
      {
        ...options.sandboxSetup,
        fallback: options.sandboxSetup?.fallback ?? (() => fallbackSandbox),
      },
    );
    const searchExecutor =
      options.webSearch ??
      new WebSearchProviderRegistry({
        ...(options.env ? { env: options.env } : {}),
      });
    const searchSlot = new DynamicWebSearchExecutor();
    const browserManager =
      options.browserSessions ??
      new RunBrowserSessionManager({
        workspaceRoot,
        localServiceLeases: initializedProcesses.localServiceLeases,
      });
    const browserSlot = new DynamicBrowserSessionPort();
    const network = {
      webSearch: searchSlot,
      ...(options.webFetch ? { webFetch: options.webFetch } : {}),
      ...(options.webFetchHttp ? { webFetchHttp: options.webFetchHttp } : {}),
    };
    const capabilityRuntime = new AgentCapabilityRuntime(
      store,
      sandbox,
      initializedProcesses,
      workspaceFileMutations,
      browserInteractionConfirmations,
      browserSessionPauses,
      browserSlot,
      options.researchSourceCaptures,
      network,
    );
    const agentCapabilities = new AgentCapabilityService(
      store,
      sandbox,
      capabilityRuntime,
    );
    const subagentHubControls = new SubagentHubControlService(store);
    const runtime = new AgentRuntime(
      store,
      models,
      initializedExtensions,
      sandbox,
      initializedProcesses,
      workspaceFileMutations,
      browserSlot,
      options.researchSourceCaptures,
      undefined,
      undefined,
      undefined,
      network,
      browserInteractionConfirmations,
      browserSessionPauses,
      undefined,
      subagentHubControls,
    );
    const kernel = await createPersistedAgentKernel(dataRoot, {
      profile: options.kernelProfile ?? "base",
      runtime,
      models,
      search: { slot: searchSlot, executor: searchExecutor },
      browser: { slot: browserSlot, manager: browserManager },
    });
    const embeddedAgents = new EmbeddedAgentService(store, kernel);
    const agentMessageExperiments = new AgentMessageExperimentRuntime(
      store,
      kernel,
    );
    const modelInvocationExperiments = new ModelInvocationExperimentRuntime(
      store,
      models,
      runtime.modelInvocationCapsules,
    );
    const toolInvocationExperiments = new ToolInvocationExperimentRuntime(
      store,
      runtime,
      runtime.toolInvocationCapsules,
    );
    const workflows = new ExecutionPlanWorkflowRuntime(store, kernel, runtime);
    const embeddedWorkflows = new EmbeddedWorkflowService(store, workflows);
    const workflowExperiments = new ExecutionPlanWorkflowExperimentRuntime(
      store,
      workflows,
    );
    let closed = false;
    return {
      workspaceRoot,
      dataRoot,
      store,
      credentials,
      models,
      extensions: initializedExtensions,
      sandbox,
      workspaceProcesses: initializedProcesses,
      workspaceFileMutations,
      browserInteractionConfirmations,
      browserSessionPauses,
      providerSetup,
      sandboxSetup,
      runtime,
      subagentHubControls,
      kernel,
      agentCapabilities,
      embeddedAgents,
      agentMessageExperiments,
      modelInvocationExperiments,
      toolInvocationExperiments,
      workflows,
      embeddedWorkflows,
      workflowExperiments,
      async shutdown() {
        if (closed) return;
        closed = true;
        await settleShutdownSteps([
          () => kernel.shutdown(),
          () => initializedProcesses.shutdown(),
          () => initializedExtensions.shutdown(),
          () => store.shutdown(),
        ]);
      },
    };
  } catch (error) {
    await settleShutdownSteps([
      () => workspaceProcesses?.shutdown(),
      () => extensions?.shutdown(),
      () => store.close(),
    ]).catch(() => undefined);
    throw error;
  }
}

async function settleShutdownSteps(
  steps: Array<() => void | Promise<void> | undefined>,
): Promise<void> {
  const failures: unknown[] = [];
  for (const step of steps) {
    try {
      await step();
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) throw failures[0];
}
