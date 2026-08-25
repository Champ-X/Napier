import type {
  CreateAutomationScheduleRequest,
  UpdateAutomationScheduleRequest,
} from "@napier/contracts";
import { normalizeScheduleTrigger } from "@napier/runtime/agent";

import {
  normalizeBoundedPrompt,
  normalizeBoundedText,
  parseModelRef,
  requestRecord,
  validThreadId,
} from "./http-request-validation.js";

export function parseCreateAutomationScheduleRequest(
  input: unknown,
): CreateAutomationScheduleRequest | undefined {
  const record = requestRecord(input, [
    "name",
    "threadId",
    "prompt",
    "model",
    "trigger",
    "status",
    "misfirePolicy",
  ]);
  const name = normalizeBoundedText(record?.["name"], 1, 100);
  const prompt = normalizeBoundedPrompt(record?.["prompt"], 20_000);
  const threadId = record?.["threadId"];
  const trigger = parseScheduleTrigger(record?.["trigger"]);
  const model =
    record?.["model"] === undefined
      ? undefined
      : parseModelRef(record["model"]);
  const status = record?.["status"];
  const misfirePolicy = record?.["misfirePolicy"];
  if (
    !record ||
    !name ||
    !prompt ||
    !validThreadId(threadId) ||
    !trigger ||
    (record["model"] !== undefined && !model) ||
    (status !== undefined && status !== "active" && status !== "paused") ||
    (misfirePolicy !== undefined &&
      misfirePolicy !== "run_once" &&
      misfirePolicy !== "skip")
  ) {
    return undefined;
  }
  return {
    name,
    threadId,
    prompt,
    trigger,
    ...(model ? { model } : {}),
    ...(typeof status === "string" ? { status } : {}),
    ...(typeof misfirePolicy === "string" ? { misfirePolicy } : {}),
  };
}

export function parseUpdateAutomationScheduleRequest(
  input: unknown,
): UpdateAutomationScheduleRequest | undefined {
  const record = requestRecord(input, [
    "name",
    "prompt",
    "model",
    "trigger",
    "status",
    "misfirePolicy",
  ]);
  if (!record) return undefined;
  const name = optionalField(record, "name", (value) =>
    normalizeBoundedText(value, 1, 100),
  );
  const prompt = optionalField(record, "prompt", (value) =>
    normalizeBoundedPrompt(value, 20_000),
  );
  const model = optionalField(record, "model", parseModelRef);
  const trigger = optionalField(record, "trigger", parseScheduleTrigger);
  const status = optionalField(record, "status", parseScheduleStatus);
  const misfirePolicy = optionalField(
    record,
    "misfirePolicy",
    parseScheduleMisfirePolicy,
  );
  if (
    [name, prompt, model, trigger, status, misfirePolicy].some(
      (field) => !field.valid,
    )
  ) {
    return undefined;
  }
  const result: UpdateAutomationScheduleRequest = {};
  if (name.value) result.name = name.value;
  if (prompt.value) result.prompt = prompt.value;
  if (model.value) result.model = model.value;
  if (trigger.value) result.trigger = trigger.value;
  if (status.value) result.status = status.value;
  if (misfirePolicy.value) result.misfirePolicy = misfirePolicy.value;
  return result;
}

function optionalField<Value>(
  record: Record<string, unknown>,
  key: string,
  parse: (input: unknown) => Value | undefined,
): { valid: boolean; value?: Value } {
  if (record[key] === undefined) return { valid: true };
  const value = parse(record[key]);
  return value === undefined ? { valid: false } : { valid: true, value };
}

function parseScheduleStatus(
  input: unknown,
): UpdateAutomationScheduleRequest["status"] | undefined {
  return input === "active" || input === "paused" ? input : undefined;
}

function parseScheduleMisfirePolicy(
  input: unknown,
): UpdateAutomationScheduleRequest["misfirePolicy"] | undefined {
  return input === "run_once" || input === "skip" ? input : undefined;
}

function parseScheduleTrigger(
  input: unknown,
): CreateAutomationScheduleRequest["trigger"] | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return undefined;
  }
  const type = (input as Record<string, unknown>)["type"];
  try {
    if (type === "interval") return parseIntervalTrigger(input);
    if (type === "cron") return parseCronTrigger(input);
  } catch {
    return undefined;
  }
  return undefined;
}

function parseIntervalTrigger(
  input: object,
): CreateAutomationScheduleRequest["trigger"] | undefined {
  const record = requestRecord(input, ["type", "everyMs", "anchorAt"]);
  const everyMs = record?.["everyMs"];
  const anchorAt = record?.["anchorAt"];
  if (
    !record ||
    typeof everyMs !== "number" ||
    !Number.isSafeInteger(everyMs) ||
    everyMs < 60_000 ||
    everyMs > 30 * 24 * 60 * 60 * 1_000 ||
    (anchorAt !== undefined &&
      (typeof anchorAt !== "string" ||
        anchorAt.length > 80 ||
        !Number.isFinite(Date.parse(anchorAt))))
  ) {
    return undefined;
  }
  return normalizeScheduleTrigger({
    type: "interval",
    everyMs,
    ...(typeof anchorAt === "string" ? { anchorAt } : {}),
  });
}

function parseCronTrigger(
  input: object,
): CreateAutomationScheduleRequest["trigger"] | undefined {
  const record = requestRecord(input, ["type", "expression", "timezone"]);
  const expression = normalizeBoundedText(record?.["expression"], 1, 120);
  return record && expression && record["timezone"] === "UTC"
    ? normalizeScheduleTrigger({
        type: "cron",
        expression,
        timezone: "UTC",
      })
    : undefined;
}
