import type {
  InboundChannelAdapter,
  InboundMessageRequest,
} from "@napier/contracts";
import {
  type ChannelService,
  type LocalStore,
  type ModelRegistry,
} from "@napier/runtime";
import { Hono } from "hono";

import {
  errorMessage,
  jsonError,
  sha256Text,
} from "./http-response-evidence.js";
import {
  inboundChannelAdapterCatalogSha256,
  MAX_INBOUND_BODY_BYTES,
} from "./inbound-channel-adapter-catalog.js";
import { parseInboundMessageForAdapter } from "./inbound-channel-adapter.js";
import {
  inboundChannelToken,
  validInboundSignature,
} from "./inbound-channel-auth.js";
import { setInboundReceiptHeaders } from "./inbound-channel-delivery-http-response.js";
import { assertAvailableModel } from "./model-http-availability.js";

type InboundChannelIngressHttpStore = Pick<LocalStore, "getInboundChannel">;

export interface InboundChannelIngressHttpServices {
  store: InboundChannelIngressHttpStore;
  models: Pick<ModelRegistry, "resolveConfigured">;
  channels: Pick<ChannelService, "accept">;
}

export function registerInboundChannelIngressHttp(
  app: Hono,
  services: InboundChannelIngressHttpServices,
): void {
  app.post("/api/channels/:channelId/inbound", async (context) => {
    const declaredLength = Number.parseInt(
      context.req.header("content-length") ?? "0",
      10,
    );
    if (
      Number.isFinite(declaredLength) &&
      declaredLength > MAX_INBOUND_BODY_BYTES
    ) {
      return jsonError(context, "Inbound body is too large", 413);
    }
    const source = await context.req.text();
    if (Buffer.byteLength(source) > MAX_INBOUND_BODY_BYTES) {
      return jsonError(context, "Inbound body is too large", 413);
    }
    const token = inboundChannelToken(context.req.raw.headers);
    if (!token) {
      return jsonError(context, "Inbound channel token is required", 401);
    }
    let channelAdapter: InboundChannelAdapter;
    try {
      const channel = services.store.getInboundChannel(
        context.req.param("channelId"),
      );
      channelAdapter = channel.adapter;
      if (
        channel.signaturePolicy.required &&
        !validInboundSignature(
          context.req.raw.headers,
          source,
          token,
          channel.signaturePolicy.toleranceSeconds,
        )
      ) {
        return jsonError(context, "Inbound channel signature is invalid", 401);
      }
    } catch {
      return jsonError(context, "Inbound channel token is invalid", 401);
    }
    const parsed = parseInboundMessageForAdapter(
      channelAdapter,
      source,
      context.req.raw.headers,
    );
    if (!parsed.ok) {
      return jsonError(context, parsed.error, 400);
    }
    const body: InboundMessageRequest = {
      ...parsed.body,
      bodySha256: sha256Text(source),
      adapterCatalogSha256: inboundChannelAdapterCatalogSha256(),
    };
    if (body.model) {
      try {
        await assertAvailableModel(services, body.model);
      } catch (error) {
        return jsonError(context, errorMessage(error), 400);
      }
    }
    try {
      const receipt = await services.channels.accept(
        context.req.param("channelId"),
        token,
        body,
      );
      setInboundReceiptHeaders(context, receipt);
      return context.json(receipt, receipt.duplicate ? 200 : 202);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        message.includes("channel token") ||
        message.includes("Inbound channel not found")
      ) {
        return jsonError(context, "Inbound channel token is invalid", 401);
      }
      if (message.includes("channel is disabled")) {
        return jsonError(context, message, 409);
      }
      if (isInboundMessageValidationError(error)) {
        return jsonError(context, message, 400);
      }
      throw error;
    }
  });
}

function isInboundMessageValidationError(error: unknown): error is Error {
  return (
    error instanceof Error &&
    (error.message.startsWith("Inbound idempotency ") ||
      error.message.startsWith("Inbound message ") ||
      error.message.startsWith("Inbound model "))
  );
}
