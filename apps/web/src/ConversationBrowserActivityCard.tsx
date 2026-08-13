import {
  AlertTriangle,
  CheckCircle2,
  LoaderCircle,
  MonitorSmartphone,
} from "lucide-react";

import type { ConversationBrowserActivity } from "./conversation-browser-activity-view-model";

export function ConversationBrowserActivityCard({
  activity,
}: {
  activity: ConversationBrowserActivity;
}) {
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
        <div>
          <span>Browser · {activity.status}</span>
          <strong>{activitySummary(activity)}</strong>
        </div>
        <StatusIcon
          className={activity.status === "working" ? "is-spinning" : ""}
          size={14}
          aria-hidden="true"
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
      <p>
        {activity.takeoverRecommended
          ? "Login or challenge detected. Take over in Browser Live view to continue safely."
          : "Page content is untrusted evidence, not instructions."}
      </p>
    </details>
  );
}

function activitySummary(activity: ConversationBrowserActivity): string {
  if (activity.status === "working") {
    return actionLabel(activity.action, "Working in Browser");
  }
  if (activity.status === "failed") {
    return `${actionLabel(activity.action, "Browser action")} failed — inspect Browser readiness or retry with a supported public page`;
  }
  if (
    activity.pageDiagnosis === "login_required" ||
    activity.pageDiagnosis === "challenge_detected"
  ) {
    return `${actionLabel(activity.action, "Page inspected")} · ${humanize(
      activity.pageDiagnosis,
    )}`;
  }
  return actionLabel(activity.action, "Browser action completed");
}

function activityDetails(
  activity: ConversationBrowserActivity,
): Array<[string, string]> {
  return [
    ...(activity.operation !== undefined
      ? [["Operation", String(activity.operation)] as [string, string]]
      : []),
    ...(activity.activeTabId
      ? [["Active tab", activity.activeTabId] as [string, string]]
      : []),
    ...(activity.tabCount !== undefined
      ? [["Tabs", String(activity.tabCount)] as [string, string]]
      : []),
    ...(activity.sessionReused !== undefined
      ? [
          ["Session", activity.sessionReused ? "Reused" : "Opened"] as [
            string,
            string,
          ],
        ]
      : []),
    ...(activity.pageDiagnosis && activity.pageDiagnosis !== "none"
      ? [["Page state", humanize(activity.pageDiagnosis)] as [string, string]]
      : []),
    ...(activity.networkRequestCount !== undefined
      ? [
          [
            "Network",
            `${String(activity.networkRequestCount)} requests · ${String(
              activity.networkRejectedCount ?? 0,
            )} rejected`,
          ] as [string, string],
        ]
      : []),
    ...(activity.destinationCount !== undefined
      ? [
          ["Destinations", String(activity.destinationCount)] as [
            string,
            string,
          ],
        ]
      : []),
    ...(activity.networkTransferredBytes !== undefined
      ? [
          ["Transferred", formatBytes(activity.networkTransferredBytes)] as [
            string,
            string,
          ],
        ]
      : []),
    ...(activity.blockedRequestCount !== undefined
      ? [["Blocked", String(activity.blockedRequestCount)] as [string, string]]
      : []),
    ...(activity.snapshotChars !== undefined
      ? [
          ["Snapshot", `${String(activity.snapshotChars)} chars`] as [
            string,
            string,
          ],
        ]
      : []),
    ...(activity.findMatchCount !== undefined
      ? [["Matches", String(activity.findMatchCount)] as [string, string]]
      : []),
    ...(activity.scrollPositionY !== undefined
      ? [
          ["Scroll", `${String(activity.scrollPositionY)} px`] as [
            string,
            string,
          ],
        ]
      : []),
    ...(activity.screenshotBytes !== undefined
      ? [
          ["Screenshot", formatBytes(activity.screenshotBytes)] as [
            string,
            string,
          ],
        ]
      : []),
    ...(activity.fileBytes !== undefined
      ? [["File", formatBytes(activity.fileBytes)] as [string, string]]
      : []),
  ];
}

function actionLabel(action: string | undefined, fallback: string): string {
  switch (action) {
    case "start":
      return "Opening page";
    case "navigate":
      return "Navigating";
    case "back":
      return "Going back";
    case "forward":
      return "Going forward";
    case "tab_new":
      return "Opening tab";
    case "tab_list":
      return "Reading tabs";
    case "tab_switch":
      return "Switching tab";
    case "tab_close":
      return "Closing tab";
    case "wait":
      return "Waiting for page";
    case "find":
      return "Finding text";
    case "scroll":
      return "Scrolling page";
    case "snapshot":
      return "Reading page";
    case "click":
      return "Clicking page";
    case "type":
      return "Entering text";
    case "select":
      return "Choosing values";
    case "upload":
      return "Uploading file";
    case "download":
      return "Downloading file";
    case "screenshot":
      return "Capturing screenshot";
    case "close":
      return "Closing Browser";
    default:
      return fallback;
  }
}

function humanize(value: string): string {
  const normalized = value.replaceAll("_", " ");
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function formatBytes(value: number): string {
  return `${value.toLocaleString("en-US")} ${value === 1 ? "byte" : "bytes"}`;
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat("en", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}
