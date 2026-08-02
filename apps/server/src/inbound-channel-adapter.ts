import type {
  InboundChannelAdapter,
  InboundChannelAdapterPreview,
  InboundMessageRequest,
} from "@napier/contracts";

import { parseModelRef, requestRecord } from "./http-request-validation.js";
import { sha256Text } from "./http-response-evidence.js";
import {
  buildGitHubWebhookMessage,
  buildLinearWebhookMessage,
  buildSlackEventMessage,
  linearWebhookSeed,
} from "./inbound-channel-adapter-messages.js";

export type InboundMessageParseResult =
  | { ok: true; body: InboundMessageRequest }
  | { ok: false; error: string };

export function parseInboundMessageForAdapter(
  adapter: InboundChannelAdapter,
  source: string,
  headers: Headers,
): InboundMessageParseResult {
  if (adapter === "napier_json") return parseNapierJsonInboundMessage(source);
  if (adapter === "github_webhook") {
    return parseGitHubWebhookInboundMessage(source, headers);
  }
  if (adapter === "slack_event") return parseSlackEventInboundMessage(source);
  if (adapter === "linear_webhook") {
    return parseLinearWebhookInboundMessage(source);
  }
  return { ok: false, error: "Inbound channel adapter is invalid" };
}

export function previewHeaders(
  headers: Record<string, string> | undefined,
): Headers {
  const output = new Headers();
  for (const [key, value] of Object.entries(headers ?? {})) {
    output.set(key, value);
  }
  return output;
}

export function createInboundChannelAdapterPreview(
  channelId: string,
  adapter: InboundChannelAdapter,
  source: string,
  body: InboundMessageRequest,
): InboundChannelAdapterPreview {
  const messagePreview = body.message
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 240);
  const content = {
    channelId,
    adapter,
    bodySha256: sha256Text(source),
    idempotencyFingerprint: sha256Text(
      `${channelId}\0${body.idempotencyKey}`,
    ).slice(0, 12),
    messageSha256: sha256Text(body.message),
    messagePreview,
    ...(body.model ? { model: body.model } : {}),
  };
  return {
    ...content,
    contentSha256: sha256Text(JSON.stringify(content)),
  };
}

function parseNapierJsonInboundMessage(
  source: string,
): InboundMessageParseResult {
  const parsed = parseJsonObject(source);
  if (!parsed.ok) return parsed;
  const record = requestRecord(parsed.record, [
    "idempotencyKey",
    "message",
    "model",
  ]);
  const idempotencyKey = normalizeInboundVisibleText(
    record?.["idempotencyKey"],
    8,
    200,
  );
  const message = normalizeInboundPromptText(record?.["message"], 20_000);
  const model =
    record?.["model"] === undefined
      ? undefined
      : parseModelRef(record["model"]);
  if (
    !record ||
    !idempotencyKey ||
    !message ||
    (record["model"] !== undefined && !model)
  ) {
    return { ok: false, error: "Inbound body is invalid" };
  }
  return {
    ok: true,
    body: {
      idempotencyKey,
      message,
      ...(model ? { model } : {}),
    },
  };
}

function parseGitHubWebhookInboundMessage(
  source: string,
  headers: Headers,
): InboundMessageParseResult {
  const delivery = normalizeInboundVisibleText(
    headers.get("x-github-delivery"),
    1,
    193,
  );
  if (!delivery) {
    return { ok: false, error: "GitHub delivery header is required" };
  }
  const event = normalizeInboundVisibleText(
    headers.get("x-github-event"),
    1,
    80,
  );
  if (!event) {
    return { ok: false, error: "GitHub event header is required" };
  }
  const parsed = parseJsonObject(source);
  if (!parsed.ok) return parsed;
  return {
    ok: true,
    body: {
      idempotencyKey: `github:${delivery}`,
      message: buildGitHubWebhookMessage(event, delivery, parsed.record),
    },
  };
}

function parseSlackEventInboundMessage(
  source: string,
): InboundMessageParseResult {
  const parsed = parseJsonObject(source);
  if (!parsed.ok) return parsed;
  const eventId = normalizeInboundVisibleText(
    parsed.record["event_id"],
    4,
    160,
  );
  if (!eventId) {
    return { ok: false, error: "Slack event_id is required" };
  }
  return {
    ok: true,
    body: {
      idempotencyKey: `slack:${eventId}`,
      message: buildSlackEventMessage(eventId, parsed.record),
    },
  };
}

function parseLinearWebhookInboundMessage(
  source: string,
): InboundMessageParseResult {
  const parsed = parseJsonObject(source);
  if (!parsed.ok) return parsed;
  const seed = linearWebhookSeed(parsed.record);
  if (!seed.ok) return { ok: false, error: seed.error };
  return {
    ok: true,
    body: {
      idempotencyKey: `linear:${sha256Text(seed.value).slice(0, 32)}`,
      message: buildLinearWebhookMessage(seed.value, parsed.record),
    },
  };
}

function parseJsonObject(source: string):
  | {
      ok: true;
      record: Record<string, unknown>;
    }
  | { ok: false; error: string } {
  let input: unknown;
  try {
    input = JSON.parse(source);
  } catch {
    return { ok: false, error: "Inbound body must be valid JSON" };
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "Inbound body must be a JSON object" };
  }
  return { ok: true, record: input as Record<string, unknown> };
}

function normalizeInboundVisibleText(
  input: unknown,
  minLength: number,
  maxLength: number,
): string | undefined {
  if (typeof input !== "string") return undefined;
  const normalized = input.trim();
  if (
    normalized.length < minLength ||
    normalized.length > maxLength ||
    /[\u0000-\u001f\u007f]/u.test(normalized)
  ) {
    return undefined;
  }
  return normalized;
}

function normalizeInboundPromptText(
  input: unknown,
  maxLength: number,
): string | undefined {
  if (typeof input !== "string") return undefined;
  const normalized = input.replace(/\r\n?/gu, "\n").trim();
  return normalized && normalized.length <= maxLength ? normalized : undefined;
}
