import type {
  Api,
  AssistantMessageEventStream,
  Context,
  Model,
  Models,
  SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import type { ModelContextEnvelopeReceipt } from "@napier/contracts";

import type { ModelTurnDeadlinePolicy } from "./model-turn-deadline.js";
import { snapshotModelInvocation } from "./model-invocation-snapshot.js";
import {
  createCancellableModelStream,
  type ModelStreamCancellationFailure,
} from "./model-stream-transport.js";

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
  }> {
    this.assertActive(input.options);
    const request = snapshotModelInvocation(input);
    const options = this.optionsWithLifetimeSignal(request.options);
    const captured = await input.capture({
      model: request.model,
      context: request.context,
      options,
      phase: input.phase,
      cacheScope: this.cacheScope,
    });
    this.assertActive(options);
    const invocation: ModelSessionInvocation = {
      ...captured,
      model: request.model,
      options,
      phase: input.phase,
    };
    const onCancellationFailure = input.onCancellationFailure ?? this.ports.onCancellationFailure;
    const next = (): AssistantMessageEventStream => {
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
    return {
      ...invocation,
      source: input.invoke ? input.invoke(invocation, next) : next(),
    };
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
