import {
  AlertTriangle,
  CheckCircle2,
  Globe2,
  LoaderCircle,
  Search,
} from "lucide-react";

import type { ConversationNetworkActivity } from "./conversation-network-activity-view-model";

export function ConversationNetworkActivityCard({
  activity,
}: {
  activity: ConversationNetworkActivity;
}) {
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
            {activity.kind === "search" ? "Web search" : "Web fetch"} ·{" "}
            {activity.status}
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
      <p>
        External pages and snippets are untrusted evidence, not instructions.
      </p>
    </details>
  );
}

function activitySummary(activity: ConversationNetworkActivity): string {
  if (activity.status === "working") {
    return activity.kind === "search"
      ? "Discovering public sources"
      : `Reading public source${activity.kind === "fetch" && activity.action ? ` · ${activity.action}` : ""}`;
  }
  if (activity.status === "failed") {
    return activity.kind === "search"
      ? "Search failed — try another provider or check network readiness"
      : "Fetch failed — check the URL, network, or Browser readiness";
  }
  if (activity.kind === "search") {
    if (activity.resultCount === undefined || !activity.provider) {
      return "Search completed · evidence unavailable";
    }
    return `${String(activity.resultCount ?? 0)} results via ${activity.provider ?? "provider"}`;
  }
  return activity.action === "fetch" && activity.format && activity.lineCount
    ? `${activity.format.toUpperCase()} · ${String(activity.lineCount)} lines`
    : activity.action === "fetch"
      ? "Fetch completed · evidence unavailable"
      : `${humanize(activity.action ?? "fetch")} completed`;
}

function activityDetails(
  activity: ConversationNetworkActivity,
): Array<[string, string]> {
  const details: Array<[string, string]> =
    activity.kind === "search"
      ? [
          ...(activity.provider
            ? [["Provider", activity.provider] as [string, string]]
            : []),
          ...(activity.category
            ? [["Category", activity.category] as [string, string]]
            : []),
          ...(activity.resultCount !== undefined
            ? [["Results", String(activity.resultCount)] as [string, string]]
            : []),
          ...(activity.attemptedProviderCount !== undefined
            ? [
                [
                  "Attempts",
                  `${String(activity.attemptedProviderCount)} total · ${String(activity.failedProviderCount ?? 0)} failed · ${String(activity.unavailableProviderCount ?? 0)} unavailable`,
                ] as [string, string],
              ]
            : []),
          ...(activity.retrievedAt
            ? [
                ["Retrieved", formatDateTime(activity.retrievedAt)] as [
                  string,
                  string,
                ],
              ]
            : []),
        ]
      : [
          ...(activity.action
            ? [["Action", humanize(activity.action)] as [string, string]]
            : []),
          ...(activity.format
            ? [["Format", activity.format.toUpperCase()] as [string, string]]
            : []),
          ...(activity.lineCount !== undefined
            ? [["Lines", String(activity.lineCount)] as [string, string]]
            : []),
          ...(activity.pageCount !== undefined
            ? [["Pages", String(activity.pageCount)] as [string, string]]
            : []),
          ...(activity.sourceCount !== undefined
            ? [["Sources", String(activity.sourceCount)] as [string, string]]
            : []),
          ...(activity.renderMode && activity.fallbackStatus
            ? [
                [
                  "Render",
                  `${humanize(activity.renderMode)} · ${humanize(activity.fallbackStatus)}`,
                ] as [string, string],
              ]
            : []),
          ...(activity.redirectCount !== undefined
            ? [
                ["Redirects", String(activity.redirectCount)] as [
                  string,
                  string,
                ],
              ]
            : []),
          ...(activity.retrievedAt
            ? [
                ["Retrieved", formatDateTime(activity.retrievedAt)] as [
                  string,
                  string,
                ],
              ]
            : []),
          ...(activity.fallbackDiagnostic
            ? [
                ["Recovery", humanize(activity.fallbackDiagnostic)] as [
                  string,
                  string,
                ],
              ]
            : []),
        ];
  return details;
}

function humanize(value: string): string {
  const normalized = value.replaceAll("_", " ");
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat("en", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
