import { lstat, mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { JsonValue, RunEvent, RunRecord } from "@napier/contracts";
import {
  createLocalAgentRuntime,
  exportThreadReplayBundle,
  verifyThreadReplayBundle,
  type LocalAgentRuntimeOptions,
  type LocalAgentRuntimeServices,
} from "@napier/runtime/agent";
import {
  sha256,
} from "@napier/runtime/core";

import { writeBenchmarkCasFile } from "./benchmark-artifact-file.js";
import {
  loadBrowserConfirmedFormBenchmarkCase,
  validateBrowserConfirmedFormBenchmarkInputs,
} from "./browser-confirmed-form-benchmark-case.js";
import {
  executeBrowserConfirmedFormCliPty,
  type BrowserConfirmedFormCliExecution,
  type BrowserConfirmedFormCliRequest,
} from "./browser-confirmed-form-benchmark-cli.js";
import {
  createBrowserConfirmedFormBenchmarkEvaluation,
  verifyBrowserConfirmedFormBenchmarkArtifacts,
} from "./browser-confirmed-form-benchmark-contract.js";
import {
  browserConfirmedFormEvidence,
  browserConfirmedFormEvidenceEvents,
  browserConfirmedFormLedgerFileName,
  browserConfirmedFormResultFileName,
  createBrowserConfirmedFormBenchmarkLedger,
  createBrowserConfirmedFormBenchmarkResult,
} from "./browser-confirmed-form-benchmark-evidence.js";
import type {
  BrowserConfirmedFormBenchmarkArtifacts,
  BrowserConfirmedFormBenchmarkResult,
} from "./browser-confirmed-form-benchmark-types.js";
import { CLI_VERSION } from "@napier/cli/runner";

const MAX_STATE_SCAN_BYTES = 32 * 1024 * 1024;

export interface RunBrowserConfirmedFormBenchmarkOptions {
  caseRoot: string;
  outputDir: string;
  model: { provider: string; id: string };
  env: Readonly<Record<string, string | undefined>>;
  credentialEnv: string;
  targetUrl: string;
  formValue: string;
  signal?: AbortSignal;
}

export interface BrowserConfirmedFormBenchmarkDependencies {
  createRuntime(
    options: LocalAgentRuntimeOptions,
  ): Promise<LocalAgentRuntimeServices>;
  executeCli(
    request: BrowserConfirmedFormCliRequest,
  ): Promise<BrowserConfirmedFormCliExecution>;
  now(): Date;
}

const DEFAULT_DEPENDENCIES: BrowserConfirmedFormBenchmarkDependencies = {
  createRuntime: createLocalAgentRuntime,
  executeCli: executeBrowserConfirmedFormCliPty,
  now: () => new Date(),
};

export async function runBrowserConfirmedFormBenchmark(
  options: RunBrowserConfirmedFormBenchmarkOptions,
  dependencies: BrowserConfirmedFormBenchmarkDependencies = DEFAULT_DEPENDENCIES,
): Promise<BrowserConfirmedFormBenchmarkArtifacts> {
  const benchmarkCase = await loadBrowserConfirmedFormBenchmarkCase(
    options.caseRoot,
  );
  validateOptions(options, benchmarkCase.timeoutMs);
  validateBrowserConfirmedFormBenchmarkInputs(
    benchmarkCase,
    options.targetUrl,
    options.formValue,
  );
  const credential = options.env[options.credentialEnv]?.trim()!;
  const temporaryRoot = await mkdtemp(
    path.join(tmpdir(), "napier-browser-confirmed-form-"),
  );
  const workspaceRoot = path.join(temporaryRoot, "workspace");
  const dataRoot = path.join(temporaryRoot, "state");
  await mkdir(workspaceRoot);
  let runtime: LocalAgentRuntimeServices | undefined;
  try {
    const timeoutSignal = AbortSignal.timeout(benchmarkCase.timeoutMs + 10_000);
    const signal = options.signal
      ? AbortSignal.any([options.signal, timeoutSignal])
      : timeoutSignal;
    const prompt = benchmarkPrompt(
      options.targetUrl,
      options.formValue,
      benchmarkCase.expectedAssistantText,
    );
    const execution = await dependencies.executeCli({
      args: [
        "run",
        "--workspace",
        workspaceRoot,
        "--data-root",
        dataRoot,
        "--prompt",
        prompt,
        "--model",
        `${options.model.provider}/${options.model.id}`,
        "--credential-env",
        options.credentialEnv,
        "--preset",
        "safe_automation",
        "--timeout-ms",
        String(benchmarkCase.timeoutMs),
      ],
      cwd: temporaryRoot,
      env: options.env,
      expectedActions: benchmarkCase.expectedConfirmationActions,
      signal,
    });
    runtime = await dependencies.createRuntime({
      workspaceRoot,
      dataRoot,
      env: options.env,
    });
    const thread = runtime.store
      .listThreads()
      .filter((candidate) => candidate.title === "CLI one-shot")
      .at(-1);
    if (!thread) throw new Error("Browser confirmed form Thread is missing");
    const run = runtime.store.listRuns(thread.id).at(-1);
    if (!run) throw new Error("Browser confirmed form Run is missing");
    const events = await runtime.store.listEvents(thread.id);
    const replay = await exportThreadReplayBundle(runtime.store, thread.id);
    const replayValid = verifyThreadReplayBundle(replay).status === "valid";
    const assistantText = latestAssistantText(events, run.id);
    const expectedAssistantSha256 = sha256(benchmarkCase.expectedAssistantText);
    const actualAssistantSha256 = assistantText
      ? sha256(assistantText)
      : undefined;
    const references = runtime.store.listCredentialReferences();
    const reference = references[0];
    const evidence = browserConfirmedFormEvidence(events);
    const stateCredentialLeakDetected = await scanRootsForCredential(
      [workspaceRoot, dataRoot],
      credential,
    );
    const evidenceText = JSON.stringify(
      browserConfirmedFormEvidenceEvents(events),
    );
    const credentialLeakDetected =
      execution.output.includes(credential) ||
      evidenceText.includes(credential);
    const privateValueLeakDetected =
      execution.output.includes(options.targetUrl) ||
      execution.output.includes(options.formValue) ||
      evidenceText.includes(options.targetUrl) ||
      evidenceText.includes(options.formValue);
    const evaluation = createBrowserConfirmedFormBenchmarkEvaluation({
      caseId: benchmarkCase.id,
      caseSha256: benchmarkCase.contentSha256,
      runStatus: run.status,
      cliExitCode: execution.cliExitCode,
      assistantOutputMatch: actualAssistantSha256 === expectedAssistantSha256,
      confirmationPromptCount: execution.confirmationPromptCount,
      approvalInputCount: execution.approvalInputCount,
      unexpectedConfirmationAction: execution.unexpectedConfirmationAction,
      expectedConfirmationActions: benchmarkCase.expectedConfirmationActions,
      expectedConfirmationEffects: benchmarkCase.expectedConfirmationEffects,
      expectedOutcomeUrlSha256: benchmarkCase.expectedOutcomeUrlSha256,
      expectedOutcomeTitleSha256: benchmarkCase.expectedOutcomeTitleSha256,
      confirmations: evidence.confirmations,
      browserOperations: evidence.browserOperations,
      firstConfirmationMs: execution.firstConfirmationMs,
      totalDurationMs: execution.totalDurationMs,
      maxDurationMs: benchmarkCase.maxDurationMs,
      credentialReferenceCount: references.length,
      credentialProviderMatch: reference?.providerId === options.model.provider,
      credentialLocatorMatch:
        reference?.source.type === "environment" &&
        reference.source.variable === options.credentialEnv,
      credentialAvailable: reference?.availability === "available",
      replayValid,
      credentialLeakDetected,
      credentialPersistenceLeakDetected: stateCredentialLeakDetected,
      privateValueLeakDetected,
    });
    const evaluationEvent = await runtime.store.appendEvent({
      threadId: thread.id,
      runId: run.id,
      type: "benchmark.browser.confirmed_form.evaluated",
      category: "evaluation",
      visibility: "user",
      payload: evaluation as unknown as JsonValue,
    });
    const finalReplay = await exportThreadReplayBundle(
      runtime.store,
      thread.id,
    );
    const terminalEvent = terminalRunEvent(finalReplay.events, run.id);
    const generatedAt = dependencies.now().toISOString();
    const runEvidence = createRunEvidence(thread.id, run);
    const safeExecution = withoutOutput(execution);
    const bundle = createBrowserConfirmedFormBenchmarkLedger({
      generatedAt,
      caseId: benchmarkCase.id,
      caseSha256: benchmarkCase.contentSha256,
      threadId: thread.id,
      runId: run.id,
      model: options.model,
      expectedAssistantSha256,
      ...(actualAssistantSha256 ? { actualAssistantSha256 } : {}),
      expectedOutcomeUrlSha256: benchmarkCase.expectedOutcomeUrlSha256,
      expectedOutcomeTitleSha256: benchmarkCase.expectedOutcomeTitleSha256,
      expectedConfirmationActions: benchmarkCase.expectedConfirmationActions,
      expectedConfirmationEffects: benchmarkCase.expectedConfirmationEffects,
      maxDurationMs: benchmarkCase.maxDurationMs,
      credentialVariableSha256: sha256(options.credentialEnv),
      run: runEvidence,
      execution: safeExecution,
      events: finalReplay.events,
      sourceEventStreamSha256: finalReplay.eventStreamSha256,
      sourceReplaySha256: finalReplay.contentSha256,
      replayValid,
      credentialReferenceCount: references.length,
      credentialProviderMatch: evaluation.credentialProviderMatch,
      credentialLocatorMatch: evaluation.credentialLocatorMatch,
      credentialAvailable: evaluation.credentialAvailable,
      credentialLeakDetected,
      credentialPersistenceLeakDetected: stateCredentialLeakDetected,
      privateValueLeakDetected,
      evaluationEvent,
      terminalEvent,
    });
    const serializedBundle = `${JSON.stringify(bundle, null, 2)}\n`;
    const outputDir = path.resolve(options.outputDir);
    const ledgerFileName = browserConfirmedFormLedgerFileName(
      benchmarkCase.id,
      bundle.contentSha256,
    );
    const ledgerPath = path.join(outputDir, ledgerFileName);
    await writeBenchmarkCasFile(ledgerPath, serializedBundle);
    const result = createBrowserConfirmedFormBenchmarkResult({
      kind: "napier.browser-confirmed-form-benchmark-result",
      schemaVersion: 1,
      generatedAt,
      caseId: benchmarkCase.id,
      caseSha256: benchmarkCase.contentSha256,
      status: evaluation.status,
      model: structuredClone(options.model),
      environment: {
        nodeVersion: process.versions.node,
        platform: process.platform,
        arch: process.arch,
        cliVersion: CLI_VERSION,
      },
      run: runEvidence,
      execution: safeExecution,
      evaluation,
      ledger: {
        bundleFileName: ledgerFileName,
        bundleSha256: bundle.contentSha256,
        bundleBytes: Buffer.byteLength(serializedBundle, "utf8"),
      },
    });
    const resultPath = path.join(
      outputDir,
      browserConfirmedFormResultFileName(
        benchmarkCase.id,
        result.contentSha256,
      ),
    );
    await writeBenchmarkCasFile(
      resultPath,
      `${JSON.stringify(result, null, 2)}\n`,
    );
    const verification = verifyBrowserConfirmedFormBenchmarkArtifacts(
      result,
      bundle,
    );
    if (!verification.valid) {
      throw new Error(
        `Browser confirmed form artifacts failed self-verification: ${verification.diagnostics.join(",")}`,
      );
    }
    return { result, bundle, resultPath, ledgerPath };
  } finally {
    await runtime?.shutdown().catch(() => undefined);
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

function validateOptions(
  options: RunBrowserConfirmedFormBenchmarkOptions,
  timeoutMs: number,
): void {
  if (!/^[A-Z_][A-Z0-9_]{1,127}$/u.test(options.credentialEnv)) {
    throw new Error("Browser confirmed form credential environment is invalid");
  }
  if (!options.env[options.credentialEnv]?.trim()) {
    throw new Error(
      "Browser confirmed form credential environment is unavailable",
    );
  }
  if (options.model.provider === "napier") {
    throw new Error("Browser confirmed form benchmark requires a live model");
  }
  if (timeoutMs !== 180_000) {
    throw new Error("Browser confirmed form benchmark timeout is invalid");
  }
}

function benchmarkPrompt(
  targetUrl: string,
  formValue: string,
  finalText: string,
): string {
  return [
    `Open ${targetUrl} in the Browser.`,
    `Use the first form only. Type ${formValue} into its email field and click that form's submit control.`,
    "Verify the click result is titled We Arrive Here; take another snapshot only if that result does not already expose the fresh page state.",
    "Do not interact with any password field or any other form.",
    `Close the Browser and reply with exactly ${finalText}.`,
  ].join(" ");
}

function latestAssistantText(events: RunEvent[], runId: string): string {
  return (
    (
      events.findLast(
        (event) => event.runId === runId && event.type === "message.assistant",
      )?.payload as { text?: string } | undefined
    )?.text ?? ""
  );
}

function terminalRunEvent(events: RunEvent[], runId: string): RunEvent {
  const event = events.find(
    (candidate) =>
      candidate.runId === runId &&
      [
        "run.completed",
        "run.failed",
        "run.cancelled",
        "run.interrupted",
      ].includes(candidate.type),
  );
  if (!event)
    throw new Error("Browser confirmed form terminal event is missing");
  return event;
}

function createRunEvidence(
  threadId: string,
  run: RunRecord,
): BrowserConfirmedFormBenchmarkResult["run"] {
  return {
    threadId,
    runId: run.id,
    status: run.status,
    durationMs: run.finishedAt
      ? Math.max(0, Date.parse(run.finishedAt) - Date.parse(run.startedAt))
      : 0,
    usage: structuredClone(run.usage),
  };
}

function withoutOutput(
  execution: BrowserConfirmedFormCliExecution,
): BrowserConfirmedFormBenchmarkResult["execution"] {
  const { output: _output, ...safe } = execution;
  return safe;
}

async function scanRootsForCredential(
  roots: string[],
  credential: string,
): Promise<boolean> {
  const files: string[] = [];
  for (const root of roots) await collectFiles(root, files);
  let totalBytes = 0;
  for (const file of files) {
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink()) {
      throw new Error("Browser confirmed form state entry is unsafe");
    }
    totalBytes += info.size;
    if (totalBytes > MAX_STATE_SCAN_BYTES) {
      throw new Error("Browser confirmed form state exceeds scan budget");
    }
    if ((await readFile(file)).includes(Buffer.from(credential))) return true;
  }
  return false;
}

async function collectFiles(root: string, files: string[]): Promise<void> {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const filePath = path.join(root, entry.name);
    if (entry.isDirectory()) await collectFiles(filePath, files);
    else files.push(filePath);
  }
}
