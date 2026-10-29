import type { ModelCallAttributionV1 } from "@napier/contracts/model-accounting";
import { readEnteredModelCall, type EnteredModelCall } from "./model-call-attribution.js";
import type { ModelInvocationAccounting } from "./model-call-accounting-port.js";

declare const RECOVERY_HANDLE: unique symbol;
/** Process-local observation capability. It never grants another dispatch. */
export interface ModelCallRecoveryHandle { readonly [RECOVERY_HANDLE]: true }

interface RecoveryState {
  accounting: ModelInvocationAccounting;
  attribution: ModelCallAttributionV1;
  completion?: Promise<void>;
}
const handles = new WeakMap<object, RecoveryState>();
const calls = new WeakMap<object, ModelCallRecoveryHandle>();

export function prepareModelCallRecovery(call: EnteredModelCall, accounting: ModelInvocationAccounting,
  attribution: ModelCallAttributionV1): ModelCallRecoveryHandle {
  const entered = readEnteredModelCall(call, accounting.repository);
  if (entered.authority !== accounting.owner || entered.attribution !== attribution)
    throw new Error("Model recovery observation differs from entered dispatch authority");
  const handle = Object.freeze({}) as ModelCallRecoveryHandle;
  handles.set(handle, { accounting: Object.freeze({ repository: accounting.repository,
    owner: accounting.owner, logicalCallId: accounting.logicalCallId }), attribution: entered.attribution });
  calls.set(call, handle);
  return handle;
}

/** Only the admitted physical result can complete this observation. */
export function observeModelCallRecovery(call: EnteredModelCall | undefined, result: Promise<unknown>): void {
  if (!call) return;
  const handle = calls.get(call), state = handle && handles.get(handle);
  if (!state) return;
  if (state.completion) throw new Error("Model recovery observation is already bound");
  state.completion = result.then(() => undefined);
  void state.completion.catch(() => undefined);
}

export type ModelRecoveryReadiness =
  | "known" | "undispatched" | "incomplete" | "pending_timeout"
  | "cancelled" | "accounting_failed" | "invalid_handle" | "legacy_unaccounted" | "not_requested";

export async function awaitModelCallRecovery(input: {
  handle: ModelCallRecoveryHandle | undefined;
  attribution: ModelCallAttributionV1 | undefined;
  signal: AbortSignal;
  deadlineAt: number;
}): Promise<ModelRecoveryReadiness> {
  const state = input.handle && handles.get(input.handle);
  if (!state || !state.completion || !input.attribution ||
    state.attribution.physicalId !== input.attribution.physicalId ||
    state.attribution.contentSha256 !== input.attribution.contentSha256) return "invalid_handle";
  if (input.signal.aborted) return "cancelled";
  const remaining = input.deadlineAt - Date.now();
  if (remaining <= 0) return "pending_timeout";
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: () => void = () => undefined;
  const stopped = new Promise<"cancelled" | "pending_timeout">((resolve) => {
    abort = () => resolve("cancelled");
    input.signal.addEventListener("abort", abort, { once: true });
    timer = setTimeout(() => resolve("pending_timeout"), remaining);
    timer.unref?.();
  });
  try {
    const completed = await Promise.race([
      state.completion.then(() => "completed" as const, () => "accounting_failed" as const), stopped,
    ]);
    if (completed !== "completed") return completed;
    if (input.signal.aborted) return "cancelled";
    if (Date.now() >= input.deadlineAt) return "pending_timeout";
    const receipt = state.accounting.repository.readAttemptReceipt({ owner: state.accounting.owner,
      physicalId: state.attribution.physicalId, attributionSha256: state.attribution.contentSha256 });
    if (Date.now() >= input.deadlineAt) return "pending_timeout";
    return receipt.state === "pending" ? "accounting_failed" : receipt.state;
  } catch {
    return "accounting_failed";
  } finally {
    clearTimeout(timer);
    input.signal.removeEventListener("abort", abort);
  }
}
