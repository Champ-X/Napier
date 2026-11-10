import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { StreamFrame } from "@napier/contracts";
import { expect, it, vi } from "vitest";
import { createApp, createServices } from "../src/app.js";
import { processReadySandbox } from "./process-run-readiness-test-fixture.js";

it("returns complete SSE snapshots and receipts for coalesced and completed prompt retries", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "napier-prompt-http-"));
  const workspaceRoot = path.join(root, "workspace");
  await mkdir(workspaceRoot);
  const services = await createServices({
    workspaceRoot,
    dataRoot: path.join(root, "data"),
    env: {},
    sandbox: processReadySandbox("prompt-admission-http"),
  });
  const ready = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const execute = services.runtime.runPrompt.bind(services.runtime);
  const runtime = vi
    .spyOn(services.runtime, "runPrompt")
    .mockImplementation((options) =>
      execute({
        ...options,
        onRunCreated: async () => {
          ready.resolve();
          await release.promise;
        },
      }),
    );
  const activeRequests: Promise<StreamFrame[]>[] = [];
  try {
    const thread = await services.store.createThread({
      title: "Prompt admission HTTP",
      agentId: services.store.listAgents()[0]!.id,
    });
    const app = createApp(services);
    const request = async (text = "Explain the execution ledger.") => {
      const response = await app.request(`/api/threads/${thread.id}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, requestId: "prompt-http-same-intent" }),
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain(
        "text/event-stream",
      );
      expect(response.headers.get("x-napier-thread-id")).toBe(thread.id);
      expect(response.headers.get("x-napier-prompt-requested")).toBe("true");
      expect(response.headers.get("x-napier-stream-error-diagnostic")).toBe(
        "sha256",
      );
      return parseFrames(await response.text());
    };
    const first = request();
    activeRequests.push(first);
    await ready.promise;
    const duplicate = request();
    activeRequests.push(duplicate);
    await vi.waitFor(() => expect(runtime).toHaveBeenCalledTimes(2));
    expect(
      (await services.store.listEvents(thread.id)).some(
        (event) => event.type === "run.started",
      ),
    ).toBe(false);
    release.resolve();
    const [firstFrames, duplicateFrames] = await Promise.all([
      first,
      duplicate,
    ]);
    const replayFrames = await request();
    const runs = services.store.listRuns(thread.id);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.status).toBe("completed");
    for (const frames of [firstFrames, duplicateFrames, replayFrames]) {
      expect(frames.filter((frame) => frame.type === "error")).toEqual([]);
      const snapshot = frames.find((frame) => frame.type === "snapshot");
      expect(snapshot?.type).toBe("snapshot");
      if (snapshot?.type !== "snapshot")
        throw new Error("Missing durable snapshot");
      expect(snapshot.detail.runs).toMatchObject([
        { id: runs[0]!.id, status: "completed" },
      ]);
      expect(
        snapshot.detail.events.filter((event) => event.type === "run.started"),
      ).toHaveLength(1);
      expect(frames.at(-1)).toMatchObject({
        type: "done",
        threadId: thread.id,
        runId: runs[0]!.id,
        status: "completed",
        snapshotSha256: snapshot.detailSha256,
        snapshotBytes: snapshot.detailBytes,
      });
    }
    expect(firstFrames.some((frame) => frame.type === "event")).toBe(true);
    expect(duplicateFrames.map((frame) => frame.type)).toEqual([
      "snapshot",
      "done",
    ]);
    expect(replayFrames.map((frame) => frame.type)).toEqual([
      "snapshot",
      "done",
    ]);
    const conflict = await request("A different task under the same identity.");
    expect(conflict.map((frame) => frame.type)).toEqual(["error"]);
    expect(services.store.listRuns(thread.id)).toHaveLength(1);
  } finally {
    release.resolve();
    await Promise.allSettled(activeRequests);
    runtime.mockRestore();
    await services.shutdownLocalRuntime();
    await rm(root, { recursive: true, force: true });
  }
}, 30000);

function parseFrames(text: string): StreamFrame[] {
  return text
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice(6)) as StreamFrame);
}
