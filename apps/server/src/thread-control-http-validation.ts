import type {
  AnswerOperatorDecisionRequest,
  CreateBranchRequest,
  QueueRunControlMessageRequest,
} from "@napier/contracts";
import { MAX_RUN_CONTROL_MESSAGE_BYTES } from "@napier/runtime";

import { requestRecord } from "./http-request-validation.js";

export function parseCreateBranchRequest(
  input: unknown,
): CreateBranchRequest | undefined {
  const record = requestRecord(input, ["fromSeq", "title"]);
  const fromSeq = record?.["fromSeq"];
  const title = record?.["title"];
  const normalizedTitle =
    typeof title === "string" ? title.replace(/\s+/g, " ").trim() : undefined;
  if (
    !record ||
    typeof fromSeq !== "number" ||
    !Number.isSafeInteger(fromSeq) ||
    fromSeq < 1 ||
    (title !== undefined && (!normalizedTitle || normalizedTitle.length > 100))
  ) {
    return undefined;
  }
  return {
    fromSeq,
    ...(normalizedTitle ? { title: normalizedTitle } : {}),
  };
}

export function parseQueueRunControlMessageRequest(
  input: unknown,
): QueueRunControlMessageRequest | undefined {
  const record = requestRecord(input, ["mode", "text"]);
  const mode = record?.["mode"];
  const text =
    typeof record?.["text"] === "string" ? record["text"].trim() : undefined;
  if (
    (mode !== "steering" && mode !== "follow_up") ||
    !text ||
    Buffer.byteLength(text, "utf8") > MAX_RUN_CONTROL_MESSAGE_BYTES
  ) {
    return undefined;
  }
  return { mode, text };
}

export function parseAnswerOperatorDecisionRequest(
  input: unknown,
): AnswerOperatorDecisionRequest | undefined {
  const record = requestRecord(input, ["selectedOptionIds", "customText"]);
  const selectedOptionIds = record?.["selectedOptionIds"];
  const customText =
    typeof record?.["customText"] === "string"
      ? record["customText"].trim()
      : undefined;
  if (
    !Array.isArray(selectedOptionIds) ||
    selectedOptionIds.length > 4 ||
    selectedOptionIds.some(
      (optionId) =>
        typeof optionId !== "string" || !/^option_[1-4]$/u.test(optionId),
    ) ||
    new Set(selectedOptionIds).size !== selectedOptionIds.length ||
    (record?.["customText"] !== undefined &&
      typeof record["customText"] !== "string") ||
    (customText !== undefined &&
      Buffer.byteLength(customText, "utf8") > 4 * 1024) ||
    (selectedOptionIds.length === 0 && !customText)
  ) {
    return undefined;
  }
  return {
    selectedOptionIds,
    ...(customText ? { customText } : {}),
  };
}
