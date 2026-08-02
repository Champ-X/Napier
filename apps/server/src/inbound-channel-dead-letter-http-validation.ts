import type {
  ApplyInboundDeadLetterRetryRequest,
  PreviewInboundDeadLetterRetryRequest,
  VerifyInboundDeadLetterExportRequest,
  VerifyInboundDeadLetterRetryHistoryRequest,
} from "@napier/contracts";

import { requestRecord } from "./http-request-validation.js";

export function parseVerifyInboundDeadLetterExportRequest(
  input: unknown,
): VerifyInboundDeadLetterExportRequest | undefined {
  const record = requestRecord(input, ["artifact"]);
  return record && record["artifact"] !== undefined
    ? { artifact: record["artifact"] }
    : undefined;
}

export function parseVerifyInboundDeadLetterRetryHistoryRequest(
  input: unknown,
): VerifyInboundDeadLetterRetryHistoryRequest | undefined {
  const record = requestRecord(input, ["history"]);
  return record && record["history"] !== undefined
    ? { history: record["history"] }
    : undefined;
}

export function parsePreviewInboundDeadLetterRetryRequest(
  input: unknown,
): PreviewInboundDeadLetterRetryRequest | undefined {
  const record = requestRecord(input, ["artifact"]);
  return record && record["artifact"] !== undefined
    ? { artifact: record["artifact"] }
    : undefined;
}

export function parseApplyInboundDeadLetterRetryRequest(
  input: unknown,
): ApplyInboundDeadLetterRetryRequest | undefined {
  const record = requestRecord(input, [
    "artifact",
    "expectedPreviewSha256",
    "confirmReplay",
  ]);
  const expectedPreviewSha256 = record?.["expectedPreviewSha256"];
  const confirmReplay = record?.["confirmReplay"];
  if (
    !record ||
    record["artifact"] === undefined ||
    typeof expectedPreviewSha256 !== "string" ||
    !/^[a-f0-9]{64}$/u.test(expectedPreviewSha256) ||
    typeof confirmReplay !== "boolean"
  ) {
    return undefined;
  }
  return {
    artifact: record["artifact"],
    expectedPreviewSha256,
    confirmReplay,
  };
}
