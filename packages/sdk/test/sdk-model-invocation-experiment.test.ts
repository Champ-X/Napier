import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import {
  createLocalAgentRuntime,
  UnsupportedSandboxAdapter,
} from "@napier/runtime";
import { afterEach, describe, expect, it } from "vitest";

import {
  previewNapierModelInvocationExperiment,
  runNapierModelInvocationExperiment,
} from "../src/model-invocation-experiments.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Napier TypeScript SDK model invocation experiments", () => {
  it("previews and executes one captured call through the shared Runtime", async () => {
    const root = await mkdtemp(
      path.join(tmpdir(), "napier-sdk-model-invocation-experiment-"),
    );
    temporaryRoots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    await mkdir(workspaceRoot);
    const services = await createLocalAgentRuntime({
      workspaceRoot,
      dataRoot: path.join(root, "data"),
      sandbox: new UnsupportedSandboxAdapter("sdk-model-experiment"),
    });
    const provider = fauxProvider({
      provider: "faux-model-experiment-sdk",
      tokensPerSecond: 100_000,
    });
    provider.setResponses([
      fauxAssistantMessage("source SDK answer"),
      fauxAssistantMessage('{"facts":[]}'),
    ]);
    services.models.registerProvider(provider.provider);
    const agent = services.store.listAgents()[0]!;
    const thread = await services.store.createThread({
      title: "SDK model invocation source",
      agentId: agent.id,
    });
    const source = await services.runtime.runPrompt({
      threadId: thread.id,
      text: "Capture one SDK provider call.",
      model: { provider: "faux-model-experiment-sdk", id: "faux-1" },
    });
    const signal = new AbortController().signal;
    const preview = await previewNapierModelInvocationExperiment(
      services,
      {
        sourceThreadId: thread.id,
        sourceRunId: source.id,
        sourceTurnIndex: 0,
      },
      signal,
    );
    expect(preview.targetExecutionMode).toBe("model_experiment_single_call");

    provider.setResponses([
      fauxAssistantMessage(
        fauxToolCall("apply_patch", {
          patch: "*** Begin Patch\n*** End Patch",
        }),
      ),
    ]);
    const eventTypes: string[] = [];
    const result = await runNapierModelInvocationExperiment(
      services,
      {
        sourceThreadId: thread.id,
        sourceRunId: source.id,
        sourceTurnIndex: 0,
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
        candidateToolCallNames: ["apply_patch"],
      }),
    );
    expect(eventTypes).toContain("model.experiment.compared");
    expect(eventTypes).not.toContain("tool.started");
    await services.shutdown();
  });
});
