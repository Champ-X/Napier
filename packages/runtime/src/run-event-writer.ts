import type { RunEvent, ThreadRecord } from "@napier/contracts";

import { assertArtifactReceiptEventBoundary } from "./artifact-receipts.js";
import { createId, nowIso } from "./ids.js";
import { assertRunEventAdmission } from "./run-event-admission.js";
import {
  resolveRegisteredEventInput,
  type AppendEventInput,
  type ResolvedRunEventInput,
} from "./run-event-registry.js";
import { applyThreadSummaryEvent } from "./store-thread-summary-projection.js";

export interface RunEventWriterHost {
  runStatus(runId: string):
    | {
        threadId: string;
        status:
          | "queued"
          | "running"
          | "completed"
          | "failed"
          | "cancelled"
          | "interrupted";
      }
    | undefined;
  mutableThread(threadId: string): ThreadRecord;
  runInThreadQueue<T>(
    threadId: string,
    operation: () => Promise<T>,
  ): Promise<T>;
  runInStateQueue<T>(operation: () => Promise<T>): Promise<T>;
  persistEvent(event: RunEvent): Promise<void>;
  validateResourceId(id: string): void;
}

export async function appendResolvedRunEvent(
  host: RunEventWriterHost,
  input: ResolvedRunEventInput,
): Promise<RunEvent> {
  host.validateResourceId(input.threadId);
  return host.runInThreadQueue(input.threadId, () =>
    host.runInStateQueue(async () => {
      assertRunEventAdmission(input, host.runStatus(input.runId));
      const [event] = appendResolvedEventsToThread(
        host.mutableThread(input.threadId),
        [input],
      );
      if (!event) throw new Error("Ledger event was not created");
      await host.persistEvent(event);
      return structuredClone(event);
    }),
  );
}

export function appendRegisteredEventsToThread(
  thread: ThreadRecord,
  inputs: readonly AppendEventInput[],
  options: { createdAt?: string } = {},
): RunEvent[] {
  return appendResolvedEventsToThread(
    thread,
    inputs.map(resolveRegisteredEventInput),
    options,
  );
}

function appendResolvedEventsToThread(
  thread: ThreadRecord,
  inputs: readonly ResolvedRunEventInput[],
  options: { createdAt?: string } = {},
): RunEvent[] {
  return inputs.map((input) => {
    if (input.threadId !== thread.id) {
      throw new Error("Ledger event Thread does not match mutable projection");
    }
    const event: RunEvent = {
      id: createId("event"),
      threadId: input.threadId,
      runId: input.runId,
      seq: thread.eventCount + 1,
      type: input.type,
      category: input.category,
      visibility: input.visibility,
      createdAt: options.createdAt ?? nowIso(),
      payload: input.payload,
      schemaVersion: input.schemaVersion,
    };
    assertArtifactReceiptEventBoundary(event, `Ledger event ${input.type}`);
    applyThreadSummaryEvent(thread, event);
    return event;
  });
}
