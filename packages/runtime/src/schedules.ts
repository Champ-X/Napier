import type {
  AutomationSchedule,
  CreateAutomationScheduleRequest,
  ScheduleTrigger,
  UpdateAutomationScheduleRequest,
} from "@napier/contracts";

import { createId } from "./ids.js";

const MIN_INTERVAL_MS = 60_000;
const MAX_INTERVAL_MS = 30 * 24 * 60 * 60 * 1_000;
const MAX_CRON_SEARCH_MINUTES = 366 * 24 * 60;

export function createAutomationSchedule(
  request: CreateAutomationScheduleRequest,
  now = new Date(),
): AutomationSchedule {
  const timestamp = now.toISOString();
  const trigger = normalizeScheduleTrigger(request.trigger);
  return {
    id: createId("schedule"),
    name: requiredText(request.name, "Schedule name", 100),
    threadId: requiredId(request.threadId, "Schedule thread"),
    prompt: requiredPrompt(request.prompt),
    ...(request.model ? { model: normalizeModel(request.model) } : {}),
    trigger,
    status: request.status ?? "active",
    overlapPolicy: "skip",
    misfirePolicy: request.misfirePolicy ?? "run_once",
    nextRunAt: nextScheduleOccurrence(trigger, now).toISOString(),
    revision: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function updateAutomationSchedule(
  current: AutomationSchedule,
  request: UpdateAutomationScheduleRequest,
  now = new Date(),
): AutomationSchedule {
  const trigger = request.trigger
    ? normalizeScheduleTrigger(request.trigger)
    : current.trigger;
  const status = request.status ?? current.status;
  const updated: AutomationSchedule = {
    ...current,
    ...(request.name !== undefined
      ? { name: requiredText(request.name, "Schedule name", 100) }
      : {}),
    ...(request.prompt !== undefined
      ? { prompt: requiredPrompt(request.prompt) }
      : {}),
    ...(request.model ? { model: normalizeModel(request.model) } : {}),
    trigger,
    status,
    misfirePolicy: request.misfirePolicy ?? current.misfirePolicy,
    ...(request.trigger || (current.status === "paused" && status === "active")
      ? { nextRunAt: nextScheduleOccurrence(trigger, now).toISOString() }
      : {}),
    revision: current.revision + 1,
    updatedAt: now.toISOString(),
  };
  if (scheduleConfigSignature(updated) === scheduleConfigSignature(current)) {
    return structuredClone(current);
  }
  return updated;
}

export function nextScheduleOccurrence(
  trigger: ScheduleTrigger,
  after: Date,
): Date {
  if (!Number.isFinite(after.getTime())) {
    throw new Error("Schedule reference time is invalid");
  }
  if (trigger.type === "interval") {
    const everyMs = validateInterval(trigger.everyMs);
    const anchor = trigger.anchorAt
      ? parseTimestamp(trigger.anchorAt, "Schedule anchorAt")
      : after;
    if (anchor.getTime() > after.getTime()) return anchor;
    const elapsed = after.getTime() - anchor.getTime();
    return new Date(
      anchor.getTime() + (Math.floor(elapsed / everyMs) + 1) * everyMs,
    );
  }
  const cron = parseCronExpression(trigger.expression);
  let candidate = new Date(after.getTime());
  candidate.setUTCSeconds(0, 0);
  candidate = new Date(candidate.getTime() + 60_000);
  for (let index = 0; index < MAX_CRON_SEARCH_MINUTES; index += 1) {
    if (cronMatches(cron, candidate)) return candidate;
    candidate = new Date(candidate.getTime() + 60_000);
  }
  throw new Error("Cron expression has no occurrence within one year");
}

export function advanceSchedule(
  schedule: AutomationSchedule,
  scheduledFor: string,
  now = new Date(),
): string {
  const base =
    schedule.misfirePolicy === "skip" &&
    now.getTime() > Date.parse(scheduledFor)
      ? now
      : parseTimestamp(scheduledFor, "Scheduled occurrence");
  return nextScheduleOccurrence(schedule.trigger, base).toISOString();
}

export function normalizeScheduleTrigger(
  trigger: ScheduleTrigger,
): ScheduleTrigger {
  if (trigger.type === "interval") {
    const everyMs = validateInterval(trigger.everyMs);
    return {
      type: "interval",
      everyMs,
      ...(trigger.anchorAt
        ? {
            anchorAt: parseTimestamp(
              trigger.anchorAt,
              "Schedule anchorAt",
            ).toISOString(),
          }
        : {}),
    };
  }
  if (trigger.timezone !== "UTC") {
    throw new Error("Cron schedules currently require the UTC timezone");
  }
  const expression = trigger.expression.replace(/\s+/g, " ").trim();
  parseCronExpression(expression);
  return { type: "cron", expression, timezone: "UTC" };
}

interface ParsedCron {
  minute: Set<number>;
  hour: Set<number>;
  dayOfMonth: Set<number>;
  month: Set<number>;
  dayOfWeek: Set<number>;
  dayOfMonthWildcard: boolean;
  dayOfWeekWildcard: boolean;
}

function parseCronExpression(expression: string): ParsedCron {
  const fields = expression.replace(/\s+/g, " ").trim().split(" ");
  if (fields.length !== 5) {
    throw new Error("Cron expression must contain five UTC fields");
  }
  return {
    minute: parseCronField(fields[0]!, 0, 59, "minute"),
    hour: parseCronField(fields[1]!, 0, 23, "hour"),
    dayOfMonth: parseCronField(fields[2]!, 1, 31, "day of month"),
    month: parseCronField(fields[3]!, 1, 12, "month"),
    dayOfWeek: parseCronField(fields[4]!, 0, 6, "day of week"),
    dayOfMonthWildcard: fields[2] === "*",
    dayOfWeekWildcard: fields[4] === "*",
  };
}

function parseCronField(
  source: string,
  minimum: number,
  maximum: number,
  label: string,
): Set<number> {
  const values = new Set<number>();
  for (const part of source.split(",")) {
    const [rangeSource, stepSource] = part.split("/");
    if (
      !rangeSource ||
      (stepSource !== undefined && !/^\d+$/.test(stepSource))
    ) {
      throw new Error(`Invalid cron ${label} field: ${source}`);
    }
    const step = stepSource === undefined ? 1 : Number(stepSource);
    if (!Number.isInteger(step) || step < 1 || step > maximum - minimum + 1) {
      throw new Error(`Invalid cron ${label} step: ${source}`);
    }
    let start: number;
    let end: number;
    if (rangeSource === "*") {
      start = minimum;
      end = maximum;
    } else if (/^\d+$/.test(rangeSource)) {
      start = Number(rangeSource);
      end = start;
    } else {
      const bounds = rangeSource.split("-");
      if (
        bounds.length !== 2 ||
        !/^\d+$/.test(bounds[0] ?? "") ||
        !/^\d+$/.test(bounds[1] ?? "")
      ) {
        throw new Error(`Invalid cron ${label} field: ${source}`);
      }
      start = Number(bounds[0]);
      end = Number(bounds[1]);
    }
    if (start < minimum || end > maximum || start > end) {
      throw new Error(`Cron ${label} is outside ${minimum}-${maximum}`);
    }
    for (let value = start; value <= end; value += step) values.add(value);
  }
  if (values.size === 0) throw new Error(`Cron ${label} is empty`);
  return values;
}

function cronMatches(cron: ParsedCron, candidate: Date): boolean {
  if (
    !cron.minute.has(candidate.getUTCMinutes()) ||
    !cron.hour.has(candidate.getUTCHours()) ||
    !cron.month.has(candidate.getUTCMonth() + 1)
  ) {
    return false;
  }
  const dayOfMonthMatches = cron.dayOfMonth.has(candidate.getUTCDate());
  const dayOfWeekMatches = cron.dayOfWeek.has(candidate.getUTCDay());
  if (cron.dayOfMonthWildcard) return dayOfWeekMatches;
  if (cron.dayOfWeekWildcard) return dayOfMonthMatches;
  return dayOfMonthMatches || dayOfWeekMatches;
}

function validateInterval(value: number): number {
  if (
    !Number.isInteger(value) ||
    value < MIN_INTERVAL_MS ||
    value > MAX_INTERVAL_MS
  ) {
    throw new Error(
      `Schedule interval must be an integer from ${MIN_INTERVAL_MS} to ${MAX_INTERVAL_MS} ms`,
    );
  }
  return value;
}

function normalizeModel(model: { provider: string; id: string }) {
  const provider = model.provider.trim().toLowerCase();
  const id = model.id.trim();
  if (!/^[a-z][a-z0-9_-]{0,63}$/.test(provider) || !id || /\s/.test(id)) {
    throw new Error("Schedule model is invalid");
  }
  return { provider, id };
}

function requiredId(value: string, label: string): string {
  const normalized = value.trim();
  if (!/^[a-z][a-z0-9_]{2,80}$/.test(normalized)) {
    throw new Error(`${label} ID is invalid`);
  }
  return normalized;
}

function requiredText(value: string, label: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) throw new Error(`${label} is required`);
  if (normalized.length > maxLength) {
    throw new Error(`${label} must be at most ${maxLength} characters`);
  }
  return normalized;
}

function requiredPrompt(value: string): string {
  const normalized = value.replace(/\r\n?/g, "\n").trim();
  if (!normalized) throw new Error("Schedule prompt is required");
  if (normalized.length > 20_000) {
    throw new Error("Schedule prompt must be at most 20000 characters");
  }
  return normalized;
}

function parseTimestamp(value: string, label: string): Date {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()))
    throw new Error(`${label} is invalid`);
  return parsed;
}

function scheduleConfigSignature(schedule: AutomationSchedule): string {
  return JSON.stringify({
    name: schedule.name,
    prompt: schedule.prompt,
    model: schedule.model,
    trigger: schedule.trigger,
    status: schedule.status,
    misfirePolicy: schedule.misfirePolicy,
    nextRunAt: schedule.nextRunAt,
  });
}
