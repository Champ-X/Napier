import type { RunEvent } from "@napier/contracts";

export interface ScheduleEventTraceView {
  action: string;
  status?: string;
  runStatus?: string;
  triggerType?: string;
  reason?: string;
  scheduleId?: string;
  triggerId?: string;
  runId?: string;
  scheduledFor?: string;
  nextRunAt?: string;
  revision?: number;
  changedFieldCount?: number;
}

const SCHEDULE_EVENT =
  /^schedule\.(created|updated|skipped|claimed|completed|failed|deduplicated)$/u;
const SAFE_TOKEN = /^[A-Za-z0-9_.:/@-]{1,180}$/u;
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T/u;
const SCHEDULE_RECEIPT_SUMMARY = "schedule receipt";

export function scheduleEventTraceView(
  event: RunEvent,
): ScheduleEventTraceView | undefined {
  if (!SCHEDULE_EVENT.test(event.type)) return undefined;
  if (
    !event.payload ||
    typeof event.payload !== "object" ||
    Array.isArray(event.payload)
  ) {
    return undefined;
  }
  const changedFields = Array.isArray(event.payload["changedFields"])
    ? event.payload["changedFields"]
    : undefined;
  const reason =
    event.type === "schedule.skipped"
      ? safeToken(event.payload["reason"])
      : undefined;
  return {
    action: event.type.slice("schedule.".length),
    ...safeTokenField(event.payload, "status"),
    ...safeTokenField(event.payload, "runStatus"),
    ...safeTokenField(event.payload, "triggerType"),
    ...(reason ? { reason } : {}),
    ...safeTokenField(event.payload, "scheduleId"),
    ...safeTokenField(event.payload, "triggerId"),
    ...safeTokenField(event.payload, "runId"),
    ...safeIsoField(event.payload, "scheduledFor"),
    ...safeIsoField(event.payload, "nextRunAt"),
    ...integerField(event.payload, "revision"),
    ...(changedFields ? { changedFieldCount: changedFields.length } : {}),
  };
}

export function scheduleEventTraceSummary(event: RunEvent): string | undefined {
  if (!event.type.startsWith("schedule.")) return undefined;
  if (!SCHEDULE_EVENT.test(event.type)) return event.category;
  const view = scheduleEventTraceView(event);
  if (!view) return SCHEDULE_RECEIPT_SUMMARY;
  return [
    `schedule / ${view.action}`,
    ...idSummary("schedule", view.scheduleId),
    ...idSummary("trigger", view.triggerId),
    ...idSummary("run", view.runId),
    ...(view.status ? [`status ${view.status}`] : []),
    ...(view.runStatus ? [`run-status ${view.runStatus}`] : []),
    ...(view.reason ? [`reason ${view.reason}`] : []),
    ...(view.triggerType ? [`trigger ${view.triggerType}`] : []),
    ...(view.scheduledFor ? [`scheduled-for ${view.scheduledFor}`] : []),
    ...(view.nextRunAt ? [`next ${view.nextRunAt}`] : []),
    ...(view.revision !== undefined ? [`revision ${view.revision}`] : []),
    ...(view.changedFieldCount !== undefined
      ? [`changed-fields ${view.changedFieldCount}`]
      : []),
  ].join(" / ");
}

function idSummary(label: string, value: string | undefined): string[] {
  return value ? [`${label} ${value.slice(-10)}`] : [];
}

function safeTokenField(
  payload: Record<string, unknown>,
  key: keyof ScheduleEventTraceView,
): Partial<ScheduleEventTraceView> {
  const value = safeToken(payload[key]);
  return value ? { [key]: value } : {};
}

function safeIsoField(
  payload: Record<string, unknown>,
  key: keyof ScheduleEventTraceView,
): Partial<ScheduleEventTraceView> {
  const value = safeIso(payload[key]);
  return value ? { [key]: value } : {};
}

function integerField(
  payload: Record<string, unknown>,
  key: keyof ScheduleEventTraceView,
): Partial<ScheduleEventTraceView> {
  const value = payload[key];
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? { [key]: value }
    : {};
}

function safeToken(value: unknown): string | undefined {
  return typeof value === "string" && SAFE_TOKEN.test(value)
    ? value
    : undefined;
}

function safeIso(value: unknown): string | undefined {
  return typeof value === "string" && ISO_TIME.test(value) ? value : undefined;
}
