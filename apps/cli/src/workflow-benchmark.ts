import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  emptyUsage,
  type JsonValue,
  type ModelRef,
  type RunEvent,
  type RunRecord,
  type Usage,
} from "@napier/contracts";
import {
  canonicalJson,
  createLocalAgentRuntime,
  exportThreadReplayBundle,
  sha256,
  verifyThreadReplayBundle,
  type LocalAgentRuntimeOptions,
  type LocalAgentRuntimeServices,
} from "@napier/runtime";

import { writeBenchmarkCasFile } from "./benchmark-artifact-file.js";
import { CLI_VERSION } from "./cli-options.js";
import { loadWorkflowBenchmarkCase } from "./workflow-benchmark-case.js";
import {
  createWorkflowBenchmarkEvaluation,
  createWorkflowBenchmarkResult,
  verifyWorkflowBenchmarkArtifacts,
  workflowBenchmarkLedgerFileName,
  workflowBenchmarkResultFileName,
} from "./workflow-benchmark-contract.js";
import { createWorkflowBenchmarkLedgerBundle } from "./workflow-benchmark-ledger.js";
import type {
  WorkflowBenchmarkArtifacts,
  WorkflowBenchmarkResult,
} from "./workflow-benchmark-types.js";
import { createWorkflowBenchmarkManifest } from "./workflow-benchmark-workflow.js";

export interface RunWorkflowBenchmarkOptions {
  caseRoot: string;
  outputDir: string;
  model: ModelRef;
  env: Readonly<Record<string, string | undefined>>;
  credentialEnv?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface WorkflowBenchmarkDependencies {
  createRuntime(
    options: LocalAgentRuntimeOptions,
  ): Promise<LocalAgentRuntimeServices>;
  now(): Date;
}

const DEFAULT_DEPENDENCIES: WorkflowBenchmarkDependencies = {
  createRuntime: createLocalAgentRuntime,
  now: () => new Date(),
};

export async function runWorkflowBenchmark(
  options: RunWorkflowBenchmarkOptions,
  dependencies: WorkflowBenchmarkDependencies = DEFAULT_DEPENDENCIES,
): Promise<WorkflowBenchmarkArtifacts> {
  const loaded = await loadWorkflowBenchmarkCase(options.caseRoot);
  const timeoutMs = options.timeoutMs ?? loaded.benchmarkCase.timeoutMs;
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 10_000 ||
    timeoutMs > loaded.benchmarkCase.timeoutMs
  ) {
    throw new Error(
      `Workflow benchmark timeout must be 10000-${loaded.benchmarkCase.timeoutMs}`,
    );
  }
  const credential = workflowBenchmarkCredential(options);
  const temporaryRoot = await mkdtemp(
    path.join(tmpdir(), "napier-workflow-benchmark-"),
  );
  const workspaceRoot = path.join(temporaryRoot, "workspace");
  const dataRoot = path.join(temporaryRoot, "state");
  await mkdir(workspaceRoot);
  let runtime: LocalAgentRuntimeServices | undefined;
  try {
    runtime = await dependencies.createRuntime({
      workspaceRoot,
      dataRoot,
      env: options.env,
    });
    if (credential) {
      await runtime.store.createCredentialReference({
        providerId: options.model.provider,
        label: "Workflow benchmark credential",
        source: { type: "environment", variable: credential.variable },
      });
    }
    if (!(await runtime.models.isConfigured(options.model))) {
      throw new Error("Workflow benchmark model is not configured");
    }
    const manifest = await createWorkflowBenchmarkManifest({
      store: runtime.store,
      benchmarkCase: loaded.benchmarkCase,
      benchmarkInput: loaded.input,
      model: options.model,
    });
    const sourceThread = runtime.store.listThreads()[0]!;
    const thread = await runtime.store.createThread({
      title: loaded.benchmarkCase.title,
      agentId: sourceThread.agentId,
    });
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const signal = options.signal
      ? AbortSignal.any([options.signal, timeoutSignal])
      : timeoutSignal;
    const workflowResult = await runtime.workflows.run({
      threadId: thread.id,
      request: {
        manifest,
        input: loaded.input as unknown as JsonValue,
      },
      signal,
    });
    const eventsBeforeEvaluation = await runtime.store.listEvents(thread.id);
    const runs = runtime.store.listRuns(thread.id);
    const replayBeforeEvaluation = await exportThreadReplayBundle(
      runtime.store,
      thread.id,
    );
    const mapResult = workflowResult.nodeResults.find(
      (result) => result.nodeId === "extract",
    );
    const reduceResult = workflowResult.nodeResults.find(
      (result) => result.nodeId === "total_length",
    );
    const mapOutputSha256 =
      mapResult?.output === undefined
        ? undefined
        : sha256(canonicalJson(mapResult.output));
    const mapRuns = runs.filter(
      (run) =>
        run.configuration !== undefined &&
        "executionMode" in run.configuration &&
        run.configuration.executionMode === "workflow_map_read_only" &&
        run.status === "completed",
    );
    const reduceModelOrToolEventCount = reduceResult?.runId
      ? eventsBeforeEvaluation.filter(
          (event) =>
            event.runId === reduceResult.runId &&
            (event.type === "model.response" || event.type.startsWith("tool.")),
        ).length
      : 0;
    const credentialLeakDetected =
      credential !== undefined &&
      JSON.stringify({
        workflowResult,
        runs,
        events: eventsBeforeEvaluation,
        replay: replayBeforeEvaluation,
      }).includes(credential.value);
    const evaluation = createWorkflowBenchmarkEvaluation({
      benchmarkCase: loaded.benchmarkCase,
      workflowStatus: workflowResult.status,
      expectedOutputSha256: sha256(canonicalJson(loaded.expected.output)),
      ...(workflowResult.outputSha256
        ? { actualOutputSha256: workflowResult.outputSha256 }
        : {}),
      expectedMapOutputSha256: sha256(canonicalJson(loaded.expected.mapItems)),
      ...(mapOutputSha256 !== undefined
        ? { actualMapOutputSha256: mapOutputSha256 }
        : {}),
      expectedNodeResultCount: 2,
      completedNodeResultCount: workflowResult.nodeResults.filter(
        (result) => result.status === "completed",
      ).length,
      expectedMapItemCount: loaded.input.documents.length,
      completedMapRunCount: mapRuns.length,
      mapCompletedEventCount: countEvents(
        eventsBeforeEvaluation,
        "workflow.map.item.completed",
      ),
      reduceCompletedEventCount: countEvents(
        eventsBeforeEvaluation,
        "workflow.reduce.completed",
      ),
      reduceModelOrToolEventCount,
      replayValid:
        verifyThreadReplayBundle(replayBeforeEvaluation).status === "valid",
      credentialLeakDetected,
    });
    const evidenceRunId =
      workflowResult.nodeResults.find((result) => result.runId)?.runId ??
      runs[0]?.id;
    if (!evidenceRunId) {
      throw new Error("Workflow benchmark has no Run for evaluation evidence");
    }
    const evaluationEvent = await runtime.store.appendEvent({
      threadId: thread.id,
      runId: evidenceRunId,
      type: "benchmark.workflow.evaluated",
      category: "evaluation",
      visibility: "user",
      payload: evaluation as unknown as JsonValue,
    });
    const generatedAt = dependencies.now().toISOString();
    const finalReplay = await exportThreadReplayBundle(
      runtime.store,
      thread.id,
    );
    const terminalEvent = finalReplay.events.find(
      (event) =>
        event.type === "workflow.completed" &&
        event.payload &&
        !Array.isArray(event.payload) &&
        typeof event.payload === "object" &&
        event.payload["planId"] === workflowResult.planId,
    );
    if (!terminalEvent) {
      throw new Error("Workflow benchmark terminal event is unavailable");
    }
    const workflowEvidence: WorkflowBenchmarkResult["workflow"] = {
      manifestSha256: workflowResult.manifestSha256,
      blueprintSha256: workflowResult.blueprintSha256,
      resultSha256: workflowResult.resultSha256,
      ...(workflowResult.outputSha256
        ? { outputSha256: workflowResult.outputSha256 }
        : {}),
      nodeResultCount: workflowResult.nodeResults.length,
      completedNodeResultCount: workflowResult.nodeResults.filter(
        (node) => node.status === "completed",
      ).length,
    };
    const bundle = createWorkflowBenchmarkLedgerBundle({
      generatedAt,
      caseId: loaded.benchmarkCase.id,
      caseSha256: loaded.benchmarkCase.contentSha256,
      result: workflowEvidence,
      status: workflowResult.status,
      planId: workflowResult.planId,
      threadId: thread.id,
      ...(mapOutputSha256 ? { mapOutputSha256 } : {}),
      mapRunIds: mapRuns.map((run) => run.id),
      reduceRunId: reduceResult?.runId ?? evidenceRunId,
      runs,
      evaluationEvent,
      terminalEvent,
      events: finalReplay.events,
      sourceEventStreamSha256: finalReplay.eventStreamSha256,
      sourceReplaySha256: finalReplay.contentSha256,
    });
    const serializedBundle = `${JSON.stringify(bundle, null, 2)}\n`;
    const ledgerFileName = workflowBenchmarkLedgerFileName(
      loaded.benchmarkCase.id,
      bundle.contentSha256,
    );
    const outputDir = path.resolve(options.outputDir);
    const ledgerPath = path.join(outputDir, ledgerFileName);
    await writeBenchmarkCasFile(ledgerPath, serializedBundle);
    const result = createWorkflowBenchmarkResult({
      kind: "napier.workflow-benchmark-result",
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
      run: workflowRunEvidence(workflowResult, runs),
      workflow: workflowEvidence,
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
      workflowBenchmarkResultFileName(result.caseId, result.contentSha256),
    );
    await writeBenchmarkCasFile(
      resultPath,
      `${JSON.stringify(result, null, 2)}\n`,
    );
    const verification = verifyWorkflowBenchmarkArtifacts(result, bundle);
    if (!verification.valid) {
      throw new Error(
        `Workflow benchmark artifacts failed self-verification: ${verification.diagnostics.join(",")}`,
      );
    }
    return { result, bundle, resultPath, ledgerPath };
  } finally {
    await runtime?.shutdown().catch(() => undefined);
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

function workflowBenchmarkCredential(
  options: RunWorkflowBenchmarkOptions,
): { variable: string; value: string } | undefined {
  if (!options.credentialEnv) return undefined;
  if (!/^[A-Z_][A-Z0-9_]{1,127}$/u.test(options.credentialEnv)) {
    throw new Error("Workflow benchmark credential environment is invalid");
  }
  const value = options.env[options.credentialEnv]?.trim();
  if (!value) {
    throw new Error(
      "Workflow benchmark credential environment variable is unavailable",
    );
  }
  return { variable: options.credentialEnv, value };
}

function workflowRunEvidence(
  workflowResult: {
    threadId: string;
    planId: string;
    status: WorkflowBenchmarkResult["run"]["status"];
  },
  runs: RunRecord[],
): WorkflowBenchmarkResult["run"] {
  const starts = runs.map((run) => Date.parse(run.startedAt));
  const finishes = runs.flatMap((run) =>
    run.finishedAt ? [Date.parse(run.finishedAt)] : [],
  );
  return {
    threadId: workflowResult.threadId,
    planId: workflowResult.planId,
    status: workflowResult.status,
    durationMs:
      starts.length > 0 && finishes.length > 0
        ? Math.max(0, Math.max(...finishes) - Math.min(...starts))
        : 0,
    runCount: runs.length,
    completedRunCount: runs.filter((run) => run.status === "completed").length,
    usage: runs.map((run) => run.usage).reduce(addUsage, emptyUsage()),
  };
}

function addUsage(left: Usage, right: Usage): Usage {
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    cacheReadTokens: left.cacheReadTokens + right.cacheReadTokens,
    cacheWriteTokens: left.cacheWriteTokens + right.cacheWriteTokens,
    costUsd: left.costUsd + right.costUsd,
  };
}

function countEvents(events: RunEvent[], type: string): number {
  return events.filter((event) => event.type === type).length;
}
