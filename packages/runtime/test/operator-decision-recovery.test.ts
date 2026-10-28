import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { AgentRuntime } from "../src/agent-runtime.js";
import { ModelRegistry } from "../src/models.js";
import { LocalStore } from "../src/store.js";
import { SqliteLedger } from "../src/sqlite-ledger.js";
import {
  DECISION_RECOVERY_BASELINE,
  withBaselineStore,
} from "./fixtures/operator-decision-baseline.js";

const roots: string[] = [];
const stores: LocalStore[] = [];
const observations: Record<string, unknown>[] = [];
const answer = {
  selectedOptionIds: ["option_1"],
  customText: "Keep my saved answer.",
};
afterAll(async () => {
  const output = process.env["NAPIER_DECISION_RECOVERY_OBSERVATIONS"];
  if (output)
    await writeFile(output, JSON.stringify({ observations }, null, 2));
});
afterEach(async () => {
  vi.restoreAllMocks();
  stores.splice(0).forEach((store) => store.close());
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("durable operator decision continuation", () => {
  it("reproduces the old saved-answer rejection and unbound Run window", async () => {
    await withBaselineStore(async (modulePath) => {
      const root = await mkdtemp(
        path.join(tmpdir(), "napier-decision-baseline-"),
      );
      roots.push(root);
      const child = fileURLToPath(
        new URL("./fixtures/operator-decision-crash.ts", import.meta.url),
      );
      const options = {
        timeout: 20000,
        env: { ...process.env, NAPIER_DECISION_STORE_MODULE: modulePath },
      };
      const retry = await promisify(execFile)(
        process.execPath,
        ["--import", "tsx", child, path.join(root, "retry"), "answer-retry"],
        options,
      );
      expect(JSON.parse(retry.stdout)).toMatchObject({
        retryAccepted: false,
        error: expect.stringContaining("already been answered"),
      });
      await expect(
        promisify(execFile)(
          process.execPath,
          ["--import", "tsx", child, path.join(root, "gap"), "after-create"],
          options,
        ),
      ).rejects.toMatchObject({ code: 73 });
      const store = await openStore(path.join(root, "gap"), true);
      const thread = store.listThreads()[0]!;
      expect(store.listRuns(thread.id)).toHaveLength(2);
      const decision = (await store.listOperatorDecisions(thread.id))[0]!;
      expect(decision.status).toBe("answered");
      expect(decision.continuationRunId).toBeUndefined();
      observations.push({
        checkpoint: "baseline-after-create",
        baselineCommit: DECISION_RECOVERY_BASELINE,
        savedAnswerRetryAccepted: false,
        unboundContinuationRuns: 1,
        externalModelRequests: 0,
      });
    });
  }, 30000);

  it.each(["after-answer", "before-bind-commit"])(
    "continues a saved answer after process death at %s",
    async (checkpoint) => {
      const { root, store, restartMs } = await crashed(checkpoint);
      const thread = store.listThreads()[0]!;
      const decision = (await store.listOperatorDecisions(thread.id))[0]!;
      expect(decision.status).toBe("answered");
      expect(store.listRuns(thread.id)).toHaveLength(1);
      const retried = await store.answerOperatorDecision(
        thread.id,
        decision.id,
        answer,
      );
      expect(retried.events).toEqual([]);
      expect(retried.decision.answerSha256).toBe(decision.answerSha256);
      const { runtime, provider } = executor(store);
      const started = performance.now();
      const run = await runtime.continueOperatorDecision({
        threadId: thread.id,
        decisionId: decision.id,
      });
      expect(run.status).toBe("completed");
      expect(
        await readFile(path.join(root, "workspace/answer.txt"), "utf8"),
      ).toBe("saved answer applied once\n");
      expect(provider.state.callCount).toBe(3);
      const duplicate = await runtime.continueOperatorDecision({
        threadId: thread.id,
        decisionId: decision.id,
      });
      expect(duplicate).toEqual(run);
      expect(provider.state.callCount).toBe(3);
      await assertReceipts(store, thread.id, 1);
      observations.push({
        checkpoint,
        restartMs,
        continuationMs: performance.now() - started,
        status: run.status,
        retainedAnswer: true,
        continuationRuns: 1,
        patchCalls: 1,
        repeatedPatchCalls: 0,
        fixtureModelCalls: 3,
        externalModelRequests: 0,
      });
    },
    30000,
  );

  it("retains the atomic binding when killed immediately after SQLite commit", async () => {
    const { store, restartMs } = await crashed("after-bind-commit");
    const thread = store.listThreads()[0]!;
    const decision = (await store.listOperatorDecisions(thread.id))[0]!;
    expect(decision.status).toBe("continued");
    expect(decision.customText).toBe(answer.customText);
    expect(store.listRuns(thread.id)).toHaveLength(2);
    const { runtime, provider } = executor(store);
    const run = await runtime.continueOperatorDecision({
      threadId: thread.id,
      decisionId: decision.id,
    });
    expect(run.id).toBe(decision.continuationRunId);
    expect(run.status).toBe("interrupted");
    expect(provider.state.callCount).toBe(0);
    expect(
      (await store.continueOperatorDecision(thread.id, decision.id, run.id))
        .events,
    ).toEqual([]);
    expect(
      (await store.answerOperatorDecision(thread.id, decision.id, answer))
        .events,
    ).toEqual([]);
    await assertReceipts(store, thread.id, 0);
    const recovered = await runtime.resumeInterruptedRun({
      threadId: thread.id,
      runId: run.id,
    });
    expect(recovered.status).toBe("completed");
    expect(recovered.parentRunId).toBe(run.id);
    expect(provider.state.callCount).toBe(3);
    expect(
      (await store.listOperatorDecisions(thread.id))[0]!.continuationRunId,
    ).toBe(run.id);
    await assertReceipts(store, thread.id, 1);
    observations.push({
      checkpoint: "after-bind-commit",
      restartMs,
      status: run.status,
      retainedAnswer: true,
      continuationRuns: 1,
      fixtureModelCalls: 0,
      externalModelRequests: 0,
      repeatedPatchCalls: 0,
      requiresRunRecovery: true,
      explicitRecoveryStatus: recovered.status,
      explicitRecoveryFixtureModelCalls: 3,
      explicitRecoveryRetainedAnswer: true,
    });
  }, 30000);

  it("shares one executor across concurrent runtimes and retries while running", async () => {
    const { store, root, thread, decision } = await fixture();
    const second = await openStore(root);
    await Promise.all(
      [store, second].map((current) =>
        current.answerOperatorDecision(thread.id, decision.id, answer),
      ),
    );
    const firstExecutor = executor(store);
    const secondExecutor = executor(second);
    const created = vi.fn();
    const [first, other] = await Promise.all([
      firstExecutor.runtime.continueOperatorDecision({
        threadId: thread.id,
        decisionId: decision.id,
        onRunCreated: created,
      }),
      secondExecutor.runtime.continueOperatorDecision({
        threadId: thread.id,
        decisionId: decision.id,
        onRunCreated: created,
      }),
    ]);
    expect(first.id).toBe(other.id);
    expect([first.status, other.status]).toEqual(["completed", "completed"]);
    expect(created).toHaveBeenCalledTimes(1);
    expect(
      firstExecutor.provider.state.callCount +
        secondExecutor.provider.state.callCount,
    ).toBe(3);
    expect(store.listRuns(thread.id)).toHaveLength(2);
    await assertReceipts(store, thread.id, 1);
    await expect(
      second.answerOperatorDecision(thread.id, decision.id, {
        selectedOptionIds: ["option_2"],
      }),
    ).rejects.toThrow("answered differently");
    const done = await secondExecutor.runtime.continueOperatorDecision({
      threadId: thread.id,
      decisionId: decision.id,
    });
    expect(done.id).toBe(first.id);
    observations.push({
      checkpoint: "concurrent-store-clients",
      continuationRuns: 1,
      createdCallbacks: created.mock.calls.length,
      fixtureModelCalls: 3,
      repeatedPatchCalls: 0,
      terminalResponses: 2,
      externalModelRequests: 0,
    });
  });

  it("cancels a retry observer without cancelling the original executor", async () => {
    const { store, thread, decision } = await fixture();
    await store.answerOperatorDecision(thread.id, decision.id, answer);
    const { runtime, provider } = executor(store);
    const ready = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const running = runtime.continueOperatorDecision({
      threadId: thread.id,
      decisionId: decision.id,
      onRunCreated: async () => {
        ready.resolve();
        await release.promise;
      },
    });
    await ready.promise;
    const abort = new AbortController();
    const retry = runtime.continueOperatorDecision({
      threadId: thread.id,
      decisionId: decision.id,
      signal: abort.signal,
    });
    const rejected = expect(retry).rejects.toMatchObject({
      name: "AbortError",
    });
    abort.abort();
    await rejected;
    expect(provider.state.callCount).toBe(0);
    release.resolve();
    expect((await running).status).toBe("completed");
    await assertReceipts(store, thread.id, 1);
  });

  it("rolls back Run and binding together after a failed ledger commit", async () => {
    const { store, thread, decision, origin, agent } = await fixture();
    await store.answerOperatorDecision(thread.id, decision.id, answer);
    const commit = SqliteLedger.prototype.commit;
    const spy = vi
      .spyOn(SqliteLedger.prototype, "commit")
      .mockImplementation(function (
        this: SqliteLedger,
        revision,
        state,
        events,
      ) {
        if (
          events?.some((event) => event.type === "operator.decision.continued")
        )
          throw new Error("injected commit failure");
        return commit.call(this, revision, state, events);
      });
    await expect(
      store.createRun({
        threadId: thread.id,
        agentId: agent.id,
        parentRunId: origin.id,
        operatorDecisionId: decision.id,
      }),
    ).rejects.toThrow("injected commit failure");
    spy.mockRestore();
    expect(store.listRuns(thread.id)).toHaveLength(1);
    expect(store.getThread(thread.id).status).toBe("waiting");
    expect((await store.listOperatorDecisions(thread.id))[0]!.status).toBe(
      "answered",
    );
    expect(
      (
        await executor(store).runtime.continueOperatorDecision({
          threadId: thread.id,
          decisionId: decision.id,
        })
      ).status,
    ).toBe("completed");
    await assertReceipts(store, thread.id, 1);
  });
});

async function assertReceipts(
  store: LocalStore,
  threadId: string,
  patchCalls: number,
) {
  const events = await store.listEvents(threadId);
  expect(
    events.filter((event) => event.type === "operator.decision.answered"),
  ).toHaveLength(1);
  expect(
    events.filter((event) => event.type === "operator.decision.continued"),
  ).toHaveLength(1);
  expect(
    events.filter(
      (event) =>
        event.type === "tool.completed" &&
        event.payload["toolName"] === "apply_patch",
    ),
  ).toHaveLength(patchCalls);
}

function executor(store: LocalStore) {
  const provider = fauxProvider({ provider: "faux-decision-recovery" });
  provider.setResponses([
    (context) => {
      expect(JSON.stringify(context.messages)).toContain(answer.customText);
      return fauxAssistantMessage(
        fauxToolCall("apply_patch", {
          operation: "create",
          path: "answer.txt",
          expectedSha256: null,
          content: "saved answer applied once\n",
        }),
        { stopReason: "toolUse" },
      );
    },
    fauxAssistantMessage("Applied the saved answer."),
    fauxAssistantMessage('{"facts":[]}'),
  ]);
  const registry = new ModelRegistry();
  registry.registerProvider(provider.provider);
  return { runtime: new AgentRuntime(store, registry), provider };
}

async function openStore(root: string, interrupt = false) {
  const store = new LocalStore({
    dataRoot: path.join(root, "data"),
    workspaceRoot: path.join(root, "workspace"),
  });
  stores.push(store);
  await store.initialize(interrupt);
  return store;
}

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "napier-decision-recovery-"));
  roots.push(root);
  await mkdir(path.join(root, "workspace"));
  const store = await openStore(root);
  const agent = await store.updateAgent(store.listAgents()[0]!.id, {
    model: { provider: "faux-decision-recovery", id: "faux-1" },
    toolPolicy: "workspace",
    enabledTools: ["apply_patch"],
    enabledSubagents: [],
  });
  const thread = await store.createThread({
    title: "Decision recovery",
    agentId: agent.id,
  });
  const origin = await store.createRun({
    threadId: thread.id,
    agentId: agent.id,
  });
  const { decision } = await store.requestOperatorDecision({
    threadId: thread.id,
    runId: origin.id,
    header: "Output",
    question: "Which output?",
    multiSelect: false,
    options: [
      { label: "File", description: "Create the agreed file." },
      { label: "Stop", description: "Keep paused." },
    ],
  });
  await store.finishRun(origin.id, "completed", {
    waitForOperatorDecisionId: decision.id,
  });
  return { store, root, thread, agent, origin, decision };
}

async function crashed(checkpoint: string) {
  const root = await mkdtemp(path.join(tmpdir(), "napier-decision-crash-"));
  roots.push(root);
  const child = fileURLToPath(
    new URL("./fixtures/operator-decision-crash.ts", import.meta.url),
  );
  await expect(
    promisify(execFile)(
      process.execPath,
      ["--import", "tsx", child, root, checkpoint],
      { timeout: 20000 },
    ),
  ).rejects.toMatchObject({ code: 73 });
  const start = performance.now();
  const store = await openStore(root, true);
  return { root, store, restartMs: performance.now() - start };
}
