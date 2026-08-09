import {
  chmod,
  mkdir,
  readFile,
  readdir,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";

import {
  createToolInvocationCapsule,
  createLocalAgentRuntime,
  exportThreadReplayBundle,
  MAX_TOOL_INVOCATION_CAPSULES,
  sha256,
  ToolInvocationCapsuleStore,
  ToolInvocationExperimentPreviewChangedError,
  validateToolInvocationExperimentResult,
  type LocalAgentRuntimeServices,
} from "../src/index.js";

const roots: string[] = [];
const openServices: LocalAgentRuntimeServices[] = [];

afterEach(async () => {
  for (const services of openServices.splice(0)) {
    await services.shutdown();
  }
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("tool invocation experiments", () => {
  it("re-executes one exact read-only call and compares real output", async () => {
    const fixture = await createReadFileFixture();
    const preview = await fixture.services.toolInvocationExperiments.preview(
      fixture.threadId,
      {
        sourceRunId: fixture.runId,
        sourceCallId: fixture.callId,
      },
    );

    expect(preview).toEqual(
      expect.objectContaining({
        sourceRunId: fixture.runId,
        sourceCallId: fixture.callId,
        sourceToolName: "read_file",
        sourceEffect: "read",
        candidateWorkspaceFileCount: 1,
        targetExecutionMode: "tool_experiment_read_only",
        previewSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );

    const [result, concurrent] = await Promise.all([
      fixture.services.toolInvocationExperiments.run({
        sourceThreadId: fixture.threadId,
        request: {
          sourceRunId: fixture.runId,
          sourceCallId: fixture.callId,
          expectedPreviewSha256: preview.previewSha256,
        },
      }),
      fixture.services.toolInvocationExperiments.run({
        sourceThreadId: fixture.threadId,
        request: {
          sourceRunId: fixture.runId,
          sourceCallId: fixture.callId,
          expectedPreviewSha256: preview.previewSha256,
        },
      }),
    ]);

    expect(result).toEqual(
      expect.objectContaining({
        status: "completed",
        candidateOutput: expect.stringContaining("stable evidence"),
        comparison: expect.objectContaining({
          outputChanged: false,
          source: expect.objectContaining({ status: "completed" }),
          target: expect.objectContaining({ status: "completed" }),
        }),
      }),
    );
    expect(concurrent).toEqual(
      expect.objectContaining({
        status: "completed",
      }),
    );
    expect(concurrent.targetThreadId).not.toBe(result.targetThreadId);
    const tampered = structuredClone(result);
    tampered.comparison.outputChanged = true;
    expect(() => validateToolInvocationExperimentResult(tampered)).toThrow(
      "comparison is invalid",
    );
    expect(fixture.provider.state.callCount).toBe(3);
    const targetEvents = await fixture.services.store.listEvents(
      result.targetThreadId,
    );
    expect(targetEvents.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        "tool.experiment.started",
        "tool.started",
        "tool.completed",
        "tool.experiment.compared",
        "run.completed",
      ]),
    );
    expect(targetEvents.map((event) => event.type)).not.toContain(
      "model.response",
    );
    expect(
      targetEvents.filter((event) => event.type === "tool.started"),
    ).toHaveLength(1);
  });

  it("rejects drift before mutation and settles failure and cancellation", async () => {
    const fixture = await createReadFileFixture();
    const experiments = fixture.services.toolInvocationExperiments;
    const request = {
      sourceRunId: fixture.runId,
      sourceCallId: fixture.callId,
    };
    const preview = await experiments.preview(fixture.threadId, request);
    const threadCount = fixture.services.store.listThreads().length;
    await writeFile(fixture.filePath, "changed evidence\n", "utf8");

    await expect(
      experiments.run({
        sourceThreadId: fixture.threadId,
        request: {
          ...request,
          expectedPreviewSha256: preview.previewSha256,
        },
      }),
    ).rejects.toBeInstanceOf(ToolInvocationExperimentPreviewChangedError);
    expect(fixture.services.store.listThreads()).toHaveLength(threadCount);

    const changedPreview = await experiments.preview(fixture.threadId, request);
    const failed = await experiments.run({
      sourceThreadId: fixture.threadId,
      request: {
        ...request,
        expectedPreviewSha256: changedPreview.previewSha256,
      },
      onTargetCreated: async () => {
        await unlink(fixture.filePath);
      },
    });
    expect(failed.status).toBe("failed");
    expect(
      (await fixture.services.store.listEvents(failed.targetThreadId)).map(
        (event) => event.type,
      ),
    ).toEqual(expect.arrayContaining(["tool.failed", "run.failed"]));

    await writeFile(fixture.filePath, "restored evidence\n", "utf8");
    const restoredPreview = await experiments.preview(
      fixture.threadId,
      request,
    );
    const preAborted = new AbortController();
    preAborted.abort();
    const beforePreAbort = fixture.services.store.listThreads().length;
    await expect(
      experiments.run({
        sourceThreadId: fixture.threadId,
        request: {
          ...request,
          expectedPreviewSha256: restoredPreview.previewSha256,
        },
        signal: preAborted.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(fixture.services.store.listThreads()).toHaveLength(beforePreAbort);

    const controller = new AbortController();
    const cancelled = await experiments.run({
      sourceThreadId: fixture.threadId,
      request: {
        ...request,
        expectedPreviewSha256: restoredPreview.previewSha256,
      },
      signal: controller.signal,
      onTargetCreated: () => controller.abort(),
    });
    expect(cancelled.status).toBe("cancelled");
    const cancelledEvents = await fixture.services.store.listEvents(
      cancelled.targetThreadId,
    );
    expect(cancelledEvents.map((event) => event.type)).toContain(
      "run.cancelled",
    );
    expect(cancelledEvents.map((event) => event.type)).not.toContain(
      "tool.started",
    );
  });

  it("rejects exposed local capsule permissions", async () => {
    const fixture = await createReadFileFixture();
    const receipt = fixture.capture.payload as {
      capsuleSha256: string;
    };
    const capsulePath = path.join(
      fixture.services.runtime.toolInvocationCapsules.rootPath,
      `${receipt.capsuleSha256}.json`,
    );
    await chmod(capsulePath, 0o644);

    await expect(
      fixture.services.toolInvocationExperiments.preview(fixture.threadId, {
        sourceRunId: fixture.runId,
        sourceCallId: fixture.callId,
      }),
    ).rejects.toThrow("capsule file is invalid");
  });

  it("rejects write tools and direct restricted Run creation", async () => {
    const fixture = await createReadFileFixture();
    expect(() =>
      createToolInvocationCapsule({
        sourceThreadId: fixture.threadId,
        sourceRunId: fixture.runId,
        callId: "call_write",
        toolName: "apply_patch",
        toolDefinitionSha256: "0".repeat(64),
        arguments: {
          operation: "create",
          path: "unsafe.txt",
          expectedSha256: null,
          content: "not executed",
        },
      }),
    ).toThrow("not eligible");
    const agent = fixture.services.store.getAgent(
      fixture.services.store.getThread(fixture.threadId).agentId,
    );
    await expect(
      fixture.services.store.createRun({
        threadId: fixture.threadId,
        agentId: agent.id,
        agentRevision: agent.revision,
        source: "tool_experiment",
        executionMode: "tool_experiment_read_only",
      }),
    ).rejects.toThrow("verified read-only capability");
  });

  it("keeps exact SQLite arguments local while returning deliberate output", async () => {
    const root = path.join(
      tmpdir(),
      `napier-tool-privacy-${String(Date.now())}-${Math.random().toString(16).slice(2)}`,
    );
    roots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    await mkdir(workspaceRoot, { recursive: true });
    const databasePath = path.join(workspaceRoot, "private.sqlite");
    const database = new DatabaseSync(databasePath);
    database.exec(
      "CREATE TABLE records (lookup_key TEXT PRIMARY KEY, secret_value TEXT NOT NULL)",
    );
    const secretParameter = "private-key-17";
    const secretValue = "sensitive-cell-41";
    database
      .prepare("INSERT INTO records VALUES (?, ?)")
      .run(secretParameter, secretValue);
    database.close();
    const databaseSha256 = sha256(await readFile(databasePath));
    const services = await createLocalAgentRuntime({
      workspaceRoot,
      dataRoot: path.join(root, "data"),
    });
    openServices.push(services);
    const original = services.store.listAgents()[0]!;
    const agent = await services.store.updateAgent(original.id, {
      enabledTools: ["sqlite_query"],
    });
    const thread = await services.store.createThread({
      title: "Private tool invocation source",
      agentId: agent.id,
    });
    const sql =
      "SELECT secret_value FROM records WHERE lookup_key = ? ORDER BY secret_value";
    const provider = fauxProvider({ provider: "faux-tool-privacy" });
    provider.setResponses([
      fauxAssistantMessage(
        fauxToolCall("sqlite_query", {
          action: "query",
          path: "private.sqlite",
          databaseSha256,
          sql,
          params: [secretParameter],
          maxRows: 5,
        }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("Private query complete."),
      fauxAssistantMessage('{"facts":[]}'),
    ]);
    services.models.registerProvider(provider.provider);
    const source = await services.runtime.runPrompt({
      threadId: thread.id,
      text: "Run the prepared private database query.",
      model: { provider: "faux-tool-privacy", id: "faux-1" },
    });
    const sourceEvents = await services.store.listEvents(thread.id);
    const capture = sourceEvents.find(
      (event) => event.type === "context.tool_invocation",
    )!;
    const receipt = capture.payload as {
      callId: string;
      capsuleSha256: string;
    };
    const durableSource = JSON.stringify(sourceEvents);
    expect(durableSource).not.toContain(sql);
    expect(durableSource).not.toContain(secretParameter);
    expect(durableSource).not.toContain(secretValue);

    const preview = await services.toolInvocationExperiments.preview(
      thread.id,
      {
        sourceRunId: source.id,
        sourceCallId: receipt.callId,
      },
    );
    const result = await services.toolInvocationExperiments.run({
      sourceThreadId: thread.id,
      request: {
        sourceRunId: source.id,
        sourceCallId: receipt.callId,
        expectedPreviewSha256: preview.previewSha256,
      },
    });
    expect(result.candidateOutput).toContain(secretValue);
    expect(result.comparison.outputChanged).toBe(false);
    const targetEvents = await services.store.listEvents(result.targetThreadId);
    const durableTarget = JSON.stringify(targetEvents);
    expect(durableTarget).not.toContain(sql);
    expect(durableTarget).not.toContain(secretParameter);
    expect(durableTarget).not.toContain(secretValue);
    expect(
      JSON.stringify(
        await exportThreadReplayBundle(services.store, result.targetThreadId),
      ),
    ).not.toContain(secretValue);
    const cancelController = new AbortController();
    let activeToolStarted = false;
    const cancelled = await services.toolInvocationExperiments.run({
      sourceThreadId: thread.id,
      request: {
        sourceRunId: source.id,
        sourceCallId: receipt.callId,
        expectedPreviewSha256: preview.previewSha256,
      },
      signal: cancelController.signal,
      onEvent: (event) => {
        if (event.type !== "tool.started") return;
        activeToolStarted = true;
        cancelController.abort();
      },
    });
    expect(activeToolStarted).toBe(true);
    expect(cancelled.status).toBe("cancelled");
    expect(
      (await services.store.listEvents(cancelled.targetThreadId)).map(
        (event) => event.type,
      ),
    ).toEqual(expect.arrayContaining(["tool.failed", "run.cancelled"]));
    const capsule = await readFile(
      path.join(
        services.runtime.toolInvocationCapsules.rootPath,
        `${receipt.capsuleSha256}.json`,
      ),
      "utf8",
    );
    expect(capsule).toContain(sql);
    expect(capsule).toContain(secretParameter);
  });

  it(
    "keeps concurrent private capture within its hard object bound",
    async () => {
      const fixtureObjectLimit = 32;
      expect(MAX_TOOL_INVOCATION_CAPSULES).toBe(512);
      const root = path.join(
        tmpdir(),
        `napier-tool-capacity-${String(Date.now())}-${Math.random().toString(16).slice(2)}`,
      );
      roots.push(root);
      const capsules = new ToolInvocationCapsuleStore(
        path.join(root, "data"),
        fixtureObjectLimit,
      );
      const outcomes = await Promise.allSettled(
        Array.from({ length: fixtureObjectLimit + 16 }, (_, index) =>
          capsules.put({
            sourceThreadId: "thread_capacity",
            sourceRunId: "run_capacity",
            callId: `call_${String(index)}`,
            toolName: "read_file",
            toolDefinitionSha256: "a".repeat(64),
            arguments: { path: `file-${String(index)}.txt` },
          }),
        ),
      );
      const entries = await readdir(capsules.rootPath);
      expect(entries).toHaveLength(fixtureObjectLimit);
      expect(
        outcomes.filter((outcome) => outcome.status === "rejected").length,
      ).toBeGreaterThan(0);
    },
    15_000,
  );
});

async function createReadFileFixture(): Promise<{
  services: LocalAgentRuntimeServices;
  provider: ReturnType<typeof fauxProvider>;
  threadId: string;
  runId: string;
  callId: string;
  capture: Awaited<
    ReturnType<LocalAgentRuntimeServices["store"]["listEvents"]>
  >[number];
  filePath: string;
}> {
  const root = path.join(
    tmpdir(),
    `napier-tool-experiment-${String(Date.now())}-${Math.random().toString(16).slice(2)}`,
  );
  roots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  await mkdir(workspaceRoot, { recursive: true });
  const filePath = path.join(workspaceRoot, "evidence.txt");
  await writeFile(filePath, "stable evidence\n", "utf8");
  const services = await createLocalAgentRuntime({
    workspaceRoot,
    dataRoot: path.join(root, "data"),
  });
  openServices.push(services);
  const original = services.store.listAgents()[0]!;
  const agent = await services.store.updateAgent(original.id, {
    enabledTools: ["read_file"],
  });
  const thread = await services.store.createThread({
    title: "Tool invocation source",
    agentId: agent.id,
  });
  const provider = fauxProvider({
    provider: "faux-tool-experiment",
    tokensPerSecond: 100_000,
  });
  provider.setResponses([
    fauxAssistantMessage(fauxToolCall("read_file", { path: "evidence.txt" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("The evidence is stable."),
    fauxAssistantMessage('{"facts":[]}'),
  ]);
  services.models.registerProvider(provider.provider);
  const run = await services.runtime.runPrompt({
    threadId: thread.id,
    text: "Read the evidence file.",
    model: { provider: "faux-tool-experiment", id: "faux-1" },
  });
  const events = await services.store.listEvents(thread.id);
  const capture = events.find(
    (event) =>
      event.runId === run.id && event.type === "context.tool_invocation",
  )!;
  const callId = (capture.payload as { callId: string }).callId;
  expect(events).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: "tool.completed",
        payload: expect.objectContaining({
          callId,
          outputTextSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        }),
      }),
    ]),
  );
  return {
    services,
    provider,
    threadId: thread.id,
    runId: run.id,
    callId,
    capture,
    filePath,
  };
}
