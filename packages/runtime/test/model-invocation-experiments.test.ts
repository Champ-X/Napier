import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
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
import type { RunRecord } from "@napier/contracts";
import { afterEach, describe, expect, it } from "vitest";

import { AgentRuntime } from "../src/agent-runtime.js";
import { canonicalJson, sha256 } from "../src/ed25519.js";
import { MAX_MODEL_INVOCATION_CAPSULES } from "../src/model-invocation-capsule-store.js";
import { createModelContextEnvelopeReceipt } from "../src/model-context-envelope.js";
import { exportThreadReplayBundle } from "../src/replay.js";
import { validateModelInvocationExperimentResult } from "../src/model-invocation-experiment-protocol.js";
import { ModelInvocationExperimentRuntime } from "../src/model-invocation-experiments.js";
import { ModelRegistry } from "../src/models.js";
import { LocalStore } from "../src/store.js";
import { verifyThreadReplayBundle } from "../src/thread-bundles.js";

const temporaryRoots: string[] = [];
const openStores: LocalStore[] = [];

afterEach(async () => {
  for (const store of openStores.splice(0)) store.close();
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Model invocation checkpoint experiments", () => {
  it("replays one exact provider context without executing returned tools", async () => {
    const fixture = await createFixture();
    const database = new DatabaseSync(
      path.join(fixture.workspaceRoot, "evidence.db"),
    );
    database.exec(
      "CREATE TABLE evidence (value TEXT NOT NULL); INSERT INTO evidence VALUES ('PRIVATE_TOOL_RESULT_FOR_LOCAL_CAPSULE');",
    );
    database.close();
    let databaseSha256 = "";
    fixture.provider.setResponses([
      fauxAssistantMessage(
        fauxToolCall("sqlite_query", {
          action: "schema",
          path: "evidence.db",
        }),
      ),
      (context) => {
        databaseSha256 =
          /Database SHA-256: ([a-f0-9]{64})/u.exec(
            JSON.stringify(context.messages),
          )?.[1] ?? "";
        return fauxAssistantMessage(
          fauxToolCall("sqlite_query", {
            action: "query",
            path: "evidence.db",
            databaseSha256,
            sql: "SELECT value FROM evidence",
            maxRows: 5,
          }),
        );
      },
      fauxAssistantMessage("source answer"),
      fauxAssistantMessage('{"facts":[]}'),
    ]);
    const source = await fixture.runtime.runPrompt({
      threadId: fixture.sourceThreadId,
      text: "Read the evidence and summarize it.",
      model: fixture.model,
    });
    expect(source.status).toBe("completed");
    const sourceEvents = await fixture.store.listEvents(fixture.sourceThreadId);
    expect(
      sourceEvents
        .filter((event) => event.type === "context.model_invocation")
        .map((event) => event.payload["turnIndex"]),
    ).toEqual([0, 1, 2, 3]);
    const capsuleReceipt = sourceEvents.find(
      (event) =>
        event.type === "context.model_invocation" &&
        event.payload["turnIndex"] === 2,
    )!;
    const capsuleSha256 = String(capsuleReceipt.payload["capsuleSha256"]);
    const capsulePath = path.join(
      fixture.runtime.modelInvocationCapsules.rootPath,
      `${capsuleSha256}.json`,
    );
    expect((await stat(capsulePath)).mode & 0o777).toBe(0o600);
    expect(await readFile(capsulePath, "utf8")).toContain(
      "PRIVATE_TOOL_RESULT_FOR_LOCAL_CAPSULE",
    );
    expect(
      JSON.stringify(
        await exportThreadReplayBundle(fixture.store, fixture.sourceThreadId),
      ),
    ).not.toContain("PRIVATE_TOOL_RESULT_FOR_LOCAL_CAPSULE");

    let replayedContext = "";
    fixture.provider.setResponses([
      (context) => {
        replayedContext = JSON.stringify(context);
        return fauxAssistantMessage([
          fauxToolCall("apply_patch", {
            patch: "*** Begin Patch\n*** End Patch",
          }),
          fauxToolCall("third_party_secret_tool", {
            token: "PRIVATE_CANDIDATE_TOOL_ARGUMENT",
          }),
        ]);
      },
    ]);
    const request = { sourceRunId: source.id, sourceTurnIndex: 2 };
    const preview = await fixture.experiments.preview(
      fixture.sourceThreadId,
      request,
    );
    const result = await fixture.experiments.run({
      sourceThreadId: fixture.sourceThreadId,
      request: {
        ...request,
        expectedPreviewSha256: preview.previewSha256,
      },
    });

    expect(replayedContext).toContain("PRIVATE_TOOL_RESULT_FOR_LOCAL_CAPSULE");
    expect(preview).toEqual(
      expect.objectContaining({
        sourceRunId: source.id,
        sourceTurnIndex: 2,
        purpose: "agent_turn",
        sourceMessageCount: 5,
        targetExecutionMode: "model_experiment_single_call",
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        status: "completed",
        candidateToolCallNames: ["apply_patch", "third_party_secret_tool"],
        comparison: expect.objectContaining({
          outputChanged: true,
          target: expect.objectContaining({
            toolNames: ["apply_patch", "third_party_secret_tool"],
          }),
        }),
      }),
    );
    const targetEvents = await fixture.store.listEvents(result.targetThreadId);
    expect(targetEvents.some((event) => event.type === "tool.started")).toBe(
      false,
    );
    expect(targetEvents.some((event) => event.type === "tool.completed")).toBe(
      false,
    );
    expect(JSON.stringify(targetEvents)).not.toContain(
      "PRIVATE_TOOL_RESULT_FOR_LOCAL_CAPSULE",
    );
    expect(JSON.stringify(targetEvents)).not.toContain("*** Begin Patch");
    expect(JSON.stringify(targetEvents)).not.toContain(
      "PRIVATE_CANDIDATE_TOOL_ARGUMENT",
    );
    expect(validateModelInvocationExperimentResult(result)).toEqual(result);
    const drifted = structuredClone(result);
    drifted.comparison.metricDelta.durationMs += 1;
    const comparisonContent = { ...drifted.comparison };
    delete (comparisonContent as { contentSha256?: string }).contentSha256;
    drifted.comparison.contentSha256 = sha256(canonicalJson(comparisonContent));
    expect(() => validateModelInvocationExperimentResult(drifted)).toThrow(
      "comparison is invalid",
    );
    const modelDrift = structuredClone(result);
    modelDrift.comparison.source.model = {
      provider: "other-provider",
      id: "other-model",
    };
    const modelDriftContent = { ...modelDrift.comparison };
    delete (modelDriftContent as { contentSha256?: string }).contentSha256;
    modelDrift.comparison.contentSha256 = sha256(
      canonicalJson(modelDriftContent),
    );
    expect(() => validateModelInvocationExperimentResult(modelDrift)).toThrow(
      "result is invalid",
    );
    const statusDrift = structuredClone(result);
    statusDrift.comparison.source.stopReason = "error";
    const statusDriftContent = { ...statusDrift.comparison };
    delete (statusDriftContent as { contentSha256?: string }).contentSha256;
    statusDrift.comparison.contentSha256 = sha256(
      canonicalJson(statusDriftContent),
    );
    expect(() => validateModelInvocationExperimentResult(statusDrift)).toThrow(
      "observation is invalid",
    );
    expect(fixture.store.listRuns(result.targetThreadId)[0]).toEqual(
      expect.objectContaining({
        source: "model_experiment",
        configuration: expect.objectContaining({
          executionMode: "model_experiment_single_call",
          enabledTools: [],
          enabledSkills: [],
          enabledSubagents: [],
        }),
      }),
    );
    const targetReplay = await exportThreadReplayBundle(
      fixture.store,
      result.targetThreadId,
    );
    expect(JSON.stringify(targetReplay)).not.toContain(
      "PRIVATE_CANDIDATE_TOOL_ARGUMENT",
    );
    expect(verifyThreadReplayBundle(targetReplay).status).toBe("valid");
  });

  it("fails forged mode and capsule tampering closed before target mutation", async () => {
    const fixture = await createFixture();
    const source = await sourceRun(fixture);
    const request = { sourceRunId: source.id, sourceTurnIndex: 0 };
    const preview = await fixture.experiments.preview(
      fixture.sourceThreadId,
      request,
    );
    const forged = await fixture.store.createThread({
      title: "Forged model experiment",
      agentId: fixture.agentId,
    });
    await expect(
      fixture.store.createRun({
        threadId: forged.id,
        agentId: fixture.agentId,
        agentRevision: source.agentRevision,
        model: fixture.model,
        source: "model_experiment",
        executionMode: "model_experiment_single_call",
      }),
    ).rejects.toThrow("single-call capability");

    const sourceEvents = await fixture.store.listEvents(fixture.sourceThreadId);
    const receipt = sourceEvents.find(
      (event) =>
        event.type === "context.model_invocation" &&
        event.payload["turnIndex"] === 0,
    )!;
    const capsulePath = path.join(
      fixture.runtime.modelInvocationCapsules.rootPath,
      `${String(receipt.payload["capsuleSha256"])}.json`,
    );
    await writeFile(capsulePath, '{"tampered":true}', "utf8");
    const threadCount = fixture.store.listThreads().length;
    await expect(
      fixture.experiments.run({
        sourceThreadId: fixture.sourceThreadId,
        request: {
          ...request,
          expectedPreviewSha256: preview.previewSha256,
        },
      }),
    ).rejects.toThrow();
    expect(fixture.store.listThreads()).toHaveLength(threadCount);
  });

  it("keeps the local capsule count bounded under concurrent capture", async () => {
    const fixture = await createFixture();
    const results = await Promise.allSettled(
      Array.from(
        { length: MAX_MODEL_INVOCATION_CAPSULES + 8 },
        async (_, turnIndex) => {
          const context = {
            messages: [
              {
                role: "user" as const,
                content: `Concurrent capsule ${String(turnIndex)}`,
                timestamp: turnIndex,
              },
            ],
          };
          const envelope = createModelContextEnvelopeReceipt({
            turnIndex,
            systemPrompt: "",
            messages: context.messages,
            tools: [],
          });
          return fixture.runtime.modelInvocationCapsules.put({
            sourceThreadId: fixture.sourceThreadId,
            sourceRunId: "run_capacitytest",
            turnIndex,
            purpose: "agent_turn",
            model: fixture.model,
            contextEnvelopeSha256: envelope.contentSha256,
            context,
          });
        },
      ),
    );
    const entries = await readdir(
      fixture.runtime.modelInvocationCapsules.rootPath,
    );
    const capsuleFiles = entries.filter((name) =>
      /^[a-f0-9]{64}\.json$/u.test(name),
    );
    expect(capsuleFiles.length).toBeLessThanOrEqual(
      MAX_MODEL_INVOCATION_CAPSULES,
    );
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(capsuleFiles.length);
    expect(results.some((result) => result.status === "rejected")).toBe(true);
    expect(entries).toEqual(capsuleFiles);
  });

  it("keeps pre-abort mutation-free and settles active cancellation", async () => {
    const fixture = await createFixture();
    const source = await sourceRun(fixture);
    const request = { sourceRunId: source.id, sourceTurnIndex: 0 };
    const preview = await fixture.experiments.preview(
      fixture.sourceThreadId,
      request,
    );
    const preAborted = new AbortController();
    preAborted.abort();
    const threadCount = fixture.store.listThreads().length;
    await expect(
      fixture.experiments.run({
        sourceThreadId: fixture.sourceThreadId,
        request: {
          ...request,
          expectedPreviewSha256: preview.previewSha256,
        },
        signal: preAborted.signal,
      }),
    ).rejects.toThrow("aborted");
    expect(fixture.store.listThreads()).toHaveLength(threadCount);

    fixture.provider.setResponses([
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 500));
        return fauxAssistantMessage("late candidate");
      },
    ]);
    const controller = new AbortController();
    const cancelled = await fixture.experiments.run({
      sourceThreadId: fixture.sourceThreadId,
      request: {
        ...request,
        expectedPreviewSha256: preview.previewSha256,
      },
      signal: controller.signal,
      onEvent: (event) => {
        if (event.type === "model.experiment.started") controller.abort();
      },
    });
    expect(cancelled.status).toBe("cancelled");
    expect(fixture.store.listRuns(cancelled.targetThreadId)[0]?.status).toBe(
      "cancelled",
    );
  });

  it("preserves failed candidates and isolates concurrent targets", async () => {
    const fixture = await createFixture();
    const source = await sourceRun(fixture);
    const request = { sourceRunId: source.id, sourceTurnIndex: 0 };
    const preview = await fixture.experiments.preview(
      fixture.sourceThreadId,
      request,
    );
    fixture.provider.setResponses([
      fauxAssistantMessage("", {
        stopReason: "error",
        errorMessage: "candidate failed",
      }),
    ]);
    const failed = await fixture.experiments.run({
      sourceThreadId: fixture.sourceThreadId,
      request: {
        ...request,
        expectedPreviewSha256: preview.previewSha256,
      },
    });
    expect(failed.status).toBe("failed");
    expect(failed.comparison.target.status).toBe("failed");

    fixture.provider.setResponses([
      fauxAssistantMessage("candidate one"),
      fauxAssistantMessage("candidate two"),
    ]);
    const [left, right] = await Promise.all([
      fixture.experiments.run({
        sourceThreadId: fixture.sourceThreadId,
        request: {
          ...request,
          expectedPreviewSha256: preview.previewSha256,
        },
      }),
      fixture.experiments.run({
        sourceThreadId: fixture.sourceThreadId,
        request: {
          ...request,
          expectedPreviewSha256: preview.previewSha256,
        },
      }),
    ]);
    expect(left.status).toBe("completed");
    expect(right.status).toBe("completed");
    expect(left.targetThreadId).not.toBe(right.targetThreadId);
    expect(left.targetRunId).not.toBe(right.targetRunId);
  });
});

interface Fixture {
  workspaceRoot: string;
  store: LocalStore;
  runtime: AgentRuntime;
  experiments: ModelInvocationExperimentRuntime;
  provider: ReturnType<typeof fauxProvider>;
  sourceThreadId: string;
  agentId: string;
  model: { provider: string; id: string };
}

async function createFixture(): Promise<Fixture> {
  const root = await mkdtemp(
    path.join(tmpdir(), "napier-model-invocation-experiment-"),
  );
  temporaryRoots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  await mkdir(workspaceRoot);
  const store = new LocalStore({
    dataRoot: path.join(root, "data"),
    workspaceRoot,
  });
  await store.initialize();
  openStores.push(store);
  const agent = store.listAgents()[0]!;
  const sourceThread = await store.createThread({
    title: "Model invocation experiment source",
    agentId: agent.id,
  });
  const provider = fauxProvider({
    provider: "faux-model-experiment",
    tokensPerSecond: 100_000,
  });
  const models = new ModelRegistry();
  models.registerProvider(provider.provider);
  const runtime = new AgentRuntime(store, models);
  return {
    workspaceRoot,
    store,
    runtime,
    experiments: new ModelInvocationExperimentRuntime(
      store,
      models,
      runtime.modelInvocationCapsules,
    ),
    provider,
    sourceThreadId: sourceThread.id,
    agentId: agent.id,
    model: { provider: "faux-model-experiment", id: "faux-1" },
  };
}

async function sourceRun(fixture: Fixture): Promise<RunRecord> {
  fixture.provider.setResponses([
    fauxAssistantMessage("source answer"),
    fauxAssistantMessage('{"facts":[]}'),
  ]);
  return fixture.runtime.runPrompt({
    threadId: fixture.sourceThreadId,
    text: "Create a captured source model call.",
    model: fixture.model,
  });
}
