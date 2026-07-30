import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type {
  JsonValue,
  ModelRef,
  RunEvent,
  RunRecord,
} from "@napier/contracts";
import {
  createLocalAgentRuntime,
  createWorkspacePathSnapshot,
  diffWorkspaceSnapshots,
  hashEventStream,
  sha256,
  streamSnapshotFrame,
} from "@napier/runtime";

import { CLI_VERSION, runCli, type RunCliDependencies } from "./cli.js";
import {
  codingBenchmarkTargetEvidence,
  copyCodingBenchmarkFixture,
  loadCodingBenchmarkCase,
  writeCodingBenchmarkCasFile,
} from "./coding-benchmark-case.js";
import {
  collectCodingBenchmarkToolMetrics,
  createCodingBenchmarkEvaluation,
  createCodingBenchmarkLedgerBundle,
  createCodingBenchmarkResult,
  verifyCodingBenchmarkArtifacts,
  type CodingBenchmarkResult,
} from "./coding-benchmark-contract.js";
import {
  runCodingBenchmarkOutcomeTest,
  type RunCodingBenchmarkOutcomeTestInput,
} from "./coding-benchmark-outcome.js";
import {
  configureCodingBenchmarkAgent,
  validateCodingBenchmarkCredential,
  type CodingBenchmarkRuntimeFactory,
} from "./coding-benchmark-session.js";
import {
  CodingBenchmarkCapture,
  validateCodingBenchmarkStream,
} from "./coding-benchmark-stream.js";

export interface RunCodingBenchmarkOptions {
  caseRoot: string;
  outputDir: string;
  model: ModelRef;
  env: Readonly<Record<string, string | undefined>>;
  credentialEnv?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface CodingBenchmarkDependencies extends CodingBenchmarkRuntimeFactory {
  now(): Date;
  runOutcomeTest?(
    input: RunCodingBenchmarkOutcomeTestInput,
  ): ReturnType<typeof runCodingBenchmarkOutcomeTest>;
}

export interface CodingBenchmarkArtifacts {
  result: CodingBenchmarkResult;
  resultPath: string;
  ledgerPath: string;
}

const DEFAULT_DEPENDENCIES: CodingBenchmarkDependencies = {
  createRuntime: createLocalAgentRuntime,
  now: () => new Date(),
  runOutcomeTest: runCodingBenchmarkOutcomeTest,
};

export async function runCodingBenchmark(
  options: RunCodingBenchmarkOptions,
  dependencies: CodingBenchmarkDependencies = DEFAULT_DEPENDENCIES,
): Promise<CodingBenchmarkArtifacts> {
  const loaded = await loadCodingBenchmarkCase(options.caseRoot);
  const timeoutMs = options.timeoutMs ?? loaded.benchmarkCase.timeoutMs;
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1_000 ||
    timeoutMs > loaded.benchmarkCase.timeoutMs
  ) {
    throw new Error(
      `Coding benchmark timeout must be 1000-${loaded.benchmarkCase.timeoutMs}`,
    );
  }
  validateCodingBenchmarkCredential(options);
  const temporaryRoot = await mkdtemp(
    path.join(tmpdir(), "napier-coding-benchmark-"),
  );
  const workspaceRoot = path.join(temporaryRoot, "workspace");
  const dataRoot = path.join(temporaryRoot, "state");
  await mkdir(workspaceRoot);
  try {
    await copyCodingBenchmarkFixture(loaded.fixtureRoot, workspaceRoot);
    const before = await createWorkspacePathSnapshot(
      workspaceRoot,
      workspaceRoot,
    );
    if (
      before.truncated ||
      before.sha256 !== loaded.benchmarkCase.fixtureSha256
    ) {
      throw new Error("Coding benchmark copied fixture hash mismatch");
    }
    await configureCodingBenchmarkAgent({
      benchmarkCase: loaded.benchmarkCase,
      workspaceRoot,
      dataRoot,
      model: options.model,
      env: options.env,
      ...(options.credentialEnv
        ? { credentialEnv: options.credentialEnv }
        : {}),
      timeoutMs,
      runtimeFactory: dependencies,
    });
    const stdout = new CodingBenchmarkCapture();
    const stderr = new CodingBenchmarkCapture();
    const cliDependencies: RunCliDependencies = {
      createRuntime: dependencies.createRuntime,
    };
    const exitCode = await runCli(
      [
        "run",
        "--workspace",
        workspaceRoot,
        "--data-root",
        dataRoot,
        "--agent",
        "agent_napier",
        "--title",
        loaded.benchmarkCase.title,
        "--prompt",
        loaded.prompt,
        "--model",
        `${options.model.provider}/${options.model.id}`,
        "--timeout-ms",
        String(timeoutMs),
        "--jsonl",
      ],
      {
        cwd: temporaryRoot,
        env: options.env,
        stdout,
        stderr,
      },
      cliDependencies,
      options.signal,
    );
    if (stderr.text()) {
      throw new Error("Coding benchmark CLI wrote machine-mode stderr");
    }
    const stream = validateCodingBenchmarkStream(stdout.text(), exitCode);
    const after = await createWorkspacePathSnapshot(
      workspaceRoot,
      workspaceRoot,
    );
    const targetEvidence = await codingBenchmarkTargetEvidence(
      path.join(workspaceRoot, loaded.benchmarkCase.targetPath),
    );
    const outcomeSignal =
      stream.done.status === "cancelled" ? AbortSignal.abort() : options.signal;
    const outcomeTest = await (
      dependencies.runOutcomeTest ?? runCodingBenchmarkOutcomeTest
    )({
      workspaceRoot,
      dataRoot,
      env: options.env,
      testSource: loaded.outcomeTestSource,
      testSha256: loaded.benchmarkCase.outcomeTestSha256,
      runtimeFactory: dependencies,
      ...(outcomeSignal ? { signal: outcomeSignal } : {}),
    });
    const evaluation = createCodingBenchmarkEvaluation({
      benchmarkCase: loaded.benchmarkCase,
      runStatus: stream.done.status,
      before,
      after,
      delta: diffWorkspaceSnapshots(before, after),
      targetAfterSha256: targetEvidence.sha256,
      targetAfterAstSha256: targetEvidence.astSha256,
      outcomeTest,
    });
    const evidence = await appendCodingBenchmarkEvidence({
      dependencies,
      workspaceRoot,
      dataRoot,
      env: options.env,
      threadId: stream.done.threadId,
      runId: stream.done.runId,
      evaluation,
    });
    const run = evidence.detail.runs.find(
      (candidate) => candidate.id === stream.done.runId,
    );
    if (
      !run ||
      run.agentRevision === undefined ||
      !run.configuration?.contentSha256 ||
      !run.finishedAt
    ) {
      throw new Error("Coding benchmark final Run evidence is incomplete");
    }
    const generatedAt = dependencies.now().toISOString();
    const durationMs = Math.max(
      0,
      Date.parse(run.finishedAt) - Date.parse(run.startedAt),
    );
    const tooling = collectCodingBenchmarkToolMetrics(
      evidence.detail.events,
      run.id,
    );
    const bundle = createCodingBenchmarkLedgerBundle({
      generatedAt,
      benchmarkCase: loaded.benchmarkCase,
      threadId: run.threadId,
      run: {
        id: run.id,
        agentId: run.agentId,
        agentRevision: run.agentRevision,
        status: run.status,
        model: structuredClone(options.model),
        configurationSha256: run.configuration.contentSha256,
        durationMs,
        usage: structuredClone(run.usage),
      },
      tooling,
      evaluationEvent: evidence.event,
      events: evidence.detail.events,
      sourceSnapshotSha256: streamSnapshotFrame(evidence.detail).detailSha256,
    });
    return writeCodingBenchmarkArtifacts({
      options,
      benchmarkCaseId: loaded.benchmarkCase.id,
      generatedAt,
      run,
      durationMs,
      tooling,
      evaluation,
      evaluationEvent: evidence.event,
      events: evidence.detail.events,
      bundle,
    });
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

async function appendCodingBenchmarkEvidence(input: {
  dependencies: CodingBenchmarkDependencies;
  workspaceRoot: string;
  dataRoot: string;
  env: Readonly<Record<string, string | undefined>>;
  threadId: string;
  runId: string;
  evaluation: ReturnType<typeof createCodingBenchmarkEvaluation>;
}) {
  const runtime = await input.dependencies.createRuntime({
    workspaceRoot: input.workspaceRoot,
    dataRoot: input.dataRoot,
    env: input.env,
  });
  try {
    const event = await runtime.store.appendEvent({
      threadId: input.threadId,
      runId: input.runId,
      type: "benchmark.evaluated",
      category: "evaluation",
      visibility: "user",
      payload: input.evaluation as unknown as JsonValue,
    });
    return {
      event,
      detail: await runtime.store.getDetail(input.threadId),
    };
  } finally {
    await runtime.shutdown();
  }
}

async function writeCodingBenchmarkArtifacts(input: {
  options: RunCodingBenchmarkOptions;
  benchmarkCaseId: string;
  generatedAt: string;
  run: RunRecord;
  durationMs: number;
  tooling: ReturnType<typeof collectCodingBenchmarkToolMetrics>;
  evaluation: ReturnType<typeof createCodingBenchmarkEvaluation>;
  evaluationEvent: RunEvent;
  events: RunEvent[];
  bundle: ReturnType<typeof createCodingBenchmarkLedgerBundle>;
}): Promise<CodingBenchmarkArtifacts> {
  const serializedBundle = `${JSON.stringify(input.bundle, null, 2)}\n`;
  const ledgerFileName = `napier-benchmark-ledger-${input.benchmarkCaseId}-${input.bundle.contentSha256.slice(0, 16)}.json`;
  const outputDir = path.resolve(input.options.outputDir);
  const ledgerPath = path.join(outputDir, ledgerFileName);
  await writeCodingBenchmarkCasFile(ledgerPath, serializedBundle);
  const result = createCodingBenchmarkResult({
    kind: "napier.coding-benchmark-result",
    schemaVersion: 1,
    generatedAt: input.generatedAt,
    caseId: input.benchmarkCaseId,
    caseSha256: input.evaluation.caseSha256,
    status: input.evaluation.status,
    model: structuredClone(input.options.model),
    environment: {
      nodeVersion: process.versions.node,
      platform: process.platform,
      arch: process.arch,
      cliVersion: CLI_VERSION,
    },
    run: {
      threadId: input.run.threadId,
      runId: input.run.id,
      status: input.run.status,
      agentId: input.run.agentId,
      agentRevision: input.run.agentRevision!,
      configurationSha256: input.run.configuration!.contentSha256,
      durationMs: input.durationMs,
      usage: structuredClone(input.run.usage),
    },
    tooling: input.tooling,
    evaluation: input.evaluation,
    ledger: {
      eventId: input.evaluationEvent.id,
      eventSeq: input.evaluationEvent.seq,
      eventSha256: sha256(JSON.stringify(input.evaluationEvent)),
      eventStreamSha256: hashEventStream(input.events),
      bundleFileName: ledgerFileName,
      bundleSha256: input.bundle.contentSha256,
      bundleBytes: Buffer.byteLength(serializedBundle, "utf8"),
    },
  });
  const resultFileName = `napier-benchmark-result-${input.benchmarkCaseId}-${result.contentSha256.slice(0, 16)}.json`;
  const resultPath = path.join(outputDir, resultFileName);
  await writeCodingBenchmarkCasFile(
    resultPath,
    `${JSON.stringify(result, null, 2)}\n`,
  );
  const verification = verifyCodingBenchmarkArtifacts(result, input.bundle);
  if (!verification.valid) {
    throw new Error(
      `Coding benchmark artifacts failed self-verification: ${verification.diagnostics.join(",")}`,
    );
  }
  return { result, resultPath, ledgerPath };
}
