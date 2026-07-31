import type {
  ModelInvocationExperimentComparison,
  ModelInvocationExperimentPreview,
  ModelInvocationExperimentResultFrame,
  ModelInvocationExperimentStatus,
  Usage,
} from "@napier/contracts";
import { describe, expect, it } from "vitest";

import {
  validateModelInvocationExperimentPreview,
  validateModelInvocationExperimentResultFrame,
} from "../src/model-invocation-experiment-web-protocol";
import { canonicalJson, sha256Text } from "../src/stable-digest";

describe("Model invocation experiment Web protocol", () => {
  it("validates the complete preview, comparison, and result hash chain", async () => {
    const fixture = await experimentFixture();

    await expect(
      validateModelInvocationExperimentPreview(fixture.preview),
    ).resolves.toEqual(fixture.preview);
    await expect(
      validateModelInvocationExperimentResultFrame(fixture.frame),
    ).resolves.toEqual(fixture.frame);
  });

  it("rejects self-consistently rehashed metric and source-binding drift", async () => {
    const fixture = await experimentFixture();
    const drifted = structuredClone(fixture.frame);
    drifted.experiment.comparison.metricDelta.durationMs += 1;
    drifted.experiment.comparison.contentSha256 = await comparisonHash(
      drifted.experiment.comparison,
    );
    drifted.contentSha256 = await frameHash(drifted);
    await expect(
      validateModelInvocationExperimentResultFrame(drifted),
    ).rejects.toThrow("comparison is invalid");

    const modelDrift = structuredClone(fixture.frame);
    modelDrift.experiment.comparison.source.model = {
      provider: "openai",
      id: "gpt-5",
    };
    modelDrift.experiment.comparison.contentSha256 = await comparisonHash(
      modelDrift.experiment.comparison,
    );
    modelDrift.contentSha256 = await frameHash(modelDrift);
    await expect(
      validateModelInvocationExperimentResultFrame(modelDrift),
    ).rejects.toThrow("result binding is invalid");
  });

  it("fails closed for prompt-bearing fields and status/stop drift", async () => {
    const fixture = await experimentFixture();
    await expect(
      validateModelInvocationExperimentPreview({
        ...fixture.preview,
        context: "PRIVATE_PROVIDER_CONTEXT",
      }),
    ).rejects.toThrow("fields are invalid");

    const statusDrift = structuredClone(fixture.frame);
    statusDrift.experiment.comparison.source.stopReason = "error";
    statusDrift.experiment.comparison.contentSha256 = await comparisonHash(
      statusDrift.experiment.comparison,
    );
    statusDrift.contentSha256 = await frameHash(statusDrift);
    await expect(
      validateModelInvocationExperimentResultFrame(statusDrift),
    ).rejects.toThrow("observation is invalid");
  });
});

async function experimentFixture(): Promise<{
  preview: ModelInvocationExperimentPreview;
  frame: ModelInvocationExperimentResultFrame;
}> {
  const sourceTextSha256 = await sha256Text("source answer");
  const sourceOutputSha256 = "1".repeat(64);
  const targetText = "candidate answer";
  const targetTextSha256 = await sha256Text(targetText);
  const targetOutputSha256 = "2".repeat(64);
  const source = {
    threadId: "thread_source12345678",
    runId: "run_source_12345678",
    status: "completed" as const,
    model: { provider: "deepseek", id: "deepseek-chat" },
    stopReason: "toolUse",
    durationMs: 30,
    usage: usage({ inputTokens: 20, outputTokens: 8, costUsd: 0.001 }),
    textSha256: sourceTextSha256,
    outputSha256: sourceOutputSha256,
    toolCallCount: 1,
    toolNames: ["read_file"],
  };
  const target = {
    threadId: "thread_target12345678",
    runId: "run_target_12345678",
    status: "completed" as const,
    model: { provider: "deepseek", id: "deepseek-chat" },
    stopReason: "stop",
    durationMs: 24,
    usage: usage({ inputTokens: 18, outputTokens: 7, costUsd: 0.0008 }),
    textSha256: targetTextSha256,
    outputSha256: targetOutputSha256,
    toolCallCount: 0,
    toolNames: [],
  };
  const comparisonContent = {
    kind: "napier.model-invocation-experiment-comparison" as const,
    schemaVersion: 1 as const,
    source,
    target,
    metricDelta: {
      durationMs: target.durationMs - source.durationMs,
      inputTokens: target.usage.inputTokens - source.usage.inputTokens,
      outputTokens: target.usage.outputTokens - source.usage.outputTokens,
      cacheReadTokens:
        target.usage.cacheReadTokens - source.usage.cacheReadTokens,
      cacheWriteTokens:
        target.usage.cacheWriteTokens - source.usage.cacheWriteTokens,
      costUsd: target.usage.costUsd - source.usage.costUsd,
      toolCallCount: target.toolCallCount - source.toolCallCount,
    },
    outputChanged: true,
    textChanged: true,
    addedToolNames: [],
    removedToolNames: ["read_file"],
  };
  const comparison: ModelInvocationExperimentComparison = {
    ...comparisonContent,
    contentSha256: await sha256Text(canonicalJson(comparisonContent)),
  };
  const previewContent = {
    kind: "napier.model-invocation-experiment-preview" as const,
    schemaVersion: 1 as const,
    sourceThreadId: source.threadId,
    sourceRunId: source.runId,
    sourceAgentId: "agent_napier",
    sourceAgentRevision: 3,
    sourceTurnIndex: 2,
    sourceCapsuleEventSeq: 10,
    sourceResponseEventSeq: 11,
    purpose: "agent_turn" as const,
    sourceModel: source.model,
    targetModel: target.model,
    sourceContextEnvelopeSha256: "3".repeat(64),
    sourceContextSha256: "4".repeat(64),
    sourceCapsuleSha256: "5".repeat(64),
    sourceCapsuleBytes: 4096,
    sourceMessageCount: 5,
    sourceToolCount: 2,
    sourceOutputSha256,
    sourceTextSha256,
    sourceStopReason: source.stopReason,
    targetExecutionMode: "model_experiment_single_call" as const,
  };
  const preview: ModelInvocationExperimentPreview = {
    ...previewContent,
    previewSha256: await sha256Text(canonicalJson(previewContent)),
  };
  const experiment = {
    kind: "napier.model-invocation-experiment-result" as const,
    schemaVersion: 1 as const,
    preview,
    targetThreadId: target.threadId,
    targetRunId: target.runId,
    status: target.status as ModelInvocationExperimentStatus,
    assistantText: targetText,
    candidateToolCallNames: [],
    comparison,
  };
  const frameContent = {
    type: "model_invocation_experiment_result" as const,
    sourceThreadId: source.threadId,
    sourceRunId: source.runId,
    sourceTurnIndex: preview.sourceTurnIndex,
    targetThreadId: target.threadId,
    targetRunId: target.runId,
    status: target.status as ModelInvocationExperimentStatus,
    previewSha256: preview.previewSha256,
    experiment,
    snapshotSha256: "6".repeat(64),
    snapshotBytes: 1_000,
    eventCount: 6,
    eventBytes: 2_000,
    eventStreamSha256: "7".repeat(64),
  };
  return {
    preview,
    frame: {
      ...frameContent,
      contentSha256: await sha256Text(canonicalJson(frameContent)),
    },
  };
}

function usage(overrides: Partial<Usage>): Usage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd: 0,
    ...overrides,
  };
}

async function comparisonHash(
  comparison: ModelInvocationExperimentComparison,
): Promise<string> {
  return hashWithout(
    comparison as unknown as Record<string, unknown>,
    "contentSha256",
  );
}

async function frameHash(
  frame: ModelInvocationExperimentResultFrame,
): Promise<string> {
  return hashWithout(
    frame as unknown as Record<string, unknown>,
    "contentSha256",
  );
}

async function hashWithout(
  input: Record<string, unknown>,
  key: string,
): Promise<string> {
  const content = { ...input };
  delete content[key];
  return sha256Text(canonicalJson(content));
}
