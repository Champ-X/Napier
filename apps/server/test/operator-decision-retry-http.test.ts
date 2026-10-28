import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { StreamFrame } from "@napier/contracts";
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { expect, it, vi } from "vitest";
import { createApp, createServices } from "../src/app.js";

it("retries saved answers and concurrent SSE continuations without duplicate execution", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "napier-decision-http-"));
  const workspaceRoot = path.join(root, "workspace");
  await mkdir(workspaceRoot);
  const services = await createServices({
    workspaceRoot,
    dataRoot: path.join(root, "data"),
    env: {},
  });
  const release = Promise.withResolvers<void>();
  try {
    const agent = await services.store.updateAgent(
      services.store.listAgents()[0]!.id,
      {
        model: { provider: "faux-decision-http", id: "faux-1" },
        toolPolicy: "workspace",
        enabledTools: ["apply_patch"],
        enabledSubagents: [],
      },
    );
    const thread = await services.store.createThread({
      agentId: agent.id,
      title: "Retry saved answer",
    });
    const origin = await services.store.createRun({
      threadId: thread.id,
      agentId: agent.id,
    });
    const { decision } = await services.store.requestOperatorDecision({
      threadId: thread.id,
      runId: origin.id,
      header: "Output",
      question: "Which output?",
      multiSelect: false,
      options: [
        { label: "File", description: "Create a file." },
        { label: "Stop", description: "Keep paused." },
      ],
    });
    await services.store.finishRun(origin.id, "completed", {
      waitForOperatorDecisionId: decision.id,
    });
    const ready = Promise.withResolvers<void>();
    const provider = fauxProvider({ provider: "faux-decision-http" });
    provider.setResponses([
      async (context) => {
        expect(JSON.stringify(context.messages)).toContain("Keep this answer.");
        ready.resolve();
        await release.promise;
        return fauxAssistantMessage(
          fauxToolCall("apply_patch", {
            operation: "create",
            path: "answer.txt",
            expectedSha256: null,
            content: "once\n",
          }),
          { stopReason: "toolUse" },
        );
      },
      fauxAssistantMessage("Saved answer applied."),
      fauxAssistantMessage('{"facts":[]}'),
    ]);
    services.models.registerProvider(provider.provider);
    const app = createApp(services);
    const base = `/api/threads/${thread.id}/operator-decisions/${decision.id}`;
    const answer = () =>
      app.request(`${base}/answer`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          selectedOptionIds: ["option_1"],
          customText: "Keep this answer.",
        }),
      });
    const saved = await Promise.all([answer(), answer()]);
    expect(saved.map((response) => response.status)).toEqual([202, 202]);
    expect(await saved[0]!.json()).toEqual(await saved[1]!.json());
    const spy = vi.spyOn(services.kernel, "continueOperatorDecision");
    const continueRequest = async () => {
      const response = await app.request(`${base}/continue`, {
        method: "POST",
      });
      expect(response.status).toBe(200);
      return parseFrames(await response.text());
    };
    const first = continueRequest();
    await ready.promise;
    let duplicateSettled = false;
    const duplicate = continueRequest().then((frames) => {
      duplicateSettled = true;
      return frames;
    });
    await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
    expect(duplicateSettled).toBe(false);
    expect((await answer()).status).toBe(202);
    release.resolve();
    const frames = await Promise.all([first, duplicate]);
    const decisions = await services.store.listOperatorDecisions(thread.id);
    const id = decisions[0]!.continuationRunId;
    for (const stream of frames) {
      expect(stream.filter((frame) => frame.type === "error")).toEqual([]);
      expect(stream.at(-1)).toMatchObject({
        type: "done",
        runId: id,
        status: "completed",
      });
      const snapshot = stream.find((frame) => frame.type === "snapshot");
      expect(
        snapshot?.type === "snapshot" &&
          snapshot.detail.runs.find((run) => run.id === id)?.status,
      ).toBe("completed");
    }
    expect((await continueRequest()).at(-1)).toMatchObject({
      type: "done",
      runId: id,
      status: "completed",
    });
    expect(provider.state.callCount).toBe(3);
    expect(services.store.listRuns(thread.id)).toHaveLength(2);
    expect(await readFile(path.join(workspaceRoot, "answer.txt"), "utf8")).toBe(
      "once\n",
    );
    const events = await services.store.listEvents(thread.id);
    expect(
      events.filter((event) => event.type === "operator.decision.answered"),
    ).toHaveLength(1);
    expect(
      events.filter((event) => event.type === "operator.decision.continued"),
    ).toHaveLength(1);
    spy.mockRestore();
  } finally {
    release.resolve();
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
