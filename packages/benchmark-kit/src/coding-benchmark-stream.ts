import { Writable } from "node:stream";

import type { StreamFrame } from "@napier/contracts";
import { hashEventStream, sha256 } from "@napier/runtime/core";

const MAX_CAPTURE_BYTES = 16 * 1024 * 1024;

export function validateCodingBenchmarkStream(
  output: string,
  exitCode: number,
): {
  snapshot: Extract<StreamFrame, { type: "snapshot" }>;
  done: Extract<StreamFrame, { type: "done" }>;
} {
  let frames: StreamFrame[];
  try {
    frames = output
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as StreamFrame);
  } catch {
    throw new Error("Coding benchmark CLI JSONL is malformed");
  }
  const snapshot = frames.at(-2);
  const done = frames.at(-1);
  if (snapshot?.type !== "snapshot" || done?.type !== "done") {
    throw new Error("Coding benchmark CLI stream is not terminal");
  }
  if (
    exitCode !== (done.status === "completed" ? 0 : 1) ||
    done.threadId !== snapshot.detail.thread.id ||
    done.snapshotSha256 !== snapshot.detailSha256 ||
    done.eventCount !== snapshot.detail.thread.eventCount ||
    done.eventStreamSha256 !== hashEventStream(snapshot.detail.events) ||
    snapshot.detailSha256 !== sha256(JSON.stringify(snapshot.detail))
  ) {
    throw new Error("Coding benchmark CLI terminal evidence is inconsistent");
  }
  const eventFrames = frames.slice(0, -2);
  if (
    eventFrames.length === 0 ||
    eventFrames.length !== snapshot.detail.events.length ||
    eventFrames.some((frame, index) => {
      const snapshotEvent = snapshot.detail.events[index];
      return (
        frame.type !== "event" ||
        !snapshotEvent ||
        frame.event.threadId !== done.threadId ||
        frame.event.seq !== index + 1 ||
        frame.eventSha256 !== sha256(JSON.stringify(frame.event)) ||
        JSON.stringify(frame.event) !== JSON.stringify(snapshotEvent)
      );
    })
  ) {
    throw new Error("Coding benchmark CLI event evidence is inconsistent");
  }
  return { snapshot, done };
}

export class CodingBenchmarkCapture extends Writable {
  private readonly chunks: Buffer[] = [];
  private bytes = 0;

  override _write(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    this.bytes += chunk.byteLength;
    if (this.bytes > MAX_CAPTURE_BYTES) {
      callback(new Error("Coding benchmark CLI output exceeds its size limit"));
      return;
    }
    this.chunks.push(Buffer.from(chunk));
    callback();
  }

  text(): string {
    return Buffer.concat(this.chunks).toString("utf8");
  }
}
