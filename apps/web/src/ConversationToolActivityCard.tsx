import {
  AlertTriangle,
  CheckCircle2,
  LoaderCircle,
  TerminalSquare,
  Wrench,
} from "lucide-react";

import type { ConversationToolActivity } from "./conversation-tool-activity-view-model";
import { conversationActivityCopy } from "./conversation-activity-copy";
import { getLocale } from "./locale";

export interface ConversationToolActivityCardProps {
  activity: ConversationToolActivity;
}

export function ConversationToolActivityCard({
  activity,
}: ConversationToolActivityCardProps) {
  const copy = conversationActivityCopy;
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
            {activity.kind === "shell" ? copy.tool.shell : copy.tool.tool} ·{" "}
            {copy.statuses[activity.status]}
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
  const copy = conversationActivityCopy.tool;
  const toolName = displayToolName(activity.toolName);
  if (activity.status === "working") {
    return `${toolName}${copy.runningSuffix}`;
  }
  if (activity.status === "blocked") {
    return `${toolName}${copy.blockedSuffix}`;
  }
  if (activity.status === "failed") {
    return `${toolName}${copy.failedSuffix}`;
  }
  if (activity.kind === "shell" && activity.evidence.commandStatus) {
    return `${copy.command} ${copy.commandStatuses[activity.evidence.commandStatus]}`;
  }
  return `${toolName}${copy.completedSuffix}`;
}

function activityDetails(
  activity: ConversationToolActivity,
): Array<[string, string]> {
  const view = activity.evidence;
  const copy = conversationActivityCopy.tool;
  return [
    ...(view.effect
      ? [[copy.labels.effect, copy.effects[view.effect]] as [string, string]]
      : []),
    ...(view.commandRuntime
      ? [[copy.labels.runtime, view.commandRuntime] as [string, string]]
      : []),
    ...(view.commandExitCode !== undefined
      ? [
          [copy.labels.exit, formatNumber(view.commandExitCode)] as [
            string,
            string,
          ],
        ]
      : []),
    ...(view.commandArgumentCount !== undefined
      ? [
          [copy.labels.arguments, formatNumber(view.commandArgumentCount)] as [
            string,
            string,
          ],
        ]
      : []),
    ...(view.commandTimeoutMs !== undefined
      ? [
          [copy.labels.timeout, formatDuration(view.commandTimeoutMs)] as [
            string,
            string,
          ],
        ]
      : []),
    ...(view.commandWorkspaceAccess
      ? [
          [
            copy.labels.workspace,
            copy.workspaceAccess[view.commandWorkspaceAccess],
          ] as [string, string],
        ]
      : []),
    ...(view.commandNetworkAccess
      ? [
          [
            copy.labels.network,
            copy.networkAccess[view.commandNetworkAccess],
          ] as [string, string],
        ]
      : []),
    ...(view.commandSha256
      ? [
          [copy.labels.command, view.commandSha256.slice(0, 12)] as [
            string,
            string,
          ],
        ]
      : []),
    ...(view.commandResultSha256
      ? [
          [copy.labels.result, view.commandResultSha256.slice(0, 12)] as [
            string,
            string,
          ],
        ]
      : []),
    ...(view.inputSha256
      ? [[copy.labels.input, view.inputSha256.slice(0, 12)] as [string, string]]
      : []),
    ...(view.readStartLine !== undefined && view.readEndLine !== undefined
      ? [
          [
            copy.labels.range,
            `${formatNumber(view.readStartLine)}-${formatNumber(view.readEndLine)}`,
          ] as [string, string],
        ]
      : []),
    ...(view.readTotalLines !== undefined
      ? [
          [copy.labels.lines, formatNumber(view.readTotalLines)] as [
            string,
            string,
          ],
        ]
      : []),
    ...(view.readSizeBytes !== undefined
      ? [
          [copy.labels.size, `${formatNumber(view.readSizeBytes)} B`] as [
            string,
            string,
          ],
        ]
      : []),
  ];
}

function displayToolName(value: string): string {
  const normalized = value.replaceAll("_", " ");
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function formatDuration(milliseconds: number): string {
  const units = conversationActivityCopy.tool.durationUnits;
  return milliseconds >= 1_000
    ? `${formatNumber(milliseconds / 1_000)}${units.seconds}`
    : `${formatNumber(milliseconds)}${units.milliseconds}`;
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
