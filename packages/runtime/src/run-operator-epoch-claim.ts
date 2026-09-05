import type { UserMessage } from "@earendil-works/pi-ai";
import type { JsonValue, RunEvent, RunRecord } from "@napier/contracts";

import type { EventSink } from "./event-sink.js";
import {
  retryCasConflict,
  type CasConflictRetryOptions,
} from "./cas-conflict-retry.js";
import {
  appendRunOperatorEpoch,
  runOperatorEpochBinding,
  type RunConvergenceEventStore,
} from "./run-convergence-event-writer.js";
import type { RunConvergencePolicy } from "./run-convergence-policy.js";
import type { RunEventQueryPort } from "./run-event-query-port.js";
import { projectRunControlEpochs } from "./run-progress-control-epoch-codec.js";
import { projectRunDirectiveState } from "./run-progress-directive-state.js";
import { ConcurrentRunEventHeadError } from "./sqlite-ledger-errors.js";

export class RunOperatorEpochConflictError extends Error {
  override readonly name = "RunOperatorEpochConflictError";

  constructor() {
    super("A different operator epoch won the steering claim");
  }
}

/** A returned steering message is executable only with durable causal ownership. */
export async function establishRunOperatorEpoch(input: {
  store: Pick<RunEventQueryPort, "listRunEvents"> & RunConvergenceEventStore;
  run: Pick<RunRecord, "id" | "threadId">;
  policy: Readonly<RunConvergencePolicy>;
  parentControlEpochId: string;
  messages: readonly UserMessage[];
  onEvent?: EventSink;
  contentionRetry?: Readonly<CasConflictRetryOptions>;
}): Promise<{ events: RunEvent[]; inject: boolean }> {
  const intended = runOperatorEpochBinding(
    input.parentControlEpochId,
    input.messages,
  );
  return retryCasConflict({
    operation: async () => {
      const events = await input.store.listRunEvents(input.run.id);
      if (messagesHaveDurableControlDelivery(events, input.messages)) {
        return { events, inject: true };
      }
      if (hasOperatorEpoch(events, intended.contentSha256)) {
        return { events, inject: false };
      }
      const projected = projectRunDirectiveState(
        events,
        input.run.id,
        input.policy,
      );
      if (projected.controlEpochId !== input.parentControlEpochId) {
        throw new RunOperatorEpochConflictError();
      }
      const receipt = await appendRunOperatorEpoch({
        store: input.store,
        run: input.run,
        expectedRunHeadSeq: runEventHead(events),
        parentControlEpochId: projected.controlEpochId,
        messages: input.messages,
        ...(input.onEvent ? { onEvent: input.onEvent } : {}),
      });
      return {
        events: await input.store.listRunEvents(input.run.id),
        inject: receipt.appended,
      };
    },
    isConflict: (error) => error instanceof ConcurrentRunEventHeadError,
    exhaustedMessage: "Run operator epoch claim was contended",
    ...(input.contentionRetry ? { options: input.contentionRetry } : {}),
  });
}

function runEventHead(events: readonly RunEvent[]): number {
  return events.reduce((head, event) => Math.max(head, event.seq), 0);
}

function hasOperatorEpoch(
  events: readonly RunEvent[],
  contentSha256: string,
): boolean {
  return events.some(
    (event) =>
      event.type === "run.progress.operator_epoch" &&
      record(event.payload)?.["contentSha256"] === contentSha256,
  );
}

function messagesHaveDurableControlDelivery(
  events: readonly RunEvent[],
  messages: readonly UserMessage[],
): boolean {
  if (messages.length === 0) return false;
  try {
    const eventBySeq = new Map(events.map((event) => [event.seq, event]));
    const available = projectRunControlEpochs(events)
      .map((epoch) => eventBySeq.get(epoch.boundarySeq))
      .filter((event): event is RunEvent => event?.type === "message.user");
    for (const message of messages) {
      const index = available.findIndex((event) => {
        const payload = record(event.payload);
        return (
          payload?.["role"] === "user" &&
          payload["text"] === String(message.content) &&
          Date.parse(event.createdAt) === message.timestamp
        );
      });
      if (index < 0) return false;
      available.splice(index, 1);
    }
    return true;
  } catch {
    // Invalid control lineage never authorizes a live message injection.
    return false;
  }
}

function record(
  value: JsonValue | undefined,
): Record<string, JsonValue> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : undefined;
}
