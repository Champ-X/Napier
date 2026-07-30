import { createHash } from "node:crypto";

import type {
  ExecutionPlanWorkflowExperimentComparison,
  ExecutionPlanWorkflowExperimentResultFrame,
} from "@napier/contracts";
import { describe, expect, it } from "vitest";

import { canonicalJson } from "../src/stable-digest";
import {
  parseWorkflowManifestText,
  projectWorkflowExperimentComparison,
  workflowExperimentResultFilename,
} from "../src/workflow-experiment-view-model";

describe("Workflow experiment Workbench view model", () => {
  it("accepts a content-bound manifest and rejects drift", async () => {
    const manifest = workflowManifest();
    await expect(
      parseWorkflowManifestText(JSON.stringify(manifest)),
    ).resolves.toEqual(manifest);

    await expect(
      parseWorkflowManifestText(
        JSON.stringify({ ...manifest, name: "Drifted workflow" }),
      ),
    ).rejects.toThrow("content hash");
  });

  it("accepts Tool nodes and rejects unsafe binding paths", async () => {
    const manifest = workflowToolManifest();
    await expect(
      parseWorkflowManifestText(JSON.stringify(manifest)),
    ).resolves.toEqual(manifest);

    const unsafe = structuredClone(manifest);
    unsafe.nodes[0]!.inputBindings = {
      path: {
        source: "workflow",
        path: ["__proto__"],
      },
    };
    await expect(
      parseWorkflowManifestText(JSON.stringify(unsafe)),
    ).rejects.toThrow("path segment");
  });

  it("projects bounded comparison data without output bodies", () => {
    const comparison = workflowComparison();
    const view = projectWorkflowExperimentComparison(comparison);

    expect(view).toEqual(
      expect.objectContaining({
        sourceStatus: "completed",
        targetStatus: "completed",
        changedNodeCount: 1,
        tokenDelta: -5,
        toolCallDelta: -1,
        evaluationDelta: 1,
        artifactDelta: 0,
      }),
    );
    expect(view.nodes[0]).toEqual(
      expect.objectContaining({
        nodeId: "report",
        execution: "rerun",
        outputChange: "changed",
        targetModels: ["faux/fast"],
      }),
    );
    expect(JSON.stringify(view)).not.toContain("PRIVATE_SOURCE_OUTPUT");
    expect(JSON.stringify(view)).not.toContain("PRIVATE_TARGET_OUTPUT");
  });

  it("uses the shared CAS filename convention", () => {
    const frame = {
      targetPlanId: "plan_target_12345678",
      contentSha256: "a".repeat(64),
    } as ExecutionPlanWorkflowExperimentResultFrame;
    expect(workflowExperimentResultFilename(frame)).toBe(
      `napier-workflow-experiment-plan_target_12345678-${"a".repeat(16)}.json`,
    );
  });
});

function workflowManifest() {
  const content = {
    kind: "napier.execution-plan-workflow" as const,
    schemaVersion: 1 as const,
    apiVersion: "2026-07-25",
    name: "Workbench experiment",
    version: 1,
    description: "Exercise the visual Workflow experiment desk.",
    blueprint: {
      kind: "napier.execution-plan-blueprint" as const,
      schemaVersion: 1 as const,
      apiVersion: "2026-07-25",
      source: {
        type: "plan" as const,
        threadId: "thread_source_12345678",
        planId: "plan_blueprint_12345678",
        planRevision: 1,
        planArchiveSha256: "0".repeat(64),
        eventStreamSha256: "1".repeat(64),
      },
      title: "Workbench experiment",
      objective: "Produce a typed report.",
      steps: [
        {
          id: "report",
          title: "Report",
          description: "Produce the report.",
          verification: "Typed output is valid.",
          dependsOn: [],
        },
      ],
      stepCount: 1,
      artifactCount: 0,
      generatedAt: "2026-07-31T00:00:00.000Z",
      contentSha256: "2".repeat(64),
    },
    inputSchema: {
      type: "object" as const,
      properties: {
        request: { type: "string" as const, maxLength: 200 },
      },
      required: ["request"],
      additionalProperties: false as const,
    },
    outputSchema: {
      type: "object" as const,
      properties: {
        report: { type: "string" as const, maxLength: 200 },
      },
      required: ["report"],
      additionalProperties: false as const,
    },
    outputNodeId: "report",
    nodes: [
      {
        id: "report",
        type: "agent" as const,
        inputBindings: { workflow: { source: "workflow" as const } },
        inputSchema: {
          type: "object" as const,
          properties: {
            workflow: {
              type: "object" as const,
              properties: {
                request: { type: "string" as const, maxLength: 200 },
              },
              required: ["request"],
              additionalProperties: false as const,
            },
          },
          required: ["workflow"],
          additionalProperties: false as const,
        },
        outputSchema: {
          type: "object" as const,
          properties: {
            report: { type: "string" as const, maxLength: 200 },
          },
          required: ["report"],
          additionalProperties: false as const,
        },
        model: { provider: "faux", id: "source" },
        timeoutMs: 5_000,
        maxAttempts: 2,
      },
    ],
    nodeCount: 1,
  };
  return {
    ...content,
    generatedAt: "2026-07-31T00:00:00.000Z",
    contentSha256: sha256(canonicalJson(content)),
  };
}

function workflowToolManifest() {
  const base = workflowManifest();
  const { generatedAt, contentSha256: _contentSha256, ...baseContent } = base;
  const outputSchema = {
    type: "object" as const,
    properties: {
      count: { type: "integer" as const, minimum: 0 },
      truncated: { type: "boolean" as const },
      pathSha256: { type: "string" as const, minLength: 64, maxLength: 64 },
      entrySetSha256: {
        type: "string" as const,
        minLength: 64,
        maxLength: 64,
      },
    },
    required: ["count", "truncated", "pathSha256", "entrySetSha256"],
    additionalProperties: false as const,
  };
  const content = {
    ...baseContent,
    outputSchema,
    nodes: [
      {
        id: "report",
        type: "tool" as const,
        tool: "list_files" as const,
        effect: "read" as const,
        inputBindings: {
          path: {
            source: "workflow" as const,
            path: ["request"],
          },
        },
        inputSchema: {
          type: "object" as const,
          properties: {
            path: { type: "string" as const, minLength: 1, maxLength: 200 },
          },
          required: ["path"],
          additionalProperties: false as const,
        },
        outputSchema,
        timeoutMs: 5_000,
        maxAttempts: 2,
      },
    ],
  };
  return {
    ...content,
    generatedAt,
    contentSha256: sha256(canonicalJson(content)),
  };
}

function workflowComparison(): ExecutionPlanWorkflowExperimentComparison {
  const zeroMetrics = {
    runCount: 1,
    attemptCount: 1,
    durationMs: 100,
    modelResponseCount: 1,
    toolCallCount: 1,
    toolCompletedCount: 1,
    toolFailedCount: 0,
    toolBlockedCount: 0,
    inputTokens: 10,
    outputTokens: 5,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd: 0.01,
  };
  const content = {
    kind: "napier.execution-plan-workflow-experiment-comparison" as const,
    schemaVersion: 1 as const,
    sourceThreadId: "thread_source_12345678",
    sourcePlanId: "plan_source_12345678",
    targetThreadId: "thread_target_12345678",
    targetPlanId: "plan_target_12345678",
    sourceStatus: "completed" as const,
    targetStatus: "completed" as const,
    sourceInputSha256: "1".repeat(64),
    targetInputSha256: "1".repeat(64),
    inputChange: "unchanged" as const,
    sourceOutputSha256: sha256("PRIVATE_SOURCE_OUTPUT"),
    targetOutputSha256: sha256("PRIVATE_TARGET_OUTPUT"),
    outputChange: "changed" as const,
    reusedNodeCount: 0,
    rerunNodeCount: 1,
    sourceMetrics: zeroMetrics,
    targetMetrics: {
      ...zeroMetrics,
      durationMs: 80,
      toolCallCount: 0,
      toolCompletedCount: 0,
      inputTokens: 7,
      outputTokens: 3,
      costUsd: 0.008,
    },
    metricDelta: {
      runCount: 0,
      attemptCount: 0,
      durationMs: -20,
      modelResponseCount: 0,
      toolCallCount: -1,
      toolCompletedCount: -1,
      toolFailedCount: 0,
      toolBlockedCount: 0,
      inputTokens: -3,
      outputTokens: -2,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: -0.002,
    },
    sourceEvaluations: {
      total: 0,
      leftBetter: 0,
      rightBetter: 0,
      tie: 0,
      inconclusive: 0,
    },
    targetEvaluations: {
      total: 1,
      leftBetter: 0,
      rightBetter: 1,
      tie: 0,
      inconclusive: 0,
    },
    sourceArtifacts: {
      total: 1,
      produced: 0,
      verified: 1,
      missing: 0,
      setSha256: "2".repeat(64),
    },
    targetArtifacts: {
      total: 1,
      produced: 0,
      verified: 1,
      missing: 0,
      setSha256: "3".repeat(64),
    },
    changedNodeIds: ["report"],
    nodes: [
      {
        nodeId: "report",
        execution: "rerun" as const,
        source: {
          status: "completed" as const,
          runIds: ["run_source_12345678"],
          runSources: ["workflow" as const],
          models: [{ provider: "faux", id: "source" }],
          configurationSha256s: ["4".repeat(64)],
          toolNames: ["read_file"],
          inputSha256: "1".repeat(64),
          outputSha256: sha256("PRIVATE_SOURCE_OUTPUT"),
          metrics: zeroMetrics,
          evaluations: {
            total: 0,
            leftBetter: 0,
            rightBetter: 0,
            tie: 0,
            inconclusive: 0,
          },
        },
        target: {
          status: "completed" as const,
          runIds: ["run_target_12345678"],
          runSources: ["workflow" as const],
          models: [{ provider: "faux", id: "fast" }],
          configurationSha256s: ["5".repeat(64)],
          toolNames: [],
          inputSha256: "1".repeat(64),
          outputSha256: sha256("PRIVATE_TARGET_OUTPUT"),
          metrics: {
            ...zeroMetrics,
            durationMs: 80,
            toolCallCount: 0,
            toolCompletedCount: 0,
            inputTokens: 7,
            outputTokens: 3,
            costUsd: 0.008,
          },
          evaluations: {
            total: 1,
            leftBetter: 0,
            rightBetter: 1,
            tie: 0,
            inconclusive: 0,
          },
        },
        statusChanged: false,
        modelChanged: true,
        configurationChanged: true,
        inputChange: "unchanged" as const,
        outputChange: "changed" as const,
        metricDelta: {
          runCount: 0,
          attemptCount: 0,
          durationMs: -20,
          modelResponseCount: 0,
          toolCallCount: -1,
          toolCompletedCount: -1,
          toolFailedCount: 0,
          toolBlockedCount: 0,
          inputTokens: -3,
          outputTokens: -2,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          costUsd: -0.002,
        },
        addedToolNames: [],
        removedToolNames: ["read_file"],
      },
    ],
  };
  return {
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
