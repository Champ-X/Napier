import { readFile } from "node:fs/promises";

import type {
  AgentProfile,
  BootstrapResponse,
  ModelRef,
  ThreadDetail,
  ThreadSummary,
} from "@napier/contracts";
import type { LiveReadyBootstrapResponse } from "@napier/contracts/default-run-model";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import { registerBootstrapHttp } from "../src/bootstrap-http.js";

describe("Bootstrap HTTP", () => {
  it("keeps the extracted no-store projection body-hash bound", async () => {
    const source = await readFile(
      new URL("../src/bootstrap-http.ts", import.meta.url),
      "utf8",
    );
    const start = source.indexOf("function setBootstrapProjectionHeaders");
    const body = source.slice(start, source.indexOf("\n}", start) + 2);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(body).toContain('context.header("Cache-Control", "no-store")');
    expect(body).toContain("setBodyContentSha256Header(context, response)");
  });

  it("projects the live-ready Run model without mutating the Agent", async () => {
    const agent = seedAgent();
    const thread = threadSummary();
    const detail = threadDetail(agent, thread);
    const recommendDefaultRunModel = vi.fn(
      async (): Promise<ModelRef> => ({
        provider: "deepseek",
        id: "deepseek-v4-flash",
      }),
    );
    const store = bootstrapStore(agent, thread, detail);
    const app = new Hono();
    registerBootstrapHttp(app, {
      store: store as never,
      models: {
        list: vi.fn(async () => [
          {
            provider: "napier",
            providerName: "Napier",
            id: "demo",
            name: "Deterministic demo",
            contextWindow: 32_000,
            reasoning: true,
            vision: false,
            configured: true,
          },
          {
            provider: "deepseek",
            providerName: "DeepSeek",
            id: "deepseek-v4-flash",
            name: "DeepSeek V4 Flash",
            contextWindow: 128_000,
            reasoning: true,
            vision: false,
            configured: true,
          },
        ]),
        recommendDefaultRunModel,
      } as never,
    });

    const response = await app.request(
      `/api/bootstrap?thread=${encodeURIComponent(thread.id)}`,
    );
    const bootstrap = (await response.json()) as LiveReadyBootstrapResponse;

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-napier-content-sha256-mode")).toBe("body");
    expect(bootstrap.recommendedRunModel).toEqual({
      provider: "deepseek",
      id: "deepseek-v4-flash",
    });
    expect(bootstrap.activeThread?.thread.id).toBe(thread.id);
    expect(recommendDefaultRunModel).toHaveBeenCalledWith(
      agent,
      expect.arrayContaining([
        expect.objectContaining({ providerId: "deepseek", status: "active" }),
      ]),
      [{ revision: 1, changedFields: [] }],
    );
    expect(agent.model).toEqual({ provider: "napier", id: "demo" });
  });
});

function bootstrapStore(
  agent: AgentProfile,
  thread: ThreadSummary,
  detail: ThreadDetail,
) {
  return {
    getWorkspaceSummary: vi.fn(() => ({
      root: "/workspace",
      dataRoot: "/state",
      createdAt: "2026-08-05T00:00:00.000Z",
    })),
    listAgents: vi.fn(() => [agent]),
    listThreads: vi.fn(() => [thread]),
    listMemories: vi.fn(() => []),
    listExtensions: vi.fn(() => []),
    listExtensionPublisherTrustAnchors: vi.fn(() => []),
    listExtensionPackageRolloutChannels: vi.fn(() => []),
    listSkillPackageInstallations: vi.fn(() => []),
    listCredentialReferences: vi.fn(() => [
      {
        id: "credential_deepseek_12345678",
        providerId: "deepseek",
        label: "DeepSeek",
        source: { type: "environment", variable: "DEEPSEEK_API_KEY" },
        status: "active",
        availability: "available",
        revision: 1,
        createdAt: "2026-08-05T00:00:00.000Z",
        updatedAt: "2026-08-05T00:00:00.000Z",
      },
    ]),
    listSchedules: vi.fn(() => []),
    listInboundChannels: vi.fn(() => []),
    listAgentRevisions: vi.fn(() => [{ revision: 1, changedFields: [] }]),
    getDetail: vi.fn(async () => detail),
  };
}

function seedAgent(): AgentProfile {
  return {
    id: "agent_napier",
    name: "Napier",
    description: "Test",
    systemPrompt: "Test prompt.",
    model: { provider: "napier", id: "demo" },
    thinkingLevel: "medium",
    toolPolicy: "observe",
    enabledTools: [],
    enabledSkills: [],
    enabledSubagents: [],
    subagentLimits: {
      maxConcurrent: 1,
      maxTotal: 1,
      maxTurns: 1,
      timeoutMs: 1_000,
    },
    runLimits: {
      maxTurns: 1,
      maxTotalTokens: 1_000,
      maxCostUsd: 1,
      timeoutMs: 1_000,
    },
    revision: 1,
    createdAt: "2026-08-05T00:00:00.000Z",
    updatedAt: "2026-08-05T00:00:00.000Z",
  };
}

function threadSummary(): ThreadSummary {
  return {
    id: "thread_bootstrap_live_ready",
    title: "Live ready",
    agentId: "agent_napier",
    status: "idle",
    createdAt: "2026-08-05T00:00:00.000Z",
    updatedAt: "2026-08-05T00:00:00.000Z",
    lastMessage: "",
    eventCount: 0,
  };
}

function threadDetail(
  agent: AgentProfile,
  summary: ThreadSummary,
): ThreadDetail {
  return {
    thread: { ...summary, runIds: [] },
    agent,
    runs: [],
    plans: [],
    evaluations: [],
    evaluationAdjudications: [],
    evaluationReviewerBallots: [],
    evaluationConsensusResolutions: [],
    evaluationSuites: [],
    evaluationSuiteExecutions: [],
    automaticRecoveryAssessments: [],
    automaticRecoveryAttempts: [],
    subagents: [],
    runControlMessages: [],
    operatorDecisions: [],
    contextCheckpointCalibration: {
      kind: "napier.context-checkpoint-calibration",
      schemaVersion: 1,
      threadId: summary.id,
      checkpointCount: 0,
      compactedEventCount: 0,
      originalTokenCount: 0,
      compactedTokenCount: 0,
      tokenSavings: 0,
      tokenSavingsBps: 0,
      compressionRatioBps: 0,
      costSavingsUsd: 0,
      latestCheckpointSeq: 0,
      latestCheckpointSha256: "0".repeat(64),
      contentSha256: "1".repeat(64),
    },
    events: [],
  } as ThreadDetail;
}
