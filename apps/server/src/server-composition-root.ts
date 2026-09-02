import path from "node:path";

import {
  AutomationService,
  ChannelService,
  createLocalAgentRuntime,
  type LocalAgentRuntimeServices,
  RecoveryService,
} from "@napier/runtime/agent";
import {
  EvaluationCasebookQualificationService,
  EvaluationSuiteService,
  RunEvaluationService,
} from "@napier/runtime/evaluation";

import { BrowserTasks } from "./browser-task-integration.js";
import { ReceiptTrustAnchorDirectoryDiscoveryService } from "./receipt-trust-directory-discovery.js";
import { ReceiptTrustAnchorDirectorySubscriptionService } from "./receipt-trust-directory-subscriptions.js";
import { createReceiptTrustServices } from "./receipt-trust-services.js";
import type { ServerServiceOptions } from "./server-service-options.js";
import { inferWorkspaceRoot } from "./workspace-root.js";

export interface NapierServices extends Pick<
  LocalAgentRuntimeServices,
  | "store"
  | "sandbox"
  | "models"
  | "extensions"
  | "runtime"
  | "toolDisplays"
  | "modelDisplays"
  | "contextCompactionWorkbench"
  | "subagentHubControls"
  | "kernel"
  | "agentCapabilities"
  | "workflows"
  | "workflowExperiments"
  | "agentMessageExperiments"
  | "modelInvocationExperiments"
  | "toolInvocationExperiments"
  | "credentials"
  | "workspaceFileMutations"
  | "workspaceProcesses"
  | "providerSetup"
  | "sandboxSetup"
> {
  evaluations: RunEvaluationService;
  evaluationCasebookQualifications: EvaluationCasebookQualificationService;
  evaluationSuites: EvaluationSuiteService;
  automation: AutomationService;
  channels: ChannelService;
  recovery: RecoveryService;
  browserTasks: BrowserTasks;
  receiptTrustDirectories: ReceiptTrustAnchorDirectoryDiscoveryService;
  receiptTrustDirectorySubscriptions: ReceiptTrustAnchorDirectorySubscriptionService;
  shutdownLocalRuntime(): Promise<void>;
}

export async function createServices(
  options?: ServerServiceOptions,
): Promise<NapierServices> {
  const workspaceRoot = path.resolve(
    options?.workspaceRoot ??
      process.env["NAPIER_WORKSPACE"] ??
      inferWorkspaceRoot(process.cwd()),
  );
  const dataRoot = path.resolve(
    options?.dataRoot ??
      process.env["NAPIER_HOME"] ??
      path.join(workspaceRoot, ".napier"),
  );
  const local = await createLocalAgentRuntime({
    kernelProfile: "web",
    workspaceRoot,
    dataRoot,
    env: options?.env ?? process.env,
    browserInteractionConfirmation: { available: true },
    ...(options?.keychain ? { keychain: options.keychain } : {}),
    ...(options?.sandbox ? { sandbox: options.sandbox } : {}),
    ...(options?.sandboxSetup ? { sandboxSetup: options.sandboxSetup } : {}),
  });
  const {
    store,
    sandbox,
    credentials,
    models,
    extensions,
    workspaceProcesses,
    workspaceFileMutations,
    runtime,
    toolDisplays,
    modelDisplays,
    contextCompactionWorkbench,
    subagentHubControls,
    kernel,
    workflows,
    workflowExperiments,
    agentMessageExperiments,
    modelInvocationExperiments,
    toolInvocationExperiments,
    agentCapabilities,
    providerSetup,
    sandboxSetup,
  } = local;
  const evaluations = new RunEvaluationService(store, models);
  const evaluationCasebookQualifications =
    new EvaluationCasebookQualificationService(store, models);
  const evaluationSuites = new EvaluationSuiteService(store, models);
  const automation = new AutomationService(store, kernel);
  const channels = new ChannelService(store, kernel);
  const recovery = new RecoveryService(store, kernel);
  const browserTasks = new BrowserTasks(dataRoot, credentials, options?.env);
  const { receiptTrustDirectories, receiptTrustDirectorySubscriptions } =
    createReceiptTrustServices(store, options);
  if (options?.startAutomation) {
    automation.start();
    channels.start();
    recovery.start();
    receiptTrustDirectorySubscriptions.start();
  }
  return {
    store,
    sandbox,
    models,
    extensions,
    runtime,
    toolDisplays,
    modelDisplays,
    contextCompactionWorkbench,
    subagentHubControls,
    kernel,
    workflows,
    workflowExperiments,
    agentMessageExperiments,
    modelInvocationExperiments,
    toolInvocationExperiments,
    agentCapabilities,
    evaluations,
    evaluationCasebookQualifications,
    evaluationSuites,
    credentials,
    automation,
    channels,
    recovery,
    workspaceFileMutations,
    workspaceProcesses,
    providerSetup,
    sandboxSetup,
    browserTasks,
    receiptTrustDirectories,
    receiptTrustDirectorySubscriptions,
    shutdownLocalRuntime: () => browserTasks.shutdownWith(local.shutdown),
  };
}
