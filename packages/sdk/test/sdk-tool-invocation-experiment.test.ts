import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { createLocalAgentRuntime } from "@napier/runtime";
import { afterEach, describe, expect, it } from "vitest";

import {
  previewNapierToolInvocationExperiment,
  runNapierToolInvocationExperiment,
} from "../src/tool-invocation-experiments.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Napier TypeScript SDK tool invocation experiments", () => {
  it("previews and executes one captured read-only call", async () => {
    const root = await mkdtemp(
      path.join(tmpdir(), "napier-sdk-tool-invocation-experiment-"),
    );
    temporaryRoots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    await mkdir(workspaceRoot);
    await writeFile(
      path.join(workspaceRoot, "evidence.txt"),
      "SDK tool evidence\n",
      "utf8",
    );
    const services = await createLocalAgentRuntime({
      workspaceRoot,
      dataRoot: path.join(root, "data"),
    });
    const original = services.store.listAgents()[0]!;
    const agent = await services.store.updateAgent(original.id, {
      enabledTools: ["read_file"],
    });
    const provider = fauxProvider({ provider: "faux-tool-experiment-sdk" });
    provider.setResponses([
      fauxAssistantMessage(
        fauxToolCall("read_file", { path: "evidence.txt" }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("SDK read complete."),
      fauxAssistantMessage('{"facts":[]}'),
    ]);
    services.models.registerProvider(provider.provider);
    const thread = await services.store.createThread({
      title: "SDK tool invocation source",
      agentId: agent.id,
    });
    const source = await services.runtime.runPrompt({
      threadId: thread.id,
      text: "Read SDK tool evidence.",
      model: { provider: "faux-tool-experiment-sdk", id: "faux-1" },
    });
    const capture = (await services.store.listEvents(thread.id)).find(
      (event) => event.type === "context.tool_invocation",
    )!;
    const sourceCallId = (capture.payload as { callId: string }).callId;
    const signal = new AbortController().signal;
    const preview = await previewNapierToolInvocationExperiment(
      services,
      {
        sourceThreadId: thread.id,
        sourceRunId: source.id,
        sourceCallId,
      },
      signal,
    );
    expect(preview.targetExecutionMode).toBe("tool_experiment_read_only");

    const eventTypes: string[] = [];
    const result = await runNapierToolInvocationExperiment(
      services,
      {
        sourceThreadId: thread.id,
        sourceRunId: source.id,
        sourceCallId,
        expectedPreviewSha256: preview.previewSha256,
        onEvent: (event) => {
          eventTypes.push(event.type);
        },
      },
      signal,
    );
    expect(result).toEqual(
      expect.objectContaining({
        status: "completed",
        candidateOutput: expect.stringContaining("SDK tool evidence"),
        comparison: expect.objectContaining({ outputChanged: false }),
      }),
    );
    expect(eventTypes).toContain("tool.experiment.compared");
    expect(eventTypes).not.toContain("model.response");
    await services.shutdown();
  });
});
