import type { RunEvent } from "@napier/contracts";
import type { BrowserInteractionAction } from "@napier/contracts/browser-interaction-confirmation";
import type { BrowserSessionPauseState } from "@napier/contracts/browser-session-control";
import type { BrowserTakeoverAction } from "@napier/contracts/browser-takeover";

import { conversationActivityCopy } from "./conversation-activity-copy";

export type BrowserLiveControlTransition = "pausing" | "resuming";

export interface BrowserLiveActivity {
  state: "active" | "confirmation" | "control" | "idle" | "operator" | "paused";
  label: string;
}

const BROWSER_ACTIONS = new Set([
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

export function browserLiveActivity(
  events: readonly RunEvent[],
  runId: string,
  options: {
    pauseStatus: BrowserSessionPauseState["status"];
    takeoverOpen: boolean;
    controlTransition?: BrowserLiveControlTransition;
    confirmationAction?: BrowserInteractionAction;
    operatorAction?: BrowserTakeoverAction;
  },
): BrowserLiveActivity {
  const live = conversationActivityCopy.browser.live;
  if (options.controlTransition) {
    return {
      state: "control",
      label:
        options.controlTransition === "pausing"
          ? `${live.control} · ${live.pausingAfterCurrentAction}`
          : `${live.control} · ${live.returningToAgent}`,
    };
  }
  if (options.operatorAction) {
    return {
      state: "operator",
      label: `${live.operator} · ${actionLabel(options.operatorAction)}`,
    };
  }
  if (options.takeoverOpen) {
    return {
      state: "operator",
      label: `${live.operator} · ${live.takeoverActive}`,
    };
  }
  if (options.confirmationAction) {
    return {
      state: "confirmation",
      label: `${live.waiting} · ${live.approveActionPrefix}${actionLabel(options.confirmationAction)}`,
    };
  }
  const active = activeBrowserAction(events, runId);
  if (active && options.pauseStatus === "paused") {
    const pauseRequestedSeq = latestPauseRequestedSeq(events, runId);
    return pauseRequestedSeq !== undefined && active.seq < pauseRequestedSeq
      ? {
          state: "active",
          label: `${live.agent} · ${actionLabel(active.action)} · ${live.pauseQueued}`,
        }
      : {
          state: "paused",
          label: `${live.agent} · ${actionLabel(active.action)} · ${live.waitingForResume}`,
        };
  }
  if (options.pauseStatus === "paused") {
    return {
      state: "paused",
      label: `${live.waiting} · ${live.operatorPausedAutomation}`,
    };
  }
  if (active) {
    return {
      state: "active",
      label: `${live.agent} · ${actionLabel(active.action)}`,
    };
  }
  return { state: "idle", label: `${live.ready} · ${live.waitingForAgent}` };
}

function activeBrowserAction(
  events: readonly RunEvent[],
  runId: string,
): { action: string; seq: number } | undefined {
  const settled = new Set<string>();
  for (const event of events.slice().reverse()) {
    if (
      event.runId !== runId ||
      !record(event.payload) ||
      event.payload["toolName"] !== "browser"
    ) {
      continue;
    }
    const callId = safeCallId(event.payload["callId"]);
    if (!callId) continue;
    if (event.type === "tool.completed" || event.type === "tool.failed") {
      settled.add(callId);
      continue;
    }
    if (event.type !== "tool.started" || settled.has(callId)) continue;
    const action = event.payload["action"];
    return typeof action === "string" && BROWSER_ACTIONS.has(action)
      ? { action, seq: event.seq }
      : undefined;
  }
  return undefined;
}

function latestPauseRequestedSeq(
  events: readonly RunEvent[],
  runId: string,
): number | undefined {
  return events
    .slice()
    .reverse()
    .find(
      (event) =>
        event.runId === runId &&
        event.type === "browser.session_pause.requested" &&
        record(event.payload) &&
        event.payload["kind"] === "napier.browser-session-pause-state" &&
        event.payload["schemaVersion"] === 1 &&
        event.payload["status"] === "paused",
    )?.seq;
}

function actionLabel(action: string): string {
  if (String(conversationActivityCopy.browser.live.agent) === "智能体") {
    return chineseActionLabel(action);
  }
  switch (action) {
    case "start":
      return "opening page";
    case "navigate":
      return "navigating";
    case "back":
      return "going back";
    case "forward":
      return "going forward";
    case "tab_new":
      return "opening tab";
    case "tab_list":
      return "reading tabs";
    case "tab_switch":
      return "switching tab";
    case "tab_close":
      return "closing tab";
    case "wait":
      return "waiting for page";
    case "find":
      return "finding text";
    case "scroll":
      return "scrolling page";
    case "snapshot":
      return "reading page";
    case "click":
    case "visual_click":
      return "clicking page";
    case "type":
      return "entering text";
    case "select":
      return "choosing values";
    case "upload":
      return "uploading file";
    case "download":
      return "downloading file";
    case "save_screenshot":
    case "screenshot":
      return "capturing screenshot";
    case "keypress":
      return "pressing navigation key";
    case "close":
      return "closing Browser";
    default:
      return "working";
  }
}

function chineseActionLabel(action: string): string {
  const actions = conversationActivityCopy.browser.actions;
  switch (action) {
    case "visual_click":
      return actions.click;
    case "save_screenshot":
      return actions.screenshot;
    case "keypress":
      return actions.keypress;
    default:
      return actions[action as keyof typeof actions] ?? actions.wait;
  }
}

function safeCallId(value: unknown): string | undefined {
  return typeof value === "string" && /^[A-Za-z0-9_.:-]{1,160}$/u.test(value)
    ? value
    : undefined;
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
