import {
  BrowserUseCloudBackend,
  BrowserUseLocalBackend,
  type BrowserUseLocalControlObservation,
  type BrowserUseCloudObservation,
  type BrowserUseCloudTaskRequest,
  type BrowserUseCloudTaskResult,
  type BrowserUseLocalObservation,
  type BrowserUseLocalTaskRequest,
  type BrowserUseLocalTaskResult,
} from "@napier/runtime/browser";
import { browserTaskEnvironment } from "./browser-task-service-support.js";
import type { BrowserTaskCreateInput } from "./browser-task-types.js";
import type { BrowserTaskResourceLease } from "./browser-task-resource.js";

export interface BrowserTaskRunner {
  run(
    onObservation: (
      observation: BrowserUseLocalObservation | BrowserUseCloudObservation,
    ) => void | Promise<void>,
    signal?: AbortSignal,
  ): Promise<BrowserUseLocalTaskResult | BrowserUseCloudTaskResult>;
  pause?(): BrowserUseLocalControlObservation;
  resume?(): BrowserUseLocalControlObservation;
  takeover?(): BrowserUseLocalControlObservation;
}

interface BrowserUseLocalRunner {
  run(
    request: BrowserUseLocalTaskRequest,
    onObservation: (
      observation: BrowserUseLocalObservation,
    ) => void | Promise<void>,
    signal?: AbortSignal,
  ): Promise<BrowserUseLocalTaskResult>;
  pause?(): BrowserUseLocalControlObservation;
  resume?(): BrowserUseLocalControlObservation;
  takeover?(): BrowserUseLocalControlObservation;
}
interface BrowserUseCloudRunner {
  run(
    request: BrowserUseCloudTaskRequest,
    onObservation: (
      observation: BrowserUseCloudObservation,
    ) => void | Promise<void>,
    signal?: AbortSignal,
  ): Promise<BrowserUseCloudTaskResult>;
}

export interface BrowserTaskRunnerOptions {
  dataRoot: string;
  env: Readonly<Record<string, string | undefined>>;
  createBackend?: (options: {
    dataRoot: string;
    env: Readonly<Record<string, string | undefined>>;
    resourceLease?: BrowserTaskResourceLease;
  }) => BrowserUseLocalRunner;
  createCloudBackend?: (options: {
    dataRoot: string;
    apiKey: string;
    resourceLease?: BrowserTaskResourceLease;
  }) => BrowserUseCloudRunner;
}

export function createBrowserTaskRunner(
  options: BrowserTaskRunnerOptions,
  input: BrowserTaskCreateInput,
  credential: string,
  resourceLease?: BrowserTaskResourceLease,
): BrowserTaskRunner {
  const resource = resourceLease ? { resourceLease } : {};
  if (input.backend === "browser_use_cloud") {
    const backend = (
      options.createCloudBackend ??
      ((value) => new BrowserUseCloudBackend(value))
    )({
      dataRoot: options.dataRoot,
      apiKey: credential,
      ...resource,
    });
    const request: BrowserUseCloudTaskRequest = {
      task: input.task,
      startUrl: input.startUrl,
      model: input.model,
      allowedDomains: input.allowedDomains,
      maxSteps: input.maxSteps,
      maxCostUsd: input.maxCostUsd,
    };
    return { run: (observe, signal) => backend.run(request, observe, signal) };
  }
  const backend = (
    options.createBackend ?? ((value) => new BrowserUseLocalBackend(value))
  )({
    dataRoot: options.dataRoot,
    env: browserTaskEnvironment(options.env, credential),
    ...resource,
  });
  const request: BrowserUseLocalTaskRequest = {
    task: input.task,
    startUrl: input.startUrl,
    model: input.model,
    allowedDomains: input.allowedDomains,
    maxSteps: input.maxSteps,
  };
  return {
    run: (observe, signal) => backend.run(request, observe, signal),
    ...(backend.pause ? { pause: () => backend.pause!() } : {}),
    ...(backend.resume ? { resume: () => backend.resume!() } : {}),
    ...(backend.takeover ? { takeover: () => backend.takeover!() } : {}),
  };
}
