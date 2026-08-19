import type { WorkspaceProcessDelta } from "@napier/contracts";

import { workspaceProcessCopy as copy } from "./workspace-process-copy";

export function formatDeltaMetadata(
  entry: WorkspaceProcessDelta["entries"][number],
  labels: Pick<
    typeof copy,
    "beforeHash" | "afterHash" | "beforeSize" | "afterSize"
  >,
): string {
  return [
    ...(entry.beforeSha256
      ? [`${labels.beforeHash} ${entry.beforeSha256.slice(0, 12)}`]
      : []),
    ...(entry.afterSha256
      ? [`${labels.afterHash} ${entry.afterSha256.slice(0, 12)}`]
      : []),
    ...(entry.beforeSizeBytes !== undefined
      ? [`${labels.beforeSize} ${entry.beforeSizeBytes.toLocaleString()}`]
      : []),
    ...(entry.afterSizeBytes !== undefined
      ? [`${labels.afterSize} ${entry.afterSizeBytes.toLocaleString()}`]
      : []),
  ].join(" · ");
}

export function formatProcessDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(new Date(value));
}
