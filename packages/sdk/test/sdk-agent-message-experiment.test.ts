import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  exportThreadReplayBundle,
  LocalStore,
  UnsupportedSandboxAdapter,
  verifyThreadReplayBundle,
} from "@napier/runtime";
import { afterEach, describe, expect, it } from "vitest";

import { createNapierClient } from "../src/index.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Napier TypeScript SDK Agent message experiments", () => {
  it("previews and re-executes an observed historical message", async () => {
    const fixture = await createFixture();
    const client = await createNapierClient({
      ...fixture,
      sandbox: new UnsupportedSandboxAdapter("sdk-agent-message-experiment"),
    });
    let sourceMessageSeq = 0;
    const source = await client.runAgent({
      prompt: "Record one SDK message checkpoint.",
      title: "SDK message experiment",
      model: { provider: "napier", id: "demo" },
      onEvent: (event) => {
        if (event.type === "message.user") sourceMessageSeq = event.seq;
      },
    });
    expect(sourceMessageSeq).toBeGreaterThan(0);

    const preview = await client.previewAgentMessageExperiment({
      sourceThreadId: source.threadId,
      sourceRunId: source.runId,
      sourceMessageSeq,
    });
    expect(preview).toEqual(
      expect.objectContaining({
        sourceThreadId: source.threadId,
        sourceRunId: source.runId,
        sourceMessageSeq,
        targetExecutionMode: "agent_experiment_read_only",
      }),
    );
    await expect(
      client.runAgentMessageExperiment({
        sourceThreadId: source.threadId,
        sourceRunId: source.runId,
        sourceMessageSeq,
        expectedPreviewSha256: "invalid",
      }),
    ).rejects.toThrow("valid expected preview hash");

    const eventTypes: string[] = [];
    const experiment = await client.runAgentMessageExperiment({
      sourceThreadId: source.threadId,
      sourceRunId: source.runId,
      sourceMessageSeq,
      expectedPreviewSha256: preview.previewSha256,
      onEvent: (event) => {
        eventTypes.push(event.type);
      },
    });
    expect(experiment).toEqual(
      expect.objectContaining({
        status: "completed",
        targetThreadId: expect.stringMatching(/^thread_/u),
        comparison: expect.objectContaining({
          target: expect.objectContaining({
            executionMode: "agent_experiment_read_only",
          }),
        }),
      }),
    );
    expect(experiment.targetThreadId).not.toBe(source.threadId);
    expect(eventTypes).toEqual(
      expect.arrayContaining([
        "agent.experiment.started",
        "message.assistant",
        "agent.experiment.compared",
      ]),
    );
    await client.close();

    const store = new LocalStore(fixture);
    await store.initialize();
    expect(
      verifyThreadReplayBundle(
        await exportThreadReplayBundle(store, experiment.targetThreadId),
      ).status,
    ).toBe("valid");
    store.close();
  });
});

async function createFixture(): Promise<{
  workspaceRoot: string;
  dataRoot: string;
}> {
  const root = await mkdtemp(
    path.join(tmpdir(), "napier-sdk-agent-message-experiment-"),
  );
  temporaryRoots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  await mkdir(workspaceRoot);
  return {
    workspaceRoot,
    dataRoot: path.join(root, "data"),
  };
}
