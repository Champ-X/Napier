import type { ToolInvocationExperimentPreview } from "@napier/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  executeToolInvocationExperiment,
  previewToolInvocationExperiment,
} from "../src/tool-invocation-experiment-api";
import { canonicalJson, sha256Text } from "../src/stable-digest";

describe("Tool invocation experiment Web API", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("previews through the hash-bound no-store route", async () => {
    const preview = await previewFixture();
    const controller = new AbortController();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string, init?: RequestInit) => {
        expect(path).toBe(
          `/api/threads/${preview.sourceThreadId}/tool-invocation-experiments/preview`,
        );
        expect(init?.method).toBe("POST");
        expect(init?.signal).toBe(controller.signal);
        expect(JSON.parse(String(init?.body))).toEqual({
          sourceRunId: preview.sourceRunId,
          sourceCallId: preview.sourceCallId,
        });
        return jsonResponse(preview);
      }),
    );

    await expect(
      previewToolInvocationExperiment(
        preview.sourceThreadId,
        {
          sourceRunId: preview.sourceRunId,
          sourceCallId: preview.sourceCallId,
        },
        controller.signal,
      ),
    ).resolves.toEqual(preview);
  });

  it("rejects a valid preview rebound to another source Thread", async () => {
    const preview = await previewFixture();
    const { previewSha256: _previewSha256, ...content } = preview;
    const driftedContent = {
      ...content,
      sourceThreadId: "thread_other12345678",
    };
    const drifted = {
      ...driftedContent,
      previewSha256: await sha256Text(canonicalJson(driftedContent)),
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(drifted)),
    );

    await expect(
      previewToolInvocationExperiment(preview.sourceThreadId, {
        sourceRunId: preview.sourceRunId,
        sourceCallId: preview.sourceCallId,
      }),
    ).rejects.toThrow("preview binding is invalid");
  });

  it("rejects stale execution before network mutation", async () => {
    const preview = await previewFixture();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      executeToolInvocationExperiment(
        preview.sourceThreadId,
        {
          sourceRunId: preview.sourceRunId,
          sourceCallId: preview.sourceCallId,
          expectedPreviewSha256: "f".repeat(64),
        },
        preview,
      ),
    ).rejects.toThrow("preview is stale");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

async function previewFixture(): Promise<ToolInvocationExperimentPreview> {
  const content = {
    kind: "napier.tool-invocation-experiment-preview" as const,
    schemaVersion: 1 as const,
    sourceThreadId: "thread_source12345678",
    sourceRunId: "run_source_12345678",
    sourceAgentId: "agent_napier",
    sourceAgentRevision: 3,
    sourceCallId: "call_source_12345678",
    sourceCapsuleEventSeq: 11,
    sourceStartedEventSeq: 10,
    sourceTerminalEventSeq: 12,
    sourceToolName: "read_file",
    sourceEffect: "read" as const,
    sourceToolDefinitionSha256: "1".repeat(64),
    sourceArgumentsSha256: "2".repeat(64),
    sourceWorkspaceScopeSha256: "3".repeat(64),
    sourceCapsuleSha256: "4".repeat(64),
    sourceCapsuleBytes: 512,
    sourceDurationMs: 10,
    sourceOutputSha256: "5".repeat(64),
    sourceOutputBytes: 100,
    candidateWorkspaceSnapshotSha256: "6".repeat(64),
    candidateWorkspaceFileCount: 1,
    candidateWorkspaceBytes: 200,
    targetExecutionMode: "tool_experiment_read_only" as const,
  };
  return {
    ...content,
    previewSha256: await sha256Text(canonicalJson(content)),
  };
}

function jsonResponse(value: unknown, init: ResponseInit = {}): Response {
  const preview = value as { previewSha256: string };
  return new Response(JSON.stringify(value), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Napier-Content-SHA256": preview.previewSha256,
      "X-Napier-Content-SHA256-Mode": "stable",
      "X-Napier-Tool-Invocation-Experiment-Preview-SHA256":
        preview.previewSha256,
      ...init.headers,
    },
  });
}
