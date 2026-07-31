import type { AgentMessageExperimentPreview } from "@napier/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  executeAgentMessageExperiment,
  previewAgentMessageExperiment,
} from "../src/agent-message-experiment-api";
import { canonicalJson, sha256Text } from "../src/stable-digest";

describe("Agent message experiment Web API", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("previews through the hash-bound no-store route", async () => {
    const preview = await previewFixture();
    const controller = new AbortController();
    const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
      expect(path).toBe(
        `/api/threads/${preview.sourceThreadId}/agent-experiments/preview`,
      );
      expect(init?.method).toBe("POST");
      expect(init?.signal).toBe(controller.signal);
      expect(JSON.parse(String(init?.body))).toEqual({
        sourceRunId: preview.sourceRunId,
        sourceMessageSeq: preview.sourceMessageSeq,
      });
      return jsonResponse(preview);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      previewAgentMessageExperiment(
        preview.sourceThreadId,
        {
          sourceRunId: preview.sourceRunId,
          sourceMessageSeq: preview.sourceMessageSeq,
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
      previewAgentMessageExperiment(preview.sourceThreadId, {
        sourceRunId: preview.sourceRunId,
        sourceMessageSeq: preview.sourceMessageSeq,
      }),
    ).rejects.toThrow("preview binding is invalid");
  });

  it("rejects stale execution before network mutation", async () => {
    const preview = await previewFixture();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      executeAgentMessageExperiment(
        preview.sourceThreadId,
        {
          sourceRunId: preview.sourceRunId,
          sourceMessageSeq: preview.sourceMessageSeq,
          expectedPreviewSha256: "f".repeat(64),
        },
        preview,
      ),
    ).rejects.toThrow("preview is stale");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

async function previewFixture(): Promise<AgentMessageExperimentPreview> {
  const content = {
    kind: "napier.agent-message-experiment-preview" as const,
    schemaVersion: 1 as const,
    sourceThreadId: "thread_source12345678",
    sourceRunId: "run_source_12345678",
    sourceMessageSeq: 8,
    branchFromSeq: 7,
    sourceAgentId: "agent_napier",
    sourceAgentRevision: 3,
    sourceRunConfigurationSha256: "1".repeat(64),
    sourcePromptVariableResolvedAt: "2026-08-01T01:00:00.000Z",
    sourcePromptSha256: "2".repeat(64),
    sourceHistorySha256: "3".repeat(64),
    sourceHistoryMessageCount: 2,
    sourceMemoryContextSha256: "4".repeat(64),
    sourceSkillCatalogSha256: "5".repeat(64),
    candidateWorkspaceSnapshotSha256: "6".repeat(64),
    candidateWorkspaceFileCount: 4,
    candidateWorkspaceBytes: 256,
    sourceModel: { provider: "deepseek", id: "deepseek-chat" },
    targetModel: { provider: "deepseek", id: "deepseek-chat" },
    targetExecutionMode: "agent_experiment_read_only" as const,
    targetToolNames: ["read_file"],
    sourceToolEffects: {
      toolCallCount: 1,
      readOnlyCount: 1,
      writeCount: 0,
      unknownCount: 0,
      unresolvedCount: 0,
      writeToolNames: [],
      unknownToolNames: [],
    },
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
      "X-Napier-Agent-Experiment-Preview-SHA256": preview.previewSha256,
      ...init.headers,
    },
  });
}
