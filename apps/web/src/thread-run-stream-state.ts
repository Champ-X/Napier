import type { RunEvent, StreamFrame } from "@napier/contracts";
import type { LiveReadyBootstrapResponse } from "@napier/contracts/default-run-model";

import type { WebThreadDetail } from "./api";
import { activeRunViewState } from "./active-run-view-state";
import {
  preserveThreadDetailImportReceipt,
  upsertThread,
} from "./thread-detail-view-state";

export interface ThreadRunSession {
  runId?: string;
  streamingText: string;
}

export type ThreadRunSessions = Readonly<
  Record<string, ThreadRunSession | undefined>
>;

export function resolveCachedThreadDetail(
  cache: Map<string, WebThreadDetail>,
  candidate: WebThreadDetail | undefined,
): WebThreadDetail | undefined {
  if (!candidate) return candidate;
  const cached = cache.get(candidate.thread.id);
  if (
    !cached ||
    cached.thread.eventCount < candidate.thread.eventCount ||
    cached.thread.updatedAt < candidate.thread.updatedAt
  ) {
    cache.set(candidate.thread.id, candidate);
    return candidate;
  }
  return preserveThreadDetailImportReceipt(cached, candidate);
}

export function threadRunViewState(
  detail: WebThreadDetail | undefined,
  sessions: ThreadRunSessions,
): {
  activeRunId: string | undefined;
  isRunning: boolean;
  streamingText: string;
} {
  const authoritative = activeRunViewState(detail);
  const attached = detail ? sessions[detail.thread.id] : undefined;
  const activeRunId = attached?.runId ?? authoritative.activeRunId;
  return {
    activeRunId,
    isRunning: attached !== undefined || authoritative.isRunning,
    streamingText:
      attached?.streamingText ??
      activeRunStreamingText(detail?.events ?? [], activeRunId),
  };
}

export function attachThreadRun(
  sessions: ThreadRunSessions,
  threadId: string,
): ThreadRunSessions {
  return { ...sessions, [threadId]: { streamingText: "" } };
}

export function applyThreadRunEvent(
  sessions: ThreadRunSessions,
  threadId: string,
  event: RunEvent,
): ThreadRunSessions {
  const current = sessions[threadId];
  let streamingText =
    current?.runId === undefined || current.runId === event.runId
      ? (current?.streamingText ?? "")
      : "";
  if (event.type === "model.text.delta") {
    const accumulated = payloadString(event.payload, "text");
    const delta = payloadString(event.payload, "delta");
    if (accumulated !== undefined) streamingText = accumulated;
    else if (delta) streamingText += delta;
  } else if (
    event.type === "message.assistant" ||
    event.type === "model.advisor.blocked" ||
    event.type === "model.advisor.correction.requested"
  ) {
    streamingText = "";
  }
  return {
    ...sessions,
    [threadId]: { runId: event.runId, streamingText },
  };
}

export function detachThreadRun(
  sessions: ThreadRunSessions,
  threadId: string,
): ThreadRunSessions {
  if (!sessions[threadId]) return sessions;
  const next = { ...sessions };
  delete next[threadId];
  return next;
}

export function activeRunStreamingText(
  events: RunEvent[],
  runId: string | undefined,
): string {
  if (!runId) return "";
  let text = "";
  for (const event of events) {
    if (event.runId !== runId) continue;
    if (event.type === "model.text.delta") {
      const accumulated = payloadString(event.payload, "text");
      const delta = payloadString(event.payload, "delta");
      if (accumulated !== undefined) text = accumulated;
      else if (delta) text += delta;
      continue;
    }
    if (
      event.type === "message.assistant" ||
      event.type === "model.advisor.blocked" ||
      event.type === "model.advisor.correction.requested"
    ) {
      text = "";
    }
  }
  return text;
}

export function applyThreadStreamFrameToDetail(
  current: WebThreadDetail | undefined,
  sourceThreadId: string,
  frame: StreamFrame,
): WebThreadDetail | undefined {
  if (!current || current.thread.id !== sourceThreadId) return current;
  if (frame.type === "snapshot") {
    if (frame.detail.thread.id !== sourceThreadId) return current;
    return preserveThreadDetailImportReceipt(frame.detail, current);
  }
  if (
    frame.type !== "event" ||
    frame.event.threadId !== sourceThreadId ||
    current.events.some((event) => event.id === frame.event.id)
  ) {
    return current;
  }
  return appendEvent(current, frame.event);
}

export function applyThreadStreamFrameToBootstrap(
  current: LiveReadyBootstrapResponse | undefined,
  sourceThreadId: string,
  frame: StreamFrame,
): LiveReadyBootstrapResponse | undefined {
  if (!current) return current;
  if (frame.type === "snapshot") {
    if (frame.detail.thread.id !== sourceThreadId) return current;
    const activeThread =
      current.activeThread?.thread.id === sourceThreadId
        ? preserveThreadDetailImportReceipt(frame.detail, current.activeThread)
        : undefined;
    return {
      ...current,
      threads: upsertThread(current.threads, frame.detail.thread),
      ...(activeThread ? { activeThread } : {}),
    };
  }
  if (frame.type !== "event" || frame.event.threadId !== sourceThreadId) {
    return current;
  }
  const summary = current.threads.find(
    (thread) => thread.id === sourceThreadId,
  );
  return {
    ...current,
    ...(summary
      ? {
          threads: upsertThread(current.threads, {
            ...summary,
            status: "running",
            eventCount: Math.max(summary.eventCount, frame.event.seq),
            updatedAt: frame.event.createdAt,
          }),
        }
      : {}),
    ...(current.activeThread?.thread.id === sourceThreadId
      ? { activeThread: appendEvent(current.activeThread, frame.event) }
      : {}),
  };
}

export function mergeRefreshedThreadBootstrap(
  current: LiveReadyBootstrapResponse | undefined,
  refreshed: LiveReadyBootstrapResponse,
  sourceThreadId: string,
): LiveReadyBootstrapResponse {
  if (!current) return refreshed;
  const sourceSummary = refreshed.threads.find(
    (thread) => thread.id === sourceThreadId,
  );
  const sourceDetail =
    refreshed.activeThread?.thread.id === sourceThreadId
      ? refreshed.activeThread
      : undefined;
  const activeThread =
    current.activeThread?.thread.id === sourceThreadId && sourceDetail
      ? preserveThreadDetailImportReceipt(sourceDetail, current.activeThread)
      : undefined;
  return {
    ...current,
    ...(sourceSummary
      ? { threads: upsertThread(current.threads, sourceSummary) }
      : {}),
    ...(activeThread ? { activeThread } : {}),
  };
}

export function mergeNavigationBootstrap(
  current: LiveReadyBootstrapResponse | undefined,
  incoming: LiveReadyBootstrapResponse,
): LiveReadyBootstrapResponse {
  if (!current) return incoming;
  const currentById = new Map(
    current.threads.map((thread) => [thread.id, thread]),
  );
  return {
    ...incoming,
    threads: incoming.threads
      .map((thread) => {
        const existing = currentById.get(thread.id);
        if (!existing) return thread;
        if (existing.eventCount !== thread.eventCount) {
          return existing.eventCount > thread.eventCount ? existing : thread;
        }
        return existing.updatedAt > thread.updatedAt ? existing : thread;
      })
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
  };
}

function appendEvent(
  detail: WebThreadDetail,
  event: RunEvent,
): WebThreadDetail {
  return {
    ...detail,
    thread: {
      ...detail.thread,
      status: "running",
      currentRunId: event.runId,
      eventCount: Math.max(detail.thread.eventCount, event.seq),
      updatedAt: event.createdAt,
    },
    events: [...detail.events, event],
  };
}

function payloadString(value: unknown, key: string): string | undefined {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    return undefined;
  }
  const entry = (value as Record<string, unknown>)[key];
  return typeof entry === "string" ? entry : undefined;
}
