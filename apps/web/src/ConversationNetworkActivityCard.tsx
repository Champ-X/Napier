import {
  AlertTriangle,
  CheckCircle2,
  Globe2,
  LoaderCircle,
  Search,
} from "lucide-react";

import type { ConversationNetworkActivity } from "./conversation-network-activity-view-model";
import { conversationActivityCopy } from "./conversation-activity-copy";
import { getLocale } from "./locale";

export interface ConversationNetworkActivityCardProps {
  activity: ConversationNetworkActivity;
}

export function ConversationNetworkActivityCard({
  activity,
}: ConversationNetworkActivityCardProps) {
  const copy = conversationActivityCopy;
  const details = activityDetails(activity);
  const StatusIcon =
    activity.status === "working"
      ? LoaderCircle
      : activity.status === "failed"
        ? AlertTriangle
        : CheckCircle2;
  return (
    <details
      className={`conversation-network-activity kind-${activity.kind} status-${activity.status}`}
      open={activity.status !== "completed"}
    >
      <summary>
        {activity.kind === "search" ? (
          <Search size={15} aria-hidden="true" />
        ) : (
          <Globe2 size={15} aria-hidden="true" />
        )}
        <div>
          <span>
            {activity.kind === "search"
              ? copy.network.search
              : copy.network.fetch}{" "}
            · {copy.statuses[activity.status]}
          </span>
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
      <p>{copy.network.untrusted}</p>
    </details>
  );
}

function activitySummary(activity: ConversationNetworkActivity): string {
  const copy = conversationActivityCopy.network;
  if (activity.status === "working") {
    return activity.kind === "search"
      ? copy.discovering
      : `${copy.reading}${activity.action ? ` · ${copy.actions[activity.action]}` : ""}`;
  }
  if (activity.status === "failed") {
    return activity.kind === "search" ? copy.searchFailed : copy.fetchFailed;
  }
  if (activity.kind === "search") {
    if (activity.resultCount === undefined || !activity.provider) {
      return `${copy.searchCompleted} · ${copy.evidenceUnavailable}`;
    }
    return `${formatNumber(activity.resultCount)} ${copy.resultsVia} ${activity.provider}`;
  }
  return activity.action === "fetch" && activity.format && activity.lineCount
    ? `${activity.format.toUpperCase()} · ${formatNumber(activity.lineCount)} ${copy.lines}`
    : activity.action === "fetch"
      ? `${copy.fetchCompleted} · ${copy.evidenceUnavailable}`
      : `${copy.actions[activity.action ?? "fetch"]} ${copy.completed}`;
}

function activityDetails(
  activity: ConversationNetworkActivity,
): Array<[string, string]> {
  const copy = conversationActivityCopy.network;
  const details: Array<[string, string]> =
    activity.kind === "search"
      ? [
          ...(activity.provider
            ? [[copy.labels.provider, activity.provider] as [string, string]]
            : []),
          ...(activity.category
            ? [
                [copy.labels.category, copy.categories[activity.category]] as [
                  string,
                  string,
                ],
              ]
            : []),
          ...(activity.resultCount !== undefined
            ? [
                [copy.labels.results, formatNumber(activity.resultCount)] as [
                  string,
                  string,
                ],
              ]
            : []),
          ...(activity.attemptedProviderCount !== undefined
            ? [
                [
                  copy.labels.attempts,
                  `${formatNumber(activity.attemptedProviderCount)} ${copy.attemptUnits.total} · ${formatNumber(activity.failedProviderCount ?? 0)} ${copy.attemptUnits.failed} · ${formatNumber(activity.unavailableProviderCount ?? 0)} ${copy.attemptUnits.unavailable}`,
                ] as [string, string],
              ]
            : []),
          ...(activity.retrievedAt
            ? [
                [
                  copy.labels.retrieved,
                  formatDateTime(activity.retrievedAt),
                ] as [string, string],
              ]
            : []),
        ]
      : [
          ...(activity.action
            ? [
                [copy.labels.action, copy.actions[activity.action]] as [
                  string,
                  string,
                ],
              ]
            : []),
          ...(activity.format
            ? [
                [copy.labels.format, activity.format.toUpperCase()] as [
                  string,
                  string,
                ],
              ]
            : []),
          ...(activity.lineCount !== undefined
            ? [
                [copy.labels.lines, formatNumber(activity.lineCount)] as [
                  string,
                  string,
                ],
              ]
            : []),
          ...(activity.pageCount !== undefined
            ? [
                [copy.labels.pages, formatNumber(activity.pageCount)] as [
                  string,
                  string,
                ],
              ]
            : []),
          ...(activity.sourceCount !== undefined
            ? [
                [copy.labels.sources, formatNumber(activity.sourceCount)] as [
                  string,
                  string,
                ],
              ]
            : []),
          ...(activity.renderMode && activity.fallbackStatus
            ? [
                [
                  copy.labels.render,
                  `${copy.renderModes[activity.renderMode]} · ${copy.fallbackStatuses[activity.fallbackStatus]}`,
                ] as [string, string],
              ]
            : []),
          ...(activity.redirectCount !== undefined
            ? [
                [
                  copy.labels.redirects,
                  formatNumber(activity.redirectCount),
                ] as [string, string],
              ]
            : []),
          ...(activity.retrievedAt
            ? [
                [
                  copy.labels.retrieved,
                  formatDateTime(activity.retrievedAt),
                ] as [string, string],
              ]
            : []),
          ...(activity.fallbackDiagnostic
            ? [
                [
                  copy.labels.recovery,
                  copy.fallbackDiagnostics[activity.fallbackDiagnostic],
                ] as [string, string],
              ]
            : []),
        ];
  return details;
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat(getLocale() === "zh" ? "zh-CN" : "en", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat(getLocale() === "zh" ? "zh-CN" : "en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat(getLocale() === "zh" ? "zh-CN" : "en").format(
    value,
  );
}
