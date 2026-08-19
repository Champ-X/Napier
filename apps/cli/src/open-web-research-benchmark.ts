import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { ModelRef, RunEvent } from "@napier/contracts";
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
import { loadOpenWebResearchBenchmarkCase } from "./open-web-research-benchmark-case.js";
import {
  createOpenWebResearchBenchmarkResult,
  evaluateOpenWebResearch,
} from "./open-web-research-benchmark-contract.js";
import type {
  OpenWebResearchBenchmarkArtifacts,
  OpenWebResearchBenchmarkResult,
} from "./open-web-research-benchmark-types.js";
import { verifyOpenWebResearchBenchmarkAgainstCase } from "./open-web-research-benchmark-verifier.js";

export interface RunOpenWebResearchBenchmarkOptions {
  caseRoot: string;
  outputDir: string;
  model: ModelRef;
  env: Readonly<Record<string, string | undefined>>;
  credentialEnv?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface OpenWebResearchBenchmarkDependencies {
  createRuntime(
    options: LocalAgentRuntimeOptions,
  ): Promise<LocalAgentRuntimeServices>;
  now(): Date;
}

const DEFAULT_DEPENDENCIES: OpenWebResearchBenchmarkDependencies = {
  createRuntime: createLocalAgentRuntime,
  now: () => new Date(),
};
const EMPTY_SHA256 = sha256("");
const OMITTED_RECEIPT_TYPES = new Set([
  "model.text.delta",
  "model.thinking.delta",
]);

export async function runOpenWebResearchBenchmark(
  options: RunOpenWebResearchBenchmarkOptions,
  dependencies: OpenWebResearchBenchmarkDependencies = DEFAULT_DEPENDENCIES,
): Promise<OpenWebResearchBenchmarkArtifacts> {
  const loaded = await loadOpenWebResearchBenchmarkCase(options.caseRoot);
  const timeoutMs = options.timeoutMs ?? loaded.benchmarkCase.timeoutMs;
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 10_000 ||
    timeoutMs > loaded.benchmarkCase.timeoutMs
  ) {
    throw new Error(
      `Open-web Research benchmark timeout must be 10000-${loaded.benchmarkCase.timeoutMs}`,
    );
  }
  const credential = benchmarkCredential(options);
  const temporaryRoot = await mkdtemp(
    path.join(tmpdir(), "napier-open-web-research-"),
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
    await configureCredential(runtime, options.model, credential);
    if (!(await runtime.models.isConfigured(options.model))) {
      throw new Error("Open-web Research benchmark model is not configured");
    }
    const agent = runtime.store.listAgents()[0]!;
    if (
      !["web_search", "web_fetch", "browser", "research_source"].every((tool) =>
        agent.enabledTools.includes(tool),
      )
    ) {
      throw new Error("Default Agent open-web capabilities are unavailable");
    }
    const thread = await runtime.store.createThread({
      title: loaded.benchmarkCase.title,
      agentId: agent.id,
    });
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const signal = options.signal
      ? AbortSignal.any([options.signal, timeoutSignal])
      : timeoutSignal;
    const run = await runtime.kernel.runPrompt({
      threadId: thread.id,
      text: loaded.prompt,
      model: options.model,
      signal,
    });
    const events = await runtime.store.listEvents(thread.id);
    const replay = await exportThreadReplayBundle(runtime.store, thread.id);
    const assistantText = latestAssistantText(events, run.id);
    const credentialLeakDetected =
      credential !== undefined &&
      JSON.stringify({ run, events, replay }).includes(credential.value);
    const evaluation = evaluateOpenWebResearch({
      caseId: loaded.benchmarkCase.id,
      caseSha256: loaded.benchmarkCase.contentSha256,
      runStatus: run.status,
      events,
      replayValid: verifyThreadReplayBundle(replay).status === "valid",
      ...(assistantText ? { assistantText } : {}),
      expected: loaded.expected,
      credentialLeakDetected,
    });
    const evaluationEvent = await runtime.store.appendEvent({
      threadId: thread.id,
      runId: run.id,
      type: "benchmark.open_web_research.evaluated",
      category: "evaluation",
      visibility: "user",
      payload: {
        kind: "napier.open-web-research-benchmark-evaluation",
        schemaVersion: 1,
        caseId: evaluation.caseId,
        caseSha256: evaluation.caseSha256,
        status: evaluation.status,
        diagnostics: evaluation.diagnostics,
        expectedClaimsSha256: evaluation.expectedClaimsSha256,
        actualClaimsSha256: evaluation.actualClaimsSha256 ?? null,
        actualToolSequenceSha256: evaluation.actualToolSequenceSha256,
        actualSourceEvidenceSha256: evaluation.actualSourceEvidenceSha256,
        actualCitationEvidenceSha256: evaluation.actualCitationEvidenceSha256,
        ...(evaluation.security
          ? {
              actualAttemptedToolSequenceSha256:
                evaluation.security.actualAttemptedToolSequenceSha256,
              expectedForbiddenOutputSetSha256:
                evaluation.security.expectedForbiddenOutputSetSha256,
              expectedForbiddenToolActionSetSha256:
                evaluation.security.expectedForbiddenToolActionSetSha256,
            }
          : {}),
        sourceReplaySha256: replay.contentSha256,
      },
    });
    const finalReplay = await exportThreadReplayBundle(
      runtime.store,
      thread.id,
    );
    const retainedEvents = finalReplay.events.filter(
      (event) => !OMITTED_RECEIPT_TYPES.has(event.type),
    );
    const eventReceipts = createEventReceipts(retainedEvents);
    const result = createOpenWebResearchBenchmarkResult({
      kind: "napier.open-web-research-benchmark-result",
      schemaVersion: loaded.benchmarkCase.schemaVersion,
      generatedAt: dependencies.now().toISOString(),
      model: structuredClone(options.model),
      environment: {
        nodeVersion: process.versions.node,
        platform: process.platform,
        arch: process.arch,
        cliVersion: CLI_VERSION,
      },
      run: runEvidence(thread.id, run),
      ...evaluation,
      sourceEventStreamSha256: finalReplay.eventStreamSha256,
      sourceReplaySha256: finalReplay.contentSha256,
      sourceEventReceiptSetSha256: sha256(canonicalJson(eventReceipts)),
      retainedEventCount: retainedEvents.length,
      evidence: {
        ...evaluation.evidence,
        eventReceipts,
      },
    });
    const verification = verifyOpenWebResearchBenchmarkAgainstCase(
      result,
      loaded.benchmarkCase,
      loaded.expected,
    );
    if (!verification.valid) {
      throw new Error(
        `Open-web Research benchmark result failed verification: ${verification.diagnostics.join(",")}`,
      );
    }
    if (
      evaluationEvent.payload &&
      !Array.isArray(evaluationEvent.payload) &&
      typeof evaluationEvent.payload === "object" &&
      evaluationEvent.payload["sourceReplaySha256"] !== replay.contentSha256
    ) {
      throw new Error("Open-web Research evaluation replay binding failed");
    }
    const resultPath = path.join(
      path.resolve(options.outputDir),
      openWebResearchResultFileName(result.caseId, result.contentSha256),
    );
    await writeBenchmarkCasFile(
      resultPath,
      `${JSON.stringify(result, null, 2)}\n`,
    );
    return { result, resultPath };
  } finally {
    await runtime?.shutdown().catch(() => undefined);
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

export function openWebResearchResultFileName(
  caseId: string,
  contentSha256: string,
): string {
  return `napier-open-web-research-benchmark-result-${caseId}-${contentSha256.slice(0, 16)}.json`;
}

function createEventReceipts(events: RunEvent[]) {
  let previousReceiptSha256 = EMPTY_SHA256;
  return events.map((event) => {
    const content = {
      seq: event.seq,
      type: event.type,
      payloadSha256: sha256(canonicalJson(event.payload)),
      previousReceiptSha256,
    };
    const receipt = {
      ...content,
      receiptSha256: sha256(canonicalJson(content)),
    };
    previousReceiptSha256 = receipt.receiptSha256;
    return receipt;
  });
}

function latestAssistantText(events: RunEvent[], runId: string): string {
  return (
    events
      .filter(
        (event) => event.runId === runId && event.type === "message.assistant",
      )
      .flatMap((event) => {
        const payload = record(event.payload);
        return typeof payload?.["text"] === "string" ? [payload["text"]] : [];
      })
      .at(-1) ?? ""
  );
}

function benchmarkCredential(
  options: RunOpenWebResearchBenchmarkOptions,
): { variable: string; value: string } | undefined {
  if (!options.credentialEnv) return undefined;
  if (!/^[A-Z_][A-Z0-9_]{1,127}$/u.test(options.credentialEnv)) {
    throw new Error("Open-web Research credential environment is invalid");
  }
  const value = options.env[options.credentialEnv]?.trim();
  if (!value) {
    throw new Error("Open-web Research credential environment is unavailable");
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
    label: "Open-web Research benchmark credential",
    source: { type: "environment", variable: credential.variable },
  });
}

function runEvidence(
  threadId: string,
  run: {
    id: string;
    status: OpenWebResearchBenchmarkResult["run"]["status"];
    startedAt: string;
    finishedAt?: string;
    usage: OpenWebResearchBenchmarkResult["run"]["usage"];
  },
): OpenWebResearchBenchmarkResult["run"] {
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

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
