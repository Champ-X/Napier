import { describe, expect, it } from "vitest";

import {
  parseCreateInboundChannelRequest,
  parsePreviewInboundChannelAdapterRequest,
  parseSetInboundChannelStatusRequest,
  parseUpdateInboundRetryPolicyRequest,
  parseUpdateInboundSignaturePolicyRequest,
} from "../src/inbound-channel-admin-http-validation.js";

const THREAD_ID = "thread_0123456789abcdef";

describe("Inbound Channel admin HTTP validation", () => {
  it("normalizes a complete custom channel request", () => {
    expect(
      parseCreateInboundChannelRequest({
        name: "  Signed   GitHub ",
        threadId: THREAD_ID,
        adapter: "github_webhook",
        policyTemplate: "custom",
        retryPolicy: { maxAttempts: 4, baseDelayMs: 2_000 },
        signaturePolicy: { required: true, toleranceSeconds: 120 },
      }),
    ).toEqual({
      name: "Signed GitHub",
      threadId: THREAD_ID,
      adapter: "github_webhook",
      policyTemplate: "custom",
      retryPolicy: { maxAttempts: 4, baseDelayMs: 2_000 },
      signaturePolicy: { required: true, toleranceSeconds: 120 },
    });
  });

  it("enforces policy-template override combinations", () => {
    expect(
      parseCreateInboundChannelRequest({
        name: "Strict",
        threadId: THREAD_ID,
        policyTemplate: "signed_strict",
        retryPolicy: { maxAttempts: 3, baseDelayMs: 1_000 },
      }),
    ).toBeUndefined();
    expect(
      parseCreateInboundChannelRequest({
        name: "Empty custom",
        threadId: THREAD_ID,
        policyTemplate: "custom",
      }),
    ).toBeUndefined();
    expect(
      parseCreateInboundChannelRequest({
        name: "Legacy",
        threadId: THREAD_ID,
        policyTemplate: "legacy_bearer",
      }),
    ).toEqual({
      name: "Legacy",
      threadId: THREAD_ID,
      policyTemplate: "legacy_bearer",
    });
  });

  it("rejects unknown fields and bounded policy violations", () => {
    expect(
      parseCreateInboundChannelRequest({
        name: "Unknown",
        threadId: THREAD_ID,
        unexpected: true,
      }),
    ).toBeUndefined();
    expect(
      parseUpdateInboundRetryPolicyRequest({
        retryPolicy: { maxAttempts: 11, baseDelayMs: 1_000 },
      }),
    ).toBeUndefined();
    expect(
      parseUpdateInboundSignaturePolicyRequest({
        signaturePolicy: { required: true, toleranceSeconds: 29 },
      }),
    ).toBeUndefined();
    expect(
      parseSetInboundChannelStatusRequest({ status: "paused" }),
    ).toBeUndefined();
  });

  it("normalizes safe preview headers and rejects injection", () => {
    expect(
      parsePreviewInboundChannelAdapterRequest({
        body: "{}",
        headers: {
          " X-GitHub-Event ": " pull_request ",
          "X-GitHub-Delivery": "delivery-1",
        },
      }),
    ).toEqual({
      body: "{}",
      headers: {
        "x-github-event": "pull_request",
        "x-github-delivery": "delivery-1",
      },
    });
    expect(
      parsePreviewInboundChannelAdapterRequest({
        body: "{}",
        headers: { "x-github-event": "pull_request\r\ninjected" },
      }),
    ).toBeUndefined();
  });
});
