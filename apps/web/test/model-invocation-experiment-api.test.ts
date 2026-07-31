import type { ModelInvocationExperimentPreview } from "@napier/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  executeModelInvocationExperiment,
  previewModelInvocationExperiment,
} from "../src/model-invocation-experiment-api";
import { canonicalJson, sha256Text } from "../src/stable-digest";

describe("Model invocation experiment Web API", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("previews through the hash-bound no-store route", async () => {
    const preview = await previewFixture();
    const controller = new AbortController();
    const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
      expect(path).toBe(
        `/api/threads/${preview.sourceThreadId}/model-invocation-experiments/preview`,
      );
      expect(init?.method).toBe("POST");
      expect(init?.signal).toBe(controller.signal);
      expect(JSON.parse(String(init?.body))).toEqual({
        sourceRunId: preview.sourceRunId,
        sourceTurnIndex: preview.sourceTurnIndex,
      });
      return jsonResponse(preview);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      previewModelInvocationExperiment(
        preview.sourceThreadId,
        {
          sourceRunId: preview.sourceRunId,
          sourceTurnIndex: preview.sourceTurnIndex,
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
      previewModelInvocationExperiment(preview.sourceThreadId, {
        sourceRunId: preview.sourceRunId,
        sourceTurnIndex: preview.sourceTurnIndex,
      }),
    ).rejects.toThrow("preview binding is invalid");
  });

  it("rejects stale execution before network mutation", async () => {
    const preview = await previewFixture();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      executeModelInvocationExperiment(
        preview.sourceThreadId,
        {
          sourceRunId: preview.sourceRunId,
          sourceTurnIndex: preview.sourceTurnIndex,
          expectedPreviewSha256: "f".repeat(64),
        },
        preview,
      ),
    ).rejects.toThrow("preview is stale");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

async function previewFixture(): Promise<ModelInvocationExperimentPreview> {
  const content = {
    kind: "napier.model-invocation-experiment-preview" as const,
    schemaVersion: 1 as const,
    sourceThreadId: "thread_source12345678",
    sourceRunId: "run_source_12345678",
    sourceAgentId: "agent_napier",
    sourceAgentRevision: 3,
    sourceTurnIndex: 2,
    sourceCapsuleEventSeq: 10,
    sourceResponseEventSeq: 11,
    purpose: "agent_turn" as const,
    sourceModel: { provider: "deepseek", id: "deepseek-chat" },
    targetModel: { provider: "deepseek", id: "deepseek-chat" },
    sourceContextEnvelopeSha256: "1".repeat(64),
    sourceContextSha256: "2".repeat(64),
    sourceCapsuleSha256: "3".repeat(64),
    sourceCapsuleBytes: 4096,
    sourceMessageCount: 5,
    sourceToolCount: 2,
    sourceOutputSha256: "4".repeat(64),
    sourceTextSha256: "5".repeat(64),
    sourceStopReason: "stop",
    targetExecutionMode: "model_experiment_single_call" as const,
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
      "X-Napier-Model-Invocation-Experiment-Preview-SHA256":
        preview.previewSha256,
      ...init.headers,
    },
  });
}
