import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";

import { AgentMessageExperimentRuntime } from "../src/agent-message-experiments.js";
import { AgentRuntime } from "../src/agent-runtime.js";
import { ModelRegistry } from "../src/models.js";
import { exportThreadReplayBundle } from "../src/replay.js";
import { LocalStore } from "../src/store.js";
import { verifyThreadReplayBundle } from "../src/thread-bundles.js";
import { validateToolInvocationResultCapsuleReceipt } from "../src/tool-invocation-result-capsule.js";

const SOURCE_BODY = "PRIVATE_FROZEN_SOURCE_RESULT";
const CURRENT_BODY = "PRIVATE_CURRENT_WORKSPACE_RESULT";
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

describe("Agent message frozen tool result replay", () => {
  it("reuses one exact historical result without executing the changed workspace tool", async () => {
    const fixture = await createFixture();
    const source = await createToolSource(fixture);
    const sourceEvents = await fixture.store.listEvents(fixture.threadId);
    const sourceResultReceipt = sourceEvents.find(
      (event) =>
        event.runId === source.runId && event.type === "context.tool_result",
    );
    expect(sourceResultReceipt).toBeDefined();
    expect(
      sourceEvents
        .filter((event) => event.runId === source.runId)
        .map((event) => event.type),
    ).toEqual(
      expect.arrayContaining([
        "context.tool_invocation",
        "context.tool_result",
        "tool.completed",
      ]),
    );
    expect(JSON.stringify(sourceEvents)).not.toContain(SOURCE_BODY);
    expect(JSON.stringify(sourceEvents)).not.toContain("fixture.txt");
    const sourceBundle = await exportThreadReplayBundle(
      fixture.store,
      fixture.threadId,
    );
    expect(verifyThreadReplayBundle(sourceBundle).status).toBe("valid");
    expect(JSON.stringify(sourceBundle)).not.toContain(SOURCE_BODY);
    expect(JSON.stringify(sourceBundle)).not.toContain("fixture.txt");

    await writeFile(fixture.filePath, `${CURRENT_BODY}\n`, "utf8");
    const request = {
      sourceRunId: source.runId,
      sourceMessageSeq: source.messageSeq,
      toolResultMode: "reuse_source" as const,
    };
    const preview = await fixture.experiments.preview(
      fixture.threadId,
      request,
    );
    expect(preview).toEqual(
      expect.objectContaining({
        schemaVersion: 2,
        toolResultMode: "reuse_source",
        sourceReusableToolResultCount: 1,
        sourceToolResultSetSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
    const preAborted = new AbortController();
    preAborted.abort();
    const threadCount = fixture.store.listThreads().length;
    await expect(
      fixture.experiments.run({
        sourceThreadId: fixture.threadId,
        request: {
          ...request,
          expectedPreviewSha256: preview.previewSha256,
        },
        signal: preAborted.signal,
      }),
    ).rejects.toThrow("aborted");
    expect(fixture.store.listThreads()).toHaveLength(threadCount);

    let candidateContext = "";
    fixture.provider.setResponses([
      fauxAssistantMessage(fauxToolCall("read_file", { path: "fixture.txt" }), {
        stopReason: "toolUse",
      }),
      (context) => {
        candidateContext = JSON.stringify(context);
        return fauxAssistantMessage("candidate used frozen result");
      },
    ]);
    const result = await fixture.experiments.run({
      sourceThreadId: fixture.threadId,
      request: {
        ...request,
        expectedPreviewSha256: preview.previewSha256,
      },
    });

    expect(result).toEqual(
      expect.objectContaining({
        schemaVersion: 2,
        status: "completed",
        assistantText: "candidate used frozen result",
        toolResultReuse: {
          mode: "reuse_source",
          sourceResultCount: 1,
          reusedResultCount: 1,
          divergenceCount: 0,
          complete: true,
          sourceResultSetSha256: preview.sourceToolResultSetSha256,
          targetReuseSetSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        },
      }),
    );
    expect(candidateContext).toContain(SOURCE_BODY);
    expect(candidateContext).not.toContain(CURRENT_BODY);

    const targetEvents = await fixture.store.listEvents(result.targetThreadId);
    expect(
      targetEvents.filter((event) => event.type === "tool.result_reused"),
    ).toHaveLength(1);
    expect(
      targetEvents.some((event) => event.type === "context.tool_invocation"),
    ).toBe(false);
    expect(
      targetEvents.some((event) => event.type === "context.tool_result"),
    ).toBe(false);
    expect(JSON.stringify(targetEvents)).not.toContain(SOURCE_BODY);
    expect(JSON.stringify(targetEvents)).not.toContain(CURRENT_BODY);
    const targetBundle = await exportThreadReplayBundle(
      fixture.store,
      result.targetThreadId,
    );
    expect(verifyThreadReplayBundle(targetBundle).status).toBe("valid");
    expect(JSON.stringify(targetBundle)).not.toContain(SOURCE_BODY);
    expect(JSON.stringify(targetBundle)).not.toContain(CURRENT_BODY);

    let liveContext = "";
    fixture.provider.setResponses([
      fauxAssistantMessage(fauxToolCall("read_file", { path: "fixture.txt" }), {
        stopReason: "toolUse",
      }),
      (context) => {
        liveContext = JSON.stringify(context);
        return fauxAssistantMessage("candidate used live result");
      },
    ]);
    const livePreview = await fixture.experiments.preview(fixture.threadId, {
      sourceRunId: source.runId,
      sourceMessageSeq: source.messageSeq,
    });
    const live = await fixture.experiments.run({
      sourceThreadId: fixture.threadId,
      request: {
        sourceRunId: source.runId,
        sourceMessageSeq: source.messageSeq,
        expectedPreviewSha256: livePreview.previewSha256,
      },
    });
    expect(live.status).toBe("completed");
    expect(live.toolResultReuse).toEqual(
      expect.objectContaining({
        mode: "live",
        reusedResultCount: 0,
        divergenceCount: 0,
        complete: true,
      }),
    );
    expect(liveContext).toContain(CURRENT_BODY);
    expect(liveContext).not.toContain(SOURCE_BODY);
    const liveEvents = await fixture.store.listEvents(live.targetThreadId);
    expect(
      liveEvents.some((event) => event.type === "context.tool_invocation"),
    ).toBe(true);
    expect(
      liveEvents.some((event) => event.type === "context.tool_result"),
    ).toBe(true);
  });

  it("fails closed on divergence and exposed result capsule permissions", async () => {
    const fixture = await createFixture();
    const source = await createToolSource(fixture);
    const request = {
      sourceRunId: source.runId,
      sourceMessageSeq: source.messageSeq,
      toolResultMode: "reuse_source" as const,
    };
    await writeFile(
      path.join(fixture.workspaceRoot, "other.txt"),
      "A live fallback must never read this file.\n",
      "utf8",
    );
    const preview = await fixture.experiments.preview(
      fixture.threadId,
      request,
    );
    fixture.provider.setResponses([
      fauxAssistantMessage(fauxToolCall("read_file", { path: "other.txt" }), {
        stopReason: "toolUse",
      }),
    ]);
    const diverged = await fixture.experiments.run({
      sourceThreadId: fixture.threadId,
      request: {
        ...request,
        expectedPreviewSha256: preview.previewSha256,
      },
    });
    expect(diverged.status).toBe("failed");
    expect(diverged.toolResultReuse).toEqual(
      expect.objectContaining({
        reusedResultCount: 0,
        divergenceCount: 1,
        complete: false,
      }),
    );
    const divergenceEvents = await fixture.store.listEvents(
      diverged.targetThreadId,
    );
    expect(
      divergenceEvents.filter(
        (event) => event.type === "tool.result_reuse.blocked",
      ),
    ).toHaveLength(1);
    expect(
      divergenceEvents.some((event) => event.type === "tool.result_reused"),
    ).toBe(false);
    expect(JSON.stringify(divergenceEvents)).not.toContain(
      "A live fallback must never read this file.",
    );

    const sourceEvents = await fixture.store.listEvents(fixture.threadId);
    const resultEvent = sourceEvents.find(
      (event) =>
        event.runId === source.runId && event.type === "context.tool_result",
    )!;
    const receipt = validateToolInvocationResultCapsuleReceipt(
      resultEvent.payload,
    );
    const capsulePath = path.join(
      fixture.runtime.toolInvocationResultCapsules.rootPath,
      `${receipt.capsuleSha256}.json`,
    );
    await chmod(capsulePath, 0o644);
    await expect(
      fixture.experiments.preview(fixture.threadId, request),
    ).rejects.toThrow("completely reusable");
    await chmod(capsulePath, 0o600);
    await writeFile(capsulePath, '{"tampered":true}\n', "utf8");
    await expect(
      fixture.experiments.preview(fixture.threadId, request),
    ).rejects.toThrow("completely reusable");
    await rm(capsulePath);
    await expect(
      fixture.experiments.preview(fixture.threadId, request),
    ).rejects.toThrow("completely reusable");
  });

  it("preserves a frozen source tool error without retrying the now-successful read", async () => {
    const fixture = await createFixture();
    fixture.provider.setResponses([
      fauxAssistantMessage(fauxToolCall("read_file", { path: "missing.txt" }), {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage("source observed the read failure"),
    ]);
    const run = await fixture.runtime.runPrompt({
      threadId: fixture.threadId,
      text: "Read the missing source file.",
      model: { provider: "faux-frozen-tool-result", id: "faux-1" },
    });
    const message = (await fixture.store.listEvents(fixture.threadId)).find(
      (event) => event.runId === run.id && event.type === "message.user",
    )!;
    await writeFile(
      path.join(fixture.workspaceRoot, "missing.txt"),
      "PRIVATE_FILE_CREATED_AFTER_SOURCE_FAILURE\n",
      "utf8",
    );
    const request = {
      sourceRunId: run.id,
      sourceMessageSeq: message.seq,
      toolResultMode: "reuse_source" as const,
    };
    const preview = await fixture.experiments.preview(
      fixture.threadId,
      request,
    );
    let candidateContext = "";
    fixture.provider.setResponses([
      fauxAssistantMessage(fauxToolCall("read_file", { path: "missing.txt" }), {
        stopReason: "toolUse",
      }),
      (context) => {
        candidateContext = JSON.stringify(context);
        return fauxAssistantMessage("candidate retained source failure");
      },
    ]);
    const result = await fixture.experiments.run({
      sourceThreadId: fixture.threadId,
      request: {
        ...request,
        expectedPreviewSha256: preview.previewSha256,
      },
    });
    expect(result.status).toBe("completed");
    expect(result.toolResultReuse).toEqual(
      expect.objectContaining({
        reusedResultCount: 1,
        divergenceCount: 0,
        complete: true,
      }),
    );
    expect(candidateContext).toContain('"isError":true');
    expect(candidateContext).not.toContain(
      "PRIVATE_FILE_CREATED_AFTER_SOURCE_FAILURE",
    );
    const targetEvents = await fixture.store.listEvents(result.targetThreadId);
    expect(
      targetEvents.filter((event) => event.type === "tool.failed"),
    ).toHaveLength(1);
    expect(JSON.stringify(targetEvents)).not.toContain(
      "PRIVATE_FILE_CREATED_AFTER_SOURCE_FAILURE",
    );
  });

  it("isolates concurrent frozen-result candidates with different models", async () => {
    const fixture = await createFixture();
    const source = await createToolSource(fixture);
    await writeFile(fixture.filePath, `${CURRENT_BODY}\n`, "utf8");
    const leftId = "faux-frozen-left";
    const rightId = "faux-frozen-right";
    const leftProvider = fauxProvider({ provider: leftId });
    const rightProvider = fauxProvider({ provider: rightId });
    let leftContext = "";
    let rightContext = "";
    leftProvider.setResponses([
      fauxAssistantMessage(fauxToolCall("read_file", { path: "fixture.txt" }), {
        stopReason: "toolUse",
      }),
      (context) => {
        leftContext = JSON.stringify(context);
        return fauxAssistantMessage("left frozen candidate");
      },
    ]);
    rightProvider.setResponses([
      fauxAssistantMessage(fauxToolCall("read_file", { path: "fixture.txt" }), {
        stopReason: "toolUse",
      }),
      (context) => {
        rightContext = JSON.stringify(context);
        return fauxAssistantMessage("right frozen candidate");
      },
    ]);
    fixture.runtime.modelRegistry.registerProvider(leftProvider.provider);
    fixture.runtime.modelRegistry.registerProvider(rightProvider.provider);
    const request = {
      sourceRunId: source.runId,
      sourceMessageSeq: source.messageSeq,
      toolResultMode: "reuse_source" as const,
    };
    const [leftPreview, rightPreview] = await Promise.all([
      fixture.experiments.preview(fixture.threadId, {
        ...request,
        model: { provider: leftId, id: "faux-1" },
      }),
      fixture.experiments.preview(fixture.threadId, {
        ...request,
        model: { provider: rightId, id: "faux-1" },
      }),
    ]);
    const [left, right] = await Promise.all([
      fixture.experiments.run({
        sourceThreadId: fixture.threadId,
        request: {
          ...request,
          model: { provider: leftId, id: "faux-1" },
          expectedPreviewSha256: leftPreview.previewSha256,
        },
      }),
      fixture.experiments.run({
        sourceThreadId: fixture.threadId,
        request: {
          ...request,
          model: { provider: rightId, id: "faux-1" },
          expectedPreviewSha256: rightPreview.previewSha256,
        },
      }),
    ]);
    expect(left.targetThreadId).not.toBe(right.targetThreadId);
    expect([left.status, right.status]).toEqual(["completed", "completed"]);
    expect(left.toolResultReuse.reusedResultCount).toBe(1);
    expect(right.toolResultReuse.reusedResultCount).toBe(1);
    expect(leftContext).toContain(SOURCE_BODY);
    expect(rightContext).toContain(SOURCE_BODY);
    expect(leftContext).not.toContain(CURRENT_BODY);
    expect(rightContext).not.toContain(CURRENT_BODY);
  });
});

interface Fixture {
  store: LocalStore;
  runtime: AgentRuntime;
  experiments: AgentMessageExperimentRuntime;
  provider: ReturnType<typeof fauxProvider>;
  workspaceRoot: string;
  filePath: string;
  threadId: string;
}

async function createFixture(): Promise<Fixture> {
  const root = await mkdtemp(
    path.join(tmpdir(), "napier-agent-tool-result-replay-"),
  );
  temporaryRoots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  await mkdir(workspaceRoot);
  const filePath = path.join(workspaceRoot, "fixture.txt");
  await writeFile(filePath, `${SOURCE_BODY}\n`, "utf8");
  const store = new LocalStore({
    dataRoot: path.join(root, "data"),
    workspaceRoot,
  });
  await store.initialize();
  openStores.push(store);
  const agent = await store.updateAgent(store.listAgents()[0]!.id, {
    toolPolicy: "workspace",
    enabledTools: ["read_file"],
  });
  const thread = await store.createThread({
    title: "Frozen tool result source",
    agentId: agent.id,
  });
  const models = new ModelRegistry();
  const provider = fauxProvider({ provider: "faux-frozen-tool-result" });
  models.registerProvider(provider.provider);
  const runtime = new AgentRuntime(store, models);
  return {
    store,
    runtime,
    experiments: new AgentMessageExperimentRuntime(store, runtime),
    provider,
    workspaceRoot,
    filePath,
    threadId: thread.id,
  };
}

async function createToolSource(
  fixture: Fixture,
): Promise<{ runId: string; messageSeq: number }> {
  fixture.provider.setResponses([
    fauxAssistantMessage(fauxToolCall("read_file", { path: "fixture.txt" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("source completed"),
  ]);
  const run = await fixture.runtime.runPrompt({
    threadId: fixture.threadId,
    text: "Read the source fixture.",
    model: { provider: "faux-frozen-tool-result", id: "faux-1" },
  });
  const message = (await fixture.store.listEvents(fixture.threadId)).find(
    (event) => event.runId === run.id && event.type === "message.user",
  )!;
  return { runId: run.id, messageSeq: message.seq };
}
