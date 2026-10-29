import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";

import type { ModelRef } from "@napier/contracts";

import type { BrowserBackend } from "./browser-backend.js";
import { BROWSER_USE_LOCAL_BRIDGE } from "./browser-use-local-bridge.js";
import {
  BrowserUseLocalError,
  BrowserUseLocalProcessControl,
  type BrowserUseLocalControlDependencies,
  type BrowserUseLocalControlObservation,
} from "./browser-use-local-control.js";
import {
  browserUseLocalRuntimeRoot,
  inspectBrowserUseLocalRuntime,
} from "./browser-use-local-setup.js";
import { browserUseLocalBridgeEnvironment, validateBrowserUseLocalTaskRequest } from "./browser-use-local-request.js";
import type { ExecutionResourceLease } from "./execution-resource-admission.js";
import { BrowserUseLocalResource, type BrowserUseLocalCleanupAck } from "./browser-use-local-resource.js";

const MAX_EVENT_LINE_BYTES = 128 * 1024;
const MAX_PROCESS_OUTPUT_BYTES = 2 * 1024 * 1024;

export interface BrowserUseLocalTaskRequest {
  task: string;
  startUrl?: string;
  model: ModelRef;
  allowedDomains: string[];
  maxSteps: number;
}

export type BrowserUseLocalObservation =
  | {
      type: "started";
      backend: "browser_use_local";
      model: string;
      allowedDomainCount: number;
      costStatus: "unknown";
      interactionPolicy: "public_read_only";
      pauseAvailable: boolean;
      takeoverAvailable: boolean;
      browserVisibility: "visible";
      browserProduct: "system_chrome" | "system_chromium";
      browserVersion: string;
      pauseMode: "immediate_agent_process" | "unavailable";
      challengeMode: "automatic_takeover_pause" | "handoff_only";
      cancelMode: "terminate_process_group" | "terminate_process";
      startUrl?: string;
    }
  | {
      type: "step";
      backend: "browser_use_local";
      step: number;
      url: string;
      title: string;
      nextGoal?: string;
      actionNames: string[];
      screenshotPath?: string;
      errorCode?: string;
      errorMessage?: string;
      errorDiagnosticSha256?: string;
    }
  | BrowserUseLocalControlObservation;

export interface BrowserUseLocalTaskResult {
  type: "completed";
  backend: "browser_use_local";
  status: "completed" | "failed" | "cancelled" | "handoff_required";
  result: string;
  stepCount: number;
  costStatus: "reported" | "unknown";
  costUsd?: number;
  totalTokens?: number;
  recovery?: string;
  artifactDirectory: string;
}

export class BrowserUseLocalBackend implements BrowserBackend<
  BrowserUseLocalTaskRequest,
  BrowserUseLocalObservation,
  BrowserUseLocalTaskResult
> {
  readonly id = "browser_use_local" as const;
  readonly #options: {
    dataRoot: string;
    env: Readonly<Record<string, string | undefined>>;
    resourceLease?: ExecutionResourceLease;
  };
  readonly #control: BrowserUseLocalProcessControl;
  #running = false;
  #resourceUsed = false;

  constructor(options: {
    dataRoot: string;
    env: Readonly<Record<string, string | undefined>>;
    control?: BrowserUseLocalControlDependencies;
    resourceLease?: ExecutionResourceLease;
  }) {
    this.#options = options;
    this.#control = new BrowserUseLocalProcessControl(options.control);
  }

  pause(): BrowserUseLocalControlObservation {
    return this.#control.pause();
  }

  resume(): BrowserUseLocalControlObservation {
    return this.#control.resume();
  }

  takeover(): BrowserUseLocalControlObservation {
    return this.#control.takeover();
  }

  async run(
    request: BrowserUseLocalTaskRequest,
    onObservation: (
      observation: BrowserUseLocalObservation,
    ) => void | Promise<void>,
    signal?: AbortSignal,
  ): Promise<BrowserUseLocalTaskResult> {
    if (this.#running || (this.#options.resourceLease && this.#resourceUsed)) {
      throw publicError(
        "A Browser Use local task is already active",
        "browser_task_busy",
        "Stop the active local task before starting another",
      );
    }
    this.#resourceUsed = true;
    this.#running = true;
    const resource = new BrowserUseLocalResource(this.#options.resourceLease);
    let failure: { error: unknown } | undefined;
    try {
      validateBrowserUseLocalTaskRequest(request);
      if (!this.#options.env["NAPIER_BROWSER_USE_CREDENTIAL"]?.trim()) {
        throw new Error("Browser Use local model credential is unavailable");
      }
      signal?.throwIfAborted();
      const inspection = await inspectBrowserUseLocalRuntime(
        this.#options.dataRoot,
      );
      if (
        inspection.status !== "ready" ||
        !inspection.pythonExecutable ||
        !inspection.browserExecutablePath ||
        !inspection.browserProduct ||
        !inspection.browserVersion
      ) {
        throw publicError(
          "Browser Use local is missing its runtime or a compatible system browser",
          "backend_missing",
          `Install or update Chrome, then run napier setup --workspace 'WORKSPACE_PATH' --component browser-use-local`,
        );
      }
      const artifactDirectory = path.join(
        browserUseLocalRuntimeRoot(this.#options.dataRoot),
        "runs",
        resource.runNonce,
      );
      await mkdir(artifactDirectory, { recursive: true, mode: 0o700 });
      return await executeBridge({
        pythonExecutable: inspection.pythonExecutable,
        request: {
          ...request,
          browserExecutablePath: inspection.browserExecutablePath,
          browserProduct: inspection.browserProduct,
          browserVersion: inspection.browserVersion,
        },
        artifactDirectory,
        env: browserUseLocalBridgeEnvironment(this.#options.env, artifactDirectory),
        control: this.#control,
        resource,
        onObservation,
        ...(signal ? { signal } : {}),
      });
    } catch (error) {
      failure = { error };
      throw error;
    } finally {
      this.#running = false;
      resource.settle(failure?.error);
    }
  }
}

async function executeBridge(input: {
  pythonExecutable: string;
  request: BrowserUseLocalTaskRequest & {
    browserExecutablePath: string;
    browserProduct: "system_chrome" | "system_chromium";
    browserVersion: string;
  };
  artifactDirectory: string;
  env: NodeJS.ProcessEnv;
  control: BrowserUseLocalProcessControl;
  resource: BrowserUseLocalResource;
  onObservation: (
    observation: BrowserUseLocalObservation,
  ) => void | Promise<void>;
  signal?: AbortSignal;
}): Promise<BrowserUseLocalTaskResult> {
  input.signal?.throwIfAborted();
  return await new Promise((resolve, reject) => {
    input.resource.dispatch();
    const child = spawn(
      input.pythonExecutable,
      ["-c", BROWSER_USE_LOCAL_BRIDGE],
      {
        cwd: input.artifactDirectory,
        env: input.env,
        detached: process.platform !== "win32",
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    let stdout = Buffer.alloc(0);
    let outputBytes = 0;
    let stderrSha256 = createHash("sha256");
    let result: BrowserUseLocalTaskResult | undefined;
    let bridgeError: BrowserUseLocalError | undefined;
    let observationFailure: { error: unknown } | undefined;
    let processFailure: { error: Error } | undefined;
    let chain = Promise.resolve();
    let settled = false;
    let childClosed = false;
    if (!child.pid) {
      input.resource.notStarted();
      child.once("error", () => undefined);
      reject(new Error("Browser Use local process did not expose an identity"));
      return;
    }
    const childPid = child.pid;
    const abort = (): void => input.control.terminate();
    child.stdout.on("data", (chunk: Buffer) => {
      outputBytes += chunk.byteLength;
      stdout = Buffer.concat([stdout, chunk]);
      if (outputBytes > MAX_PROCESS_OUTPUT_BYTES) input.control.terminate();
      while (true) {
        const newline = stdout.indexOf(10);
        if (newline < 0) break;
        const line = stdout.subarray(0, newline);
        stdout = stdout.subarray(newline + 1);
        if (line.byteLength > MAX_EVENT_LINE_BYTES) {
          input.control.terminate();
          bridgeError = publicError(
            "Browser Use local emitted an oversized event",
            "backend_protocol_invalid",
            "Rerun Doctor, then reinstall Browser Use local if the failure repeats",
          );
          continue;
        }
        chain = chain.then(async () => {
          const event = parseBridgeEvent(line.toString("utf8"));
          if (event.type === "cleanup") {
            if (!input.resource.acknowledge(event)) throw publicError(
              "Browser Use local emitted an invalid cleanup acknowledgement",
              "backend_protocol_invalid",
              "Inspect the local browser before starting another task",
            );
            return;
          }
          if (observationFailure) return;
          if (event.type === "error") {
            bridgeError = new BrowserUseLocalError(
              event.message,
              event.code,
              event.diagnosticSha256,
              event.recovery,
            );
          } else if (event.type === "completed") {
            result = { ...event, artifactDirectory: input.artifactDirectory };
          } else {
            await input.onObservation(event);
            if (
              event.type === "step" &&
              event.errorCode === "captcha_handoff_required"
            ) {
              let takeover: BrowserUseLocalControlObservation | undefined;
              try {
                takeover = input.control.takeover();
              } catch {
                // The step still carries the challenge recovery if takeover raced exit.
              }
              if (takeover) await input.onObservation(takeover);
            }
          }
        }).catch((error: unknown) => {
          observationFailure ??= { error };
          // Parsing and observation persistence can fail while Python is still
          // running. Stop its owned process group, but settle only on close.
          // A late observer rejection must not signal an already closed PID.
          if (!childClosed) input.control.terminate();
        });
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      outputBytes += chunk.byteLength;
      stderrSha256.update(chunk);
      if (outputBytes > MAX_PROCESS_OUTPUT_BYTES) input.control.terminate();
    });
    child.stdin.once("error", () => input.control.terminate());
    child.once("error", (error) => {
      if (childClosed) return;
      processFailure = { error };
      input.control.terminate();
    });
    child.once("close", (code) => {
      childClosed = true;
      input.resource.closed();
      finish(() => {
        void chain.then(() => {
          if (input.signal?.aborted) {
            reject(
              publicError(
                "Browser Use local task was stopped",
                "cancelled",
                "Rerun the same command to start a fresh local task",
              ),
            );
            return;
          }
          if (observationFailure) {
            reject(observationFailure.error);
            return;
          }
          if (processFailure) {
            reject(processFailure.error);
            return;
          }
          if (bridgeError) {
            reject(bridgeError);
            return;
          }
          if (outputBytes > MAX_PROCESS_OUTPUT_BYTES) {
            reject(
              publicError(
                "Browser Use local exceeded its output limit",
                "backend_output_limit",
                "Reduce --max-steps and rerun the task",
              ),
            );
            return;
          }
          if (code !== 0 || !result) {
            reject(
              publicError(
                "Browser Use local stopped without a result",
                "backend_failed",
                `Rerun Doctor (diagnostic ${stderrSha256.digest("hex").slice(0, 16)})`,
              ),
            );
            return;
          }
          resolve(result);
        });
      });
    });
    input.control.attach(childPid);
    input.signal?.addEventListener("abort", abort, { once: true });
    if (input.signal?.aborted) {
      abort();
      return;
    }
    child.stdin.end(
      `${JSON.stringify({
        task: input.request.task,
        runNonce: input.resource.runNonce,
        ...(input.request.startUrl
          ? { initialUrl: input.request.startUrl }
          : {}),
        modelProvider: input.request.model.provider,
        modelId: input.request.model.id,
        allowedDomains: input.request.allowedDomains,
        browserExecutablePath: input.request.browserExecutablePath,
        browserProduct: input.request.browserProduct,
        browserVersion: input.request.browserVersion,
        maxSteps: input.request.maxSteps,
        artifactDirectory: input.artifactDirectory,
        controlAvailable: input.control.available,
        cancelMode: input.control.available
          ? "terminate_process_group"
          : "terminate_process",
      })}\n`,
    );
    function finish(operation: () => void): void {
      if (settled) return;
      settled = true;
      input.signal?.removeEventListener("abort", abort);
      input.control.detach(childPid);
      operation();
    }
  });
}

type BridgeEvent =
  | BrowserUseLocalObservation
  | BrowserUseLocalCleanupAck
  | Omit<BrowserUseLocalTaskResult, "artifactDirectory">
  | {
      type: "error";
      backend: "browser_use_local";
      code: string;
      message: string;
      diagnosticSha256: string;
      recovery: string;
    };

function parseBridgeEvent(line: string): BridgeEvent {
  let value: unknown;
  try {
    value = JSON.parse(line) as unknown;
  } catch {
    throw publicError(
      "Browser Use local emitted invalid output",
      "backend_protocol_invalid",
      "Rerun Doctor, then reinstall Browser Use local if the failure repeats",
    );
  }
  if (!value || Array.isArray(value) || typeof value !== "object") {
    throw publicError(
      "Browser Use local emitted invalid output",
      "backend_protocol_invalid",
      "Rerun Doctor, then reinstall Browser Use local if the failure repeats",
    );
  }
  const event = value as Record<string, unknown>;
  // Cleanup has a stricter nonce-bound internal schema, checked by the owner.
  if (event["type"] === "cleanup") return event as unknown as BrowserUseLocalCleanupAck;
  if (
    event["backend"] !== "browser_use_local" ||
    !["started", "step", "completed", "error"].includes(String(event["type"]))
  ) {
    throw publicError(
      "Browser Use local emitted an unknown event",
      "backend_protocol_invalid",
      "Rerun Doctor, then reinstall Browser Use local if the failure repeats",
    );
  }
  return event as BridgeEvent;
}


function publicError(
  message: string,
  code: string,
  recovery: string,
): BrowserUseLocalError {
  return new BrowserUseLocalError(
    message,
    code,
    createHash("sha256").update(message).digest("hex"),
    recovery,
  );
}

export { BrowserUseLocalError } from "./browser-use-local-control.js";
