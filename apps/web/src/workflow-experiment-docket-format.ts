import { workflowExperimentCopy as copy } from "./workflow-experiment-copy";

export function workflowExperimentStatusLabel(status: string): string {
  return copy.statuses[status as keyof typeof copy.statuses] ?? status;
}

export function workflowExperimentChangeLabel(change: string): string {
  return copy.changes[change as keyof typeof copy.changes] ?? change;
}

export function formatSignedWorkflowMetric(
  value: number,
  suffix = "",
  fractionDigits?: number,
): string {
  const text =
    fractionDigits === undefined
      ? value.toLocaleString()
      : value.toFixed(fractionDigits);
  return `${value > 0 ? "+" : ""}${text}${suffix}`;
}

export function workflowMetricDeltaClass(value: string): string {
  return value.startsWith("+")
    ? "is-higher"
    : value.startsWith("-")
      ? "is-lower"
      : "is-even";
}

export function shortWorkflowResultId(value: string): string {
  return value.length > 18
    ? `${value.slice(0, 10)}...${value.slice(-6)}`
    : value;
}
