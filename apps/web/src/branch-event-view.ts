import type { RunEvent } from "@napier/contracts";

export interface BranchEventTraceView {
  action: string;
  sourceThreadId?: string;
  sourceSeq?: number;
  fromSeq?: number;
}

const BRANCH_RECEIPT_SUMMARY = "branch receipt";
const SAFE_TOKEN = /^[A-Za-z0-9_.:/@-]{1,180}$/u;

export function branchEventTraceView(
  event: RunEvent,
): BranchEventTraceView | undefined {
  if (!event.type.startsWith("branch.")) return undefined;
  if (
    !event.payload ||
    typeof event.payload !== "object" ||
    Array.isArray(event.payload)
  ) {
    return undefined;
  }
  return {
    action: event.type.slice("branch.".length),
    ...safeTokenField(event.payload, "sourceThreadId"),
    ...integerField(event.payload, "sourceSeq"),
    ...integerField(event.payload, "fromSeq"),
  };
}

export function branchEventTraceSummary(event: RunEvent): string | undefined {
  if (!event.type.startsWith("branch.")) return undefined;
  const view = branchEventTraceView(event);
  if (!view) return BRANCH_RECEIPT_SUMMARY;
  return [
    `branch / ${view.action}`,
    ...idSummary("source-thread", view.sourceThreadId),
    ...(view.sourceSeq !== undefined ? [`source-seq ${view.sourceSeq}`] : []),
    ...(view.fromSeq !== undefined ? [`from-seq ${view.fromSeq}`] : []),
  ].join(" / ");
}

function idSummary(label: string, value: string | undefined): string[] {
  return value ? [`${label} ${value.slice(-10)}`] : [];
}

function safeTokenField(
  payload: Record<string, unknown>,
  key: keyof BranchEventTraceView,
): Partial<BranchEventTraceView> {
  const value = safeToken(payload[key]);
  return value ? { [key]: value } : {};
}

function integerField(
  payload: Record<string, unknown>,
  key: keyof BranchEventTraceView,
): Partial<BranchEventTraceView> {
  const value = payload[key];
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? { [key]: value }
    : {};
}

function safeToken(value: unknown): string | undefined {
  return typeof value === "string" && SAFE_TOKEN.test(value) ? value : undefined;
}
