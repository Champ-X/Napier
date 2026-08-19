import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type {
  GoalState,
  JsonValue,
  ModelRef,
  RunEvent,
} from "@napier/contracts";
import {
  canonicalJson,
  createGoal,
  createLocalAgentRuntime,
  exportThreadReplayBundle,
  sha256,
  verifyThreadReplayBundle,
  type LocalAgentRuntimeOptions,
  type LocalAgentRuntimeServices,
} from "@napier/runtime";

import { writeBenchmarkCasFile } from "./benchmark-artifact-file.js";
import { CLI_VERSION } from "./cli-options.js";
import { loadGoalNoProgressBenchmarkCase } from "./goal-no-progress-benchmark-case.js";
import { verifyGoalNoProgressBenchmarkArtifacts } from "./goal-no-progress-benchmark-contract.js";
import {
  appendGoalModelObservation,
  createGoalNoProgressLedger,
  createGoalNoProgressResult,
  goalNoProgressLedgerFileName,
  goalNoProgressResultFileName,
  recordValue,
} from "./goal-no-progress-benchmark-evidence.js";
import type {
  GoalNoProgressBenchmarkArtifacts,
  GoalNoProgressBenchmarkEvaluation,
} from "./goal-no-progress-benchmark-types.js";

export interface RunGoalNoProgressBenchmarkOptions {
  caseRoot: string;
  outputDir: string;
  model: ModelRef;
  env: Readonly<Record<string, string | undefined>>;
  credentialEnv?: string;
  signal?: AbortSignal;
}

export interface GoalNoProgressBenchmarkDependencies {
  createRuntime(
    options: LocalAgentRuntimeOptions,
  ): Promise<LocalAgentRuntimeServices>;
  now(): Date;
}

const DEFAULT_DEPENDENCIES: GoalNoProgressBenchmarkDependencies = {
  createRuntime: createLocalAgentRuntime,
  now: () => new Date(),
};

export async function runGoalNoProgressBenchmark(
  options: RunGoalNoProgressBenchmarkOptions,
  dependencies: GoalNoProgressBenchmarkDependencies = DEFAULT_DEPENDENCIES,
): Promise<GoalNoProgressBenchmarkArtifacts> {
  const benchmarkCase = await loadGoalNoProgressBenchmarkCase(options.caseRoot);
  const credential = benchmarkCredential(options);
  const temporaryRoot = await mkdtemp(
    path.join(tmpdir(), "napier-goal-no-progress-"),
  );
  const workspaceRoot = path.join(temporaryRoot, "workspace");
  const dataRoot = path.join(temporaryRoot, "state");
  await mkdir(workspaceRoot);
  const runtimeOptions = { workspaceRoot, dataRoot, env: options.env };
  let runtime: LocalAgentRuntimeServices | undefined;
  try {
    runtime = await dependencies.createRuntime(runtimeOptions);
    await configureCredential(runtime, options.model, credential);
    if (!(await runtime.models.isConfigured(options.model))) {
      throw new Error("Goal no-progress benchmark model is not configured");
    }
    const sourceAgent = runtime.store.listAgents()[0]!;
    const agent = await runtime.store.updateAgent(sourceAgent.id, {
      systemPrompt: benchmarkCase.systemPrompt,
      enabledTools: [],
      runLimits: {
        maxTurns: 8,
        maxTotalTokens: 250_000,
        maxCostUsd: 10,
        timeoutMs: benchmarkCase.timeoutMs,
      },
    });
    const thread = await runtime.store.createThread({
      title: benchmarkCase.title,
      agentId: agent.id,
    });
    await runtime.store.setGoal(thread.id, createGoal(benchmarkCase.objective));
    const timeoutSignal = AbortSignal.timeout(benchmarkCase.timeoutMs);
    const signal = options.signal
      ? AbortSignal.any([options.signal, timeoutSignal])
      : timeoutSignal;
    const run = await runtime.kernel.runPrompt({
      threadId: thread.id,
      text: benchmarkCase.prompt,
      model: options.model,
      signal,
    });
    const runId = run.id;
    await runtime.shutdown();
    runtime = undefined;
    runtime = await dependencies.createRuntime(runtimeOptions);
    const recoveredGoal = runtime.store.getThread(thread.id).goal;
    const events = await runtime.store.listEvents(thread.id);
    const replay = await exportThreadReplayBundle(runtime.store, thread.id);
    const modelObservationEvent = await appendGoalModelObservation({
      store: runtime.store,
      threadId: thread.id,
      runId,
      events,
      sourceReplaySha256: replay.contentSha256,
    });
    const evaluation = createEvaluation({
      benchmarkCase,
      runStatus: run.status,
      runId,
      recoveredGoal,
      events,
      modelObservationEvent,
      replayValid: verifyThreadReplayBundle(replay).status === "valid",
      credentialLeakDetected:
        credential !== undefined &&
        JSON.stringify({ run, recoveredGoal, events, replay }).includes(
          credential.value,
        ),
    });
    const evaluationEvent = await runtime.store.appendEvent({
      threadId: thread.id,
      runId,
      type: "benchmark.goal.no-progress.evaluated",
      category: "evaluation",
      visibility: "user",
      payload: evaluation as unknown as JsonValue,
    });
    const finalReplay = await exportThreadReplayBundle(
      runtime.store,
      thread.id,
    );
    const terminalEvent = finalReplay.events.find(
      (event) =>
        event.runId === runId &&
        (event.type === "run.completed" ||
          event.type === "run.failed" ||
          event.type === "run.cancelled"),
    );
    if (!terminalEvent || !recoveredGoal) {
      throw new Error("Goal no-progress terminal evidence is unavailable");
    }
    const generatedAt = dependencies.now().toISOString();
    const bundle = createGoalNoProgressLedger({
      generatedAt,
      caseId: benchmarkCase.id,
      caseSha256: benchmarkCase.contentSha256,
      threadId: thread.id,
      runId,
      goal: recoveredGoal,
      events: finalReplay.events,
      replaySha256: finalReplay.contentSha256,
      modelObservationEvent,
      evaluationEvent,
      terminalEvent,
    });
    const outputDir = path.resolve(options.outputDir);
    const ledgerFileName = goalNoProgressLedgerFileName(
      benchmarkCase.id,
      bundle.contentSha256,
    );
    const ledgerPath = path.join(outputDir, ledgerFileName);
    const serializedBundle = `${JSON.stringify(bundle, null, 2)}\n`;
    await writeBenchmarkCasFile(ledgerPath, serializedBundle);
    const durationMs =
      run.finishedAt === undefined
        ? 0
        : Math.max(0, Date.parse(run.finishedAt) - Date.parse(run.startedAt));
    const result = createGoalNoProgressResult({
      kind: "napier.goal-no-progress-benchmark-result",
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
      run: {
        threadId: thread.id,
        runId,
        status: run.status,
        durationMs,
        usage: structuredClone(run.usage),
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
      goalNoProgressResultFileName(result.caseId, result.contentSha256),
    );
    await writeBenchmarkCasFile(
      resultPath,
      `${JSON.stringify(result, null, 2)}\n`,
    );
    const verification = verifyGoalNoProgressBenchmarkArtifacts(result, bundle);
    if (!verification.valid) {
      throw new Error(
        `Goal no-progress artifacts failed self-verification: ${verification.diagnostics.join(",")}`,
      );
    }
    return { result, bundle, resultPath, ledgerPath };
  } finally {
    await runtime?.shutdown().catch(() => undefined);
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

function createEvaluation(input: {
  benchmarkCase: Awaited<ReturnType<typeof loadGoalNoProgressBenchmarkCase>>;
  runStatus: string;
  runId: string;
  recoveredGoal: GoalState | undefined;
  events: RunEvent[];
  modelObservationEvent: RunEvent;
  replayValid: boolean;
  credentialLeakDetected: boolean;
}): GoalNoProgressBenchmarkEvaluation {
  const goalEvaluations = input.events.filter(
    (event) => event.type === "goal.evaluated",
  );
  const continuations = input.events.filter(
    (event) => event.type === "goal.continuation.started",
  );
  const assistantEvents = input.events.filter(
    (event) =>
      event.runId === input.runId && event.type === "message.assistant",
  );
  const expectedTextSha256 = sha256(input.benchmarkCase.expectedAssistantText);
  const repeatedResponseCount = assistantEvents.filter(
    (event) =>
      recordValue(event.payload)["text"] ===
      input.benchmarkCase.expectedAssistantText,
  ).length;
  const finalEvaluationSeq = goalEvaluations.at(-1)?.seq ?? 0;
  const modelPayload = recordValue(input.modelObservationEvent.payload);
  const diagnostics: string[] = [];
  if (input.runStatus !== "completed") diagnostics.push("run_not_completed");
  if (input.recoveredGoal?.status !== "blocked")
    diagnostics.push("goal_not_blocked");
  if (input.recoveredGoal?.blocker !== "goal_not_met_yet")
    diagnostics.push("goal_blocker_mismatch");
  if (
    input.recoveredGoal?.continuationCount !==
    input.benchmarkCase.expectedContinuationCount
  )
    diagnostics.push("continuation_count_mismatch");
  if (
    input.recoveredGoal?.noProgressCount !==
    input.benchmarkCase.expectedNoProgressCount
  )
    diagnostics.push("no_progress_count_mismatch");
  if (goalEvaluations.length !== input.benchmarkCase.expectedEvaluationCount)
    diagnostics.push("evaluation_count_mismatch");
  if (continuations.length !== input.benchmarkCase.expectedContinuationCount)
    diagnostics.push("continuation_event_mismatch");
  if (
    assistantEvents.length !==
      input.benchmarkCase.expectedPrimaryResponseCount ||
    repeatedResponseCount !== input.benchmarkCase.expectedPrimaryResponseCount
  )
    diagnostics.push("repeated_response_mismatch");
  const postBlockContinuationCount = continuations.filter(
    (event) => event.seq > finalEvaluationSeq,
  ).length;
  if (postBlockContinuationCount !== 0)
    diagnostics.push("post_block_continuation");
  if (!input.replayValid) diagnostics.push("replay_invalid");
  if (input.credentialLeakDetected) diagnostics.push("credential_leaked");
  const modelResponseErrorCount = Number(
    modelPayload["modelResponseErrorCount"],
  );
  const status =
    modelResponseErrorCount > 0
      ? ("inconclusive" as const)
      : diagnostics.length === 0
        ? ("passed" as const)
        : ("failed" as const);
  const content = {
    kind: "napier.goal-no-progress-benchmark-evaluation" as const,
    schemaVersion: 1 as const,
    caseId: input.benchmarkCase.id,
    caseSha256: input.benchmarkCase.contentSha256,
    status,
    runStatus: input.runStatus,
    goalStatus: input.recoveredGoal?.status ?? "missing",
    goalBlocker: input.recoveredGoal?.blocker ?? "missing",
    continuationCount: input.recoveredGoal?.continuationCount ?? 0,
    noProgressCount: input.recoveredGoal?.noProgressCount ?? 0,
    maxNoProgressContinuations:
      input.recoveredGoal?.maxNoProgressContinuations ?? 0,
    goalEvaluationCount: goalEvaluations.length,
    continuationStartedCount: continuations.length,
    primaryResponseCount: assistantEvents.length,
    repeatedResponseCount,
    modelResponseCount: Number(modelPayload["modelResponseCount"]),
    modelResponseErrorCount,
    modelResponseUsageSampleCount: Number(
      modelPayload["modelResponseUsageSampleCount"],
    ),
    postBlockContinuationCount,
    goalRecovered:
      input.recoveredGoal?.lastEvaluatedRunId === input.runId &&
      input.recoveredGoal.lastEvidenceHash === expectedTextSha256,
    replayValid: input.replayValid,
    credentialLeakDetected: input.credentialLeakDetected,
    diagnostics,
  };
  return { ...content, contentSha256: sha256(canonicalJson(content)) };
}

function benchmarkCredential(
  options: RunGoalNoProgressBenchmarkOptions,
): { variable: string; value: string } | undefined {
  if (!options.credentialEnv) return undefined;
  if (!/^[A-Z_][A-Z0-9_]{1,127}$/u.test(options.credentialEnv)) {
    throw new Error(
      "Goal no-progress benchmark credential environment is invalid",
    );
  }
  const value = options.env[options.credentialEnv]?.trim();
  if (!value) {
    throw new Error(
      "Goal no-progress benchmark credential environment is unavailable",
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
    label: "Goal no-progress benchmark credential",
    source: { type: "environment", variable: credential.variable },
  });
}
