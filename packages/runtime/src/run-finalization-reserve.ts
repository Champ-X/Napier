import type { UserMessage } from "@earendil-works/pi-ai";
import type { RunEvent, RunLimits, RunRecord } from "@napier/contracts";
import type { ContextPolicy } from "@napier/contracts/harness-experiments";

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
    private readonly options: {
      requestAware?: boolean;
      requestContext?: boolean;
      drainSteering?: () => Promise<UserMessage[]>;
    } = {},
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
      this.context.budget.finalizationReserveBeforeNextPrimaryTurn(
        Date.now(),
        this.options.requestAware,
      );
    if (reserve) await this.enter(reserve, onEvent);
  }

  async steer(fallback: () => Promise<UserMessage[]>): Promise<UserMessage[]> {
    if (!this.reserve) return fallback();
    const queued = (await this.options.drainSteering?.()) ?? [];
    if (this.finalizerStarted) return queued;
    if (this.options.requestContext) {
      // v2 carries fresh accounting in the bound request-local context. A
      // synthetic user reminder would alter task classification and history.
      this.finalizerStarted = true;
      return queued;
    }
    const text = this.reserve.requestForecast
      ? [FINALIZER_MESSAGE, requestAwareGuidance(this.reserve)].join("\n")
      : FINALIZER_MESSAGE;
    const message: UserMessage = {
      role: "user",
      content: text,
      timestamp: Date.now(),
    };
    const key = controlMessageEventKey(message.timestamp, text);
    this.preRecordedMessages.set(
      key,
      (this.preRecordedMessages.get(key) ?? 0) + 1,
    );
    this.finalizerStarted = true;
    return [...queued, message];
  }

  followUp(
    fallback: (mode: "follow_up") => Promise<UserMessage[]>,
  ): Promise<UserMessage[]> {
    return fallback("follow_up");
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
  policy?: ContextPolicy,
  drainControl?: (mode: "steering" | "follow_up") => Promise<UserMessage[]>,
): RunFinalizationReserveController {
  return new RunFinalizationReserveController(
    { store: host.store, run, budget },
    preRecordedMessages,
    {
      requestAware:
        policy?.finalization === "request-aware-v1" ||
        policy?.finalization === "request-aware-v2",
      requestContext: policy?.finalization === "request-aware-v2",
      ...(drainControl
        ? { drainSteering: () => drainControl("steering") }
        : {}),
    },
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
      ...(reserve.requestForecast
        ? { requestForecast: reserve.requestForecast }
        : {}),
      message: reserve.message,
    }),
  };
}

function requestAwareGuidance(reserve: RunFinalizationReserve): string {
  return [
    `Recent uncached model-call estimate: ${reserve.requestForecast!.uncachedCallTokens} tokens, based on ${reserve.requestForecast!.sampleCount} primary calls. Cache reuse is uncertain; this is an estimate, not extra budget.`,
    "Preserve the user's latest requirements and mandatory verification. Avoid redundant verification or cosmetic plan bookkeeping once evidence already establishes the requested result; remaining plan metadata does not itself require more workspace changes.",
    "Finish essential scoped actions and report only what completed evidence supports. If work remains, state it explicitly; a budget notice never establishes task success.",
  ].join("\n");
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
