import type {
  Api,
  AssistantMessageEventStream,
  Context,
  Model,
  Models,
  SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import type { ModelContextEnvelopeReceipt } from "@napier/contracts";
import type { ModelAccountingPhase, ModelCallAttributionV1, ModelCallCaptureBinding } from "@napier/contracts/model-accounting";

import type { ModelTurnDeadlinePolicy } from "./model-turn-deadline.js";
import { snapshotModelInvocation } from "./model-invocation-snapshot.js";
import {
  createCancellableModelStream,
  type ModelStreamCancellationFailure,
} from "./model-stream-transport.js";
import { closeUnpreparedModelInvocation, dispatchAccountedModelInvocation, type ModelInvocationAccounting } from "./model-call-accounting-driver.js";
import { createModelCallCaptureBinding } from "./model-call-capture.js";
import { linkLogicalModelStream } from "./model-call-logical-linkage.js";
import type { ModelCallRecoveryHandle } from "./model-call-recovery.js";

export interface ModelSessionLifetime {
  signal?: AbortSignal;
  remainingMs(): number;
  assertActive(): void;
}

export interface ModelSessionCaptureRequest {
  model: Model<Api>;
  context: Context;
  options: SimpleStreamOptions | undefined;
  phase: string;
  /** Opaque session identity: never substitute the parent Run for a child. */
  cacheScope: object;
}

export interface CapturedModelInvocation {
  context: Context;
  envelope: ModelContextEnvelopeReceipt;
  accountingCapture?: ModelCallCaptureBinding;
}

export interface ModelSessionInvocation extends CapturedModelInvocation {
  model: Model<Api>;
  options: SimpleStreamOptions | undefined;
  phase: string;
}

export interface ModelSessionOptions {
  /** The registry's admitted model adapter; never a second admission wrapper. */
  models: Pick<Models, "streamSimple">;
  lifetime: ModelSessionLifetime;
  deadlinePolicy?: Partial<ModelTurnDeadlinePolicy>;
  onCancellationFailure?(
    failure: ModelStreamCancellationFailure,
    invocation: ModelSessionInvocation,
  ): Promise<void> | void;
}

export interface OpenModelSessionInvocation {
  phase: string;
  accounting?: ModelInvocationAccounting | undefined;
  onAttribution?(attribution: ModelCallAttributionV1): void;
  model: Model<Api>;
  context: Context;
  options: SimpleStreamOptions | undefined;
  capture(request: ModelSessionCaptureRequest): Promise<CapturedModelInvocation>;
  onCancellationFailure?: ModelSessionOptions["onCancellationFailure"];
  invoke?(
    invocation: ModelSessionInvocation,
    next: () => AssistantMessageEventStream,
  ): AssistantMessageEventStream;
}

/** Shared invocation mechanics. Context, permissions, routing and usage policy
 * stay with the caller; a session owns only capture scope and transport lifetime. */
export class ModelSession {
  private readonly cacheScope = {};

  constructor(private readonly ports: ModelSessionOptions) {}

  async open(input: OpenModelSessionInvocation): Promise<ModelSessionInvocation & {
    source: AssistantMessageEventStream;
    recovery?: ModelCallRecoveryHandle;
  }> {
    try { this.assertActive(input.options); }
    catch (error) {
      if (input.accounting) await closeUnpreparedModelInvocation(input.accounting, "lifetime_rejected_before_capture");
      throw error;
    }
    let request: ReturnType<typeof snapshotModelInvocation>;
    let options: SimpleStreamOptions | undefined;
    let captured: CapturedModelInvocation;
    try {
      request = snapshotModelInvocation(input);
      options = this.optionsWithLifetimeSignal(request.options);
      captured = await input.capture({
        model: request.model,
        context: request.context,
        options,
        phase: input.phase,
        cacheScope: this.cacheScope,
      });
      this.assertActive(options);
      if (input.accounting && !captured.accountingCapture) captured = { ...captured,
        accountingCapture: createModelCallCaptureBinding({ model: request.model, context: captured.context,
          ...(options ? { options } : {}), envelope: captured.envelope }),
      };
    } catch (error) {
      if (input.accounting) await closeUnpreparedModelInvocation(input.accounting, "capture_or_lifetime_rejected");
      throw error;
    }
    const invocation: ModelSessionInvocation = {
      ...captured,
      model: request.model,
      options,
      phase: input.phase,
    };
    const onCancellationFailure = input.onCancellationFailure ?? this.ports.onCancellationFailure;
    let invoked = false;
    const next = (): AssistantMessageEventStream => {
      if (invoked) throw new Error("Model invocation dispatch closure may only be used once");
      invoked = true;
      this.assertActive(options);
      return createCancellableModelStream({
        models: this.ports.models,
        remainingMs: () => this.ports.lifetime.remainingMs(),
        ...(this.ports.deadlinePolicy ? { deadlinePolicy: this.ports.deadlinePolicy } : {}),
        ...(onCancellationFailure ? {
          onCancellationFailure: (failure) => onCancellationFailure(failure, invocation),
        } : {}),
      }, request.model, captured.context, options);
    };
    const invoke = () => input.invoke ? input.invoke(invocation, next) : next();
    if (!input.accounting) return { ...invocation, source: invoke() };
    const dispatched = await dispatchAccountedModelInvocation({
      ...(input.onAttribution ? { onAttribution: input.onAttribution } : {}),
      accounting: input.accounting, models: this.ports.models, method: "streamSimple",
      phase: input.phase as ModelAccountingPhase, model: request.model,
      capture: captured.accountingCapture!, invoke,
    });
    return { ...invocation, source: linkLogicalModelStream(dispatched.value, dispatched.attribution), recovery: dispatched.recovery };
  }

  private assertActive(options: SimpleStreamOptions | undefined): void {
    this.ports.lifetime.assertActive();
    this.ports.lifetime.signal?.throwIfAborted();
    options?.signal?.throwIfAborted();
  }

  private optionsWithLifetimeSignal(
    options: SimpleStreamOptions | undefined,
  ): SimpleStreamOptions | undefined {
    const lifetimeSignal = this.ports.lifetime.signal;
    if (!lifetimeSignal || lifetimeSignal === options?.signal) return options;
    return {
      ...options,
      signal: options?.signal
        ? AbortSignal.any([lifetimeSignal, options.signal])
        : lifetimeSignal,
    };
  }
}
