import {
  AlertTriangle,
  CheckCircle2,
  LoaderCircle,
  MonitorSmartphone,
} from "lucide-react";

import type { ConversationBrowserActivity } from "./conversation-browser-activity-view-model";
import { conversationActivityCopy } from "./conversation-activity-copy";
import { getLocale } from "./locale";
import { ConversationToolContent } from "./ConversationToolContent";

export interface ConversationBrowserActivityCardProps {
  activity: ConversationBrowserActivity;
}

export function ConversationBrowserActivityCard({
  activity,
}: ConversationBrowserActivityCardProps) {
  const copy = conversationActivityCopy;
  const StatusIcon =
    activity.status === "working"
      ? LoaderCircle
      : activity.status === "failed"
        ? AlertTriangle
        : CheckCircle2;
  const details = activityDetails(activity);
  return (
    <details
      className={`conversation-browser-activity status-${activity.status}${
        activity.takeoverRecommended ? " takeover-recommended" : ""
      }`}
      open={activity.status !== "completed" || activity.takeoverRecommended}
    >
      <summary>
        <MonitorSmartphone size={15} aria-hidden="true" />
        <strong>{activitySummary(activity)}</strong>
        <StatusIcon
          className={activity.status === "working" ? "is-spinning" : ""}
          size={14}
          role="img"
          aria-label={copy.statuses[activity.status]}
        />
        <time dateTime={activity.createdAt}>
          {formatTime(activity.createdAt)}
        </time>
      </summary>
      {details.length > 0 ? (
        <dl>
          {details.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {activity.display ? (
        <ConversationToolContent
          display={activity.display}
          toolName="browser"
        />
      ) : null}
      <p>
        {activity.takeoverRecommended
          ? copy.browser.takeover
          : copy.browser.untrusted}
      </p>
    </details>
  );
}

function activitySummary(activity: ConversationBrowserActivity): string {
  const copy = conversationActivityCopy.browser;
  if (activity.status === "working") {
    return actionLabel(activity.action, copy.working);
  }
  if (activity.status === "failed") {
    return failedActionLabel(activity.action, copy.actionFailed);
  }
  if (
    activity.pageDiagnosis === "login_required" ||
    activity.pageDiagnosis === "challenge_detected"
  ) {
    return `${completedActionLabel(activity.action, copy.inspected)} · ${copy.diagnoses[activity.pageDiagnosis]}`;
  }
  return completedActionLabel(activity.action, copy.actionCompleted);
}

function completedActionLabel(
  action: string | undefined,
  fallback: string,
): string {
  const actions = conversationActivityCopy.browser.completedActions;
  return action && action in actions
    ? actions[action as keyof typeof actions]
    : fallback;
}

function failedActionLabel(
  action: string | undefined,
  fallback: string,
): string {
  const actions = conversationActivityCopy.browser.failedActions;
  return action && action in actions
    ? actions[action as keyof typeof actions]
    : fallback;
}

function activityDetails(
  activity: ConversationBrowserActivity,
): Array<[string, string]> {
  const copy = conversationActivityCopy.browser;
  return [
    ...(activity.operation !== undefined
      ? [
          [copy.labels.operation, formatNumber(activity.operation)] as [
            string,
            string,
          ],
        ]
      : []),
    ...(activity.activeTabId
      ? [[copy.labels.activeTab, activity.activeTabId] as [string, string]]
      : []),
    ...(activity.tabCount !== undefined
      ? [
          [copy.labels.tabs, formatNumber(activity.tabCount)] as [
            string,
            string,
          ],
        ]
      : []),
    ...(activity.sessionReused !== undefined
      ? [
          [
            copy.labels.session,
            activity.sessionReused ? copy.session.reused : copy.session.opened,
          ] as [string, string],
        ]
      : []),
    ...(activity.pageDiagnosis && activity.pageDiagnosis !== "none"
      ? [
          [copy.labels.pageState, copy.diagnoses[activity.pageDiagnosis]] as [
            string,
            string,
          ],
        ]
      : []),
    ...(activity.networkRequestCount !== undefined
      ? [
          [
            copy.labels.network,
            `${formatNumber(activity.networkRequestCount)} ${copy.units.requests} · ${formatNumber(activity.networkRejectedCount ?? 0)} ${copy.units.rejected}`,
          ] as [string, string],
        ]
      : []),
    ...(activity.destinationCount !== undefined
      ? [
          [
            copy.labels.destinations,
            formatNumber(activity.destinationCount),
          ] as [string, string],
        ]
      : []),
    ...(activity.networkTransferredBytes !== undefined
      ? [
          [
            copy.labels.transferred,
            formatBytes(activity.networkTransferredBytes),
          ] as [string, string],
        ]
      : []),
    ...(activity.blockedRequestCount !== undefined
      ? [
          [copy.labels.blocked, formatNumber(activity.blockedRequestCount)] as [
            string,
            string,
          ],
        ]
      : []),
    ...(activity.snapshotChars !== undefined
      ? [
          [
            copy.labels.snapshot,
            `${formatNumber(activity.snapshotChars)} ${copy.units.chars}`,
          ] as [string, string],
        ]
      : []),
    ...(activity.findMatchCount !== undefined
      ? [
          [copy.labels.matches, formatNumber(activity.findMatchCount)] as [
            string,
            string,
          ],
        ]
      : []),
    ...(activity.scrollPositionY !== undefined
      ? [
          [
            copy.labels.scroll,
            `${formatNumber(activity.scrollPositionY)} px`,
          ] as [string, string],
        ]
      : []),
    ...(activity.screenshotBytes !== undefined
      ? [
          [copy.labels.screenshot, formatBytes(activity.screenshotBytes)] as [
            string,
            string,
          ],
        ]
      : []),
    ...(activity.fileBytes !== undefined
      ? [
          [copy.labels.file, formatBytes(activity.fileBytes)] as [
            string,
            string,
          ],
        ]
      : []),
  ];
}

function actionLabel(action: string | undefined, fallback: string): string {
  const actions = conversationActivityCopy.browser.actions;
  switch (action) {
    case "start":
      return actions.start;
    case "navigate":
      return actions.navigate;
    case "back":
      return actions.back;
    case "forward":
      return actions.forward;
    case "tab_new":
      return actions.tab_new;
    case "tab_list":
      return actions.tab_list;
    case "tab_switch":
      return actions.tab_switch;
    case "tab_close":
      return actions.tab_close;
    case "wait":
      return actions.wait;
    case "find":
      return actions.find;
    case "scroll":
      return actions.scroll;
    case "snapshot":
      return actions.snapshot;
    case "click":
      return actions.click;
    case "type":
      return actions.type;
    case "select":
      return actions.select;
    case "upload":
      return actions.upload;
    case "download":
      return actions.download;
    case "screenshot":
      return actions.screenshot;
    case "keypress":
      return actions.keypress;
    case "close":
      return actions.close;
    default:
      return fallback;
  }
}

function formatBytes(value: number): string {
  return `${formatNumber(value)} ${conversationActivityCopy.browser.units.bytes}`;
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat(getLocale() === "zh" ? "zh-CN" : "en", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat(getLocale() === "zh" ? "zh-CN" : "en").format(
    value,
  );
}
