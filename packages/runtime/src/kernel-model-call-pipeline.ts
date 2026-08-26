import type { StreamFn } from "@earendil-works/pi-agent-core";
import type {
  AssistantMessageEventStream,
  Context,
  SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import type { CompiledPromptArtifact } from "./prompt-compiler.js";

import {
  agentModelStreamLife,
  type AgentModelCallPreparation,
  type AgentModelInvocation,
  type AgentModelStreamLifecycleInput,
  type PreparedAgentModelCall,
} from "./agent-model-stream-lifecycle.js";

export interface AgentTurnModelCallPipeline {
  createAgentTurnStream(input: AgentModelStreamLifecycleInput): StreamFn;
}

export interface AgentModelCallPatch {
  context?: Context;
  options?: SimpleStreamOptions;
}

export interface AgentModelCallFinalization extends AgentModelCallPreparation {
  compiledPrompt: CompiledPromptArtifact;
  recoveryAttempt: 0 | 1;
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
    this.assertOpen();
    return agentModelStreamLife({
      ...input,
      prepareCall: (call) => this.prepare(call),
      finalizeCall: (call) => this.finalize(call),
      invokeCall: (call, next) => this.invoke(call, next),
    });
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
    for (const { extension } of this.ordered()) {
      if (!extension.prepare) continue;
      const patch = await extension.prepare(
        Object.freeze({
          ...original,
          context: prepared.context,
          options: prepared.options,
        }),
      );
      if (!patch) continue;
      prepared = applySafePatch(original, prepared, patch, extension.id);
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
      const stream = stored.extension.around(Object.freeze(call), () => {
        if (advanced) {
          throw new Error(
            `Model-call extension invoked next() more than once: ${stored.extension.id}`,
          );
        }
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
    for (const { extension } of this.ordered()) {
      if (!extension.finalize) continue;
      const patch = await extension.finalize(
        Object.freeze({ ...original, context: finalized.context }),
      );
      if (!patch) continue;
      if (patch.options) {
        throw new Error(
          `Final model-call extension cannot change compiled options: ${extension.id}`,
        );
      }
      const next = applySafePatch(original, finalized, patch, extension.id);
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

function applySafePatch(
  original: AgentModelCallPreparation,
  current: PreparedAgentModelCall,
  patch: AgentModelCallPatch,
  extensionId: string,
): PreparedAgentModelCall {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    throw new Error(
      `Model-call extension returned an invalid patch: ${extensionId}`,
    );
  }
  const context = patch.context ?? current.context;
  const options = patch.options
    ? { ...current.options, ...patch.options }
    : current.options;
  if (!context || !Array.isArray(context.messages)) {
    throw new Error(
      `Model-call extension returned an invalid context: ${extensionId}`,
    );
  }
  assertToolSubset(original.context, context, extensionId);
  if (options.signal !== original.options.signal) {
    throw new Error(
      `Model-call extension cannot replace the Run cancellation signal: ${extensionId}`,
    );
  }
  const originalMaxTokens =
    original.options.maxTokens ?? original.model.maxTokens;
  if (
    options.maxTokens !== undefined &&
    options.maxTokens > originalMaxTokens
  ) {
    throw new Error(
      `Model-call extension cannot increase the output-token ceiling: ${extensionId}`,
    );
  }
  return { context, options };
}

function assertToolSubset(
  original: Context,
  candidate: Context,
  extensionId: string,
): void {
  const allowed = new Set(original.tools ?? []);
  if ((candidate.tools ?? []).some((tool) => !allowed.has(tool))) {
    throw new Error(
      `Model-call extension cannot add tools after policy resolution: ${extensionId}`,
    );
  }
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
