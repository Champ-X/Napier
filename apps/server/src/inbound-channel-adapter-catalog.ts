import type {
  InboundChannelAdapter,
  InboundChannelAdapterDescriptor,
} from "@napier/contracts";

import { sha256Json, sha256Text } from "./http-response-evidence.js";

export const MAX_INBOUND_BODY_BYTES = 64 * 1024;

const INBOUND_CHANNEL_ADAPTERS: readonly InboundChannelAdapterDescriptor[] = [
  {
    id: "napier_json",
    label: "Napier JSON",
    description:
      "Native Napier delivery payload with explicit idempotency key and Agent message.",
    idempotencySource: "body.idempotencyKey",
    requiredHeaders: [],
    sampleHeaders: {},
    sampleBody: JSON.stringify(
      {
        idempotencyKey: "preview-delivery-0001",
        message: "Review this preview delivery without accepting it.",
      },
      null,
      2,
    ),
    securityNote:
      "The channel bearer token and optional Napier HMAC signature still authorize real inbound delivery.",
  },
  {
    id: "github_webhook",
    label: "GitHub webhook",
    description:
      "GitHub webhook payload normalized into repository/action/subject work for the Agent.",
    idempotencySource: "X-GitHub-Delivery",
    requiredHeaders: ["x-github-delivery", "x-github-event"],
    sampleHeaders: {
      "x-github-delivery": "preview-delivery-0001",
      "x-github-event": "pull_request",
    },
    sampleBody: JSON.stringify(
      {
        action: "opened",
        repository: { full_name: "acme/widgets" },
        pull_request: {
          number: 42,
          title: "Preview adapter mapping",
          html_url: "https://github.com/acme/widgets/pull/42",
        },
        sender: { login: "octocat" },
      },
      null,
      2,
    ),
    securityNote:
      "GitHub delivery IDs are used only as hashed idempotency material; public evidence exposes a short fingerprint.",
  },
  {
    id: "slack_event",
    label: "Slack events",
    description:
      "Slack Events API callback normalized into team/app/channel/user event work.",
    idempotencySource: "body.event_id",
    requiredHeaders: [],
    sampleHeaders: {},
    sampleBody: JSON.stringify(
      {
        token: "redacted-verification-token",
        team_id: "T01234567",
        api_app_id: "A01234567",
        type: "event_callback",
        event_id: "Ev0123456789",
        event_time: 1_785_000_000,
        event: {
          type: "message",
          channel: "C01234567",
          user: "U01234567",
          text: "Preview this Slack event without accepting it.",
          event_ts: "1785000000.000000",
        },
      },
      null,
      2,
    ),
    securityNote:
      "Slack event IDs are used only as hashed idempotency material; public evidence exposes a short fingerprint.",
  },
  {
    id: "linear_webhook",
    label: "Linear webhook",
    description:
      "Linear entity-change webhook normalized into issue, project, state, and assignee work.",
    idempotencySource:
      "hash(webhookId, createdAt/webhookTimestamp, type, action, data.id)",
    requiredHeaders: [],
    sampleHeaders: {},
    sampleBody: JSON.stringify(
      {
        action: "update",
        type: "Issue",
        webhookId: "wh_0123456789",
        createdAt: "2026-07-25T21:00:00.000Z",
        organizationId: "org_0123456789",
        data: {
          id: "issue_0123456789",
          identifier: "NAP-42",
          title: "Preview Linear webhook mapping",
          url: "https://linear.app/acme/issue/NAP-42",
          state: { name: "In Progress" },
          assignee: { name: "Ada Lovelace" },
          team: { key: "NAP", name: "Napier" },
          project: { name: "Agent operations" },
        },
      },
      null,
      2,
    ),
    securityNote:
      "Linear webhook identity is hashed before idempotency storage; public evidence exposes a short fingerprint.",
  },
];

export function inboundChannelAdapterCatalog(): InboundChannelAdapterDescriptor[] {
  return INBOUND_CHANNEL_ADAPTERS.map((adapter) => structuredClone(adapter));
}

export function inboundChannelAdapterCatalogSha256(): string {
  return sha256Text(JSON.stringify(INBOUND_CHANNEL_ADAPTERS));
}

export function inboundChannelAdapterIdsSha256(
  adapters: readonly InboundChannelAdapterDescriptor[],
): string {
  return sha256Json(adapters.map((adapter) => adapter.id).sort());
}

export function parseInboundChannelAdapter(
  input: unknown,
): InboundChannelAdapter | undefined {
  return typeof input === "string" &&
    INBOUND_CHANNEL_ADAPTERS.some((adapter) => adapter.id === input)
    ? (input as InboundChannelAdapter)
    : undefined;
}
