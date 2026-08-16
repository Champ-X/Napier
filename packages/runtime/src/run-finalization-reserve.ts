import type { UserMessage } from "@earendil-works/pi-ai";
import type { RunEvent, RunLimits, RunRecord } from "@napier/contracts";

import { controlMessageEventKey, toJsonValue } from "./agent-runtime-utils.js";
import type { EventSink } from "./event-sink.js";
import {
  RunFinalizationReservedError,
  type RunFinalizationReserve,
} from "./run-budget.js";
import type { RunBudgetTracker } from "./run-budget.js";
import type { AppendEventInput, LocalStore } from "./store.js";

const FINALIZER_MESSAGE = [
  "Internal finalization reserve: stop expanding the task.",
  "Do not add research, broaden the plan, or start new work.",
  "Use only the already-scoped tools needed to finish the current modification, perform minimal verification, and register existing artifacts.",
  "Then deliver the best concise user-facing result from completed evidence.",
  "State verified results, preserved artifacts, remaining risks, and the safest continuation when work is incomplete.",
].join("\n");

export class RunFinalizationReserveController {
  private reserve: RunFinalizationReserve | undefined;
  private finalizerStarted = false;

  constructor(
    private readonly context: {
      store: LocalStore;
      run: Pick<RunRecord, "id" | "threadId">;
      budget: RunBudgetTracker;
    },
    private readonly preRecordedMessages: Map<string, number>,
  ) {}

  get active(): boolean {
    return this.reserve !== undefined;
  }

  async enter(
    reserve: RunFinalizationReserve,
    onEvent?: EventSink,
  ): Promise<void> {
    if (this.reserve) return;
    this.reserve = structuredClone(reserve);
    await recordRunFinalizationReserve({
      store: this.context.store,
      run: this.context.run,
      limits: this.context.budget.limits,
      reserve,
      ...(onEvent ? { onEvent } : {}),
    });
  }

  async enterIfNeeded(onEvent?: EventSink): Promise<void> {
    const reserve =
      this.context.budget.finalizationReserveBeforeNextPrimaryTurn();
    if (reserve) await this.enter(reserve, onEvent);
  }

  async steer(fallback: () => Promise<UserMessage[]>): Promise<UserMessage[]> {
    if (!this.reserve) return fallback();
    if (this.finalizerStarted) return [];
    const message: UserMessage = {
      role: "user",
      content: FINALIZER_MESSAGE,
      timestamp: Date.now(),
    };
    const key = controlMessageEventKey(message.timestamp, FINALIZER_MESSAGE);
    this.preRecordedMessages.set(
      key,
      (this.preRecordedMessages.get(key) ?? 0) + 1,
    );
    this.finalizerStarted = true;
    return [message];
  }

  followUp(
    fallback: (mode: "follow_up") => Promise<UserMessage[]>,
  ): Promise<UserMessage[]> {
    return this.reserve ? Promise.resolve([]) : fallback("follow_up");
  }

  assertDelivered(text: string): void {
    if (this.reserve && (!this.finalizerStarted || text.trim().length === 0)) {
      throw new RunFinalizationReservedError(structuredClone(this.reserve));
    }
  }
}

export function finLife(
  host: { store: LocalStore },
  budget: RunBudgetTracker,
  run: Pick<RunRecord, "id" | "threadId">,
  preRecordedMessages: Map<string, number>,
): RunFinalizationReserveController {
  return new RunFinalizationReserveController(
    { store: host.store, run, budget },
    preRecordedMessages,
  );
}

export async function recordRunFinalizationReserve(input: {
  store: LocalStore;
  run: Pick<RunRecord, "id" | "threadId">;
  limits: RunLimits;
  reserve: RunFinalizationReserve;
  onEvent?: EventSink;
}): Promise<void> {
  if (
    (await input.store.listEvents(input.run.threadId)).some(
      (event) =>
        event.runId === input.run.id &&
        event.type === "run.finalization.reserved",
    )
  ) {
    return;
  }
  const event = await input.store.appendEvent(
    reserveEvent(input.run, input.limits, input.reserve),
  );
  await emit(input.onEvent, event);
}

function reserveEvent(
  run: Pick<RunRecord, "id" | "threadId">,
  limits: RunLimits,
  reserve: RunFinalizationReserve,
): AppendEventInput {
  return {
    threadId: run.threadId,
    runId: run.id,
    type: "run.finalization.reserved",
    category: "lifecycle",
    visibility: "user",
    payload: toJsonValue({
      status: "reserved",
      reasons: reserve.reasons,
      observed: reserve.observed,
      limits,
      reservedTurns: reserve.reservedTurns,
      reservedTokens: reserve.reservedTokens,
      reservedTimeoutMs: reserve.reservedTimeoutMs,
      message: reserve.message,
    }),
  };
}

async function emit(
  sink: EventSink | undefined,
  event: RunEvent,
): Promise<void> {
  if (!sink) return;
  try {
    await sink(event);
  } catch {}
}
