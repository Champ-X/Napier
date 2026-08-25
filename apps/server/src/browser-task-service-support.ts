import {
  BrowserUseCloudError,
  BrowserUseLocalError,
  browserUseCloudRuntimeRoot,
  browserUseLocalRuntimeRoot,
} from "@napier/runtime/browser";
import {
  sha256,
} from "@napier/runtime/core";
import path from "node:path";

import type { BrowserTaskJournalRecord } from "./browser-task-journal.js";
import type {
  BrowserTaskBackend,
  BrowserTaskCreated,
  BrowserTaskErrorEvent,
  BrowserTaskEvent,
} from "./browser-task-types.js";

const FORWARDED_ENVIRONMENT =
  "ALL_PROXY,APPDATA,HOME,HTTPS_PROXY,HTTP_PROXY,LANG,LC_ALL,LOCALAPPDATA,LOGNAME,NO_PROXY,PATH,SSL_CERT_DIR,SSL_CERT_FILE,SYSTEMROOT,USER,USERPROFILE".split(
    ",",
  );

export interface StreamableBrowserTaskRecord {
  status: "running" | "stopping" | "terminal";
  events: BrowserTaskEvent[];
  listeners: Set<() => void>;
}

export async function* streamTaskEvents(
  record: StreamableBrowserTaskRecord,
  signal?: AbortSignal,
): AsyncGenerator<BrowserTaskEvent> {
  let cursor = 0;
  for (;;) {
    while (cursor < record.events.length) {
      yield record.events[cursor++]!;
    }
    if (record.status === "terminal") return;
    await waitForTaskEvent(record, signal);
  }
}

export function browserTaskFailure(
  error: unknown,
  timedOut: boolean,
  backend: BrowserTaskBackend,
): BrowserTaskErrorEvent {
  if (timedOut) {
    return {
      type: "error",
      backend,
      code: "timeout",
      message: "Browser task exceeded its wall-time limit",
      diagnosticSha256: sha256(`${backend}_timeout`),
      recovery: "Reduce the maximum steps, then start a fresh browser task",
    };
  }
  if (
    error instanceof BrowserUseLocalError ||
    error instanceof BrowserUseCloudError
  ) {
    return {
      type: "error",
      backend,
      code: error.code,
      message: error.message,
      diagnosticSha256: error.diagnosticSha256,
      recovery: error.recovery,
    };
  }
  return {
    type: "error",
    backend,
    code: "backend_failed",
    message: "Browser task could not run",
    diagnosticSha256: sha256(`${backend}_server_failed`),
    recovery: `Run napier doctor with --browser-backend ${backend}, then retry`,
  };
}

export function browserTaskRestartFailure(
  backend: BrowserTaskBackend,
): BrowserTaskErrorEvent {
  return {
    type: "error",
    backend,
    code: "server_restarted",
    message: "Browser task stopped when the Napier server restarted",
    diagnosticSha256: sha256(`${backend}_server_restarted`),
    recovery: "Retry the same task to start a fresh browser session",
  };
}

export function wakeTaskListeners(record: StreamableBrowserTaskRecord): void {
  for (const listener of [...record.listeners]) listener();
}

export function browserTaskEnvironment(
  input: Readonly<Record<string, string | undefined>>,
  credential: string,
): Readonly<Record<string, string | undefined>> {
  const env: Record<string, string | undefined> = {
    NAPIER_BROWSER_USE_CREDENTIAL: credential,
  };
  for (const name of FORWARDED_ENVIRONMENT) {
    if (input[name]) env[name] = input[name];
  }
  return env;
}

export function createdBrowserTask(record: {
  id: string;
  backend: BrowserTaskBackend;
}): BrowserTaskCreated {
  const taskId = encodeURIComponent(record.id);
  const controls =
    record.backend === "browser_use_local"
      ? {
          pauseUrl: `/api/browser-tasks/${taskId}/pause`,
          resumeUrl: `/api/browser-tasks/${taskId}/resume`,
          takeoverUrl: `/api/browser-tasks/${taskId}/takeover`,
        }
      : {};
  return {
    taskId: record.id,
    backend: record.backend,
    status: "running",
    streamUrl: `/api/browser-tasks/${taskId}/stream`,
    stopUrl: `/api/browser-tasks/${taskId}/stop`,
    ...controls,
  };
}

export function boundedBrowserTaskEvents(
  events: BrowserTaskEvent[],
): BrowserTaskEvent[] {
  if (events.length <= 128) return structuredClone(events);
  const started = events.find((event) => event.type === "started");
  return structuredClone([
    ...(started ? [started] : []),
    ...events.slice(started ? -127 : -128),
  ]);
}

export function restoredBrowserTaskRecord(
  persisted: BrowserTaskJournalRecord,
  dataRoot: string,
) {
  return {
    id: persisted.taskId,
    backend: persisted.backend,
    screenshotRoot: path.join(
      persisted.backend === "browser_use_local"
        ? browserUseLocalRuntimeRoot(dataRoot)
        : browserUseCloudRuntimeRoot(dataRoot),
      "runs",
    ),
    createdAt: persisted.createdAt,
    status: "terminal" as const,
    controller: new AbortController(),
    events: structuredClone(persisted.events),
    listeners: new Set<() => void>(),
    timedOut: false,
    input: structuredClone(persisted.input),
    runner: {
      run: async () => {
        throw new Error("Restored Browser tasks cannot execute");
      },
    },
  };
}

function waitForTaskEvent(
  record: StreamableBrowserTaskRecord,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const ready = (): void => {
      cleanup();
      resolve();
    };
    const aborted = (): void => {
      cleanup();
      reject(signal?.reason ?? new Error("Browser task stream was stopped"));
    };
    const cleanup = (): void => {
      record.listeners.delete(ready);
      signal?.removeEventListener("abort", aborted);
    };
    record.listeners.add(ready);
    signal?.addEventListener("abort", aborted, { once: true });
  });
}
