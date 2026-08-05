import type { RunEvent } from "@napier/contracts";
import type { BrowserInteractionAction } from "@napier/contracts/browser-interaction-confirmation";
import type { BrowserSessionPauseState } from "@napier/contracts/browser-session-control";
import type { BrowserTakeoverAction } from "@napier/contracts/browser-takeover";

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
  if (options.controlTransition) {
    return {
      state: "control",
      label:
        options.controlTransition === "pausing"
          ? "Control · pausing after current action"
          : "Control · returning to Agent",
    };
  }
  if (options.operatorAction) {
    return {
      state: "operator",
      label: `Operator · ${actionLabel(options.operatorAction)}`,
    };
  }
  if (options.takeoverOpen) {
    return { state: "operator", label: "Operator · takeover active" };
  }
  if (options.confirmationAction) {
    return {
      state: "confirmation",
      label: `Waiting · approve ${actionLabel(options.confirmationAction)}`,
    };
  }
  const active = activeBrowserAction(events, runId);
  if (active && options.pauseStatus === "paused") {
    const pauseRequestedSeq = latestPauseRequestedSeq(events, runId);
    return pauseRequestedSeq !== undefined && active.seq < pauseRequestedSeq
      ? {
          state: "active",
          label: `Agent · ${actionLabel(active.action)} · pause queued`,
        }
      : {
          state: "paused",
          label: `Agent · ${actionLabel(active.action)} · waiting for resume`,
        };
  }
  if (options.pauseStatus === "paused") {
    return { state: "paused", label: "Waiting · operator paused automation" };
  }
  if (active) {
    return { state: "active", label: `Agent · ${actionLabel(active.action)}` };
  }
  return { state: "idle", label: "Ready · waiting for Agent" };
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

function safeCallId(value: unknown): string | undefined {
  return typeof value === "string" && /^[A-Za-z0-9_.:-]{1,160}$/u.test(value)
    ? value
    : undefined;
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
