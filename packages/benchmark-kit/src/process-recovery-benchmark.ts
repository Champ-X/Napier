import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type {
  JsonValue,
  RunEvent,
  WorkspaceProcessSession,
} from "@napier/contracts";
import {
  canonicalJson,
  sha256,
} from "@napier/runtime/core";
import {
  createPlatformSandboxAdapter,
  WorkspaceProcessManager,
  type OsSandboxAdapter,
} from "@napier/runtime/code";
import {
  exportThreadReplayBundle,
  verifyThreadReplayBundle,
} from "@napier/runtime/agent";
import {
  LocalStore,
} from "@napier/runtime/store";

import { writeBenchmarkCasFile } from "./benchmark-artifact-file.js";
import { CLI_VERSION } from "@napier/cli/runner";
import { loadProcessRecoveryBenchmarkCase } from "./process-recovery-benchmark-case.js";
import { verifyProcessRecoveryBenchmarkArtifacts } from "./process-recovery-benchmark-contract.js";
import {
  createProcessRecoveryLedger,
  createProcessRecoveryResult,
  processRecoveryLedgerFileName,
  processRecoveryResultFileName,
} from "./process-recovery-benchmark-evidence.js";
import { TRUSTED_OUTER_PROCESS_BENCHMARK_SANDBOX_ID } from "./process-recovery-benchmark-sandbox.js";
import type {
  ProcessRecoveryBenchmarkArtifacts,
  ProcessRecoveryBenchmarkCase,
  ProcessRecoveryBenchmarkEvaluation,
  ProcessRecoverySandboxBoundary,
} from "./process-recovery-benchmark-types.js";

export interface RunProcessRecoveryBenchmarkOptions {
  caseRoot: string;
  outputDir: string;
  signal?: AbortSignal;
}

export interface ProcessRecoveryBenchmarkDependencies {
  createSandbox(): OsSandboxAdapter;
  now(): Date;
}

const DEFAULT_DEPENDENCIES: ProcessRecoveryBenchmarkDependencies = {
  createSandbox: createPlatformSandboxAdapter,
  now: () => new Date(),
};

export async function runProcessRecoveryBenchmark(
  options: RunProcessRecoveryBenchmarkOptions,
  dependencies: ProcessRecoveryBenchmarkDependencies = DEFAULT_DEPENDENCIES,
): Promise<ProcessRecoveryBenchmarkArtifacts> {
  const benchmarkCase = await loadProcessRecoveryBenchmarkCase(
    options.caseRoot,
  );
  const temporaryRoot = await mkdtemp(
    path.join(tmpdir(), "napier-process-recovery-"),
  );
  const workspaceRoot = path.join(temporaryRoot, "workspace");
  const dataRoot = path.join(temporaryRoot, "state");
  const targetPath = path.join(workspaceRoot, benchmarkCase.targetPath);
  const scopePath = path.join(workspaceRoot, benchmarkCase.writeScope);
  let store: LocalStore | undefined;
  let manager: WorkspaceProcessManager | undefined;
  try {
    await mkdir(scopePath, { recursive: true });
    await writeFile(targetPath, benchmarkCase.initialText, "utf8");
    const initialSha256 = sha256(benchmarkCase.initialText);
    const mutatedSha256 = sha256(benchmarkCase.mutatedText);
    const sandbox = dependencies.createSandbox();
    const sandboxBoundary = processSandboxBoundary(sandbox.id);
    store = new LocalStore({ workspaceRoot, dataRoot });
    await store.initialize();
    manager = new WorkspaceProcessManager({
      store,
      workspaceRoot,
      dataRoot,
      sandbox,
    });
    await manager.initialize();
    const thread = store.listThreads()[0]!;
    const run = store.listRuns(thread.id)[0]!;
    const timeoutSignal = AbortSignal.timeout(benchmarkCase.timeoutMs);
    const signal = options.signal
      ? AbortSignal.any([options.signal, timeoutSignal])
      : timeoutSignal;
    const preview = await manager.previewWrite({
      threadId: thread.id,
      runId: run.id,
      command: benchmarkCommand(benchmarkCase),
      writePaths: [benchmarkCase.writeScope],
      failureRecovery: "restore_scopes",
      signal,
    });
    const started = await manager.startWrite({
      threadId: thread.id,
      runId: run.id,
      previewId: preview.id,
      signal,
    });
    const settled = await manager.waitForSettlement(thread.id, started.id);
    signal.throwIfAborted();
    const finalText = await readFile(targetPath, "utf8");
    const finalSha256 = sha256(finalText);
    const targetRestored = finalText === benchmarkCase.initialText;
    await manager.shutdown();
    manager = undefined;
    store.close();
    store = undefined;

    store = new LocalStore({ workspaceRoot, dataRoot });
    await store.initialize();
    manager = new WorkspaceProcessManager({
      store,
      workspaceRoot,
      dataRoot,
      sandbox: dependencies.createSandbox(),
    });
    await manager.initialize();
    const recovered = (await manager.list(thread.id)).find(
      (candidate) => candidate.id === settled.id,
    );
    const events = await store.listEvents(thread.id);
    const replay = await exportThreadReplayBundle(store, thread.id);
    const evaluation = createEvaluation({
      benchmarkCase,
      sandboxId: sandbox.id,
      sandboxBoundary,
      process: settled,
      recovered,
      targetRestored,
      events,
      replayValid: verifyThreadReplayBundle(replay).status === "valid",
    });
    const evaluationEvent = await store.appendEvent({
      threadId: thread.id,
      runId: run.id,
      type: "benchmark.process.recovery.evaluated",
      category: "evaluation",
      visibility: "user",
      payload: evaluation as unknown as JsonValue,
    });
    const finalReplay = await exportThreadReplayBundle(store, thread.id);
    const generatedAt = dependencies.now().toISOString();
    const bundle = createProcessRecoveryLedger({
      generatedAt,
      caseId: benchmarkCase.id,
      caseSha256: benchmarkCase.contentSha256,
      threadId: thread.id,
      runId: run.id,
      processId: settled.id,
      preview,
      process: recovered ?? settled,
      initialSha256,
      mutatedSha256,
      finalSha256,
      restored: targetRestored,
      events: finalReplay.events,
      replaySha256: finalReplay.contentSha256,
      evaluationEvent,
    });
    const outputDir = path.resolve(options.outputDir);
    const ledgerFileName = processRecoveryLedgerFileName(
      benchmarkCase.id,
      bundle.contentSha256,
    );
    const ledgerPath = path.join(outputDir, ledgerFileName);
    const serializedBundle = `${JSON.stringify(bundle, null, 2)}\n`;
    await writeBenchmarkCasFile(ledgerPath, serializedBundle);
    const result = createProcessRecoveryResult({
      kind: "napier.process-recovery-benchmark-result",
      schemaVersion: 1,
      generatedAt,
      caseId: benchmarkCase.id,
      caseSha256: benchmarkCase.contentSha256,
      status: evaluation.status,
      executor: {
        kind: "napier",
        capability: "workspace_process",
        sandboxId: sandbox.id,
        sandboxBoundary,
      },
      environment: {
        nodeVersion: process.versions.node,
        platform: process.platform,
        arch: process.arch,
        cliVersion: CLI_VERSION,
      },
      run: {
        threadId: thread.id,
        runId: run.id,
        processId: settled.id,
        durationMs: settled.durationMs ?? 0,
      },
      evaluation,
      ledger: {
        bundleFileName: ledgerFileName,
        bundleSha256: bundle.contentSha256,
        bundleBytes: Buffer.byteLength(serializedBundle, "utf8"),
      },
    });
    const resultPath = path.join(
      outputDir,
      processRecoveryResultFileName(result.caseId, result.contentSha256),
    );
    await writeBenchmarkCasFile(
      resultPath,
      `${JSON.stringify(result, null, 2)}\n`,
    );
    const verification = verifyProcessRecoveryBenchmarkArtifacts(
      result,
      bundle,
    );
    if (!verification.valid) {
      throw new Error(
        `Process recovery artifacts failed self-verification: ${verification.diagnostics.join(",")}`,
      );
    }
    return { result, bundle, resultPath, ledgerPath };
  } finally {
    await manager?.shutdown().catch(() => undefined);
    store?.close();
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

function benchmarkCommand(benchmarkCase: ProcessRecoveryBenchmarkCase) {
  const script = [
    'const fs = require("node:fs");',
    'fs.writeFileSync(process.argv[1], Buffer.from(process.argv[2], "base64"));',
    "process.exit(Number(process.argv[3]));",
  ].join("");
  return {
    runtime: "node" as const,
    args: [
      "-e",
      script,
      benchmarkCase.targetPath,
      Buffer.from(benchmarkCase.mutatedText, "utf8").toString("base64"),
      String(benchmarkCase.expectedExitCode),
    ],
    timeoutMs: benchmarkCase.timeoutMs,
  };
}

function createEvaluation(input: {
  benchmarkCase: ProcessRecoveryBenchmarkCase;
  sandboxId: string;
  sandboxBoundary: ProcessRecoverySandboxBoundary;
  process: WorkspaceProcessSession;
  recovered: WorkspaceProcessSession | undefined;
  targetRestored: boolean;
  events: RunEvent[];
  replayValid: boolean;
}): ProcessRecoveryBenchmarkEvaluation {
  const processEvents = input.events.filter((event) =>
    event.type.startsWith("workspace.process."),
  );
  const eventTypes = processEvents.map((event) => event.type);
  const diagnostics: string[] = [];
  if (input.process.schemaVersion !== 7)
    diagnostics.push("process_schema_mismatch");
  if (input.process.status !== input.benchmarkCase.expectedProcessStatus)
    diagnostics.push("process_status_mismatch");
  if (input.process.exitCode !== input.benchmarkCase.expectedExitCode)
    diagnostics.push("process_exit_code_mismatch");
  if (input.process.workspaceDeltaStatus !== "changed")
    diagnostics.push("workspace_delta_mismatch");
  if (input.process.workspaceWriteScopeStatus !== "within_scope")
    diagnostics.push("write_scope_mismatch");
  if (
    input.process.workspaceCompensationStatus !==
    input.benchmarkCase.expectedCompensationStatus
  )
    diagnostics.push("compensation_status_mismatch");
  if (input.process.workspaceRollbackAvailable !== false)
    diagnostics.push("rollback_availability_mismatch");
  if (!input.targetRestored) diagnostics.push("target_not_restored");
  if (!input.process.recoverySnapshotSha256)
    diagnostics.push("recovery_snapshot_missing");
  if (
    canonicalJson(eventTypes) !==
    canonicalJson(input.benchmarkCase.expectedProcessEventTypes)
  )
    diagnostics.push("process_event_order_mismatch");
  if (!recoveredSessionMatches(input.process, input.recovered))
    diagnostics.push("reopen_recovery_mismatch");
  if (!input.replayValid) diagnostics.push("replay_invalid");
  const content = {
    kind: "napier.process-recovery-benchmark-evaluation" as const,
    schemaVersion: 1 as const,
    caseId: input.benchmarkCase.id,
    caseSha256: input.benchmarkCase.contentSha256,
    status:
      diagnostics.length === 0 ? ("passed" as const) : ("failed" as const),
    sandboxId: input.sandboxId,
    sandboxBoundary: input.sandboxBoundary,
    processSchemaVersion: input.process.schemaVersion,
    processStatus: input.process.status,
    processExitCode: input.process.exitCode ?? null,
    workspaceDeltaStatus: input.process.workspaceDeltaStatus ?? "missing",
    workspaceWriteScopeStatus:
      input.process.workspaceWriteScopeStatus ?? "missing",
    workspaceCompensationStatus:
      input.process.workspaceCompensationStatus ?? "missing",
    workspaceRollbackAvailable:
      input.process.workspaceRollbackAvailable === true,
    targetRestored: input.targetRestored,
    recoverySnapshotPresent: Boolean(input.process.recoverySnapshotSha256),
    processEventCount: processEvents.length,
    processEventOrderValid: diagnostics.includes("process_event_order_mismatch")
      ? false
      : true,
    recoveredAfterReopen: recoveredSessionMatches(
      input.process,
      input.recovered,
    ),
    replayValid: input.replayValid,
    diagnostics,
  };
  return { ...content, contentSha256: sha256(canonicalJson(content)) };
}

function recoveredSessionMatches(
  settled: WorkspaceProcessSession,
  recovered: WorkspaceProcessSession | undefined,
): boolean {
  return (
    recovered?.id === settled.id &&
    recovered.status === settled.status &&
    recovered.exitCode === settled.exitCode &&
    recovered.workspaceDeltaStatus === settled.workspaceDeltaStatus &&
    recovered.workspaceWriteScopeStatus === settled.workspaceWriteScopeStatus &&
    recovered.writePreviewSha256 === settled.writePreviewSha256 &&
    recovered.recoverySnapshotSha256 === settled.recoverySnapshotSha256 &&
    recovered.workspaceCompensationStatus ===
      settled.workspaceCompensationStatus &&
    recovered.workspaceRollbackAvailable === false
  );
}

function processSandboxBoundary(
  sandboxId: string,
): ProcessRecoverySandboxBoundary {
  return sandboxId === TRUSTED_OUTER_PROCESS_BENCHMARK_SANDBOX_ID
    ? "trusted_outer_test"
    : "platform";
}
