import {
  type ChannelService,
  createInboundDeadLetterRetryHistory,
  type LocalStore,
  verifyInboundDeadLetterExportArtifact,
  verifyInboundDeadLetterRetryHistory,
} from "@napier/runtime";
import { Hono } from "hono";

import { errorMessage, jsonError } from "./http-response-evidence.js";
import {
  readLimitedJson,
  RequestBodyTooLargeError,
} from "./http-request-body.js";
import { inboundChannelAdapterCatalogSha256 } from "./inbound-channel-adapter-catalog.js";
import {
  setInboundDeadLetterExportHeaders,
  setInboundDeadLetterExportVerificationHeaders,
  setInboundDeadLetterRetryApplyResultHeaders,
  setInboundDeadLetterRetryHistoryHeaders,
  setInboundDeadLetterRetryHistoryVerificationHeaders,
  setInboundDeadLetterRetryPreviewHeaders,
} from "./inbound-channel-dead-letter-http-response.js";
import {
  parseApplyInboundDeadLetterRetryRequest,
  parsePreviewInboundDeadLetterRetryRequest,
  parseVerifyInboundDeadLetterExportRequest,
  parseVerifyInboundDeadLetterRetryHistoryRequest,
} from "./inbound-channel-dead-letter-http-validation.js";
import { appendInboundChannelEvent } from "./inbound-channel-event.js";
import { inboundDeadLetterQualificationSummary } from "./inbound-channel-qualification.js";

const MAX_DEAD_LETTER_EXPORT_VERIFY_REQUEST_BYTES = 2 * 1024 * 1024;

type InboundChannelDeadLetterHttpStore = Pick<
  LocalStore,
  | "appendEvent"
  | "exportInboundDeadLetters"
  | "getInboundChannel"
  | "listEvents"
>;

export interface InboundChannelDeadLetterHttpServices {
  store: InboundChannelDeadLetterHttpStore;
  channels: Pick<ChannelService, "previewDeadLetterRetry" | "retryDeadLetters">;
}

export function registerInboundChannelDeadLetterHttp(
  app: Hono,
  services: InboundChannelDeadLetterHttpServices,
): void {
  app.post("/api/channels/:channelId/dead-letters/export", async (context) => {
    const artifact = services.store.exportInboundDeadLetters(
      context.req.param("channelId"),
      new Date(),
      inboundChannelAdapterCatalogSha256(),
    );
    const qualificationSummary =
      inboundDeadLetterQualificationSummary(artifact);
    await appendInboundChannelEvent(
      services.store,
      artifact.channel.threadId,
      "channel.dead_letters.exported",
      {
        channelId: artifact.channel.id,
        schemaVersion: artifact.schemaVersion,
        deliveryCount: artifact.deliveryCount,
        contentSha256: artifact.contentSha256,
        ...(artifact.currentAdapterCatalogSha256
          ? {
              currentAdapterCatalogSha256: artifact.currentAdapterCatalogSha256,
            }
          : {}),
        ...qualificationSummary,
      },
    );
    setInboundDeadLetterExportHeaders(context, artifact);
    return context.json(artifact);
  });

  app.post("/api/channels/:channelId/dead-letters/verify", async (context) => {
    const channelId = context.req.param("channelId");
    services.store.getInboundChannel(channelId);
    let input: unknown;
    try {
      input = await readLimitedJson(
        context.req.raw,
        MAX_DEAD_LETTER_EXPORT_VERIFY_REQUEST_BYTES,
        "Dead-letter export verification request",
      );
    } catch (error) {
      return jsonError(
        context,
        errorMessage(error),
        error instanceof RequestBodyTooLargeError ? 413 : 400,
      );
    }
    const body = parseVerifyInboundDeadLetterExportRequest(input);
    if (!body) {
      return jsonError(
        context,
        "Dead-letter export verification request is invalid",
        400,
      );
    }
    const verification = verifyInboundDeadLetterExportArtifact(body.artifact, {
      expectedChannelId: channelId,
    });
    setInboundDeadLetterExportVerificationHeaders(context, verification);
    return context.json(verification);
  });

  app.post(
    "/api/channels/:channelId/dead-letters/retry-preview",
    async (context) => {
      const channelId = context.req.param("channelId");
      let input: unknown;
      try {
        input = await readLimitedJson(
          context.req.raw,
          MAX_DEAD_LETTER_EXPORT_VERIFY_REQUEST_BYTES,
          "Dead-letter retry preview request",
        );
      } catch (error) {
        return jsonError(
          context,
          errorMessage(error),
          error instanceof RequestBodyTooLargeError ? 413 : 400,
        );
      }
      const body = parsePreviewInboundDeadLetterRetryRequest(input);
      if (!body) {
        return jsonError(
          context,
          "Dead-letter retry preview request is invalid",
          400,
        );
      }
      const preview = services.channels.previewDeadLetterRetry(
        channelId,
        body.artifact,
      );
      setInboundDeadLetterRetryPreviewHeaders(context, preview);
      return context.json(preview);
    },
  );

  app.post(
    "/api/channels/:channelId/dead-letters/retry-apply",
    async (context) => {
      const channelId = context.req.param("channelId");
      let input: unknown;
      try {
        input = await readLimitedJson(
          context.req.raw,
          MAX_DEAD_LETTER_EXPORT_VERIFY_REQUEST_BYTES,
          "Dead-letter retry apply request",
        );
      } catch (error) {
        return jsonError(
          context,
          errorMessage(error),
          error instanceof RequestBodyTooLargeError ? 413 : 400,
        );
      }
      const body = parseApplyInboundDeadLetterRetryRequest(input);
      if (!body) {
        return jsonError(
          context,
          "Dead-letter retry apply request is invalid",
          400,
        );
      }
      try {
        const result = await services.channels.retryDeadLetters(
          channelId,
          body.artifact,
          body.expectedPreviewSha256,
          body.confirmReplay,
        );
        const channel = services.store.getInboundChannel(channelId);
        await appendInboundChannelEvent(
          services.store,
          channel.threadId,
          "channel.dead_letters.retry_applied",
          {
            channelId,
            applyResultSha256: result.contentSha256,
            previewSha256: result.previewSha256,
            ...(result.artifactSha256
              ? { artifactSha256: result.artifactSha256 }
              : {}),
            previewCandidateSetSha256: result.previewCandidateSetSha256,
            previewRetryableDeliveryIdsSha256:
              result.previewRetryableDeliveryIdsSha256,
            previewBlockedDeliveryIdsSha256:
              result.previewBlockedDeliveryIdsSha256,
            retriedCount: result.retriedCount,
            skippedCount: result.skippedCount,
            retriedDeliveryIdsSha256: result.retriedDeliveryIdsSha256,
            skippedDeliveryIdsSha256: result.skippedDeliveryIdsSha256,
          },
        );
        setInboundDeadLetterRetryApplyResultHeaders(context, result);
        return context.json(result, 202);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (
          message.includes("confirmation") ||
          message.includes("preview") ||
          message.includes("valid export")
        ) {
          return jsonError(context, message, 409);
        }
        throw error;
      }
    },
  );

  app.get(
    "/api/channels/:channelId/dead-letters/retry-history",
    async (context) => {
      const channelId = context.req.param("channelId");
      const channel = services.store.getInboundChannel(channelId);
      const history = createInboundDeadLetterRetryHistory(
        channelId,
        await services.store.listEvents(channel.threadId),
      );
      setInboundDeadLetterRetryHistoryHeaders(context, history, channel);
      return context.json(history);
    },
  );

  app.post(
    "/api/channels/:channelId/dead-letters/retry-history/verify",
    async (context) => {
      const channelId = context.req.param("channelId");
      const channel = services.store.getInboundChannel(channelId);
      let input: unknown;
      try {
        input = await readLimitedJson(
          context.req.raw,
          MAX_DEAD_LETTER_EXPORT_VERIFY_REQUEST_BYTES,
          "Dead-letter retry history verification request",
        );
      } catch (error) {
        return jsonError(
          context,
          errorMessage(error),
          error instanceof RequestBodyTooLargeError ? 413 : 400,
        );
      }
      const body = parseVerifyInboundDeadLetterRetryHistoryRequest(input);
      if (!body) {
        return jsonError(
          context,
          "Dead-letter retry history verification request is invalid",
          400,
        );
      }
      const verification = verifyInboundDeadLetterRetryHistory(body.history, {
        expectedChannelId: channelId,
        events: await services.store.listEvents(channel.threadId),
      });
      setInboundDeadLetterRetryHistoryVerificationHeaders(
        context,
        verification,
      );
      return context.json(verification);
    },
  );
}
