import { AsyncLocalStorage } from "node:async_hooks";
import type { ModelCallAttributionV1 } from "@napier/contracts/model-accounting";

export type ModelUsagePreparationOwner =
  | { kind: "run"; threadId: string; runId: string; token: string }
  | { kind: "child"; threadId: string; runId: string; parentRunId: string;
      taskId: string; executionId: string; childInvocationId: string;
      invocationIndex: number; token: string; expectedExecutionRevision: number }
  | { kind: "operation"; operationId: string; operation: string };

declare const PREPARATION_AUTHORITY: unique symbol;
declare const PREPARED_CALL: unique symbol;
declare const ENTERED_CALL: unique symbol;
declare const UNDISPATCHED_PROOF: unique symbol;

export interface ModelUsagePreparationAuthority { readonly [PREPARATION_AUTHORITY]: true }
export interface PreparedModelCall { readonly [PREPARED_CALL]: true }
export interface EnteredModelCall { readonly [ENTERED_CALL]: true }
export interface ModelUndispatchedDriverProof { readonly [UNDISPATCHED_PROOF]: true }
export type ModelUndispatchedProof = ModelUndispatchedDriverProof;

export interface ModelUsagePreparationBinding {
  repository: object;
  owner: ModelUsagePreparationOwner;
}

export interface ModelCallAttributionBinding {
  repository: object;
  authority: ModelUsagePreparationAuthority;
  attribution: ModelCallAttributionV1;
}

interface CallState extends ModelCallAttributionBinding {
  entered?: EnteredModelCall;
  consumed: boolean;
  rawEntered: boolean;
  closed: boolean;
}

const authorities = new WeakMap<object, ModelUsagePreparationBinding>();
const calls = new WeakMap<object, CallState>();
const undispatched = new WeakMap<object, {
  repository: object;
  authority: ModelUsagePreparationAuthority;
  attribution?: ModelCallAttributionV1;
}>();
const scope = new AsyncLocalStorage<{ call: EnteredModelCall; registry?: object } | undefined>();
const registryIdentities = new WeakMap<object, object>();
const resultBindings = new WeakMap<object, ModelCallAttributionV1>();
const undispatchedLogicalResults = new WeakSet<object>();

/** Internal Store composition only; these issuers are not public runtime exports. */
export function issueModelUsagePreparationAuthority(input: ModelUsagePreparationBinding): ModelUsagePreparationAuthority {
  const capability = Object.freeze({}) as ModelUsagePreparationAuthority;
  authorities.set(capability, { repository: input.repository, owner: Object.freeze({ ...input.owner }) });
  return capability;
}

export function readModelUsagePreparationAuthority(
  capability: ModelUsagePreparationAuthority,
  repository?: object,
): ModelUsagePreparationBinding {
  const binding = object(capability) ? authorities.get(capability) : undefined;
  if (!binding || (repository && binding.repository !== repository))
    throw new Error("Model usage preparation requires native owner authority");
  return { repository: binding.repository, owner: { ...binding.owner } };
}

export function issuePreparedModelCall(input: ModelCallAttributionBinding): PreparedModelCall {
  readModelUsagePreparationAuthority(input.authority, input.repository);
  const capability = Object.freeze({}) as PreparedModelCall;
  calls.set(capability, { ...input, attribution: freeze(structuredClone(input.attribution)),
    consumed: false, rawEntered: false, closed: false });
  return capability;
}

export function readPreparedModelCall(call: PreparedModelCall, repository?: object): ModelCallAttributionBinding {
  return binding(state(call, repository));
}

/** Called only after the Store's durable dispatch-intent commit. */
export function enterPreparedModelCall(call: PreparedModelCall, repository?: object): EnteredModelCall {
  const entry = state(call, repository);
  if (entry.closed || entry.consumed) throw new Error("Model invocation dispatch authority was already consumed");
  if (!entry.entered) {
    entry.entered = Object.freeze({}) as EnteredModelCall;
    calls.set(entry.entered, entry);
  }
  return entry.entered;
}

export function readEnteredModelCall(call: EnteredModelCall, repository?: object): ModelCallAttributionBinding {
  const entry = state(call, repository);
  if (entry.entered !== call) throw new Error("Model invocation has no entered dispatch authority");
  return binding(entry);
}

/** Tie outer adapter proxies to the same registry identity without putting it in options. */
export function bindModelCallRegistry(adapter: object, identity: object): void {
  registryIdentities.set(adapter, registryIdentities.get(identity) ?? identity);
}

export function modelCallRegistryIdentity(registry: object): object {
  return registryIdentities.get(registry) ?? registry;
}

export function modelAccountingLinkage(attribution: ModelCallAttributionV1) {
  return { physicalId: attribution.physicalId, attributionSha256: attribution.contentSha256,
    accountingMode: "physical_receipt_v1" as const };
}

export function withModelCallAttribution<T>(call: EnteredModelCall, registry: object, invoke: () => T): T {
  readEnteredModelCall(call);
  return scope.run({ call, registry: registryIdentities.get(registry) ?? registry }, invoke);
}

/** The admitted wrapper consumes before reserve, so denial can still prove no raw entry. */
export function consumeModelCallAttribution(registry: object): {
  call: EnteredModelCall;
  attribution: ModelCallAttributionV1;
} | undefined {
  const active = scope.getStore();
  if (!active) return undefined;
  if (active.registry !== (registryIdentities.get(registry) ?? registry))
    throw new Error("Model invocation dispatch belongs to another registry");
  const entry = state(active.call);
  if (entry.entered !== active.call || entry.consumed || entry.closed)
    throw new Error("Model invocation dispatch authority was already consumed");
  entry.consumed = true;
  return { call: active.call, attribution: entry.attribution };
}

/** Clear the carrier before provider code, including its asynchronous descendants. */
export function enterRawModelCall<T>(call: EnteredModelCall | undefined, invoke: () => T): T {
  if (call) {
    const entry = state(call);
    if (!entry.consumed || entry.rawEntered || entry.closed)
      throw new Error("Model invocation raw entry is not authorized");
    entry.rawEntered = true;
  }
  return scope.run(undefined, invoke);
}

/** Driver-only proof. Store must still atomically exclude/fence preparation races. */
export function issueModelUndispatchedDriverProof(
  subject: ModelUsagePreparationAuthority | PreparedModelCall | EnteredModelCall,
): ModelUndispatchedDriverProof {
  const entry = object(subject) ? calls.get(subject) : undefined;
  if (entry?.rawEntered || entry?.closed) throw new Error("Entered model invocation cannot claim undispatched usage");
  const authority = entry?.authority ?? subject as ModelUsagePreparationAuthority;
  const owner = readModelUsagePreparationAuthority(authority);
  if (entry) entry.closed = true;
  const proof = Object.freeze({}) as ModelUndispatchedDriverProof;
  undispatched.set(proof, { repository: owner.repository, authority,
    ...(entry ? { attribution: entry.attribution } : {}) });
  return proof;
}

export function readModelUndispatchedDriverProof(proof: ModelUndispatchedDriverProof, repository?: object) {
  const value = object(proof) ? undispatched.get(proof) : undefined;
  if (!value || (repository && value.repository !== repository))
    throw new Error("Model undispatched settlement requires private driver proof");
  return { ...value };
}

export function readModelUndispatchedProof(proof: ModelUndispatchedDriverProof) {
  const { attribution } = readModelUndispatchedDriverProof(proof);
  if (!attribution) throw new Error("Undispatched physical observation requires prepared attribution");
  return { physicalId: attribution.physicalId, attributionSha256: attribution.contentSha256 };
}

export function modelCallEnteredRaw(call: PreparedModelCall | EnteredModelCall): boolean {
  return state(call).rawEntered;
}

/** Linkage is display evidence only; it never grants accounting or execution authority. */
export function bindModelResultAttribution<T extends object>(result: T, attribution: ModelCallAttributionV1): T {
  resultBindings.set(result, attribution);
  return result;
}

export function modelResultAttribution(result: unknown): ModelCallAttributionV1 | undefined {
  return object(result) ? resultBindings.get(result) : undefined;
}

/** Display-only diagnostic: no invocation was prepared and no provider entered. */
export function markModelLogicalUndispatched(result: object): void { undispatchedLogicalResults.add(result); }

export function modelResultAccountingLinkage(result: unknown) {
  const attribution = modelResultAttribution(result);
  return attribution ? modelAccountingLinkage(attribution) : object(result) && undispatchedLogicalResults.has(result)
    ? { modelCallDisposition: "not_dispatched" as const } : {};
}

export function copyModelResultAttribution<T extends object>(source: unknown, target: T): T {
  const attribution = modelResultAttribution(source);
  return attribution ? bindModelResultAttribution(target, attribution) : target;
}

function state(call: unknown, repository?: object): CallState {
  const value = object(call) ? calls.get(call) : undefined;
  if (!value || (repository && value.repository !== repository))
    throw new Error("Model invocation requires native dispatch authority");
  return value;
}

function binding(entry: CallState): ModelCallAttributionBinding {
  return { repository: entry.repository, authority: entry.authority, attribution: entry.attribution };
}

function object(value: unknown): value is object { return !!value && typeof value === "object"; }

function freeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const item of Object.values(value)) freeze(item);
  return Object.freeze(value);
}
