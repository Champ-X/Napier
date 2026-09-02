import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

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

  it("uses the Kernel Thread projection without changing the bootstrap contract", async () => {
    const agent = seedAgent();
    const legacyThread = threadSummary();
    const projectedThread = {
      ...legacyThread,
      id: "thread_projected_bootstrap",
      title: "Projected bootstrap",
      updatedAt: "2026-08-16T00:00:00.000Z",
    };
    const projectedDetail = threadDetail(agent, projectedThread);
    const store = bootstrapStore(agent, legacyThread, projectedDetail);
    const listVisible = vi.fn(async () => [projectedThread]);
    const project = vi.fn(async () => ({
      view: {
        phase: "completed" as const,
        phaseLabel: "Settled",
        currentAction: "Projected by Kernel",
        completedItems: [],
      },
    }));
    const projectActivePlan = vi.fn(async () => ({ view: undefined }));
    const projectMessages = vi.fn(async () => ({
      view: [
        {
          id: "event_projected",
          seq: 1,
          role: "assistant" as const,
          text: "Projected message",
          model: "napier/demo",
          createdAt: "2026-08-16T00:00:00.000Z",
        },
      ],
    }));
    const projectConversationPlans = vi.fn(async () => ({ view: [] }));
    const projectArtifacts = vi.fn(async () => ({ view: [] }));
    const projectActivityEvents = vi.fn(async () => ({ view: [] }));
    const projectActivityCandidates = vi.fn(async () => ({
      view: [
        {
          id: "event_activity",
          seq: 5,
          type: "run.no_progress",
          label: "Run",
          summary: "Run no progress",
          tone: "info" as const,
          createdAt: "2026-08-16T00:00:05.000Z",
        },
      ],
    }));
    const projectCitations = vi.fn(async () => ({
      view: [
        {
          id: "event_citation",
          seq: 2,
          createdAt: "2026-08-16T00:00:02.000Z",
          callId: "call_research",
          citationId: "citation_projected1",
          sourceId: "source_projected1",
          sourceKind: "web_fetch" as const,
          startLine: 2,
          endLine: 4,
          sourceContentSha256: "a".repeat(64),
          sourceTitleSha256: "b".repeat(64),
          quoteSha256: "c".repeat(64),
          claimSha256: "d".repeat(64),
        },
      ],
    }));
    const projectRecoveries = vi.fn(async () => ({
      view: [
        {
          id: "run_interrupted",
          seq: 3,
          createdAt: "2026-08-16T00:00:03.000Z",
          status: "skipped" as const,
          assessment: {
            contentSha256: "e".repeat(64),
            interruptedRunId: "run_interrupted",
            rootRunId: "run_interrupted",
            eligible: false,
            blockReasons: ["unsafe_tool_effect" as const],
            policy: {
              mode: "safe_read_only" as const,
              maxAttempts: 2,
              backoffMs: 1_000,
            },
            toolCalls: {
              total: 1,
              readOnly: 0,
              unsafe: 1,
              unknownEffect: 0,
              unresolved: 0,
            },
            eventRange: {
              fromSeq: 1,
              toSeq: 2,
              eventCount: 2,
              eventStreamSha256: "f".repeat(64),
            },
            priorAttempts: 0,
            assessedAt: "2026-08-16T00:00:02.000Z",
          },
          eventIds: ["event_recovery"],
        },
      ],
    }));
    const projectSubagents = vi.fn(async () => ({
      view: [
        {
          id: "event_subagent",
          seq: 4,
          createdAt: "2026-08-16T00:00:04.000Z",
          task: {
            id: "task_projected1",
            role: "reviewer" as const,
            description: "Review projected evidence",
            status: "completed" as const,
            model: { provider: "napier", id: "demo" },
            stepCount: 2,
            turnCount: 1,
            usage: { inputTokens: 100, outputTokens: 20 },
            stopReason: "completed" as const,
            outcome: {
              summary: "The projected evidence is complete.",
              items: [],
            },
          },
          itemCount: 0,
          evidenceCount: 0,
          unknownCount: 0,
          blockerCount: 0,
          warningCount: 0,
        },
      ],
    }));
    const projectSubagentHub = vi.fn(async () => ({
      view: {
        kind: "napier.subagent-hub-projection" as const,
        schemaVersion: 1 as const,
        threadId: projectedThread.id,
        taskCount: 0,
        selectedTaskCount: 0,
        activeTaskCount: 0,
        terminalTaskCount: 0,
        orphanedTaskCount: 0,
        omittedTaskCount: 0,
        eventWatermark: 0,
        tasks: [],
      },
    }));
    const projectOperatorDecisions = vi.fn(async () => ({ view: [] }));
    const inspectPlugins = vi.fn(() => [
      {
        id: "plugin.artifact",
        version: "1.0.0",
        displayName: "Artifact",
        description: "Projects authoritative artifacts.",
        status: "enabled" as const,
        trust: "first_party" as const,
        dependencies: [],
        capabilities: ["projection"],
        permissions: [],
        hostEntry: "@napier/runtime/kernel-artifact-plugin",
        contributions: {
          tools: [],
          providers: [],
          prompts: [],
          projections: ["conversation.artifacts"],
          uiSlots: [],
        },
        contentSha256: "f".repeat(64),
      },
      {
        id: "plugin.search",
        version: "1.0.0",
        displayName: "Search",
        description: "Provides live public Web Search.",
        status: "enabled" as const,
        trust: "first_party" as const,
        dependencies: [],
        capabilities: ["tool", "ui_slot"],
        permissions: ["network.public"],
        hostEntry: "@napier/runtime/kernel-search-plugin",
        contributions: {
          tools: ["web_search"],
          providers: [],
          prompts: [],
          projections: [],
          uiSlots: [],
        },
        contentSha256: "e".repeat(64),
      },
      {
        id: "plugin.browser",
        version: "1.0.0",
        displayName: "Browser",
        description: "Provides isolated Browser Sessions.",
        status: "enabled" as const,
        trust: "first_party" as const,
        dependencies: [],
        capabilities: ["tool"],
        permissions: [
          "browser.control",
          "network.public",
          "workspace.read",
          "workspace.write",
        ],
        hostEntry: "@napier/runtime/kernel-browser-plugin",
        clientEntry: "@napier/web/kernel-browser-inspector-slot",
        contributions: {
          tools: ["browser"],
          providers: [],
          prompts: [],
          projections: [],
          uiSlots: ["inspector.panel"],
        },
        contentSha256: "d".repeat(64),
      },
    ]);
    const app = new Hono();
    registerBootstrapHttp(app, {
      store: store as never,
      kernel: {
        threadSummaries: { listVisible },
        taskNarratives: { project },
        activePlans: { project: projectActivePlan },
        conversationActivityCandidates: {
          project: projectActivityCandidates,
        },
        conversationMessages: { project: projectMessages },
        conversationPlans: { project: projectConversationPlans },
        conversationArtifacts: { project: projectArtifacts },
        conversationActivityEvents: { project: projectActivityEvents },
        conversationCitations: { project: projectCitations },
        conversationRecoveries: { project: projectRecoveries },
        conversationSubagents: {
          project: projectSubagents,
          projectHub: projectSubagentHub,
        },
        operatorDecisions: { project: projectOperatorDecisions },
        plugins: { inspect: inspectPlugins },
      },
      models: {
        list: vi.fn(async () => []),
        recommendDefaultRunModel: vi.fn(async () => ({
          provider: "napier",
          id: "demo",
        })),
      } as never,
    });

    const response = await app.request("/api/bootstrap");
    const bootstrap = (await response.json()) as LiveReadyBootstrapResponse;

    expect(response.status).toBe(200);
    expect(listVisible).toHaveBeenCalledOnce();
    expect(project).toHaveBeenCalledWith(projectedThread.id);
    expect(projectActivePlan).toHaveBeenCalledWith(projectedThread.id);
    expect(projectActivityCandidates).toHaveBeenCalledWith(projectedThread.id);
    expect(projectMessages).toHaveBeenCalledWith(projectedThread.id);
    expect(projectConversationPlans).toHaveBeenCalledWith(projectedThread.id);
    expect(projectArtifacts).toHaveBeenCalledWith(projectedThread.id);
    expect(projectActivityEvents).toHaveBeenCalledWith(projectedThread.id);
    expect(projectCitations).toHaveBeenCalledWith(projectedThread.id);
    expect(projectRecoveries).toHaveBeenCalledWith(projectedThread.id);
    expect(projectSubagents).toHaveBeenCalledWith(projectedThread.id);
    expect(projectSubagentHub).toHaveBeenCalledWith(
      projectedThread.id,
      undefined,
    );
    expect(projectOperatorDecisions).toHaveBeenCalledWith(projectedThread.id);
    expect(inspectPlugins).toHaveBeenCalledOnce();
    expect(store.listThreads).not.toHaveBeenCalled();
    expect(bootstrap.threads).toEqual([projectedThread]);
    expect(bootstrap.activeThread?.thread.id).toBe(projectedThread.id);
    expect(bootstrap.activeThread?.taskNarrative?.currentAction).toBe(
      "Projected by Kernel",
    );
    expect(bootstrap.activeThread?.messages?.[0]?.text).toBe(
      "Projected message",
    );
    expect(bootstrap.activeThread?.citations?.[0]?.citationId).toBe(
      "citation_projected1",
    );
    expect(bootstrap.activeThread?.recoveries?.[0]?.status).toBe("skipped");
    expect(bootstrap.activeThread?.subagentCards?.[0]?.task.status).toBe(
      "completed",
    );
    expect(bootstrap.activeThread?.activityCandidates?.[0]?.type).toBe(
      "run.no_progress",
    );
    expect(bootstrap.plugins).toEqual([
      expect.objectContaining({
        id: "plugin.artifact",
        status: "enabled",
        contributions: expect.objectContaining({
          projections: ["conversation.artifacts"],
        }),
      }),
      expect.objectContaining({
        id: "plugin.search",
        status: "enabled",
        permissions: ["network.public"],
        contributions: expect.objectContaining({ tools: ["web_search"] }),
      }),
      expect.objectContaining({
        id: "plugin.browser",
        status: "enabled",
        permissions: expect.arrayContaining([
          "browser.control",
          "workspace.write",
        ]),
        contributions: expect.objectContaining({ tools: ["browser"] }),
        clientEntry: "@napier/web/kernel-browser-inspector-slot",
      }),
    ]);
    expect(response.headers.get("x-napier-content-sha256-mode")).toBe("body");
  });

  it("discovers project-standard Skills for Web configuration", async () => {
    const workspaceRoot = await mkdtemp(
      path.join(tmpdir(), "napier-bootstrap-skills-"),
    );
    const userHome = await mkdtemp(
      path.join(tmpdir(), "napier-bootstrap-home-"),
    );
    try {
      const skillRoot = path.join(
        workspaceRoot,
        ".agents",
        "skills",
        "custom-delivery",
      );
      await mkdir(skillRoot, { recursive: true });
      await writeFile(
        path.join(skillRoot, "SKILL.md"),
        "---\nname: custom-delivery\ndescription: Ship safely.\n---\n# Delivery\n",
      );
      const agent = seedAgent();
      const thread = threadSummary();
      const store = Object.assign(
        bootstrapStore(agent, thread, threadDetail(agent, thread)),
        { workspaceRoot },
      );
      const app = new Hono();
      registerBootstrapHttp(app, {
        store: store as never,
        skillUserHome: userHome,
        models: {
          list: vi.fn(async () => []),
          recommendDefaultRunModel: vi.fn(async () => ({
            provider: "napier",
            id: "demo",
          })),
        } as never,
      });

      const response = await app.request("/api/bootstrap");
      const bootstrap = (await response.json()) as BootstrapResponse;
      expect(response.status).toBe(200);
      expect(bootstrap.skills).toContainEqual({
        name: "custom-delivery",
        description: "Ship safely.",
        source: "workspace",
        enabled: true,
      });
      expect(
        bootstrap.skills
          .filter((skill) => skill.source === "bundled")
          .map((skill) => skill.name)
          .sort(),
      ).toEqual([
        "artifact-studio",
        "browser-automation",
        "data-analysis",
        "frontend-design",
        "research-brief",
        "software-delivery",
      ]);
      expect(
        bootstrap.skills
          .filter((skill) => skill.source === "bundled")
          .every((skill) => skill.enabled),
      ).toBe(true);
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
      await rm(userHome, { recursive: true, force: true });
    }
  });

  it("fails closed instead of advertising bundled Skills when catalog trust fails", async () => {
    const workspaceRoot = await mkdtemp(
      path.join(tmpdir(), "napier-bootstrap-skills-untrusted-"),
    );
    const outside = await mkdtemp(
      path.join(tmpdir(), "napier-bootstrap-skills-outside-"),
    );
    try {
      await mkdir(path.join(workspaceRoot, ".agents"));
      await mkdir(path.join(outside, "skills"));
      await symlink(
        path.join(outside, "skills"),
        path.join(workspaceRoot, ".agents", "skills"),
      );
      const agent = seedAgent();
      const thread = threadSummary();
      const store = Object.assign(
        bootstrapStore(agent, thread, threadDetail(agent, thread)),
        { workspaceRoot },
      );
      const app = new Hono();
      registerBootstrapHttp(app, {
        store: store as never,
        models: {
          list: vi.fn(async () => []),
          recommendDefaultRunModel: vi.fn(async () => ({
            provider: "napier",
            id: "demo",
          })),
        } as never,
      });

      const bootstrap = (await (
        await app.request("/api/bootstrap")
      ).json()) as BootstrapResponse;
      expect(bootstrap.skills).toHaveLength(6);
      expect(bootstrap.skills.every((skill) => !skill.enabled)).toBe(true);
      expect(
        bootstrap.skills.every((skill) => skill.source === "bundled"),
      ).toBe(true);
      expect(bootstrap.skills[0]?.description).toContain("Unavailable (");
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
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
