import type {
  AgentMessageExperimentComparison,
  AgentMessageExperimentPreview,
  AgentMessageExperimentResultFrame,
  RunConfigurationField,
  RunMetricDelta,
  RunMetrics,
} from "@napier/contracts";
import { describe, expect, it } from "vitest";

import {
  validateAgentMessageExperimentPreview,
  validateAgentMessageExperimentResultFrame,
} from "../src/agent-message-experiment-web-protocol";
import { canonicalJson, sha256Text } from "../src/stable-digest";

const METRIC_KEYS: Array<keyof RunMetricDelta> = [
  "durationMs",
  "eventCount",
  "messageCount",
  "modelResponseCount",
  "modelContextEnvelopeCount",
  "embeddedModelContextEnvelopeCount",
  "modelContextBoundResponseCount",
  "modelContextUnboundResponseCount",
  "toolCallCount",
  "toolCompletedCount",
  "toolFailedCount",
  "toolBlockedCount",
  "subagentCount",
  "inputTokens",
  "outputTokens",
  "cacheReadTokens",
  "cacheWriteTokens",
  "costUsd",
];

describe("Agent message experiment Web protocol", () => {
  it("validates the complete preview, comparison, and result hash chain", async () => {
    const fixture = await experimentFixture();

    await expect(
      validateAgentMessageExperimentPreview(fixture.preview),
    ).resolves.toEqual(fixture.preview);
    await expect(
      validateAgentMessageExperimentResultFrame(fixture.frame),
    ).resolves.toEqual(fixture.frame);
  });

  it("rejects self-consistently rehashed metric and output tampering", async () => {
    const fixture = await experimentFixture();
    const drifted = structuredClone(fixture.frame);
    drifted.experiment.comparison.metricDelta.durationMs += 1;
    drifted.experiment.comparison.contentSha256 = await comparisonHash(
      drifted.experiment.comparison,
    );
    drifted.contentSha256 = await frameHash(drifted);
    await expect(
      validateAgentMessageExperimentResultFrame(drifted),
    ).rejects.toThrow("projection is invalid");

    const outputTampered = structuredClone(fixture.frame);
    outputTampered.experiment.assistantText = "FORGED_TARGET_BODY";
    outputTampered.contentSha256 = await frameHash(outputTampered);
    await expect(
      validateAgentMessageExperimentResultFrame(outputTampered),
    ).rejects.toThrow("output hash is invalid");

    const reuseTampered = structuredClone(fixture.frame);
    reuseTampered.experiment.toolResultReuse.reusedResultCount = 1;
    reuseTampered.contentSha256 = await frameHash(reuseTampered);
    await expect(
      validateAgentMessageExperimentResultFrame(reuseTampered),
    ).rejects.toThrow("tool result reuse is invalid");
  });

  it("fails closed for unknown prompt-bearing fields and nonterminal observations", async () => {
    const fixture = await experimentFixture();
    const leaked = {
      ...fixture.preview,
      prompt: "PRIVATE_SOURCE_PROMPT",
    };
    await expect(validateAgentMessageExperimentPreview(leaked)).rejects.toThrow(
      "fields are invalid",
    );

    const running = structuredClone(fixture.frame) as unknown as Record<
      string,
      unknown
    >;
    const experiment = running["experiment"] as Record<string, unknown>;
    const comparison = experiment["comparison"] as Record<string, unknown>;
    const source = comparison["source"] as Record<string, unknown>;
    source["status"] = "running";
    comparison["contentSha256"] = await hashWithout(
      comparison,
      "contentSha256",
    );
    running["contentSha256"] = await hashWithout(running, "contentSha256");
    await expect(
      validateAgentMessageExperimentResultFrame(running),
    ).rejects.toThrow("source is invalid");
  });
});

async function experimentFixture(): Promise<{
  preview: AgentMessageExperimentPreview;
  frame: AgentMessageExperimentResultFrame;
}> {
  const sourceTextSha256 = await sha256Text("source answer");
  const targetText = "candidate answer";
  const targetTextSha256 = await sha256Text(targetText);
  const sourceMetrics = metrics(sourceTextSha256, {
    durationMs: 30,
    eventCount: 12,
    messageCount: 2,
    modelResponseCount: 1,
    modelContextEnvelopeCount: 1,
    modelContextBoundResponseCount: 1,
    toolCallCount: 1,
    toolCompletedCount: 1,
    inputTokens: 20,
    outputTokens: 8,
    costUsd: 0.001,
  });
  const targetMetrics = metrics(targetTextSha256, {
    durationMs: 24,
    eventCount: 11,
    messageCount: 2,
    modelResponseCount: 1,
    modelContextEnvelopeCount: 1,
    modelContextBoundResponseCount: 1,
    inputTokens: 18,
    outputTokens: 7,
    costUsd: 0.0008,
  });
  const source = {
    threadId: "thread_source12345678",
    runId: "run_source_12345678",
    status: "completed" as const,
    configurationSha256: "1".repeat(64),
    model: { provider: "deepseek", id: "deepseek-chat" },
    executionMode: "standard" as const,
    metrics: sourceMetrics,
    toolNames: ["read_file"],
    toolEffects: {
      toolCallCount: 1,
      readOnlyCount: 1,
      writeCount: 0,
      unknownCount: 0,
      unresolvedCount: 0,
      writeToolNames: [],
      unknownToolNames: [],
    },
  };
  const target = {
    threadId: "thread_target12345678",
    runId: "run_target_12345678",
    status: "completed" as const,
    configurationSha256: "2".repeat(64),
    model: { provider: "deepseek", id: "deepseek-chat" },
    executionMode: "agent_experiment_read_only" as const,
    metrics: targetMetrics,
    toolNames: [],
    toolEffects: {
      toolCallCount: 0,
      readOnlyCount: 0,
      writeCount: 0,
      unknownCount: 0,
      unresolvedCount: 0,
      writeToolNames: [],
      unknownToolNames: [],
    },
  };
  const metricDelta = Object.fromEntries(
    METRIC_KEYS.map((key) => [key, targetMetrics[key] - sourceMetrics[key]]),
  ) as unknown as RunMetricDelta;
  const comparisonContent = {
    kind: "napier.agent-message-experiment-comparison" as const,
    schemaVersion: 1 as const,
    source,
    target,
    metricDelta,
    outputChanged: true,
    addedToolNames: [],
    removedToolNames: ["read_file"],
    configurationDelta: {
      status: "comparable" as const,
      leftSha256: source.configurationSha256,
      rightSha256: target.configurationSha256,
      changedFields: [
        "toolPolicy",
        "enabledTools",
        "executionMode",
      ] satisfies RunConfigurationField[],
      addedTools: [],
      removedTools: ["read_file"],
      addedSkills: [],
      removedSkills: [],
      addedSubagents: [],
      removedSubagents: [],
    },
  };
  const comparison: AgentMessageExperimentComparison = {
    ...comparisonContent,
    contentSha256: await sha256Text(canonicalJson(comparisonContent)),
  };
  const previewContent = {
    kind: "napier.agent-message-experiment-preview" as const,
    schemaVersion: 2 as const,
    sourceThreadId: source.threadId,
    sourceRunId: source.runId,
    sourceMessageSeq: 8,
    branchFromSeq: 7,
    sourceAgentId: "agent_napier",
    sourceAgentRevision: 3,
    sourceRunConfigurationSha256: source.configurationSha256,
    sourcePromptVariableResolvedAt: "2026-08-01T01:00:00.000Z",
    sourcePromptSha256: "3".repeat(64),
    sourceHistorySha256: "4".repeat(64),
    sourceHistoryMessageCount: 2,
    sourceMemoryContextSha256: "5".repeat(64),
    sourceSkillCatalogSha256: "6".repeat(64),
    candidateWorkspaceSnapshotSha256: "7".repeat(64),
    candidateWorkspaceFileCount: 4,
    candidateWorkspaceBytes: 256,
    sourceModel: source.model,
    targetModel: target.model,
    targetExecutionMode: "agent_experiment_read_only" as const,
    targetToolNames: [],
    sourceToolEffects: source.toolEffects,
    toolResultMode: "live" as const,
    sourceReusableToolResultCount: 0,
    sourceToolResultSetSha256: "a".repeat(64),
  };
  const preview: AgentMessageExperimentPreview = {
    ...previewContent,
    previewSha256: await sha256Text(canonicalJson(previewContent)),
  };
  const experiment = {
    kind: "napier.agent-message-experiment-result" as const,
    schemaVersion: 2 as const,
    preview,
    targetThreadId: target.threadId,
    targetRunId: target.runId,
    status: "completed" as const,
    assistantText: targetText,
    toolResultReuse: {
      mode: "live" as const,
      sourceResultCount: 0,
      reusedResultCount: 0,
      divergenceCount: 0,
      complete: true,
      sourceResultSetSha256: preview.sourceToolResultSetSha256,
      targetReuseSetSha256: "b".repeat(64),
    },
    comparison,
  };
  const frameContent = {
    type: "agent_message_experiment_result" as const,
    sourceThreadId: source.threadId,
    sourceRunId: source.runId,
    sourceMessageSeq: preview.sourceMessageSeq,
    targetThreadId: target.threadId,
    targetRunId: target.runId,
    status: "completed" as const,
    previewSha256: preview.previewSha256,
    experiment,
    snapshotSha256: "8".repeat(64),
    snapshotBytes: 1_000,
    eventCount: 12,
    eventBytes: 2_000,
    eventStreamSha256: "9".repeat(64),
  };
  return {
    preview,
    frame: {
      ...frameContent,
      contentSha256: await sha256Text(canonicalJson(frameContent)),
    },
  };
}

function metrics(
  assistantTextSha256: string,
  overrides: Partial<RunMetrics>,
): RunMetrics {
  return {
    durationMs: 0,
    eventCount: 0,
    messageCount: 0,
    modelResponseCount: 0,
    modelContextEnvelopeCount: 0,
    embeddedModelContextEnvelopeCount: 0,
    modelContextBoundResponseCount: 0,
    modelContextUnboundResponseCount: 0,
    toolCallCount: 0,
    toolCompletedCount: 0,
    toolFailedCount: 0,
    toolBlockedCount: 0,
    subagentCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd: 0,
    assistantTextSha256,
    ...overrides,
  };
}

async function comparisonHash(
  comparison: AgentMessageExperimentComparison,
): Promise<string> {
  return hashWithout(
    comparison as unknown as Record<string, unknown>,
    "contentSha256",
  );
}

async function frameHash(
  frame: AgentMessageExperimentResultFrame,
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
