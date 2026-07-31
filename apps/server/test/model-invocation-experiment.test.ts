import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import {
  exportThreadReplayBundle,
  validateModelInvocationExperimentResultFrame,
  verifyThreadReplayBundle,
} from "@napier/runtime";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createApp, createServices } from "../src/app.js";
import {
  executeModelInvocationExperiment,
  previewModelInvocationExperiment,
} from "../../web/src/model-invocation-experiment-api.js";

const temporaryRoots: string[] = [];
const openServices: Awaited<ReturnType<typeof createServices>>[] = [];

afterEach(async () => {
  vi.unstubAllGlobals();
  for (const services of openServices.splice(0)) {
    await services.shutdownLocalRuntime();
  }
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Model invocation experiment HTTP path", () => {
  it("previews and streams one real provider call without executing tools", async () => {
    const fixture = await createFixture();
    const app = createApp(fixture.services);
    const request = {
      sourceRunId: fixture.sourceRunId,
      sourceTurnIndex: 0,
    };
    expect(
      (await fixture.services.store.listEvents(fixture.sourceThreadId)).filter(
        (event) => event.type.startsWith("context.model_invocation"),
      ),
    ).toEqual([
      expect.objectContaining({
        type: "context.model_invocation",
        payload: expect.objectContaining({ turnIndex: 0 }),
      }),
      expect.objectContaining({
        type: "context.model_invocation",
        payload: expect.objectContaining({ turnIndex: 1 }),
      }),
    ]);
    await expect(
      fixture.services.modelInvocationExperiments.preview(
        fixture.sourceThreadId,
        request,
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        targetExecutionMode: "model_experiment_single_call",
      }),
    );
    const endpoint = `/api/threads/${fixture.sourceThreadId}/model-invocation-experiments`;
    const previewResponse = await app.request(`${endpoint}/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
    expect(previewResponse.status, await previewResponse.clone().text()).toBe(
      200,
    );
    expect(previewResponse.headers.get("cache-control")).toBe("no-store");
    const preview = (await previewResponse.json()) as {
      previewSha256: string;
      targetExecutionMode: string;
    };
    expect(preview).toEqual(
      expect.objectContaining({
        previewSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        targetExecutionMode: "model_experiment_single_call",
      }),
    );
    expect(
      previewResponse.headers.get(
        "x-napier-model-invocation-experiment-preview-sha256",
      ),
    ).toBe(preview.previewSha256);

    fixture.provider.setResponses([
      fauxAssistantMessage(
        fauxToolCall("apply_patch", {
          patch: "*** Begin Patch\n*** End Patch",
        }),
      ),
    ]);
    const response = await app.request(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...request,
        expectedPreviewSha256: preview.previewSha256,
      }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const frames = parseSseFrames(await response.text());
    expect(frames.at(-2)).toEqual(
      expect.objectContaining({ type: "snapshot" }),
    );
    const result = validateModelInvocationExperimentResultFrame(frames.at(-1));
    expect(result).toEqual(
      expect.objectContaining({
        sourceThreadId: fixture.sourceThreadId,
        sourceRunId: fixture.sourceRunId,
        sourceTurnIndex: 0,
        status: "completed",
        experiment: expect.objectContaining({
          candidateToolCallNames: ["apply_patch"],
          comparison: expect.objectContaining({
            outputChanged: true,
          }),
        }),
      }),
    );
    const targetEvents = await fixture.services.store.listEvents(
      result.targetThreadId,
    );
    expect(targetEvents.some((event) => event.type === "tool.started")).toBe(
      false,
    );
    expect(
      verifyThreadReplayBundle(
        await exportThreadReplayBundle(
          fixture.services.store,
          result.targetThreadId,
        ),
      ).status,
    ).toBe("valid");
  });

  it("completes the real Web client preview and comparison path", async () => {
    const fixture = await createFixture();
    const app = createApp(fixture.services);
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request, init?: RequestInit) => {
        const requestPath =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;
        return app.request(requestPath, init);
      }),
    );
    const request = {
      sourceRunId: fixture.sourceRunId,
      sourceTurnIndex: 0,
    };
    const preview = await previewModelInvocationExperiment(
      fixture.sourceThreadId,
      request,
    );
    fixture.provider.setResponses([
      fauxAssistantMessage(
        fauxToolCall("apply_patch", {
          patch: "*** Begin Patch\n*** End Patch",
        }),
      ),
    ]);
    const frames: string[] = [];
    const result = await executeModelInvocationExperiment(
      fixture.sourceThreadId,
      {
        ...request,
        expectedPreviewSha256: preview.previewSha256,
      },
      preview,
      (frame) => frames.push(frame.type),
    );

    expect(result).toEqual(
      expect.objectContaining({
        sourceThreadId: fixture.sourceThreadId,
        sourceRunId: fixture.sourceRunId,
        sourceTurnIndex: 0,
        status: "completed",
        experiment: expect.objectContaining({
          candidateToolCallNames: ["apply_patch"],
        }),
      }),
    );
    expect(frames.at(-2)).toBe("snapshot");
    expect(frames.at(-1)).toBe("model_invocation_experiment_result");
  });

  it("rejects execution without the exact preview before mutation", async () => {
    const fixture = await createFixture();
    const app = createApp(fixture.services);
    const endpoint = `/api/threads/${fixture.sourceThreadId}/model-invocation-experiments`;
    const threadCount = fixture.services.store.listThreads().length;
    const missing = await app.request(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceRunId: fixture.sourceRunId,
        sourceTurnIndex: 0,
      }),
    });
    expect(missing.status).toBe(409);
    expect(fixture.services.store.listThreads()).toHaveLength(threadCount);
  });
});

async function createFixture() {
  const root = await mkdtemp(
    path.join(tmpdir(), "napier-model-invocation-experiment-http-"),
  );
  temporaryRoots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  await mkdir(workspaceRoot);
  const services = await createServices({
    workspaceRoot,
    dataRoot: path.join(root, "data"),
  });
  openServices.push(services);
  const provider = fauxProvider({
    provider: "faux-model-experiment-http",
    tokensPerSecond: 100_000,
  });
  provider.setResponses([
    fauxAssistantMessage("source HTTP answer"),
    fauxAssistantMessage('{"facts":[]}'),
  ]);
  services.models.registerProvider(provider.provider);
  const agent = services.store.listAgents()[0]!;
  const thread = await services.store.createThread({
    title: "HTTP model invocation experiment source",
    agentId: agent.id,
  });
  const run = await services.runtime.runPrompt({
    threadId: thread.id,
    text: "Capture one HTTP provider call.",
    model: { provider: "faux-model-experiment-http", id: "faux-1" },
  });
  return {
    services,
    provider,
    sourceThreadId: thread.id,
    sourceRunId: run.id,
  };
}

function parseSseFrames(text: string): unknown[] {
  return text
    .split("\n\n")
    .map((block) =>
      block
        .split("\n")
        .find((line) => line.startsWith("data:"))
        ?.slice("data:".length)
        .trim(),
    )
    .filter((value): value is string => Boolean(value))
    .map((value) => JSON.parse(value) as unknown);
}
