import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { JsonValue, ModelRef, RunEvent } from "@napier/contracts";
import {
  createLocalAgentRuntime,
  exportThreadReplayBundle,
  sha256,
  verifyThreadReplayBundle,
  type LocalAgentRuntimeOptions,
  type LocalAgentRuntimeServices,
} from "@napier/runtime";

import { writeBenchmarkCasFile } from "./benchmark-artifact-file.js";
import { CLI_VERSION } from "./cli-options.js";
import { loadResearchBenchmarkCase } from "./research-benchmark-case.js";
import { createResearchBenchmarkCaptureProvider } from "./research-benchmark-captures.js";
import {
  createResearchBenchmarkEvaluation,
  createResearchBenchmarkResult,
  researchBenchmarkLedgerFileName,
  researchBenchmarkResultFileName,
  verifyResearchBenchmarkArtifacts,
} from "./research-benchmark-contract.js";
import {
  collectResearchBenchmarkEvents,
  deriveResearchBenchmarkEvidence,
} from "./research-benchmark-evidence.js";
import { createResearchBenchmarkLedgerBundle } from "./research-benchmark-ledger.js";
import type {
  ResearchBenchmarkArtifacts,
  ResearchBenchmarkResult,
} from "./research-benchmark-types.js";

export interface RunResearchBenchmarkOptions {
  caseRoot: string;
  outputDir: string;
  model: ModelRef;
  env: Readonly<Record<string, string | undefined>>;
  credentialEnv?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface ResearchBenchmarkDependencies {
  createRuntime(
    options: LocalAgentRuntimeOptions,
  ): Promise<LocalAgentRuntimeServices>;
  now(): Date;
}

const DEFAULT_DEPENDENCIES: ResearchBenchmarkDependencies = {
  createRuntime: createLocalAgentRuntime,
  now: () => new Date(),
};

export async function runResearchBenchmark(
  options: RunResearchBenchmarkOptions,
  dependencies: ResearchBenchmarkDependencies = DEFAULT_DEPENDENCIES,
): Promise<ResearchBenchmarkArtifacts> {
  const loaded = await loadResearchBenchmarkCase(options.caseRoot);
  const timeoutMs = options.timeoutMs ?? loaded.benchmarkCase.timeoutMs;
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 10_000 ||
    timeoutMs > loaded.benchmarkCase.timeoutMs
  ) {
    throw new Error(
      `Research benchmark timeout must be 10000-${loaded.benchmarkCase.timeoutMs}`,
    );
  }
  const credential = researchBenchmarkCredential(options);
  const temporaryRoot = await mkdtemp(
    path.join(tmpdir(), "napier-research-benchmark-"),
  );
  const workspaceRoot = path.join(temporaryRoot, "workspace");
  const dataRoot = path.join(temporaryRoot, "state");
  await mkdir(workspaceRoot);
  let runtime: LocalAgentRuntimeServices | undefined;
  try {
    const captures = createResearchBenchmarkCaptureProvider(loaded.sources);
    runtime = await dependencies.createRuntime({
      workspaceRoot,
      dataRoot,
      env: options.env,
      researchSourceCaptures: captures,
    });
    await configureCredential(runtime, options.model, credential);
    if (!(await runtime.models.isConfigured(options.model))) {
      throw new Error("Research benchmark model is not configured");
    }
    const agent = runtime.store.listAgents()[0]!;
    const profile = await runtime.store.updateAgent(agent.id, {
      toolPolicy: "unrestricted",
      enabledTools: ["research_source", "apply_patch"],
      enabledSkills: [],
    });
    const thread = await runtime.store.createThread({
      title: loaded.benchmarkCase.title,
      agentId: profile.id,
    });
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const signal = options.signal
      ? AbortSignal.any([options.signal, timeoutSignal])
      : timeoutSignal;
    const run = await runtime.runtime.runPrompt({
      threadId: thread.id,
      text: loaded.prompt,
      model: options.model,
      signal,
    });
    const events = await runtime.store.listEvents(thread.id);
    const replay = await exportThreadReplayBundle(runtime.store, thread.id);
    const reportPath = path.join(
      workspaceRoot,
      loaded.benchmarkCase.reportPath,
    );
    const report = await readFile(reportPath, "utf8").catch(() => undefined);
    const reportFileSha256 = report ? sha256(report) : undefined;
    const researchEvents = collectResearchBenchmarkEvents(events, run.id);
    const evidence = deriveResearchBenchmarkEvidence({
      events: researchEvents,
      sources: loaded.sources.sources,
      expected: loaded.expected,
      ...(report ? { report } : {}),
      ...(reportFileSha256 ? { reportFileSha256 } : {}),
    });
    const credentialLeakDetected =
      credential !== undefined &&
      JSON.stringify({ run, events, replay }).includes(credential.value);
    const evaluation = createResearchBenchmarkEvaluation({
      caseId: loaded.benchmarkCase.id,
      caseSha256: loaded.benchmarkCase.contentSha256,
      runStatus: run.status,
      ...evidence,
      ...(reportFileSha256 ? { reportFileSha256 } : {}),
      reportFileBytes: report ? Buffer.byteLength(report, "utf8") : 0,
      replayValid: verifyThreadReplayBundle(replay).status === "valid",
      credentialLeakDetected,
    });
    const evaluationEvent = await runtime.store.appendEvent({
      threadId: thread.id,
      runId: run.id,
      type: "benchmark.research.evaluated",
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
    const runEvidence = researchRunEvidence(thread.id, run);
    const reportEvidence: ResearchBenchmarkResult["report"] = {
      pathSha256: sha256(loaded.benchmarkCase.reportPath),
      ...(reportFileSha256 ? { fileSha256: reportFileSha256 } : {}),
      fileBytes: report ? Buffer.byteLength(report, "utf8") : 0,
    };
    const bundle = createResearchBenchmarkLedgerBundle({
      generatedAt,
      caseId: loaded.benchmarkCase.id,
      caseSha256: loaded.benchmarkCase.contentSha256,
      threadId: thread.id,
      run: runEvidence,
      expectedClaimsSha256: evidence.expectedClaimsSha256,
      ...(evidence.actualClaimsSha256
        ? { actualClaimsSha256: evidence.actualClaimsSha256 }
        : {}),
      contradictionClaimSha256: sha256(loaded.expected.claims[1]!),
      expectedCitationEvidenceSha256: evidence.expectedCitationEvidenceSha256,
      expectedSourceSetSha256: evidence.expectedSourceSetSha256,
      sourceAuthorities: loaded.sources.sources.map((source) => ({
        sourceContentSha256: source.capture.capturedContentSha256,
        authority: source.authority,
      })),
      report: reportEvidence,
      evaluationEvent,
      terminalEvent,
      researchEvents,
      events: finalReplay.events,
      sourceEventStreamSha256: finalReplay.eventStreamSha256,
      sourceReplaySha256: finalReplay.contentSha256,
    });
    const serializedBundle = `${JSON.stringify(bundle, null, 2)}\n`;
    const ledgerFileName = researchBenchmarkLedgerFileName(
      loaded.benchmarkCase.id,
      bundle.contentSha256,
    );
    const outputDir = path.resolve(options.outputDir);
    const ledgerPath = path.join(outputDir, ledgerFileName);
    await writeBenchmarkCasFile(ledgerPath, serializedBundle);
    const result = createResearchBenchmarkResult({
      kind: "napier.research-benchmark-result",
      schemaVersion: 1,
      generatedAt,
      caseId: loaded.benchmarkCase.id,
      caseSha256: loaded.benchmarkCase.contentSha256,
      status: evaluation.status,
      model: structuredClone(options.model),
      environment: {
        nodeVersion: process.versions.node,
        platform: process.platform,
        arch: process.arch,
        cliVersion: CLI_VERSION,
      },
      run: runEvidence,
      report: reportEvidence,
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
      researchBenchmarkResultFileName(result.caseId, result.contentSha256),
    );
    await writeBenchmarkCasFile(
      resultPath,
      `${JSON.stringify(result, null, 2)}\n`,
    );
    const verification = verifyResearchBenchmarkArtifacts(result, bundle);
    if (!verification.valid) {
      throw new Error(
        `Research benchmark artifacts failed self-verification: ${verification.diagnostics.join(",")}`,
      );
    }
    return { result, bundle, resultPath, ledgerPath };
  } finally {
    await runtime?.shutdown().catch(() => undefined);
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

function researchBenchmarkCredential(
  options: RunResearchBenchmarkOptions,
): { variable: string; value: string } | undefined {
  if (!options.credentialEnv) return undefined;
  if (!/^[A-Z_][A-Z0-9_]{1,127}$/u.test(options.credentialEnv)) {
    throw new Error("Research benchmark credential environment is invalid");
  }
  const value = options.env[options.credentialEnv]?.trim();
  if (!value) {
    throw new Error(
      "Research benchmark credential environment variable is unavailable",
    );
  }
  return { variable: options.credentialEnv, value };
}

async function configureCredential(
  runtime: LocalAgentRuntimeServices,
  model: ModelRef,
  credential: { variable: string; value: string } | undefined,
): Promise<void> {
  if (!credential) return;
  await runtime.store.createCredentialReference({
    providerId: model.provider,
    label: "Research benchmark credential",
    source: { type: "environment", variable: credential.variable },
  });
}

function terminalRunEvent(events: RunEvent[], runId: string): RunEvent {
  const event = events.find(
    (candidate) =>
      candidate.runId === runId &&
      ["run.completed", "run.failed", "run.cancelled"].includes(candidate.type),
  );
  if (!event) throw new Error("Research benchmark terminal event is missing");
  return event;
}

function researchRunEvidence(
  threadId: string,
  run: {
    id: string;
    status: ResearchBenchmarkResult["run"]["status"];
    startedAt: string;
    finishedAt?: string;
    usage: ResearchBenchmarkResult["run"]["usage"];
  },
): ResearchBenchmarkResult["run"] {
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
