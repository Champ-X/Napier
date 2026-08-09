import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import type { AgentMessageExperimentResult, RunEvent } from "@napier/contracts";
import { isSkillCatalogBindingV1 } from "@napier/contracts/skill-load";
import { afterEach, describe, expect, it } from "vitest";

import { AgentMessageExperimentRuntime } from "../src/agent-message-experiments.js";
import { AgentRuntime } from "../src/agent-runtime.js";
import { ModelRegistry } from "../src/models.js";
import {
  validateAgentMessageExperimentResult,
  validateCreateAgentMessageExperimentRequest,
} from "../src/agent-message-experiment-protocol.js";
import { exportThreadReplayBundle } from "../src/replay.js";
import { LocalStore } from "../src/store.js";
import { verifyThreadReplayBundle } from "../src/thread-bundles.js";

const temporaryRoots: string[] = [];
const openStores: LocalStore[] = [];

afterEach(async () => {
  for (const store of openStores.splice(0)) store.close();
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Agent message checkpoint experiments", () => {
  it("re-executes one historical message in a read-only Branch and compares it", async () => {
    const fixture = await createFixture();
    const prior = await sourceRun(fixture, "Create prior context.");
    await fixture.store.appendEvent({
      threadId: fixture.sourceThreadId,
      runId: prior.runId,
      type: "goal.continuation.prompt",
      category: "goal",
      visibility: "hidden",
      payload: {
        role: "user",
        text: "PRIVATE_GOAL_CONTINUATION_CONTEXT",
      },
    });
    const source = await sourceRun(fixture, "PRIVATE_SOURCE_MESSAGE");
    let targetTools: string[] = [];
    fixture.provider.setResponses([
      (context) => {
        targetTools = context.tools?.map((tool) => tool.name) ?? [];
        return fauxAssistantMessage("candidate answer");
      },
    ]);
    const preview = await fixture.experiments.preview(
      fixture.sourceThreadId,
      checkpointRequest(source),
    );
    const streamed: RunEvent[] = [];

    const result = await fixture.experiments.run({
      sourceThreadId: fixture.sourceThreadId,
      request: {
        ...checkpointRequest(source),
        expectedPreviewSha256: preview.previewSha256,
      },
      onEvent: (event) => {
        streamed.push(event);
      },
    });

    expect(preview).toEqual(
      expect.objectContaining({
        sourceThreadId: fixture.sourceThreadId,
        sourceRunId: source.runId,
        sourceMessageSeq: source.messageSeq,
        branchFromSeq: source.messageSeq - 1,
        targetExecutionMode: "agent_experiment_read_only",
        targetToolNames: ["read_file"],
        sourceHistoryMessageCount: 3,
        sourceToolEffects: expect.objectContaining({
          toolCallCount: 0,
        }),
      }),
    );
    expect(targetTools).toEqual(["read_file"]);
    expect(result).toEqual(
      expect.objectContaining({
        status: "completed",
        assistantText: "candidate answer",
        comparison: expect.objectContaining({
          outputChanged: true,
          target: expect.objectContaining({
            executionMode: "agent_experiment_read_only",
            toolEffects: expect.objectContaining({
              writeCount: 0,
              unknownCount: 0,
              unresolvedCount: 0,
            }),
          }),
          configurationDelta: expect.objectContaining({
            status: "comparable",
            changedFields: expect.arrayContaining([
              "toolPolicy",
              "enabledTools",
              "executionMode",
            ]),
            removedTools: ["apply_patch", "python_kernel"],
          }),
        }),
      }),
    );
    const targetRuns = fixture.store.listRuns(result.targetThreadId);
    expect(targetRuns).toHaveLength(2);
    expect(targetRuns[0]).toEqual(
      expect.objectContaining({
        status: "completed",
        parentRunId: source.runId,
        branchFromSeq: source.messageSeq - 1,
      }),
    );
    expect(targetRuns[1]).toEqual(
      expect.objectContaining({
        status: "completed",
        parentRunId: targetRuns[0]!.id,
        configuration: expect.objectContaining({
          executionMode: "agent_experiment_read_only",
          toolPolicy: "observe",
          enabledTools: ["read_file"],
          enabledSubagents: [],
        }),
      }),
    );
    expect(
      (await fixture.store.listEvents(result.targetThreadId)).some(
        (event) => event.type === "goal.continuation.prompt",
      ),
    ).toBe(true);
    const experimentEvents = (
      await fixture.store.listEvents(result.targetThreadId)
    ).filter((event) => event.type.startsWith("agent.experiment."));
    expect(experimentEvents.map((event) => event.type)).toEqual([
      "agent.experiment.started",
      "agent.experiment.compared",
    ]);
    expect(JSON.stringify(experimentEvents)).not.toContain(
      "PRIVATE_SOURCE_MESSAGE",
    );
    expect(streamed.map((event) => event.seq)).toEqual(
      [...streamed]
        .map((event) => event.seq)
        .sort((left, right) => left - right),
    );
    expect(
      verifyThreadReplayBundle(
        await exportThreadReplayBundle(fixture.store, result.targetThreadId),
      ).status,
    ).toBe("valid");
  });

  it("fails stale or forged previews closed before creating an experiment Branch", async () => {
    const fixture = await createFixture();
    const source = await sourceRun(fixture, "Inspect current workspace.");
    const request = checkpointRequest(source);
    const preview = await fixture.experiments.preview(
      fixture.sourceThreadId,
      request,
    );
    const threadCount = fixture.store.listThreads().length;
    await expect(
      fixture.experiments.preview(fixture.sourceThreadId, {
        ...request,
        model: { provider: "unavailable", id: "missing-model" },
      }),
    ).rejects.toThrow();
    expect(fixture.store.listThreads()).toHaveLength(threadCount);
    await writeFile(
      path.join(fixture.workspaceRoot, "fixture.txt"),
      "changed after preview\n",
    );

    await expect(
      fixture.experiments.run({
        sourceThreadId: fixture.sourceThreadId,
        request: {
          ...request,
          expectedPreviewSha256: preview.previewSha256,
        },
      }),
    ).rejects.toThrow("preview changed");
    expect(fixture.store.listThreads()).toHaveLength(threadCount);

    const ordinary = await fixture.store.createThread({
      title: "Forged experiment mode",
      agentId: fixture.agentId,
    });
    await expect(
      fixture.runtime.runPrompt({
        threadId: ordinary.id,
        text: "Attempt to forge experiment mode.",
        executionMode: "agent_experiment_read_only",
      }),
    ).rejects.toThrow("Branch capability");
    expect(fixture.store.listRuns(ordinary.id)).toHaveLength(0);
  });

  it("inherits the exact Research preset and Skill snapshot in an agent-message experiment", async () => {
    const fixture = await createFixture();
    await Promise.all(
      ["research-brief", "data-analysis"].map(async (name) => {
        const skillPath = path.join(
          fixture.workspaceRoot,
          "skills",
          name,
          "SKILL.md",
        );
        await mkdir(path.dirname(skillPath), { recursive: true });
        await writeFile(
          skillPath,
          [
            "---",
            `name: ${name}`,
            `description: ${name} agent-message experiment fixture.`,
            "---",
            "",
            `# ${name}`,
            "",
            "Use only the frozen Research snapshot.",
            "",
          ].join("\n"),
          "utf8",
        );
      }),
    );
    const before = structuredClone(fixture.store.getAgent(fixture.agentId));
    fixture.provider.setResponses([fauxAssistantMessage("source answer")]);
    const sourceRun = await fixture.runtime.runPrompt({
      threadId: fixture.sourceThreadId,
      text: "Re-run this bounded Research checkpoint.",
      model: { provider: "faux-agent-message-experiment", id: "faux-1" },
      capabilityPreset: "research",
    });
    const sourceEvents = await fixture.store.listEvents(fixture.sourceThreadId);
    const sourceMessage = sourceEvents.find(
      (event) => event.runId === sourceRun.id && event.type === "message.user",
    )!;
    const request = checkpointRequest({
      runId: sourceRun.id,
      messageSeq: sourceMessage.seq,
    });
    const preview = await fixture.experiments.preview(
      fixture.sourceThreadId,
      request,
    );
    fixture.provider.setResponses([
      (context) => {
        expect(context.tools?.map((tool) => tool.name)).toContain("skill_load");
        return fauxAssistantMessage("Research experiment stayed snapshot-bound.");
      },
    ]);

    const result = await fixture.experiments.run({
      sourceThreadId: fixture.sourceThreadId,
      request: {
        ...request,
        expectedPreviewSha256: preview.previewSha256,
      },
    });
    const targetRun = fixture.store.listRuns(result.targetThreadId)[1]!;
    const targetEvents = (await fixture.store.listEvents(result.targetThreadId))
      .filter((event) => event.runId === targetRun.id);

    expect(result.status).toBe("completed");
    expect(targetRun.configuration).toEqual(expect.objectContaining({
      executionMode: "agent_experiment_read_only",
      enabledSkills: ["data-analysis", "research-brief"],
      enabledTools: expect.arrayContaining(["skill_load"]),
      skillCatalogSha256: sourceRun.configuration?.skillCatalogSha256,
    }));
    expect(
      targetEvents.find((event) => event.type === "run.started")?.payload,
    ).toEqual(expect.objectContaining({ capabilityPreset: "research" }));
    expect(isSkillCatalogBindingV1(
      targetEvents.find((event) => event.type === "context.skills")?.payload,
    )).toBe(true);
    expect(fixture.store.getAgent(fixture.agentId)).toEqual(before);
  });

  it("cancels before mutation and safely reruns a cancelled target from the source", async () => {
    const fixture = await createFixture();
    const source = await sourceRun(fixture, "Re-run this safely.");
    const request = checkpointRequest(source);
    const preview = await fixture.experiments.preview(
      fixture.sourceThreadId,
      request,
    );
    const preAborted = new AbortController();
    preAborted.abort();
    const threadCount = fixture.store.listThreads().length;
    await expect(
      fixture.experiments.run({
        sourceThreadId: fixture.sourceThreadId,
        request: {
          ...request,
          expectedPreviewSha256: preview.previewSha256,
        },
        signal: preAborted.signal,
      }),
    ).rejects.toThrow("aborted");
    expect(fixture.store.listThreads()).toHaveLength(threadCount);

    fixture.provider.setResponses([
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 500));
        return fauxAssistantMessage("late candidate");
      },
    ]);
    const controller = new AbortController();
    const cancelled = await fixture.experiments.run({
      sourceThreadId: fixture.sourceThreadId,
      request: {
        ...request,
        expectedPreviewSha256: preview.previewSha256,
      },
      signal: controller.signal,
      onEvent: (event) => {
        if (event.type === "agent.experiment.started") controller.abort();
      },
    });
    expect(cancelled.status).toBe("cancelled");

    fixture.provider.setResponses([
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 500));
        return fauxAssistantMessage("timed-out candidate");
      },
    ]);
    const timedOut = await fixture.experiments.run({
      sourceThreadId: fixture.sourceThreadId,
      request: {
        ...request,
        expectedPreviewSha256: preview.previewSha256,
      },
      signal: AbortSignal.timeout(20),
    });
    expect(timedOut.status).toBe("cancelled");
    expect(timedOut.targetThreadId).not.toBe(cancelled.targetThreadId);

    fixture.provider.setResponses([
      fauxAssistantMessage("recovered candidate"),
    ]);
    const recovered = await fixture.experiments.run({
      sourceThreadId: fixture.sourceThreadId,
      request: {
        ...request,
        expectedPreviewSha256: preview.previewSha256,
      },
    });
    expect(recovered).toEqual(
      expect.objectContaining({
        status: "completed",
        assistantText: "recovered candidate",
      }),
    );
    expect(recovered.targetThreadId).not.toBe(cancelled.targetThreadId);
  });

  it("records a bounded failed target and leaves the source retryable", async () => {
    const fixture = await createFixture();
    const source = await sourceRun(fixture, "Fail this candidate once.");
    const request = checkpointRequest(source);
    const preview = await fixture.experiments.preview(
      fixture.sourceThreadId,
      request,
    );
    fixture.provider.setResponses([
      async () => {
        throw new Error("PRIVATE_PROVIDER_FAILURE");
      },
    ]);
    const createdThreads: string[] = [];
    const failed = await fixture.experiments.run({
      sourceThreadId: fixture.sourceThreadId,
      request: {
        ...request,
        expectedPreviewSha256: preview.previewSha256,
      },
      onTargetCreated: (thread) => {
        createdThreads.push(thread.id);
      },
    });
    expect(failed.status).toBe("failed");
    expect(failed.comparison.target.status).toBe("failed");
    expect(createdThreads).toHaveLength(1);
    const experimentEvents = (
      await fixture.store.listEvents(createdThreads[0]!)
    ).filter((event) => event.type.startsWith("agent.experiment."));
    expect(experimentEvents.map((event) => event.type)).toEqual([
      "agent.experiment.started",
      "agent.experiment.compared",
    ]);
    expect(JSON.stringify(experimentEvents)).not.toContain(
      "PRIVATE_PROVIDER_FAILURE",
    );

    fixture.provider.setResponses([fauxAssistantMessage("retry succeeded")]);
    const retry = await fixture.experiments.run({
      sourceThreadId: fixture.sourceThreadId,
      request: {
        ...request,
        expectedPreviewSha256: preview.previewSha256,
      },
    });
    expect(retry.status).toBe("completed");
    expect(retry.targetThreadId).not.toBe(createdThreads[0]);
  });

  it("isolates concurrent targets and rejects Memory drift and malformed contracts", async () => {
    const fixture = await createFixture();
    const source = await sourceRun(fixture, "Compare concurrent candidates.");
    const request = checkpointRequest(source);
    const preview = await fixture.experiments.preview(
      fixture.sourceThreadId,
      request,
    );
    fixture.provider.setResponses([
      fauxAssistantMessage("left candidate"),
      fauxAssistantMessage("right candidate"),
    ]);

    const [left, right] = await Promise.all([
      fixture.experiments.run({
        sourceThreadId: fixture.sourceThreadId,
        request: {
          ...request,
          title: "Left candidate",
          expectedPreviewSha256: preview.previewSha256,
        },
      }),
      fixture.experiments.run({
        sourceThreadId: fixture.sourceThreadId,
        request: {
          ...request,
          title: "Right candidate",
          expectedPreviewSha256: preview.previewSha256,
        },
      }),
    ]);
    expect(left.targetThreadId).not.toBe(right.targetThreadId);
    expect(
      [left.assistantText, right.assistantText].sort((a, b) =>
        String(a).localeCompare(String(b)),
      ),
    ).toEqual(["left candidate", "right candidate"]);

    const memory = await fixture.store.proposeMemory(
      { content: "New reviewed context", scope: "workspace" },
      { type: "manual" },
    );
    await fixture.store.reviewMemory(memory.id, {
      action: "approve",
    });
    await expect(
      fixture.experiments.preview(fixture.sourceThreadId, request),
    ).rejects.toThrow("Memory context changed");

    expect(() =>
      validateCreateAgentMessageExperimentRequest({
        ...request,
        unknown: true,
      }),
    ).toThrow("fields");
    const tampered = structuredClone(left) as AgentMessageExperimentResult;
    tampered.comparison.outputChanged = !tampered.comparison.outputChanged;
    expect(() => validateAgentMessageExperimentResult(tampered)).toThrow(
      "hash mismatch",
    );
  });
});

interface Fixture {
  store: LocalStore;
  runtime: AgentRuntime;
  experiments: AgentMessageExperimentRuntime;
  provider: ReturnType<typeof fauxProvider>;
  workspaceRoot: string;
  sourceThreadId: string;
  agentId: string;
}

async function createFixture(): Promise<Fixture> {
  const root = await mkdtemp(
    path.join(tmpdir(), "napier-agent-message-experiment-"),
  );
  temporaryRoots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  await mkdir(workspaceRoot);
  await writeFile(path.join(workspaceRoot, "fixture.txt"), "stable fixture\n");
  const store = new LocalStore({
    dataRoot: path.join(root, "data"),
    workspaceRoot,
  });
  await store.initialize();
  openStores.push(store);
  const agent = await store.updateAgent(store.listAgents()[0]!.id, {
    toolPolicy: "workspace",
    enabledTools: ["read_file", "apply_patch", "python_kernel"],
  });
  const source = await store.createThread({
    title: "Agent experiment source",
    agentId: agent.id,
  });
  const models = new ModelRegistry();
  const provider = fauxProvider({ provider: "faux-agent-message-experiment" });
  models.registerProvider(provider.provider);
  const runtime = new AgentRuntime(store, models);
  return {
    store,
    runtime,
    experiments: new AgentMessageExperimentRuntime(store, runtime),
    provider,
    workspaceRoot,
    sourceThreadId: source.id,
    agentId: agent.id,
  };
}

async function sourceRun(
  fixture: Fixture,
  prompt: string,
): Promise<{ runId: string; messageSeq: number }> {
  fixture.provider.setResponses([fauxAssistantMessage("source answer")]);
  const run = await fixture.runtime.runPrompt({
    threadId: fixture.sourceThreadId,
    text: prompt,
    model: { provider: "faux-agent-message-experiment", id: "faux-1" },
  });
  const message = (await fixture.store.listEvents(fixture.sourceThreadId)).find(
    (event) => event.runId === run.id && event.type === "message.user",
  )!;
  return { runId: run.id, messageSeq: message.seq };
}

function checkpointRequest(source: { runId: string; messageSeq: number }) {
  return {
    sourceRunId: source.runId,
    sourceMessageSeq: source.messageSeq,
  };
}
