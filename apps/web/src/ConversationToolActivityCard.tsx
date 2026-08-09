import {
  AlertTriangle,
  CheckCircle2,
  LoaderCircle,
  TerminalSquare,
  Wrench,
} from "lucide-react";

import type { ConversationToolActivity } from "./conversation-tool-activity-view-model";

export function ConversationToolActivityCard({
  activity,
}: {
  activity: ConversationToolActivity;
}) {
  const active = activity.status === "working";
  const StatusIcon = active
    ? LoaderCircle
    : activity.status === "completed"
      ? CheckCircle2
      : AlertTriangle;
  const ToolIcon = activity.kind === "shell" ? TerminalSquare : Wrench;
  const details = activityDetails(activity);
  return (
    <details
      className={`conversation-network-activity conversation-tool-activity kind-${activity.kind} status-${activity.status}`}
      open={activity.status === "failed" || activity.status === "blocked"}
    >
      <summary>
        <ToolIcon size={15} aria-hidden="true" />
        <div>
          <span>
            {activity.kind === "shell" ? "Shell" : "Tool"} · {activity.status}
          </span>
          <strong>{activitySummary(activity)}</strong>
        </div>
        <StatusIcon
          className={active ? "is-spinning" : ""}
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
      <p>{activity.receipt}</p>
    </details>
  );
}

function activitySummary(activity: ConversationToolActivity): string {
  if (activity.status === "working") {
    return `${humanize(activity.toolName)} is running`;
  }
  if (activity.status === "blocked") {
    return `${humanize(activity.toolName)} was blocked safely`;
  }
  if (activity.status === "failed") {
    return `${humanize(activity.toolName)} failed`;
  }
  if (activity.kind === "shell" && activity.evidence.commandStatus) {
    return `Command ${humanize(activity.evidence.commandStatus)}`;
  }
  return `${humanize(activity.toolName)} completed`;
}

function activityDetails(
  activity: ConversationToolActivity,
): Array<[string, string]> {
  const view = activity.evidence;
  return [
    ...(view.effect
      ? [["Effect", humanize(view.effect)] as [string, string]]
      : []),
    ...(view.commandRuntime
      ? [["Runtime", view.commandRuntime] as [string, string]]
      : []),
    ...(view.commandExitCode !== undefined
      ? [["Exit", String(view.commandExitCode)] as [string, string]]
      : []),
    ...(view.commandArgumentCount !== undefined
      ? [["Arguments", String(view.commandArgumentCount)] as [string, string]]
      : []),
    ...(view.commandTimeoutMs !== undefined
      ? [["Timeout", formatDuration(view.commandTimeoutMs)] as [string, string]]
      : []),
    ...(view.commandWorkspaceAccess
      ? [
          ["Workspace", humanize(view.commandWorkspaceAccess)] as [
            string,
            string,
          ],
        ]
      : []),
    ...(view.commandNetworkAccess
      ? [["Network", humanize(view.commandNetworkAccess)] as [string, string]]
      : []),
    ...(view.commandSha256
      ? [["Command", view.commandSha256.slice(0, 12)] as [string, string]]
      : []),
    ...(view.commandResultSha256
      ? [["Result", view.commandResultSha256.slice(0, 12)] as [string, string]]
      : []),
    ...(view.inputSha256
      ? [["Input", view.inputSha256.slice(0, 12)] as [string, string]]
      : []),
    ...(view.readStartLine !== undefined && view.readEndLine !== undefined
      ? [
          [
            "Range",
            `${String(view.readStartLine)}-${String(view.readEndLine)}`,
          ] as [string, string],
        ]
      : []),
    ...(view.readTotalLines !== undefined
      ? [["Lines", String(view.readTotalLines)] as [string, string]]
      : []),
    ...(view.readSizeBytes !== undefined
      ? [
          ["Size", `${view.readSizeBytes.toLocaleString()} B`] as [
            string,
            string,
          ],
        ]
      : []),
  ];
}

function humanize(value: string): string {
  const normalized = value.replaceAll("_", " ");
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function formatDuration(milliseconds: number): string {
  return milliseconds >= 1_000
    ? `${(milliseconds / 1_000).toLocaleString()}s`
    : `${milliseconds}ms`;
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat("en", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}
