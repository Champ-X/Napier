import type { RunEvent } from "@napier/contracts";

export interface KernelHookEventMap {
  "turn.start": { event: RunEvent; threadId: string; runId: string };
  "turn.end": { event: RunEvent; threadId: string; runId: string };
  "model.request": { event: RunEvent; threadId: string; runId: string };
  "tool.request": {
    event: RunEvent;
    threadId: string;
    runId: string;
    callId?: string;
    toolName?: string;
  };
  "tool.result": {
    event: RunEvent;
    threadId: string;
    runId: string;
    callId?: string;
    toolName?: string;
    status: "completed" | "failed" | "blocked";
  };
  "completion.control": {
    event: RunEvent;
    threadId: string;
    runId: string;
    control: string;
  };
}

export type KernelHookName = keyof KernelHookEventMap;
export type KernelHookHandler<Name extends KernelHookName> = (
  event: KernelHookEventMap[Name],
) => void | Promise<void>;

interface StoredHook {
  id: number;
  owner: string;
  handler: KernelHookHandler<KernelHookName>;
}

const COMPLETION_CONTROL_EVENTS = new Set([
  "run.completed",
  "run.failed",
  "run.cancelled",
  "run.budget.exhausted",
  "run.finalization.reserved",
  "run.no_progress",
  "run.settlement.recorded",
  "run.settlement.checkpoint",
  "model.stream.watchdog_triggered",
  "model.thinking_loop.finalized",
  "tool.deadline.exceeded",
]);

export class KernelHookRegistry {
  private readonly hooks = new Map<KernelHookName, StoredHook[]>();
  private nextId = 1;
  private closed = false;

  on<Name extends KernelHookName>(
    name: Name,
    handler: KernelHookHandler<Name>,
    owner = "kernel",
  ): () => void {
    this.assertOpen();
    const hook = {
      id: this.nextId++,
      owner,
      handler: handler as KernelHookHandler<KernelHookName>,
    };
    const hooks = this.hooks.get(name) ?? [];
    hooks.push(hook);
    this.hooks.set(name, hooks);
    return () => this.remove(name, hook.id);
  }

  scope(owner: string): KernelHookScope {
    this.assertOpen();
    return new KernelHookScope(this, owner);
  }

  async emit<Name extends KernelHookName>(
    name: Name,
    event: KernelHookEventMap[Name],
  ): Promise<void> {
    this.assertOpen();
    for (const hook of [...(this.hooks.get(name) ?? [])]) {
      await hook.handler(event);
    }
  }

  async observe(event: RunEvent): Promise<void> {
    const base = {
      event,
      threadId: event.threadId,
      runId: event.runId,
    };
    if (event.type === "turn.started") await this.emit("turn.start", base);
    if (event.type === "turn.completed") await this.emit("turn.end", base);
    if (event.type === "context.model_envelope") {
      await this.emit("model.request", base);
    }
    if (event.type === "tool.started") {
      await this.emit("tool.request", {
        ...base,
        ...toolIdentity(event),
      });
    }
    const status = toolResultStatus(event.type);
    if (status) {
      await this.emit("tool.result", {
        ...base,
        ...toolIdentity(event),
        status,
      });
    }
    if (COMPLETION_CONTROL_EVENTS.has(event.type)) {
      await this.emit("completion.control", {
        ...base,
        control: event.type,
      });
    }
  }

  inspect(): Array<{ name: KernelHookName; owners: string[]; count: number }> {
    return [...this.hooks.entries()]
      .filter(([, hooks]) => hooks.length > 0)
      .map(([name, hooks]) => ({
        name,
        owners: [...new Set(hooks.map((hook) => hook.owner))].sort(),
        count: hooks.length,
      }))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  disposeOwner(owner: string): void {
    this.assertOpen();
    for (const [name, hooks] of this.hooks) {
      const retained = hooks.filter((hook) => hook.owner !== owner);
      if (retained.length > 0) this.hooks.set(name, retained);
      else this.hooks.delete(name);
    }
  }

  shutdown(): void {
    if (this.closed) return;
    this.hooks.clear();
    this.closed = true;
  }

  private remove(name: KernelHookName, id: number): void {
    if (this.closed) return;
    const hooks = (this.hooks.get(name) ?? []).filter((hook) => hook.id !== id);
    if (hooks.length > 0) this.hooks.set(name, hooks);
    else this.hooks.delete(name);
  }

  private assertOpen(): void {
    if (this.closed) throw new Error("Kernel hook registry is closed");
  }
}

export class KernelHookScope {
  private disposed = false;

  constructor(
    private readonly registry: KernelHookRegistry,
    readonly owner: string,
  ) {}

  on<Name extends KernelHookName>(
    name: Name,
    handler: KernelHookHandler<Name>,
  ): () => void {
    if (this.disposed)
      throw new Error(`Kernel hook owner is disposed: ${this.owner}`);
    return this.registry.on(name, handler, this.owner);
  }

  dispose(): void {
    if (this.disposed) return;
    this.registry.disposeOwner(this.owner);
    this.disposed = true;
  }
}

function toolIdentity(event: RunEvent): { callId?: string; toolName?: string } {
  if (
    !event.payload ||
    typeof event.payload !== "object" ||
    Array.isArray(event.payload)
  ) {
    return {};
  }
  const callId = event.payload["callId"];
  const toolName = event.payload["toolName"];
  return {
    ...(typeof callId === "string" ? { callId } : {}),
    ...(typeof toolName === "string" ? { toolName } : {}),
  };
}

function toolResultStatus(
  type: string,
): "completed" | "failed" | "blocked" | undefined {
  if (type === "tool.completed") return "completed";
  if (type === "tool.failed") return "failed";
  return type === "tool.blocked" ? "blocked" : undefined;
}
