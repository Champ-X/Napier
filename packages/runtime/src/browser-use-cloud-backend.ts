import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { isIP } from "node:net";
import path from "node:path";

import type { ModelRef } from "@napier/contracts";

import type { BrowserBackend } from "./browser-backend.js";
import {
  BrowserUseCloudClient,
  browserUseCloudPublicError,
  type BrowserUseCloudProviderTask,
} from "./browser-use-cloud-client.js";
import { validatePublicHttpUrl } from "./public-network.js";

export { BrowserUseCloudError } from "./browser-use-cloud-client.js";

export interface BrowserUseCloudTaskRequest {
  task: string;
  startUrl: string;
  model: ModelRef;
  allowedDomains: string[];
  maxSteps: number;
  maxCostUsd: number;
}

export type BrowserUseCloudObservation =
  | {
      type: "started";
      backend: "browser_use_cloud";
      model: string;
      allowedDomainCount: number;
      costStatus: "unknown";
      interactionPolicy: "public_read_only";
      startUrl: string;
      dataFlow: "task_url_domains_and_page_data_to_browser_use_cloud";
      workspaceAccess: "none";
      secretForwarding: "browser_use_api_key_only";
      recording: "disabled";
      retentionPolicy: "provider_plan";
      costLimitMode: "napier_poll_stop";
      maxCostUsd: number;
      credentialStatus: "configured";
      pauseAvailable: false;
      takeoverAvailable: false;
      cancelMode: "stop_task_and_session";
    }
  | {
      type: "step";
      backend: "browser_use_cloud";
      step: number;
      url: string;
      title: string;
      nextGoal?: string;
      actionNames: string[];
      screenshotPath?: string;
      errorCode?: string;
      errorMessage?: string;
      errorDiagnosticSha256?: string;
    };

export interface BrowserUseCloudTaskResult {
  type: "completed";
  backend: "browser_use_cloud";
  status: "completed" | "failed" | "cancelled" | "handoff_required";
  result: string;
  stepCount: number;
  costStatus: "reported" | "unknown";
  costUsd?: number;
  recovery?: string;
  artifactDirectory: string;
  providerTaskId: string;
  retentionPolicy: "provider_plan";
}

export function browserUseCloudRuntimeRoot(dataRoot: string): string {
  return path.join(dataRoot, "runtimes", "browser-use-cloud", "v2");
}

export class BrowserUseCloudBackend implements BrowserBackend<
  BrowserUseCloudTaskRequest,
  BrowserUseCloudObservation,
  BrowserUseCloudTaskResult
> {
  readonly id = "browser_use_cloud" as const;
  readonly #client: BrowserUseCloudClient;
  readonly #pollIntervalMs: number;

  constructor(
    private readonly options: {
      dataRoot: string;
      apiKey: string;
      fetch?: typeof fetch;
      pollIntervalMs?: number;
      downloadScreenshot?: (
        url: string,
        destination: string,
        signal?: AbortSignal,
      ) => Promise<void>;
    },
  ) {
    this.#client = new BrowserUseCloudClient(options);
    this.#pollIntervalMs = options.pollIntervalMs ?? 2_000;
  }

  async run(
    request: BrowserUseCloudTaskRequest,
    onObservation: (
      observation: BrowserUseCloudObservation,
    ) => void | Promise<void>,
    signal?: AbortSignal,
  ): Promise<BrowserUseCloudTaskResult> {
    validateRequest(request);
    if (!this.options.apiKey.trim()) {
      throw browserUseCloudPublicError(
        "Browser Use Cloud credential is unavailable",
        "credential_missing",
        "Set BROWSER_USE_API_KEY or select another credential locator",
      );
    }
    signal?.throwIfAborted();
    const artifactDirectory = path.join(
      browserUseCloudRuntimeRoot(this.options.dataRoot),
      "runs",
      randomUUID().replaceAll("-", ""),
    );
    await mkdir(artifactDirectory, { recursive: true, mode: 0o700 });
    let providerTaskId: string | undefined;
    try {
      providerTaskId = await this.#client.createTask(
        {
          task: request.task,
          modelId: request.model.id,
          startUrl: request.startUrl,
          maxSteps: request.maxSteps,
          allowedDomains: request.allowedDomains,
        },
        signal,
      );
      await onObservation({
        type: "started",
        backend: "browser_use_cloud",
        model: request.model.id,
        allowedDomainCount: request.allowedDomains.length,
        costStatus: "unknown",
        interactionPolicy: "public_read_only",
        startUrl: request.startUrl,
        dataFlow: "task_url_domains_and_page_data_to_browser_use_cloud",
        workspaceAccess: "none",
        secretForwarding: "browser_use_api_key_only",
        recording: "disabled",
        retentionPolicy: "provider_plan",
        costLimitMode: "napier_poll_stop",
        maxCostUsd: request.maxCostUsd,
        credentialStatus: "configured",
        pauseAvailable: false,
        takeoverAvailable: false,
        cancelMode: "stop_task_and_session",
      });
      return await this.#pollTask(
        providerTaskId,
        request,
        artifactDirectory,
        onObservation,
        signal,
      );
    } catch (error) {
      if (signal?.aborted) {
        if (providerTaskId) await this.#client.stopTask(providerTaskId);
        throw browserUseCloudPublicError(
          "Browser Use Cloud task was stopped",
          "cancelled",
          "Rerun the task to create a fresh one-off cloud session",
        );
      }
      throw error;
    }
  }

  async #pollTask(
    providerTaskId: string,
    request: BrowserUseCloudTaskRequest,
    artifactDirectory: string,
    onObservation: (
      observation: BrowserUseCloudObservation,
    ) => void | Promise<void>,
    signal?: AbortSignal,
  ): Promise<BrowserUseCloudTaskResult> {
    const emittedSteps = new Set<number>();
    while (true) {
      signal?.throwIfAborted();
      const task = await this.#client.getTask(providerTaskId, signal);
      for (const step of task.steps.sort(
        (left, right) => left.number - right.number,
      )) {
        if (emittedSteps.has(step.number)) continue;
        const screenshotDestination = step.screenshotUrl
          ? path.join(artifactDirectory, `step-${step.number}.png`)
          : undefined;
        let screenshotPath: string | undefined;
        if (step.screenshotUrl && screenshotDestination) {
          try {
            await this.#client.saveScreenshot(
              step.screenshotUrl,
              screenshotDestination,
              signal,
            );
            screenshotPath = screenshotDestination;
          } catch {
            // A missing remote screenshot must not hide the provider's step/result.
          }
        }
        await onObservation({
          type: "step",
          backend: "browser_use_cloud",
          step: step.number,
          url: step.url,
          title: "",
          ...(step.nextGoal ? { nextGoal: step.nextGoal } : {}),
          actionNames: step.actions,
          ...(screenshotPath ? { screenshotPath } : {}),
        });
        emittedSteps.add(step.number);
        if (requiresHumanHandoff(step.nextGoal)) {
          await this.#client.stopTask(providerTaskId);
          return result({
            providerTaskId,
            artifactDirectory,
            status: "handoff_required",
            output: "Browser challenge detected; human handoff is required.",
            stepCount: emittedSteps.size,
            ...(task.cost === undefined ? {} : { cost: task.cost }),
            recovery:
              "Open the site manually, complete the challenge, then start a fresh task",
          });
        }
      }
      const budgetResult = await this.#enforceCostBudget(
        task,
        request.maxCostUsd,
        providerTaskId,
        artifactDirectory,
        emittedSteps.size,
      );
      if (budgetResult) return budgetResult;
      if (isTerminal(task.status)) {
        if (requiresHumanHandoff(task.output)) {
          return result({
            providerTaskId,
            artifactDirectory,
            status: "handoff_required",
            output:
              task.output ??
              "Browser challenge detected; human handoff is required.",
            stepCount: emittedSteps.size,
            ...(task.cost === undefined ? {} : { cost: task.cost }),
            recovery:
              "Open the site manually, complete the challenge, then start a fresh task",
          });
        }
        return result({
          providerTaskId,
          artifactDirectory,
          status:
            task.status === "finished" && task.isSuccess !== false
              ? "completed"
              : task.status === "stopped"
                ? "cancelled"
                : "failed",
          output: task.output ?? providerStatusMessage(task.status),
          stepCount: emittedSteps.size,
          ...(task.cost === undefined ? {} : { cost: task.cost }),
          ...(task.status === "failed"
            ? {
                recovery:
                  "Review the final step, reduce scope, and retry the task",
              }
            : {}),
        });
      }
      await waitForPoll(this.#pollIntervalMs, signal);
    }
  }

  async #enforceCostBudget(
    task: BrowserUseCloudProviderTask,
    maxCostUsd: number,
    providerTaskId: string,
    artifactDirectory: string,
    stepCount: number,
  ): Promise<BrowserUseCloudTaskResult | undefined> {
    if (task.cost === undefined || task.cost < maxCostUsd) return undefined;
    if (!isTerminal(task.status)) await this.#client.stopTask(providerTaskId);
    return result({
      providerTaskId,
      artifactDirectory,
      status: "failed",
      output:
        task.output ??
        "Browser Use Cloud task reached the configured cost ceiling.",
      stepCount,
      cost: task.cost,
      recovery:
        "Raise the cost ceiling explicitly or reduce max steps before retrying",
    });
  }
}

function validateRequest(request: BrowserUseCloudTaskRequest): void {
  if (request.task.trim().length < 1 || request.task.length > 8_000) {
    throw new Error("Browser Use Cloud task must be 1-8000 characters");
  }
  if (request.model.provider !== "browser-use" || !request.model.id.trim()) {
    throw new Error("Browser Use Cloud requires a browser-use model reference");
  }
  if (
    !Number.isSafeInteger(request.maxSteps) ||
    request.maxSteps < 1 ||
    request.maxSteps > 100
  ) {
    throw new Error("Browser Use Cloud max steps must be 1-100");
  }
  if (
    !Number.isFinite(request.maxCostUsd) ||
    request.maxCostUsd < 0.01 ||
    request.maxCostUsd > 100
  ) {
    throw new Error("Browser Use Cloud cost ceiling must be 0.01-100 USD");
  }
  if (request.allowedDomains.length < 1 || request.allowedDomains.length > 20) {
    throw new Error("Browser Use Cloud requires 1-20 allowed domains");
  }
  for (const domain of request.allowedDomains) {
    if (
      !/^(?:\*\.)?[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/u.test(domain) ||
      domain.includes("..") ||
      !publicDomain(domain)
    ) {
      throw new Error("Browser Use Cloud allowed domain is invalid");
    }
  }
  const url = validatePublicHttpUrl(request.startUrl);
  if (!domainAllowed(url.hostname.toLowerCase(), request.allowedDomains)) {
    throw new Error(
      "Browser Use Cloud start URL must match the public domain allowlist",
    );
  }
}

function result(input: {
  providerTaskId: string;
  artifactDirectory: string;
  status: BrowserUseCloudTaskResult["status"];
  output: string;
  stepCount: number;
  cost?: number;
  recovery?: string;
}): BrowserUseCloudTaskResult {
  return {
    type: "completed",
    backend: "browser_use_cloud",
    status: input.status,
    result: input.output,
    stepCount: input.stepCount,
    costStatus: input.cost === undefined ? "unknown" : "reported",
    ...(input.cost === undefined ? {} : { costUsd: input.cost }),
    ...(input.recovery ? { recovery: input.recovery } : {}),
    artifactDirectory: input.artifactDirectory,
    providerTaskId: input.providerTaskId,
    retentionPolicy: "provider_plan",
  };
}

function isTerminal(status: BrowserUseCloudProviderTask["status"]): boolean {
  return status === "finished" || status === "failed" || status === "stopped";
}

function providerStatusMessage(
  status: BrowserUseCloudProviderTask["status"],
): string {
  if (status === "stopped") return "Browser Use Cloud task was stopped.";
  if (status === "failed") return "Browser Use Cloud task failed.";
  return "Browser Use Cloud task finished without output.";
}

function requiresHumanHandoff(value: string | undefined): boolean {
  return Boolean(
    value &&
    /\b(?:captcha|recaptcha|hcaptcha|bot challenge|cloudflare challenge)\b/iu.test(
      value,
    ),
  );
}

function publicDomain(value: string): boolean {
  const domain = value.startsWith("*.") ? value.slice(2) : value;
  return (
    isIP(domain.replace(/^\[|\]$/gu, "")) === 0 &&
    domain !== "localhost" &&
    !domain.endsWith(".localhost")
  );
}

function domainAllowed(hostname: string, domains: string[]): boolean {
  return domains.some((domain) =>
    domain.startsWith("*.")
      ? hostname === domain.slice(2) || hostname.endsWith(domain.slice(1))
      : hostname === domain,
  );
}

async function waitForPoll(
  milliseconds: number,
  signal?: AbortSignal,
): Promise<void> {
  if (!signal) {
    await new Promise((resolve) => setTimeout(resolve, milliseconds));
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(done, milliseconds);
    signal.addEventListener("abort", aborted, { once: true });
    function done(): void {
      signal?.removeEventListener("abort", aborted);
      resolve();
    }
    function aborted(): void {
      clearTimeout(timeout);
      reject(signal?.reason ?? new Error("Task aborted"));
    }
  });
}
