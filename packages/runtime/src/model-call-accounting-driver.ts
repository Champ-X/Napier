import type { Api, Model, Models } from "@earendil-works/pi-ai";
import type { ModelAccountingPhase, ModelCallAttributionV1, ModelCallCaptureBinding, ModelCallMethod } from "@napier/contracts/model-accounting";
import { bindModelResultAttribution, issueModelUndispatchedDriverProof, modelCallEnteredRaw,
  readPreparedModelCall, readModelUsagePreparationAuthority, withModelCallAttribution,
  type EnteredModelCall, type ModelUndispatchedDriverProof, type ModelUsagePreparationAuthority,
  type PreparedModelCall } from "./model-call-attribution.js";
import type { ModelUsageProjectionPort } from "./model-usage-projection.js";

export interface ModelCallAccountingRepositoryPort extends ModelUsageProjectionPort {
  prepare(input: {
    owner: ModelUsagePreparationAuthority;
    method: ModelCallMethod;
    phase: ModelAccountingPhase;
    logicalCallId: string;
    model: Model<Api>;
    capture: ModelCallCaptureBinding;
    route?: ModelCallAttributionV1["route"];
    recovery?: ModelCallAttributionV1["recovery"];
  }): Promise<PreparedModelCall>;
  enter(call: PreparedModelCall): Promise<EnteredModelCall>;
  rejectUndispatched(proof: ModelUndispatchedDriverProof, reason: string): Promise<unknown>;
  closeUndispatchedChildInvocation(proof: ModelUndispatchedDriverProof, reason: string): Promise<void>;
}

export interface ModelInvocationAccounting {
  repository: ModelCallAccountingRepositoryPort;
  owner: ModelUsagePreparationAuthority;
  logicalCallId: string;
  route?: ModelCallAttributionV1["route"];
  recovery?: ModelCallAttributionV1["recovery"];
}

/** Preparation can await; the scoped closure enters the admitted API only once. */
export async function dispatchAccountedModelInvocation<T extends object>(input: {
  accounting: ModelInvocationAccounting;
  models: Pick<Models, "streamSimple"> | Pick<Models, "completeSimple">;
  method: ModelCallMethod;
  phase: ModelAccountingPhase;
  model: Model<Api>;
  capture: ModelCallCaptureBinding;
  onAttribution?(attribution: ModelCallAttributionV1): void;
  invoke(): T;
}): Promise<{ value: T; attribution: ModelCallAttributionV1 }> {
  const { accounting } = input;
  const call = await accounting.repository.prepare({
    owner: accounting.owner, method: input.method, phase: input.phase,
    logicalCallId: accounting.logicalCallId, model: input.model, capture: input.capture,
    ...(accounting.route ? { route: accounting.route } : {}),
    ...(accounting.recovery ? { recovery: accounting.recovery } : {}),
  }).catch(async (error: unknown) => {
    await closeUnpreparedModelInvocation(accounting, "preparation_rejected");
    throw error;
  });
  const { attribution } = readPreparedModelCall(call);
  let rejected = false;
  const reject = async () => {
    if (rejected || modelCallEnteredRaw(call)) return;
    rejected = true;
    await accounting.repository.rejectUndispatched(issueModelUndispatchedDriverProof(call), "driver_pre_entry_rejection");
  };
  try {
    input.onAttribution?.(attribution);
    const entered = await accounting.repository.enter(call);
    const value = withModelCallAttribution(entered, input.models, input.invoke);
    // An async complete API can reject before raw entry. Observe that promise
    // immediately while the independent undispatched transaction is awaited.
    if (value instanceof Promise) void value.catch(() => undefined);
    if (!modelCallEnteredRaw(call)) await reject();
    return { value: bindModelResultAttribution(value, attribution), attribution };
  } catch (error) {
    await reject();
    throw error;
  }
}

export async function closeUnpreparedModelInvocation(accounting: ModelInvocationAccounting, reason: string): Promise<void> {
  if (readModelUsagePreparationAuthority(accounting.owner).owner.kind !== "child") return;
  await accounting.repository.closeUndispatchedChildInvocation(issueModelUndispatchedDriverProof(accounting.owner), reason);
}
