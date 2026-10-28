import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { LocalStore } from "../src/store.js";
import { projectRunControlEpochs } from "../src/run-progress-control-epoch-codec.js";
import { canonicalJson, sha256 } from "../src/ed25519.js";
import { ModelRegistry } from "../src/models.js";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import { processReadyAgentRuntime } from "./process-run-readiness-test-fixture.js";
import {
  createRunControlMessageQueuedPayload,
  projectRunControlMessages,
} from "../src/run-control-messages.js";
import type { RunEvent } from "@napier/contracts";

const roots: string[] = [];
const stores: LocalStore[] = [];
afterEach(async () => {
  for (const store of stores.splice(0)) store.close();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

it("reconciles a saved control identity after process death before response transmission", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "napier-control-crash-"));
  roots.push(root);
  const child = fileURLToPath(
    new URL("./fixtures/run-control-message-crash.ts", import.meta.url),
  );
  await expect(
    promisify(execFile)(process.execPath, ["--import", "tsx", child, root], {
      timeout: 20000,
    }),
  ).rejects.toMatchObject({ code: 73 });
  const store = new LocalStore({
    dataRoot: path.join(root, "state"),
    workspaceRoot: path.join(root, "workspace"),
  });
  stores.push(store);
  await store.initialize(true);
  const thread = store.listThreads()[0]!;
  const run = store.listRuns(thread.id)[0]!;
  expect(run.status).toBe("interrupted");
  const saved = (await store.listRunControlMessages(thread.id))[0]!;
  expect(saved.status).toBe("cancelled");
  expect(saved.cancellationReason).toBe("run_interrupted_before_delivery");
  expect(
    await store.queueRunControlMessage({
      threadId: thread.id,
      runId: run.id,
      clientMessageId: "crash-before-response",
      mode: "follow_up",
      text: "Keep the saved instruction.",
    }),
  ).toEqual(saved);
  expect(
    (await store.listEvents(thread.id)).filter(
      (event) => event.type === "run.control.queued",
    ),
  ).toHaveLength(1);
}, 30000);
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "napier-control-identity-"));
  roots.push(root);
  const options = {
    workspaceRoot: path.join(root, "workspace"),
    dataRoot: path.join(root, "state"),
  };
  await mkdir(options.workspaceRoot);
  const store = new LocalStore(options);
  stores.push(store);
  await store.initialize();
  const agent = store.listAgents()[0]!;
  const thread = await store.createThread({
    title: "Stable control identity",
    agentId: agent.id,
  });
  const run = await store.createRun({
    threadId: thread.id,
    agentId: agent.id,
    model: { provider: "faux-control", id: "faux-1" },
  });
  const input = {
    threadId: thread.id,
    runId: run.id,
    clientMessageId: "client-first-message",
    mode: "steering" as const,
    text: "  Preserve this instruction.  ",
  };
  return { root, options, store, thread, run, agent, input };
}

it("delivers a retried follow-up to the model once without starting an extra turn", async () => {
  const f = await fixture();
  await f.store.finishRun(f.run.id, "completed");
  const provider = fauxProvider({ provider: "faux-keyed-follow-up" });
  const followUp = "Summarize only the verified result.";
  provider.setResponses([
    (context) => {
      expect(JSON.stringify(context.messages)).not.toContain(followUp);
      return fauxAssistantMessage("Initial task finished.");
    },
    (context) => {
      const messages = context.messages.filter(
        (message) =>
          message.role === "user" && JSON.stringify(message).includes(followUp),
      );
      expect(messages).toHaveLength(1);
      return fauxAssistantMessage("Verified result summarized.");
    },
    fauxAssistantMessage('{"facts":[]}'),
  ]);
  const registry = new ModelRegistry();
  registry.registerProvider(provider.provider);
  const runtime = processReadyAgentRuntime(f.store, registry);
  const run = await runtime.runPrompt({
    threadId: f.thread.id,
    text: "Verify this task.",
    model: { provider: "faux-keyed-follow-up", id: "faux-1" },
    onEvent: async (event) => {
      if (event.type !== "run.started") return;
      const input = {
        ...f.input,
        runId: event.runId,
        text: followUp,
        mode: "follow_up" as const,
      };
      const first = await f.store.queueRunControlMessage(input);
      expect(await f.store.queueRunControlMessage(input)).toEqual(first);
    },
  });
  expect(run.status, JSON.stringify(run)).toBe("completed");
  expect(provider.state.callCount).toBe(3);
  const events = await f.store.listEvents(f.thread.id);
  expect(
    events.filter((event) => event.type === "run.control.queued"),
  ).toHaveLength(1);
  expect(
    events.filter((event) => event.type === "run.control.delivered"),
  ).toHaveLength(1);
  expect(
    events.filter((event) => event.type === "turn.completed"),
  ).toHaveLength(2);
});

it("binds concurrent retries to one durable message and delivers its text only once", async () => {
  const f = await fixture();
  const messages = await Promise.all(
    Array.from({ length: 5 }, () => f.store.queueRunControlMessage(f.input)),
  );
  expect(new Set(messages.map((item) => item.id)).size).toBe(1);
  expect(messages[0]?.clientMessageId).toBe(f.input.clientMessageId);
  const delivered = await f.store.deliverNextRunControlMessage(
    f.thread.id,
    f.run.id,
    "steering",
  );
  expect(delivered?.text).toBe(f.input.text.trim());
  expect(
    await f.store.deliverNextRunControlMessage(
      f.thread.id,
      f.run.id,
      "steering",
    ),
  ).toBeUndefined();
  expect(
    await f.store.queueRunControlMessage({
      ...f.input,
      text: f.input.text.trim(),
    }),
  ).toEqual(delivered?.message);
  const events = await f.store.listEvents(f.thread.id);
  expect(
    events.filter((event) => event.type === "run.control.queued"),
  ).toHaveLength(1);
  expect(events.filter((event) => event.type === "message.user")).toHaveLength(
    1,
  );
});

it.each(["delivered", "cancelled", "queued"] as const)(
  "returns the authoritative %s receipt after terminal settlement and reopening",
  async (state) => {
    const f = await fixture();
    const queued = await f.store.queueRunControlMessage(f.input);
    if (state === "delivered")
      await f.store.deliverNextRunControlMessage(
        f.thread.id,
        f.run.id,
        "steering",
      );
    if (state === "cancelled")
      await f.store.cancelRunControlMessage(f.thread.id, f.run.id, queued.id);
    await f.store.finishRun(f.run.id, "completed");
    const expected = (await f.store.listRunControlMessages(f.thread.id))[0]!;
    const before = await f.store.listEvents(f.thread.id);
    f.store.close();
    stores.splice(stores.indexOf(f.store), 1);
    const reopened = new LocalStore(f.options);
    stores.push(reopened);
    await reopened.initialize();
    expect(await reopened.queueRunControlMessage(f.input)).toEqual(expected);
    expect(await reopened.listEvents(f.thread.id)).toEqual(before);
    expect(expected.status).toBe(
      state === "delivered" ? "delivered" : "cancelled",
    );
  },
);

it("rejects a reused identity with changed content or mode without appending events", async () => {
  const f = await fixture();
  await f.store.queueRunControlMessage(f.input);
  const before = await f.store.listEvents(f.thread.id);
  await expect(
    f.store.queueRunControlMessage({
      ...f.input,
      text: "Different instruction.",
    }),
  ).rejects.toThrow("clientMessageId conflict");
  await expect(
    f.store.queueRunControlMessage({ ...f.input, mode: "follow_up" }),
  ).rejects.toThrow("clientMessageId conflict");
  expect(await f.store.listEvents(f.thread.id)).toEqual(before);
});

it("scopes identities to the target Run and Thread without weakening ownership checks", async () => {
  const f = await fixture();
  const first = await f.store.queueRunControlMessage(f.input);
  await f.store.finishRun(f.run.id, "completed");
  const secondRun = await f.store.createRun({
    threadId: f.thread.id,
    agentId: f.agent.id,
    model: { provider: "faux-control", id: "faux-1" },
  });
  const second = await f.store.queueRunControlMessage({
    ...f.input,
    runId: secondRun.id,
  });
  expect(second.id).not.toBe(first.id);
  const other = await f.store.createThread({
    title: "Other",
    agentId: f.agent.id,
  });
  await expect(
    f.store.queueRunControlMessage({ ...f.input, threadId: other.id }),
  ).rejects.toThrow("active Thread Run");
  expect(await f.store.listRunControlMessages(other.id)).toEqual([]);
});

it("accepts idempotent retries at queue capacity while preserving new-message limits", async () => {
  const f = await fixture();
  const first = await f.store.queueRunControlMessage(f.input);
  for (let index = 1; index < 16; index++)
    await f.store.queueRunControlMessage({
      ...f.input,
      clientMessageId: `message-${index}`,
    });
  expect(await f.store.queueRunControlMessage(f.input)).toEqual(first);
  await expect(
    f.store.queueRunControlMessage({
      ...f.input,
      clientMessageId: "new-message",
    }),
  ).rejects.toThrow("pending limit");
});

it("retains unkeyed request semantics and rejects malformed retry identities", async () => {
  const f = await fixture();
  const { clientMessageId: _client, ...legacy } = f.input;
  const first = await f.store.queueRunControlMessage(legacy);
  const second = await f.store.queueRunControlMessage(legacy);
  expect(first.id).not.toBe(second.id);
  expect(first).not.toHaveProperty("clientMessageId");
  for (const clientMessageId of ["", "has spaces", "x".repeat(129)]) {
    await expect(
      f.store.queueRunControlMessage({ ...f.input, clientMessageId }),
    ).rejects.toThrow("clientMessageId is invalid");
  }
  expect(await f.store.listRunControlMessages(f.thread.id)).toHaveLength(2);
});

it("hash-binds the retry identity and preserves legacy queued payload parsing", () => {
  const base = {
    controlMessageId: "control_queued1234",
    mode: "steering" as const,
    text: "Keep this.",
  };
  const legacy = createRunControlMessageQueuedPayload(base);
  const keyed = createRunControlMessageQueuedPayload({
    ...base,
    clientMessageId: "client-a",
  });
  const event = (payload: RunEvent["payload"]) =>
    ({
      id: "event_first",
      threadId: "thread_first",
      runId: "run_first",
      seq: 1,
      type: "run.control.queued",
      category: "message",
      visibility: "user",
      createdAt: "2026-10-29T00:00:00Z",
      payload,
    }) as RunEvent;
  expect(projectRunControlMessages([event(legacy)])).toHaveLength(1);
  expect(projectRunControlMessages([event(keyed)])[0]?.clientMessageId).toBe(
    "client-a",
  );
  expect(
    projectRunControlMessages([
      event({ ...keyed, clientMessageId: "client-b" }),
    ]),
  ).toEqual([]);
  expect(legacy).not.toHaveProperty("clientMessageId");
  expect(() => projectRunControlEpochs([event(keyed)])).not.toThrow();
  const { requestSha256: _hash, ...content } = keyed;
  const invalid = { ...content, clientMessageId: "invalid client" };
  expect(() =>
    projectRunControlEpochs([
      event({ ...invalid, requestSha256: sha256(canonicalJson(invalid)) }),
    ]),
  ).toThrow("client identity is invalid");
});
