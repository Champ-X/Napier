import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createLocalAgentRuntime } from "../src/local-agent-runtime.js";
import { createThreadReplayBundle } from "../src/thread-bundles.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("explicit Source continuity pin", () => {
  it("reuses a non-adjacent completed Run without another network request", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-source-pin-"));
    roots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    await mkdir(workspaceRoot);
    const request = vi.fn(async () => ({
      status: 200,
      headers: { "content-type": "text/plain" },
      body: Buffer.from("PINNED_PRIVATE_SOURCE_TEXT"),
      finalUrl: "https://example.com/pinned.txt",
      redirectCount: 0,
    }));
    const services = await createLocalAgentRuntime({
      workspaceRoot,
      dataRoot: path.join(root, "data"),
      env: {},
      webFetchHttp: { request },
    });
    try {
      const agent = services.store.listAgents()[0]!;
      const thread = await services.store.createThread({
        title: "Explicit Source continuity pin",
        agentId: agent.id,
      });
      const provider = fauxProvider({ provider: "faux-source-pin" });
      provider.setResponses([
        fauxAssistantMessage(
          fauxToolCall("web_fetch", {
            action: "fetch",
            url: "https://example.com/pinned.txt",
          }),
          { stopReason: "toolUse" },
        ),
        fauxAssistantMessage("SOURCE_RUN_COMPLETED"),
        fauxAssistantMessage('{"facts":[]}'),
        fauxAssistantMessage("SCHEDULE_RUN_COMPLETED"),
        fauxAssistantMessage('{"facts":[]}'),
        (context) => {
          expect(context.systemPrompt).toContain(
            "Private local Web Fetch Sources continue into this Run",
          );
          return fauxAssistantMessage(
            fauxToolCall("web_fetch", { action: "list" }),
            { stopReason: "toolUse" },
          );
        },
        (context) => {
          const messages = JSON.stringify(context.messages);
          const sourceId = /websource_[a-z0-9]+/u.exec(messages)?.[0];
          const contentSha256 = /[a-f0-9]{64}/u.exec(
            messages.slice(messages.lastIndexOf("Web Sources:")),
          )?.[0];
          expect(sourceId).toMatch(/^websource_/u);
          expect(contentSha256).toMatch(/^[a-f0-9]{64}$/u);
          return fauxAssistantMessage(
            fauxToolCall("web_fetch", {
              action: "read",
              sourceId: sourceId!,
              sourceContentSha256: contentSha256!,
              startLine: 1,
              endLine: 1,
            }),
            { stopReason: "toolUse" },
          );
        },
        (context) => {
          expect(JSON.stringify(context.messages)).toContain(
            "PINNED_PRIVATE_SOURCE_TEXT",
          );
          return fauxAssistantMessage("PINNED_RUN_COMPLETED");
        },
        fauxAssistantMessage('{"facts":[]}'),
      ]);
      services.models.registerProvider(provider.provider);
      const model = { provider: "faux-source-pin", id: "faux-1" };

      const sourceRun = await services.runtime.runPrompt({
        threadId: thread.id,
        text: "Fetch the source.",
        model,
      });
      const intermediateRun = await services.runtime.runPrompt({
        threadId: thread.id,
        text: "Complete an unrelated scheduled turn.",
        model,
        source: "schedule",
      });
      const pinnedRun = await services.runtime.runPrompt({
        threadId: thread.id,
        text: "Read the explicitly pinned private source.",
        model,
        sourceContinuityRunId: sourceRun.id,
      });

      expect(sourceRun.status).toBe("completed");
      expect(intermediateRun.status).toBe("completed");
      expect(pinnedRun.status).toBe("completed");
      expect(request).toHaveBeenCalledTimes(1);
      const detail = await services.store.getDetail(thread.id);
      expect(
        detail.events.find(
          (event) =>
            event.runId === pinnedRun.id && event.type === "run.started",
        )?.payload,
      ).toEqual(
        expect.objectContaining({ sourceContinuityRunId: sourceRun.id }),
      );
      expect(
        detail.events.filter(
          (event) =>
            event.runId === pinnedRun.id &&
            event.type === "context.web_fetch_sources",
        ),
      ).toHaveLength(1);
      expect(() => createThreadReplayBundle(detail)).not.toThrow();

      const tampered = structuredClone(detail);
      const started = tampered.events.find(
        (event) => event.runId === pinnedRun.id && event.type === "run.started",
      )!;
      started.payload = {
        ...(started.payload as Record<string, unknown>),
        sourceContinuityRunId: intermediateRun.id,
      };
      expect(() => createThreadReplayBundle(tampered)).toThrow(
        /(?:Pinned Source continuity Run|Source continuity pin binding) is invalid/u,
      );

      const imported = await services.store.importThreadReplayBundle(
        createThreadReplayBundle(detail),
        "Imported pinned Source continuity",
      );
      expect(
        imported.events.some(
          (event) =>
            event.type === "context.web_fetch_sources" ||
            (event.type === "run.started" &&
              Object.hasOwn(event.payload, "sourceContinuityRunId")),
        ),
      ).toBe(false);
    } finally {
      await services.shutdown();
    }
  });

  it("fails before provider use when a non-user Run requests a pin", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-source-pin-deny-"));
    roots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    await mkdir(workspaceRoot);
    const services = await createLocalAgentRuntime({
      workspaceRoot,
      dataRoot: path.join(root, "data"),
      env: {},
    });
    try {
      const agent = services.store.listAgents()[0]!;
      const thread = await services.store.createThread({
        title: "Denied Source continuity pin",
        agentId: agent.id,
      });
      const source = await services.store.createRun({
        threadId: thread.id,
        agentId: agent.id,
        source: "user",
      });
      await services.store.finishRun(source.id, "completed");
      const provider = fauxProvider({ provider: "faux-source-pin-deny" });
      services.models.registerProvider(provider.provider);

      const denied = await services.runtime.runPrompt({
        threadId: thread.id,
        text: "Do not adopt this state.",
        model: { provider: "faux-source-pin-deny", id: "faux-1" },
        source: "schedule",
        sourceContinuityRunId: source.id,
      });

      expect(denied).toEqual(
        expect.objectContaining({
          status: "failed",
          source: "schedule",
          error: "Pinned Source continuity Run is not allowed",
        }),
      );
      expect(provider.state.callCount).toBe(0);
      const runs = services.store.listRuns(thread.id);
      expect(runs.at(-1)).toEqual(
        expect.objectContaining({ status: "failed", source: "schedule" }),
      );
    } finally {
      await services.shutdown();
    }
  });
});
