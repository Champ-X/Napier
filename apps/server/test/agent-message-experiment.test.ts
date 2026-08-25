import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import * as experimentProtocolValidators from "@napier/contracts";
import {
  validateAgentMessageExperimentResultFrame,
  verifyThreadReplayBundle,
  exportThreadReplayBundle,
} from "@napier/runtime";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createApp, createServices } from "../src/app.js";
import {
  executeAgentMessageExperiment,
  previewAgentMessageExperiment,
} from "../../web/src/agent-message-experiment-api.js";
import { assertExperimentProtocolRequestParity } from "../../../test/experiment-protocol-parity.js";

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

describe("Agent message experiment HTTP path", () => {
  it("keeps Server request validation aligned with the shared protocol fixture", () => {
    assertExperimentProtocolRequestParity(experimentProtocolValidators);
  });

  it("previews and streams a real read-only message re-execution", async () => {
    const fixture = await createFixture();
    const app = createApp(fixture.services);
    const request = {
      sourceRunId: fixture.sourceRunId,
      sourceMessageSeq: fixture.sourceMessageSeq,
    };
    const endpoint = `/api/threads/${fixture.sourceThreadId}/agent-experiments`;
    const previewResponse = await app.request(`${endpoint}/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
    expect(previewResponse.status).toBe(200);
    expect(previewResponse.headers.get("cache-control")).toBe("no-store");
    const preview = (await previewResponse.json()) as {
      previewSha256: string;
      targetExecutionMode: string;
    };
    expect(preview).toEqual(
      expect.objectContaining({
        previewSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        targetExecutionMode: "agent_experiment_read_only",
      }),
    );
    expect(
      previewResponse.headers.get("x-napier-agent-experiment-preview-sha256"),
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
    expect(
      response.headers.get("x-napier-agent-experiment-workspace-sha256"),
    ).toMatch(/^[a-f0-9]{64}$/u);
    const frames = parseSseFrames(await response.text());
    expect(frames.at(-2)).toEqual(
      expect.objectContaining({ type: "snapshot" }),
    );
    const result = validateAgentMessageExperimentResultFrame(frames.at(-1));
    expect(result).toEqual(
      expect.objectContaining({
        sourceThreadId: fixture.sourceThreadId,
        sourceRunId: fixture.sourceRunId,
        sourceMessageSeq: fixture.sourceMessageSeq,
        status: "completed",
        experiment: expect.objectContaining({
          comparison: expect.objectContaining({
            target: expect.objectContaining({
              executionMode: "agent_experiment_read_only",
              toolEffects: expect.objectContaining({
                writeCount: 0,
                unknownCount: 0,
                unresolvedCount: 0,
              }),
            }),
          }),
        }),
      }),
    );
    expect(result.targetThreadId).not.toBe(fixture.sourceThreadId);
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
      sourceMessageSeq: fixture.sourceMessageSeq,
    };
    const preview = await previewAgentMessageExperiment(
      fixture.sourceThreadId,
      request,
    );
    const frames: string[] = [];
    const result = await executeAgentMessageExperiment(
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
        status: "completed",
        experiment: expect.objectContaining({
          comparison: expect.objectContaining({
            target: expect.objectContaining({
              executionMode: "agent_experiment_read_only",
            }),
          }),
        }),
      }),
    );
    expect(frames.at(-2)).toBe("snapshot");
    expect(frames.at(-1)).toBe("agent_message_experiment_result");
  });

  it("reuses a frozen read result through the real Web client without live fallback", async () => {
    const fixture = await createToolFixture();
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
    await writeFile(fixture.filePath, "PRIVATE_CURRENT_HTTP_RESULT\n", "utf8");
    let candidateContext = "";
    fixture.provider.setResponses([
      fauxAssistantMessage(
        fauxToolCall("read_file", { path: "evidence.txt" }),
        { stopReason: "toolUse" },
      ),
      (context) => {
        candidateContext = JSON.stringify(context);
        return fauxAssistantMessage("HTTP candidate used frozen evidence");
      },
    ]);
    const request = {
      sourceRunId: fixture.sourceRunId,
      sourceMessageSeq: fixture.sourceMessageSeq,
      toolResultMode: "reuse_source" as const,
    };
    const preview = await previewAgentMessageExperiment(
      fixture.sourceThreadId,
      request,
    );
    expect(preview).toEqual(
      expect.objectContaining({
        toolResultMode: "reuse_source",
        sourceReusableToolResultCount: 1,
      }),
    );
    const result = await executeAgentMessageExperiment(
      fixture.sourceThreadId,
      {
        ...request,
        expectedPreviewSha256: preview.previewSha256,
      },
      preview,
    );
    expect(result.experiment).toEqual(
      expect.objectContaining({
        status: "completed",
        toolResultReuse: expect.objectContaining({
          mode: "reuse_source",
          reusedResultCount: 1,
          divergenceCount: 0,
          complete: true,
        }),
      }),
    );
    expect(candidateContext).toContain("PRIVATE_SOURCE_HTTP_RESULT");
    expect(candidateContext).not.toContain("PRIVATE_CURRENT_HTTP_RESULT");
    const targetEvents = await fixture.services.store.listEvents(
      result.targetThreadId,
    );
    expect(
      targetEvents.filter((event) => event.type === "tool.result_reused"),
    ).toHaveLength(1);
    expect(JSON.stringify(targetEvents)).not.toContain(
      "PRIVATE_SOURCE_HTTP_RESULT",
    );
    expect(JSON.stringify(targetEvents)).not.toContain(
      "PRIVATE_CURRENT_HTTP_RESULT",
    );
    const bundle = await exportThreadReplayBundle(
      fixture.services.store,
      result.targetThreadId,
    );
    expect(verifyThreadReplayBundle(bundle).status).toBe("valid");
    expect(JSON.stringify(bundle)).not.toContain("PRIVATE_SOURCE_HTTP_RESULT");
  });

  it("rejects missing and stale preview bindings without creating a Branch", async () => {
    const fixture = await createFixture();
    const app = createApp(fixture.services);
    const request = {
      sourceRunId: fixture.sourceRunId,
      sourceMessageSeq: fixture.sourceMessageSeq,
    };
    const endpoint = `/api/threads/${fixture.sourceThreadId}/agent-experiments`;
    const initialThreadCount = fixture.services.store.listThreads().length;
    const missing = await app.request(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
    expect(missing.status).toBe(409);
    expect(fixture.services.store.listThreads()).toHaveLength(
      initialThreadCount,
    );

    const previewResponse = await app.request(`${endpoint}/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
    const preview = (await previewResponse.json()) as {
      previewSha256: string;
    };
    await writeFile(
      path.join(fixture.workspaceRoot, "drift.txt"),
      "workspace changed\n",
    );
    const stale = await app.request(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...request,
        expectedPreviewSha256: preview.previewSha256,
      }),
    });
    expect(stale.status).toBe(409);
    expect(fixture.services.store.listThreads()).toHaveLength(
      initialThreadCount,
    );
  });
});

async function createFixture() {
  const root = await mkdtemp(
    path.join(tmpdir(), "napier-agent-message-experiment-http-"),
  );
  temporaryRoots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  await mkdir(workspaceRoot);
  const services = await createServices({
    workspaceRoot,
    dataRoot: path.join(root, "data"),
  });
  openServices.push(services);
  const agent = services.store.listAgents()[0]!;
  const thread = await services.store.createThread({
    title: "HTTP Agent experiment source",
    agentId: agent.id,
  });
  const run = await services.runtime.runPrompt({
    threadId: thread.id,
    text: "Record a stable HTTP experiment source.",
    model: { provider: "napier", id: "demo" },
  });
  const message = (await services.store.listEvents(thread.id)).find(
    (event) => event.runId === run.id && event.type === "message.user",
  )!;
  return {
    services,
    workspaceRoot,
    sourceThreadId: thread.id,
    sourceRunId: run.id,
    sourceMessageSeq: message.seq,
  };
}

async function createToolFixture() {
  const root = await mkdtemp(
    path.join(tmpdir(), "napier-agent-tool-result-http-"),
  );
  temporaryRoots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  await mkdir(workspaceRoot);
  const filePath = path.join(workspaceRoot, "evidence.txt");
  await writeFile(filePath, "PRIVATE_SOURCE_HTTP_RESULT\n", "utf8");
  const services = await createServices({
    workspaceRoot,
    dataRoot: path.join(root, "data"),
  });
  openServices.push(services);
  const original = services.store.listAgents()[0]!;
  const agent = await services.store.updateAgent(original.id, {
    toolPolicy: "workspace",
    enabledTools: ["read_file"],
  });
  const providerId = "faux-http-tool-result-reuse";
  const provider = fauxProvider({ provider: providerId });
  provider.setResponses([
    fauxAssistantMessage(fauxToolCall("read_file", { path: "evidence.txt" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("HTTP source completed"),
  ]);
  services.models.registerProvider(provider.provider);
  const thread = await services.store.createThread({
    title: "HTTP frozen tool result source",
    agentId: agent.id,
  });
  const run = await services.runtime.runPrompt({
    threadId: thread.id,
    text: "Read HTTP evidence.",
    model: { provider: providerId, id: "faux-1" },
  });
  const message = (await services.store.listEvents(thread.id)).find(
    (event) => event.runId === run.id && event.type === "message.user",
  )!;
  return {
    services,
    provider,
    workspaceRoot,
    filePath,
    sourceThreadId: thread.id,
    sourceRunId: run.id,
    sourceMessageSeq: message.seq,
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
