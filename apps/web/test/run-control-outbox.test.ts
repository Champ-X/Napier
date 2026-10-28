import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import type {
  RunControlMessage,
  QueueRunControlMessageRequest,
} from "@napier/contracts";
import { ControlOutboxStore } from "../src/run-control-outbox-store";
import {
  ControlOutboxActions,
  type ControlOutboxTransport,
} from "../src/run-control-outbox-actions";
import { NapierApiError } from "../src/api-error";

function setup() {
  const data = new Map<string, string>();
  const storage = {
    get length() {
      return data.size;
    },
    key: (i: number) => [...data.keys()][i] ?? null,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: vi.fn((key: string, value: string) => {
      data.set(key, value);
    }),
  };
  const receipts = new Map<string, RunControlMessage>();
  const request = {
    clientMessageId: "original-id",
    mode: "follow_up" as const,
    text: "原始指令\nKeep it.",
  };
  let seq = 0;
  const queue = vi.fn(
    async (
      threadId: string,
      runId: string,
      body: QueueRunControlMessageRequest,
    ) => {
      const stored = [...data.values()].map((value) => JSON.parse(value));
      expect(stored).toContainEqual(
        expect.objectContaining({
          threadId,
          runId,
          clientMessageId: body.clientMessageId,
          text: body.text,
        }),
      );
      const id = body.clientMessageId!;
      if (!receipts.has(id))
        receipts.set(id, {
          kind: "napier.run-control-message",
          schemaVersion: 1,
          id: `control_${id}`,
          threadId,
          runId,
          clientMessageId: id,
          mode: body.mode,
          status: "queued",
          textBytes: Buffer.byteLength(body.text),
          textSha256: createHash("sha256").update(body.text).digest("hex"),
          queuedAt: new Date().toISOString(),
          queuedEventSeq: ++seq,
          contentSha256: "fixture",
        });
      return receipts.get(id)!;
    },
  );
  const cancel = vi.fn(
    async (_threadId: string, _runId: string, id: string) => {
      const receipt = [...receipts.values()].find((item) => item.id === id)!;
      const next = {
        ...receipt,
        status: "cancelled" as const,
        cancellationEventSeq: ++seq,
        cancellationReason: "operator_cancelled" as const,
      };
      receipts.set(receipt.clientMessageId ?? receipt.id, next);
      return next;
    },
  );
  const load = vi.fn(async (threadId: string, runId: string) =>
    [...receipts.values()].filter(
      (item) => item.threadId === threadId && item.runId === runId,
    ),
  );
  const transport: ControlOutboxTransport = { queue, cancel, load };
  let current = true;
  const store = new ControlOutboxStore(
    () => storage,
    () => {},
  );
  const createActions = (
    nextStore = store,
    workspaceKey = "workspace-a",
    threadId = "thread-a",
  ) =>
    new ControlOutboxActions(
      workspaceKey,
      threadId,
      nextStore,
      transport,
      () => current,
      () => {},
    );
  const actions = createActions();
  return {
    data,
    storage,
    store,
    actions,
    createActions,
    request,
    transport,
    queue,
    cancel,
    load,
    receipts,
    leave: () => {
      current = false;
    },
    entry: () => actions.list()[0]!,
    reload: () =>
      createActions(
        new ControlOutboxStore(
          () => storage,
          () => {},
        ),
      ),
    deliver: () => {
      const receipt = receipts.get(request.clientMessageId)!;
      const next = {
        ...receipt,
        status: "delivered" as const,
        deliveredEventSeq: ++seq,
      };
      receipts.set(request.clientMessageId, next);
      return next;
    },
  };
}

it("saves original workspace/thread/run/identity before network, including after reload", async () => {
  const f = setup();
  await f.actions.enqueue("run-original", f.request);
  expect(f.entry()).toMatchObject({
    workspaceKey: "workspace-a",
    threadId: "thread-a",
    runId: "run-original",
    state: "queued",
    text: f.request.text,
  });
  expect(f.reload().list()).toEqual(f.actions.list());
  expect(f.createActions(f.store, "workspace-b").list()).toEqual([]);
  expect(f.createActions(f.store, "workspace-a", "thread-b").list()).toEqual(
    [],
  );
});

it("losing a response reconciles the accepted receipt without a second POST", async () => {
  const f = setup(),
    queue = f.transport.queue;
  f.transport.queue = async (...args) => {
    await queue(...args);
    throw new TypeError("Lost response");
  };
  await f.actions.enqueue("run-original", f.request);
  expect(f.entry().state).toBe("queued");
  expect(f.queue).toHaveBeenCalledTimes(1);
  expect(f.load).toHaveBeenCalledTimes(1);
});

it("refresh is read-only; an offline reload and concurrent retries keep the original identity", async () => {
  const f = setup();
  f.transport.queue = async () => {
    throw new TypeError("Offline");
  };
  f.load.mockRejectedValue(new TypeError("Offline"));
  await f.actions.enqueue("run-original", f.request);
  const actions = f.reload();
  expect(actions.list()[0]?.state).toBe("uncertain");
  await actions.refresh();
  expect(f.queue).not.toHaveBeenCalled();
  f.transport.queue = f.queue;
  await Promise.all([
    actions.retry(actions.list()[0]!),
    actions.retry(actions.list()[0]!),
  ]);
  expect(f.queue).toHaveBeenCalledTimes(1);
  expect(f.queue).toHaveBeenCalledWith("thread-a", "run-original", f.request);
});

it("recovers a sending record after a renderer interruption without inventing failure or resending", () => {
  const f = setup();
  f.store.save({
    schemaVersion: 1,
    workspaceKey: "workspace-a",
    threadId: "thread-a",
    runId: "old-run",
    id: "pending",
    clientMessageId: "pending",
    state: "sending",
    text: "kept",
    mode: "steering",
    createdAt: "2026-10-29",
  });
  expect(f.reload().list()[0]).toMatchObject({
    state: "uncertain",
    runId: "old-run",
  });
  expect(f.queue).not.toHaveBeenCalled();
});

it("a late queue receipt cannot roll a consumed message back", async () => {
  const f = setup();
  await f.actions.enqueue("run-original", f.request);
  const queued = f.entry().receipt!;
  await f.actions.observe([f.deliver()]);
  await f.actions.observe([queued]);
  expect(f.entry().state).toBe("delivered");
});

it("does not send or clear the composer if durable storage fails", async () => {
  const f = setup(),
    clear = vi.fn();
  f.storage.setItem.mockImplementation(() => {
    throw new Error("Quota");
  });
  expect(await f.actions.enqueue("run-original", f.request, clear)).toBe(false);
  expect(clear).not.toHaveBeenCalled();
  expect(f.queue).not.toHaveBeenCalled();
  expect(f.store.persistenceUnavailable("workspace-a", "thread-a")).toBe(true);
});

it("persists cancellation intent, then resolves a lost cancellation response", async () => {
  const f = setup();
  await f.actions.enqueue("run-original", f.request);
  const cancel = f.transport.cancel;
  f.transport.cancel = async (...args) => {
    expect(
      [...f.data.values()].some((raw) => JSON.parse(raw).cancelRequested),
    ).toBe(true);
    await cancel(...args);
    throw new TypeError("Lost cancel response");
  };
  await f.actions.cancel(f.entry());
  expect(f.entry()).toMatchObject({
    state: "cancelled",
    cancelRequested: false,
  });
  expect(f.cancel).toHaveBeenCalledTimes(1);
  await f.reload().cancel(f.entry());
  expect(f.cancel).toHaveBeenCalledTimes(1);
});

it("consumption winning the cancellation race prevents a replacement", async () => {
  const f = setup();
  await f.actions.enqueue("run-original", f.request);
  f.transport.cancel = async () => {
    f.deliver();
    throw new NapierApiError("Consumed", { status: 409 });
  };
  await f.actions.cancel(f.entry(), true);
  expect(f.entry()).toMatchObject({
    state: "delivered",
    cancelRequested: false,
  });
  await f.actions.replace(f.entry());
  expect(f.queue).toHaveBeenCalledTimes(1);
});

it("cancels before editing, persists edit across reload, and sends a single new identity to the old run", async () => {
  const f = setup();
  await f.actions.enqueue("run-original", f.request);
  await f.actions.cancel(f.entry(), true);
  f.actions.updateEdit(f.entry(), "Replacement text", "steering");
  const actions = f.reload(),
    original = actions.list()[0]!;
  await Promise.all([actions.replace(original), actions.replace(original)]);
  expect(f.queue).toHaveBeenCalledTimes(2);
  expect(f.queue.mock.calls[1]).toEqual([
    "thread-a",
    "run-original",
    {
      clientMessageId: original.edit!.replacementId,
      text: "Replacement text",
      mode: "steering",
    },
  ]);
  expect(original.edit!.replacementId).not.toBe(f.request.clientMessageId);
  await f.reload().replace(original);
  expect(f.queue).toHaveBeenCalledTimes(2);
});

it("never sends a saved cancellation to a newly selected workspace", async () => {
  const f = setup();
  await f.actions.enqueue("run-original", f.request);
  let resolve!: (value: Awaited<ReturnType<typeof f.load>>) => void;
  const waiting = {
    promise: new Promise<Awaited<ReturnType<typeof f.load>>>((done) => {
      resolve = done;
    }),
  };
  f.load.mockImplementationOnce(() => waiting.promise);
  const action = f.actions.cancel(f.entry(), true);
  f.leave();
  resolve([]);
  await action;
  expect(f.cancel).not.toHaveBeenCalled();
  expect(f.entry().cancelRequested).toBe(true);
});

it("shows a rejected send as failed, retaining text and identity", async () => {
  const f = setup();
  f.transport.queue = async () => {
    throw new NapierApiError("Run is terminal", { status: 409 });
  };
  await f.actions.enqueue("old-run", f.request);
  expect(f.entry()).toMatchObject({
    state: "failed",
    text: f.request.text,
    clientMessageId: f.request.clientMessageId,
    runId: "old-run",
  });
});

it("supports cancellation of legacy receipts without inventing retry identities or text", async () => {
  const f = setup();
  const keyed = await f.actions.enqueue("run-original", f.request);
  expect(keyed).toBe(true);
  const receipt = { ...f.entry().receipt!, id: "legacy-id" };
  delete receipt.clientMessageId;
  f.receipts.set(receipt.id, receipt);
  await f.actions.observe([receipt]);
  const legacy = f.actions.list().find((item) => item.id === "legacy-id")!;
  await f.actions.retry(legacy);
  expect(f.queue).toHaveBeenCalledTimes(1);
  await f.actions.cancel(legacy);
  expect(f.store.get(legacy).state).toBe("cancelled");
});

it("refuses mismatched payload receipts and keeps an uncertain record", async () => {
  const f = setup();
  f.transport.queue = async (...args) => ({
    ...(await f.queue(...args)),
    textSha256: "incorrect",
  });
  f.load.mockResolvedValue([]);
  await f.actions.enqueue("run-original", f.request);
  expect(f.entry().state).toBe("uncertain");
  expect(f.entry().receipt).toBeUndefined();
});

it("isolates per-message storage keys across independent tabs", async () => {
  const f = setup(),
    second = f.reload();
  await f.actions.enqueue("run-original", f.request);
  await second.enqueue("run-original", {
    ...f.request,
    clientMessageId: "other-id",
  });
  expect(f.reload().list()).toHaveLength(2);
});

it("recovers legacy text only when its queued event content matches the receipt hash", async () => {
  const f = setup();
  await f.actions.enqueue("run-original", f.request);
  const receipt = { ...f.entry().receipt!, id: "legacy-text" };
  delete receipt.clientMessageId;
  f.receipts.set(receipt.id, receipt);
  await f.actions.observe([receipt]);
  await f.actions.observe([receipt], new Map([[receipt.id, "Wrong text"]]));
  const legacy = f.actions.list().find((item) => item.id === receipt.id)!;
  expect(f.store.get(legacy).text).toBeUndefined();
  await f.actions.observe([receipt], new Map([[receipt.id, f.request.text]]));
  expect(f.store.get(legacy).text).toBe(f.request.text);
  await f.actions.cancel(legacy, true);
  expect(f.store.get(legacy).edit?.text).toBe(f.request.text);
});
