import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  inboundChannelToken,
  validInboundSignature,
} from "../src/inbound-channel-auth.js";

const TOKEN = "a".repeat(48);

describe("Inbound Channel authentication", () => {
  it("accepts exact bearer and direct token forms", () => {
    expect(
      inboundChannelToken(new Headers({ authorization: `Bearer ${TOKEN}` })),
    ).toBe(TOKEN);
    expect(
      inboundChannelToken(new Headers({ "x-napier-channel-token": TOKEN })),
    ).toBe(TOKEN);
    expect(
      inboundChannelToken(new Headers({ authorization: `Basic ${TOKEN}` })),
    ).toBeUndefined();
    expect(
      inboundChannelToken(new Headers({ "x-napier-channel-token": "short" })),
    ).toBeUndefined();
  });

  it("validates a fresh body-bound HMAC", () => {
    const body = '{"message":"bound"}';
    const timestamp = new Date().toISOString();
    const signature = createHmac("sha256", TOKEN)
      .update(`${timestamp}\n${body}`)
      .digest("hex");
    const headers = new Headers({
      "x-napier-channel-timestamp": timestamp,
      "x-napier-channel-signature": `sha256=${signature}`,
    });
    expect(validInboundSignature(headers, body, TOKEN, 60)).toBe(true);
    expect(validInboundSignature(headers, `${body} `, TOKEN, 60)).toBe(false);
  });

  it("rejects expired, malformed, and wrong-token signatures", () => {
    const body = "{}";
    const timestamp = new Date(Date.now() - 120_000).toISOString();
    const signature = createHmac("sha256", TOKEN)
      .update(`${timestamp}\n${body}`)
      .digest("hex");
    expect(
      validInboundSignature(
        new Headers({
          "x-napier-channel-timestamp": timestamp,
          "x-napier-channel-signature": signature,
        }),
        body,
        TOKEN,
        30,
      ),
    ).toBe(false);
    expect(
      validInboundSignature(
        new Headers({
          "x-napier-channel-timestamp": new Date().toISOString(),
          "x-napier-channel-signature": "invalid",
        }),
        body,
        TOKEN,
        60,
      ),
    ).toBe(false);
  });
});
