import type { ThreadSummary } from "@napier/contracts";

import { copy } from "./copy";
import { getLocale } from "./locale";
import { workspaceTreeCopy as t } from "./workspace-tree-copy";

const relativeTimeFormats = new Map<string, Intl.RelativeTimeFormat>();
const dateFormats = new Map<string, Intl.DateTimeFormat>();

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
  const relative = relativeTimeFormat(locale);
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
  return dateFormat(locale).format(new Date(timestamp));
}

function relativeTimeFormat(locale: string): Intl.RelativeTimeFormat {
  const cached = relativeTimeFormats.get(locale);
  if (cached) return cached;
  const created = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  relativeTimeFormats.set(locale, created);
  return created;
}

function dateFormat(locale: string): Intl.DateTimeFormat {
  const cached = dateFormats.get(locale);
  if (cached) return cached;
  const created = new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
  });
  dateFormats.set(locale, created);
  return created;
}

export function threadStatusLabel(status: ThreadSummary["status"]): string {
  if (status === "running") return copy.running;
  if (status === "waiting") return copy.waiting;
  if (status === "failed") return copy.failed;
  return copy.idle;
}
