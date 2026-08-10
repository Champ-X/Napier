import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { PassThrough, Writable } from "node:stream";

import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import {
  canonicalJson,
  createLocalAgentRuntime,
  sha256,
  type BrowserSessionDetails,
  type LocalAgentRuntimeOptions,
  type RunBrowserSessionManager,
  UnsupportedSandboxAdapter,
} from "@napier/runtime";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  loadBrowserConfirmedFormBenchmarkCase,
  validateBrowserConfirmedFormBenchmarkCase,
} from "../src/browser-confirmed-form-benchmark-case.js";
import type {
  BrowserConfirmedFormCliExecution,
  BrowserConfirmedFormCliRequest,
} from "../src/browser-confirmed-form-benchmark-cli.js";
import { executeBrowserConfirmedFormCliPty } from "../src/browser-confirmed-form-benchmark-cli.js";
import { verifyBrowserConfirmedFormBenchmarkArtifacts } from "../src/browser-confirmed-form-benchmark-contract.js";
import { browserConfirmedFormLedgerFileName } from "../src/browser-confirmed-form-benchmark-evidence.js";
import {
  runBrowserConfirmedFormBenchmarkSeries,
  verifyBrowserConfirmedFormBenchmarkSeries,
} from "../src/browser-confirmed-form-benchmark-series.js";
import type {
  BrowserConfirmedFormBenchmarkLedger,
  BrowserConfirmedFormBenchmarkResult,
} from "../src/browser-confirmed-form-benchmark-types.js";
import { runBrowserConfirmedFormBenchmark } from "../src/browser-confirmed-form-benchmark.js";
import { runCli } from "../src/cli.js";

const CASE_ROOT = path.resolve(
  import.meta.dirname,
  "../../../benchmarks/browser/confirmed-form-cli-v1",
);
const TARGET_URL = "https://www.selenium.dev/selenium/web/formPage.html";
const FORM_VALUE = "napier-form-benchmark@example.com";
const OUTCOME_URL = "https://www.selenium.dev/selenium/web/resultPage.html?";
const OUTCOME_TITLE = "We Arrive Here";
const CREDENTIAL = "PRIVATE_BROWSER_BENCHMARK_CREDENTIAL";
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Browser confirmed form benchmark", () => {
  it("loads a hash-bound content-minimal case and rejects drift", async () => {
    const benchmarkCase =
      await loadBrowserConfirmedFormBenchmarkCase(CASE_ROOT);
    expect(benchmarkCase).toEqual(
      expect.objectContaining({
        id: "browser_confirmed_form_cli_v1",
        targetUrlSha256: sha256(TARGET_URL),
        formValueSha256: sha256(FORM_VALUE),
        expectedConfirmationActions: ["type", "click"],
        expectedConfirmationEffects: ["data_entry", "form_submit"],
        expectedOutcomeUrlSha256: sha256(OUTCOME_URL),
        expectedOutcomeTitleSha256: sha256(OUTCOME_TITLE),
      }),
    );
    expect(JSON.stringify(benchmarkCase)).not.toContain(TARGET_URL);
    expect(JSON.stringify(benchmarkCase)).not.toContain(FORM_VALUE);
    expect(() =>
      validateBrowserConfirmedFormBenchmarkCase({
        ...benchmarkCase,
        maxDurationMs: 1,
      }),
    ).toThrow("case hash mismatch");
  });

  it("runs the formal one-shot confirmation path and writes private-safe artifacts", async () => {
    const outputDir = await temporaryOutput();
    const artifacts = await runBrowserConfirmedFormBenchmark(
      benchmarkOptions(outputDir),
      benchmarkDependencies(),
    );

    expect(
      artifacts.result.run.status,
      JSON.stringify(artifacts.bundle.terminalEvent),
    ).toBe("completed");
    expect(artifacts.result).toEqual(
      expect.objectContaining({
        status: "passed",
        execution: expect.objectContaining({
          entry: "cli_one_shot_pty",
          cliExitCode: 0,
          confirmationPromptCount: 2,
          approvalInputCount: 2,
          unexpectedConfirmationAction: false,
        }),
        evaluation: expect.objectContaining({
          confirmationActions: ["type", "click"],
          confirmationEffects: ["data_entry", "form_submit"],
          browserActions: [
            "start",
            "find",
            "snapshot",
            "navigate",
            "back",
            "forward",
            "tab_new",
            "tab_close",
            "type",
            "click",
            "close",
          ],
          browserWriteActions: ["type", "click"],
          browserOutcomeUrlMatch: true,
          browserOutcomeTitleMatch: true,
          browserSingleSession: true,
          credentialLeakDetected: false,
          credentialPersistenceLeakDetected: false,
          privateValueLeakDetected: false,
          replayValid: true,
          diagnostics: [],
        }),
      }),
    );
    expect(
      verifyBrowserConfirmedFormBenchmarkArtifacts(
        artifacts.result,
        artifacts.bundle,
      ),
    ).toEqual(expect.objectContaining({ valid: true, diagnostics: [] }));
    const serialized = JSON.stringify(artifacts);
    expect(serialized).not.toContain(TARGET_URL);
    expect(serialized).not.toContain(FORM_VALUE);
    expect(serialized).not.toContain(CREDENTIAL);
  });

  it("rejects outcome substitution after recomputing outer hashes", async () => {
    const outputDir = await temporaryOutput();
    const artifacts = await runBrowserConfirmedFormBenchmark(
      benchmarkOptions(outputDir),
      benchmarkDependencies(),
    );
    const bundle = structuredClone(artifacts.bundle);
    const click = bundle.browserOperations.find(
      (operation) => operation.action === "click",
    )!;
    click.currentUrlSha256 = sha256("https://substituted.example/");
    rehash(bundle);
    const result = structuredClone(artifacts.result);
    result.ledger.bundleSha256 = bundle.contentSha256;
    result.ledger.bundleFileName = browserConfirmedFormLedgerFileName(
      result.caseId,
      bundle.contentSha256,
    );
    result.ledger.bundleBytes = Buffer.byteLength(
      `${JSON.stringify(bundle, null, 2)}\n`,
      "utf8",
    );
    rehash(result);

    expect(
      verifyBrowserConfirmedFormBenchmarkArtifacts(result, bundle),
    ).toEqual(
      expect.objectContaining({
        valid: false,
        diagnostics: expect.arrayContaining([
          "ledger_evidence_binding_invalid",
          "evaluation_evidence_mismatch",
        ]),
      }),
    );
  });

  it("rejects injected raw fields even after recomputing hashes", async () => {
    const outputDir = await temporaryOutput();
    const artifacts = await runBrowserConfirmedFormBenchmark(
      benchmarkOptions(outputDir),
      benchmarkDependencies(),
    );
    const result = structuredClone(artifacts.result) as unknown as Record<
      string,
      unknown
    >;
    result["privateUrl"] = TARGET_URL;
    rehashUnknown(result);
    expect(
      verifyBrowserConfirmedFormBenchmarkArtifacts(result, artifacts.bundle),
    ).toEqual(
      expect.objectContaining({
        valid: false,
        diagnostics: ["result_shape_invalid"],
      }),
    );

    const bundle = structuredClone(artifacts.bundle) as unknown as Record<
      string,
      unknown
    >;
    const evidenceEvents = bundle["evidenceEvents"] as Array<
      Record<string, unknown>
    >;
    const toolEvent = evidenceEvents.find(
      (event) => event["type"] === "tool.completed",
    )!;
    (toolEvent["payload"] as Record<string, unknown>)["privateSelector"] =
      "#email";
    rehashUnknown(bundle);
    expect(
      verifyBrowserConfirmedFormBenchmarkArtifacts(artifacts.result, bundle),
    ).toEqual(
      expect.objectContaining({
        valid: false,
        diagnostics: ["ledger_shape_invalid"],
      }),
    );
  });

  it("binds two independent formal-entry outcomes into one Series", async () => {
    const outputDir = await temporaryOutput();
    const artifacts = await runBrowserConfirmedFormBenchmarkSeries(
      { ...benchmarkOptions(outputDir), trialCount: 2 },
      benchmarkDependencies(),
    );

    expect(artifacts.series).toEqual(
      expect.objectContaining({
        status: "completed",
        requestedTrialCount: 2,
        completedTrialCount: 2,
        passedTrialCount: 2,
        failedTrialCount: 0,
        inconclusiveTrialCount: 0,
        completionRate: 1,
        passRate: 1,
      }),
    );
    expect(
      verifyBrowserConfirmedFormBenchmarkSeries(
        artifacts.series,
        artifacts.trials,
      ),
    ).toEqual(
      expect.objectContaining({
        valid: true,
        diagnostics: [],
        trialDiagnostics: [],
      }),
    );
    expect(
      new Set(artifacts.series.trials.map((trial) => trial.threadId)).size,
    ).toBe(2);
  });

  it("returns bounded PTY cancellation evidence instead of throwing", async () => {
    const outputDir = await temporaryOutput();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 100);
    try {
      const execution = await executeBrowserConfirmedFormCliPty({
        args: [
          "chat",
          "--workspace",
          outputDir,
          "--data-root",
          path.join(outputDir, "state"),
          "--model",
          "napier/demo",
        ],
        cwd: outputDir,
        env: process.env,
        expectedActions: [],
        signal: controller.signal,
      });
      expect(execution).toEqual(
        expect.objectContaining({
          entry: "cli_one_shot_pty",
          confirmationPromptCount: 0,
          approvalInputCount: 0,
        }),
      );
      expect(execution.cliExitCode).not.toBe(0);
      expect(execution.totalDurationMs).toBeLessThan(5_000);
    } finally {
      clearTimeout(timer);
    }
  });
});

function benchmarkOptions(outputDir: string) {
  return {
    caseRoot: CASE_ROOT,
    outputDir,
    model: { provider: "confirmed-form-faux", id: "faux-1" },
    env: { CONFIRMED_FORM_API_KEY: CREDENTIAL },
    credentialEnv: "CONFIRMED_FORM_API_KEY",
    targetUrl: TARGET_URL,
    formValue: FORM_VALUE,
  };
}

function benchmarkDependencies() {
  return {
    async createRuntime(options: LocalAgentRuntimeOptions) {
      return createLocalAgentRuntime({
        ...options,
        sandbox: new UnsupportedSandboxAdapter("confirmed-form-inspect"),
      });
    },
    executeCli: executeFormalCli,
    now: () => new Date("2026-08-05T00:00:00.000Z"),
  };
}

async function executeFormalCli(
  request: BrowserConfirmedFormCliRequest,
): Promise<BrowserConfirmedFormCliExecution> {
  const provider = confirmedFormProvider();
  const input = ttyInput();
  const stdout = new CaptureWritable();
  const stderr = new CaptureWritable();
  const startedAt = performance.now();
  const running = runCli(
    request.args,
    {
      cwd: request.cwd,
      env: request.env,
      stdin: input,
      stdout,
      stderr,
    },
    {
      async createRuntime(options) {
        const services = await createLocalAgentRuntime({
          ...options,
          browserSessions: confirmedFormSessions(),
          sandbox: new UnsupportedSandboxAdapter("confirmed-form-run"),
        });
        const agent = services.store.listAgents()[0]!;
        await services.store.updateAgent(agent.id, {
          runLimits: {
            ...agent.runLimits,
            maxTotalTokens: 1_000_000,
          },
        });
        services.models.registerProvider(provider.provider);
        return services;
      },
      runReadiness: {
        processSandbox: async () => ({
          status: "ready",
          code: "shell_ready",
          message: "Controlled confirmed-form process readiness",
        }),
      },
    },
    request.signal,
  );
  let firstConfirmationMs = 0;
  for (const action of request.expectedActions) {
    await vi.waitFor(() =>
      expect(stderr.text()).toContain(
        `[confirm] Browser ${action} paused before execution`,
      ),
    );
    firstConfirmationMs ||= Math.round(performance.now() - startedAt);
    input.write("approve\n");
    await vi.waitFor(() =>
      expect(stderr.text()).toContain(`[confirm] Browser ${action} approved`),
    );
  }
  const cliExitCode = await running;
  input.end();
  const output = `${stdout.text()}${stderr.text()}`;
  const totalDurationMs = Math.round(performance.now() - startedAt);
  return {
    entry: "cli_one_shot_pty",
    cliExitCode,
    confirmationPromptCount: count(output, "paused before execution"),
    approvalInputCount: request.expectedActions.length,
    unexpectedConfirmationAction: false,
    firstConfirmationMs,
    totalDurationMs,
    terminalOutputSha256: sha256(output),
    terminalOutputBytes: Buffer.byteLength(output, "utf8"),
    output,
  };
}

function confirmedFormProvider() {
  const provider = fauxProvider({ provider: "confirmed-form-faux" });
  provider.setResponses([
    fauxAssistantMessage(
      fauxToolCall("browser", { action: "start", url: TARGET_URL }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage(
      fauxToolCall("browser", { action: "find", query: "email" }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage(fauxToolCall("browser", { action: "snapshot" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage(
      fauxToolCall("browser", {
        action: "navigate",
        url: TARGET_URL,
      }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage(fauxToolCall("browser", { action: "back" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage(fauxToolCall("browser", { action: "forward" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage(
      fauxToolCall("browser", {
        action: "tab_new",
        url: TARGET_URL,
      }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage(
      fauxToolCall("browser", { action: "tab_close", tabId: "tab_2" }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage(
      fauxToolCall("browser", {
        action: "type",
        target: { selector: "#email" },
        text: FORM_VALUE,
      }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage(
      fauxToolCall("browser", {
        action: "click",
        target: { selector: "#submitButton" },
      }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage(fauxToolCall("browser", { action: "close" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("BROWSER_CONFIRMED_FORM_OK"),
    fauxAssistantMessage('{"facts":[]}'),
  ]);
  return provider;
}

function confirmedFormSessions(): RunBrowserSessionManager {
  let operation = 0;
  const session = {
    async execute(
      _owner: { threadId: string; runId: string },
      request: { action: BrowserSessionDetails["action"] },
    ) {
      operation += 1;
      return {
        output: `CONFIRMED_FORM_${request.action.toUpperCase()}`,
        details: browserDetails(request.action, operation),
      };
    },
    async captureConfirmationPageState(
      _owner: { threadId: string; runId: string },
      request: { action: "click" | "type" },
    ) {
      const effect = request.action === "type" ? "data_entry" : "form_submit";
      const content = {
        kind: "napier.browser-confirmation-page-state" as const,
        schemaVersion: 1 as const,
        sessionIdSha256: "a".repeat(64),
        sessionOperation: operation,
        activeTabId: "tab_1",
        tabCount: 1,
        tabSetSha256: sha256(canonicalJson(["tab_1"])),
        currentUrlSha256: sha256(operation >= 3 ? OUTCOME_URL : TARGET_URL),
        currentOriginSha256: sha256("https://www.selenium.dev"),
        targetStateSha256: sha256(`target:${request.action}:${operation}`),
        targetEffect: effect,
        targetSensitivity: "ordinary" as const,
        targetSensitivitySha256: sha256(canonicalJson([])),
      };
      return {
        ...content,
        contentSha256: sha256(canonicalJson(content)),
      };
    },
    async executeConfirmedAction(
      owner: { threadId: string; runId: string },
      request: { action: BrowserSessionDetails["action"] },
      _state: unknown,
    ) {
      return this.execute(owner, request);
    },
    async cancelRun() {},
    hasActiveSession() {
      return true;
    },
  };
  return session as unknown as RunBrowserSessionManager;
}

function browserDetails(
  action: BrowserSessionDetails["action"],
  operation: number,
): BrowserSessionDetails {
  const submitted = operation >= 3;
  return {
    kind: "napier.browser-session-operation",
    schemaVersion: 3,
    action,
    sessionMode: "run_persistent",
    sessionReused: operation > 1,
    sessionOperation: operation,
    sessionIdSha256: "a".repeat(64),
    activeTabId: "tab_1",
    tabCount: 1,
    tabSetSha256: sha256(canonicalJson(["tab_1"])),
    browserExecutableSha256: "b".repeat(64),
    browserVersionSha256: "c".repeat(64),
    limitsSha256: "d".repeat(64),
    currentUrlSha256: sha256(submitted ? OUTCOME_URL : TARGET_URL),
    currentOriginSha256: sha256("https://www.selenium.dev"),
    titleSha256: sha256(submitted ? OUTCOME_TITLE : "Test Page"),
    pageDiagnosis: {
      status: "none",
      signalCount: 0,
      signalsSha256: sha256(canonicalJson([])),
      takeoverRecommended: false,
    },
    snapshotSha256: sha256(`snapshot:${operation}`),
    snapshotChars: 20,
    snapshotTruncated: false,
    blockedRequestCount: 0,
    network: {
      requestCount: operation,
      connectCount: 1,
      rejectedCount: 0,
      transferredBytes: 100,
      destinationCount: 1,
      destinationsSha256: "e".repeat(64),
    },
    crossOriginAuthorized: false,
  };
}

async function temporaryOutput(): Promise<string> {
  const root = await mkdtemp(
    path.join(tmpdir(), "napier-confirmed-form-bench-test-"),
  );
  roots.push(root);
  return root;
}

function ttyInput(): PassThrough {
  const input = new PassThrough();
  Object.defineProperty(input, "isTTY", { value: true });
  return input;
}

function count(text: string, value: string): number {
  return text.split(value).length - 1;
}

function rehash<
  T extends
    | BrowserConfirmedFormBenchmarkResult
    | BrowserConfirmedFormBenchmarkLedger,
>(value: T): void {
  const { contentSha256: _contentSha256, ...content } = value;
  value.contentSha256 = sha256(canonicalJson(content));
}

function rehashUnknown(value: Record<string, unknown>): void {
  const { contentSha256: _contentSha256, ...content } = value;
  value["contentSha256"] = sha256(canonicalJson(content));
}

class CaptureWritable extends Writable {
  private readonly chunks: string[] = [];

  override _write(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    this.chunks.push(chunk.toString("utf8"));
    callback();
  }

  text(): string {
    return this.chunks.join("");
  }
}
