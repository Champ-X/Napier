import { type LocalStore } from "@napier/runtime/store";
import { type ModelRegistry } from "@napier/runtime/model";
import { Hono } from "hono";

import { errorMessage, jsonError } from "./http-response-evidence.js";
import {
  readLimitedJson,
  RequestBodyTooLargeError,
} from "./http-request-body.js";
import {
  parseCreateInboundChannelRequest,
  parsePreviewInboundChannelAdapterRequest,
  parseSetInboundChannelStatusRequest,
  parseUpdateInboundRetryPolicyRequest,
  parseUpdateInboundSignaturePolicyRequest,
} from "./inbound-channel-admin-http-validation.js";
import {
  setInboundChannelAdapterCatalogHeaders,
  setInboundChannelAdapterPreviewHeaders,
  setInboundChannelListHeaders,
  setInboundChannelProjectionHeaders,
} from "./inbound-channel-admin-http-response.js";
import {
  inboundChannelAdapterCatalog,
  MAX_INBOUND_BODY_BYTES,
} from "./inbound-channel-adapter-catalog.js";
import {
  createInboundChannelAdapterPreview,
  parseInboundMessageForAdapter,
  previewHeaders,
} from "./inbound-channel-adapter.js";
import { appendInboundChannelEvent } from "./inbound-channel-event.js";
import { assertAvailableModel } from "./model-http-availability.js";

const MAX_CHANNEL_ADMIN_REQUEST_BYTES = 8 * 1024;
const MAX_CHANNEL_ADAPTER_PREVIEW_REQUEST_BYTES =
  MAX_INBOUND_BODY_BYTES + 8 * 1024;

type InboundChannelAdminHttpStore = Pick<
  LocalStore,
  | "appendEvent"
  | "createInboundChannel"
  | "getInboundChannel"
  | "listInboundChannels"
  | "rotateInboundChannelToken"
  | "setInboundChannelStatus"
  | "updateInboundRetryPolicy"
  | "updateInboundSignaturePolicy"
>;

export interface InboundChannelAdminHttpServices {
  store: InboundChannelAdminHttpStore;
  models: Pick<ModelRegistry, "resolveConfigured">;
}

export function registerInboundChannelAdminHttp(
  app: Hono,
  services: InboundChannelAdminHttpServices,
): void {
  app.get("/api/channels", (context) => {
    const channels = services.store.listInboundChannels();
    setInboundChannelListHeaders(context, channels);
    return context.json(channels);
  });

  app.get("/api/channels/adapters", (context) => {
    const catalog = inboundChannelAdapterCatalog();
    setInboundChannelAdapterCatalogHeaders(context, catalog);
    return context.json(catalog);
  });

  app.post("/api/channels", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(
        context.req.raw,
        MAX_CHANNEL_ADMIN_REQUEST_BYTES,
        "Inbound channel request",
      );
    } catch (error) {
      return jsonError(
        context,
        errorMessage(error),
        error instanceof RequestBodyTooLargeError ? 413 : 400,
      );
    }
    const body = parseCreateInboundChannelRequest(input);
    if (!body) {
      return jsonError(context, "Inbound channel request is invalid", 400);
    }
    let created;
    try {
      created = await services.store.createInboundChannel(body);
    } catch (error) {
      if (
        isInboundRetryPolicyError(error) ||
        isInboundSignaturePolicyError(error) ||
        isInboundChannelPolicyTemplateError(error)
      ) {
        return jsonError(context, error.message, 400);
      }
      throw error;
    }
    await appendInboundChannelEvent(
      services.store,
      created.channel.threadId,
      "channel.created",
      {
        channelId: created.channel.id,
        name: created.channel.name,
        type: created.channel.type,
        adapter: created.channel.adapter,
        status: created.channel.status,
        tokenFingerprint: created.channel.tokenFingerprint,
        policyTemplate: created.channel.policyTemplate,
        signatureRequired: created.channel.signaturePolicy.required,
        signatureAlgorithm: created.channel.signaturePolicy.algorithm,
        signatureToleranceSeconds:
          created.channel.signaturePolicy.toleranceSeconds,
        retryMaxAttempts: created.channel.retryPolicy.maxAttempts,
        retryBaseDelayMs: created.channel.retryPolicy.baseDelayMs,
        revision: created.channel.revision,
      },
    );
    setInboundChannelProjectionHeaders(context, created.channel);
    return context.json(created, 201);
  });

  app.post("/api/channels/:channelId/status", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(
        context.req.raw,
        MAX_CHANNEL_ADMIN_REQUEST_BYTES,
        "Inbound channel status request",
      );
    } catch (error) {
      return jsonError(
        context,
        errorMessage(error),
        error instanceof RequestBodyTooLargeError ? 413 : 400,
      );
    }
    const body = parseSetInboundChannelStatusRequest(input);
    if (!body) {
      return jsonError(
        context,
        "Inbound channel status request is invalid",
        400,
      );
    }
    const channelId = context.req.param("channelId");
    const before = services.store.getInboundChannel(channelId);
    const channel = await services.store.setInboundChannelStatus(
      channelId,
      body.status,
    );
    if (channel.revision !== before.revision) {
      await appendInboundChannelEvent(
        services.store,
        channel.threadId,
        body.status === "active" ? "channel.enabled" : "channel.disabled",
        {
          channelId: channel.id,
          status: channel.status,
          revision: channel.revision,
        },
      );
    }
    setInboundChannelProjectionHeaders(context, channel, {
      includeContentSha256: true,
    });
    return context.json(channel);
  });

  app.put("/api/channels/:channelId/retry-policy", async (context) => {
    const channelId = context.req.param("channelId");
    let input: unknown;
    try {
      input = await readLimitedJson(
        context.req.raw,
        MAX_CHANNEL_ADMIN_REQUEST_BYTES,
        "Inbound retry policy request",
      );
    } catch (error) {
      return jsonError(
        context,
        errorMessage(error),
        error instanceof RequestBodyTooLargeError ? 413 : 400,
      );
    }
    const body = parseUpdateInboundRetryPolicyRequest(input);
    if (!body) {
      return jsonError(context, "Inbound retry policy request is invalid", 400);
    }
    const before = services.store.getInboundChannel(channelId);
    let channel;
    try {
      channel = await services.store.updateInboundRetryPolicy(
        channelId,
        body.retryPolicy,
      );
    } catch (error) {
      if (isInboundRetryPolicyError(error)) {
        return jsonError(context, error.message, 400);
      }
      throw error;
    }
    if (channel.revision !== before.revision) {
      await appendInboundChannelEvent(
        services.store,
        channel.threadId,
        "channel.retry_policy.updated",
        {
          channelId: channel.id,
          previousMaxAttempts: before.retryPolicy.maxAttempts,
          previousBaseDelayMs: before.retryPolicy.baseDelayMs,
          maxAttempts: channel.retryPolicy.maxAttempts,
          baseDelayMs: channel.retryPolicy.baseDelayMs,
          revision: channel.revision,
        },
      );
    }
    setInboundChannelProjectionHeaders(context, channel, {
      includeContentSha256: true,
    });
    return context.json(channel);
  });

  app.put("/api/channels/:channelId/signature-policy", async (context) => {
    const channelId = context.req.param("channelId");
    let input: unknown;
    try {
      input = await readLimitedJson(
        context.req.raw,
        MAX_CHANNEL_ADMIN_REQUEST_BYTES,
        "Inbound signature policy request",
      );
    } catch (error) {
      return jsonError(
        context,
        errorMessage(error),
        error instanceof RequestBodyTooLargeError ? 413 : 400,
      );
    }
    const body = parseUpdateInboundSignaturePolicyRequest(input);
    if (!body) {
      return jsonError(
        context,
        "Inbound signature policy request is invalid",
        400,
      );
    }
    const before = services.store.getInboundChannel(channelId);
    let channel;
    try {
      channel = await services.store.updateInboundSignaturePolicy(
        channelId,
        body.signaturePolicy,
      );
    } catch (error) {
      if (isInboundSignaturePolicyError(error)) {
        return jsonError(context, error.message, 400);
      }
      throw error;
    }
    if (channel.revision !== before.revision) {
      await appendInboundChannelEvent(
        services.store,
        channel.threadId,
        "channel.signature_policy.updated",
        {
          channelId: channel.id,
          previousRequired: before.signaturePolicy.required,
          previousToleranceSeconds: before.signaturePolicy.toleranceSeconds,
          required: channel.signaturePolicy.required,
          toleranceSeconds: channel.signaturePolicy.toleranceSeconds,
          algorithm: channel.signaturePolicy.algorithm,
          revision: channel.revision,
        },
      );
    }
    setInboundChannelProjectionHeaders(context, channel, {
      includeContentSha256: true,
    });
    return context.json(channel);
  });

  app.post("/api/channels/:channelId/token", async (context) => {
    const channelId = context.req.param("channelId");
    const before = services.store.getInboundChannel(channelId);
    const rotated = await services.store.rotateInboundChannelToken(channelId);
    await appendInboundChannelEvent(
      services.store,
      rotated.channel.threadId,
      "channel.token.rotated",
      {
        channelId: rotated.channel.id,
        previousTokenFingerprint: before.tokenFingerprint,
        tokenFingerprint: rotated.channel.tokenFingerprint,
        status: rotated.channel.status,
        revision: rotated.channel.revision,
      },
    );
    setInboundChannelProjectionHeaders(context, rotated.channel);
    return context.json(rotated);
  });

  app.post("/api/channels/:channelId/adapter-preview", async (context) => {
    const channelId = context.req.param("channelId");
    let input: unknown;
    try {
      input = await readLimitedJson(
        context.req.raw,
        MAX_CHANNEL_ADAPTER_PREVIEW_REQUEST_BYTES,
        "Inbound adapter preview request",
      );
    } catch (error) {
      return jsonError(
        context,
        errorMessage(error),
        error instanceof RequestBodyTooLargeError ? 413 : 400,
      );
    }
    const body = parsePreviewInboundChannelAdapterRequest(input);
    if (!body) {
      return jsonError(
        context,
        "Inbound adapter preview request is invalid",
        400,
      );
    }
    let channel;
    try {
      channel = services.store.getInboundChannel(channelId);
    } catch {
      return jsonError(context, "Inbound channel not found", 404);
    }
    const parsed = parseInboundMessageForAdapter(
      channel.adapter,
      body.body,
      previewHeaders(body.headers),
    );
    if (!parsed.ok) {
      return jsonError(context, parsed.error, 400);
    }
    if (parsed.body.model) {
      try {
        await assertAvailableModel(services, parsed.body.model);
      } catch (error) {
        return jsonError(context, errorMessage(error), 400);
      }
    }
    const preview = createInboundChannelAdapterPreview(
      channel.id,
      channel.adapter,
      body.body,
      parsed.body,
    );
    setInboundChannelAdapterPreviewHeaders(context, preview);
    return context.json(preview);
  });
}

function isInboundRetryPolicyError(error: unknown): error is Error {
  return error instanceof Error && error.message.startsWith("Inbound retry ");
}

function isInboundSignaturePolicyError(error: unknown): error is Error {
  return (
    error instanceof Error && error.message.startsWith("Inbound signature ")
  );
}

function isInboundChannelPolicyTemplateError(error: unknown): error is Error {
  return (
    error instanceof Error &&
    error.message.startsWith("Inbound channel policy template")
  );
}
