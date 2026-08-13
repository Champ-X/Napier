import { sha256 } from "@napier/runtime";
import {
  createPlatformSandboxAdapter,
  type OsSandboxAdapter,
} from "@napier/runtime";
import {
  probeDapRuntime,
  probeLspRuntime,
  probeLocalServiceRuntime,
  probePythonRuntime,
  probeShellRuntime,
  probeSkillsRuntime,
  probeVerificationRuntime,
} from "@napier/runtime/doctor-probes";

import { defaultSandboxProbe, sandboxFailure } from "./doctor-sandbox-probe.js";
import { localCapabilityCheck } from "./doctor-local-capability-check.js";
import {
  normalizeWebSearchRequest,
  RunWebFetchSourceManager,
  WebSearchProviderRegistry,
} from "@napier/runtime/web-search";

import type { CliDoctorOptions } from "./cli-doctor-options.js";
import type {
  DoctorCheck,
  DoctorCredentialReferenceStatus,
} from "./doctor-check-model.js";
import {
  defaultBrowserProbe,
  defaultBrowserUseCloudProbe,
  defaultBrowserUseLocalProbe,
} from "./doctor-browser-probes.js";
import { defaultModelProbe } from "./doctor-model-probe.js";

export interface DoctorProbeDependencies {
  runtime?: () => Promise<DoctorCheck>;
  model?: (
    options: CliDoctorOptions,
    env: Readonly<Record<string, string | undefined>>,
  ) => Promise<DoctorCheck>;
  sandbox?: (
    workspaceRoot: string,
    signal: AbortSignal,
  ) => Promise<DoctorCheck>;
  search?: (signal: AbortSignal) => Promise<DoctorCheck>;
  fetch?: (signal: AbortSignal) => Promise<DoctorCheck>;
  browser?: (
    workspaceRoot: string,
    signal: AbortSignal,
  ) => Promise<DoctorCheck>;
  browserUseLocal?: (
    dataRoot: string,
    selected: boolean,
  ) => Promise<DoctorCheck>;
  browserUseCloud?: (
    env: Readonly<Record<string, string | undefined>>,
    credentialEnv: string,
  ) => Promise<DoctorCheck>;
  skills?: (workspaceRoot: string) => Promise<DoctorCheck>;
  lsp?: (workspaceRoot: string, signal: AbortSignal) => Promise<DoctorCheck>;
  dap?: (workspaceRoot: string, signal: AbortSignal) => Promise<DoctorCheck>;
  python?: (workspaceRoot: string, signal: AbortSignal) => Promise<DoctorCheck>;
  shell?: (workspaceRoot: string, signal: AbortSignal) => Promise<DoctorCheck>;
  verification?: (
    workspaceRoot: string,
    signal: AbortSignal,
  ) => Promise<DoctorCheck>;
  service?: (
    workspaceRoot: string,
    signal: AbortSignal,
  ) => Promise<DoctorCheck>;
}

export async function runDoctorProbes(input: {
  options: CliDoctorOptions;
  workspaceRoot: string;
  dataRoot: string;
  env: Readonly<Record<string, string | undefined>>;
  signal: AbortSignal;
  dependencies?: DoctorProbeDependencies;
  credentialReferences?: ReadonlyMap<string, DoctorCredentialReferenceStatus>;
  sandbox?: OsSandboxAdapter;
}): Promise<DoctorCheck[]> {
  const dependencies = input.dependencies ?? {};
  const runtime = dependencies.runtime ?? defaultRuntimeProbe;
  const model =
    dependencies.model ??
    ((options, env) =>
      defaultModelProbe(
        options,
        env,
        options.model
          ? input.credentialReferences?.get(options.model.provider)
          : undefined,
      ));
  const checks = [
    await safeProbe("runtime", true, runtime, (_error, durationMs) => ({
      id: "runtime",
      status: "failed",
      required: true,
      code: "runtime_unavailable",
      message: "Runtime readiness could not be determined",
      durationMs,
    })),
    workspaceCheck(input.workspaceRoot),
    await safeProbe(
      "model",
      Boolean(input.options.model),
      () => model(input.options, input.env),
      (_error, durationMs) => ({
        id: "model",
        status: input.options.model ? "failed" : "warning",
        required: Boolean(input.options.model),
        code: "model_check_unavailable",
        message: "Model or credential readiness could not be determined",
        durationMs,
      }),
    ),
  ];
  input.signal.throwIfAborted();
  checks.push(
    ...(await Promise.all([
      dependencies.skills
        ? dependencies.skills(input.workspaceRoot)
        : localCapabilityCheck("skills", () =>
            probeSkillsRuntime(input.workspaceRoot),
          ),
      dependencies.lsp
        ? dependencies.lsp(input.workspaceRoot, input.signal)
        : localCapabilityCheck("lsp", () =>
            probeLspRuntime(
              input.workspaceRoot,
              input.signal,
              input.sandbox ?? createPlatformSandboxAdapter(),
            ),
          ),
      dependencies.dap
        ? dependencies.dap(input.workspaceRoot, input.signal)
        : localCapabilityCheck("dap", () =>
            probeDapRuntime(
              input.workspaceRoot,
              input.signal,
              input.sandbox ?? createPlatformSandboxAdapter(),
            ),
          ),
      dependencies.python
        ? dependencies.python(input.workspaceRoot, input.signal)
        : localCapabilityCheck("python", () =>
            probePythonRuntime(
              input.workspaceRoot,
              input.signal,
              input.sandbox ?? createPlatformSandboxAdapter(),
            ),
          ),
      dependencies.shell
        ? dependencies.shell(input.workspaceRoot, input.signal)
        : localCapabilityCheck("shell", () =>
            probeShellRuntime(
              input.workspaceRoot,
              input.signal,
              input.sandbox ?? createPlatformSandboxAdapter(),
            ),
          ),
      dependencies.verification
        ? dependencies.verification(input.workspaceRoot, input.signal)
        : localCapabilityCheck("verification", () =>
            probeVerificationRuntime(
              input.workspaceRoot,
              input.signal,
              input.sandbox ?? createPlatformSandboxAdapter(),
            ),
          ),
      dependencies.service
        ? dependencies.service(input.workspaceRoot, input.signal)
        : localCapabilityCheck("service", () =>
            probeLocalServiceRuntime(
              input.workspaceRoot,
              input.signal,
              input.sandbox ?? createPlatformSandboxAdapter(),
            ),
          ),
      dependencies.browserUseLocal
        ? dependencies.browserUseLocal(
            input.dataRoot,
            input.options.browserBackend === "browser_use_local",
          )
        : defaultBrowserUseLocalProbe(
            input.dataRoot,
            input.options.browserBackend === "browser_use_local",
          ),
    ])),
  );
  if (input.options.browserBackend === "browser_use_cloud") {
    const credentialEnv =
      input.options.credentialEnv?.trim() || "BROWSER_USE_API_KEY";
    checks.push(
      dependencies.browserUseCloud
        ? await dependencies.browserUseCloud(input.env, credentialEnv)
        : defaultBrowserUseCloudProbe(
            input.env,
            credentialEnv,
            input.credentialReferences?.get("browser-use"),
          ),
    );
  }
  input.signal.throwIfAborted();
  const sandbox =
    dependencies.sandbox ??
    ((workspace, signal) =>
      defaultSandboxProbe(workspace, signal, input.sandbox));
  if (!input.options.online) {
    checks.push(
      await safeProbe(
        "sandbox",
        false,
        () => sandbox(input.workspaceRoot, input.signal),
        sandboxFailure,
      ),
      skippedCheck("search"),
      skippedCheck("fetch"),
      skippedCheck("browser"),
    );
    return checks;
  }
  const search =
    dependencies.search ?? ((signal) => defaultSearchProbe(signal));
  const fetch = dependencies.fetch ?? ((signal) => defaultFetchProbe(signal));
  const browser =
    dependencies.browser ??
    ((workspace, signal) => defaultBrowserProbe(workspace, signal));
  checks.push(
    ...(await Promise.all([
      safeProbe(
        "sandbox",
        false,
        () => sandbox(input.workspaceRoot, input.signal),
        sandboxFailure,
      ),
      safeProbe(
        "search",
        true,
        () => search(input.signal),
        networkFailure("search"),
      ),
      safeProbe(
        "fetch",
        true,
        () => fetch(input.signal),
        networkFailure("fetch"),
      ),
      safeProbe(
        "browser",
        true,
        () => browser(input.workspaceRoot, input.signal),
        browserFailure,
      ),
    ])),
  );
  return checks;
}

async function defaultRuntimeProbe(): Promise<DoctorCheck> {
  const startedAt = Date.now();
  const version = process.versions.node;
  const supported = nodeAtLeast(version, 22, 19);
  return {
    id: "runtime",
    status: supported ? "passed" : "failed",
    required: true,
    code: supported ? "runtime_ready" : "node_version_unsupported",
    message: supported
      ? `Node ${version} satisfies Napier runtime requirements`
      : `Node ${version} is too old; install Node 22.19 or newer`,
    durationMs: Date.now() - startedAt,
    evidence: {
      nodeVersion: version,
      platform: process.platform,
      arch: process.arch,
      sqlite: typeof process.versions.sqlite === "string",
      openssl: typeof process.versions.openssl === "string",
    },
  };
}

async function defaultSearchProbe(signal: AbortSignal): Promise<DoctorCheck> {
  const startedAt = Date.now();
  const registry = new WebSearchProviderRegistry({ env: {} });
  const result = await registry.search(
    normalizeWebSearchRequest({
      query: "Example Domain",
      site: "example.com",
      count: 1,
      provider: "auto",
    }),
    signal,
  );
  return {
    id: "search",
    status: "passed",
    required: true,
    code: "search_ready",
    message: `Public web search succeeded through ${result.provider}`,
    durationMs: Date.now() - startedAt,
    evidence: {
      provider: result.provider,
      resultCount: result.results.length,
      attemptedProviderCount: result.attempts.length,
    },
  };
}

async function defaultFetchProbe(signal: AbortSignal): Promise<DoctorCheck> {
  const startedAt = Date.now();
  const manager = new RunWebFetchSourceManager();
  const owner = { threadId: "thread_doctor", runId: "run_doctor" };
  try {
    const result = await manager.execute(
      owner,
      { action: "fetch", url: "https://example.com/" },
      signal,
    );
    return {
      id: "fetch",
      status: "passed",
      required: true,
      code: "fetch_ready",
      message: "Public HTML fetch and normalization succeeded",
      durationMs: Date.now() - startedAt,
      evidence: {
        format: result.details.sourceFormat ?? "unknown",
        bodyBytes: result.details.sourceBodyBytes ?? 0,
        lineCount: result.details.sourceLineCount ?? 0,
      },
    };
  } finally {
    await manager.cancelRun(owner);
  }
}

function workspaceCheck(workspaceRoot: string): DoctorCheck {
  return {
    id: "workspace",
    status: "passed",
    required: true,
    code: "workspace_ready",
    message: "Workspace exists and resolves to a canonical directory",
    durationMs: 0,
    evidence: { workspaceSha256: sha256(workspaceRoot) },
  };
}

function skippedCheck(id: "search" | "fetch" | "browser"): DoctorCheck {
  return {
    id,
    status: "skipped",
    required: false,
    code: "offline_mode",
    message: "Online probe skipped by --offline",
    durationMs: 0,
  };
}

async function safeProbe(
  id: DoctorCheck["id"],
  required: boolean,
  probe: () => Promise<DoctorCheck>,
  failure: (error: unknown, durationMs: number) => DoctorCheck,
): Promise<DoctorCheck> {
  const startedAt = Date.now();
  try {
    return await probe();
  } catch (error) {
    const check = failure(error, Date.now() - startedAt);
    return { ...check, id, required };
  }
}

function networkFailure(
  id: "search" | "fetch",
): (error: unknown, durationMs: number) => DoctorCheck {
  return (_error, durationMs) => ({
    id,
    status: "failed",
    required: true,
    code: `${id}_unavailable`,
    message:
      id === "search"
        ? "Public web search failed; check DNS, proxy, firewall, or rate limits"
        : "Public URL fetch failed; check DNS, proxy, firewall, or TLS",
    durationMs,
  });
}

function browserFailure(error: unknown, durationMs: number): DoctorCheck {
  const text = error instanceof Error ? error.message : String(error);
  const noRuntime = /No supported Chrome|executable is available/iu.test(text);
  const sandbox = /sandbox/iu.test(text);
  return {
    id: "browser",
    status: "failed",
    required: true,
    code: noRuntime
      ? "browser_missing"
      : sandbox
        ? "browser_sandbox_unavailable"
        : "browser_unavailable",
    message: noRuntime
      ? "No supported Chrome, Chromium, or Edge executable was found"
      : sandbox
        ? "Chrome was found, but its production sandbox could not start"
        : "Sandboxed Browser startup or public navigation failed",
    durationMs,
  };
}

function nodeAtLeast(
  version: string,
  requiredMajor: number,
  requiredMinor: number,
): boolean {
  const [major = 0, minor = 0] = version
    .split(".")
    .slice(0, 2)
    .map((part) => Number(part));
  return (
    major > requiredMajor || (major === requiredMajor && minor >= requiredMinor)
  );
}
