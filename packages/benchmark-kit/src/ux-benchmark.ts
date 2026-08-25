import { lstat, mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type {
  JsonValue,
  ModelRef,
  RunEvent,
  RunRecord,
  StreamFrame,
} from "@napier/contracts";
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
import { CLI_VERSION } from "@napier/cli/runner";
import { loadUxBenchmarkCase } from "./ux-benchmark-case.js";
import {
  executeUxBenchmarkCliSubprocess,
  type UxBenchmarkCliExecution,
  type UxBenchmarkCliRequest,
} from "./ux-benchmark-cli-execution.js";
import {
  createUxBenchmarkEvaluation,
  createUxBenchmarkResult,
  uxBenchmarkLedgerFileName,
  uxBenchmarkResultFileName,
  verifyUxBenchmarkArtifacts,
} from "./ux-benchmark-contract.js";
import { createUxBenchmarkLedgerBundle } from "./ux-benchmark-ledger.js";
import type {
  UxBenchmarkArtifacts,
  UxBenchmarkResult,
} from "./ux-benchmark-types.js";

const MAX_STATE_SCAN_BYTES = 32 * 1024 * 1024;

export interface RunUxBenchmarkOptions {
  caseRoot: string;
  outputDir: string;
  model: ModelRef;
  env: Readonly<Record<string, string | undefined>>;
  credentialEnv: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface UxBenchmarkDependencies {
  createRuntime(
    options: LocalAgentRuntimeOptions,
  ): Promise<LocalAgentRuntimeServices>;
  executeCli(request: UxBenchmarkCliRequest): Promise<UxBenchmarkCliExecution>;
  now(): Date;
}

const DEFAULT_DEPENDENCIES: UxBenchmarkDependencies = {
  createRuntime: createLocalAgentRuntime,
  executeCli: executeUxBenchmarkCliSubprocess,
  now: () => new Date(),
};

export async function runUxBenchmark(
  options: RunUxBenchmarkOptions,
  dependencies: UxBenchmarkDependencies = DEFAULT_DEPENDENCIES,
): Promise<UxBenchmarkArtifacts> {
  const loaded = await loadUxBenchmarkCase(options.caseRoot);
  const timeoutMs = options.timeoutMs ?? loaded.benchmarkCase.timeoutMs;
  validateOptions(options, timeoutMs, loaded.benchmarkCase.timeoutMs);
  const credential = options.env[options.credentialEnv]?.trim()!;
  const temporaryRoot = await mkdtemp(
    path.join(tmpdir(), "napier-ux-benchmark-"),
  );
  const workspaceRoot = path.join(temporaryRoot, "workspace");
  const dataRoot = path.join(temporaryRoot, "state");
  await mkdir(workspaceRoot);
  let runtime: LocalAgentRuntimeServices | undefined;
  try {
    const timeoutSignal = AbortSignal.timeout(timeoutMs + 10_000);
    const signal = options.signal
      ? AbortSignal.any([options.signal, timeoutSignal])
      : timeoutSignal;
    const execution = await dependencies.executeCli({
      args: [
        "run",
        "--workspace",
        workspaceRoot,
        "--data-root",
        dataRoot,
        "--prompt",
        loaded.prompt,
        "--model",
        `${options.model.provider}/${options.model.id}`,
        "--credential-env",
        options.credentialEnv,
        "--timeout-ms",
        String(timeoutMs),
        "--jsonl",
      ],
      cwd: temporaryRoot,
      env: options.env,
      signal,
    });
    const frames = parseFrames(execution.stdout);
    const snapshot = latestFrame(frames, "snapshot");
    const done = latestFrame(frames, "done");
    if (!snapshot || !done) {
      throw new Error("UX benchmark CLI did not emit terminal evidence");
    }
    const threadId = snapshot.detail.thread.id;
    const run = snapshot.detail.runs.find(
      (candidate) => candidate.id === done.runId,
    );
    if (!run) throw new Error("UX benchmark terminal Run is missing");
    const assistantText = latestAssistantText(snapshot.detail.events, run.id);
    const expectedOutputSha256 = sha256(loaded.expected.assistantText);
    const actualOutputSha256 = assistantText
      ? sha256(assistantText)
      : undefined;
    const stateCredentialLeakDetected = await scanRootsForCredential(
      [workspaceRoot, dataRoot],
      credential,
    );
    runtime = await dependencies.createRuntime({
      workspaceRoot,
      dataRoot,
      env: options.env,
    });
    const references = runtime.store.listCredentialReferences();
    const reference = references[0];
    const replay = await exportThreadReplayBundle(runtime.store, threadId);
    const replayValid = verifyThreadReplayBundle(replay).status === "valid";
    const credentialLeakDetected = [
      execution.stdout,
      execution.stderr,
      JSON.stringify(replay),
    ].some((value) => value.includes(credential));
    const runEvidence = uxRunEvidence(threadId, run);
    const evaluation = createUxBenchmarkEvaluation({
      caseId: loaded.benchmarkCase.id,
      caseSha256: loaded.benchmarkCase.contentSha256,
      runStatus: run.status,
      cliExitCode: execution.exitCode,
      expectedOutputSha256,
      ...(actualOutputSha256 ? { actualOutputSha256 } : {}),
      manualCommandCount: 1,
      firstEventMs: execution.firstEventMs,
      maxFirstEventMs: loaded.benchmarkCase.maxFirstEventMs,
      totalDurationMs: execution.totalDurationMs,
      maxDurationMs: loaded.benchmarkCase.maxDurationMs,
      credentialReferenceCount: references.length,
      credentialProviderMatch: reference?.providerId === options.model.provider,
      credentialLocatorMatch:
        reference?.source.type === "environment" &&
        reference.source.variable === options.credentialEnv,
      credentialAvailable: reference?.availability === "available",
      threadCountAfter: runtime.store.listThreads().length,
      replayValid,
      credentialLeakDetected,
      credentialPersistenceLeakDetected: stateCredentialLeakDetected,
    });
    const evaluationEvent = await runtime.store.appendEvent({
      threadId,
      runId: run.id,
      type: "benchmark.ux.evaluated",
      category: "evaluation",
      visibility: "user",
      payload: evaluation as unknown as JsonValue,
    });
    const finalReplay = await exportThreadReplayBundle(runtime.store, threadId);
    const terminalEvent = terminalRunEvent(finalReplay.events, run.id);
    const generatedAt = dependencies.now().toISOString();
    const environment = {
      nodeVersion: process.versions.node,
      platform: process.platform,
      arch: process.arch,
      cliVersion: CLI_VERSION,
    };
    const bundle = createUxBenchmarkLedgerBundle({
      generatedAt,
      caseId: loaded.benchmarkCase.id,
      caseSha256: loaded.benchmarkCase.contentSha256,
      threadId,
      model: options.model,
      environment,
      run: runEvidence,
      expectedOutputSha256,
      ...(actualOutputSha256 ? { actualOutputSha256 } : {}),
      credentialVariableSha256: sha256(options.credentialEnv),
      cliExitCode: execution.exitCode,
      manualCommandCount: 1,
      firstEventMs: execution.firstEventMs,
      maxFirstEventMs: loaded.benchmarkCase.maxFirstEventMs,
      totalDurationMs: execution.totalDurationMs,
      maxDurationMs: loaded.benchmarkCase.maxDurationMs,
      credentialReferenceCount: references.length,
      credentialProviderMatch: evaluation.credentialProviderMatch,
      credentialLocatorMatch: evaluation.credentialLocatorMatch,
      credentialAvailable: evaluation.credentialAvailable,
      threadCountAfter: runtime.store.listThreads().length,
      replayValid,
      credentialLeakDetected,
      credentialPersistenceLeakDetected: stateCredentialLeakDetected,
      evaluationEvent,
      terminalEvent,
      events: finalReplay.events,
      sourceEventStreamSha256: finalReplay.eventStreamSha256,
      sourceReplaySha256: finalReplay.contentSha256,
    });
    const serializedBundle = `${JSON.stringify(bundle, null, 2)}\n`;
    const ledgerFileName = uxBenchmarkLedgerFileName(
      loaded.benchmarkCase.id,
      bundle.contentSha256,
    );
    const outputDir = path.resolve(options.outputDir);
    const ledgerPath = path.join(outputDir, ledgerFileName);
    await writeBenchmarkCasFile(ledgerPath, serializedBundle);
    const result = createUxBenchmarkResult({
      kind: "napier.ux-benchmark-result",
      schemaVersion: 1,
      generatedAt,
      caseId: loaded.benchmarkCase.id,
      caseSha256: loaded.benchmarkCase.contentSha256,
      status: evaluation.status,
      model: structuredClone(options.model),
      environment,
      run: runEvidence,
      evaluation,
      ledger: {
        eventId: evaluationEvent.id,
        eventSeq: evaluationEvent.seq,
        eventSha256: sha256(JSON.stringify(evaluationEvent)),
        eventStreamSha256: bundle.sourceEventStreamSha256,
        bundleFileName: ledgerFileName,
        bundleSha256: bundle.contentSha256,
        bundleBytes: Buffer.byteLength(serializedBundle, "utf8"),
      },
    });
    const resultPath = path.join(
      outputDir,
      uxBenchmarkResultFileName(result.caseId, result.contentSha256),
    );
    await writeBenchmarkCasFile(
      resultPath,
      `${JSON.stringify(result, null, 2)}\n`,
    );
    const verification = verifyUxBenchmarkArtifacts(result, bundle);
    if (!verification.valid) {
      throw new Error(
        `UX benchmark artifacts failed self-verification: ${verification.diagnostics.join(",")}`,
      );
    }
    return { result, bundle, resultPath, ledgerPath };
  } finally {
    await runtime?.shutdown().catch(() => undefined);
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

function validateOptions(
  options: RunUxBenchmarkOptions,
  timeoutMs: number,
  maximumTimeoutMs: number,
): void {
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 10_000 ||
    timeoutMs > maximumTimeoutMs
  ) {
    throw new Error(`UX benchmark timeout must be 10000-${maximumTimeoutMs}`);
  }
  if (!/^[A-Z_][A-Z0-9_]{1,127}$/u.test(options.credentialEnv)) {
    throw new Error("UX benchmark credential environment is invalid");
  }
  if (!options.env[options.credentialEnv]?.trim()) {
    throw new Error("UX benchmark credential environment is unavailable");
  }
  if (options.model.provider === "napier") {
    throw new Error("UX benchmark requires a live provider model");
  }
}

function parseFrames(output: string): StreamFrame[] {
  return output
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as StreamFrame);
}

function latestFrame<Type extends StreamFrame["type"]>(
  frames: StreamFrame[],
  type: Type,
): Extract<StreamFrame, { type: Type }> | undefined {
  return frames.findLast(
    (frame): frame is Extract<StreamFrame, { type: Type }> =>
      frame.type === type,
  );
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

function uxRunEvidence(
  threadId: string,
  run: RunRecord,
): UxBenchmarkResult["run"] {
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

function terminalRunEvent(events: RunEvent[], runId: string): RunEvent {
  const event = events.find(
    (candidate) =>
      candidate.runId === runId &&
      ["run.completed", "run.failed", "run.cancelled"].includes(candidate.type),
  );
  if (!event) throw new Error("UX benchmark terminal event is missing");
  return event;
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
      throw new Error("UX benchmark state entry is unsafe");
    }
    totalBytes += info.size;
    if (totalBytes > MAX_STATE_SCAN_BYTES) {
      throw new Error("UX benchmark state exceeds scan budget");
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
