import type { AutomationSchedule } from "@napier/contracts";
import { createId, type LocalStore, type ModelRegistry } from "@napier/runtime";
import { Hono, type Context } from "hono";

import {
  errorMessage,
  jsonError,
  setContentSha256Header,
  sha256Text,
} from "./http-response-evidence.js";
import {
  readLimitedJson,
  RequestBodyTooLargeError,
} from "./http-request-body.js";
import { assertAvailableModel } from "./model-http-availability.js";
import {
  parseCreateAutomationScheduleRequest,
  parseUpdateAutomationScheduleRequest,
} from "./schedule-http-validation.js";

const MAX_SCHEDULE_REQUEST_BYTES = 32 * 1024;

type ScheduleHttpStore = Pick<
  LocalStore,
  | "appendEvent"
  | "createSchedule"
  | "getSchedule"
  | "getThread"
  | "listSchedules"
  | "updateSchedule"
>;

export interface ScheduleHttpServices {
  store: ScheduleHttpStore;
  models: ModelRegistry;
}

export function registerScheduleHttp(
  app: Hono,
  services: ScheduleHttpServices,
): void {
  app.get("/api/schedules", (context) => {
    const threadId = context.req.query("thread");
    if (threadId) services.store.getThread(threadId);
    const schedules = services.store.listSchedules(threadId);
    setAutomationScheduleListHeaders(context, schedules);
    return context.json(schedules);
  });

  app.post("/api/schedules", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(
        context.req.raw,
        MAX_SCHEDULE_REQUEST_BYTES,
        "Schedule request",
      );
    } catch (error) {
      return jsonError(
        context,
        errorMessage(error),
        error instanceof RequestBodyTooLargeError ? 413 : 400,
      );
    }
    const body = parseCreateAutomationScheduleRequest(input);
    if (!body) {
      return jsonError(context, "Schedule request is invalid", 400);
    }
    services.store.getThread(body.threadId);
    try {
      if (body.model) await assertAvailableModel(services, body.model);
    } catch (error) {
      return jsonError(context, errorMessage(error), 400);
    }
    const schedule = await services.store.createSchedule(body);
    await appendAutomationEvent(services.store, schedule, "schedule.created", {
      scheduleId: schedule.id,
      name: schedule.name,
      status: schedule.status,
      triggerType: schedule.trigger.type,
      nextRunAt: schedule.nextRunAt,
      revision: schedule.revision,
    });
    setAutomationScheduleProjectionHeaders(context, schedule);
    return context.json(schedule, 201);
  });

  app.put("/api/schedules/:scheduleId", async (context) => {
    const scheduleId = context.req.param("scheduleId");
    let input: unknown;
    try {
      input = await readLimitedJson(
        context.req.raw,
        MAX_SCHEDULE_REQUEST_BYTES,
        "Schedule update request",
      );
    } catch (error) {
      return jsonError(
        context,
        errorMessage(error),
        error instanceof RequestBodyTooLargeError ? 413 : 400,
      );
    }
    const body = parseUpdateAutomationScheduleRequest(input);
    if (!body) {
      return jsonError(context, "Schedule update request is invalid", 400);
    }
    try {
      if (body.model) await assertAvailableModel(services, body.model);
    } catch (error) {
      return jsonError(context, errorMessage(error), 400);
    }
    const before = services.store.getSchedule(scheduleId);
    const schedule = await services.store.updateSchedule(scheduleId, body);
    const changedFields = scheduleChangedFields(before, schedule);
    if (changedFields.length > 0) {
      await appendAutomationEvent(
        services.store,
        schedule,
        "schedule.updated",
        {
          scheduleId: schedule.id,
          status: schedule.status,
          nextRunAt: schedule.nextRunAt,
          revision: schedule.revision,
          changedFields,
        },
      );
    }
    setAutomationScheduleProjectionHeaders(context, schedule);
    return context.json(schedule);
  });
}

function scheduleChangedFields(
  before: AutomationSchedule,
  after: AutomationSchedule,
): string[] {
  const fields: Array<keyof AutomationSchedule> = [
    "name",
    "prompt",
    "model",
    "trigger",
    "status",
    "misfirePolicy",
    "nextRunAt",
  ];
  return fields.filter(
    (field) => JSON.stringify(before[field]) !== JSON.stringify(after[field]),
  );
}

function setAutomationScheduleProjectionHeaders(
  context: Context,
  schedule: AutomationSchedule,
): void {
  const scheduleSha256 = sha256Text(JSON.stringify(schedule));
  context.header("Cache-Control", "no-store");
  setContentSha256Header(context, scheduleSha256, "body");
  context.header("X-Napier-Schedule-SHA256", scheduleSha256);
  context.header("X-Napier-Schedule-Id", schedule.id);
  context.header("X-Napier-Schedule-Status", schedule.status);
  context.header("X-Napier-Schedule-Revision", String(schedule.revision));
  context.header("X-Napier-Schedule-Next-Run-At", schedule.nextRunAt);
}

function setAutomationScheduleListHeaders(
  context: Context,
  schedules: readonly AutomationSchedule[],
): void {
  const scheduleListSha256 = automationScheduleListSha256(schedules);
  context.header("Cache-Control", "no-store");
  setContentSha256Header(context, scheduleListSha256, "body");
  context.header("X-Napier-Schedule-List-SHA256", scheduleListSha256);
  setAutomationScheduleCountHeaders(context, schedules);
}

export function automationScheduleListSha256(
  schedules: readonly AutomationSchedule[],
): string {
  return sha256Text(JSON.stringify(schedules));
}

export function setAutomationScheduleCountHeaders(
  context: Context,
  schedules: readonly AutomationSchedule[],
): void {
  context.header("X-Napier-Schedule-Count", String(schedules.length));
  context.header(
    "X-Napier-Active-Schedule-Count",
    String(schedules.filter((schedule) => schedule.status === "active").length),
  );
  context.header(
    "X-Napier-Paused-Schedule-Count",
    String(schedules.filter((schedule) => schedule.status === "paused").length),
  );
}

async function appendAutomationEvent(
  store: ScheduleHttpStore,
  schedule: AutomationSchedule,
  type: string,
  payload: Record<string, string | number | string[]>,
): Promise<void> {
  await store.appendEvent({
    threadId: schedule.threadId,
    runId: createId("runctl"),
    type,
    category: "automation",
    visibility: "user",
    payload,
  });
}
