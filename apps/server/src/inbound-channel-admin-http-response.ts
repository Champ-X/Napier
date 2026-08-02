import type {
  InboundChannel,
  InboundChannelAdapterDescriptor,
  InboundChannelAdapterPreview,
} from "@napier/contracts";
import type { Context } from "hono";

import {
  setContentSha256Header,
  setStableContentSha256Header,
  sha256Text,
} from "./http-response-evidence.js";
import {
  inboundChannelAdapterCatalogSha256,
  inboundChannelAdapterIdsSha256,
} from "./inbound-channel-adapter-catalog.js";

export function setInboundChannelProjectionHeaders(
  context: Context,
  channel: InboundChannel,
  options: { includeContentSha256?: boolean } = {},
): void {
  const channelSha256 = sha256Text(JSON.stringify(channel));
  context.header("Cache-Control", "no-store");
  context.header("X-Napier-Channel-SHA256", channelSha256);
  if (options.includeContentSha256) {
    setContentSha256Header(context, channelSha256, "body");
  }
  context.header("X-Napier-Channel-Status", channel.status);
  context.header("X-Napier-Channel-Revision", String(channel.revision));
  context.header("X-Napier-Token-Fingerprint", channel.tokenFingerprint);
  context.header("X-Napier-Policy-Template", channel.policyTemplate);
}

export function inboundChannelListSha256(
  channels: readonly InboundChannel[],
): string {
  return sha256Text(JSON.stringify(channels));
}

export function setInboundChannelListHeaders(
  context: Context,
  channels: readonly InboundChannel[],
): void {
  const channelListSha256 = inboundChannelListSha256(channels);
  context.header("Cache-Control", "no-store");
  setContentSha256Header(context, channelListSha256, "body");
  context.header("X-Napier-Channel-List-SHA256", channelListSha256);
  setInboundChannelCountHeaders(context, channels);
}

export function setInboundChannelCountHeaders(
  context: Context,
  channels: readonly InboundChannel[],
): void {
  context.header("X-Napier-Channel-Count", String(channels.length));
  context.header(
    "X-Napier-Active-Channel-Count",
    String(channels.filter((channel) => channel.status === "active").length),
  );
  context.header(
    "X-Napier-Disabled-Channel-Count",
    String(channels.filter((channel) => channel.status === "disabled").length),
  );
}

export function setInboundChannelAdapterPreviewHeaders(
  context: Context,
  preview: InboundChannelAdapterPreview,
): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, preview.contentSha256);
  context.header("X-Napier-Channel-Id", preview.channelId);
  context.header("X-Napier-Adapter", preview.adapter);
  context.header("X-Napier-Body-SHA256", preview.bodySha256);
  context.header(
    "X-Napier-Idempotency-Fingerprint",
    preview.idempotencyFingerprint,
  );
  context.header("X-Napier-Message-SHA256", preview.messageSha256);
}

export function setInboundChannelAdapterCatalogHeaders(
  context: Context,
  adapters: readonly InboundChannelAdapterDescriptor[],
): void {
  const catalogSha256 = inboundChannelAdapterCatalogSha256();
  context.header("Cache-Control", "no-store");
  setContentSha256Header(context, catalogSha256, "body");
  context.header("X-Napier-Adapter-Catalog-SHA256", catalogSha256);
  context.header("X-Napier-Adapter-Count", String(adapters.length));
  context.header(
    "X-Napier-Adapter-Ids-SHA256",
    inboundChannelAdapterIdsSha256(adapters),
  );
}
