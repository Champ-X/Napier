import { isDeepStrictEqual } from "node:util";
import type { AgentModelCallPreparation, AgentModelCallFinalization, AgentModelInvocation,
  PreparedAgentModelCall, AgentModelCallLifecycle } from "./model-call-lifecycle-types.js";
export type { AgentModelCallFinalization } from "./model-call-lifecycle-types.js";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import type {
  AssistantMessageEventStream,
  Context,
  SimpleStreamOptions,
} from "@earendil-works/pi-ai";

import {
  agentModelStreamLife,
  type AgentModelStreamLifecycleInput,
} from "./agent-model-stream-lifecycle.js";

export interface AgentTurnModelCallPipeline {
  createAgentTurnStream(input: AgentModelStreamLifecycleInput): StreamFn;
  createInvocationLifecycle(): AgentModelCallLifecycle;
}

export interface AgentModelCallPatch {
  context?: Context;
  options?: SimpleStreamOptions;
}

export interface AgentModelCallExtension {
  id: string;
  order?: number;
  prepare?(
    call: Readonly<AgentModelCallPreparation>,
  ): AgentModelCallPatch | void | Promise<AgentModelCallPatch | void>;
  finalize?(
    call: Readonly<AgentModelCallFinalization>,
  ): AgentModelCallPatch | void | Promise<AgentModelCallPatch | void>;
  around?(
    call: Readonly<AgentModelInvocation>,
    next: () => AssistantMessageEventStream,
  ): AssistantMessageEventStream;
}

export interface AgentModelCallExtensionInspection {
  id: string;
  owner: string;
  order: number;
  prepare: boolean;
  finalize: boolean;
  around: boolean;
}

interface StoredExtension {
  owner: string;
  sequence: number;
  extension: Required<Pick<AgentModelCallExtension, "id" | "order">> &
    Omit<AgentModelCallExtension, "id" | "order">;
}

const EXTENSION_ID = /^[a-z][a-z0-9_.-]{2,79}$/u;

/**
 * Owns the real agent-turn model-call lifecycle. Extensions run before the
 * durable invocation capture and around the provider stream, while the
 * cancellation deadline, thinking-loop guard, budget accounting, and Ledger
 * capture remain outside the replaceable portion of the call.
 */
export class ComposableAgentModelCallPipeline implements AgentTurnModelCallPipeline {
  private readonly extensions = new Map<string, StoredExtension>();
  private nextSequence = 1;
  private closed = false;

  createAgentTurnStream(input: AgentModelStreamLifecycleInput): StreamFn {
    const lifecycle = this.createInvocationLifecycle();
    return agentModelStreamLife({
      ...input,
      prepareCall: lifecycle.prepare,
      finalizeCall: lifecycle.finalize,
      invokeCall: lifecycle.invoke,
    });
  }

  createInvocationLifecycle(): AgentModelCallLifecycle {
    this.assertOpen();
    return {
      prepare: (call) => { this.assertOpen(); return this.prepare(call); },
      finalize: (call) => { this.assertOpen(); return this.finalize(call); },
      invoke: (call, next) => { this.assertOpen(); return this.invoke(call, next); },
    };
  }

  use(extension: AgentModelCallExtension, owner = "kernel"): () => void {
    this.assertOpen();
    if (!EXTENSION_ID.test(extension.id)) {
      throw new Error(`Model-call extension ID is invalid: ${extension.id}`);
    }
    if (!EXTENSION_ID.test(owner)) {
      throw new Error(`Model-call extension owner is invalid: ${owner}`);
    }
    const order = extension.order ?? 0;
    if (!Number.isSafeInteger(order) || order < -10_000 || order > 10_000) {
      throw new Error(`Model-call extension order is invalid: ${order}`);
    }
    if (
      extension.prepare &&
      order <= -400 &&
      EARLY_PREPARE_EXTENSION_ORDERS.get(`${owner}:${extension.id}`) !== order
    ) {
      throw new Error(
        "Early model-call order is reserved for the model harness and context pruner",
      );
    }
    if (
      extension.finalize &&
      order === 10_000 &&
      (owner !== "kernel.context" ||
        !FINAL_CONTEXT_EXTENSION_IDS.has(extension.id))
    ) {
      throw new Error(
        "Final model-call order is reserved for the context governor",
      );
    }
    if (!extension.prepare && !extension.finalize && !extension.around) {
      throw new Error(
        `Model-call extension has no lifecycle behavior: ${extension.id}`,
      );
    }
    const key = `${owner}:${extension.id}`;
    if (this.extensions.has(key)) {
      throw new Error(`Model-call extension is already registered: ${key}`);
    }
    this.extensions.set(key, {
      owner,
      sequence: this.nextSequence++,
      extension: { ...extension, order },
    });
    return () => {
      if (!this.closed) this.extensions.delete(key);
    };
  }

  inspect(): AgentModelCallExtensionInspection[] {
    return this.ordered().map(({ owner, extension }) => ({
      id: extension.id,
      owner,
      order: extension.order,
      prepare: Boolean(extension.prepare),
      finalize: Boolean(extension.finalize),
      around: Boolean(extension.around),
    }));
  }

  disposeOwner(owner: string): void {
    this.assertOpen();
    for (const [key, stored] of this.extensions) {
      if (stored.owner === owner) this.extensions.delete(key);
    }
  }

  shutdown(): void {
    if (this.closed) return;
    this.extensions.clear();
    this.closed = true;
  }

  private async prepare(
    original: AgentModelCallPreparation,
  ): Promise<PreparedAgentModelCall> {
    let prepared: PreparedAgentModelCall = {
      context: original.context,
      options: original.options,
    };
    const authority = snapshotAuthority(original);
    for (const { extension } of this.ordered()) {
      if (!extension.prepare) continue;
      const view = isolatedCallSurface(prepared);
      const model = copyData(original.model);
      const patch = await extension.prepare(Object.freeze({ ...original, model, context: view.context, options: view.options }));
      if (!isDeepStrictEqual(model, original.model))
        throw new Error(`Model-call extension cannot change the selected model: ${extension.id}`);
      view.assertToolsUnchanged(extension.id);
      assertOptionsAuthority(authority, view.options, extension.id);
      prepared = applySafePatch(authority, view, patch ?? {}, extension.id);
    }
    return prepared;
  }

  private invoke(
    call: AgentModelInvocation,
    provider: () => AssistantMessageEventStream,
  ): AssistantMessageEventStream {
    const extensions = this.ordered().filter(
      ({ extension }) => extension.around,
    );
    const dispatch = (index: number): AssistantMessageEventStream => {
      const stored = extensions[index];
      if (!stored?.extension.around) return provider();
      let advanced = false;
      const view = { ...call, model: copyData(call.model), context: copyData(call.context),
        options: copyData(call.options), compiledPrompt: copyData(call.compiledPrompt), envelope: copyData(call.envelope) };
      const captured = { model: copyData(view.model), context: copyData(view.context), options: copyData(view.options) };
      const stream = stored.extension.around(Object.freeze(view), () => {
        if (advanced) {
          throw new Error(
            `Model-call extension invoked next() more than once: ${stored.extension.id}`,
          );
        }
        if (!isDeepStrictEqual({ model: view.model, context: view.context, options: view.options }, captured))
          throw new Error(`Model-call extension cannot change the captured request: ${stored.extension.id}`);
        advanced = true;
        return dispatch(index + 1);
      });
      return assertModelStream(stream, stored.extension.id);
    };
    return dispatch(0);
  }

  private async finalize(
    original: AgentModelCallFinalization,
  ): Promise<PreparedAgentModelCall> {
    let finalized: PreparedAgentModelCall = {
      context: original.context,
      options: original.options,
    };
    const authority = snapshotAuthority(original);
    for (const { extension } of this.ordered()) {
      if (!extension.finalize) continue;
      const view = isolatedCallSurface(finalized);
      const model = copyData(original.model);
      const patch = await extension.finalize(Object.freeze({ ...original, model, context: view.context, options: view.options }));
      if (!isDeepStrictEqual(model, original.model))
        throw new Error(`Model-call extension cannot change the selected model: ${extension.id}`);
      view.assertToolsUnchanged(extension.id);
      if (!isDeepStrictEqual(view.options, finalized.options) || patch?.options) {
        throw new Error(
          `Final model-call extension cannot change compiled options: ${extension.id}`,
        );
      }
      const next = applySafePatch(authority, view, patch ?? {}, extension.id);
      assertStableTools(finalized.context, next.context, extension.id);
      finalized = next;
    }
    return finalized;
  }

  private ordered(): StoredExtension[] {
    return [...this.extensions.values()].sort(
      (left, right) =>
        left.extension.order - right.extension.order ||
        left.owner.localeCompare(right.owner) ||
        left.extension.id.localeCompare(right.extension.id) ||
        left.sequence - right.sequence,
    );
  }

  private assertOpen(): void {
    if (this.closed) throw new Error("Model-call pipeline is closed");
  }
}

const FINAL_CONTEXT_EXTENSION_IDS = new Set([
  "napier.context-projection-service",
  "napier.model-context-token-governor",
]);
const EARLY_PREPARE_EXTENSION_ORDERS = new Map([
  ["kernel.harness:napier.model-aware-harness", -500],
  ["kernel.context:napier.context-projection-service.prepare", -400],
  ["kernel.context:napier.tool-result-context-pruner", -400],
]);

export function createStandaloneAgentModelCallPipeline(): AgentTurnModelCallPipeline {
  return new ComposableAgentModelCallPipeline();
}

type CallAuthority = ReturnType<typeof snapshotAuthority>;

function snapshotAuthority(call: AgentModelCallPreparation) {
  return { tools: new Map((call.context.tools ?? []).map(tool => [tool, copyData(tool)])),
    signal: call.options.signal, maxTokens: call.options.maxTokens ?? call.model.maxTokens };
}

/** Tool views isolate shared host schemas while keeping returned subsets bound
 * to the same policy-resolved tool objects after validation. */
function isolatedCallSurface(current: PreparedAgentModelCall) {
  const context = copyData(current.context);
  const options = copyData(current.options);
  const originals = current.context.tools ?? [];
  const mapping = new Map((context.tools ?? []).map((tool, index) => [tool, originals[index]!]));
  const definitions = new Map((context.tools ?? []).map(tool => [tool, copyData(tool)]));
  return { context, options, mapping, assertToolsUnchanged(extensionId: string) {
    for (const [tool, definition] of definitions) if (!isDeepStrictEqual(tool, definition))
      throw new Error(`Model-call extension cannot change policy-resolved tool definitions: ${extensionId}`);
  } };
}

function applySafePatch(
  authority: CallAuthority,
  current: ReturnType<typeof isolatedCallSurface>,
  patch: AgentModelCallPatch,
  extensionId: string,
): PreparedAgentModelCall {
  if (!patch || typeof patch !== "object" || Array.isArray(patch))
    throw new Error(`Model-call extension returned an invalid patch: ${extensionId}`);
  const context = patch.context ?? current.context;
  const options = patch.options ? { ...current.options, ...patch.options } : current.options;
  if (!context || !Array.isArray(context.messages))
    throw new Error(`Model-call extension returned an invalid context: ${extensionId}`);
  const tools = context.tools?.map(tool => {
    const original = current.mapping.get(tool) ?? tool;
    const definition = authority.tools.get(original);
    if (!definition) throw new Error(`Model-call extension cannot add tools after policy resolution: ${extensionId}`);
    if (!isDeepStrictEqual(tool, definition))
      throw new Error(`Model-call extension cannot change policy-resolved tool definitions: ${extensionId}`);
    return original;
  });
  assertOptionsAuthority(authority, options, extensionId);
  return { context: { ...context, ...(tools ? { tools } : {}) }, options };
}

function assertOptionsAuthority(authority: CallAuthority, options: SimpleStreamOptions, extensionId: string): void {
  if (options.signal !== authority.signal)
    throw new Error(`Model-call extension cannot replace the Run cancellation signal: ${extensionId}`);
  if (options.maxTokens !== undefined && options.maxTokens > authority.maxTokens)
    throw new Error(`Model-call extension cannot increase the output-token ceiling: ${extensionId}`);
}

/** Signals, callbacks and provider objects retain identity; mutable plain data
 * in Context, tool schemas, headers and option bags is copied for each hook. */
function copyData<T>(value: T, seen = new Map<object, unknown>()): T {
  if (!value || typeof value !== "object") return value;
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return value;
  if (seen.has(value)) return seen.get(value) as T;
  const copy = (Array.isArray(value) ? [] : Object.create(Object.getPrototypeOf(value))) as Record<PropertyKey, unknown>;
  seen.set(value, copy);
  for (const key of Reflect.ownKeys(value)) {
    if (Array.isArray(value) && key === "length") continue;
    Object.defineProperty(copy, key, { value: copyData((value as Record<PropertyKey, unknown>)[key], seen),
      enumerable: Object.prototype.propertyIsEnumerable.call(value, key), writable: true, configurable: true });
  }
  return copy as T;
}

function assertStableTools(
  original: Context,
  candidate: Context,
  extensionId: string,
): void {
  const before = original.tools ?? [];
  const after = candidate.tools ?? [];
  if (
    before.length !== after.length ||
    before.some((tool, index) => tool !== after[index])
  ) {
    throw new Error(
      `Final model-call extension cannot change compiled tools: ${extensionId}`,
    );
  }
}

function assertModelStream(
  stream: AssistantMessageEventStream,
  extensionId: string,
): AssistantMessageEventStream {
  if (
    !stream ||
    typeof stream !== "object" ||
    typeof stream[Symbol.asyncIterator] !== "function" ||
    typeof stream.result !== "function"
  ) {
    throw new Error(
      `Model-call extension returned an invalid stream: ${extensionId}`,
    );
  }
  return stream;
}
