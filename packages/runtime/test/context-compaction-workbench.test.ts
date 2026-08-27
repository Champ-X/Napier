import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";

import { latestValidContextCheckpoint } from "../src/compaction.js";
import {
  ContextCompactionPreviewChangedError,
  ContextCompactionPreviewUnavailableError,
  ContextCompactionWorkbenchService,
} from "../src/context-compaction-workbench.js";
import { ModelInvocationCapsuleStore } from "../src/model-invocation-capsule-store.js";
import { ModelRegistry } from "../src/models.js";
import { LocalStore } from "../src/store.js";

const roots: string[] = [];
const stores: LocalStore[] = [];

afterEach(async () => {
  for (const store of stores.splice(0)) store.close();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("ContextCompactionWorkbenchService", () => {
  it("captures an auditable preview and applies it only to a new fork", async () => {
    const fixture = await createFixture();
    fixture.provider.setResponses([
      fauxAssistantMessage(
        JSON.stringify({
          summary: "The source conversation established a verified plan.",
          decisions: ["Keep the source ledger immutable."],
          openLoops: ["Verify the forked checkpoint."],
          artifacts: ["docs/plan.md"],
        }),
      ),
    ]);

    const before = await fixture.store.listEvents(fixture.threadId);
    const sourceMessages = before.filter(
      (event) => event.category === "message",
    );
    const preview = await fixture.service.preview(fixture.threadId, {
      retainedMessageCount: 2,
      model: fixture.model,
    });

    expect(preview.sourceEventCount).toBe(before.length);
    expect(preview.sourceMessageCount).toBe(4);
    expect(preview.summary).toContain("verified plan");
    const audited = await fixture.store.listEvents(fixture.threadId);
    expect(audited.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        "context.compaction.started",
        "context.model_envelope",
        "context.model_invocation",
        "model.response",
        "context.compaction.previewed",
      ]),
    );
    const response = audited.findLast(
      (event) => event.type === "model.response",
    );
    expect(response?.payload).toMatchObject({
      contentRedacted: true,
      modelCallPurpose: "context_compaction",
    });
    expect(JSON.stringify(response?.payload)).not.toContain(preview.summary);

    const result = await fixture.service.applyFork(fixture.threadId, {
      expectedPreviewSha256: preview.previewSha256,
      title: "  Compacted   investigation  ",
    });
    expect(result.sourceThreadId).toBe(fixture.threadId);
    expect(result.targetThreadId).not.toBe(fixture.threadId);
    expect(result.previewSha256).toBe(preview.previewSha256);
    const sourceAfter = await fixture.store.listEvents(fixture.threadId);
    expect(sourceAfter.filter((event) => event.category === "message")).toEqual(
      sourceMessages,
    );
    const target = await fixture.store.getDetail(result.targetThreadId);
    expect(target.thread.title).toBe("Compacted investigation");
    const checkpoint = latestValidContextCheckpoint(target.events);
    expect(checkpoint).toEqual(result.checkpoint);
    expect(checkpoint?.sourceSha256).not.toBe(preview.sourceMessageSha256);
    expect(
      target.events.find((event) => event.type === "context.compaction.forked")
        ?.payload,
    ).toMatchObject({
      sourceThreadId: fixture.threadId,
      targetThreadId: result.targetThreadId,
      previewSha256: preview.previewSha256,
      sourceEventSetSha256: preview.sourceEventSetSha256,
    });
    await expect(
      fixture.service.applyFork(fixture.threadId, {
        expectedPreviewSha256: preview.previewSha256,
      }),
    ).rejects.toBeInstanceOf(ContextCompactionPreviewUnavailableError);
  });

  it("fails closed when the source changes or the preview cache is lost", async () => {
    const fixture = await createFixture();
    fixture.provider.setResponses([
      fauxAssistantMessage(
        JSON.stringify({
          summary: "A bounded summary.",
          decisions: [],
          openLoops: [],
          artifacts: [],
        }),
      ),
    ]);
    const preview = await fixture.service.preview(fixture.threadId, {
      retainedMessageCount: 2,
      model: fixture.model,
    });
    const thread = fixture.store.getThread(fixture.threadId);
    const driftRun = await fixture.store.createRun({
      threadId: fixture.threadId,
      agentId: thread.agentId,
    });
    await fixture.store.appendEvent({
      threadId: fixture.threadId,
      runId: driftRun.id,
      type: "message.user",
      category: "message",
      visibility: "user",
      payload: { role: "user", text: "New source evidence." },
    });
    await fixture.store.finishRun(driftRun.id, "completed");

    await expect(
      fixture.service.applyFork(fixture.threadId, {
        expectedPreviewSha256: preview.previewSha256,
      }),
    ).rejects.toBeInstanceOf(ContextCompactionPreviewChangedError);
    const restarted = new ContextCompactionWorkbenchService(
      fixture.store,
      fixture.models,
      fixture.capsules,
    );
    await expect(
      restarted.applyFork(fixture.threadId, {
        expectedPreviewSha256: preview.previewSha256,
      }),
    ).rejects.toBeInstanceOf(ContextCompactionPreviewUnavailableError);
  });
});

async function createFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "napier-context-compaction-"));
  roots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  const dataRoot = path.join(root, "data");
  await mkdir(workspaceRoot);
  const store = new LocalStore({ dataRoot, workspaceRoot });
  await store.initialize();
  stores.push(store);
  const agent = store.listAgents()[0]!;
  const thread = await store.createThread({
    title: "Compaction source",
    agentId: agent.id,
  });
  const sourceRun = await store.createRun({
    threadId: thread.id,
    agentId: agent.id,
  });
  for (let index = 0; index < 6; index += 1) {
    const user = index % 2 === 0;
    await store.appendEvent({
      threadId: thread.id,
      runId: sourceRun.id,
      type: user ? "message.user" : "message.assistant",
      category: "message",
      visibility: "user",
      payload: {
        role: user ? "user" : "assistant",
        text: `Evidence ${index + 1}`,
      },
    });
  }
  await store.finishRun(sourceRun.id, "completed");
  const provider = fauxProvider({
    provider: "faux-context-compaction",
    tokensPerSecond: 100_000,
  });
  const models = new ModelRegistry();
  models.registerProvider(provider.provider);
  const capsules = new ModelInvocationCapsuleStore(dataRoot);
  return {
    store,
    provider,
    models,
    capsules,
    service: new ContextCompactionWorkbenchService(store, models, capsules),
    threadId: thread.id,
    model: { provider: "faux-context-compaction", id: "faux-1" },
  };
}
