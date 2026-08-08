import type { RunEvent } from "@napier/contracts";

import {
  browserEventEvidence,
  type BrowserToolEventTraceView,
} from "./browser-event-view";

export interface ConversationBrowserActivity {
  id: string;
  callId: string;
  seq: number;
  createdAt: string;
  status: "working" | "completed" | "failed";
  action?: string;
  operation?: number;
  sessionReused?: boolean;
  activeTabId?: string;
  tabCount?: number;
  pageDiagnosis?: "none" | "login_required" | "challenge_detected";
  takeoverRecommended?: boolean;
  blockedRequestCount?: number;
  networkRequestCount?: number;
  networkRejectedCount?: number;
  networkTransferredBytes?: number;
  destinationCount?: number;
  snapshotChars?: number;
  screenshotBytes?: number;
  fileBytes?: number;
  findMatchCount?: number;
  scrollPositionY?: number;
}

const EVENT = /^tool\.(started|completed|failed)$/u;
const CALL_ID = /^[A-Za-z0-9_.:-]{1,160}$/u;
const ACTIONS = new Set([
  "start",
  "navigate",
  "back",
  "forward",
  "tab_new",
  "tab_list",
  "tab_switch",
  "tab_close",
  "wait",
  "find",
  "scroll",
  "snapshot",
  "click",
  "type",
  "select",
  "upload",
  "download",
  "screenshot",
  "close",
]);

export function conversationBrowserActivities(
  events: RunEvent[],
  limit = 8,
): ConversationBrowserActivity[] {
  const latest = new Map<string, ConversationBrowserActivity>();
  for (const event of events) {
    const activity = conversationBrowserActivity(event);
    if (activity) latest.set(activity.callId, activity);
  }
  return [...latest.values()]
    .sort((left, right) => left.seq - right.seq)
    .slice(-limit);
}

export function conversationBrowserActivity(
  event: RunEvent,
): ConversationBrowserActivity | undefined {
  if (event.visibility !== "user" || !EVENT.test(event.type)) return undefined;
  const payload = record(event.payload);
  const callId = safeString(payload?.["callId"], CALL_ID);
  if (!payload || !callId || payload["toolName"] !== "browser") {
    return undefined;
  }
  const status =
    event.type === "tool.started"
      ? "working"
      : event.type === "tool.completed"
        ? "completed"
        : "failed";
  const action = browserAction(payload["action"]);
  const base = {
    id: event.id,
    callId,
    seq: event.seq,
    createdAt: event.createdAt,
    status,
    ...(action ? { action } : {}),
  } as const;
  if (status !== "completed") return base;
  const view = browserEventEvidence(payload["details"]);
  if (!view) return base;
  return {
    ...base,
    ...browserSessionProjection(view),
    ...browserPageProjection(view),
    ...browserNetworkProjection(view),
    ...browserOutputProjection(view),
  };
}

function browserSessionProjection(view: BrowserToolEventTraceView) {
  return {
    ...(view.browserAction ? { action: view.browserAction } : {}),
    ...(view.browserSessionOperation !== undefined
      ? { operation: view.browserSessionOperation }
      : {}),
    ...(view.browserSessionReused !== undefined
      ? { sessionReused: view.browserSessionReused }
      : {}),
    ...(view.browserActiveTabId
      ? { activeTabId: view.browserActiveTabId }
      : {}),
    ...(view.browserTabCount !== undefined
      ? { tabCount: view.browserTabCount }
      : {}),
  };
}

function browserPageProjection(view: BrowserToolEventTraceView) {
  return {
    ...(view.browserPageDiagnosis
      ? { pageDiagnosis: view.browserPageDiagnosis }
      : {}),
    ...(view.browserTakeoverRecommended !== undefined
      ? { takeoverRecommended: view.browserTakeoverRecommended }
      : {}),
    ...(view.browserFindMatchCount !== undefined
      ? { findMatchCount: view.browserFindMatchCount }
      : {}),
    ...(view.browserScrollPositionY !== undefined
      ? { scrollPositionY: view.browserScrollPositionY }
      : {}),
  };
}

function browserNetworkProjection(view: BrowserToolEventTraceView) {
  return {
    ...(view.browserBlockedRequestCount !== undefined
      ? { blockedRequestCount: view.browserBlockedRequestCount }
      : {}),
    ...(view.browserNetworkRequestCount !== undefined
      ? { networkRequestCount: view.browserNetworkRequestCount }
      : {}),
    ...(view.browserNetworkRejectedCount !== undefined
      ? { networkRejectedCount: view.browserNetworkRejectedCount }
      : {}),
    ...(view.browserNetworkTransferredBytes !== undefined
      ? { networkTransferredBytes: view.browserNetworkTransferredBytes }
      : {}),
    ...(view.browserNetworkDestinationCount !== undefined
      ? { destinationCount: view.browserNetworkDestinationCount }
      : {}),
  };
}

function browserOutputProjection(view: BrowserToolEventTraceView) {
  return {
    ...(view.browserSnapshotChars !== undefined
      ? { snapshotChars: view.browserSnapshotChars }
      : {}),
    ...(view.browserScreenshotBytes !== undefined
      ? { screenshotBytes: view.browserScreenshotBytes }
      : {}),
    ...(view.browserFileBytes !== undefined
      ? { fileBytes: view.browserFileBytes }
      : {}),
  };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function safeString(value: unknown, pattern: RegExp): string | undefined {
  return typeof value === "string" && pattern.test(value) ? value : undefined;
}

function browserAction(value: unknown): string | undefined {
  return typeof value === "string" && ACTIONS.has(value) ? value : undefined;
}
