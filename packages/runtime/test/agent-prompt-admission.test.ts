import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { ModelRegistry } from "../src/models.js";
import { promptRequestFingerprint } from "../src/prompt-request-admission.js";
import { LocalStore } from "../src/store.js";
import { processReadyAgentRuntime } from "./process-run-readiness-test-fixture.js";

const roots: string[] = [];
const stores: LocalStore[] = [];
afterEach(async () => {
  stores.splice(0).forEach((store) => store.close());
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "napier-prompt-admission-"));
  roots.push(root);
  const store = new LocalStore({
    dataRoot: path.join(root, "data"),
    workspaceRoot: path.join(root, "workspace"),
  });
  stores.push(store);
  await store.initialize();
  const thread = await store.createThread({
    title: "Admission",
    agentId: store.listAgents()[0]!.id,
  });
  const runtime = processReadyAgentRuntime(store, new ModelRegistry());
  return { store, thread, runtime };
}

it("reuses an in-flight prompt before run.started exists, including across runtimes sharing the store", async () => {
  const { store, thread, runtime } = await fixture();
  const anotherRuntime = processReadyAgentRuntime(store, new ModelRegistry());
  const created = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const options = {
    threadId: thread.id,
    text: "Explain the execution ledger.",
    requestId: "same-intent",
  };
  const first = runtime.runPrompt({
    ...options,
    onRunCreated: async () => {
      created.resolve();
      await release.promise;
    },
  });
  await created.promise;
  const second = anotherRuntime.runPrompt(options);
  release.resolve();
  const [left, right] = await Promise.all([first, second]);
  expect(left.id).toBe(right.id);
  expect(left.status).toBe("completed");
  expect(store.listRuns(thread.id)).toHaveLength(1);
  expect(
    (await store.listEvents(thread.id)).filter(
      (event) => event.type === "run.started",
    ),
  ).toHaveLength(1);
});

it("rejects a conflicting payload while a request is in flight and after it completes", async () => {
  const { store, thread, runtime } = await fixture();
  const created = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const options = {
    threadId: thread.id,
    text: "Original request",
    requestId: "same-intent",
  };
  const first = runtime.runPrompt({
    ...options,
    onRunCreated: async () => {
      created.resolve();
      await release.promise;
    },
  });
  await created.promise;
  try {
    await expect(
      runtime.runPrompt({ ...options, text: "Different request" }),
    ).rejects.toThrow(/requestId.*different/i);
  } finally {
    release.resolve();
    await first;
  }
  const anotherRuntime = processReadyAgentRuntime(store, new ModelRegistry());
  await expect(
    anotherRuntime.runPrompt({ ...options, text: "Different request" }),
  ).rejects.toThrow(/requestId.*different/i);
  expect(store.listRuns(thread.id)).toHaveLength(1);
});

it("keeps the same requestId independent in different threads", async () => {
  const { store, thread, runtime } = await fixture();
  const otherThread = await store.createThread({
    title: "Other",
    agentId: thread.agentId,
  });
  const [left, right] = await Promise.all([
    runtime.runPrompt({
      threadId: thread.id,
      text: "First thread",
      requestId: "same-intent",
    }),
    runtime.runPrompt({
      threadId: otherThread.id,
      text: "Second thread",
      requestId: "same-intent",
    }),
  ]);
  expect(left.id).not.toBe(right.id);
  expect(left.threadId).toBe(thread.id);
  expect(right.threadId).toBe(otherThread.id);
});

it("coalesces simultaneous first submissions before either Run is created", async () => {
  const { store, thread, runtime } = await fixture();
  const options = {
    threadId: thread.id,
    text: "Concurrent request",
    requestId: "same-intent",
  };
  const results = await Promise.all(
    Array.from({ length: 4 }, () => runtime.runPrompt(options)),
  );
  expect(new Set(results.map((run) => run.id)).size).toBe(1);
  expect(store.listRuns(thread.id)).toHaveLength(1);
});

it("reuses completed request evidence after reopening the store and rejects changed intent", async () => {
  const { store, thread, runtime } = await fixture();
  const options = {
    threadId: thread.id,
    text: "Durable request",
    requestId: "same-intent",
  };
  const original = await runtime.runPrompt(options);
  store.close();
  const reopened = new LocalStore({
    dataRoot: store.dataRoot,
    workspaceRoot: store.workspaceRoot,
  });
  await reopened.initialize();
  try {
    const restarted = processReadyAgentRuntime(reopened, new ModelRegistry());
    const replay = await restarted.runPrompt(options);
    expect(replay.id).toBe(original.id);
    await expect(
      restarted.runPrompt({ ...options, text: "Changed request" }),
    ).rejects.toThrow(/requestId.*different/i);
    expect(reopened.listRuns(thread.id)).toHaveLength(1);
  } finally {
    reopened.close();
  }
});

it("reuses create-time admission after a crash before run.started", async () => {
  const { store, thread } = await fixture();
  const options = {
    threadId: thread.id,
    text: "Interrupted before started",
    requestId: "crash-window",
  };
  const fingerprint = promptRequestFingerprint(options);
  const leased = await store.createLeasedRun(
    {
      threadId: thread.id,
      agentId: thread.agentId,
      requestId: options.requestId,
      requestFingerprint: fingerprint,
    },
    { ownerId: "crash-fixture", ttlMs: 60_000 },
  );
  expect(
    (await store.listEvents(thread.id)).filter(
      (event) => event.type === "run.prompt.admitted",
    ),
  ).toHaveLength(1);
  expect(
    (await store.listEvents(thread.id)).some(
      (event) => event.type === "run.started",
    ),
  ).toBe(false);

  store.close();
  const reopened = new LocalStore({
    dataRoot: store.dataRoot,
    workspaceRoot: store.workspaceRoot,
  });
  await reopened.initialize();
  try {
    const restarted = processReadyAgentRuntime(reopened, new ModelRegistry());
    const replay = await restarted.runPrompt(options);
    expect(replay.id).toBe(leased.run.id);
    expect(reopened.listRuns(thread.id)).toHaveLength(1);
  } finally {
    reopened.close();
  }
});
