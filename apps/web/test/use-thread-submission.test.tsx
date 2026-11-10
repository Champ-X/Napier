import { createHash } from "node:crypto";
import { parseHTML } from "linkedom";
import { render } from "preact";
import { act } from "preact/test-utils";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import type {
  ThreadDetail,
  RunControlMessage,
  QueueRunControlMessageRequest,
} from "@napier/contracts";
import { useThreadComposer } from "../src/use-thread-composer";
import { useThreadSubmission } from "../src/use-thread-submission";
import { ControlOutbox } from "../src/ControlOutbox";

const api = vi.hoisted(() => ({
  queue: vi.fn(),
  cancel: vi.fn(),
  list: vi.fn(),
}));
vi.mock("../src/thread-run-api", () => ({
  queueRunControlMessage: api.queue,
  cancelRunControlMessage: api.cancel,
  listRunControlMessages: api.list,
}));
let container: HTMLElement, workspace: string, thread: string, running: boolean;
let composer: ReturnType<typeof useThreadComposer>,
  vm: ReturnType<typeof useThreadSubmission>;
let data: Map<string, string>;
let storage: { setItem: ReturnType<typeof vi.fn> };
const error = vi.fn(),
  execute = vi.fn();
function Harness() {
  composer = useThreadComposer(workspace, thread);
  vm = useThreadSubmission({
    workspaceKey: workspace,
    threadId: thread,
    detail: {
      thread: { id: thread },
      runControlMessages: [],
    } as unknown as ThreadDetail,
    composer,
    activeRunId: "original-run",
    isRunning: running,
    blocked: false,
    modelConfigured: true,
    modelUnavailableHint: "Unavailable",
    model: { provider: "test", id: "test" },
    capabilityPreset: undefined,
    execute,
    onStart() {},
    onFinish() {},
    onRefresh: async () => {},
    onError: error,
    onFrame: () => () => {},
    setError() {},
  });
  return <ControlOutbox outbox={vm.controlOutbox} />;
}
function draw() {
  act(() => render(<Harness />, container));
}
function receipt(
  threadId: string,
  runId: string,
  body: QueueRunControlMessageRequest,
): RunControlMessage {
  return {
    kind: "napier.run-control-message",
    schemaVersion: 1,
    id: "control_fixture",
    threadId,
    runId,
    clientMessageId: body.clientMessageId!,
    mode: body.mode,
    status: "queued",
    textBytes: Buffer.byteLength(body.text),
    textSha256: createHash("sha256").update(body.text).digest("hex"),
    queuedAt: "2026-10-29",
    queuedEventSeq: 1,
    contentSha256: "fixture",
  };
}
beforeEach(() => {
  const { window, document } = parseHTML(
    "<html><body><div id=app></div></body></html>",
  );
  data = new Map();
  const session = new Map<string, string>();
  storage = {
    setItem: vi.fn((key: string, value: string) => {
      data.set(key, value);
    }),
  };
  Object.defineProperty(window, "sessionStorage", {
    configurable: true,
    value: {
      get length() {
        return session.size;
      },
      key: (i: number) => [...session.keys()][i] ?? null,
      getItem: (key: string) => session.get(key) ?? null,
      setItem: (key: string, value: string) => {
        session.set(key, value);
      },
      removeItem: (key: string) => {
        session.delete(key);
      },
      clear: () => session.clear(),
    },
  });
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      get length() {
        return data.size;
      },
      key: (i: number) => [...data.keys()][i] ?? null,
      getItem: (key: string) => data.get(key) ?? null,
      setItem: storage.setItem,
    },
  });
  vi.stubGlobal("window", window);
  vi.stubGlobal("document", document);
  container = document.getElementById("app") as unknown as HTMLElement;
  workspace = "workspace-a";
  thread = "thread-a";
  running = true;
  api.queue
    .mockReset()
    .mockImplementation(async (...args) =>
      receipt(...(args as Parameters<typeof receipt>)),
    );
  api.cancel.mockReset();
  api.list.mockReset().mockResolvedValue([]);
  error.mockReset();
  execute.mockReset();
  draw();
});
afterEach(() => {
  act(() => render(null, container));
  vi.unstubAllGlobals();
});

it("suppresses double submit before rerender and preserves new input during an uncertain send", async () => {
  let reject!: (error: Error) => void;
  api.queue.mockImplementation(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
  );
  act(() => composer.setComposer("Original instruction"));
  let pending!: Promise<void>, duplicate!: Promise<void>;
  act(() => {
    pending = vm.submit();
    duplicate = vm.submit();
  });
  expect(api.queue).toHaveBeenCalledTimes(1);
  act(() => composer.setComposer("New input"));
  await act(async () => {
    reject(new Error("Offline"));
    await Promise.all([pending, duplicate]);
  });
  expect(composer.composer).toBe("New input");
  expect(vm.controlOutbox.entries).toHaveLength(1);
  expect(vm.controlOutbox.entries[0]).toMatchObject({
    state: "uncertain",
    text: "Original instruction",
  });
  expect(error).not.toHaveBeenCalled();
});

it("a delayed A response cannot alter B's input, outbox, or errors", async () => {
  let resolve!: (value: RunControlMessage) => void;
  api.queue.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  act(() => composer.setComposer("A instruction"));
  let pending!: Promise<void>;
  act(() => {
    pending = vm.submit();
  });
  thread = "thread-b";
  draw();
  act(() => composer.setComposer("B draft"));
  const args = api.queue.mock.calls[0] as Parameters<typeof receipt>;
  await act(async () => {
    resolve(receipt(...args));
    await pending;
  });
  expect(composer.composer).toBe("B draft");
  expect(vm.controlOutbox.entries).toEqual([]);
  expect(container.textContent).not.toContain("A instruction");
  thread = "thread-a";
  draw();
  expect(vm.controlOutbox.entries[0]?.state).toBe("queued");
  expect(error).not.toHaveBeenCalled();
});

it("A-B-A workspace changes invalidate captured action handles", async () => {
  act(() => composer.setComposer("A instruction"));
  await act(async () => {
    await vm.submit();
  });
  const captured = vm.controlOutbox;
  workspace = "workspace-b";
  draw();
  act(() => composer.setComposer("B workspace input"));
  workspace = "workspace-a";
  draw();
  await act(async () => {
    await captured.actions!.cancel(captured.entries[0]!);
  });
  expect(api.cancel).not.toHaveBeenCalled();
  expect(vm.controlOutbox.entries[0]?.state).toBe("queued");
  workspace = "workspace-b";
  draw();
  expect(composer.composer).toBe("B workspace input");
});

it("quota failure leaves the actual composer unchanged and exposes a storage alert", async () => {
  act(() => composer.setComposer("Keep this input"));
  storage.setItem.mockImplementation((key: string, value: string) => {
    if (key.startsWith("napier.control-outbox")) throw new Error("Quota");
    data.set(key, value);
  });
  await act(async () => {
    await vm.submit();
  });
  expect(composer.composer).toBe("Keep this input");
  expect(api.queue).not.toHaveBeenCalled();
  expect(container.querySelector('[role="alert"]')).not.toBeNull();
});

it("ordinary prompt submission retains its image and draft recovery callbacks", async () => {
  running = false;
  draw();
  act(() => composer.setComposer("Ordinary prompt"));
  execute.mockImplementation(async (input) => {
    input.restoreInput(input.text);
    input.restoreImages();
  });
  await act(async () => {
    await vm.submit();
  });
  expect(execute).toHaveBeenCalledTimes(1);
  expect(composer.composer).toBe("Ordinary prompt");
  expect(api.queue).not.toHaveBeenCalled();
});

it("reuses the same prompt requestId after a failed submit restores the draft", async () => {
  running = false;
  draw();
  act(() => composer.setComposer("Retry this prompt"));
  const requestIds: string[] = [];
  execute.mockImplementation(async (input) => {
    requestIds.push(input.requestId);
    input.restoreInput(input.text);
    input.onError(new Error("transport failed"));
    // Match executeNextRunPrompt: finish(false) on failed restores.
    input.onFinish(false);
  });
  await act(async () => {
    await vm.submit();
  });
  expect(composer.composer).toBe("Retry this prompt");
  await act(async () => {
    await vm.submit();
  });
  expect(execute).toHaveBeenCalledTimes(2);
  expect(requestIds).toHaveLength(2);
  expect(requestIds[0]).toBe(requestIds[1]);
  execute.mockImplementation(async (input) => {
    requestIds.push(input.requestId);
    input.onFinish(true);
  });
  act(() => composer.setComposer("Retry this prompt"));
  await act(async () => {
    await vm.submit();
  });
  expect(requestIds[2]).toBe(requestIds[0]);
  act(() => composer.setComposer("Retry this prompt"));
  await act(async () => {
    await vm.submit();
  });
  expect(requestIds[3]).not.toBe(requestIds[0]);
});

it("reuses a persisted prompt requestId after the submission hook remounts", async () => {
  running = false;
  draw();
  act(() => composer.setComposer("Survive remount"));
  const requestIds: string[] = [];
  execute.mockImplementation(async (input) => {
    requestIds.push(input.requestId);
    input.restoreInput(input.text);
    input.onFinish(false);
  });
  await act(async () => {
    await vm.submit();
  });
  act(() => render(null, container));
  draw();
  act(() => composer.setComposer("Survive remount"));
  await act(async () => {
    await vm.submit();
  });
  expect(requestIds).toHaveLength(2);
  expect(requestIds[0]).toBe(requestIds[1]);
});
