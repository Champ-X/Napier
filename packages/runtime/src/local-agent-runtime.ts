import { mkdir, realpath } from "node:fs/promises";
import path from "node:path";

import type { KeychainSecretStore } from "./credentials.js";
import { CredentialReferenceStore } from "./credentials.js";
import { AgentRuntime } from "./agent-runtime.js";
import { EmbeddedWorkflowService } from "./embedded-workflows.js";
import { McpExtensionManager } from "./mcp.js";
import { ModelRegistry } from "./models.js";
import {
  createPlatformSandboxAdapter,
  type OsSandboxAdapter,
} from "./sandbox.js";
import { LocalStore } from "./store.js";
import { WorkspaceFileMutationManager } from "./workspace-file-mutations.js";
import { WorkspaceProcessManager } from "./workspace-processes.js";
import { ExecutionPlanWorkflowExperimentRuntime } from "./workflow-experiments.js";
import { ExecutionPlanWorkflowRuntime } from "./workflow-runtime.js";

export interface LocalAgentRuntimeOptions {
  workspaceRoot?: string;
  dataRoot?: string;
  env?: Readonly<Record<string, string | undefined>>;
  keychain?: KeychainSecretStore;
  sandbox?: OsSandboxAdapter;
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
  runtime: AgentRuntime;
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
    await store.initialize();
    const credentials = new CredentialReferenceStore({
      store,
      ...(options.env ? { env: options.env } : {}),
      ...(options.keychain ? { keychain: options.keychain } : {}),
    });
    const models = new ModelRegistry(credentials);
    const sandbox = options.sandbox ?? createPlatformSandboxAdapter();
    extensions = new McpExtensionManager({ store, sandbox });
    workspaceProcesses = new WorkspaceProcessManager({
      store,
      workspaceRoot,
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
    const runtime = new AgentRuntime(
      store,
      models,
      initializedExtensions,
      sandbox,
      initializedProcesses,
      workspaceFileMutations,
    );
    const workflows = new ExecutionPlanWorkflowRuntime(store, runtime);
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
      runtime,
      workflows,
      embeddedWorkflows,
      workflowExperiments,
      async shutdown() {
        if (closed) return;
        closed = true;
        await settleShutdownSteps([
          () => initializedProcesses.shutdown(),
          () => initializedExtensions.shutdown(),
          () => store.close(),
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
