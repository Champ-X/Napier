import type { PromptRequest, ResumeRunRequest } from "@napier/contracts";

import { parseModelRef, requestRecord } from "./http-request-validation.js";

export function parseResumeRunRequest(
  input: unknown,
): ResumeRunRequest | undefined {
  if (input === undefined) return {};
  const record = requestRecord(input, ["runId", "model"]);
  if (!record) return undefined;
  const runId = record["runId"];
  if (
    runId !== undefined &&
    (typeof runId !== "string" || !/^run_[a-z0-9]{8,80}$/u.test(runId))
  ) {
    return undefined;
  }
  const model =
    record["model"] === undefined ? undefined : parseModelRef(record["model"]);
  if (record["model"] !== undefined && !model) return undefined;
  return {
    ...(typeof runId === "string" ? { runId } : {}),
    ...(model ? { model } : {}),
  };
}

export function parsePromptRequest(input: unknown): PromptRequest | undefined {
  const record = requestRecord(input, [
    "text",
    "model",
    "sourceContinuityRunId",
  ]);
  if (!record) return undefined;
  const text = record?.["text"];
  if (
    typeof text !== "string" ||
    text.length < 1 ||
    text.length > 60_000 ||
    !text.trim()
  ) {
    return undefined;
  }
  const model =
    record["model"] === undefined ? undefined : parseModelRef(record["model"]);
  if (record["model"] !== undefined && !model) return undefined;
  const sourceContinuityRunId = record["sourceContinuityRunId"];
  if (
    sourceContinuityRunId !== undefined &&
    (typeof sourceContinuityRunId !== "string" ||
      !/^run_[a-z0-9]{8,80}$/u.test(sourceContinuityRunId))
  ) {
    return undefined;
  }
  return {
    text,
    ...(model ? { model } : {}),
    ...(typeof sourceContinuityRunId === "string"
      ? { sourceContinuityRunId }
      : {}),
  };
}
