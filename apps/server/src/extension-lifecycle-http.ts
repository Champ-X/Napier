import { Hono } from "hono";

import { setExtensionRecordHeaders } from "./app-http-response-core.js";
import {
  MAX_EXTENSION_ADMIN_REQUEST_BYTES,
  parseCreateMcpExtensionRequest,
  parseExtensionThreadContextRequest,
  parseReviewExtensionRequest,
  parseReviewMcpToolRequest,
  parseSetExtensionEnabledRequest,
} from "./app-http-validation-core.js";
import {
  readLimitedJson,
  readOptionalLimitedJson,
  RequestBodyTooLargeError,
} from "./http-request-body.js";
import { errorMessage, jsonError } from "./http-response-evidence.js";
import { appendExtensionEvent } from "./package-governance-http-evidence-distribution.js";
import type { NapierServices } from "./server-composition-root.js";

export function registerExtensionLifecycleHttp(
  app: Hono,
  services: NapierServices,
): void {
  app.post("/api/extensions/mcp", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(
        context.req.raw,
        MAX_EXTENSION_ADMIN_REQUEST_BYTES,
        "MCP extension request",
      );
    } catch (error) {
      return jsonError(
        context,
        errorMessage(error),
        error instanceof RequestBodyTooLargeError ? 413 : 400,
      );
    }
    const body = parseCreateMcpExtensionRequest(input);
    if (!body) {
      return jsonError(context, "MCP extension request is invalid", 400);
    }
    if (body.threadId) services.store.getThread(body.threadId);
    const extension = await services.store.createMcpExtension(body);
    await appendExtensionEvent(
      services,
      body.threadId,
      "extension.proposed",
      {
        extensionId: extension.id,
        name: extension.name,
        kind: extension.kind,
        requestedCapabilities: extension.requestedCapabilities,
        provenanceSha256: extension.provenance.digestSha256,
      },
    );
    setExtensionRecordHeaders(context, extension);
    return context.json(extension, 201);
  });

  app.post("/api/extensions/:extensionId/review", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(
        context.req.raw,
        MAX_EXTENSION_ADMIN_REQUEST_BYTES,
        "Extension review request",
      );
    } catch (error) {
      return jsonError(
        context,
        errorMessage(error),
        error instanceof RequestBodyTooLargeError ? 413 : 400,
      );
    }
    const body = parseReviewExtensionRequest(input);
    if (!body) {
      return jsonError(context, "Extension review request is invalid", 400);
    }
    if (body.threadId) services.store.getThread(body.threadId);
    const extension = await services.store.reviewExtension(
      context.req.param("extensionId"),
      body,
    );
    await appendExtensionEvent(
      services,
      body.threadId,
      `extension.${body.action === "approve" ? "approved" : "rejected"}`,
      {
        extensionId: extension.id,
        trustStatus: extension.trustStatus,
        approvedCapabilities: extension.approvedCapabilities,
      },
    );
    setExtensionRecordHeaders(context, extension);
    return context.json(extension);
  });

  app.post("/api/extensions/:extensionId/enabled", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(
        context.req.raw,
        MAX_EXTENSION_ADMIN_REQUEST_BYTES,
        "Extension enablement request",
      );
    } catch (error) {
      return jsonError(
        context,
        errorMessage(error),
        error instanceof RequestBodyTooLargeError ? 413 : 400,
      );
    }
    const body = parseSetExtensionEnabledRequest(input);
    if (!body) {
      return jsonError(
        context,
        "Extension enablement request is invalid",
        400,
      );
    }
    if (body.threadId) services.store.getThread(body.threadId);
    const extension = await services.store.setExtensionEnabled(
      context.req.param("extensionId"),
      body.agentId,
      body.enabled,
    );
    await appendExtensionEvent(
      services,
      body.threadId,
      body.enabled ? "extension.enabled" : "extension.disabled",
      {
        extensionId: extension.id,
        agentId: body.agentId,
        enabled: body.enabled,
      },
    );
    setExtensionRecordHeaders(context, extension);
    return context.json(extension);
  });

  app.post("/api/extensions/:extensionId/connect", async (context) => {
    let input: unknown;
    try {
      input = await readOptionalLimitedJson(
        context.req.raw,
        MAX_EXTENSION_ADMIN_REQUEST_BYTES,
        "Extension connect request",
      );
    } catch (error) {
      return jsonError(
        context,
        errorMessage(error),
        error instanceof RequestBodyTooLargeError ? 413 : 400,
      );
    }
    const body = parseExtensionThreadContextRequest(input);
    if (!body) {
      return jsonError(context, "Extension connect request is invalid", 400);
    }
    if (body.threadId) services.store.getThread(body.threadId);
    const extension = await services.extensions.connect(
      context.req.param("extensionId"),
    );
    await appendExtensionEvent(
      services,
      body.threadId,
      "extension.connected",
      {
        extensionId: extension.id,
        toolCount: extension.tools.length,
        status: extension.connection.status,
      },
    );
    setExtensionRecordHeaders(context, extension);
    return context.json(extension);
  });

  app.post("/api/extensions/:extensionId/disconnect", async (context) => {
    let input: unknown;
    try {
      input = await readOptionalLimitedJson(
        context.req.raw,
        MAX_EXTENSION_ADMIN_REQUEST_BYTES,
        "Extension disconnect request",
      );
    } catch (error) {
      return jsonError(
        context,
        errorMessage(error),
        error instanceof RequestBodyTooLargeError ? 413 : 400,
      );
    }
    const body = parseExtensionThreadContextRequest(input);
    if (!body) {
      return jsonError(
        context,
        "Extension disconnect request is invalid",
        400,
      );
    }
    if (body.threadId) services.store.getThread(body.threadId);
    const extension = await services.extensions.disconnect(
      context.req.param("extensionId"),
    );
    await appendExtensionEvent(
      services,
      body.threadId,
      "extension.disconnected",
      {
        extensionId: extension.id,
        status: extension.connection.status,
      },
    );
    setExtensionRecordHeaders(context, extension);
    return context.json(extension);
  });

  app.post("/api/extensions/:extensionId/tools/review", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(
        context.req.raw,
        MAX_EXTENSION_ADMIN_REQUEST_BYTES,
        "MCP tool review request",
      );
    } catch (error) {
      return jsonError(
        context,
        errorMessage(error),
        error instanceof RequestBodyTooLargeError ? 413 : 400,
      );
    }
    const body = parseReviewMcpToolRequest(input);
    if (!body) {
      return jsonError(context, "MCP tool review request is invalid", 400);
    }
    if (body.threadId) services.store.getThread(body.threadId);
    const extension = await services.store.reviewMcpTool(
      context.req.param("extensionId"),
      body.toolName,
      body,
    );
    const tool = extension.tools.find(
      (candidate) =>
        candidate.name === body.toolName || candidate.directName === body.toolName,
    );
    await appendExtensionEvent(
      services,
      body.threadId,
      `extension.tool.${body.action === "approve" ? "approved" : "rejected"}`,
      {
        extensionId: extension.id,
        toolName: tool?.name ?? body.toolName,
        directName: tool?.directName ?? "",
        reviewStatus: tool?.reviewStatus ?? "missing",
        effect: tool?.effect ?? "unknown",
        schemaSha256: tool?.schemaSha256 ?? "",
      },
    );
    setExtensionRecordHeaders(context, extension);
    return context.json(extension);
  });
}
