import type { RunComparison } from "@napier/contracts";

import { copy } from "./copy";

export function formatSignedNumber(value: number): string {
  if (value === 0) return "0";
  return `${value > 0 ? "+" : ""}${value.toLocaleString()}`;
}

export function formatSignedDuration(value: number): string {
  const absolute = Math.abs(value);
  const amount =
    absolute >= 1_000 ? `${(absolute / 1_000).toFixed(1)}s` : `${absolute}ms`;
  if (value === 0) return amount;
  return `${value > 0 ? "+" : "-"}${amount}`;
}

export function formatSignedCost(value: number): string {
  if (value === 0) return "$0";
  return `${value > 0 ? "+" : "-"}$${Math.abs(value).toFixed(4)}`;
}

export function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function formatSignedPercent(value: number): string {
  if (value === 0) return formatPercent(value);
  return `${value > 0 ? "+" : "-"}${formatPercent(Math.abs(value))}`;
}

export function contextCoverageStatusLabel(
  status: RunComparison["contextCoverageDelta"]["status"],
): string {
  if (status === "clean") return copy.lab.contextCoverageClean;
  if (status === "partial") return copy.lab.contextCoveragePartial;
  if (status === "missing") return copy.lab.contextCoverageMissing;
  return copy.lab.contextCoverageRegressed;
}

export function contextCoverageClassName(
  status: RunComparison["contextCoverageDelta"]["status"],
): string {
  if (status === "clean") return "is-unchanged";
  if (status === "partial") return "is-unavailable";
  return "is-changed";
}

export function traceSummaryCoverageStatusLabel(
  status: RunComparison["traceSummaryBoundaryDelta"]["status"],
): string {
  if (status === "clean") return copy.lab.traceSummaryClean;
  if (status === "generic_present") return copy.lab.traceSummaryGenericPresent;
  return copy.lab.traceSummaryRegressed;
}

export function traceSummaryCoverageClassName(
  status: RunComparison["traceSummaryBoundaryDelta"]["status"],
): string {
  if (status === "clean") return "is-unchanged";
  if (status === "generic_present") return "is-unavailable";
  return "is-changed";
}

export function shortRunLabId(value: string): string {
  return value.length > 15
    ? `${value.slice(0, 7)}...${value.slice(-5)}`
    : value;
}
