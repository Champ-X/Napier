import { describe, expect, it } from "vitest";

import {
  parseApplyInboundDeadLetterRetryRequest,
  parsePreviewInboundDeadLetterRetryRequest,
  parseVerifyInboundDeadLetterExportRequest,
  parseVerifyInboundDeadLetterRetryHistoryRequest,
} from "../src/inbound-channel-dead-letter-http-validation.js";

describe("Inbound Channel dead-letter HTTP validation", () => {
  it("accepts exact artifact and history envelopes", () => {
    const artifact = { kind: "dead-letter-export" };
    const history = { kind: "retry-history" };
    expect(parseVerifyInboundDeadLetterExportRequest({ artifact })).toEqual({
      artifact,
    });
    expect(parsePreviewInboundDeadLetterRetryRequest({ artifact })).toEqual({
      artifact,
    });
    expect(
      parseVerifyInboundDeadLetterRetryHistoryRequest({ history }),
    ).toEqual({ history });
  });

  it("binds apply confirmation to an exact preview hash", () => {
    const artifact = { kind: "dead-letter-export" };
    expect(
      parseApplyInboundDeadLetterRetryRequest({
        artifact,
        expectedPreviewSha256: "a".repeat(64),
        confirmReplay: true,
      }),
    ).toEqual({
      artifact,
      expectedPreviewSha256: "a".repeat(64),
      confirmReplay: true,
    });
  });

  it("rejects missing, extended, or malformed envelopes", () => {
    expect(parseVerifyInboundDeadLetterExportRequest({})).toBeUndefined();
    expect(
      parsePreviewInboundDeadLetterRetryRequest({
        artifact: {},
        unexpected: true,
      }),
    ).toBeUndefined();
    expect(
      parseApplyInboundDeadLetterRetryRequest({
        artifact: {},
        expectedPreviewSha256: "short",
        confirmReplay: true,
      }),
    ).toBeUndefined();
    expect(
      parseApplyInboundDeadLetterRetryRequest({
        artifact: {},
        expectedPreviewSha256: "a".repeat(64),
        confirmReplay: "yes",
      }),
    ).toBeUndefined();
  });
});
