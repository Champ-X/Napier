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
import type { ModelCallAttributionV1 } from "@napier/contracts/model-accounting";
import { bindModelCallRegistry, bindModelResultAttribution, consumeModelCallAttribution,
  enterRawModelCall, modelCallRegistryIdentity, readEnteredModelCall, type EnteredModelCall } from "./model-call-attribution.js";
import { modelAdmittedRequestDigests } from "./model-call-capture.js";
import { modelInputAllowance } from "./model-call-budget-allowance.js";
import { canonicalJson } from "./ed25519.js";
import { projectPendingModelUsage, type ModelUsageProjectionPort } from "./model-usage-projection.js";
import { modelAccountingBinding } from "./model-accounting-binding.js";
import { observeModelCallRecovery } from "./model-call-recovery.js";
import type { ModelCallAdmission, ModelCallLease, ModelCallMethod, ModelCallAdmissionCode } from "./model-call-admission-types.js";
export type { ModelCallAdmission, ModelCallLease, ModelCallMethod, ModelCallAdmissionCode } from "./model-call-admission-types.js";

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
  const admitted = new Proxy(models, {
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
  bindModelCallRegistry(admitted, models);
  return admitted;
}

function reserve(
  registry: MutableModels,
  admission: ModelCallAdmission | undefined,
  method: ModelCallMethod,
  model: Model<Api>,
  context: Context,
  options: StreamOptions | undefined,
): { call?: EnteredModelCall; attribution?: ModelCallAttributionV1; settle(message?: AssistantMessage): Promise<void> } {
  const active = consumeModelCallAttribution(registry);
  const accounting = modelAccountingBinding(admission);
  if (accountingState(registry).closing) throw new ModelCallAdmissionError("closed");
  options?.signal?.throwIfAborted();
  if (active) {
    if (!accounting || accounting.source.sourceId !== active.attribution.receiptSourceId)
      throw new ModelCallAdmissionError("accounting", { cause: new Error("Model invocation has no matching durable source") });
    const digests = modelAdmittedRequestDigests({ model, context, ...(options ? { options } : {}) });
    if (active.attribution.method !== method || Object.entries(digests).some(([key, value]) =>
      active.attribution.capture[key as keyof typeof digests] !== value) ||
      (active.attribution.capture.inputAllowance && canonicalJson(active.attribution.capture.inputAllowance) !==
        canonicalJson(modelInputAllowance(model, context))))
      throw new ModelCallAdmissionError("accounting", { cause: new Error("Model invocation differs from prepared capture") });
  }
  if (!admission) return { settle: async () => undefined };
  let lease: ModelCallLease;
  try {
    const request = Object.freeze({
      method,
      model: freezeModel(structuredClone(model)),
      ...(options ? { options: Object.freeze({ ...options }) } : {}),
      ...(active ? { attribution: active.attribution } : {}),
    });
    lease = active ? accounting!.reserve(request, active.call) : admission.reserve(request);
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
  let settled = false;
  let observation: Promise<void> | undefined;
  let completed: () => void = () => undefined;
  let failed: (error: unknown) => void = () => undefined;
  const completion = new Promise<void>((resolve, reject) => { completed = resolve; failed = reject; });
  void completion.catch(() => undefined);
  observeModelCallRecovery(active?.call, completion);
  return { ...(active ? { call: active.call, attribution: active.attribution } : {}), settle(message) {
    if (observation) return observation;
    const attempt = async () => {
      try {
        // The lease immediately normalizes bounded usage fields. Cloning an
        // arbitrary provider response here could fail before usage is recorded.
        if (!settled) { lease.settle(message); settled = true; }
        if (active) await projectPendingModelUsage(accounting!.source,
          readEnteredModelCall(active.call).repository as ModelUsageProjectionPort,
          { physicalId: active.attribution.physicalId });
        accountingState(registry).failed.delete(attempt);
      } catch (cause) {
        accountingState(registry).failed.add(attempt);
        throw cause instanceof ModelCallAdmissionError ? cause : new ModelCallAdmissionError("accounting", { cause });
      }
    };
    observation = attempt();
    void observation.then(completed, failed);
    return observation;
  } };
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
  admission: ModelCallAdmission | undefined,
  method: "complete" | "completeSimple",
  model: Model<Api>,
  context: Context,
  options?: StreamOptions,
): Promise<AssistantMessage> {
  const reservation = reserve(models, admission, method, model, context, options);
  let message: AssistantMessage;
  const result = (async () => {
    if (reservation.call) options?.signal?.throwIfAborted();
    try { message = await enterRawModelCall(reservation.call, () => Reflect.apply(models[method], models, [model, context, options])); }
    catch (error) { await reservation.settle(); throw error; }
    await reservation.settle(message);
    const output = reservation.attribution ? structuredClone(message) : message;
    return reservation.attribution ? bindModelResultAttribution(output, reservation.attribution) : output;
  })();
  trackPhysicalResult(models, result);
  return result;
}

function invokeStream(
  models: MutableModels,
  admission: ModelCallAdmission | undefined,
  method: "stream" | "streamSimple",
  model: Model<Api>,
  context: Context,
  options?: StreamOptions,
): AssistantMessageEventStream {
  const reservation = reserve(models, admission, method, model, context, options);
  if (reservation.call) options?.signal?.throwIfAborted();
  let source: AssistantMessageEventStream;
  try { source = enterRawModelCall(reservation.call, () => Reflect.apply(models[method], models, [model, context, options])); }
  catch (error) {
    const failure = reservation.settle().then(() => { throw error; });
    trackPhysicalResult(models, failure);
    if (!reservation.attribution) throw error;
    const output = createAssistantMessageEventStream();
    output.result = () => failure;
    output[Symbol.asyncIterator] = async function* () { await failure; };
    if (reservation.attribution) bindModelResultAttribution(output, reservation.attribution);
    return output;
  }
  // Observe the physical result independently of consumer iteration/abort.
  // A provider ignoring cancellation continues to own its admission lease.
  const result = Promise.resolve().then(() => source.result()).then(
    async (message) => {
      await reservation.settle(message);
      const output = reservation.attribution ? structuredClone(message) : message;
      return reservation.attribution ? bindModelResultAttribution(output, reservation.attribution) : output;
    },
    async (error: unknown) => { await reservation.settle(); throw error; },
  );
  trackPhysicalResult(models, result);
  // Iteration-only consumers still receive failures through the generator.
  void result.catch(() => undefined);
  const failure = result.then(
    () => new Promise<never>(() => undefined),
    (error: unknown) => Promise.reject(error),
  );
  void failure.catch(() => undefined);
  const output = createAssistantMessageEventStream();
  if (reservation.attribution) bindModelResultAttribution(output, reservation.attribution);
  output.result = () => result;
  output[Symbol.asyncIterator] = async function* () {
    const iterator = source[Symbol.asyncIterator]();
    try {
      for (;;) {
        const step = await Promise.race([iterator.next(), failure]);
        if (step.done) { await result; return; }
        if (step.value.type === "done" || step.value.type === "error") {
          const final = await result;
          yield step.value.type === "done" ? { ...step.value, message: final } : { ...step.value, error: final };
        } else yield step.value;
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

interface AccountingState { closing: boolean; pending: Set<Promise<unknown>>; failed: Set<() => Promise<void>> }
const accountingStates = new WeakMap<object, AccountingState>();
function accountingState(registry: object): AccountingState {
  const key = modelCallRegistryIdentity(registry);
  let state = accountingStates.get(key);
  if (!state) { state = { closing: false, pending: new Set(), failed: new Set() }; accountingStates.set(key, state); }
  return state;
}
function trackPhysicalResult(registry: object, result: Promise<unknown>): void {
  const state = accountingState(registry);
  state.pending.add(result);
  void result.then(() => state.pending.delete(result), () => state.pending.delete(result));
}

/** Stop dispatch first; failed persistence retries the same observation, never the provider. */
export async function drainModelCallAccounting(registry: object): Promise<void> {
  const state = accountingState(registry);
  state.closing = true;
  while (state.pending.size) await Promise.allSettled([...state.pending]);
  const retried = await Promise.allSettled([...state.failed].map((retry) => retry()));
  const failures = retried.filter((entry) => entry.status === "rejected");
  if (failures.length) throw new AggregateError(failures.map((entry) => entry.reason), "Model observation accounting did not drain");
}
