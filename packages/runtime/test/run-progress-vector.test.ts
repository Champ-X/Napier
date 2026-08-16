import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";

import { AgentRuntime } from "../src/agent-runtime.js";
import { createGoal } from "../src/goals.js";
import { ModelRegistry } from "../src/models.js";
import { RunProgressTracker } from "../src/run-progress-vector.js";
import { LocalStore } from "../src/store.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Run progress vector", () => {
  it("chains hash-only dimensions and counts stagnant turns", async () => {
    const fixture = await createFixture("projection");
    const run = await fixture.store.createRun({
      threadId: fixture.threadId,
      agentId: fixture.agentId,
    });
    const tracker = await RunProgressTracker.create(fixture.store, run);
    const firstTurn = await event(fixture.store, run, "turn.completed", {});
    const first = await tracker.recordTurn();

    expect(first.payload).toEqual(
      expect.objectContaining({
        kind: "napier.run-progress-vector",
        schemaVersion: 1,
        turnIndex: 1,
        turnCompletedSeq: firstTurn.seq,
        progressed: false,
        changedDimensions: [],
        stagnantTurnCount: 1,
        workspaceMutationCount: 0,
        sourceCount: 0,
        userResultCount: 0,
        predecessorContentSha256: "",
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );

    await event(fixture.store, run, "tool.completed", {
      callId: "call_patch",
      toolName: "apply_patch",
      status: "completed",
      details: {
        kind: "napier.workspace-patch",
        resultSha256: "a".repeat(64),
      },
    });
    await event(fixture.store, run, "turn.completed", {});
    const second = await tracker.recordTurn();
    expect(second.payload).toEqual(
      expect.objectContaining({
        turnIndex: 2,
        progressed: true,
        changedDimensions: ["workspace"],
        stagnantTurnCount: 0,
        workspaceMutationCount: 1,
        firstWorkspaceMutationTurn: 2,
        firstWorkspaceMutationElapsedMs: expect.any(Number),
        predecessorContentSha256: first.payload["contentSha256"],
      }),
    );

    await event(fixture.store, run, "turn.completed", {});
    const third = await tracker.recordTurn();
    expect(third.payload).toEqual(
      expect.objectContaining({
        turnIndex: 3,
        progressed: false,
        changedDimensions: [],
        stagnantTurnCount: 1,
        workspaceMutationCount: 1,
        firstWorkspaceMutationTurn: 2,
      }),
    );
    expect(JSON.stringify([first, second, third])).not.toContain("PRIVATE");
    fixture.store.close();
  });

  it("records one vector after every real Agent turn", async () => {
    const fixture = await createFixture("agent");
    const agent = await fixture.store.updateAgent(fixture.agentId, {
      enabledTools: ["read_file"],
    });
    const provider = fauxProvider({ provider: "progress-provider" });
    provider.setResponses([
      fauxAssistantMessage(fauxToolCall("read_file", { path: "missing.txt" }), {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage("Progress delivery."),
    ]);
    const models = new ModelRegistry();
    models.registerProvider(provider.provider);
    const runtime = new AgentRuntime(fixture.store, models);

    const run = await runtime.runPrompt({
      threadId: fixture.threadId,
      text: "Read once, then finish.",
      model: { provider: "progress-provider", id: "faux-1" },
    });

    expect(run.status).toBe("completed");
    const events = await fixture.store.listEvents(fixture.threadId);
    const turns = events.filter(
      (candidate) =>
        candidate.runId === run.id && candidate.type === "turn.completed",
    );
    const vectors = events.filter(
      (candidate) =>
        candidate.runId === run.id && candidate.type === "run.progress.vector",
    );
    expect(vectors).toHaveLength(turns.length);
    expect(vectors.map((vector) => vector.payload["turnCompletedSeq"])).toEqual(
      turns.map((turn) => turn.seq),
    );
    expect(vectors.map((vector) => vector.payload["turnIndex"])).toEqual([
      1, 2,
    ]);
    expect(vectors[1]?.payload).toEqual(
      expect.objectContaining({
        progressed: true,
        changedDimensions: ["result"],
        userResultCount: 1,
      }),
    );
    expect(agent.id).toBe(fixture.agentId);
    fixture.store.close();
  });

  it("treats Browser Session operations as source-state progress", async () => {
    const fixture = await createFixture("browser");
    const run = await fixture.store.createRun({
      threadId: fixture.threadId,
      agentId: fixture.agentId,
    });
    const tracker = await RunProgressTracker.create(fixture.store, run);
    for (let operation = 1; operation <= 6; operation += 1) {
      await event(fixture.store, run, "tool.completed", {
        callId: `call_browser_${String(operation)}`,
        toolName: "browser",
        status: "completed",
        resultSha256: operation.toString(16).padStart(64, "0"),
        details: {
          kind: "napier.browser-session-operation",
          sessionOperation: operation,
          currentUrlSha256: operation.toString(16).padStart(64, "0"),
        },
      });
      await event(fixture.store, run, "turn.completed", {});
      const vector = await tracker.recordTurn();
      expect(vector.payload).toEqual(
        expect.objectContaining({
          turnIndex: operation,
          progressed: true,
          changedDimensions: ["source"],
          sourceCount: operation,
          stagnantTurnCount: 0,
        }),
      );
    }
    expect(
      (await fixture.store.listEvents(fixture.threadId)).some(
        (candidate) => candidate.type === "run.progress.rerouted",
      ),
    ).toBe(false);
    fixture.store.close();
  });

  it("reroutes a build task once after three mutation-free turns", async () => {
    const fixture = await createFixture("reroute");
    await fixture.store.updateAgent(fixture.agentId, {
      enabledTools: ["list_files", "apply_patch"],
    });
    const provider = fauxProvider({ provider: "reroute-provider" });
    provider.setResponses([
      fauxAssistantMessage(fauxToolCall("list_files", { path: "." }), {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage(fauxToolCall("list_files", { path: "." }), {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage(fauxToolCall("list_files", { path: "." }), {
        stopReason: "toolUse",
      }),
      (context) => {
        const messages = JSON.stringify(context.messages);
        expect(messages).toContain("Internal execution redirect");
        return fauxAssistantMessage(
          fauxToolCall("apply_patch", {
            operation: "create",
            path: "rerouted.txt",
            expectedSha256: null,
            content: "ACTION_FIRST_OK\n",
          }),
          { stopReason: "toolUse" },
        );
      },
      fauxAssistantMessage("Created the smallest safe artifact."),
    ]);
    const models = new ModelRegistry();
    models.registerProvider(provider.provider);
    const runtime = new AgentRuntime(fixture.store, models);

    const run = await runtime.runPrompt({
      threadId: fixture.threadId,
      text: "Build a small text file in the workspace.",
      model: { provider: "reroute-provider", id: "faux-1" },
    });

    expect(run.status).toBe("completed");
    expect(provider.state.callCount).toBe(6);
    const events = await fixture.store.listEvents(fixture.threadId);
    expect(
      events.filter((event) => event.type === "run.progress.rerouted"),
    ).toEqual([
      expect.objectContaining({
        visibility: "debug",
        payload: expect.objectContaining({
          kind: "napier.run-progress-reroute",
          strategy: "action_first",
          reason: "turns",
          turnIndex: 3,
          thresholdTurns: 3,
          thresholdElapsedMs: 180_000,
          taskIntentSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
          progressVectorSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
          instructionSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
          contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        }),
      }),
    ]);
    const userMessages = events
      .filter((event) => event.type === "message.user")
      .map((event) => event.payload["text"]);
    expect(userMessages).toEqual(["Build a small text file in the workspace."]);
    expect(JSON.stringify(events)).not.toContain("Internal execution redirect");
    const vectors = events.filter(
      (event) => event.type === "run.progress.vector",
    );
    expect(vectors.at(-1)?.payload).toEqual(
      expect.objectContaining({
        workspaceMutationCount: 1,
        firstWorkspaceMutationTurn: 4,
        stagnantTurnCount: 0,
      }),
    );
    fixture.store.close();
  });

  it("does not classify process output or negative writes as build intent", async () => {
    const fixture = await createFixture("result-before-action-first");
    await fixture.store.updateAgent(fixture.agentId, {
      enabledTools: ["list_files", "apply_patch"],
    });
    const provider = fauxProvider({ provider: "result-before-action-first" });
    provider.setResponses([
      fauxAssistantMessage(fauxToolCall("list_files", { path: "." }), {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage(fauxToolCall("list_files", { path: "." }), {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage(
        "Verified the requested process.stdout.write output without workspace writes.",
      ),
    ]);
    const models = new ModelRegistry();
    models.registerProvider(provider.provider);
    const runtime = new AgentRuntime(fixture.store, models);

    const run = await runtime.runPrompt({
      threadId: fixture.threadId,
      text: "Verify process.stdout.write output, report no workspace writes, and stop.",
      model: { provider: "result-before-action-first", id: "faux-1" },
    });

    expect(run.status).toBe("completed");
    expect(provider.state.callCount).toBe(4);
    const events = await fixture.store.listEvents(fixture.threadId);
    expect(events.some((event) => event.type === "run.progress.rerouted")).toBe(
      false,
    );
    expect(
      events.filter(
        (event) =>
          event.type === "tool.completed" &&
          event.payload["toolName"] === "apply_patch",
      ),
    ).toEqual([]);
    expect(
      events.filter((event) => event.type === "run.progress.vector").at(-1)
        ?.payload,
    ).toEqual(
      expect.objectContaining({
        turnIndex: 3,
        workspaceMutationCount: 0,
        userResultCount: 1,
      }),
    );
    fixture.store.close();
  });

  it("uses the elapsed threshold but does not reroute research-only intent", async () => {
    const build = await createFixture("elapsed");
    const buildRun = await build.store.createRun({
      threadId: build.threadId,
      agentId: build.agentId,
    });
    const buildTracker = await RunProgressTracker.create(
      build.store,
      {
        ...buildRun,
        startedAt: new Date(Date.now() - 180_001).toISOString(),
      },
      undefined,
      {
        prompt: "Implement a small workspace fix.",
        toolNames: ["apply_patch"],
      },
    );
    await event(build.store, buildRun, "turn.completed", {});
    await buildTracker.recordTurn();
    const reroute = (await build.store.listEvents(build.threadId)).find(
      (candidate) => candidate.type === "run.progress.rerouted",
    );
    expect(reroute?.payload).toEqual(
      expect.objectContaining({
        reason: "elapsed",
        turnIndex: 1,
        elapsedMs: expect.any(Number),
      }),
    );
    expect(await buildTracker.steer(new Map(), async () => [])).toHaveLength(1);
    build.store.close();

    const research = await createFixture("research");
    const researchRun = await research.store.createRun({
      threadId: research.threadId,
      agentId: research.agentId,
    });
    const researchTracker = await RunProgressTracker.create(
      research.store,
      researchRun,
      undefined,
      {
        prompt: "Research recent runtime behavior and summarize it.",
        toolNames: ["apply_patch"],
      },
    );
    for (let turn = 0; turn < 3; turn += 1) {
      await event(research.store, researchRun, "turn.completed", {});
      await researchTracker.recordTurn();
    }
    expect(
      (await research.store.listEvents(research.threadId)).some(
        (candidate) => candidate.type === "run.progress.rerouted",
      ),
    ).toBe(false);
    expect(await researchTracker.steer(new Map(), async () => [])).toEqual([]);
    research.store.close();
  });

  it("reroutes no progress once and then settles resumably", async () => {
    const fixture = await createFixture("no-progress");
    await fixture.store.updateAgent(fixture.agentId, {
      enabledTools: ["list_files"],
    });
    await fixture.store.setGoal(
      fixture.threadId,
      createGoal("Complete after measurable progress."),
    );
    const provider = fauxProvider({ provider: "no-progress-provider" });
    provider.setResponses([
      ...Array.from({ length: 6 }, (_, index) =>
        fauxAssistantMessage(
          fauxToolCall("list_files", { path: `missing-${String(index + 1)}` }),
          { stopReason: "toolUse" },
        ),
      ),
      (context) => {
        expect(JSON.stringify(context.messages)).toContain(
          "Internal convergence redirect",
        );
        return fauxAssistantMessage(
          fauxToolCall("list_files", { path: "missing-after-reroute" }),
          { stopReason: "toolUse" },
        );
      },
    ]);
    const models = new ModelRegistry();
    models.registerProvider(provider.provider);
    const runtime = new AgentRuntime(fixture.store, models);

    const run = await runtime.runPrompt({
      threadId: fixture.threadId,
      text: "Research the workspace layout and report only verified facts.",
      model: { provider: "no-progress-provider", id: "faux-1" },
    });

    expect(run).toEqual(
      expect.objectContaining({
        status: "failed",
        outcome: "paused_budget",
        error: expect.stringContaining("no measurable progress"),
      }),
    );
    expect(provider.state.callCount).toBe(7);
    const events = await fixture.store.listEvents(fixture.threadId);
    const reroutes = events.filter(
      (event) => event.type === "run.progress.rerouted",
    );
    expect(reroutes).toEqual([
      expect.objectContaining({
        visibility: "debug",
        payload: expect.objectContaining({
          strategy: "summarize_and_converge",
          reason: "turns",
          turnIndex: 6,
          stagnantTurnCount: 6,
          thresholdTurns: 6,
          thresholdElapsedMs: 180_000,
        }),
      }),
    ]);
    expect(
      events.find((event) => event.type === "run.no_progress")?.payload,
    ).toEqual(
      expect.objectContaining({
        kind: "napier.run-no-progress",
        reason: "turns",
        turnIndex: 7,
        stagnantTurnCount: 7,
        rerouteContentSha256: reroutes[0]!.payload["contentSha256"],
      }),
    );
    expect(events.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        "run.no_progress",
        "run.settlement.recorded",
        "run.settlement.checkpoint",
        "run.failed",
      ]),
    );
    expect(
      events
        .filter((event) => event.type === "message.user")
        .map((event) => event.payload["text"]),
    ).toEqual([
      "Research the workspace layout and report only verified facts.",
    ]);
    expect(JSON.stringify(events)).not.toContain(
      "Internal convergence redirect",
    );
    expect(fixture.store.getThread(fixture.threadId).goal).toEqual(
      expect.objectContaining({ status: "active" }),
    );
    fixture.store.close();
  });
});

async function createFixture(label: string) {
  const root = await mkdtemp(path.join(tmpdir(), `napier-progress-${label}-`));
  roots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  await mkdir(workspaceRoot);
  const store = new LocalStore({
    workspaceRoot,
    dataRoot: path.join(root, "data"),
  });
  await store.initialize();
  const agentId = store.listAgents()[0]!.id;
  const thread = await store.createThread({
    title: "Run progress vector",
    agentId,
  });
  return { store, threadId: thread.id, agentId };
}

function event(
  store: LocalStore,
  run: { id: string; threadId: string },
  type: string,
  payload: Parameters<LocalStore["appendEvent"]>[0]["payload"],
) {
  return store.appendEvent({
    threadId: run.threadId,
    runId: run.id,
    type,
    category: "lifecycle",
    visibility: "debug",
    payload,
  });
}
