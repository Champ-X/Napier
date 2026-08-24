import {
  type RunControlMessage,
  type RunControlMessageMode,
  type RunEvent,
} from "@napier/contracts";
import { createId } from "./ids.js";
import {
  createRunControlMessageCancelledPayload,
  createRunControlMessageDeliveredPayload,
  createRunControlMessageQueuedPayload,
  createRunControlMessageUserPayload,
  MAX_PENDING_RUN_CONTROL_MESSAGES,
  MAX_TOTAL_RUN_CONTROL_MESSAGES,
  nextPendingRunControlMessage,
  projectRunControlMessages,
} from "./run-control-messages.js";
import type { StoreRepositoryHost } from "./store-repository-host.js";

export interface QueueRunControlMessageInput {
  threadId: string;
  runId: string;
  mode: RunControlMessageMode;
  text: string;
}

export interface RunControlMessageDelivery {
  message: RunControlMessage;
  text: string;
  events: RunEvent[];
}

export class RunControlRepository {
  constructor(private readonly host: StoreRepositoryHost) {}

  async listRunControlMessages(
    threadId: string,
    runId?: string,
  ): Promise<RunControlMessage[]> {
    const events = await this.host.listEvents(threadId);
    return projectRunControlMessages(events, runId);
  }

  async queueRunControlMessage(
    input: QueueRunControlMessageInput,
  ): Promise<RunControlMessage> {
    this.host.assertInitialized();
    this.host.validateResourceId(input.threadId);
    this.host.validateResourceId(input.runId);
    return this.host.threadQueue(input.threadId).run(() =>
      this.host.stateQueue.run(async () => {
        const thread = this.host.mutableThread(input.threadId);
        const run = this.host.mutableRun(input.runId);
        if (run.source === "workflow") {
          throw new Error(
            "Workflow node Runs do not accept live Run control messages",
          );
        }
        if (
          run.threadId !== thread.id ||
          run.status !== "running" ||
          thread.currentRunId !== run.id
        ) {
          throw new Error("Run control message requires the active Thread Run");
        }
        if (
          run.configuration?.model.provider === "napier" &&
          run.configuration.model.id === "demo"
        ) {
          throw new Error(
            "The demo model does not accept live Run control messages",
          );
        }
        const currentEvents = this.host.requireLedger().listEvents(thread.id);
        const currentMessages = projectRunControlMessages(
          currentEvents,
          run.id,
        );
        if (currentMessages.length >= MAX_TOTAL_RUN_CONTROL_MESSAGES) {
          throw new Error(
            `Run control message total limit reached (${MAX_TOTAL_RUN_CONTROL_MESSAGES})`,
          );
        }
        if (
          currentMessages.filter((message) => message.status === "queued")
            .length >= MAX_PENDING_RUN_CONTROL_MESSAGES
        ) {
          throw new Error(
            `Run control message pending limit reached (${MAX_PENDING_RUN_CONTROL_MESSAGES})`,
          );
        }
        const payload = createRunControlMessageQueuedPayload({
          controlMessageId: createId("control"),
          mode: input.mode,
          text: input.text,
        });
        const [queuedEvent] = this.host.appendEventsToThread(thread, [
          {
            threadId: thread.id,
            runId: run.id,
            type: "run.control.queued",
            category: "message",
            visibility: "user",
            payload,
          },
        ]);
        if (!queuedEvent) {
          throw new Error("Run control message queue event was not created");
        }
        await this.host.persistState(queuedEvent);
        const message = projectRunControlMessages(
          [...currentEvents, queuedEvent],
          run.id,
        ).find((candidate) => candidate.id === payload.controlMessageId);
        if (!message) {
          throw new Error("Run control message queue receipt is invalid");
        }
        return structuredClone(message);
      }),
    );
  }

  async deliverNextRunControlMessage(
    threadId: string,
    runId: string,
    mode: RunControlMessageMode,
  ): Promise<RunControlMessageDelivery | undefined> {
    this.host.assertInitialized();
    this.host.validateResourceId(threadId);
    this.host.validateResourceId(runId);
    return this.host.threadQueue(threadId).run(() =>
      this.host.stateQueue.run(async () => {
        const thread = this.host.mutableThread(threadId);
        const run = this.host.mutableRun(runId);
        if (
          run.source === "workflow" ||
          run.threadId !== thread.id ||
          run.status !== "running" ||
          thread.currentRunId !== run.id
        ) {
          return undefined;
        }
        const currentEvents = this.host.requireLedger().listEvents(thread.id);
        const pending = nextPendingRunControlMessage(
          currentEvents,
          run.id,
          mode,
        );
        if (!pending) return undefined;
        const messageEventSeq = thread.eventCount + 2;
        const deliveredPayload = createRunControlMessageDeliveredPayload({
          message: pending.message,
          messageEventSeq,
        });
        const deliveryEvents = this.host.appendEventsToThread(thread, [
          {
            threadId: thread.id,
            runId: run.id,
            type: "run.control.delivered",
            category: "message",
            visibility: "user",
            payload: deliveredPayload,
          },
          {
            threadId: thread.id,
            runId: run.id,
            type: "message.user",
            category: "message",
            visibility: "user",
            payload: createRunControlMessageUserPayload(pending),
          },
        ]);
        await this.host.persistState(deliveryEvents);
        const message = projectRunControlMessages(
          [...currentEvents, ...deliveryEvents],
          run.id,
        ).find((candidate) => candidate.id === pending.message.id);
        if (!message || message.status !== "delivered") {
          throw new Error("Run control message delivery receipt is invalid");
        }
        return {
          message: structuredClone(message),
          text: pending.text,
          events: structuredClone(deliveryEvents),
        };
      }),
    );
  }

  async cancelRunControlMessage(
    threadId: string,
    runId: string,
    controlMessageId: string,
  ): Promise<RunControlMessage> {
    this.host.assertInitialized();
    this.host.validateResourceId(threadId);
    this.host.validateResourceId(runId);
    this.host.validateResourceId(controlMessageId);
    return this.host.threadQueue(threadId).run(() =>
      this.host.stateQueue.run(async () => {
        const thread = this.host.mutableThread(threadId);
        const run = this.host.mutableRun(runId);
        if (run.threadId !== thread.id) {
          throw new Error(`Run not found in thread: ${runId}`);
        }
        const currentEvents = this.host.requireLedger().listEvents(thread.id);
        const current = projectRunControlMessages(currentEvents, run.id).find(
          (message) => message.id === controlMessageId,
        );
        if (!current) {
          throw new Error(`Run control message not found: ${controlMessageId}`);
        }
        if (current.status === "cancelled") return structuredClone(current);
        if (current.status !== "queued") {
          throw new Error("Delivered Run control message cannot be cancelled");
        }
        const payload = createRunControlMessageCancelledPayload({
          message: current,
          reason: "operator_cancelled",
        });
        const [cancelledEvent] = this.host.appendEventsToThread(thread, [
          {
            threadId: thread.id,
            runId: run.id,
            type: "run.control.cancelled",
            category: "message",
            visibility: "user",
            payload,
          },
        ]);
        if (!cancelledEvent) {
          throw new Error(
            "Run control message cancellation event was not created",
          );
        }
        await this.host.persistState(cancelledEvent);
        const cancelled = projectRunControlMessages(
          [...currentEvents, cancelledEvent],
          run.id,
        ).find((message) => message.id === controlMessageId);
        if (!cancelled || cancelled.status !== "cancelled") {
          throw new Error(
            "Run control message cancellation receipt is invalid",
          );
        }
        return structuredClone(cancelled);
      }),
    );
  }
}
