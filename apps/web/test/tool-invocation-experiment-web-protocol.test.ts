import type {
  ToolInvocationExperimentComparison,
  ToolInvocationExperimentPreview,
  ToolInvocationExperimentResultFrame,
} from "@napier/contracts";
import {
  validateToolInvocationExperimentPreview,
  validateToolInvocationExperimentResultFrame,
} from "@napier/contracts";
import { describe, expect, it } from "vitest";

import { canonicalJson, sha256Text } from "../src/stable-digest";

describe("Tool invocation experiment Web protocol", () => {
  it("validates the complete preview, comparison, and result hash chain", async () => {
    const fixture = await experimentFixture();
    expect(validateToolInvocationExperimentPreview(fixture.preview)).toEqual(
      fixture.preview,
    );
    expect(validateToolInvocationExperimentResultFrame(fixture.frame)).toEqual(
      fixture.frame,
    );
  });

  it("rejects self-consistently rehashed delta and source drift", async () => {
    const fixture = await experimentFixture();
    const deltaDrift = structuredClone(fixture.frame);
    deltaDrift.experiment.comparison.durationMsDelta += 1;
    deltaDrift.experiment.comparison.contentSha256 = await comparisonHash(
      deltaDrift.experiment.comparison,
    );
    deltaDrift.contentSha256 = await frameHash(deltaDrift);
    expect(() =>
      validateToolInvocationExperimentResultFrame(deltaDrift),
    ).toThrow("comparison is invalid");

    const sourceDrift = structuredClone(fixture.frame);
    sourceDrift.experiment.comparison.source.outputBytes += 1;
    sourceDrift.experiment.comparison.contentSha256 = await comparisonHash(
      sourceDrift.experiment.comparison,
    );
    sourceDrift.contentSha256 = await frameHash(sourceDrift);
    expect(() =>
      validateToolInvocationExperimentResultFrame(sourceDrift),
    ).toThrow("result binding is invalid");
  });

  it("rejects argument/output-bearing preview fields", async () => {
    const fixture = await experimentFixture();
    expect(() =>
      validateToolInvocationExperimentPreview({
        ...fixture.preview,
        arguments: { path: "PRIVATE_PATH" },
      }),
    ).toThrow("fields are invalid");
    expect(() =>
      validateToolInvocationExperimentPreview({
        ...fixture.preview,
        candidateOutput: "PRIVATE_OUTPUT",
      }),
    ).toThrow("fields are invalid");
  });
});

async function experimentFixture(): Promise<{
  preview: ToolInvocationExperimentPreview;
  frame: ToolInvocationExperimentResultFrame;
}> {
  const candidateOutput = "candidate metadata only";
  const source = {
    threadId: "thread_source12345678",
    runId: "run_source_12345678",
    status: "completed" as const,
    toolName: "read_file",
    durationMs: 30,
    outputSha256: "1".repeat(64),
    outputBytes: 100,
  };
  const target = {
    threadId: "thread_target12345678",
    runId: "run_target_12345678",
    status: "completed" as const,
    toolName: "read_file",
    durationMs: 24,
    outputSha256: await sha256Text(candidateOutput),
    outputBytes: new TextEncoder().encode(candidateOutput).byteLength,
  };
  const comparisonContent = {
    kind: "napier.tool-invocation-experiment-comparison" as const,
    schemaVersion: 1 as const,
    source,
    target,
    durationMsDelta: target.durationMs - source.durationMs,
    outputChanged: true,
  };
  const comparison: ToolInvocationExperimentComparison = {
    ...comparisonContent,
    contentSha256: await sha256Text(canonicalJson(comparisonContent)),
  };
  const previewContent = {
    kind: "napier.tool-invocation-experiment-preview" as const,
    schemaVersion: 1 as const,
    sourceThreadId: source.threadId,
    sourceRunId: source.runId,
    sourceAgentId: "agent_napier",
    sourceAgentRevision: 3,
    sourceCallId: "call_source_12345678",
    sourceCapsuleEventSeq: 11,
    sourceStartedEventSeq: 10,
    sourceTerminalEventSeq: 12,
    sourceToolName: source.toolName,
    sourceEffect: "read" as const,
    sourceToolDefinitionSha256: "2".repeat(64),
    sourceArgumentsSha256: "3".repeat(64),
    sourceWorkspaceScopeSha256: "4".repeat(64),
    sourceCapsuleSha256: "5".repeat(64),
    sourceCapsuleBytes: 512,
    sourceDurationMs: source.durationMs,
    sourceOutputSha256: source.outputSha256,
    sourceOutputBytes: source.outputBytes,
    candidateWorkspaceSnapshotSha256: "6".repeat(64),
    candidateWorkspaceFileCount: 1,
    candidateWorkspaceBytes: 200,
    targetExecutionMode: "tool_experiment_read_only" as const,
  };
  const preview: ToolInvocationExperimentPreview = {
    ...previewContent,
    previewSha256: await sha256Text(canonicalJson(previewContent)),
  };
  const experiment = {
    kind: "napier.tool-invocation-experiment-result" as const,
    schemaVersion: 1 as const,
    preview,
    targetThreadId: target.threadId,
    targetRunId: target.runId,
    status: target.status,
    candidateOutput,
    comparison,
  };
  const frameContent = {
    type: "tool_invocation_experiment_result" as const,
    sourceThreadId: source.threadId,
    sourceRunId: source.runId,
    sourceCallId: preview.sourceCallId,
    targetThreadId: target.threadId,
    targetRunId: target.runId,
    status: target.status,
    previewSha256: preview.previewSha256,
    experiment,
    snapshotSha256: "7".repeat(64),
    snapshotBytes: 1_000,
    eventCount: 6,
    eventBytes: 2_000,
    eventStreamSha256: "8".repeat(64),
  };
  return {
    preview,
    frame: {
      ...frameContent,
      contentSha256: await sha256Text(canonicalJson(frameContent)),
    },
  };
}

async function comparisonHash(
  comparison: ToolInvocationExperimentComparison,
): Promise<string> {
  return hashWithout(
    comparison as unknown as Record<string, unknown>,
    "contentSha256",
  );
}

async function frameHash(
  frame: ToolInvocationExperimentResultFrame,
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
