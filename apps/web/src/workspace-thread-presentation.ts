import type { ThreadSummary } from "@napier/contracts";

import { copy } from "./copy";
import { getLocale } from "./locale";
import { workspaceTreeCopy as t } from "./workspace-tree-copy";

export function threadPreview(thread: ThreadSummary): string {
  const preview = thread.lastMessage
    .replace(/[*_`#>|]/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
  return (
    preview ||
    `${threadStatusLabel(thread.status)} · ${String(thread.eventCount)} ${t.events}`
  );
}

export function formatRelativeThreadTime(
  value: string,
  now = Date.now(),
): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  const elapsed = Math.max(0, now - timestamp);
  const locale = getLocale() === "zh" ? "zh-CN" : "en";
  const relative = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (elapsed < 60_000) return relative.format(0, "second");
  if (elapsed < 3_600_000) {
    return relative.format(-Math.floor(elapsed / 60_000), "minute");
  }
  if (elapsed < 86_400_000) {
    return relative.format(-Math.floor(elapsed / 3_600_000), "hour");
  }
  if (elapsed < 2_592_000_000) {
    return relative.format(-Math.floor(elapsed / 86_400_000), "day");
  }
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
  }).format(new Date(timestamp));
}

export function threadStatusLabel(status: ThreadSummary["status"]): string {
  if (status === "running") return copy.running;
  if (status === "waiting") return copy.waiting;
  if (status === "failed") return copy.failed;
  return copy.idle;
}
