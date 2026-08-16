import { randomBytes } from "node:crypto";
import { open, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import type { RunEvent } from "@napier/contracts";

import { withWorkspacePathLocks } from "./workspace-write-lock.js";

export interface CompatibilityProjectionWriteResult {
  stateProjectionBytes: number;
  eventProjectionBytes: number;
  projectionFailureCount: number;
}

const CHECKPOINT_INTERVAL = 64;
const LOCK_RETRY_COUNT = 200;
const LOCK_RETRY_DELAY_MS = 5;
const TAIL_READ_BYTES = 64 * 1_024;
const MAX_TAIL_LINE_BYTES = 8 * 1_024 * 1_024;
const CHECKPOINT_EVENT_TYPES = new Set([
  "operator.decision.requested",
  "run.cancelled",
  "run.completed",
  "run.failed",
  "run.interrupted",
  "run.settlement.checkpoint",
  "run.waiting_for_operator",
  "thread.restored",
  "thread.trashed",
  "turn.completed",
  "workflow.blocked",
  "workflow.cancelled",
  "workflow.completed",
  "workflow.paused",
  "workflow.waiting",
]);

export class StoreCompatibilityProjectionWriter {
  private readonly dirtyThreadIds = new Set<string>();

  constructor(
    private readonly statePath: string,
    private readonly eventsRoot: string,
    private readonly loadEvents: (
      threadId: string,
      afterSeq?: number,
    ) => readonly RunEvent[],
  ) {}

  markSnapshotDirty(threadIds: readonly string[]): void {
    for (const threadId of threadIds) this.dirtyThreadIds.add(threadId);
  }

  recordCommit(
    stateJson: () => string,
    events: readonly RunEvent[],
  ): Promise<CompatibilityProjectionWriteResult> {
    this.markSnapshotDirty(events.map((event) => event.threadId));
    return events.length > 0 && !compatibilityCheckpointRequired(events)
      ? Promise.resolve(emptyWriteResult())
      : this.writeCheckpoint(stateJson(), "append");
  }

  writeAll(
    stateJson: string,
    threadIds: readonly string[],
  ): Promise<CompatibilityProjectionWriteResult> {
    this.markSnapshotDirty(threadIds);
    return this.writeCheckpoint(stateJson, "replace");
  }

  async flush(stateJson: string, threadIds: readonly string[]): Promise<void> {
    this.markSnapshotDirty(threadIds);
    const result = await this.writeCheckpoint(stateJson, "append");
    if (result.projectionFailureCount > 0) {
      throw new Error(
        `Compatibility projection flush failed (${String(result.projectionFailureCount)})`,
      );
    }
  }

  private async writeCheckpoint(
    stateJson: string,
    eventMode: "append" | "replace",
  ): Promise<CompatibilityProjectionWriteResult> {
    const threadIds = [...this.dirtyThreadIds].sort();
    const eventPaths = threadIds.map((threadId) =>
      eventPath(this.eventsRoot, threadId),
    );
    let results: PromiseSettledResult<number>[];
    try {
      results = await withCompatibilityProjectionLocks(
        path.dirname(this.statePath),
        [this.statePath, ...eventPaths],
        () =>
          Promise.allSettled([
            writeProjection(this.statePath, `${stateJson}\n`),
            ...threadIds.map((threadId, index) =>
              eventMode === "replace"
                ? writeProjection(
                    eventPaths[index]!,
                    eventProjection(this.loadEvents(threadId)),
                  )
                : appendEventProjection(
                    eventPaths[index]!,
                    threadId,
                    this.loadEvents,
                  ),
            ),
          ]),
      );
    } catch (error) {
      results = Array.from({ length: threadIds.length + 1 }, () => ({
        status: "rejected",
        reason: error,
      }));
    }
    for (const [index, result] of results.slice(1).entries()) {
      if (results[0]?.status === "fulfilled" && result.status === "fulfilled") {
        this.dirtyThreadIds.delete(threadIds[index]!);
      }
    }
    return {
      stateProjectionBytes:
        results[0]?.status === "fulfilled" ? results[0].value : 0,
      eventProjectionBytes: results
        .slice(1)
        .reduce(
          (total, result) =>
            total + (result.status === "fulfilled" ? result.value : 0),
          0,
        ),
      projectionFailureCount: results.filter(
        (result) => result.status === "rejected",
      ).length,
    };
  }
}

export function compatibilityCheckpointRequired(
  events: readonly RunEvent[],
): boolean {
  return (
    events.length > 1 ||
    events.some(
      (event) =>
        CHECKPOINT_EVENT_TYPES.has(event.type) ||
        event.seq % CHECKPOINT_INTERVAL === 0,
    )
  );
}

async function writeProjection(
  targetPath: string,
  contents: string,
): Promise<number> {
  const temporaryPath = `${targetPath}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  await writeFile(temporaryPath, contents, "utf8");
  await rename(temporaryPath, targetPath);
  return Buffer.byteLength(contents, "utf8");
}

async function appendEventProjection(
  targetPath: string,
  threadId: string,
  loadEvents: (threadId: string, afterSeq?: number) => readonly RunEvent[],
): Promise<number> {
  const current = await lastEventProjectionRecord(targetPath);
  const tail = [...loadEvents(threadId, Math.max(0, (current?.seq ?? 0) - 1))];
  if (current) {
    const authoritative = tail.shift();
    if (
      !authoritative ||
      authoritative.seq !== current.seq ||
      JSON.stringify(authoritative) !== current.line
    ) {
      throw new Error(
        `Compatibility event projection tail mismatch for ${threadId}`,
      );
    }
  }
  let expectedSeq = (current?.seq ?? 0) + 1;
  for (const event of tail) {
    if (event.threadId !== threadId || event.seq !== expectedSeq) {
      throw new Error(
        `Compatibility event projection suffix is invalid for ${threadId} at ${String(expectedSeq)}`,
      );
    }
    expectedSeq += 1;
  }
  const contents = eventProjection(tail);
  if (!contents) return 0;
  const handle = await open(targetPath, "a", 0o600);
  try {
    await handle.writeFile(contents, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  return Buffer.byteLength(contents, "utf8");
}

async function lastEventProjectionRecord(
  targetPath: string,
): Promise<{ seq: number; line: string } | undefined> {
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(targetPath, "r");
  } catch (error) {
    if (errorCode(error) === "ENOENT") return undefined;
    throw error;
  }
  try {
    const { size } = await handle.stat();
    if (size === 0) return undefined;
    const finalByte = Buffer.alloc(1);
    await handle.read(finalByte, 0, 1, size - 1);
    if (finalByte[0] !== 0x0a) {
      throw new Error("Compatibility event projection is incomplete");
    }
    let cursor = size - 1;
    let lineBytes = 0;
    const chunks: Buffer[] = [];
    while (cursor > 0) {
      const length = Math.min(TAIL_READ_BYTES, cursor);
      const chunk = Buffer.alloc(length);
      const start = cursor - length;
      await handle.read(chunk, 0, length, start);
      const newline = chunk.lastIndexOf(0x0a);
      if (newline >= 0) {
        const suffix = chunk.subarray(newline + 1);
        lineBytes += suffix.length;
        if (lineBytes > MAX_TAIL_LINE_BYTES) {
          throw new Error("Compatibility event projection tail is too large");
        }
        chunks.unshift(suffix);
        break;
      }
      lineBytes += chunk.length;
      if (lineBytes > MAX_TAIL_LINE_BYTES) {
        throw new Error("Compatibility event projection tail is too large");
      }
      chunks.unshift(chunk);
      cursor = start;
    }
    const line = Buffer.concat(chunks).toString("utf8");
    const parsed = JSON.parse(line) as { seq?: unknown };
    if (!Number.isSafeInteger(parsed.seq) || Number(parsed.seq) < 1) {
      throw new Error("Compatibility event projection tail is invalid");
    }
    return { seq: Number(parsed.seq), line };
  } finally {
    await handle.close();
  }
}

async function withCompatibilityProjectionLocks<T>(
  dataRoot: string,
  targets: readonly string[],
  operation: () => Promise<T>,
): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await withWorkspacePathLocks(
        dataRoot,
        targets,
        "compatibility projection",
        operation,
      );
    } catch (error) {
      if (
        attempt >= LOCK_RETRY_COUNT ||
        !String(error).includes("target is already being edited")
      ) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_DELAY_MS));
    }
  }
}

function eventPath(eventsRoot: string, threadId: string): string {
  if (!/^[a-z][a-z0-9_]{2,80}$/u.test(threadId)) {
    throw new Error(`Invalid resource ID: ${threadId}`);
  }
  return path.join(eventsRoot, `${threadId}.jsonl`);
}

function eventProjection(events: readonly RunEvent[]): string {
  const contents = events.map((event) => JSON.stringify(event)).join("\n");
  return contents ? `${contents}\n` : "";
}

function emptyWriteResult(): CompatibilityProjectionWriteResult {
  return {
    stateProjectionBytes: 0,
    eventProjectionBytes: 0,
    projectionFailureCount: 0,
  };
}

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error
    ? String((error as NodeJS.ErrnoException).code)
    : undefined;
}
