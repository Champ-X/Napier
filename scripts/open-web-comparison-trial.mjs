import { randomBytes } from "node:crypto";
import { mkdir, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  canonicalJson,
  createLocalAgentRuntime,
  sha256,
} from "../packages/runtime/dist/index.js";

import { startOpenWebComparisonIsolatedBrowser } from "./open-web-comparison-isolated-browser.mjs";
import { evaluateOpenWebComparisonOutcome } from "./open-web-comparison-oracle.mjs";
import { startOpenWebComparisonModelProxy } from "./open-web-comparison-model-proxy.mjs";
import {
  createNapierComparisonParser,
  createOmpComparisonParser,
  infrastructureFailureText,
  processInfrastructureFailureText,
  runOpenWebComparisonProcess,
} from "./open-web-comparison-process.mjs";
import { startOpenWebComparisonPublicProxy } from "./open-web-comparison-public-proxy.mjs";
import { createOmpComparisonSandbox } from "./open-web-comparison-sandbox.mjs";
import { scanOpenWebComparisonSecrets } from "./open-web-comparison-secret-scan.mjs";

export const OPEN_WEB_CONTROLLED_NAPIER_TOOLS = [
  "web_search",
  "web_fetch",
  "browser",
];
const OMP_PROFILE = "comparison";

export async function runOpenWebComparisonTrial(input) {
  return input.executor === "napier"
    ? runNapierTrial(input)
    : runOmpTrial(input);
}

async function runNapierTrial(input) {
  const roots = await trialRoots(input.temporaryRoot, "napier", input);
  const env = createOpenWebComparisonNapierEnvironment(
    roots,
    input.env,
    input.credentialEnv,
  );
  if (input.track === "controlled") {
    await prepareControlledNapier(
      roots,
      createOpenWebComparisonNapierEnvironment(
        roots,
        input.env,
        input.credentialEnv,
        false,
      ),
    );
  }
  const parser = createNapierComparisonParser();
  const execution = await runOpenWebComparisonProcess({
    command: process.execPath,
    args: [
      input.napierEntry,
      "run",
      "--workspace",
      roots.workspaceRoot,
      "--data-root",
      roots.dataRoot,
      "--prompt",
      input.benchmarkCase.prompt,
      "--model",
      "deepseek/deepseek-v4-flash",
      "--credential-env",
      input.credentialEnv,
      "--timeout-ms",
      String(input.timeoutMs),
      "--jsonl",
    ],
    cwd: roots.workspaceRoot,
    env,
    timeoutMs: input.timeoutMs + 15_000,
    secrets: [input.secret],
    onStdoutLine: (line) => parser.accept(line),
  });
  const parsed = parser.result();
  const persistenceScan = await scanOpenWebComparisonSecrets(
    [roots.workspaceRoot, roots.dataRoot],
    [input.secret],
  );
  const outcome = evaluateOpenWebComparisonOutcome({
    benchmarkCase: input.benchmarkCase,
    finalText: parsed.finalText,
    toolCounts: parsed.toolCounts,
  });
  return createOpenWebComparisonTrialOutcome({
    executor: "napier",
    parsed,
    execution,
    outcome,
    persistenceScan,
    infrastructureSignal:
      parsed.infrastructureSignal ||
      processInfrastructureFailureText(execution.stderr),
    credentialBoundary: "environment_locator",
  });
}

async function runOmpTrial(input) {
  const roots = await trialRoots(input.temporaryRoot, "omp", input);
  await prepareOmpRuntimeDirectories(roots);
  const runtimeMount = input.ompRuntime;
  if (!runtimeMount?.entry || !runtimeMount?.root) {
    throw new Error("OMP comparison runtime image is unavailable");
  }
  const childApiKey = randomBytes(32).toString("hex");
  const proxy = await startOpenWebComparisonModelProxy({
    upstreamApiKey: input.secret,
    childApiKey,
    timeoutMs: input.timeoutMs,
  });
  let publicProxy;
  let browserProxy;
  let browser;
  try {
    publicProxy = await startOpenWebComparisonPublicProxy();
    browserProxy = await startOpenWebComparisonPublicProxy({
      requireAuthentication: false,
    });
    browser = await startOpenWebComparisonIsolatedBrowser({
      trialRoot: roots.trialRoot,
      proxyServer: browserProxy.server,
      runtime: input.browserRuntime,
    });
    await writeOmpConfig(roots.homeRoot, proxy.baseUrl, browser.cdpUrl);
    const parser = createOmpComparisonParser();
    const ompArgs = ompArguments(input, roots);
    const modelProxyPort = Number(new URL(proxy.baseUrl).port);
    const sandbox = await createOmpComparisonSandbox({
      trialRoot: roots.trialRoot,
      workspaceRoot: roots.workspaceRoot,
      homeRoot: roots.homeRoot,
      bunExecutable: input.bunExecutable,
      ompEntry: runtimeMount.entry,
      ompArgs,
      modelProxyPort,
      publicProxyPort: publicProxy.port,
      cdpPort: browser.port,
    });
    const env = minimalOmpEnv(roots, childApiKey, input, publicProxy.proxyUrl);
    const execution = await runOpenWebComparisonProcess({
      command: sandbox.command,
      args: sandbox.args,
      cwd: roots.workspaceRoot,
      env,
      timeoutMs: input.timeoutMs + 15_000,
      secrets: [
        input.secret,
        childApiKey,
        publicProxy.credential,
        publicProxy.proxyAuthorization,
        publicProxy.proxyUrl,
      ],
      onStdoutLine: (line) => parser.accept(line),
    });
    const parsed = parser.result();
    const outcome = evaluateOpenWebComparisonOutcome({
      benchmarkCase: input.benchmarkCase,
      finalText: parsed.finalText,
      toolCounts: parsed.toolCounts,
    });
    const publicNetwork = publicProxy.snapshot();
    const browserNetwork = browserProxy.snapshot();
    await browser.close();
    const persistenceScan = await scanOpenWebComparisonSecrets(
      [roots.trialRoot],
      [
        input.secret,
        childApiKey,
        publicProxy.credential,
        publicProxy.proxyAuthorization,
        publicProxy.proxyUrl,
      ],
    );
    const browserIsolation = {
      ...structuredClone(browser.receipt),
      network: browserNetwork,
    };
    await Promise.all([
      browserProxy.close(),
      publicProxy.close(),
      proxy.close(),
    ]);
    return createOpenWebComparisonTrialOutcome({
      executor: "omp",
      parsed,
      execution,
      outcome,
      persistenceScan,
      infrastructureSignal:
        parsed.infrastructureSignal ||
        processInfrastructureFailureText(execution.stderr),
      credentialBoundary: "loopback_proxy_dummy_child_key",
      modelProxy: structuredClone(proxy.receipt),
      publicNetwork,
      browserIsolation,
      sandbox: {
        id: sandbox.sandboxId,
        profileSha256: sha256(sandbox.profileSha256Input),
      },
    });
  } finally {
    await Promise.all([
      browser?.close().catch(() => undefined),
      browserProxy?.close().catch(() => undefined),
      publicProxy?.close().catch(() => undefined),
      proxy.close().catch(() => undefined),
    ]);
  }
}

export function createOpenWebComparisonTrialOutcome(input) {
  const securityLeak =
    input.execution.secretLeakDetected || input.persistenceScan.leakDetected;
  const browserIsolationFailed =
    input.browserIsolation?.status === "blocked" ||
    input.browserIsolation?.userStateImported === true ||
    input.browserIsolation?.profilePersistent === true ||
    input.browserIsolation?.loopbackOnly === false ||
    input.browserIsolation?.processClosed === false;
  const infrastructureSignal = input.infrastructureSignal;
  const processFailure =
    input.execution.timedOut ||
    input.execution.outputLimitExceeded ||
    input.execution.parseFailed ||
    input.execution.code !== 0 ||
    input.parsed.status !== "completed";
  const status = securityLeak
    ? "failed"
    : browserIsolationFailed
      ? "infrastructure_failure"
      : input.execution.timedOut
        ? "inconclusive"
        : infrastructureSignal &&
            (processFailure || input.parsed.toolFailed > 0)
          ? "infrastructure_failure"
          : processFailure
            ? "failed"
            : input.outcome.passed
              ? "passed"
              : "failed";
  const failureClass = securityLeak
    ? "security_leak"
    : browserIsolationFailed
      ? "external_infrastructure"
      : input.execution.timedOut
        ? "timeout"
        : status === "infrastructure_failure"
          ? "external_infrastructure"
          : input.execution.outputLimitExceeded
            ? "output_limit"
            : input.execution.parseFailed
              ? "machine_protocol"
              : processFailure
                ? "executor_failure"
                : input.outcome.passed
                  ? "none"
                  : "outcome_oracle";
  return {
    executor: input.executor,
    status,
    outcomePassed: status === "passed",
    failureClass,
    durationMs: input.execution.durationMs,
    firstOutputMs: input.execution.firstOutputMs,
    usage: input.parsed.usage,
    toolCounts: input.parsed.toolCounts,
    toolFailed: input.parsed.toolFailed,
    manualInterventionCount: 0,
    diagnostics: [
      ...input.outcome.diagnostics,
      ...(input.execution.timedOut ? ["process_timeout"] : []),
      ...(input.execution.outputLimitExceeded ? ["process_output_limit"] : []),
      ...(input.execution.parseFailed ? ["machine_output_invalid"] : []),
      ...(securityLeak ? ["credential_leak_detected"] : []),
    ],
    evidence: input.outcome.evidence,
    process: {
      exitCode: input.execution.code,
      timedOut: input.execution.timedOut,
      outputLimitExceeded: input.execution.outputLimitExceeded,
      parseFailed: input.execution.parseFailed,
      stdoutBytes: input.execution.stdoutBytes,
      stderrBytes: input.execution.stderrBytes,
      stderrSha256: sha256(input.execution.stderr),
      frameCount: input.parsed.frameCount,
    },
    security: {
      secretLeakDetected: securityLeak,
      ambientCredentialCount: 0,
      credentialBoundary: input.credentialBoundary,
      persistenceScanBytes: input.persistenceScan.bytes,
      persistenceScanFileCount: input.persistenceScan.fileCount,
    },
    ...(input.modelProxy ? { modelProxy: input.modelProxy } : {}),
    ...(input.browserIsolation
      ? { browserIsolation: input.browserIsolation }
      : {}),
    ...(input.publicNetwork ? { publicNetwork: input.publicNetwork } : {}),
    ...(input.sandbox ? { sandbox: input.sandbox } : {}),
  };
}

async function prepareControlledNapier(roots, env) {
  const services = await createLocalAgentRuntime({
    workspaceRoot: roots.workspaceRoot,
    dataRoot: roots.dataRoot,
    env,
  });
  try {
    const agent = services.store.listAgents()[0];
    if (!agent) throw new Error("Controlled Napier Agent is unavailable");
    await services.store.updateAgent(agent.id, {
      toolPolicy: "observe",
      enabledTools: OPEN_WEB_CONTROLLED_NAPIER_TOOLS,
      enabledSkills: [],
      enabledSubagents: [],
    });
  } finally {
    await services.shutdown();
  }
}

function ompArguments(input, roots) {
  return [
    "-p",
    "--model",
    "deepseek/deepseek-v4-flash",
    "--cwd",
    roots.workspaceRoot,
    "--profile",
    OMP_PROFILE,
    "--no-session",
    "--max-time",
    String(Math.ceil(input.timeoutMs / 1_000)),
    "--auto-approve",
    "--approval-mode",
    "yolo",
    "--mode",
    "json",
    ...(input.track === "controlled"
      ? [
          "--no-extensions",
          "--no-skills",
          "--no-rules",
          "--tools",
          "read,browser,web_search",
        ]
      : []),
    input.benchmarkCase.prompt,
  ];
}

async function writeOmpConfig(homeRoot, baseUrl, cdpUrl) {
  const agentDir = path.join(
    homeRoot,
    ".omp",
    "profiles",
    OMP_PROFILE,
    "agent",
  );
  await mkdir(agentDir, { recursive: true, mode: 0o700 });
  const config = [
    "providers:",
    "  deepseek:",
    `    baseUrl: ${baseUrl}`,
    "    apiKey: DEEPSEEK_API_KEY",
    "",
  ].join("\n");
  await writeFile(path.join(agentDir, "models.yml"), config, {
    encoding: "utf8",
    mode: 0o600,
  });
  await writeFile(
    path.join(agentDir, "config.yml"),
    [
      `browser.cdpUrl: ${cdpUrl}`,
      "browser.relay: false",
      "browser.cmux: false",
      "startup.checkUpdate: false",
      'marketplace.autoUpdate: "off"',
      "",
    ].join("\n"),
    { encoding: "utf8", mode: 0o600 },
  );
}

export function createOpenWebComparisonNapierEnvironment(
  roots,
  source,
  credentialEnv,
  includeCredential = true,
) {
  return {
    HOME: roots.homeRoot,
    TMPDIR: roots.trialRoot,
    PATH: source.PATH ?? "/usr/bin:/bin",
    LANG: source.LANG ?? "en_US.UTF-8",
    LC_ALL: source.LC_ALL ?? "en_US.UTF-8",
    ...(includeCredential ? { [credentialEnv]: source[credentialEnv] } : {}),
  };
}

function minimalOmpEnv(roots, childApiKey, input, publicProxyServer) {
  const xdgRoot = path.join(roots.trialRoot, ".omp-xdg");
  const cacheRoot = path.join(xdgRoot, "cache");
  const bunInstallRoot = path.join(roots.trialRoot, ".bun");
  const runtimeNodeModules = path.join(input.ompRuntime.root, "node_modules");
  return {
    HOME: roots.homeRoot,
    TMPDIR: roots.trialRoot,
    BUN_TMPDIR: roots.trialRoot,
    PATH: path.dirname(input.bunExecutable),
    NODE_PATH: runtimeNodeModules,
    BUN_INSTALL: bunInstallRoot,
    BUN_INSTALL_CACHE_DIR: path.join(bunInstallRoot, "install", "cache"),
    BUN_CONFIG_SKIP_INSTALL_PACKAGES: "1",
    BUN_FEATURE_FLAG_DISABLE_STREAMING_INSTALL: "1",
    BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0",
    XDG_DATA_HOME: path.join(xdgRoot, "data"),
    XDG_STATE_HOME: path.join(xdgRoot, "state"),
    XDG_CACHE_HOME: cacheRoot,
    LANG: "en_US.UTF-8",
    LC_ALL: "en_US.UTF-8",
    TERM: "dumb",
    NO_COLOR: "1",
    DEEPSEEK_API_KEY: childApiKey,
    HTTP_PROXY: publicProxyServer,
    HTTPS_PROXY: publicProxyServer,
    NO_PROXY: "127.0.0.1,localhost",
    PUPPETEER_PROXY: publicProxyServer,
    PI_BROWSER_RELAY: "0",
    PI_BROWSER_CMUX: "0",
  };
}

async function prepareOmpRuntimeDirectories(roots) {
  const xdgRoot = path.join(roots.trialRoot, ".omp-xdg");
  await Promise.all([
    ...["data", "state", "cache"].flatMap((kind) => [
      mkdir(path.join(xdgRoot, kind), { recursive: true, mode: 0o700 }),
      mkdir(path.join(xdgRoot, kind, ".omp"), {
        recursive: true,
        mode: 0o700,
      }),
    ]),
    mkdir(path.join(roots.trialRoot, ".bun", "install", "cache"), {
      recursive: true,
      mode: 0o700,
    }),
  ]);
}

async function trialRoots(temporaryRoot, executor, input) {
  const trialRoot = path.join(
    temporaryRoot,
    `${input.benchmarkCase.id}-${input.track}-${String(input.trial)}-${executor}`,
  );
  const workspaceRoot = path.join(trialRoot, "workspace");
  const dataRoot = path.join(trialRoot, "state");
  const homeRoot = path.join(trialRoot, "home");
  await Promise.all([
    mkdir(workspaceRoot, { recursive: true, mode: 0o700 }),
    mkdir(dataRoot, { recursive: true, mode: 0o700 }),
    mkdir(homeRoot, { recursive: true, mode: 0o700 }),
  ]);
  return {
    trialRoot: await realpath(trialRoot),
    workspaceRoot: await realpath(workspaceRoot),
    dataRoot: await realpath(dataRoot),
    homeRoot: await realpath(homeRoot),
  };
}

export async function removeOpenWebComparisonTemporaryRoot(root) {
  await rm(root, { recursive: true, force: true });
}

export function openWebComparisonCaseEvidence(benchmarkCase) {
  return {
    caseId: benchmarkCase.id,
    complexity: benchmarkCase.complexity,
    taskFamily: benchmarkCase.taskFamily,
    promptSha256: benchmarkCase.promptSha256,
    oracleSha256: benchmarkCase.oracleSha256,
    caseSha256: benchmarkCase.caseSha256,
    expectedToolCountsSha256: sha256(
      canonicalJson(benchmarkCase.requiredToolCounts),
    ),
  };
}
