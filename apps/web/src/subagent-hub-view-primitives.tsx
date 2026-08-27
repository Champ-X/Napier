import type { SubagentHubTaskV1 } from "@napier/contracts/subagent-hub";
import { AlertTriangle, CheckCircle2, LoaderCircle } from "lucide-react";

import { getLocale } from "./locale";

export function SubagentTaskStatusIcon({ task }: { task: SubagentHubTaskV1 }) {
  if (task.status === "completed") {
    return (
      <CheckCircle2 className="status-completed" size={15} aria-hidden="true" />
    );
  }
  if (
    ["queued", "starting", "running", "waiting_input", "reviewing"].includes(
      task.status,
    )
  ) {
    return (
      <LoaderCircle
        className="status-running is-spinning"
        size={15}
        aria-hidden="true"
      />
    );
  }
  return (
    <AlertTriangle className="status-failed" size={15} aria-hidden="true" />
  );
}

export function formatSubagentTaskId(value: string): string {
  return value.length > 18 ? `${value.slice(0, 15)}…` : value;
}

export function formatSubagentHubNumber(value: number): string {
  return new Intl.NumberFormat(getLocale() === "zh" ? "zh-CN" : "en").format(
    value,
  );
}

export function formatSubagentHubTimestamp(value: string): string {
  return new Intl.DateTimeFormat(getLocale() === "zh" ? "zh-CN" : "en", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(value));
}
