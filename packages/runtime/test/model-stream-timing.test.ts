import {
  createAssistantMessageEventStream,
  fauxAssistantMessage,
  type AssistantMessageEvent,
} from "@earendil-works/pi-ai";
import { expect, it, vi } from "vitest";
import { observeModelStreamTiming } from "../src/model-stream-timing.js";

it("measures first nonempty content and text separately while preserving event and result identity", async () => {
  const source = createAssistantMessageEventStream();
  const partial = fauxAssistantMessage("private token body");
  let clock = 100;
  const observed: AssistantMessageEvent[] = [
    { type: "start", partial },
    { type: "text_delta", contentIndex: 0, delta: "", partial },
    {
      type: "thinking_delta",
      contentIndex: 0,
      delta: "private reasoning",
      partial,
    },
    { type: "toolcall_delta", contentIndex: 0, delta: "{}", partial },
    { type: "text_delta", contentIndex: 0, delta: "visible", partial },
    { type: "done", reason: "stop", message: partial },
  ];
  source[Symbol.asyncIterator] = async function* () {
    for (const event of observed) {
      clock += 10;
      yield event;
    }
  };
  const result = Promise.resolve(partial);
  source.result = () => result;
  const record = vi.fn(async () => undefined);
  const stream = observeModelStreamTiming(
    () => source,
    record,
    () => clock,
  );
  expect(stream.result()).toBe(result);
  const actual = [];
  for await (const event of stream) actual.push(event);
  expect(actual).toHaveLength(observed.length);
  actual.forEach((event, index) => expect(event).toBe(observed[index]));
  expect(await stream.result()).toBe(partial);
  expect(record).toHaveBeenCalledExactlyOnceWith({
    firstContentMs: 30,
    firstContentKind: "thinking",
    firstTextMs: 50,
    elapsedMs: 60,
    terminal: "done",
  });
  expect(JSON.stringify(record.mock.calls)).not.toMatch(/private|visible/);
});

it("does not invent token arrival from metadata or terminal-only responses", async () => {
  for (const terminal of ["done", "error"] as const) {
    const source = createAssistantMessageEventStream(),
      message = fauxAssistantMessage("final only");
    source.push({ type: "start", partial: message });
    source.push(
      terminal === "done"
        ? { type: "done", reason: "stop", message }
        : { type: "error", reason: "aborted", error: message },
    );
    const record = vi.fn(async () => undefined);
    const stream = observeModelStreamTiming(
      () => source,
      record,
      () => 0,
    );
    for await (const _event of stream) {
      /* consume metadata and terminal */
    }
    expect(record).toHaveBeenCalledExactlyOnceWith({
      firstContentMs: null,
      firstContentKind: null,
      firstTextMs: null,
      elapsedMs: 0,
      terminal,
    });
  }
});

it("does not prefetch and forwards iterator closure even when observation fails", async () => {
  const source = createAssistantMessageEventStream(),
    message = fauxAssistantMessage("");
  const closed = vi.fn();
  let pulled = 0;
  source[Symbol.asyncIterator] = async function* () {
    try {
      pulled++;
      yield {
        type: "toolcall_delta",
        contentIndex: 0,
        delta: "{}",
        partial: message,
      };
      pulled++;
      yield { type: "done", reason: "stop", message };
    } finally {
      closed();
    }
  };
  const record = vi.fn(async () => {
    throw new Error("optional telemetry unavailable");
  });
  const stream = observeModelStreamTiming(
    () => source,
    record,
    () => 1,
  );
  expect(pulled).toBe(0);
  for await (const _event of stream) break;
  expect(pulled).toBe(1);
  expect(closed).toHaveBeenCalledTimes(1);
  expect(record).toHaveBeenCalledExactlyOnceWith({
    firstContentMs: 0,
    firstContentKind: "toolcall",
    firstTextMs: null,
    elapsedMs: 0,
    terminal: "closed",
  });
});

it("preserves synchronous dispatch and asynchronous stream exceptions", async () => {
  const failure = new Error("provider failure");
  const record = vi.fn(async () => {
    throw new Error("telemetry failure");
  });
  expect(() =>
    observeModelStreamTiming(() => {
      throw failure;
    }, record),
  ).toThrow(failure);
  expect(record).not.toHaveBeenCalled();
  const source = createAssistantMessageEventStream();
  source[Symbol.asyncIterator] = async function* () {
    throw failure;
  };
  const stream = observeModelStreamTiming(
    () => source,
    record,
    () => 0,
  );
  await expect(
    (async () => {
      for await (const _event of stream) {
        /* no event */
      }
    })(),
  ).rejects.toBe(failure);
  expect(record).toHaveBeenCalledExactlyOnceWith({
    firstContentMs: null,
    firstContentKind: null,
    firstTextMs: null,
    elapsedMs: 0,
    terminal: "exception",
  });
});
