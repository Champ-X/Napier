import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  inboundChannelAdapterCatalog,
  inboundChannelAdapterCatalogSha256,
} from "../src/inbound-channel-adapter-catalog.js";
import {
  createInboundChannelAdapterPreview,
  parseInboundMessageForAdapter,
} from "../src/inbound-channel-adapter.js";

const sha256 = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

describe("Inbound Channel adapters", () => {
  it("returns a cloned, hash-bound adapter catalog", () => {
    const first = inboundChannelAdapterCatalog();
    expect(first.map((adapter) => adapter.id)).toEqual([
      "napier_json",
      "github_webhook",
      "slack_event",
      "linear_webhook",
    ]);
    expect(inboundChannelAdapterCatalogSha256()).toMatch(/^[a-f0-9]{64}$/u);
    first[0]!.label = "mutated";
    expect(inboundChannelAdapterCatalog()[0]!.label).toBe("Napier JSON");
  });

  it("normalizes native JSON and model references", () => {
    const parsed = parseInboundMessageForAdapter(
      "napier_json",
      JSON.stringify({
        idempotencyKey: "native-delivery-0001",
        message: " Review this.\r\nPreserve evidence. ",
        model: { provider: " DeepSeek ", id: " deepseek-v4-flash " },
      }),
      new Headers(),
    );
    expect(parsed).toEqual({
      ok: true,
      body: {
        idempotencyKey: "native-delivery-0001",
        message: "Review this.\nPreserve evidence.",
        model: { provider: "deepseek", id: "deepseek-v4-flash" },
      },
    });
  });

  it("normalizes GitHub identity without exposing delivery text in the message", () => {
    const delivery = "delivery-private-0001";
    const headers = new Headers({
      "x-github-delivery": delivery,
      "x-github-event": "pull_request",
    });
    const parsed = parseInboundMessageForAdapter(
      "github_webhook",
      JSON.stringify({
        action: "opened",
        repository: { full_name: "acme/widgets" },
        pull_request: {
          number: 42,
          title: "Evidence boundary",
          html_url: "https://github.example/pull/42",
        },
        sender: { login: "reviewer" },
      }),
      headers,
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.body.idempotencyKey).toBe(`github:${delivery}`);
    expect(parsed.body.message).toContain("GitHub pull_request webhook");
    expect(parsed.body.message).toContain("Repository: acme/widgets.");
    expect(parsed.body.message).toContain(
      `Delivery fingerprint: ${sha256(delivery).slice(0, 12)}.`,
    );
    expect(parsed.body.message).not.toContain(delivery);
  });

  it("normalizes Slack and Linear webhook identities", () => {
    const slack = parseInboundMessageForAdapter(
      "slack_event",
      JSON.stringify({
        type: "event_callback",
        event_id: "Ev0123456789",
        team_id: "T01234567",
        event: {
          type: "message",
          channel: "C01234567",
          user: "U01234567",
          text: "Review evidence.",
        },
      }),
      new Headers(),
    );
    expect(slack.ok && slack.body.idempotencyKey).toBe("slack:Ev0123456789");
    expect(slack.ok && slack.body.message).toContain("Slack message webhook");

    const linear = parseInboundMessageForAdapter(
      "linear_webhook",
      JSON.stringify({
        webhookId: "wh_0123456789",
        createdAt: "2026-08-03T00:00:00.000Z",
        type: "Issue",
        action: "update",
        data: { id: 42, identifier: "NAP-42", title: "Evidence boundary" },
      }),
      new Headers(),
    );
    expect(linear.ok && linear.body.idempotencyKey).toMatch(
      /^linear:[a-f0-9]{32}$/u,
    );
    expect(linear.ok && linear.body.message).toContain(
      'Subject: NAP-42 "Evidence boundary"',
    );
  });

  it("creates a body-free, hash-bound adapter preview", () => {
    const source = JSON.stringify({
      idempotencyKey: "native-delivery-0001",
      message: "Private preview message.",
    });
    const parsed = parseInboundMessageForAdapter(
      "napier_json",
      source,
      new Headers(),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const preview = createInboundChannelAdapterPreview(
      "channel_0123456789abcdef",
      "napier_json",
      source,
      parsed.body,
    );
    const { contentSha256, ...content } = preview;
    expect(contentSha256).toBe(sha256(JSON.stringify(content)));
    expect(preview.bodySha256).toBe(sha256(source));
    expect(preview.messageSha256).toBe(sha256(parsed.body.message));
    expect(JSON.stringify(preview)).not.toContain("native-delivery-0001");
  });
});
