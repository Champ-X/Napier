export type LifecycleExtensionBoundary = "built_in_safety" | "external";

export interface LifecycleExtension<TContext extends object> {
  id: string;
  order?: number;
  prepare?(context: Readonly<TContext>): void | Promise<void>;
  around?<TResult>(
    context: Readonly<TContext>,
    next: () => Promise<TResult>,
  ): Promise<TResult>;
  finalize?(context: Readonly<TContext>): void | Promise<void>;
  dispose?(): void | Promise<void>;
}

export interface LifecycleExtensionInspection {
  id: string;
  owner: string;
  order: number;
  boundary: LifecycleExtensionBoundary;
  prepare: boolean;
  around: boolean;
  finalize: boolean;
}

export interface LifecycleExtensionEffect {
  dispose(): Promise<void>;
}

export interface AgentStepCapabilityView {
  candidateToolNames: readonly string[];
  definitionSha256(toolName: string): string;
  activeToolNames(): readonly string[];
  restrictTo(toolNames: readonly string[]): void;
  schemaVersion: string;
}

export interface AgentStepLifecycleContext {
  kind: "step";
  runId: string;
  threadId: string;
  stepIndex: number;
  model: Readonly<{ provider: string; id: string }>;
  capabilityView: Readonly<AgentStepCapabilityView>;
  signal?: AbortSignal;
}

export interface AgentToolLifecycleContext {
  kind: "tool";
  runId: string;
  threadId: string;
  stepIndex: number;
  toolCall: Readonly<{ id: string; name: string }>;
  protocol: Readonly<
    import("@napier/contracts/tool-protocol").ToolInvocationProtocolV2
  >;
  input: unknown;
  signal?: AbortSignal;
}

export interface AgentCompletionLifecycleContext {
  kind: "completion";
  runId: string;
  threadId: string;
  status: "completed" | "failed" | "cancelled" | "interrupted";
  reason?: string;
  signal?: AbortSignal;
}

interface StoredLifecycleExtension<TContext extends object> {
  owner: string;
  boundary: LifecycleExtensionBoundary;
  sequence: number;
  extension: Required<Pick<LifecycleExtension<TContext>, "id" | "order">> &
    Omit<LifecycleExtension<TContext>, "id" | "order">;
}

const EXTENSION_ID = /^[a-z][a-z0-9_.-]{2,79}$/u;
const MIN_EXTENSION_ORDER = -10_000;
const MAX_EXTENSION_ORDER = 10_000;

/**
 * Runs one lifecycle boundary from a stable extension snapshot. Built-in
 * safety extensions are always the outer layer: they prepare first, wrap all
 * external work, and finalize last. External extensions can therefore stop
 * or narrow an operation, but cannot order themselves outside safety.
 */
export class ComposableLifecycleExtensionPipeline<TContext extends object> {
  private readonly extensions = new Map<
    string,
    StoredLifecycleExtension<TContext>
  >();
  private nextSequence = 1;
  private closed = false;

  use(
    extension: LifecycleExtension<TContext>,
    owner = "kernel",
  ): LifecycleExtensionEffect {
    return this.register(extension, owner, "external");
  }

  installSafety(
    extension: LifecycleExtension<TContext>,
    owner = "kernel.safety",
  ): LifecycleExtensionEffect {
    return this.register(extension, owner, "built_in_safety");
  }

  inspect(): LifecycleExtensionInspection[] {
    return this.ordered().map(({ owner, boundary, extension }) => ({
      id: extension.id,
      owner,
      order: extension.order,
      boundary,
      prepare: Boolean(extension.prepare),
      around: Boolean(extension.around),
      finalize: Boolean(extension.finalize),
    }));
  }

  async execute<TResult>(
    context: TContext,
    operation: () => Promise<TResult>,
  ): Promise<TResult> {
    this.assertOpen();
    const stableContext = Object.freeze({ ...context }) as Readonly<TContext>;
    const entered: StoredLifecycleExtension<TContext>[] = [];
    let result: TResult | undefined;
    let operationError: unknown;

    try {
      for (const stored of this.ordered()) {
        await stored.extension.prepare?.(stableContext);
        entered.push(stored);
      }
      result = await this.invoke(entered, stableContext, operation);
    } catch (error) {
      operationError = error;
    }

    const finalizationErrors: unknown[] = [];
    for (const { extension } of [...entered].reverse()) {
      try {
        await extension.finalize?.(stableContext);
      } catch (error) {
        finalizationErrors.push(error);
      }
    }

    if (operationError !== undefined) {
      if (finalizationErrors.length > 0) {
        throw new AggregateError(
          [operationError, ...finalizationErrors],
          "Lifecycle operation and finalization failed",
          { cause: operationError },
        );
      }
      throw operationError;
    }
    if (finalizationErrors.length === 1) throw finalizationErrors[0];
    if (finalizationErrors.length > 1) {
      throw new AggregateError(
        finalizationErrors,
        "Lifecycle finalization failed",
      );
    }
    return result as TResult;
  }

  async disposeOwner(owner: string): Promise<void> {
    this.assertOpen();
    const owned = this.ordered().filter((stored) => stored.owner === owner);
    await this.disposeStored([...owned].reverse());
  }

  async shutdown(): Promise<void> {
    if (this.closed) return;
    const registered = [...this.ordered()].reverse();
    this.extensions.clear();
    this.closed = true;
    await disposeExtensions(registered);
  }

  private register(
    extension: LifecycleExtension<TContext>,
    owner: string,
    boundary: LifecycleExtensionBoundary,
  ): LifecycleExtensionEffect {
    this.assertOpen();
    assertIdentifier(extension.id, "extension ID");
    assertIdentifier(owner, "extension owner");
    const order = extension.order ?? 0;
    if (
      !Number.isSafeInteger(order) ||
      order < MIN_EXTENSION_ORDER ||
      order > MAX_EXTENSION_ORDER
    ) {
      throw new Error(`Lifecycle extension order is invalid: ${order}`);
    }
    if (!extension.prepare && !extension.around && !extension.finalize) {
      throw new Error(
        `Lifecycle extension has no lifecycle behavior: ${extension.id}`,
      );
    }
    const key = `${boundary}:${owner}:${extension.id}`;
    if (this.extensions.has(key)) {
      throw new Error(`Lifecycle extension is already registered: ${key}`);
    }
    const stored: StoredLifecycleExtension<TContext> = {
      owner,
      boundary,
      sequence: this.nextSequence++,
      extension: { ...extension, order },
    };
    this.extensions.set(key, stored);
    let disposed = false;
    return {
      dispose: async () => {
        if (disposed) return;
        disposed = true;
        if (!this.extensions.delete(key)) return;
        await stored.extension.dispose?.();
      },
    };
  }

  private async invoke<TResult>(
    extensions: readonly StoredLifecycleExtension<TContext>[],
    context: Readonly<TContext>,
    operation: () => Promise<TResult>,
  ): Promise<TResult> {
    const dispatch = async (index: number): Promise<TResult> => {
      const stored = extensions[index];
      if (!stored) return operation();
      if (!stored.extension.around) return dispatch(index + 1);
      let advanced = false;
      let downstreamResult: TResult | undefined;
      let downstreamError: unknown;
      const result = await stored.extension.around(context, async () => {
        if (advanced) {
          throw new Error(
            `Lifecycle extension invoked next() more than once: ${stored.extension.id}`,
          );
        }
        advanced = true;
        try {
          downstreamResult = await dispatch(index + 1);
          return downstreamResult;
        } catch (error) {
          downstreamError = error;
          throw error;
        }
      });
      if (stored.boundary === "external") {
        if (!advanced) {
          throw new Error(
            `External lifecycle extension must invoke next(): ${stored.extension.id}`,
          );
        }
        if (downstreamError !== undefined) {
          throw new AggregateError(
            [downstreamError],
            `External lifecycle extension cannot recover a downstream failure: ${stored.extension.id}`,
            { cause: downstreamError },
          );
        }
        if (!Object.is(result, downstreamResult)) {
          throw new Error(
            `External lifecycle extension cannot replace a downstream result: ${stored.extension.id}`,
          );
        }
      }
      return result;
    };
    return dispatch(0);
  }

  private async disposeStored(
    storedExtensions: readonly StoredLifecycleExtension<TContext>[],
  ): Promise<void> {
    for (const stored of storedExtensions) {
      const key = `${stored.boundary}:${stored.owner}:${stored.extension.id}`;
      this.extensions.delete(key);
    }
    await disposeExtensions(storedExtensions);
  }

  private ordered(): StoredLifecycleExtension<TContext>[] {
    return [...this.extensions.values()].sort(
      (left, right) =>
        boundaryOrder(left.boundary) - boundaryOrder(right.boundary) ||
        left.extension.order - right.extension.order ||
        left.owner.localeCompare(right.owner) ||
        left.extension.id.localeCompare(right.extension.id) ||
        left.sequence - right.sequence,
    );
  }

  private assertOpen(): void {
    if (this.closed) throw new Error("Lifecycle extension pipeline is closed");
  }
}

export interface AgentLifecyclePipelineInspection {
  step: LifecycleExtensionInspection[];
  tool: LifecycleExtensionInspection[];
  completion: LifecycleExtensionInspection[];
}

export class AgentLifecyclePipelineHost {
  readonly step =
    new ComposableLifecycleExtensionPipeline<AgentStepLifecycleContext>();
  readonly tool =
    new ComposableLifecycleExtensionPipeline<AgentToolLifecycleContext>();
  readonly completion =
    new ComposableLifecycleExtensionPipeline<AgentCompletionLifecycleContext>();

  inspect(): AgentLifecyclePipelineInspection {
    return {
      step: this.step.inspect(),
      tool: this.tool.inspect(),
      completion: this.completion.inspect(),
    };
  }

  async disposeOwner(owner: string): Promise<void> {
    await Promise.all([
      this.step.disposeOwner(owner),
      this.tool.disposeOwner(owner),
      this.completion.disposeOwner(owner),
    ]);
  }

  async shutdown(): Promise<void> {
    await Promise.all([
      this.step.shutdown(),
      this.tool.shutdown(),
      this.completion.shutdown(),
    ]);
  }
}

export function createAgentStepCapabilityView(input: {
  toolNames: readonly string[];
  schemaVersion: string;
  definitionSha256?: (toolName: string) => string;
}): AgentStepCapabilityView {
  const candidates = Object.freeze(uniqueStrings(input.toolNames));
  let active = candidates;
  return Object.freeze({
    candidateToolNames: candidates,
    schemaVersion: input.schemaVersion,
    definitionSha256: (toolName: string) => {
      if (!candidates.includes(toolName)) {
        throw new Error(`Lifecycle capability is unavailable: ${toolName}`);
      }
      return input.definitionSha256?.(toolName) ?? input.schemaVersion;
    },
    activeToolNames: () => active,
    restrictTo: (toolNames: readonly string[]) => {
      const requested = uniqueStrings(toolNames);
      const allowed = new Set(active);
      const expanded = requested.find((name) => !allowed.has(name));
      if (expanded) {
        throw new Error(
          `Lifecycle extension cannot activate an unavailable capability: ${expanded}`,
        );
      }
      active = Object.freeze(requested);
    },
  });
}

function assertIdentifier(value: string, label: string): void {
  if (!EXTENSION_ID.test(value)) {
    throw new Error(`Lifecycle ${label} is invalid: ${value}`);
  }
}

function boundaryOrder(boundary: LifecycleExtensionBoundary): number {
  return boundary === "built_in_safety" ? 0 : 1;
}

async function disposeExtensions<TContext extends object>(
  storedExtensions: readonly StoredLifecycleExtension<TContext>[],
): Promise<void> {
  const errors: unknown[] = [];
  for (const { extension } of storedExtensions) {
    try {
      await extension.dispose?.();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) {
    throw new AggregateError(errors, "Lifecycle extension disposal failed");
  }
}

function uniqueStrings(values: readonly string[]): string[] {
  const unique = [...new Set(values)];
  if (unique.some((value) => typeof value !== "string" || !value.trim())) {
    throw new Error("Lifecycle capability names must be non-empty strings");
  }
  return unique;
}
