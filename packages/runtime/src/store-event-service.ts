import type { RunEvent, ThreadRecord } from "@napier/contracts";

import {
  resolveCompatibilityEventInput,
  resolveExtensionEventInput,
  resolveRegisteredEventInput,
  type AppendCompatibilityEventInput,
  type AppendEventInput,
  type AppendExtensionEventInput,
  type ResolvedRunEventInput,
} from "./run-event-registry.js";
import {
  appendRegisteredEventsToThread,
  appendResolvedRunEvent,
  appendResolvedRunEventOnce,
  appendResolvedRunEventOnceAtRunHead,
  type EventIdempotencyKey,
  type IdempotentRunEvent,
  type RunEventAppendResult,
  type RunEventOnceWriterHost,
} from "./run-event-writer.js";
import type { SqliteLedger } from "./sqlite-ledger.js";
import {
  compatibilityCheckpointRequired,
  StoreCompatibilityProjectionWriter,
} from "./store-compatibility-projections.js";
import type { StorePersistenceMonitor } from "./store-observability.js";
import { persistStoreMutation } from "./store-persistence.js";

export type {
  AppendCompatibilityEventInput,
  AppendEventInput,
  AppendExtensionEventInput,
} from "./run-event-registry.js";
export { StoreCompatibilityProjectionWriter } from "./store-compatibility-projections.js";
export type AppendEventOnceOptions = EventIdempotencyKey;
export interface AppendEventOnceAtRunHeadOptions extends EventIdempotencyKey {
  /** MAX(seq) for this Run in the history used to derive the new event. */
  expectedRunHeadSeq: number;
}
export type AppendEventOnceAtRunHeadResult = RunEventAppendResult;

export interface StoreEventServiceHost extends Omit<
  RunEventOnceWriterHost,
  "persistEvent" | "persistEventOnce"
> {
  assertReady(): void;
  revision(): number;
  replaceRevision(revision: number): void;
  snapshotJson(): string;
  compatibilityStateJson(): string;
  ledger(): SqliteLedger;
  monitor: StorePersistenceMonitor;
  compatibility: StoreCompatibilityProjectionWriter;
  refreshProjection(): void;
}

/**
 * Owns the LocalStore event write boundary: input resolution, ordered
 * projection mutation, atomic ledger persistence, and idempotent replay.
 * Keeping these concerns together prevents callers from observing a ledger
 * commit without its matching in-memory/compatibility projection state.
 */
export class StoreEventService {
  constructor(private readonly host: StoreEventServiceHost) {}

  append(input: AppendEventInput): Promise<RunEvent> {
    return this.appendResolved(resolveRegisteredEventInput(input));
  }

  appendOnce(
    input: AppendEventInput,
    idempotency: AppendEventOnceOptions,
  ): Promise<RunEvent> {
    return this.appendResolvedOnce(
      resolveRegisteredEventInput(input),
      idempotency,
    );
  }

  appendOnceAtRunHead(
    input: AppendEventInput,
    options: AppendEventOnceAtRunHeadOptions,
  ): Promise<AppendEventOnceAtRunHeadResult> {
    const { expectedRunHeadSeq, ...idempotency } = options;
    return this.appendResolvedOnceAtRunHead(
      resolveRegisteredEventInput(input),
      idempotency,
      expectedRunHeadSeq,
    );
  }

  appendExtension(input: AppendExtensionEventInput): Promise<RunEvent> {
    return this.appendResolved(resolveExtensionEventInput(input));
  }

  appendCompatibility(input: AppendCompatibilityEventInput): Promise<RunEvent> {
    return this.appendResolved(resolveCompatibilityEventInput(input));
  }

  appendRegisteredToThread(
    thread: ThreadRecord,
    inputs: readonly AppendEventInput[],
    options: { createdAt?: string } = {},
  ): RunEvent[] {
    return appendRegisteredEventsToThread(thread, inputs, {
      ...options,
      admission: {
        runStatus: this.host.runStatus,
        terminalRunStatus: this.host.terminalRunStatus,
      },
    });
  }

  async persist(
    eventOrEvents?: RunEvent | RunEvent[],
    mode: "snapshot" | "event" = "snapshot",
  ): Promise<void> {
    const events = Array.isArray(eventOrEvents)
      ? eventOrEvents
      : eventOrEvents
        ? [eventOrEvents]
        : [];
    const snapshotRequired =
      mode === "snapshot" || compatibilityCheckpointRequired(events);
    const result = await persistStoreMutation({
      expectedRevision: this.host.revision(),
      ...(snapshotRequired ? { snapshotJson: this.host.snapshotJson } : {}),
      compatibilityStateJson: this.host.compatibilityStateJson,
      events,
      ledger: this.host.ledger(),
      monitor: this.host.monitor,
      compatibility: this.host.compatibility,
      onCommitFailure: this.host.refreshProjection,
    });
    this.host.replaceRevision(result.revision);
  }

  private appendResolved(input: ResolvedRunEventInput): Promise<RunEvent> {
    this.host.assertReady();
    return appendResolvedRunEvent(
      {
        ...this.host,
        persistEvent: (event) => this.persist(event, "event"),
      },
      input,
    );
  }

  private appendResolvedOnce(
    input: ResolvedRunEventInput,
    idempotency: EventIdempotencyKey,
  ): Promise<RunEvent> {
    this.host.assertReady();
    return appendResolvedRunEventOnce(
      {
        ...this.host,
        persistEvent: (event) => this.persist(event, "event"),
        persistEventOnce: (event, key, admission) =>
          this.persistOnce(event, key, admission),
      },
      input,
      idempotency,
    );
  }

  private appendResolvedOnceAtRunHead(
    input: ResolvedRunEventInput,
    idempotency: EventIdempotencyKey,
    expectedRunHeadSeq: number,
  ): Promise<RunEventAppendResult> {
    this.host.assertReady();
    return appendResolvedRunEventOnceAtRunHead(
      {
        ...this.host,
        persistEvent: (event) => this.persist(event, "event"),
        persistEventOnce: (event, key, admission) =>
          this.persistOnce(event, key, admission),
        persistEventOnceAtRunHead: (event, key, expectedHead, admission) =>
          this.persistOnceAtRunHead(event, key, expectedHead, admission),
      },
      input,
      idempotency,
      expectedRunHeadSeq,
    );
  }

  private async persistOnce(
    event: IdempotentRunEvent,
    idempotency: EventIdempotencyKey,
    admission: NonNullable<ResolvedRunEventInput["admission"]>,
  ): Promise<{ event: RunEvent; appended: boolean }> {
    const result = await persistStoreMutation({
      expectedRevision: this.host.revision(),
      compatibilityStateJson: this.host.compatibilityStateJson,
      events: [event],
      ledger: this.host.ledger(),
      monitor: this.host.monitor,
      compatibility: this.host.compatibility,
      onCommitFailure: this.host.refreshProjection,
      eventIdempotency: idempotency,
      eventAdmission: admission,
      onIdempotentHit: this.host.refreshProjection,
      onProjectionRefreshRequired: this.host.refreshProjection,
    });
    this.host.replaceRevision(result.revision);
    if (!result.event) {
      throw new Error("Idempotent Ledger persistence did not return an event");
    }
    return { event: result.event, appended: result.appended };
  }

  private async persistOnceAtRunHead(
    event: IdempotentRunEvent,
    idempotency: EventIdempotencyKey,
    expectedRunHeadSeq: number,
    admission: NonNullable<ResolvedRunEventInput["admission"]>,
  ): Promise<RunEventAppendResult> {
    const result = await persistStoreMutation({
      expectedRevision: this.host.revision(),
      compatibilityStateJson: this.host.compatibilityStateJson,
      events: [event],
      ledger: this.host.ledger(),
      monitor: this.host.monitor,
      compatibility: this.host.compatibility,
      onCommitFailure: this.host.refreshProjection,
      eventIdempotency: idempotency,
      runHeadCondition: {
        runId: event.runId,
        expectedRunHeadSeq,
        admission,
      },
      onIdempotentHit: this.host.refreshProjection,
      onProjectionRefreshRequired: this.host.refreshProjection,
    });
    this.host.replaceRevision(result.revision);
    if (!result.event) {
      throw new Error("Conditional Ledger persistence did not return an event");
    }
    return { event: result.event, appended: result.appended };
  }
}
