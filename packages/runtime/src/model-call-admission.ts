import {
  createAssistantMessageEventStream,
  type Api,
  type AssistantMessage,
  type AssistantMessageEventStream,
  type Context,
  type Model,
  type MutableModels,
  type StreamOptions,
} from "@earendil-works/pi-ai";

export type ModelCallMethod = "stream" | "streamSimple" | "complete" | "completeSimple";
export type ModelCallAdmissionCode = "capacity" | "budget" | "accounting" | "closed";

export interface ModelCallLease {
  /** Undefined means dispatch threw or its physical result rejected. It does
   * not establish zero usage or authorize refunding an uncertain reservation. */
  settle(message?: AssistantMessage): void;
}

export interface ModelCallAdmission {
  /** Classify host-owned reserve errors without sharing an error implementation. */
  errorCode?(error: unknown): ModelCallAdmissionCode | undefined;
  /** Synchronous backpressure: never hold a Run or wait for a child here. */
  reserve(input: {
    method: ModelCallMethod;
    model: Model<Api>;
    options?: StreamOptions;
  }): ModelCallLease;
}

const ADMISSION_MESSAGES: Record<ModelCallAdmissionCode, string> = {
  capacity: "Host model invocation capacity reached; active calls are retained.",
  budget: "Host model invocation allowance is exhausted or cannot be reserved.",
  accounting: "Host model invocation accounting could not be committed.",
  closed: "Host model invocation admission is closed.",
};

/** Host backpressure is terminal for routing, never provider health evidence. */
export class ModelCallAdmissionError extends Error {
  override readonly name = "ModelCallAdmissionError";
  readonly routeFailure = Object.freeze({
    kind: "napier.model-route-failure-signal" as const,
    schemaVersion: 1 as const,
    failureClass: "unknown" as const,
  });

  constructor(readonly code: ModelCallAdmissionCode, options?: ErrorOptions) {
    super(ADMISSION_MESSAGES[code], options);
  }
}

/** Keep host provenance through existing synthetic terminal-message adapters.
 * This process-local routing hint is not serialized into provider output. */
export function preserveModelAdmissionFailure(
  error: unknown,
  message: AssistantMessage,
): AssistantMessage {
  if (error instanceof ModelCallAdmissionError) {
    Object.defineProperty(message, "routeFailure", { value: error.routeFailure });
  }
  return message;
}

/** Wrap the raw model set inside the wire adapter. Binding methods to the raw
 * target prevents complete*'s internal stream* call from reserving twice. */
export function createAdmittedModels(
  models: MutableModels,
  admission?: ModelCallAdmission,
): MutableModels {
  if (!admission) return models;
  return new Proxy(models, {
    get(target, property) {
      if (property === "stream" || property === "streamSimple") {
        return (model: Model<Api>, context: Context, options?: StreamOptions) =>
          invokeStream(target, admission, property, model, context, options);
      }
      if (property === "complete" || property === "completeSimple") {
        return (model: Model<Api>, context: Context, options?: StreamOptions) =>
          invokeComplete(target, admission, property, model, context, options);
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function reserve(
  admission: ModelCallAdmission,
  method: ModelCallMethod,
  model: Model<Api>,
  options: StreamOptions | undefined,
): (message?: AssistantMessage) => void {
  options?.signal?.throwIfAborted();
  let lease: ModelCallLease;
  try {
    lease = admission.reserve(Object.freeze({
      method,
      model: freezeModel(structuredClone(model)),
      ...(options ? { options: Object.freeze({ ...options }) } : {}),
    }));
  }
  catch (cause) {
    if (cause instanceof ModelCallAdmissionError) throw cause;
    let code: ModelCallAdmissionCode | undefined;
    try { code = admission.errorCode?.(cause); }
    catch { /* A classifier failure cannot replace the original admission error. */ }
    const classified = code === "capacity" || code === "budget" || code === "accounting" || code === "closed"
      ? code : "accounting";
    throw new ModelCallAdmissionError(classified, { cause });
  }
  let attempted = false;
  return (message) => {
    if (attempted) return;
    attempted = true;
    try { lease.settle(message); }
    catch (cause) { throw new ModelCallAdmissionError("accounting", { cause }); }
  };
}

/** Model catalog data is a detached snapshot; provider mutation cannot change
 * an already recorded reservation. Signals and callbacks stay request-local. */
function freezeModel<T>(value: T, seen = new Set<object>()): T {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) freezeModel(child, seen);
  return Object.freeze(value);
}

async function invokeComplete(
  models: MutableModels,
  admission: ModelCallAdmission,
  method: "complete" | "completeSimple",
  model: Model<Api>,
  context: Context,
  options?: StreamOptions,
): Promise<AssistantMessage> {
  const settle = reserve(admission, method, model, options);
  let message: AssistantMessage;
  try { message = await Reflect.apply(models[method], models, [model, context, options]); }
  catch (error) { settle(); throw error; }
  settle(message);
  return message;
}

function invokeStream(
  models: MutableModels,
  admission: ModelCallAdmission,
  method: "stream" | "streamSimple",
  model: Model<Api>,
  context: Context,
  options?: StreamOptions,
): AssistantMessageEventStream {
  const settle = reserve(admission, method, model, options);
  let source: AssistantMessageEventStream;
  try { source = Reflect.apply(models[method], models, [model, context, options]); }
  catch (error) { settle(); throw error; }
  // Observe the physical result independently of consumer iteration/abort.
  // A provider ignoring cancellation continues to own its admission lease.
  const result = Promise.resolve().then(() => source.result()).then(
    (message) => { settle(message); return message; },
    (error: unknown) => { settle(); throw error; },
  );
  // Iteration-only consumers still receive failures through the generator.
  void result.catch(() => undefined);
  const failure = result.then(
    () => new Promise<never>(() => undefined),
    (error: unknown) => Promise.reject(error),
  );
  void failure.catch(() => undefined);
  const output = createAssistantMessageEventStream();
  output.result = () => result;
  output[Symbol.asyncIterator] = async function* () {
    const iterator = source[Symbol.asyncIterator]();
    try {
      for (;;) {
        const step = await Promise.race([iterator.next(), failure]);
        if (step.done) { await result; return; }
        if (step.value.type === "done" || step.value.type === "error") await result;
        yield step.value;
      }
    } finally {
      // A broken provider may leave next() pending even after result rejects.
      // Forward closure without making accounting failure wait on that source.
      try { void Promise.resolve(iterator.return?.()).catch(() => undefined); }
      catch { /* Consumer closure cannot replace the physical result. */ }
    }
  };
  return output;
}
