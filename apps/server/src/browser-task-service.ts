import { randomUUID } from "node:crypto";
import path from "node:path";

import {
  BrowserUseCloudBackend,
  BrowserUseLocalBackend,
  browserUseCloudRuntimeRoot,
  browserUseLocalRuntimeRoot,
  type BrowserUseLocalControlObservation,
  type BrowserUseCloudObservation,
  type BrowserUseCloudTaskRequest,
  type BrowserUseCloudTaskResult,
  type BrowserUseLocalObservation,
  type BrowserUseLocalTaskRequest,
  type BrowserUseLocalTaskResult,
} from "@napier/runtime/browser";

import {
  browserTaskEnvironment,
  browserTaskFailure,
  browserTaskRestartFailure,
  browserTaskShutdownFailure,
  boundedBrowserTaskEvents,
  createdBrowserTask,
  restoredBrowserTaskRecord,
  resolveBrowserTaskCredential,
  streamTaskEvents,
  wakeTaskListeners,
} from "./browser-task-service-support.js";
import { BrowserTaskJournal } from "./browser-task-journal.js";
import { BrowserTaskServiceError } from "./browser-task-error.js";
import { readBrowserTaskScreenshot } from "./browser-task-screenshot.js";
import type {
  BrowserTaskBackend,
  BrowserTaskControlResult,
  BrowserTaskCreateInput,
  BrowserTaskCreated,
  BrowserTaskEvent,
  BrowserTaskSnapshot,
  BrowserTaskStopResult,
} from "./browser-task-types.js";
export { BrowserTaskServiceError } from "./browser-task-error.js";
export type {
  BrowserTaskBackend,
  BrowserTaskControlResult,
  BrowserTaskCreateInput,
  BrowserTaskCreated,
  BrowserTaskErrorEvent,
  BrowserTaskEvent,
  BrowserTaskSnapshot,
  BrowserTaskStopResult,
} from "./browser-task-types.js";

const DEFAULT_TASK_TIMEOUT_MS = 5 * 60 * 1_000;
const MAX_RETAINED_TASKS = 20;

interface BrowserTaskRunner {
  run(
    onObservation: (
      observation: BrowserUseLocalObservation | BrowserUseCloudObservation,
    ) => void | Promise<void>,
    signal?: AbortSignal,
  ): Promise<BrowserUseLocalTaskResult | BrowserUseCloudTaskResult>;
  pause?(): BrowserUseLocalControlObservation;
  resume?(): BrowserUseLocalControlObservation;
  takeover?(): BrowserUseLocalControlObservation;
}

interface BrowserUseLocalRunner {
  run(
    request: BrowserUseLocalTaskRequest,
    onObservation: (
      observation: BrowserUseLocalObservation,
    ) => void | Promise<void>,
    signal?: AbortSignal,
  ): Promise<BrowserUseLocalTaskResult>;
  pause?(): BrowserUseLocalControlObservation;
  resume?(): BrowserUseLocalControlObservation;
  takeover?(): BrowserUseLocalControlObservation;
}

interface BrowserUseCloudRunner {
  run(
    request: BrowserUseCloudTaskRequest,
    onObservation: (
      observation: BrowserUseCloudObservation,
    ) => void | Promise<void>,
    signal?: AbortSignal,
  ): Promise<BrowserUseCloudTaskResult>;
}

interface BrowserTaskRecord {
  id: string;
  backend: BrowserTaskBackend;
  screenshotRoot: string;
  createdAt: number;
  status: "running" | "stopping" | "terminal";
  controller: AbortController;
  events: BrowserTaskEvent[];
  listeners: Set<() => void>;
  timedOut: boolean;
  runner: BrowserTaskRunner;
  input: BrowserTaskCreateInput;
  execution?: Promise<void>;
}

export class BrowserTaskService {
  readonly #tasks = new Map<string, BrowserTaskRecord>();
  readonly #dataRoot: string;
  readonly #env: Readonly<Record<string, string | undefined>>;
  readonly #resolveCredential:
    | ((providerId: string) => Promise<string | undefined>)
    | undefined;
  readonly #timeoutMs: number;
  readonly #journal: BrowserTaskJournal;
  readonly #createLocalBackend: (options: {
    dataRoot: string;
    env: Readonly<Record<string, string | undefined>>;
  }) => BrowserUseLocalRunner;
  readonly #createCloudBackend: (options: {
    dataRoot: string;
    apiKey: string;
  }) => BrowserUseCloudRunner;
  #starting: Promise<BrowserTaskCreated> | undefined;
  #shuttingDown = false;
  #historyError = false;
  #initialization: Promise<void> | undefined;

  constructor(options: {
    dataRoot: string;
    env: Readonly<Record<string, string | undefined>>;
    timeoutMs?: number;
    createBackend?: (options: {
      dataRoot: string;
      env: Readonly<Record<string, string | undefined>>;
    }) => BrowserUseLocalRunner;
    createCloudBackend?: (options: {
      dataRoot: string;
      apiKey: string;
    }) => BrowserUseCloudRunner;
    resolveCredential?: (providerId: string) => Promise<string | undefined>;
  }) {
    this.#dataRoot = options.dataRoot;
    this.#env = options.env;
    this.#journal = new BrowserTaskJournal(options.dataRoot);
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TASK_TIMEOUT_MS;
    this.#resolveCredential = options.resolveCredential;
    this.#createLocalBackend =
      options.createBackend ??
      ((backendOptions) => new BrowserUseLocalBackend(backendOptions));
    this.#createCloudBackend =
      options.createCloudBackend ??
      ((backendOptions) => new BrowserUseCloudBackend(backendOptions));
  }

  initialize(): Promise<void> {
    this.#initialization ??= this.#restoreLatest();
    return this.#initialization;
  }

  async create(input: BrowserTaskCreateInput): Promise<BrowserTaskCreated> {
    this.#assertOpen();
    if (this.hasPendingWork()) {
      throw new BrowserTaskServiceError(
        "A browser task is already active",
        "browser_task_busy",
        409,
        "Stop the active task before starting another browser task",
      );
    }
    const starting = this.#create(input);
    this.#starting = starting;
    try {
      return await starting;
    } finally {
      this.#starting = undefined;
    }
  }

  async #create(input: BrowserTaskCreateInput): Promise<BrowserTaskCreated> {
    await this.initialize();
    const credential = await resolveBrowserTaskCredential(
      input,
      this.#env,
      this.#resolveCredential,
    );
    this.#assertOpen();
    const runner = this.#runner(input, credential);
    const id = `browser_task_${randomUUID().replaceAll("-", "")}`;
    const record: BrowserTaskRecord = {
      id,
      backend: input.backend,
      screenshotRoot: path.join(
        input.backend === "browser_use_local"
          ? browserUseLocalRuntimeRoot(this.#dataRoot)
          : browserUseCloudRuntimeRoot(this.#dataRoot),
        "runs",
      ),
      createdAt: Date.now(),
      status: "running",
      controller: new AbortController(),
      events: [],
      listeners: new Set(),
      timedOut: false,
      runner,
      input: structuredClone(input),
    };
    this.#tasks.set(id, record);
    this.#prune();
    try {
      await this.#persist(record);
    } catch (error) {
      this.#tasks.delete(id);
      throw error;
    }
    if (this.#shuttingDown) {
      record.events.push(browserTaskShutdownFailure(record.backend));
      record.status = "terminal";
      await this.#persist(record).catch(() => undefined);
      wakeTaskListeners(record);
      this.#assertOpen();
    }
    record.execution = this.#execute(record, runner);
    return createdBrowserTask(record);
  }

  events(
    taskId: string,
    signal?: AbortSignal,
  ): AsyncGenerator<BrowserTaskEvent> {
    const record = this.#task(taskId);
    return streamTaskEvents(record, signal);
  }

  backend(taskId: string): BrowserTaskBackend {
    return this.#task(taskId).backend;
  }

  active(): BrowserTaskCreated | undefined {
    const active = [...this.#tasks.values()].find(
      (record) => record.status !== "terminal",
    );
    return active ? createdBrowserTask(active) : undefined;
  }

  /** Pending starts have no task ID yet, but still keep the workspace resident. */
  hasPendingWork(): boolean {
    return Boolean(this.#starting) || Boolean(this.active());
  }

  async latest(): Promise<BrowserTaskSnapshot | undefined> {
    await this.initialize();
    if (this.#historyError) {
      throw new BrowserTaskServiceError(
        "The latest browser task history is unreadable",
        "browser_task_history_unavailable",
        409,
        "Start a fresh browser task to replace the damaged local history",
      );
    }
    const record = [...this.#tasks.values()]
      .filter((candidate) => candidate.status === "terminal")
      .sort((left, right) => right.createdAt - left.createdAt)[0];
    return record
      ? {
          taskId: record.id,
          backend: record.backend,
          status: "terminal",
          input: structuredClone(record.input),
          events: structuredClone(record.events),
        }
      : undefined;
  }

  async stop(taskId: string): Promise<BrowserTaskStopResult> {
    const record = this.#task(taskId);
    if (record.status === "terminal") {
      throw new BrowserTaskServiceError(
        "Browser task is already complete",
        "browser_task_terminal",
        409,
      );
    }
    record.status = "stopping";
    await this.#persist(record).catch(() => undefined);
    record.controller.abort();
    return { taskId, status: "stopping" };
  }

  async control(
    taskId: string,
    action: "pause" | "resume" | "takeover",
  ): Promise<BrowserTaskControlResult> {
    const record = this.#task(taskId);
    if (record.status !== "running") {
      throw new BrowserTaskServiceError(
        "Browser task cannot be controlled in its current state",
        "browser_task_control_conflict",
        409,
        "Start a fresh local task, or wait for the active control to finish",
      );
    }
    const control = record.runner[action];
    if (!control) {
      throw new BrowserTaskServiceError(
        "This browser backend does not support the requested control",
        "browser_control_unavailable",
        409,
        "Use Stop, or select Browser Use local on macOS or Linux",
      );
    }
    try {
      const observation = control.call(record.runner);
      this.#emit(record, observation);
      await this.#persist(record).catch(() => undefined);
      return {
        taskId,
        state: observation.state,
        message: observation.message,
      };
    } catch (error) {
      if (error instanceof Error && "code" in error) {
        const local = error as Error & { code: string; recovery?: string };
        throw new BrowserTaskServiceError(
          local.message,
          local.code,
          409,
          local.recovery,
        );
      }
      throw error;
    }
  }

  async screenshot(taskId: string, step: number): Promise<Uint8Array> {
    return readBrowserTaskScreenshot(this.#task(taskId), step);
  }

  async shutdown(): Promise<void> {
    this.#shuttingDown = true;
    const initialization = this.#initialization;
    if (initialization) await initialization.catch(() => undefined);
    await this.#starting?.catch(() => undefined);
    const executions: Promise<void>[] = [];
    for (const record of this.#tasks.values()) {
      if (record.status !== "terminal") record.controller.abort();
      if (record.execution) executions.push(record.execution);
    }
    await Promise.allSettled(executions);
  }

  async #execute(
    record: BrowserTaskRecord,
    backend: BrowserTaskRunner,
  ): Promise<void> {
    const timeout = setTimeout(() => {
      record.timedOut = true;
      record.controller.abort();
    }, this.#timeoutMs);
    let terminal!: BrowserTaskEvent;
    try {
      terminal = await backend.run(async (observation) => {
        this.#emit(record, observation);
        await this.#persist(record).catch(() => undefined);
      }, record.controller.signal);
    } catch (error) {
      terminal = browserTaskFailure(error, record.timedOut, record.backend);
    } finally {
      clearTimeout(timeout);
      record.events.push(terminal);
      await this.#persist(record, "terminal").catch(() => undefined);
      record.status = "terminal";
      wakeTaskListeners(record);
    }
  }

  async #restoreLatest(): Promise<void> {
    try {
      const persisted = await this.#journal.load();
      if (!persisted) return;
      if (persisted.status !== "terminal") {
        persisted.status = "terminal";
        persisted.events = boundedBrowserTaskEvents([
          ...persisted.events,
          browserTaskRestartFailure(persisted.backend),
        ]);
        await this.#journal.save(persisted);
      }
      const record: BrowserTaskRecord = restoredBrowserTaskRecord(
        persisted,
        this.#dataRoot,
      );
      this.#tasks.set(record.id, record);
    } catch {
      this.#historyError = true;
    }
  }

  async #persist(
    record: BrowserTaskRecord,
    status = record.status,
  ): Promise<void> {
    await this.#journal.save({
      taskId: record.id,
      backend: record.backend,
      status,
      createdAt: record.createdAt,
      input: record.input,
      events: boundedBrowserTaskEvents(record.events),
    });
    this.#historyError = false;
  }

  #runner(
    input: BrowserTaskCreateInput,
    credential: string,
  ): BrowserTaskRunner {
    if (input.backend === "browser_use_cloud") {
      const backend = this.#createCloudBackend({
        dataRoot: this.#dataRoot,
        apiKey: credential,
      });
      const request: BrowserUseCloudTaskRequest = {
        task: input.task,
        startUrl: input.startUrl,
        model: input.model,
        allowedDomains: input.allowedDomains,
        maxSteps: input.maxSteps,
        maxCostUsd: input.maxCostUsd,
      };
      return {
        run: (observe, signal) => backend.run(request, observe, signal),
      };
    }
    const backend = this.#createLocalBackend({
      dataRoot: this.#dataRoot,
      env: browserTaskEnvironment(this.#env, credential),
    });
    const request: BrowserUseLocalTaskRequest = {
      task: input.task,
      startUrl: input.startUrl,
      model: input.model,
      allowedDomains: input.allowedDomains,
      maxSteps: input.maxSteps,
    };
    return {
      run: (observe, signal) => backend.run(request, observe, signal),
      ...(backend.pause ? { pause: () => backend.pause!() } : {}),
      ...(backend.resume ? { resume: () => backend.resume!() } : {}),
      ...(backend.takeover ? { takeover: () => backend.takeover!() } : {}),
    };
  }

  #emit(record: BrowserTaskRecord, event: BrowserTaskEvent): void {
    record.events.push(event);
    wakeTaskListeners(record);
  }

  #assertOpen(): void {
    if (this.#shuttingDown) {
      throw new BrowserTaskServiceError(
        "Browser task service is shutting down",
        "browser_task_shutting_down",
        409,
      );
    }
  }

  #task(taskId: string): BrowserTaskRecord {
    const record = this.#tasks.get(taskId);
    if (!record) {
      throw new BrowserTaskServiceError(
        "Browser task was not found",
        "browser_task_not_found",
        404,
      );
    }
    return record;
  }

  #prune(): void {
    const terminal = [...this.#tasks.values()]
      .filter((record) => record.status === "terminal")
      .sort((left, right) => left.createdAt - right.createdAt);
    while (this.#tasks.size > MAX_RETAINED_TASKS && terminal.length > 0) {
      const oldest = terminal.shift();
      if (oldest) this.#tasks.delete(oldest.id);
    }
  }
}
