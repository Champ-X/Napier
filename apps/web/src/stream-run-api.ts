import type {
  PromptRequest,
  ResumeRunRequest,
  StreamFrame,
} from "@napier/contracts";

import {
  NapierStreamDoneEventCountError,
  NapierStreamDoneEventStreamHashError,
  NapierStreamDoneSizeError,
  NapierStreamDoneSnapshotHashError,
  NapierStreamEventSequenceError,
  NapierStreamFrameOrderError,
  NapierStreamRunIdentityError,
  NapierStreamSnapshotEventError,
  NapierStreamSnapshotMissingError,
  NapierStreamSnapshotRunError,
  NapierStreamTerminationError,
  NapierStreamThreadIdentityError,
  sha256Text,
  throwNapierApiError,
} from "./api-error";
import { readSseJsonRecords } from "./sse-json";
import {
  type StreamRunExpectation,
  verifyStreamRunPresetEvidence,
  verifyStreamRunResponseContract,
} from "./stream-run-response-contract";
import {
  type ParsedStreamFrame,
  validateStreamFrameRecord,
} from "./stream-frame-validation";

export async function streamRunFrames(
  path: string,
  body: PromptRequest | ResumeRunRequest | Record<string, never>,
  expectation: StreamRunExpectation,
  onFrame: (frame: StreamFrame) => void,
): Promise<void> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    await throwNapierApiError(response, "Run failed", path);
  }
  await verifyStreamRunResponseContract(path, response, expectation);
  if (!response.body) throw new Error("Streaming response is unavailable");

  const state = streamState();
  for await (const record of readSseJsonRecords(path, response.body)) {
    await dispatchFrame(
      path,
      state,
      expectation,
      await validateStreamFrameRecord(path, record),
      onFrame,
    );
  }
  if (!state.terminalFrameType) {
    throw new NapierStreamTerminationError(path, {
      frameCount: state.frameCount,
      ...(state.lastFrameType ? { lastFrameType: state.lastFrameType } : {}),
    });
  }
}

interface StreamState {
  frameCount: number;
  lastFrameType?: StreamFrame["type"];
  terminalFrameType?: StreamFrame["type"];
  lastEventSeq?: number;
  streamedEventSha256s: Map<number, string>;
  snapshotEventSha256s: Map<number, string>;
  hasSnapshotFrame: boolean;
  snapshotRunStatuses: Map<string, string>;
  snapshotSha256?: string;
  snapshotBytes?: number;
  snapshotEventCount?: number;
  snapshotEventBytes?: number;
  snapshotEventStreamSha256?: string;
  streamRunId: string | undefined;
}

function streamState(): StreamState {
  return {
    frameCount: 0,
    streamedEventSha256s: new Map(),
    snapshotEventSha256s: new Map(),
    hasSnapshotFrame: false,
    snapshotRunStatuses: new Map(),
    streamRunId: undefined,
  };
}

async function dispatchFrame(
  path: string,
  state: StreamState,
  expectation: StreamRunExpectation,
  parsed: ParsedStreamFrame,
  onFrame: (frame: StreamFrame) => void,
): Promise<void> {
  const { frame, frameSha256 } = parsed;
  if (state.terminalFrameType) {
    throw new NapierStreamFrameOrderError(path, {
      frameCount: state.frameCount,
      terminalFrameType: state.terminalFrameType,
      nextFrameType: frame.type,
    });
  }
  verifyThreadIdentity(path, expectation.threadId, frame, frameSha256);
  verifyStreamRunPresetEvidence(path, expectation, frame);
  state.streamRunId = verifyRunIdentity(
    path,
    state.streamRunId,
    frame,
    frameSha256,
  );
  if (frame.type === "event") observeEvent(path, state, frame, frameSha256);
  if (frame.type === "snapshot") {
    await observeSnapshot(path, state, frame, frameSha256);
  }
  if (frame.type === "done") verifyDone(path, state, frame, frameSha256);
  onFrame(frame);
  state.frameCount += 1;
  state.lastFrameType = frame.type;
  if (frame.type === "done" || frame.type === "error") {
    state.terminalFrameType = frame.type;
  }
}

function observeEvent(
  path: string,
  state: StreamState,
  frame: Extract<StreamFrame, { type: "event" }>,
  frameSha256: string,
): void {
  if (
    state.lastEventSeq !== undefined &&
    frame.event.seq <= state.lastEventSeq
  ) {
    throw new NapierStreamEventSequenceError(path, {
      previousSeq: state.lastEventSeq,
      currentSeq: frame.event.seq,
      frameSha256,
    });
  }
  state.lastEventSeq = frame.event.seq;
  state.streamedEventSha256s.set(frame.event.seq, frame.eventSha256);
}

async function observeSnapshot(
  path: string,
  state: StreamState,
  frame: Extract<StreamFrame, { type: "snapshot" }>,
  frameSha256: string,
): Promise<void> {
  state.snapshotEventSha256s = await snapshotEventSha256s(frame);
  verifySnapshotEvents(path, {
    streamedEventSha256s: state.streamedEventSha256s,
    snapshotEventSha256s: state.snapshotEventSha256s,
    snapshotSha256: frame.detailSha256,
    frameSha256,
  });
  state.hasSnapshotFrame = true;
  state.snapshotRunStatuses = new Map(
    frame.detail.runs.map((run) => [run.id, run.status]),
  );
  state.snapshotSha256 = frame.detailSha256;
  state.snapshotBytes = frame.detailBytes;
  state.snapshotEventCount = frame.detail.thread.eventCount;
  state.snapshotEventBytes = frame.eventBytes;
  state.snapshotEventStreamSha256 = await sha256Text(
    frame.detail.events.map((event) => JSON.stringify(event)).join("\n"),
  );
}

function verifyDone(
  path: string,
  state: StreamState,
  frame: Extract<StreamFrame, { type: "done" }>,
  frameSha256: string,
): void {
  if (!state.hasSnapshotFrame) {
    throw new NapierStreamSnapshotMissingError(path, {
      frameCount: state.frameCount,
      runId: frame.runId,
      status: frame.status,
      frameSha256,
    });
  }
  const snapshotSha256 = state.snapshotSha256;
  if (!snapshotSha256) return;
  if (frame.snapshotSha256 !== snapshotSha256) {
    throw new NapierStreamDoneSnapshotHashError(path, {
      expectedSha256: snapshotSha256,
      actualSha256: frame.snapshotSha256,
      frameSha256,
    });
  }
  verifyDoneCounts(path, state, frame, snapshotSha256, frameSha256);
  const snapshotStatus = state.snapshotRunStatuses.get(frame.runId);
  if (!snapshotStatus) {
    throw new NapierStreamSnapshotRunError(path, {
      reason: "run_missing",
      runId: frame.runId,
      doneStatus: frame.status,
      snapshotSha256,
      frameSha256,
    });
  }
  if (snapshotStatus !== frame.status) {
    throw new NapierStreamSnapshotRunError(path, {
      reason: "status_mismatch",
      runId: frame.runId,
      doneStatus: frame.status,
      snapshotStatus,
      snapshotSha256,
      frameSha256,
    });
  }
  verifySnapshotEvents(path, {
    streamedEventSha256s: state.streamedEventSha256s,
    snapshotEventSha256s: state.snapshotEventSha256s,
    snapshotSha256,
    frameSha256,
  });
}

function verifyDoneCounts(
  path: string,
  state: StreamState,
  frame: Extract<StreamFrame, { type: "done" }>,
  snapshotSha256: string,
  frameSha256: string,
): void {
  if (
    state.snapshotEventCount !== undefined &&
    frame.eventCount !== state.snapshotEventCount
  ) {
    throw new NapierStreamDoneEventCountError(path, {
      expectedEventCount: state.snapshotEventCount,
      actualEventCount: frame.eventCount,
      snapshotSha256,
      frameSha256,
    });
  }
  verifyDoneSize(path, state, frame, snapshotSha256, frameSha256);
  if (
    state.snapshotEventStreamSha256 !== undefined &&
    frame.eventStreamSha256 !== state.snapshotEventStreamSha256
  ) {
    throw new NapierStreamDoneEventStreamHashError(path, {
      expectedSha256: state.snapshotEventStreamSha256,
      actualSha256: frame.eventStreamSha256,
      frameSha256,
    });
  }
}

function verifyDoneSize(
  path: string,
  state: StreamState,
  frame: Extract<StreamFrame, { type: "done" }>,
  snapshotSha256: string,
  frameSha256: string,
): void {
  if (
    state.snapshotBytes !== undefined &&
    frame.snapshotBytes !== state.snapshotBytes
  ) {
    throw new NapierStreamDoneSizeError(path, {
      projection: "snapshot",
      expectedBytes: state.snapshotBytes,
      actualBytes: frame.snapshotBytes,
      snapshotSha256,
      frameSha256,
    });
  }
  if (
    state.snapshotEventBytes !== undefined &&
    frame.eventBytes !== state.snapshotEventBytes
  ) {
    throw new NapierStreamDoneSizeError(path, {
      projection: "events",
      expectedBytes: state.snapshotEventBytes,
      actualBytes: frame.eventBytes,
      snapshotSha256,
      frameSha256,
    });
  }
}

async function snapshotEventSha256s(
  frame: Extract<StreamFrame, { type: "snapshot" }>,
): Promise<Map<number, string>> {
  const entries = await Promise.all(
    frame.detail.events.map(
      async (event) =>
        [event.seq, await sha256Text(JSON.stringify(event))] as const,
    ),
  );
  return new Map(entries);
}

function verifySnapshotEvents(
  path: string,
  options: {
    streamedEventSha256s: ReadonlyMap<number, string>;
    snapshotEventSha256s: ReadonlyMap<number, string>;
    snapshotSha256: string;
    frameSha256: string;
  },
): void {
  for (const [seq, expectedSha256] of options.streamedEventSha256s) {
    const actualSha256 = options.snapshotEventSha256s.get(seq);
    if (!actualSha256) {
      throw new NapierStreamSnapshotEventError(path, {
        reason: "event_missing",
        seq,
        expectedSha256,
        snapshotSha256: options.snapshotSha256,
        frameSha256: options.frameSha256,
      });
    }
    if (actualSha256 !== expectedSha256) {
      throw new NapierStreamSnapshotEventError(path, {
        reason: "event_mismatch",
        seq,
        expectedSha256,
        actualSha256,
        snapshotSha256: options.snapshotSha256,
        frameSha256: options.frameSha256,
      });
    }
  }
}

function verifyThreadIdentity(
  path: string,
  expectedThreadId: string,
  frame: StreamFrame,
  frameSha256: string,
): void {
  const actualThreadId =
    frame.type === "event"
      ? frame.event.threadId
      : frame.type === "snapshot"
        ? frame.detail.thread.id
        : frame.threadId;
  if (actualThreadId === expectedThreadId) return;
  throw new NapierStreamThreadIdentityError(path, {
    frameType: frame.type,
    expectedThreadId,
    actualThreadId,
    frameSha256,
  });
}

function verifyRunIdentity(
  path: string,
  expectedRunId: string | undefined,
  frame: StreamFrame,
  frameSha256: string,
): string | undefined {
  const actualRunId =
    frame.type === "event"
      ? frame.event.runId
      : frame.type === "done"
        ? frame.runId
        : undefined;
  if (!actualRunId) return expectedRunId;
  if (!expectedRunId) return actualRunId;
  if (actualRunId === expectedRunId) return expectedRunId;
  throw new NapierStreamRunIdentityError(path, {
    frameType: frame.type,
    expectedRunId,
    actualRunId,
    frameSha256,
  });
}
