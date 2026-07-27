import { createHash } from "node:crypto";

import type { StreamFrame } from "@napier/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  continueOperatorDecision,
  resumeInterruptedRun,
  streamPrompt,
} from "../src/api";
import {
  formatApiErrorMessage,
  NapierApiError,
  NapierContentHashError,
  NapierContentHashMissingError,
  NapierStreamDoneEventCountError,
  NapierStreamDoneEventStreamHashError,
  NapierStreamDoneSnapshotHashError,
  NapierStreamEventHashError,
  NapierStreamEventSequenceError,
  NapierStreamFrameContractError,
  NapierStreamFrameEventTypeError,
  NapierStreamFrameIdError,
  NapierStreamFrameOrderError,
  NapierStreamFrameParseError,
  NapierStreamRunIdentityError,
  NapierStreamResponseContractError,
  NapierStreamSnapshotEventError,
  NapierStreamSnapshotHashError,
  NapierStreamSnapshotMissingError,
  NapierStreamSnapshotRunError,
  NapierStreamTerminationError,
  NapierStreamThreadIdentityError,
} from "../src/api-error";

type StreamRunEvent = Extract<StreamFrame, { type: "event" }>["event"];
type StreamDoneStatus = Extract<StreamFrame, { type: "done" }>["status"];

describe("streaming Run API client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends prompt requests as JSON and parses SSE records", async () => {
    const frames: StreamFrame[] = [];
    const snapshot = streamSnapshotFrame(
      "thread 1",
      [],
      [streamRunRecord("thread 1", "run_1")],
    );
    const doneFrame = streamDoneFrame("run_1", "completed", snapshot);
    const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
      expect(path).toBe("/api/threads/thread%201/messages");
      expect(init?.method).toBe("POST");
      expect(init?.headers).toEqual({ "Content-Type": "application/json" });
      expect(init?.body).toBe(JSON.stringify({ text: "hello" }));
      return sseResponse(
        [
          ": keepalive",
          "",
          `data: ${JSON.stringify(snapshot)}`,
          "",
          `data: ${JSON.stringify(doneFrame)}`,
          "",
        ].join("\n"),
        { headers: { "X-Napier-Thread-Id": "thread 1" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    await streamPrompt("thread 1", { text: "hello" }, (frame) => {
      frames.push(frame);
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(frames).toEqual([snapshot, doneFrame]);
  });

  it("dispatches a final SSE record even without a trailing blank line", async () => {
    const frames: StreamFrame[] = [];
    const snapshot = streamSnapshotFrame(
      "thread_1",
      [],
      [streamRunRecord("thread_1", "run_2", "failed")],
    );
    const doneFrame = streamDoneFrame("run_2", "failed", snapshot);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse(
          [
            `data: ${JSON.stringify(snapshot)}`,
            "",
            `data: ${JSON.stringify(doneFrame)}`,
          ].join("\n"),
        ),
      ),
    );

    await streamPrompt("thread_1", { text: "finish" }, (frame) => {
      frames.push(frame);
    });

    expect(frames).toEqual([snapshot, doneFrame]);
  });

  it("accepts matching SSE event names for stream frames", async () => {
    const frames: StreamFrame[] = [];
    const snapshot = streamSnapshotFrame(
      "thread_1",
      [],
      [streamRunRecord("thread_1", "run_event")],
    );
    const doneFrame = streamDoneFrame("run_event", "completed", snapshot);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse(
          [
            `event: snapshot\ndata: ${JSON.stringify(snapshot)}`,
            "",
            `event: done\ndata: ${JSON.stringify(doneFrame)}`,
          ].join("\n"),
        ),
      ),
    );

    await streamPrompt("thread_1", { text: "finish" }, (frame) => {
      frames.push(frame);
    });

    expect(frames).toEqual([snapshot, doneFrame]);
  });

  it("rejects SSE event names that drift from frame type", async () => {
    const data = JSON.stringify(
      streamDoneFrame("run_mismatch", "completed", "a".repeat(64)),
    );
    const frames: StreamFrame[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => sseResponse(`event: snapshot\ndata: ${data}`)),
    );

    try {
      await streamPrompt("thread_1", { text: "finish" }, (frame) => {
        frames.push(frame);
      });
      throw new Error("Expected streamPrompt to reject");
    } catch (error) {
      expect(frames).toEqual([]);
      expect(error).toBeInstanceOf(NapierStreamFrameEventTypeError);
      expect(error).toMatchObject({
        name: "NapierStreamFrameEventTypeError",
        message:
          "Stream event type mismatch for /api/threads/thread_1/messages",
        eventType: "snapshot",
        frameType: "done",
        frameSha256: sha256Text(data),
      });
      expect(formatApiErrorMessage(error)).toBe(
        `Stream event type mismatch for /api/threads/thread_1/messages (event snapshot · frame done · body ${sha256Text(data).slice(0, 12)})`,
      );
    }
  });

  it("accepts event frame ids that match event sequence", async () => {
    const frames: StreamFrame[] = [];
    const eventFrame = streamEventFrame(7);
    const snapshot = streamSnapshotFrame("thread_1", streamEventsThrough(7), [
      streamRunRecord("thread_1", "run_1"),
    ]);
    const doneFrame = streamDoneFrame("run_1", "completed", snapshot);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse(
          [
            `id: 7\nevent: event\ndata: ${JSON.stringify(eventFrame)}`,
            "",
            `event: snapshot\ndata: ${JSON.stringify(snapshot)}`,
            "",
            `event: done\ndata: ${JSON.stringify(doneFrame)}`,
          ].join("\n"),
        ),
      ),
    );

    await streamPrompt("thread_1", { text: "finish" }, (frame) => {
      frames.push(frame);
    });

    expect(frames).toEqual([eventFrame, snapshot, doneFrame]);
  });

  it("rejects event frames without content hashes before dispatch", async () => {
    const { eventSha256: _eventSha256, ...eventFrame } = streamEventFrame(7);
    const data = JSON.stringify(eventFrame);
    const onFrame = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => sseResponse(`id: 7\nevent: event\ndata: ${data}`)),
    );

    try {
      await streamPrompt("thread_1", { text: "finish" }, onFrame);
      throw new Error("Expected streamPrompt to reject");
    } catch (error) {
      expect(onFrame).not.toHaveBeenCalled();
      expect(error).toBeInstanceOf(NapierStreamFrameContractError);
      expect(error).toMatchObject({
        name: "NapierStreamFrameContractError",
        message:
          "Invalid stream frame contract for /api/threads/thread_1/messages",
        frameSha256: sha256Text(data),
        lineCount: 1,
        reason: "invalid_event",
      });
    }
  });

  it("rejects event frames whose event hash drifts before dispatch", async () => {
    const eventFrame = {
      ...streamEventFrame(7),
      eventSha256: "0".repeat(64),
    };
    const data = JSON.stringify(eventFrame);
    const onFrame = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => sseResponse(`id: 7\nevent: event\ndata: ${data}`)),
    );

    try {
      await streamPrompt("thread_1", { text: "finish" }, onFrame);
      throw new Error("Expected streamPrompt to reject");
    } catch (error) {
      expect(onFrame).not.toHaveBeenCalled();
      expect(error).toBeInstanceOf(NapierStreamEventHashError);
      expect(error).toMatchObject({
        name: "NapierStreamEventHashError",
        message:
          "Stream event hash mismatch for /api/threads/thread_1/messages",
        expectedSha256: "0".repeat(64),
        actualSha256: sha256Text(JSON.stringify(eventFrame.event)),
        frameSha256: sha256Text(data),
      });
      expect(formatApiErrorMessage(error)).toBe(
        `Stream event hash mismatch for /api/threads/thread_1/messages (expected ${"0".repeat(12)} · actual ${sha256Text(JSON.stringify(eventFrame.event)).slice(0, 12)} · body ${sha256Text(data).slice(0, 12)})`,
      );
    }
  });

  it("accepts strictly increasing event sequence values", async () => {
    const frames: StreamFrame[] = [];
    const firstEvent = streamEventFrame(1);
    const nextEvent = streamEventFrame(3);
    const snapshot = streamSnapshotFrame("thread_1", streamEventsThrough(3), [
      streamRunRecord("thread_1", "run_1"),
    ]);
    const doneFrame = streamDoneFrame("run_1", "completed", snapshot);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse(
          [
            `id: 1\nevent: event\ndata: ${JSON.stringify(firstEvent)}`,
            "",
            `id: 3\nevent: event\ndata: ${JSON.stringify(nextEvent)}`,
            "",
            `event: snapshot\ndata: ${JSON.stringify(snapshot)}`,
            "",
            `event: done\ndata: ${JSON.stringify(doneFrame)}`,
          ].join("\n"),
        ),
      ),
    );

    await streamPrompt("thread_1", { text: "finish" }, (frame) => {
      frames.push(frame);
    });

    expect(frames).toEqual([firstEvent, nextEvent, snapshot, doneFrame]);
  });

  it("rejects duplicate event sequence values before dispatch", async () => {
    const firstEvent = streamEventFrame(10);
    const duplicateEvent = streamEventFrameWithEvent({
      ...streamEventFrame(10).event,
      id: "event_10_duplicate",
      payload: { delta: "again" },
    });
    const duplicateData = JSON.stringify(duplicateEvent);
    const frames: StreamFrame[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse(
          [
            `id: 10\nevent: event\ndata: ${JSON.stringify(firstEvent)}`,
            "",
            `id: 10\nevent: event\ndata: ${duplicateData}`,
            "",
            'event: done\ndata: {"type":"done","runId":"run_duplicate","status":"completed"}',
          ].join("\n"),
        ),
      ),
    );

    try {
      await streamPrompt("thread_1", { text: "finish" }, (frame) => {
        frames.push(frame);
      });
      throw new Error("Expected streamPrompt to reject");
    } catch (error) {
      expect(frames).toEqual([firstEvent]);
      expect(error).toBeInstanceOf(NapierStreamEventSequenceError);
      expect(error).toMatchObject({
        name: "NapierStreamEventSequenceError",
        message:
          "Stream event sequence is not increasing for /api/threads/thread_1/messages",
        previousSeq: 10,
        currentSeq: 10,
        frameSha256: sha256Text(duplicateData),
      });
      expect(formatApiErrorMessage(error)).toBe(
        `Stream event sequence is not increasing for /api/threads/thread_1/messages (previous 10 · current 10 · body ${sha256Text(duplicateData).slice(0, 12)})`,
      );
    }
  });

  it("rejects decreasing event sequence values before dispatch", async () => {
    const firstEvent = streamEventFrame(12);
    const earlierEvent = streamEventFrame(11);
    const earlierData = JSON.stringify(earlierEvent);
    const frames: StreamFrame[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse(
          [
            `id: 12\nevent: event\ndata: ${JSON.stringify(firstEvent)}`,
            "",
            `id: 11\nevent: event\ndata: ${earlierData}`,
            "",
            'event: done\ndata: {"type":"done","runId":"run_decreasing","status":"completed"}',
          ].join("\n"),
        ),
      ),
    );

    try {
      await streamPrompt("thread_1", { text: "finish" }, (frame) => {
        frames.push(frame);
      });
      throw new Error("Expected streamPrompt to reject");
    } catch (error) {
      expect(frames).toEqual([firstEvent]);
      expect(error).toBeInstanceOf(NapierStreamEventSequenceError);
      expect(error).toMatchObject({
        name: "NapierStreamEventSequenceError",
        message:
          "Stream event sequence is not increasing for /api/threads/thread_1/messages",
        previousSeq: 12,
        currentSeq: 11,
        frameSha256: sha256Text(earlierData),
      });
      expect(formatApiErrorMessage(error)).toBe(
        `Stream event sequence is not increasing for /api/threads/thread_1/messages (previous 12 · current 11 · body ${sha256Text(earlierData).slice(0, 12)})`,
      );
    }
  });

  it("rejects event frames for a different thread before dispatch", async () => {
    const eventFrame = streamEventFrameWithEvent({
      ...streamEventFrame(13).event,
      threadId: "thread_other",
    });
    const data = JSON.stringify(eventFrame);
    const frames: StreamFrame[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => sseResponse(`id: 13\nevent: event\ndata: ${data}`)),
    );

    try {
      await streamPrompt("thread_1", { text: "finish" }, (frame) => {
        frames.push(frame);
      });
      throw new Error("Expected streamPrompt to reject");
    } catch (error) {
      expect(frames).toEqual([]);
      expect(error).toBeInstanceOf(NapierStreamThreadIdentityError);
      expect(error).toMatchObject({
        name: "NapierStreamThreadIdentityError",
        message:
          "Stream thread identity mismatch for /api/threads/thread_1/messages",
        frameType: "event",
        expectedThreadId: "thread_1",
        actualThreadId: "thread_other",
        frameSha256: sha256Text(data),
      });
      expect(formatApiErrorMessage(error)).toBe(
        `Stream thread identity mismatch for /api/threads/thread_1/messages (frame event · expected thread_1 · actual thread_other · body ${sha256Text(data).slice(0, 12)})`,
      );
    }
  });

  it("rejects snapshots for a different thread before dispatch", async () => {
    const snapshotFrame = streamSnapshotFrame("thread_other");
    const data = JSON.stringify(snapshotFrame);
    const frames: StreamFrame[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => sseResponse(`event: snapshot\ndata: ${data}`)),
    );

    try {
      await streamPrompt("thread_1", { text: "finish" }, (frame) => {
        frames.push(frame);
      });
      throw new Error("Expected streamPrompt to reject");
    } catch (error) {
      expect(frames).toEqual([]);
      expect(error).toBeInstanceOf(NapierStreamThreadIdentityError);
      expect(error).toMatchObject({
        name: "NapierStreamThreadIdentityError",
        message:
          "Stream thread identity mismatch for /api/threads/thread_1/messages",
        frameType: "snapshot",
        expectedThreadId: "thread_1",
        actualThreadId: "thread_other",
        frameSha256: sha256Text(data),
      });
      expect(formatApiErrorMessage(error)).toBe(
        `Stream thread identity mismatch for /api/threads/thread_1/messages (frame snapshot · expected thread_1 · actual thread_other · body ${sha256Text(data).slice(0, 12)})`,
      );
    }
  });

  it("rejects terminal done frames for a different thread before dispatch", async () => {
    const doneFrame = streamDoneFrame("run_1", "completed", "a".repeat(64), {
      threadId: "thread_other",
    });
    const data = JSON.stringify(doneFrame);
    const frames: StreamFrame[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => sseResponse(`event: done\ndata: ${data}`)),
    );

    try {
      await streamPrompt("thread_1", { text: "finish" }, (frame) => {
        frames.push(frame);
      });
      throw new Error("Expected streamPrompt to reject");
    } catch (error) {
      expect(frames).toEqual([]);
      expect(error).toBeInstanceOf(NapierStreamThreadIdentityError);
      expect(error).toMatchObject({
        name: "NapierStreamThreadIdentityError",
        message:
          "Stream thread identity mismatch for /api/threads/thread_1/messages",
        frameType: "done",
        expectedThreadId: "thread_1",
        actualThreadId: "thread_other",
        frameSha256: sha256Text(data),
      });
      expect(formatApiErrorMessage(error)).toBe(
        `Stream thread identity mismatch for /api/threads/thread_1/messages (frame done · expected thread_1 · actual thread_other · body ${sha256Text(data).slice(0, 12)})`,
      );
    }
  });

  it("rejects snapshot frames without a thread id before dispatch", async () => {
    const snapshotFrame = {
      type: "snapshot",
      detail: { thread: { status: "idle", eventCount: 0 }, events: [] },
    };
    const data = JSON.stringify(snapshotFrame);
    const onFrame = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => sseResponse(`event: snapshot\ndata: ${data}`)),
    );

    try {
      await streamPrompt("thread_1", { text: "finish" }, onFrame);
      throw new Error("Expected streamPrompt to reject");
    } catch (error) {
      expect(onFrame).not.toHaveBeenCalled();
      expect(error).toBeInstanceOf(NapierStreamFrameContractError);
      expect(error).toMatchObject({
        name: "NapierStreamFrameContractError",
        message:
          "Invalid stream frame contract for /api/threads/thread_1/messages",
        frameSha256: sha256Text(data),
        lineCount: 1,
        reason: "invalid_snapshot",
      });
      expect(formatApiErrorMessage(error)).toBe(
        `Invalid stream frame contract for /api/threads/thread_1/messages (invalid_snapshot · frame ${sha256Text(data).slice(0, 12)} · 1 line)`,
      );
    }
  });

  it("rejects snapshot frames with invalid thread status before dispatch", async () => {
    const snapshotFrame = {
      ...streamSnapshotFrame("thread_1"),
      detail: {
        ...streamSnapshotFrame("thread_1").detail,
        thread: {
          ...streamSnapshotFrame("thread_1").detail.thread,
          status: "archived",
        },
      },
    };
    const data = JSON.stringify(snapshotFrame);
    const onFrame = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => sseResponse(`event: snapshot\ndata: ${data}`)),
    );

    try {
      await streamPrompt("thread_1", { text: "finish" }, onFrame);
      throw new Error("Expected streamPrompt to reject");
    } catch (error) {
      expect(onFrame).not.toHaveBeenCalled();
      expect(error).toBeInstanceOf(NapierStreamFrameContractError);
      expect(error).toMatchObject({
        name: "NapierStreamFrameContractError",
        message:
          "Invalid stream frame contract for /api/threads/thread_1/messages",
        frameSha256: sha256Text(data),
        lineCount: 1,
        reason: "invalid_snapshot",
      });
    }
  });

  it("rejects snapshot frames whose eventCount drifts from events before dispatch", async () => {
    const event = streamEventFrame(1).event;
    const snapshotFrame = {
      ...streamSnapshotFrame("thread_1", [event]),
      detail: {
        ...streamSnapshotFrame("thread_1", [event]).detail,
        thread: {
          ...streamSnapshotFrame("thread_1", [event]).detail.thread,
          eventCount: 2,
        },
      },
    };
    const data = JSON.stringify(snapshotFrame);
    const onFrame = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => sseResponse(`event: snapshot\ndata: ${data}`)),
    );

    try {
      await streamPrompt("thread_1", { text: "finish" }, onFrame);
      throw new Error("Expected streamPrompt to reject");
    } catch (error) {
      expect(onFrame).not.toHaveBeenCalled();
      expect(error).toBeInstanceOf(NapierStreamFrameContractError);
      expect(error).toMatchObject({
        name: "NapierStreamFrameContractError",
        message:
          "Invalid stream frame contract for /api/threads/thread_1/messages",
        frameSha256: sha256Text(data),
        lineCount: 1,
        reason: "invalid_snapshot",
      });
    }
  });

  it("rejects snapshot frames without agent identity before dispatch", async () => {
    const snapshotFrame = {
      ...streamSnapshotFrame("thread_1"),
      detail: {
        ...streamSnapshotFrame("thread_1").detail,
        agent: {},
      },
    };
    const data = JSON.stringify(snapshotFrame);
    const onFrame = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => sseResponse(`event: snapshot\ndata: ${data}`)),
    );

    try {
      await streamPrompt("thread_1", { text: "finish" }, onFrame);
      throw new Error("Expected streamPrompt to reject");
    } catch (error) {
      expect(onFrame).not.toHaveBeenCalled();
      expect(error).toBeInstanceOf(NapierStreamFrameContractError);
      expect(error).toMatchObject({
        name: "NapierStreamFrameContractError",
        message:
          "Invalid stream frame contract for /api/threads/thread_1/messages",
        frameSha256: sha256Text(data),
        lineCount: 1,
        reason: "invalid_snapshot",
      });
    }
  });

  it("rejects snapshot frames without required projection arrays before dispatch", async () => {
    const { runs: _runs, ...detailWithoutRuns } =
      streamSnapshotFrame("thread_1").detail;
    const snapshotFrame = {
      type: "snapshot",
      detail: detailWithoutRuns,
    };
    const data = JSON.stringify(snapshotFrame);
    const onFrame = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => sseResponse(`event: snapshot\ndata: ${data}`)),
    );

    try {
      await streamPrompt("thread_1", { text: "finish" }, onFrame);
      throw new Error("Expected streamPrompt to reject");
    } catch (error) {
      expect(onFrame).not.toHaveBeenCalled();
      expect(error).toBeInstanceOf(NapierStreamFrameContractError);
      expect(error).toMatchObject({
        name: "NapierStreamFrameContractError",
        message:
          "Invalid stream frame contract for /api/threads/thread_1/messages",
        frameSha256: sha256Text(data),
        lineCount: 1,
        reason: "invalid_snapshot",
      });
    }
  });

  it("rejects snapshot frames whose agent id drifts from thread before dispatch", async () => {
    const snapshotFrame = {
      ...streamSnapshotFrame("thread_1"),
      detail: {
        ...streamSnapshotFrame("thread_1").detail,
        agent: { id: "agent_other" },
      },
    };
    const data = JSON.stringify(snapshotFrame);
    const onFrame = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => sseResponse(`event: snapshot\ndata: ${data}`)),
    );

    try {
      await streamPrompt("thread_1", { text: "finish" }, onFrame);
      throw new Error("Expected streamPrompt to reject");
    } catch (error) {
      expect(onFrame).not.toHaveBeenCalled();
      expect(error).toBeInstanceOf(NapierStreamFrameContractError);
      expect(error).toMatchObject({
        name: "NapierStreamFrameContractError",
        message:
          "Invalid stream frame contract for /api/threads/thread_1/messages",
        frameSha256: sha256Text(data),
        lineCount: 1,
        reason: "invalid_snapshot",
      });
    }
  });

  it("rejects snapshot frames whose runIds drift from runs before dispatch", async () => {
    const run = streamRunRecord("thread_1", "run_1");
    const snapshot = streamSnapshotFrame("thread_1", [], [run]);
    const snapshotFrame = {
      ...snapshot,
      detail: {
        ...snapshot.detail,
        thread: {
          ...snapshot.detail.thread,
          runIds: ["run_missing"],
        },
      },
    };
    const data = JSON.stringify(snapshotFrame);
    const onFrame = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => sseResponse(`event: snapshot\ndata: ${data}`)),
    );

    try {
      await streamPrompt("thread_1", { text: "finish" }, onFrame);
      throw new Error("Expected streamPrompt to reject");
    } catch (error) {
      expect(onFrame).not.toHaveBeenCalled();
      expect(error).toBeInstanceOf(NapierStreamFrameContractError);
      expect(error).toMatchObject({
        name: "NapierStreamFrameContractError",
        message:
          "Invalid stream frame contract for /api/threads/thread_1/messages",
        frameSha256: sha256Text(data),
        lineCount: 1,
        reason: "invalid_snapshot",
      });
    }
  });

  it("rejects snapshot frames with runs from another thread before dispatch", async () => {
    const run = streamRunRecord("thread_other", "run_1");
    const snapshotFrame = streamSnapshotFrame("thread_1", [], [run]);
    const data = JSON.stringify(snapshotFrame);
    const onFrame = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => sseResponse(`event: snapshot\ndata: ${data}`)),
    );

    try {
      await streamPrompt("thread_1", { text: "finish" }, onFrame);
      throw new Error("Expected streamPrompt to reject");
    } catch (error) {
      expect(onFrame).not.toHaveBeenCalled();
      expect(error).toBeInstanceOf(NapierStreamFrameContractError);
      expect(error).toMatchObject({
        name: "NapierStreamFrameContractError",
        message:
          "Invalid stream frame contract for /api/threads/thread_1/messages",
        frameSha256: sha256Text(data),
        lineCount: 1,
        reason: "invalid_snapshot",
      });
    }
  });

  it("rejects snapshot frames with unknown currentRunId before dispatch", async () => {
    const run = streamRunRecord("thread_1", "run_1");
    const snapshot = streamSnapshotFrame("thread_1", [], [run]);
    const snapshotFrame = {
      ...snapshot,
      detail: {
        ...snapshot.detail,
        thread: {
          ...snapshot.detail.thread,
          currentRunId: "run_missing",
        },
      },
    };
    const data = JSON.stringify(snapshotFrame);
    const onFrame = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => sseResponse(`event: snapshot\ndata: ${data}`)),
    );

    try {
      await streamPrompt("thread_1", { text: "finish" }, onFrame);
      throw new Error("Expected streamPrompt to reject");
    } catch (error) {
      expect(onFrame).not.toHaveBeenCalled();
      expect(error).toBeInstanceOf(NapierStreamFrameContractError);
      expect(error).toMatchObject({
        name: "NapierStreamFrameContractError",
        message:
          "Invalid stream frame contract for /api/threads/thread_1/messages",
        frameSha256: sha256Text(data),
        lineCount: 1,
        reason: "invalid_snapshot",
      });
    }
  });

  it("rejects snapshot frames without detail hash before dispatch", async () => {
    const { detailSha256: _detailSha256, ...snapshotFrame } =
      streamSnapshotFrame("thread_1");
    const data = JSON.stringify(snapshotFrame);
    const onFrame = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => sseResponse(`event: snapshot\ndata: ${data}`)),
    );

    try {
      await streamPrompt("thread_1", { text: "finish" }, onFrame);
      throw new Error("Expected streamPrompt to reject");
    } catch (error) {
      expect(onFrame).not.toHaveBeenCalled();
      expect(error).toBeInstanceOf(NapierStreamFrameContractError);
      expect(error).toMatchObject({
        name: "NapierStreamFrameContractError",
        message:
          "Invalid stream frame contract for /api/threads/thread_1/messages",
        frameSha256: sha256Text(data),
        lineCount: 1,
        reason: "invalid_snapshot",
      });
    }
  });

  it("rejects snapshot frames whose detail hash drifts before dispatch", async () => {
    const snapshotFrame = {
      ...streamSnapshotFrame("thread_1"),
      detailSha256: "0".repeat(64),
    };
    const data = JSON.stringify(snapshotFrame);
    const onFrame = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => sseResponse(`event: snapshot\ndata: ${data}`)),
    );

    try {
      await streamPrompt("thread_1", { text: "finish" }, onFrame);
      throw new Error("Expected streamPrompt to reject");
    } catch (error) {
      expect(onFrame).not.toHaveBeenCalled();
      expect(error).toBeInstanceOf(NapierStreamSnapshotHashError);
      expect(error).toMatchObject({
        name: "NapierStreamSnapshotHashError",
        message:
          "Stream snapshot hash mismatch for /api/threads/thread_1/messages",
        expectedSha256: "0".repeat(64),
        actualSha256: sha256Text(JSON.stringify(snapshotFrame.detail)),
        frameSha256: sha256Text(data),
      });
      expect(formatApiErrorMessage(error)).toBe(
        `Stream snapshot hash mismatch for /api/threads/thread_1/messages (expected ${"0".repeat(12)} · actual ${sha256Text(JSON.stringify(snapshotFrame.detail)).slice(0, 12)} · body ${sha256Text(data).slice(0, 12)})`,
      );
    }
  });

  it("rejects snapshot frames with invalid event records before dispatch", async () => {
    const invalidEvent = {
      ...streamEventFrame(20).event,
      visibility: "operator",
    };
    const snapshotFrame = streamSnapshotFrame("thread_1", [invalidEvent]);
    const data = JSON.stringify(snapshotFrame);
    const onFrame = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => sseResponse(`event: snapshot\ndata: ${data}`)),
    );

    try {
      await streamPrompt("thread_1", { text: "finish" }, onFrame);
      throw new Error("Expected streamPrompt to reject");
    } catch (error) {
      expect(onFrame).not.toHaveBeenCalled();
      expect(error).toBeInstanceOf(NapierStreamFrameContractError);
      expect(error).toMatchObject({
        name: "NapierStreamFrameContractError",
        message:
          "Invalid stream frame contract for /api/threads/thread_1/messages",
        frameSha256: sha256Text(data),
        lineCount: 1,
        reason: "invalid_snapshot",
      });
    }
  });

  it("rejects snapshot frames with cross-thread events before dispatch", async () => {
    const foreignEvent = {
      ...streamEventFrame(1).event,
      threadId: "thread_other",
    };
    const snapshotFrame = streamSnapshotFrame("thread_1", [foreignEvent]);
    const data = JSON.stringify(snapshotFrame);
    const onFrame = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => sseResponse(`event: snapshot\ndata: ${data}`)),
    );

    try {
      await streamPrompt("thread_1", { text: "finish" }, onFrame);
      throw new Error("Expected streamPrompt to reject");
    } catch (error) {
      expect(onFrame).not.toHaveBeenCalled();
      expect(error).toBeInstanceOf(NapierStreamFrameContractError);
      expect(error).toMatchObject({
        name: "NapierStreamFrameContractError",
        message:
          "Invalid stream frame contract for /api/threads/thread_1/messages",
        frameSha256: sha256Text(data),
        lineCount: 1,
        reason: "invalid_snapshot",
      });
    }
  });

  it("rejects snapshot frames with non-increasing event sequence before dispatch", async () => {
    const snapshotFrame = streamSnapshotFrame("thread_1", [
      streamEventFrame(1).event,
      streamEventFrame(1).event,
    ]);
    const data = JSON.stringify(snapshotFrame);
    const onFrame = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => sseResponse(`event: snapshot\ndata: ${data}`)),
    );

    try {
      await streamPrompt("thread_1", { text: "finish" }, onFrame);
      throw new Error("Expected streamPrompt to reject");
    } catch (error) {
      expect(onFrame).not.toHaveBeenCalled();
      expect(error).toBeInstanceOf(NapierStreamFrameContractError);
      expect(error).toMatchObject({
        name: "NapierStreamFrameContractError",
        message:
          "Invalid stream frame contract for /api/threads/thread_1/messages",
        frameSha256: sha256Text(data),
        lineCount: 1,
        reason: "invalid_snapshot",
      });
    }
  });

  it("rejects mixed run identities before dispatching the drifting event", async () => {
    const firstEvent = streamEventFrame(14);
    const driftingEvent = streamEventFrameWithEvent({
      ...streamEventFrame(15).event,
      runId: "run_other",
    });
    const driftingData = JSON.stringify(driftingEvent);
    const frames: StreamFrame[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse(
          [
            `id: 14\nevent: event\ndata: ${JSON.stringify(firstEvent)}`,
            "",
            `id: 15\nevent: event\ndata: ${driftingData}`,
          ].join("\n"),
        ),
      ),
    );

    try {
      await streamPrompt("thread_1", { text: "finish" }, (frame) => {
        frames.push(frame);
      });
      throw new Error("Expected streamPrompt to reject");
    } catch (error) {
      expect(frames).toEqual([firstEvent]);
      expect(error).toBeInstanceOf(NapierStreamRunIdentityError);
      expect(error).toMatchObject({
        name: "NapierStreamRunIdentityError",
        message:
          "Stream run identity mismatch for /api/threads/thread_1/messages",
        frameType: "event",
        expectedRunId: "run_1",
        actualRunId: "run_other",
        frameSha256: sha256Text(driftingData),
      });
      expect(formatApiErrorMessage(error)).toBe(
        `Stream run identity mismatch for /api/threads/thread_1/messages (frame event · expected run_1 · actual run_other · body ${sha256Text(driftingData).slice(0, 12)})`,
      );
    }
  });

  it("rejects terminal done frames whose run id drifts from observed events", async () => {
    const firstEvent = streamEventFrame(16);
    const doneData = JSON.stringify(
      streamDoneFrame("run_other", "completed", "a".repeat(64)),
    );
    const frames: StreamFrame[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse(
          [
            `id: 16\nevent: event\ndata: ${JSON.stringify(firstEvent)}`,
            "",
            `event: done\ndata: ${doneData}`,
          ].join("\n"),
        ),
      ),
    );

    try {
      await streamPrompt("thread_1", { text: "finish" }, (frame) => {
        frames.push(frame);
      });
      throw new Error("Expected streamPrompt to reject");
    } catch (error) {
      expect(frames).toEqual([firstEvent]);
      expect(error).toBeInstanceOf(NapierStreamRunIdentityError);
      expect(error).toMatchObject({
        name: "NapierStreamRunIdentityError",
        message:
          "Stream run identity mismatch for /api/threads/thread_1/messages",
        frameType: "done",
        expectedRunId: "run_1",
        actualRunId: "run_other",
        frameSha256: sha256Text(doneData),
      });
      expect(formatApiErrorMessage(error)).toBe(
        `Stream run identity mismatch for /api/threads/thread_1/messages (frame done · expected run_1 · actual run_other · body ${sha256Text(doneData).slice(0, 12)})`,
      );
    }
  });

  it("rejects event frames without matching SSE id", async () => {
    const eventFrame = streamEventFrame(8);
    const data = JSON.stringify(eventFrame);
    const frames: StreamFrame[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => sseResponse(`event: event\ndata: ${data}`)),
    );

    try {
      await streamPrompt("thread_1", { text: "finish" }, (frame) => {
        frames.push(frame);
      });
      throw new Error("Expected streamPrompt to reject");
    } catch (error) {
      expect(frames).toEqual([]);
      expect(error).toBeInstanceOf(NapierStreamFrameIdError);
      expect(error).toMatchObject({
        name: "NapierStreamFrameIdError",
        message: "Stream frame id mismatch for /api/threads/thread_1/messages",
        frameType: "event",
        expectedId: "8",
        frameSha256: sha256Text(data),
      });
      expect(formatApiErrorMessage(error)).toBe(
        `Stream frame id mismatch for /api/threads/thread_1/messages (frame event · expected 8 · actual absent · body ${sha256Text(data).slice(0, 12)})`,
      );
    }
  });

  it("rejects SSE ids on non-event frames", async () => {
    const data = JSON.stringify(
      streamDoneFrame("run_unexpected_id", "completed", "a".repeat(64)),
    );
    const frames: StreamFrame[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => sseResponse(`id: 9\nevent: done\ndata: ${data}`)),
    );

    try {
      await streamPrompt("thread_1", { text: "finish" }, (frame) => {
        frames.push(frame);
      });
      throw new Error("Expected streamPrompt to reject");
    } catch (error) {
      expect(frames).toEqual([]);
      expect(error).toBeInstanceOf(NapierStreamFrameIdError);
      expect(error).toMatchObject({
        name: "NapierStreamFrameIdError",
        message: "Stream frame id mismatch for /api/threads/thread_1/messages",
        frameType: "done",
        expectedId: "absent",
        actualId: "9",
        frameSha256: sha256Text(data),
      });
      expect(formatApiErrorMessage(error)).toBe(
        `Stream frame id mismatch for /api/threads/thread_1/messages (frame done · expected absent · actual 9 · body ${sha256Text(data).slice(0, 12)})`,
      );
    }
  });

  it("reports malformed SSE frames with hash-only diagnostics", async () => {
    const malformedData = ['{"type":"done",', '"runId":'].join("\n");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse(['data: {"type":"done",', 'data: "runId":', ""].join("\n")),
      ),
    );

    try {
      await streamPrompt("thread_1", { text: "hello" }, () => {});
      throw new Error("Expected streamPrompt to reject");
    } catch (error) {
      expect(error).toBeInstanceOf(NapierStreamFrameParseError);
      expect(error).toMatchObject({
        name: "NapierStreamFrameParseError",
        message: "Invalid stream frame for /api/threads/thread_1/messages",
        frameSha256: sha256Text(malformedData),
        lineCount: 2,
      });
      expect(formatApiErrorMessage(error)).toBe(
        `Invalid stream frame for /api/threads/thread_1/messages (frame ${sha256Text(malformedData).slice(0, 12)} · 2 lines)`,
      );
      expect(formatApiErrorMessage(error)).not.toContain("runId");
    }
  });

  it("rejects structurally invalid SSE frames before dispatch", async () => {
    const invalidFrame = {
      type: "done",
      runId: "run_bad",
      status: "unknown",
    };
    const data = JSON.stringify(invalidFrame);
    const onFrame = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => sseResponse(`data: ${data}`)),
    );

    try {
      await streamPrompt("thread_1", { text: "hello" }, onFrame);
      throw new Error("Expected streamPrompt to reject");
    } catch (error) {
      expect(onFrame).not.toHaveBeenCalled();
      expect(error).toBeInstanceOf(NapierStreamFrameContractError);
      expect(error).toMatchObject({
        name: "NapierStreamFrameContractError",
        message:
          "Invalid stream frame contract for /api/threads/thread_1/messages",
        frameSha256: sha256Text(data),
        lineCount: 1,
        reason: "invalid_done",
      });
      expect(formatApiErrorMessage(error)).toBe(
        `Invalid stream frame contract for /api/threads/thread_1/messages (invalid_done · frame ${sha256Text(data).slice(0, 12)} · 1 line)`,
      );
      expect(formatApiErrorMessage(error)).not.toContain("run_bad");
    }
  });

  it("rejects done frames with non-terminal run status before dispatch", async () => {
    const invalidFrame = {
      type: "done",
      runId: "run_running",
      status: "running",
    };
    const data = JSON.stringify(invalidFrame);
    const onFrame = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => sseResponse(`event: done\ndata: ${data}`)),
    );

    try {
      await streamPrompt("thread_1", { text: "hello" }, onFrame);
      throw new Error("Expected streamPrompt to reject");
    } catch (error) {
      expect(onFrame).not.toHaveBeenCalled();
      expect(error).toBeInstanceOf(NapierStreamFrameContractError);
      expect(error).toMatchObject({
        name: "NapierStreamFrameContractError",
        message:
          "Invalid stream frame contract for /api/threads/thread_1/messages",
        frameSha256: sha256Text(data),
        lineCount: 1,
        reason: "invalid_done",
      });
      expect(formatApiErrorMessage(error)).toBe(
        `Invalid stream frame contract for /api/threads/thread_1/messages (invalid_done · frame ${sha256Text(data).slice(0, 12)} · 1 line)`,
      );
    }
  });

  it("rejects event frames with non-integer sequence values before dispatch", async () => {
    const invalidFrame = {
      ...streamEventFrame(17),
      event: {
        ...streamEventFrame(17).event,
        seq: 17.5,
      },
    };
    const data = JSON.stringify(invalidFrame);
    const onFrame = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => sseResponse(`id: 17.5\nevent: event\ndata: ${data}`)),
    );

    try {
      await streamPrompt("thread_1", { text: "hello" }, onFrame);
      throw new Error("Expected streamPrompt to reject");
    } catch (error) {
      expect(onFrame).not.toHaveBeenCalled();
      expect(error).toBeInstanceOf(NapierStreamFrameContractError);
      expect(error).toMatchObject({
        name: "NapierStreamFrameContractError",
        message:
          "Invalid stream frame contract for /api/threads/thread_1/messages",
        frameSha256: sha256Text(data),
        lineCount: 1,
        reason: "invalid_event",
      });
      expect(formatApiErrorMessage(error)).toBe(
        `Invalid stream frame contract for /api/threads/thread_1/messages (invalid_event · frame ${sha256Text(data).slice(0, 12)} · 1 line)`,
      );
    }
  });

  it("rejects event frames with unsupported categories before dispatch", async () => {
    const invalidFrame = {
      ...streamEventFrame(18),
      event: {
        ...streamEventFrame(18).event,
        category: "memory_fact",
      },
    };
    const data = JSON.stringify(invalidFrame);
    const onFrame = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => sseResponse(`id: 18\nevent: event\ndata: ${data}`)),
    );

    try {
      await streamPrompt("thread_1", { text: "hello" }, onFrame);
      throw new Error("Expected streamPrompt to reject");
    } catch (error) {
      expect(onFrame).not.toHaveBeenCalled();
      expect(error).toBeInstanceOf(NapierStreamFrameContractError);
      expect(error).toMatchObject({
        name: "NapierStreamFrameContractError",
        message:
          "Invalid stream frame contract for /api/threads/thread_1/messages",
        frameSha256: sha256Text(data),
        lineCount: 1,
        reason: "invalid_event",
      });
    }
  });

  it("rejects event frames with unsupported visibility before dispatch", async () => {
    const invalidFrame = {
      ...streamEventFrame(19),
      event: {
        ...streamEventFrame(19).event,
        visibility: "operator",
      },
    };
    const data = JSON.stringify(invalidFrame);
    const onFrame = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => sseResponse(`id: 19\nevent: event\ndata: ${data}`)),
    );

    try {
      await streamPrompt("thread_1", { text: "hello" }, onFrame);
      throw new Error("Expected streamPrompt to reject");
    } catch (error) {
      expect(onFrame).not.toHaveBeenCalled();
      expect(error).toBeInstanceOf(NapierStreamFrameContractError);
      expect(error).toMatchObject({
        name: "NapierStreamFrameContractError",
        message:
          "Invalid stream frame contract for /api/threads/thread_1/messages",
        frameSha256: sha256Text(data),
        lineCount: 1,
        reason: "invalid_event",
      });
    }
  });

  it("dispatches runtime error frames as valid protocol frames", async () => {
    const frames: StreamFrame[] = [];
    const diagnosticSha256 = "a".repeat(64);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse(
          `data: ${JSON.stringify({
            type: "error",
            threadId: "thread_1",
            message: "Run failed while streaming.",
            code: "run_failed",
            diagnosticSha256,
          })}`,
        ),
      ),
    );

    await streamPrompt("thread_1", { text: "hello" }, (frame) => {
      frames.push(frame);
    });

    expect(frames).toEqual([
      {
        type: "error",
        threadId: "thread_1",
        message: "Run failed while streaming.",
        code: "run_failed",
        diagnosticSha256,
      },
    ]);
  });

  it("rejects runtime error frames for a different thread before dispatch", async () => {
    const errorFrame = {
      type: "error",
      threadId: "thread_other",
      message: "Run failed while streaming.",
      code: "run_failed",
      diagnosticSha256: "a".repeat(64),
    };
    const data = JSON.stringify(errorFrame);
    const frames: StreamFrame[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => sseResponse(`event: error\ndata: ${data}`)),
    );

    try {
      await streamPrompt("thread_1", { text: "hello" }, (frame) => {
        frames.push(frame);
      });
      throw new Error("Expected streamPrompt to reject");
    } catch (error) {
      expect(frames).toEqual([]);
      expect(error).toBeInstanceOf(NapierStreamThreadIdentityError);
      expect(error).toMatchObject({
        name: "NapierStreamThreadIdentityError",
        message:
          "Stream thread identity mismatch for /api/threads/thread_1/messages",
        frameType: "error",
        expectedThreadId: "thread_1",
        actualThreadId: "thread_other",
        frameSha256: sha256Text(data),
      });
      expect(formatApiErrorMessage(error)).toBe(
        `Stream thread identity mismatch for /api/threads/thread_1/messages (frame error · expected thread_1 · actual thread_other · body ${sha256Text(data).slice(0, 12)})`,
      );
    }
  });

  it("rejects streaming responses without the declared error-frame protocol", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse(
          'data: {"type":"done","runId":"run_4","status":"completed"}',
          {
            headers: {
              "X-Napier-Stream-Error-Code": "legacy_error",
            },
          },
        ),
      ),
    );

    try {
      await streamPrompt("thread_1", { text: "hello" }, () => {});
      throw new Error("Expected streamPrompt to reject");
    } catch (error) {
      expect(error).toBeInstanceOf(NapierStreamResponseContractError);
      expect(error).toMatchObject({
        name: "NapierStreamResponseContractError",
        message:
          "Invalid stream response contract for /api/threads/thread_1/messages: x-napier-stream-error-code",
        status: 200,
        header: "x-napier-stream-error-code",
        expected: "run_failed",
        actual: "legacy_error",
      });
      expect(formatApiErrorMessage(error)).toBe(
        "Invalid stream response contract for /api/threads/thread_1/messages: x-napier-stream-error-code (HTTP 200 · expected run_failed · actual legacy_error)",
      );
    }
  });

  it("verifies resume stream intent headers before dispatch", async () => {
    const frames: StreamFrame[] = [];
    const snapshot = streamSnapshotFrame(
      "thread_1",
      [],
      [streamRunRecord("thread_1", "run_5")],
    );
    const doneFrame = streamDoneFrame("run_5", "completed", snapshot);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string, init?: RequestInit) => {
        expect(path).toBe("/api/threads/thread_1/resume");
        expect(init?.body).toBe(
          JSON.stringify({
            runId: "run_5",
            model: { provider: "faux", id: "model_1" },
          }),
        );
        return sseResponse(
          [
            `data: ${JSON.stringify(snapshot)}`,
            "",
            `data: ${JSON.stringify(doneFrame)}`,
          ].join("\n"),
          {
            headers: {
              "X-Napier-Prompt-Requested": null,
              "X-Napier-Resume-Requested": "true",
              "X-Napier-Run-Id": "run_5",
              "X-Napier-Model-Provider": "faux",
              "X-Napier-Model-Id": "model_1",
            },
          },
        );
      }),
    );

    await resumeInterruptedRun(
      "thread_1",
      {
        runId: "run_5",
        model: { provider: "faux", id: "model_1" },
      },
      (frame) => frames.push(frame),
    );

    expect(frames).toEqual([snapshot, doneFrame]);
  });

  it("verifies operator decision continuation stream headers", async () => {
    const frames: StreamFrame[] = [];
    const snapshot = streamSnapshotFrame(
      "thread_1",
      [],
      [streamRunRecord("thread_1", "run_decision")],
    );
    const doneFrame = streamDoneFrame("run_decision", "completed", snapshot);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string, init?: RequestInit) => {
        expect(path).toBe(
          "/api/threads/thread_1/operator-decisions/decision_1/continue",
        );
        expect(init?.body).toBe("{}");
        return sseResponse(
          [
            `data: ${JSON.stringify(snapshot)}`,
            "",
            `data: ${JSON.stringify(doneFrame)}`,
          ].join("\n"),
          {
            headers: {
              "X-Napier-Prompt-Requested": null,
              "X-Napier-Operator-Decision-Id": "decision_1",
            },
          },
        );
      }),
    );

    await continueOperatorDecision("thread_1", "decision_1", (frame) =>
      frames.push(frame),
    );

    expect(frames).toEqual([snapshot, doneFrame]);
  });

  it("rejects completed streams that omit the final snapshot before dispatching done", async () => {
    const data = JSON.stringify(
      streamDoneFrame("run_missing_snapshot", "completed", "a".repeat(64)),
    );
    const frames: StreamFrame[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => sseResponse(`event: done\ndata: ${data}`)),
    );

    try {
      await streamPrompt("thread_1", { text: "finish" }, (frame) => {
        frames.push(frame);
      });
      throw new Error("Expected streamPrompt to reject");
    } catch (error) {
      expect(frames).toEqual([]);
      expect(error).toBeInstanceOf(NapierStreamSnapshotMissingError);
      expect(error).toMatchObject({
        name: "NapierStreamSnapshotMissingError",
        message:
          "Stream completed without final snapshot for /api/threads/thread_1/messages",
        frameCount: 0,
        runId: "run_missing_snapshot",
        status: "completed",
        frameSha256: sha256Text(data),
      });
      expect(formatApiErrorMessage(error)).toBe(
        `Stream completed without final snapshot for /api/threads/thread_1/messages (0 frames · run run_missing_snapshot · status completed · body ${sha256Text(data).slice(0, 12)})`,
      );
    }
  });

  it("rejects completed streams whose done snapshot hash drifts", async () => {
    const snapshot = streamSnapshotFrame(
      "thread_1",
      [],
      [streamRunRecord("thread_1", "run_1")],
    );
    const doneFrame = streamDoneFrame("run_1", "completed", "0".repeat(64));
    const data = JSON.stringify(doneFrame);
    const frames: StreamFrame[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse(
          [
            `event: snapshot\ndata: ${JSON.stringify(snapshot)}`,
            "",
            `event: done\ndata: ${data}`,
          ].join("\n"),
        ),
      ),
    );

    try {
      await streamPrompt("thread_1", { text: "finish" }, (frame) => {
        frames.push(frame);
      });
      throw new Error("Expected streamPrompt to reject");
    } catch (error) {
      expect(frames).toEqual([snapshot]);
      expect(error).toBeInstanceOf(NapierStreamDoneSnapshotHashError);
      expect(error).toMatchObject({
        name: "NapierStreamDoneSnapshotHashError",
        message:
          "Stream done snapshot hash mismatch for /api/threads/thread_1/messages",
        expectedSha256: snapshot.detailSha256,
        actualSha256: "0".repeat(64),
        frameSha256: sha256Text(data),
      });
      expect(formatApiErrorMessage(error)).toBe(
        `Stream done snapshot hash mismatch for /api/threads/thread_1/messages (expected ${snapshot.detailSha256.slice(0, 12)} · actual ${"0".repeat(12)} · body ${sha256Text(data).slice(0, 12)})`,
      );
    }
  });

  it("rejects completed streams whose done event count drifts", async () => {
    const snapshot = streamSnapshotFrame(
      "thread_1",
      [streamEventFrame(1).event],
      [streamRunRecord("thread_1", "run_1")],
    );
    const doneFrame = {
      ...streamDoneFrame("run_1", "completed", snapshot),
      eventCount: 2,
    };
    const data = JSON.stringify(doneFrame);
    const frames: StreamFrame[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse(
          [
            `event: snapshot\ndata: ${JSON.stringify(snapshot)}`,
            "",
            `event: done\ndata: ${data}`,
          ].join("\n"),
        ),
      ),
    );

    try {
      await streamPrompt("thread_1", { text: "finish" }, (frame) => {
        frames.push(frame);
      });
      throw new Error("Expected streamPrompt to reject");
    } catch (error) {
      expect(frames).toEqual([snapshot]);
      expect(error).toBeInstanceOf(NapierStreamDoneEventCountError);
      expect(error).toMatchObject({
        name: "NapierStreamDoneEventCountError",
        message:
          "Stream done event count mismatch for /api/threads/thread_1/messages",
        expectedEventCount: 1,
        actualEventCount: 2,
        snapshotSha256: snapshot.detailSha256,
        frameSha256: sha256Text(data),
      });
      expect(formatApiErrorMessage(error)).toBe(
        `Stream done event count mismatch for /api/threads/thread_1/messages (expected 1 · actual 2 · snapshot ${snapshot.detailSha256.slice(0, 12)} · body ${sha256Text(data).slice(0, 12)})`,
      );
    }
  });

  it("rejects completed streams whose done event-stream hash drifts", async () => {
    const snapshot = streamSnapshotFrame(
      "thread_1",
      [streamEventFrame(1).event],
      [streamRunRecord("thread_1", "run_1")],
    );
    const doneFrame = {
      ...streamDoneFrame("run_1", "completed", snapshot),
      eventStreamSha256: "0".repeat(64),
    };
    const data = JSON.stringify(doneFrame);
    const expectedSha256 = sha256Text(
      snapshot.detail.events.map((event) => JSON.stringify(event)).join("\n"),
    );
    const frames: StreamFrame[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse(
          [
            `event: snapshot\ndata: ${JSON.stringify(snapshot)}`,
            "",
            `event: done\ndata: ${data}`,
          ].join("\n"),
        ),
      ),
    );

    try {
      await streamPrompt("thread_1", { text: "finish" }, (frame) => {
        frames.push(frame);
      });
      throw new Error("Expected streamPrompt to reject");
    } catch (error) {
      expect(frames).toEqual([snapshot]);
      expect(error).toBeInstanceOf(NapierStreamDoneEventStreamHashError);
      expect(error).toMatchObject({
        name: "NapierStreamDoneEventStreamHashError",
        message:
          "Stream done event-stream hash mismatch for /api/threads/thread_1/messages",
        expectedSha256,
        actualSha256: "0".repeat(64),
        frameSha256: sha256Text(data),
      });
      expect(formatApiErrorMessage(error)).toBe(
        `Stream done event-stream hash mismatch for /api/threads/thread_1/messages (expected ${expectedSha256.slice(0, 12)} · actual ${"0".repeat(12)} · body ${sha256Text(data).slice(0, 12)})`,
      );
    }
  });

  it("rejects completed streams whose final snapshot is missing the done run", async () => {
    const snapshot = streamSnapshotFrame(
      "thread_1",
      [],
      [streamRunRecord("thread_1", "run_other")],
    );
    const data = JSON.stringify(
      streamDoneFrame("run_missing", "completed", snapshot),
    );
    const frames: StreamFrame[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse(
          [
            `event: snapshot\ndata: ${JSON.stringify(snapshot)}`,
            "",
            `event: done\ndata: ${data}`,
          ].join("\n"),
        ),
      ),
    );

    try {
      await streamPrompt("thread_1", { text: "finish" }, (frame) => {
        frames.push(frame);
      });
      throw new Error("Expected streamPrompt to reject");
    } catch (error) {
      expect(frames).toEqual([snapshot]);
      expect(error).toBeInstanceOf(NapierStreamSnapshotRunError);
      expect(error).toMatchObject({
        name: "NapierStreamSnapshotRunError",
        message:
          "Stream final snapshot does not match done frame for /api/threads/thread_1/messages",
        reason: "run_missing",
        runId: "run_missing",
        doneStatus: "completed",
        snapshotSha256: snapshot.detailSha256,
        frameSha256: sha256Text(data),
      });
      expect(formatApiErrorMessage(error)).toBe(
        `Stream final snapshot does not match done frame for /api/threads/thread_1/messages (run_missing · run run_missing · done completed · snapshot missing · snapshot ${snapshot.detailSha256.slice(0, 12)} · body ${sha256Text(data).slice(0, 12)})`,
      );
    }
  });

  it("rejects completed streams whose final snapshot run status drifts from done", async () => {
    const snapshot = streamSnapshotFrame(
      "thread_1",
      [],
      [streamRunRecord("thread_1", "run_1", "completed")],
    );
    const data = JSON.stringify(streamDoneFrame("run_1", "failed", snapshot));
    const frames: StreamFrame[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse(
          [
            `event: snapshot\ndata: ${JSON.stringify(snapshot)}`,
            "",
            `event: done\ndata: ${data}`,
          ].join("\n"),
        ),
      ),
    );

    try {
      await streamPrompt("thread_1", { text: "finish" }, (frame) => {
        frames.push(frame);
      });
      throw new Error("Expected streamPrompt to reject");
    } catch (error) {
      expect(frames).toEqual([snapshot]);
      expect(error).toBeInstanceOf(NapierStreamSnapshotRunError);
      expect(error).toMatchObject({
        name: "NapierStreamSnapshotRunError",
        message:
          "Stream final snapshot does not match done frame for /api/threads/thread_1/messages",
        reason: "status_mismatch",
        runId: "run_1",
        doneStatus: "failed",
        snapshotStatus: "completed",
        snapshotSha256: snapshot.detailSha256,
        frameSha256: sha256Text(data),
      });
      expect(formatApiErrorMessage(error)).toBe(
        `Stream final snapshot does not match done frame for /api/threads/thread_1/messages (status_mismatch · run run_1 · done failed · snapshot completed · snapshot ${snapshot.detailSha256.slice(0, 12)} · body ${sha256Text(data).slice(0, 12)})`,
      );
    }
  });

  it("rejects final snapshots that omit already streamed events before dispatch", async () => {
    const eventFrame = streamEventFrame(1);
    const snapshot = streamSnapshotFrame(
      "thread_1",
      [],
      [streamRunRecord("thread_1", "run_1")],
    );
    const snapshotData = JSON.stringify(snapshot);
    const doneFrame = streamDoneFrame("run_1", "completed", snapshot);
    const frames: StreamFrame[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse(
          [
            `id: 1\nevent: event\ndata: ${JSON.stringify(eventFrame)}`,
            "",
            `event: snapshot\ndata: ${snapshotData}`,
            "",
            `event: done\ndata: ${JSON.stringify(doneFrame)}`,
          ].join("\n"),
        ),
      ),
    );

    try {
      await streamPrompt("thread_1", { text: "finish" }, (frame) => {
        frames.push(frame);
      });
      throw new Error("Expected streamPrompt to reject");
    } catch (error) {
      expect(frames).toEqual([eventFrame]);
      expect(error).toBeInstanceOf(NapierStreamSnapshotEventError);
      expect(error).toMatchObject({
        name: "NapierStreamSnapshotEventError",
        message:
          "Stream final snapshot does not match streamed event for /api/threads/thread_1/messages",
        reason: "event_missing",
        seq: 1,
        expectedSha256: eventFrame.eventSha256,
        snapshotSha256: snapshot.detailSha256,
        frameSha256: sha256Text(snapshotData),
      });
      expect(formatApiErrorMessage(error)).toBe(
        `Stream final snapshot does not match streamed event for /api/threads/thread_1/messages (event_missing · seq 1 · expected ${eventFrame.eventSha256.slice(0, 12)} · actual missing · snapshot ${snapshot.detailSha256.slice(0, 12)} · body ${sha256Text(snapshotData).slice(0, 12)})`,
      );
    }
  });

  it("rejects final snapshots whose event body drifts from the streamed event", async () => {
    const eventFrame = streamEventFrame(1);
    const driftedEvent = {
      ...eventFrame.event,
      payload: { delta: "stale" },
    };
    const snapshot = streamSnapshotFrame(
      "thread_1",
      [driftedEvent],
      [streamRunRecord("thread_1", "run_1")],
    );
    const snapshotData = JSON.stringify(snapshot);
    const doneFrame = streamDoneFrame("run_1", "completed", snapshot);
    const frames: StreamFrame[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse(
          [
            `id: 1\nevent: event\ndata: ${JSON.stringify(eventFrame)}`,
            "",
            `event: snapshot\ndata: ${snapshotData}`,
            "",
            `event: done\ndata: ${JSON.stringify(doneFrame)}`,
          ].join("\n"),
        ),
      ),
    );

    try {
      await streamPrompt("thread_1", { text: "finish" }, (frame) => {
        frames.push(frame);
      });
      throw new Error("Expected streamPrompt to reject");
    } catch (error) {
      const actualSha256 = sha256Text(JSON.stringify(driftedEvent));
      expect(frames).toEqual([eventFrame]);
      expect(error).toBeInstanceOf(NapierStreamSnapshotEventError);
      expect(error).toMatchObject({
        name: "NapierStreamSnapshotEventError",
        message:
          "Stream final snapshot does not match streamed event for /api/threads/thread_1/messages",
        reason: "event_mismatch",
        seq: 1,
        expectedSha256: eventFrame.eventSha256,
        actualSha256,
        snapshotSha256: snapshot.detailSha256,
        frameSha256: sha256Text(snapshotData),
      });
      expect(formatApiErrorMessage(error)).toBe(
        `Stream final snapshot does not match streamed event for /api/threads/thread_1/messages (event_mismatch · seq 1 · expected ${eventFrame.eventSha256.slice(0, 12)} · actual ${actualSha256.slice(0, 12)} · snapshot ${snapshot.detailSha256.slice(0, 12)} · body ${sha256Text(snapshotData).slice(0, 12)})`,
      );
    }
  });

  it("rejects done frames when events arrive after the final snapshot", async () => {
    const firstEvent = streamEventFrame(1);
    const lateEvent = streamEventFrame(2);
    const snapshot = streamSnapshotFrame(
      "thread_1",
      [firstEvent.event],
      [streamRunRecord("thread_1", "run_1")],
    );
    const doneData = JSON.stringify(
      streamDoneFrame("run_1", "completed", snapshot),
    );
    const frames: StreamFrame[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse(
          [
            `id: 1\nevent: event\ndata: ${JSON.stringify(firstEvent)}`,
            "",
            `event: snapshot\ndata: ${JSON.stringify(snapshot)}`,
            "",
            `id: 2\nevent: event\ndata: ${JSON.stringify(lateEvent)}`,
            "",
            `event: done\ndata: ${doneData}`,
          ].join("\n"),
        ),
      ),
    );

    try {
      await streamPrompt("thread_1", { text: "finish" }, (frame) => {
        frames.push(frame);
      });
      throw new Error("Expected streamPrompt to reject");
    } catch (error) {
      expect(frames).toEqual([firstEvent, snapshot, lateEvent]);
      expect(error).toBeInstanceOf(NapierStreamSnapshotEventError);
      expect(error).toMatchObject({
        name: "NapierStreamSnapshotEventError",
        message:
          "Stream final snapshot does not match streamed event for /api/threads/thread_1/messages",
        reason: "event_missing",
        seq: 2,
        expectedSha256: lateEvent.eventSha256,
        snapshotSha256: snapshot.detailSha256,
        frameSha256: sha256Text(doneData),
      });
    }
  });

  it("rejects streams that close without a terminal frame", async () => {
    const frames: StreamFrame[] = [];
    const snapshot = streamSnapshotFrame("thread_1");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => sseResponse(`data: ${JSON.stringify(snapshot)}`)),
    );

    try {
      await streamPrompt("thread_1", { text: "hello" }, (frame) => {
        frames.push(frame);
      });
      throw new Error("Expected streamPrompt to reject");
    } catch (error) {
      expect(frames).toEqual([snapshot]);
      expect(error).toBeInstanceOf(NapierStreamTerminationError);
      expect(error).toMatchObject({
        name: "NapierStreamTerminationError",
        message:
          "Stream ended without terminal frame for /api/threads/thread_1/messages",
        frameCount: 1,
        lastFrameType: "snapshot",
      });
      expect(formatApiErrorMessage(error)).toBe(
        "Stream ended without terminal frame for /api/threads/thread_1/messages (1 frame · last snapshot)",
      );
    }
  });

  it("rejects semantic frames emitted after the terminal frame", async () => {
    const frames: StreamFrame[] = [];
    const snapshot = streamSnapshotFrame(
      "thread_1",
      [],
      [streamRunRecord("thread_1", "run_6")],
    );
    const doneFrame = streamDoneFrame("run_6", "completed", snapshot);
    const lateSnapshot = streamSnapshotFrame("thread_1");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse(
          [
            `data: ${JSON.stringify(snapshot)}`,
            "",
            `data: ${JSON.stringify(doneFrame)}`,
            "",
            `data: ${JSON.stringify(lateSnapshot)}`,
          ].join("\n"),
        ),
      ),
    );

    try {
      await streamPrompt("thread_1", { text: "hello" }, (frame) => {
        frames.push(frame);
      });
      throw new Error("Expected streamPrompt to reject");
    } catch (error) {
      expect(frames).toEqual([snapshot, doneFrame]);
      expect(error).toBeInstanceOf(NapierStreamFrameOrderError);
      expect(error).toMatchObject({
        name: "NapierStreamFrameOrderError",
        message:
          "Stream emitted a frame after terminal frame for /api/threads/thread_1/messages",
        frameCount: 2,
        terminalFrameType: "done",
        nextFrameType: "snapshot",
      });
      expect(formatApiErrorMessage(error)).toBe(
        "Stream emitted a frame after terminal frame for /api/threads/thread_1/messages (2 frames · terminal done · next snapshot)",
      );
    }
  });

  it("does not wrap consumer callback failures as malformed stream frames", async () => {
    const callbackError = new Error("consumer failed");
    const snapshot = streamSnapshotFrame("thread_1");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => sseResponse(`data: ${JSON.stringify(snapshot)}`)),
    );

    await expect(
      streamPrompt("thread_1", { text: "hello" }, () => {
        throw callbackError;
      }),
    ).rejects.toBe(callbackError);
  });

  it("wraps non-OK pre-stream responses as NapierApiError", async () => {
    const body = {};
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_path: string, init?: RequestInit) => {
        expect(init?.body).toBe(JSON.stringify({ runId: "run_1" }));
        return jsonResponse(body, {
          status: 502,
          headers: {
            "X-Napier-Content-SHA256": sha256Text(JSON.stringify(body)),
            "X-Napier-Content-SHA256-Mode": "body",
          },
        });
      }),
    );

    try {
      await resumeInterruptedRun("thread_1", { runId: "run_1" }, () => {});
      throw new Error("Expected resumeInterruptedRun to reject");
    } catch (error) {
      expect(error).toBeInstanceOf(NapierApiError);
      expect(formatApiErrorMessage(error)).toBe(
        `Run failed with 502 (HTTP 502 · body ${sha256Text(JSON.stringify(body)).slice(0, 12)})`,
      );
    }
  });

  it("verifies hash-bound pre-stream JSON error responses", async () => {
    const body = { error: "Run request is invalid" };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(body, {
          status: 400,
          headers: {
            "X-Napier-Content-SHA256": sha256Text(JSON.stringify(body)),
            "X-Napier-Error-Code": "invalid_request",
            "X-Napier-Error-Message-SHA256": sha256Text(body.error),
          },
        }),
      ),
    );

    await expect(
      streamPrompt("thread_1", { text: "hello" }, () => {}),
    ).rejects.toMatchObject({
      name: "NapierApiError",
      serverMessage: "Run request is invalid",
      status: 400,
      code: "invalid_request",
      contentSha256: sha256Text(JSON.stringify(body)),
      messageSha256: sha256Text(body.error),
    });
  });

  it("rejects pre-stream JSON error responses when their content hash drifts", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          { error: "Run request is invalid" },
          {
            status: 400,
            headers: {
              "X-Napier-Content-SHA256": "0".repeat(64),
              "X-Napier-Error-Code": "invalid_request",
            },
          },
        ),
      ),
    );

    try {
      await streamPrompt("thread_1", { text: "hello" }, () => {});
      throw new Error("Expected streamPrompt to reject");
    } catch (error) {
      expect(error).toBeInstanceOf(NapierContentHashError);
      expect(error).toMatchObject({
        name: "NapierContentHashError",
        message: "Response hash mismatch for /api/threads/thread_1/messages",
        status: 400,
        expectedSha256: "0".repeat(64),
        evidence: "response",
      });
    }
  });

  it("rejects pre-stream JSON error responses without content hash evidence", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          { error: "Run request is invalid" },
          {
            status: 400,
            headers: {
              "X-Napier-Error-Code": "invalid_request",
            },
          },
        ),
      ),
    );

    try {
      await streamPrompt("thread_1", { text: "hello" }, () => {});
      throw new Error("Expected streamPrompt to reject");
    } catch (error) {
      expect(error).toBeInstanceOf(NapierContentHashMissingError);
      expect(error).toMatchObject({
        name: "NapierContentHashMissingError",
        message: "Missing content hash for /api/threads/thread_1/messages",
        status: 400,
      });
    }
  });

  it("rejects successful streaming responses without a readable body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(null, {
            status: 200,
            headers: streamHeaders(),
          }),
      ),
    );

    await expect(
      streamPrompt("thread_1", { text: "hello" }, () => {}),
    ).rejects.toThrow("Streaming response is unavailable");
  });
});

function sseResponse(
  chunk: string,
  init?: { headers?: Record<string, string | null> },
): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }),
    { headers: streamHeaders(init?.headers) },
  );
}

function streamHeaders(overrides?: Record<string, string | null>): Headers {
  const headers = new Headers({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "X-Napier-Thread-Id": "thread_1",
    "X-Napier-Prompt-Requested": "true",
    "X-Napier-Stream-Error-Code": "run_failed",
    "X-Napier-Stream-Error-Diagnostic": "sha256",
    "X-Napier-Stream-Error-Message-SHA256": sha256Text(
      "Run failed while streaming.",
    ),
  });
  for (const [key, value] of Object.entries(overrides ?? {})) {
    if (value === null) headers.delete(key);
    else headers.set(key, value);
  }
  return headers;
}

function jsonResponse(
  body: unknown,
  init?: { status?: number; headers?: HeadersInit },
): Response {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
}

function streamSnapshotFrame(
  threadId: string,
  events: unknown[] = [],
  runs: unknown[] = [],
) {
  const detail = {
    thread: {
      id: threadId,
      title: "Thread",
      agentId: "agent_napier",
      status: "idle",
      createdAt: "2026-07-26T00:00:00.000Z",
      updatedAt: "2026-07-26T00:00:00.000Z",
      lastMessage: "",
      eventCount: events.length,
      runIds: runs
        .filter((run): run is { id: string } => isObjectWithStringId(run))
        .map((run) => run.id),
    },
    agent: { id: "agent_napier" },
    runs,
    plans: [],
    evaluations: [],
    evaluationAdjudications: [],
    evaluationReviewerBallots: [],
    evaluationConsensusResolutions: [],
    evaluationSuites: [],
    evaluationSuiteExecutions: [],
    automaticRecoveryAssessments: [],
    automaticRecoveryAttempts: [],
    subagents: [],
    runControlMessages: [],
    operatorDecisions: [],
    contextCheckpointCalibration: {},
    events,
  };
  return {
    type: "snapshot",
    detail,
    detailSha256: sha256Text(JSON.stringify(detail)),
  };
}

function streamRunRecord(
  threadId: string,
  runId: string,
  status = "completed",
) {
  return {
    id: runId,
    threadId,
    agentId: "agent_napier",
    status,
    startedAt: "2026-07-26T00:00:00.000Z",
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: 0,
    },
  };
}

function isObjectWithStringId(value: unknown): value is { id: string } {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof (value as { id?: unknown }).id === "string"
  );
}

function streamEventFrame(
  seq: number,
): Extract<StreamFrame, { type: "event" }> {
  const event: StreamRunEvent = {
    id: `event_${seq}`,
    threadId: "thread_1",
    runId: "run_1",
    seq,
    type: "model.text.delta",
    category: "model",
    visibility: "user",
    createdAt: "2026-07-26T00:00:00.000Z",
    payload: { delta: "hello" },
  };
  return streamEventFrameWithEvent(event);
}

function streamEventsThrough(seq: number): StreamRunEvent[] {
  return Array.from({ length: seq }, (_value, index) => {
    return streamEventFrame(index + 1).event;
  });
}

function streamEventFrameWithEvent(
  event: StreamRunEvent,
): Extract<StreamFrame, { type: "event" }> {
  return {
    type: "event",
    event,
    eventSha256: sha256Text(JSON.stringify(event)),
  };
}

function streamDoneFrame(
  runId: string,
  status: StreamDoneStatus,
  snapshot:
    | {
        detailSha256: string;
        detail: {
          thread: { id: string; eventCount: number };
          events: unknown[];
        };
      }
    | string,
  overrides: Partial<
    Pick<
      Extract<StreamFrame, { type: "done" }>,
      "threadId" | "eventStreamSha256"
    >
  > = {},
): Extract<StreamFrame, { type: "done" }> {
  const events = typeof snapshot === "string" ? [] : snapshot.detail.events;
  return {
    type: "done",
    threadId:
      overrides.threadId ??
      (typeof snapshot === "string" ? "thread_1" : snapshot.detail.thread.id),
    runId,
    status,
    snapshotSha256:
      typeof snapshot === "string" ? snapshot : snapshot.detailSha256,
    eventCount:
      typeof snapshot === "string" ? 0 : snapshot.detail.thread.eventCount,
    eventStreamSha256:
      overrides.eventStreamSha256 ??
      sha256Text(events.map((event) => JSON.stringify(event)).join("\n")),
  };
}

function sha256Text(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
