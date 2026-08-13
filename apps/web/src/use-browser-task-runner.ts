import { useEffect, useReducer, useRef } from "react";

import {
  controlBrowserTask,
  createBrowserTask,
  recoverActiveBrowserTask,
  recoverLatestBrowserTask,
  stopBrowserTask,
  streamBrowserTask,
  type BrowserTaskApiEvent,
  type BrowserTaskBackend,
  type BrowserTaskCreated,
  type BrowserTaskModelProvider,
  type BrowserTaskSnapshot,
} from "./browser-task-api";
import { NapierApiError } from "./api-error";

export type BrowserTaskRunnerStatus =
  | "idle"
  | "restoring"
  | "starting"
  | "running"
  | "paused"
  | "takeover"
  | "stopping"
  | "terminal";

export interface BrowserTaskFormValue {
  backend: BrowserTaskBackend;
  task: string;
  startUrl: string;
  allowedDomains: string;
  provider: BrowserTaskModelProvider;
  modelId: string;
  credentialEnv: string;
  maxSteps: number;
  maxCostUsd: number;
}

export interface BrowserTaskRunnerView {
  created?: BrowserTaskCreated;
  snapshot?: BrowserTaskSnapshot;
  events: BrowserTaskApiEvent[];
  status: BrowserTaskRunnerStatus;
  recovered?: boolean;
  error?: string;
}

export interface BrowserTaskRunner extends BrowserTaskRunnerView {
  busy: boolean;
  canRetry: boolean;
  start(value: BrowserTaskFormValue): Promise<void>;
  retry(): Promise<void>;
  stop(): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  takeover(): Promise<void>;
}

type RunnerAction =
  | { type: "restoring" }
  | { type: "restore_empty" }
  | { type: "restore_terminal"; snapshot: BrowserTaskSnapshot }
  | { type: "restore_failed"; message: string }
  | { type: "starting" }
  | { type: "created"; created: BrowserTaskCreated; recovered: boolean }
  | { type: "event"; event: BrowserTaskApiEvent }
  | { type: "stopping" }
  | { type: "controlled"; state: "running" | "paused" | "takeover" }
  | { type: "stop_failed"; message: string }
  | { type: "failed"; message: string };

const INITIAL_VIEW: BrowserTaskRunnerView = {
  events: [],
  status: "idle",
};

export function useBrowserTaskRunner(): BrowserTaskRunner {
  const [view, dispatch] = useReducer(reduceRunner, INITIAL_VIEW);
  const controller = useRef<AbortController | undefined>(undefined);
  const activeTask = useRef<BrowserTaskCreated | undefined>(undefined);
  const retryInput = useRef<BrowserTaskFormValue | undefined>(undefined);

  useEffect(() => {
    const restoreController = new AbortController();
    controller.current = restoreController;
    dispatch({ type: "restoring" });
    void (async () => {
      try {
        const created = await recoverActiveBrowserTask();
        if (restoreController.signal.aborted) return;
        if (!created) {
          const snapshot = await recoverLatestBrowserTask();
          if (restoreController.signal.aborted) return;
          if (!snapshot) {
            dispatch({ type: "restore_empty" });
            return;
          }
          retryInput.current = formValueFromSnapshot(snapshot);
          dispatch({ type: "restore_terminal", snapshot });
          return;
        }
        activeTask.current = created;
        dispatch({ type: "created", created, recovered: true });
        await streamBrowserTask(
          created,
          (event) => dispatch({ type: "event", event }),
          restoreController.signal,
        );
      } catch (error) {
        if (!restoreController.signal.aborted) {
          dispatch({ type: "restore_failed", message: errorMessage(error) });
        }
      } finally {
        if (controller.current === restoreController) {
          activeTask.current = undefined;
          controller.current = undefined;
        }
      }
    })();
    return () => restoreController.abort();
  }, []);

  async function start(value: BrowserTaskFormValue): Promise<void> {
    controller.current?.abort();
    dispatch({ type: "starting" });
    const nextController = new AbortController();
    controller.current = nextController;
    activeTask.current = undefined;
    retryInput.current = undefined;
    try {
      const input = browserTaskInput(value);
      retryInput.current = { ...value };
      const created = await createBrowserTask(input);
      activeTask.current = created;
      dispatch({ type: "created", created, recovered: false });
      await streamBrowserTask(
        created,
        (event) => dispatch({ type: "event", event }),
        nextController.signal,
      );
    } catch (error) {
      if (!nextController.signal.aborted) {
        dispatch({ type: "failed", message: errorMessage(error) });
      }
    } finally {
      if (controller.current === nextController) {
        activeTask.current = undefined;
        controller.current = undefined;
      }
    }
  }

  async function retry(): Promise<void> {
    const input = retryInput.current;
    if (!input || activeTask.current) return;
    await start(input);
  }

  async function stop(): Promise<void> {
    const active = activeTask.current;
    if (!active) return;
    dispatch({ type: "stopping" });
    try {
      await stopBrowserTask(active);
    } catch (error) {
      dispatch({ type: "stop_failed", message: errorMessage(error) });
    }
  }

  async function control(
    action: "pause" | "resume" | "takeover",
  ): Promise<void> {
    const active = activeTask.current;
    if (!active) return;
    try {
      const result = await controlBrowserTask(active, action);
      dispatch({ type: "controlled", state: result.state });
    } catch (error) {
      dispatch({ type: "stop_failed", message: errorMessage(error) });
    }
  }

  return {
    ...view,
    busy: [
      "restoring",
      "starting",
      "running",
      "paused",
      "takeover",
      "stopping",
    ].includes(view.status),
    canRetry: view.status === "terminal" && Boolean(retryInput.current),
    start,
    retry,
    stop,
    pause: () => control("pause"),
    resume: () => control("resume"),
    takeover: () => control("takeover"),
  };
}

function reduceRunner(
  state: BrowserTaskRunnerView,
  action: RunnerAction,
): BrowserTaskRunnerView {
  if (action.type === "restoring") {
    return { events: [], status: "restoring" };
  }
  if (action.type === "restore_empty") return INITIAL_VIEW;
  if (action.type === "restore_terminal") {
    return {
      snapshot: action.snapshot,
      events: action.snapshot.events,
      status: "terminal",
      recovered: true,
    };
  }
  if (action.type === "restore_failed") {
    return { events: [], status: "idle", error: action.message };
  }
  if (action.type === "starting") {
    return { events: [], status: "starting", recovered: false };
  }
  if (action.type === "created") {
    return {
      ...state,
      created: action.created,
      status: "running",
      recovered: action.recovered,
    };
  }
  if (action.type === "event") {
    const terminal = ["completed", "error"].includes(action.event.type);
    const controlled =
      action.event.type === "control" ? action.event.state : undefined;
    return {
      ...state,
      events: [...state.events.slice(-39), action.event],
      status: terminal ? "terminal" : (controlled ?? state.status),
    };
  }
  if (action.type === "stopping") {
    const { error: _error, ...next } = state;
    return { ...next, status: "stopping" };
  }
  if (action.type === "controlled") {
    const { error: _error, ...next } = state;
    return { ...next, status: action.state };
  }
  if (action.type === "stop_failed") {
    return { ...state, error: action.message, status: "running" };
  }
  return { ...state, error: action.message, status: "terminal" };
}

function formValueFromSnapshot(
  snapshot: BrowserTaskSnapshot,
): BrowserTaskFormValue {
  return {
    backend: snapshot.input.backend,
    task: snapshot.input.task,
    startUrl: snapshot.input.startUrl,
    allowedDomains: snapshot.input.allowedDomains.join(","),
    provider: snapshot.input.model.provider,
    modelId: snapshot.input.model.id,
    credentialEnv: snapshot.input.credentialEnv,
    maxSteps: snapshot.input.maxSteps,
    maxCostUsd: snapshot.input.maxCostUsd,
  };
}

function browserTaskInput(value: BrowserTaskFormValue) {
  const url = new URL(value.startUrl.trim());
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  ) {
    throw new Error(
      "Start URL must be a public HTTP(S) URL without credentials",
    );
  }
  const configuredDomains = value.allowedDomains
    .split(",")
    .map((domain) => domain.trim().toLowerCase())
    .filter(Boolean);
  if (
    value.backend === "browser_use_cloud" &&
    value.provider !== "browser-use"
  ) {
    throw new Error("Browser Use Cloud requires a Browser Use model");
  }
  return {
    backend: value.backend,
    task: value.task.trim(),
    startUrl: url.href,
    model: { provider: value.provider, id: value.modelId.trim() },
    credentialEnv: value.credentialEnv.trim(),
    allowedDomains:
      configuredDomains.length > 0
        ? [...new Set(configuredDomains)]
        : [url.hostname.toLowerCase()],
    maxSteps: value.maxSteps,
    maxCostUsd: value.maxCostUsd,
  };
}

function errorMessage(error: unknown): string {
  if (
    error instanceof NapierApiError &&
    error.payload &&
    typeof error.payload === "object" &&
    !Array.isArray(error.payload) &&
    typeof (error.payload as Record<string, unknown>)["recovery"] === "string"
  ) {
    return `${error.serverMessage}. ${(error.payload as Record<string, unknown>)["recovery"]}`;
  }
  return error instanceof Error ? error.message : String(error);
}
