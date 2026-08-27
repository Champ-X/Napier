import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import type {
  ContextCompactionForkResult,
  ContextCompactionPreview,
} from "@napier/contracts/context-compaction";
import { afterEach, describe, expect, it } from "vitest";

import { createApp, createServices } from "../src/app.js";

const roots: string[] = [];
const servicesToClose: Awaited<ReturnType<typeof createServices>>[] = [];

afterEach(async () => {
  for (const services of servicesToClose.splice(0)) {
    await services.shutdownLocalRuntime();
  }
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Context compaction HTTP path", () => {
  it("previews and applies a hash-bound fork", async () => {
    const fixture = await createFixture();
    fixture.provider.setResponses([
      fauxAssistantMessage(
        JSON.stringify({
          summary: "A verified HTTP preview.",
          decisions: ["Fork before applying."],
          openLoops: ["Inspect the new thread."],
          artifacts: [],
        }),
      ),
    ]);
    const app = createApp(fixture.services);
    const base = `/api/threads/${fixture.threadId}/context-compaction`;
    const previewResponse = await app.request(`${base}/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ retainedMessageCount: 2, model: fixture.model }),
    });
    expect(previewResponse.status, await previewResponse.clone().text()).toBe(
      200,
    );
    const preview = (await previewResponse.json()) as ContextCompactionPreview;
    expect(
      previewResponse.headers.get("x-napier-context-compaction-preview-sha256"),
    ).toBe(preview.previewSha256);

    const forkResponse = await app.request(`${base}/forks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        expectedPreviewSha256: preview.previewSha256,
        title: "HTTP compacted fork",
      }),
    });
    expect(forkResponse.status, await forkResponse.clone().text()).toBe(201);
    const result = (await forkResponse.json()) as ContextCompactionForkResult;
    expect(result).toMatchObject({
      sourceThreadId: fixture.threadId,
      previewSha256: preview.previewSha256,
    });
    expect(result.targetThreadId).not.toBe(fixture.threadId);
    expect(forkResponse.headers.get("x-napier-content-sha256")).toMatch(
      /^[a-f0-9]{64}$/u,
    );

    const replayResponse = await app.request(`${base}/forks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedPreviewSha256: preview.previewSha256 }),
    });
    expect(replayResponse.status).toBe(409);
  });

  it("rejects invalid requests before provider invocation", async () => {
    const fixture = await createFixture();
    const response = await createApp(fixture.services).request(
      `/api/threads/${fixture.threadId}/context-compaction/preview`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ retainedMessageCount: 1, model: fixture.model }),
      },
    );
    expect(response.status).toBe(400);
  });
});

async function createFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "napier-compaction-http-"));
  roots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  await mkdir(workspaceRoot);
  const services = await createServices({
    workspaceRoot,
    dataRoot: path.join(root, "data"),
  });
  servicesToClose.push(services);
  const provider = fauxProvider({
    provider: "faux-context-compaction-http",
    tokensPerSecond: 100_000,
  });
  services.models.registerProvider(provider.provider);
  const agent = services.store.listAgents()[0]!;
  const thread = await services.store.createThread({
    title: "HTTP compaction source",
    agentId: agent.id,
  });
  const run = await services.store.createRun({
    threadId: thread.id,
    agentId: agent.id,
  });
  for (let index = 0; index < 6; index += 1) {
    const user = index % 2 === 0;
    await services.store.appendEvent({
      threadId: thread.id,
      runId: run.id,
      type: user ? "message.user" : "message.assistant",
      category: "message",
      visibility: "user",
      payload: {
        role: user ? "user" : "assistant",
        text: `HTTP evidence ${index + 1}`,
      },
    });
  }
  await services.store.finishRun(run.id, "completed");
  return {
    services,
    provider,
    threadId: thread.id,
    model: { provider: "faux-context-compaction-http", id: "faux-1" },
  };
}
