import path from "node:path";

import {
  BrowserUseCloudBackend,
  BrowserUseCloudError,
  BrowserUseLocalBackend,
  BrowserUseLocalError,
  sha256,
  type BrowserUseCloudObservation,
  type BrowserUseCloudTaskResult,
  type BrowserUseLocalObservation,
  type BrowserUseLocalTaskResult,
} from "@napier/runtime";

import type { CliBrowserTaskOptions } from "./cli-browser-task-options.js";
import { subscribeBrowserTaskControls } from "./browser-task-control-cli.js";
import { shellArgument } from "./cli-option-values.js";
import { writeJsonLine, writeLine } from "./cli-output.js";
import type { CliIo, RunCliDependencies } from "./cli-runtime.js";
import { canonicalWorkspace } from "./workspace-path.js";

export async function executeBrowserTask(
  options: CliBrowserTaskOptions,
  io: CliIo,
  dependencies: RunCliDependencies,
  parentSignal?: AbortSignal,
): Promise<number> {
  const controller = new AbortController();
  let timedOut = false;
  const forwardAbort = (): void => controller.abort();
  parentSignal?.addEventListener("abort", forwardAbort, { once: true });
  if (parentSignal?.aborted) controller.abort();
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.timeoutMs);
  const unsubscribeInterrupt = io.subscribeInterrupt?.(() =>
    controller.abort(),
  );
  let unsubscribeControls: (() => void) | undefined;
  let credentialRuntime:
    | Awaited<ReturnType<RunCliDependencies["createRuntime"]>>
    | undefined;
  let workspaceRoot = path.resolve(io.cwd, options.workspace);
  let dataRoot = path.resolve(
    io.cwd,
    options.dataRoot ?? path.join(options.workspace, ".napier"),
  );
  try {
    workspaceRoot = await canonicalWorkspace(options.workspace, io.cwd);
    dataRoot = path.resolve(
      io.cwd,
      options.dataRoot ?? path.join(workspaceRoot, ".napier"),
    );
    const resolvedCredential = await resolveBrowserTaskCredential(
      options,
      io,
      dependencies,
      workspaceRoot,
      dataRoot,
    );
    credentialRuntime = resolvedCredential.runtime;
    const credential = resolvedCredential.credential;
    let result: BrowserUseLocalTaskResult | BrowserUseCloudTaskResult;
    if (options.backend === "browser_use_cloud") {
      if (!options.startUrl) {
        throw new Error("Browser Use Cloud requires a start URL");
      }
      const backend = new BrowserUseCloudBackend({
        dataRoot,
        apiKey: credential,
      });
      result = await backend.run(
        {
          task: options.task,
          startUrl: options.startUrl,
          model: options.model,
          allowedDomains: options.allowedDomains,
          maxSteps: options.maxSteps,
          maxCostUsd: options.maxCostUsd,
        },
        async (observation) => writeObservation(observation, options, io),
        controller.signal,
      );
    } else {
      const backend = new BrowserUseLocalBackend({
        dataRoot,
        env: backendEnvironment(io.env, credential),
      });
      unsubscribeControls = subscribeBrowserTaskControls({
        ...(io.stdin ? { stdin: io.stdin } : {}),
        backend,
        stop: () => controller.abort(),
        observe: async (observation) =>
          writeObservation(observation, options, io),
        invalid: async (command) =>
          writeLine(
            io.stderr,
            `Unknown browser task control "${command}"; use pause, takeover, resume, or stop`,
          ),
        failed: async (error) =>
          writeLine(
            io.stderr,
            `Browser task control failed: ${error instanceof Error ? error.message : String(error)}`,
          ),
      });
      result = await backend.run(
        {
          task: options.task,
          ...(options.startUrl ? { startUrl: options.startUrl } : {}),
          model: options.model,
          allowedDomains: options.allowedDomains,
          maxSteps: options.maxSteps,
        },
        async (observation) => writeObservation(observation, options, io),
        controller.signal,
      );
    }
    if (options.jsonl) {
      await writeJsonLine(io.stdout, result);
    } else {
      if (result.result) await writeLine(io.stdout, result.result);
      await writeLine(
        io.stderr,
        [
          `Browser task ${result.status} · ${String(result.stepCount)} steps · backend ${result.backend}`,
          `Cost: ${result.costStatus === "reported" && result.costUsd !== undefined ? `$${result.costUsd.toFixed(6)}` : "unknown"}`,
          `Artifacts: ${result.artifactDirectory}`,
          ...(result.recovery ? [`Recovery: ${result.recovery}`] : []),
        ].join("\n"),
      );
    }
    return result.status === "completed" ? 0 : 1;
  } catch (error) {
    const localError =
      error instanceof BrowserUseLocalError && error.code === "backend_missing"
        ? browserUseLocalSetupError(error, workspaceRoot, dataRoot)
        : error;
    const failure = timedOut
      ? taskError(
          options.backend,
          "Browser task exceeded its wall-time limit",
          "timeout",
          sha256(`${options.backend}_timeout`),
          "Reduce --max-steps or raise --timeout-ms, then start a fresh task",
        )
      : localError instanceof BrowserUseLocalError ||
          localError instanceof BrowserUseCloudError
        ? localError
        : taskError(
            options.backend,
            controller.signal.aborted
              ? timedOut
                ? "Browser task exceeded its wall-time limit"
                : "Browser task was stopped"
              : "Browser task could not start",
            controller.signal.aborted
              ? timedOut
                ? "timeout"
                : "cancelled"
              : "backend_failed",
            sha256(`${options.backend}_failed`),
            controller.signal.aborted
              ? timedOut
                ? "Reduce --max-steps or raise --timeout-ms, then start a fresh task"
                : "Rerun the same command to start a fresh task"
              : `Run napier doctor with --browser-backend ${options.backend}, then retry`,
          );
    if (options.jsonl) {
      await writeJsonLine(io.stdout, {
        kind: "napier.browser-task-error",
        schemaVersion: 1,
        backend: options.backend,
        code: failure.code,
        message: failure.message,
        diagnosticSha256: failure.diagnosticSha256,
        recovery: failure.recovery,
      });
    } else {
      await writeLine(
        io.stderr,
        `Browser task failed: ${failure.message} [${failure.code}]\nRecovery: ${failure.recovery}`,
      );
    }
    return 1;
  } finally {
    clearTimeout(timeout);
    unsubscribeInterrupt?.();
    unsubscribeControls?.();
    await credentialRuntime?.shutdown().catch(() => undefined);
    parentSignal?.removeEventListener("abort", forwardAbort);
  }
}

function browserUseLocalSetupError(
  error: BrowserUseLocalError,
  workspaceRoot: string,
  dataRoot: string,
): BrowserUseLocalError {
  const recovery = [
    "Install or update Chrome, then run napier setup",
    "--workspace",
    shellArgument(workspaceRoot),
    "--data-root",
    shellArgument(dataRoot),
    "--component browser-use-local",
  ].join(" ");
  return new BrowserUseLocalError(
    error.message,
    error.code,
    error.diagnosticSha256,
    recovery,
  );
}

async function resolveBrowserTaskCredential(
  options: CliBrowserTaskOptions,
  io: CliIo,
  dependencies: RunCliDependencies,
  workspaceRoot: string,
  dataRoot: string,
): Promise<{
  credential: string;
  runtime?: Awaited<ReturnType<RunCliDependencies["createRuntime"]>>;
}> {
  if (options.credentialEnv) {
    const credential = io.env[options.credentialEnv]?.trim();
    if (credential) return { credential };
    throw taskError(
      options.backend,
      "The selected Browser Use model credential is missing",
      "credential_missing",
      sha256("credential_missing"),
      `Set ${options.credentialEnv} in the parent environment, then rerun Doctor without passing the secret in argv`,
    );
  }
  const runtime = await dependencies.createRuntime({
    workspaceRoot,
    dataRoot,
    env: io.env,
  });
  try {
    const resolved = await runtime.credentials.read(options.model.provider);
    const credential =
      resolved?.type === "api_key" ? resolved.key?.trim() : undefined;
    if (credential) return { credential, runtime };
    throw taskError(
      options.backend,
      "The selected Browser Use model credential is missing",
      "credential_missing",
      sha256("credential_missing"),
      `Open Web Context → Credentials, add an active ${options.model.provider} credential, or pass --credential-env with a variable name`,
    );
  } catch (error) {
    await runtime.shutdown().catch(() => undefined);
    if (
      error instanceof BrowserUseLocalError ||
      error instanceof BrowserUseCloudError
    ) {
      throw error;
    }
    throw taskError(
      options.backend,
      "The selected Browser Use model credential reference is unavailable",
      "credential_reference_unavailable",
      sha256("credential_reference_unavailable"),
      `Open Web Context → Credentials, repair the active ${options.model.provider} credential, then rerun the same command`,
    );
  }
}

async function writeObservation(
  observation: BrowserUseLocalObservation | BrowserUseCloudObservation,
  options: CliBrowserTaskOptions,
  io: CliIo,
): Promise<void> {
  if (options.jsonl) {
    await writeJsonLine(io.stdout, observation);
    return;
  }
  if (observation.type === "started") {
    const disclosure =
      observation.backend === "browser_use_cloud"
        ? ` · sends task, URL, domains, page data, and screenshots to Browser Use Cloud · workspace none · recording disabled · retention provider-plan · API key only · $${observation.maxCostUsd.toFixed(2)} Napier poll-stop ceiling · Pause/Take over unavailable · Stop tears down task and session`
        : ` · visible local ${observation.browserProduct.replace("system_", "")} ${observation.browserVersion} · Pause/Take over ${observation.pauseAvailable ? "ready" : "unavailable on this host"} · CAPTCHA ${observation.challengeMode === "automatic_takeover_pause" ? "auto-takeover" : "handoff"}`;
    await writeLine(
      io.stderr,
      `Browser task started · backend ${observation.backend} · model ${observation.model} · public read-only policy · cost unknown until provider usage is reported${disclosure} · ${observation.backend === "browser_use_local" && io.stdin ? "type pause, takeover, resume, or stop + Enter" : "Ctrl+C to stop"}`,
    );
    return;
  }
  if (observation.type === "control") {
    await writeLine(
      io.stderr,
      `Browser task control · ${observation.state} · ${observation.message}`,
    );
    return;
  }
  await writeLine(
    io.stderr,
    [
      `Step ${String(observation.step)} · ${observation.actionNames.join(", ") || "observe"} · ${observation.url}`,
      ...(observation.nextGoal ? [`Next: ${observation.nextGoal}`] : []),
      ...(observation.screenshotPath
        ? [`Screenshot: ${observation.screenshotPath}`]
        : []),
      ...(observation.errorCode
        ? [
            `Step failure: ${observation.errorMessage ?? "Browser Use local step failed"} [${observation.errorCode}]`,
          ]
        : []),
    ].join("\n"),
  );
}

function taskError(
  backend: CliBrowserTaskOptions["backend"],
  message: string,
  code: string,
  diagnosticSha256: string,
  recovery: string,
): BrowserUseLocalError | BrowserUseCloudError {
  return backend === "browser_use_cloud"
    ? new BrowserUseCloudError(message, code, diagnosticSha256, recovery)
    : new BrowserUseLocalError(message, code, diagnosticSha256, recovery);
}

function backendEnvironment(
  input: Readonly<Record<string, string | undefined>>,
  credential: string,
): Readonly<Record<string, string | undefined>> {
  const env: Record<string, string | undefined> = {
    NAPIER_BROWSER_USE_CREDENTIAL: credential,
  };
  for (const name of [
    "ALL_PROXY",
    "APPDATA",
    "HOME",
    "HTTPS_PROXY",
    "HTTP_PROXY",
    "LANG",
    "LC_ALL",
    "LOCALAPPDATA",
    "LOGNAME",
    "NO_PROXY",
    "PATH",
    "SSL_CERT_DIR",
    "SSL_CERT_FILE",
    "SYSTEMROOT",
    "USER",
    "USERPROFILE",
  ]) {
    if (input[name]) env[name] = input[name];
  }
  return env;
}
