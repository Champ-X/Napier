import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import {
  exportThreadReplayBundle,
  validateToolInvocationExperimentResultFrame,
  verifyThreadReplayBundle,
} from "@napier/runtime";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createApp, createServices } from "../src/app.js";
import {
  executeToolInvocationExperiment,
  previewToolInvocationExperiment,
} from "../../web/src/tool-invocation-experiment-api.js";

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

describe("Tool invocation experiment HTTP path", () => {
  it("previews and streams one real read-only tool call", async () => {
    const fixture = await createFixture();
    const app = createApp(fixture.services);
    const request = {
      sourceRunId: fixture.sourceRunId,
      sourceCallId: fixture.sourceCallId,
    };
    const endpoint = `/api/threads/${fixture.sourceThreadId}/tool-invocation-experiments`;
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
      sourceToolName: string;
      targetExecutionMode: string;
    };
    expect(preview).toEqual(
      expect.objectContaining({
        previewSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        sourceToolName: "read_file",
        targetExecutionMode: "tool_experiment_read_only",
      }),
    );
    expect(
      previewResponse.headers.get(
        "x-napier-tool-invocation-experiment-preview-sha256",
      ),
    ).toBe(preview.previewSha256);

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
    const result = validateToolInvocationExperimentResultFrame(frames.at(-1));
    expect(result).toEqual(
      expect.objectContaining({
        sourceThreadId: fixture.sourceThreadId,
        sourceRunId: fixture.sourceRunId,
        sourceCallId: fixture.sourceCallId,
        status: "completed",
        experiment: expect.objectContaining({
          candidateOutput: expect.stringContaining("HTTP tool evidence"),
          comparison: expect.objectContaining({ outputChanged: false }),
        }),
      }),
    );
    const targetEvents = await fixture.services.store.listEvents(
      result.targetThreadId,
    );
    expect(
      targetEvents.filter((event) => event.type === "tool.started"),
    ).toHaveLength(1);
    expect(targetEvents.some((event) => event.type === "model.response")).toBe(
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

  it("rejects missing or stale confirmation before mutation", async () => {
    const fixture = await createFixture();
    const app = createApp(fixture.services);
    const endpoint = `/api/threads/${fixture.sourceThreadId}/tool-invocation-experiments`;
    const threadCount = fixture.services.store.listThreads().length;
    for (const body of [
      {
        sourceRunId: fixture.sourceRunId,
        sourceCallId: fixture.sourceCallId,
      },
      {
        sourceRunId: fixture.sourceRunId,
        sourceCallId: fixture.sourceCallId,
        expectedPreviewSha256: "0".repeat(64),
      },
    ]) {
      const response = await app.request(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      expect(response.status).toBe(409);
    }
    expect(fixture.services.store.listThreads()).toHaveLength(threadCount);
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
      sourceCallId: fixture.sourceCallId,
    };
    const preview = await previewToolInvocationExperiment(
      fixture.sourceThreadId,
      request,
    );
    const frames: string[] = [];
    const result = await executeToolInvocationExperiment(
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
        sourceCallId: fixture.sourceCallId,
        status: "completed",
        experiment: expect.objectContaining({
          comparison: expect.objectContaining({ outputChanged: false }),
        }),
      }),
    );
    expect(frames.at(-2)).toBe("snapshot");
    expect(frames.at(-1)).toBe("tool_invocation_experiment_result");
  });
});

async function createFixture() {
  const root = await mkdtemp(
    path.join(tmpdir(), "napier-tool-invocation-experiment-http-"),
  );
  temporaryRoots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  await mkdir(workspaceRoot);
  await writeFile(
    path.join(workspaceRoot, "evidence.txt"),
    "HTTP tool evidence\n",
    "utf8",
  );
  const services = await createServices({
    workspaceRoot,
    dataRoot: path.join(root, "data"),
  });
  openServices.push(services);
  const original = services.store.listAgents()[0]!;
  const agent = await services.store.updateAgent(original.id, {
    enabledTools: ["read_file"],
  });
  const provider = fauxProvider({ provider: "faux-tool-experiment-http" });
  provider.setResponses([
    fauxAssistantMessage(fauxToolCall("read_file", { path: "evidence.txt" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("HTTP read complete."),
    fauxAssistantMessage('{"facts":[]}'),
  ]);
  services.models.registerProvider(provider.provider);
  const thread = await services.store.createThread({
    title: "HTTP tool invocation source",
    agentId: agent.id,
  });
  const run = await services.runtime.runPrompt({
    threadId: thread.id,
    text: "Read HTTP tool evidence.",
    model: { provider: "faux-tool-experiment-http", id: "faux-1" },
  });
  const capture = (await services.store.listEvents(thread.id)).find(
    (event) => event.type === "context.tool_invocation",
  )!;
  return {
    services,
    sourceThreadId: thread.id,
    sourceRunId: run.id,
    sourceCallId: (capture.payload as { callId: string }).callId,
  };
}

function parseSseFrames(input: string): unknown[] {
  return input
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => JSON.parse(line.slice(5).trim()) as unknown);
}
