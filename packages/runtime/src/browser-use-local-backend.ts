import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
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
import { validateBrowserUseLocalTaskRequest } from "./browser-use-local-request.js";

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
  };
  readonly #control: BrowserUseLocalProcessControl;
  #running = false;

  constructor(options: {
    dataRoot: string;
    env: Readonly<Record<string, string | undefined>>;
    control?: BrowserUseLocalControlDependencies;
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
    validateBrowserUseLocalTaskRequest(request);
    if (this.#running) {
      throw publicError(
        "A Browser Use local task is already active",
        "browser_task_busy",
        "Stop the active local task before starting another",
      );
    }
    if (!this.#options.env["NAPIER_BROWSER_USE_CREDENTIAL"]?.trim()) {
      throw new Error("Browser Use local model credential is unavailable");
    }
    this.#running = true;
    try {
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
      const runId = randomUUID().replaceAll("-", "");
      const artifactDirectory = path.join(
        browserUseLocalRuntimeRoot(this.#options.dataRoot),
        "runs",
        runId,
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
        env: bridgeEnvironment(this.#options.env, artifactDirectory),
        control: this.#control,
        onObservation,
        ...(signal ? { signal } : {}),
      });
    } finally {
      this.#running = false;
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
  onObservation: (
    observation: BrowserUseLocalObservation,
  ) => void | Promise<void>;
  signal?: AbortSignal;
}): Promise<BrowserUseLocalTaskResult> {
  return await new Promise((resolve, reject) => {
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
    let chain = Promise.resolve();
    let settled = false;
    if (!child.pid) {
      reject(new Error("Browser Use local process did not expose an identity"));
      return;
    }
    const childPid = child.pid;
    input.control.attach(childPid);
    const abort = (): void => input.control.terminate();
    input.signal?.addEventListener("abort", abort, { once: true });
    child.stdin.end(
      `${JSON.stringify({
        task: input.request.task,
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
              try {
                await input.onObservation(input.control.takeover());
              } catch {
                // The step still carries the challenge recovery if takeover raced exit.
              }
            }
          }
        });
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      outputBytes += chunk.byteLength;
      stderrSha256.update(chunk);
      if (outputBytes > MAX_PROCESS_OUTPUT_BYTES) input.control.terminate();
    });
    child.once("error", (error) => finish(() => reject(error)));
    child.once("close", (code) =>
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
      }),
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

function bridgeEnvironment(
  input: Readonly<Record<string, string | undefined>>,
  runtimeRoot: string,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    PATH: input["PATH"],
    SYSTEMROOT: input["SYSTEMROOT"],
    TMPDIR: runtimeRoot,
    TEMP: runtimeRoot,
    TMP: runtimeRoot,
    // Browser Use's macOS CDP core requires the real host HOME to route
    // browser responses. Chrome still receives an explicit fresh profile
    // rooted in the task artifact directory below.
    HOME: input["HOME"] ?? process.env["HOME"] ?? runtimeRoot,
    XDG_CACHE_HOME: path.join(runtimeRoot, "cache"),
    XDG_CONFIG_HOME: path.join(runtimeRoot, "config"),
    BROWSER_USE_CONFIG_DIR: path.join(runtimeRoot, "config", "browseruse"),
    BROWSER_USE_SETUP_LOGGING: "false",
    BROWSER_USE_LOGGING_LEVEL: "critical",
    BROWSER_USE_VERSION_CHECK: "false",
    BROWSER_USE_CLOUD_SYNC: "false",
    ANONYMIZED_TELEMETRY: "false",
    NAPIER_BROWSER_USE_CREDENTIAL: input["NAPIER_BROWSER_USE_CREDENTIAL"],
  };
  for (const name of [
    "ALL_PROXY",
    "APPDATA",
    "HTTPS_PROXY",
    "HTTP_PROXY",
    "LANG",
    "LC_ALL",
    "LOCALAPPDATA",
    "LOGNAME",
    "NO_PROXY",
    "SSL_CERT_DIR",
    "SSL_CERT_FILE",
    "USER",
    "USERPROFILE",
  ]) {
    if (input[name]) env[name] = input[name];
  }
  return env;
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
