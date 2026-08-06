import type { RestoreRecommendedCapabilitiesRequestV1 } from "@napier/contracts/agent-capability-contract";
import type { LocalAgentRuntimeServices } from "@napier/runtime";
import {
  CapabilityRestoreConflictError,
  CapabilityRestorePersistenceError,
  CapabilityRestoreValidationError,
} from "@napier/runtime/agent-capability-store-mutations";
import { Hono, type Context } from "hono";

import {
  errorMessage,
  jsonError,
  setBodyContentSha256Header,
} from "./http-response-evidence.js";
import {
  readLimitedJson,
  RequestBodyTooLargeError,
} from "./http-request-body.js";

const MAX_CAPABILITY_RESTORE_REQUEST_BYTES = 4 * 1024;

export function registerAgentCapabilityHttp(
  app: Hono,
  services: {
    agentCapabilities: LocalAgentRuntimeServices["agentCapabilities"];
  },
): void {
  app.get("/api/agents/:agentId/capabilities", async (context) => {
    try {
      const projection = await services.agentCapabilities.project(
        context.req.param("agentId"),
      );
      setProjectionHeaders(context, projection.projectionSha256, projection);
      return context.json(projection);
    } catch (error) {
      return capabilityErrorResponse(context, error);
    }
  });

  app.post("/api/agents/:agentId/capabilities/restore", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(
        context.req.raw,
        MAX_CAPABILITY_RESTORE_REQUEST_BYTES,
        "Capability restore request",
      );
    } catch (error) {
      return jsonError(
        context,
        errorMessage(error),
        error instanceof RequestBodyTooLargeError ? 413 : 400,
      );
    }
    const request = parseRestoreRequest(input);
    if (!request) {
      return jsonError(context, "Capability restore request is invalid", 400);
    }
    try {
      const result = await services.agentCapabilities.restore(
        context.req.param("agentId"),
        request,
      );
      setProjectionHeaders(context, result.projection.projectionSha256, result);
      return context.json(result);
    } catch (error) {
      return capabilityErrorResponse(context, error);
    }
  });
}

function capabilityErrorResponse(context: Context, error: unknown): Response {
  if (error instanceof CapabilityRestoreConflictError) {
    return jsonError(context, error.message, 409);
  }
  if (error instanceof CapabilityRestoreValidationError) {
    return jsonError(context, error.message, 422);
  }
  if (error instanceof CapabilityRestorePersistenceError) {
    return jsonError(context, error.message, 503);
  }
  const message = errorMessage(error);
  if (message.startsWith("Agent not found:")) {
    return jsonError(context, message, 404);
  }
  return jsonError(
    context,
    "Capability service failed; refresh and retry. No capability state was inferred.",
    500,
  );
}

function parseRestoreRequest(
  input: unknown,
): RestoreRecommendedCapabilitiesRequestV1 | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return undefined;
  }
  const record = input as Record<string, unknown>;
  if (
    Object.keys(record).some(
      (key) =>
        !["schemaVersion", "expectedRevision", "diffSha256"].includes(key),
    ) ||
    record.schemaVersion !== 1 ||
    !Number.isInteger(record.expectedRevision) ||
    Number(record.expectedRevision) < 1 ||
    typeof record.diffSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(record.diffSha256)
  ) {
    return undefined;
  }
  return {
    schemaVersion: 1,
    expectedRevision: Number(record.expectedRevision),
    diffSha256: record.diffSha256,
  };
}

function setProjectionHeaders(
  context: Context,
  sha256: string,
  body: unknown,
): void {
  context.header("Cache-Control", "no-store");
  context.header("X-Napier-Agent-Capability-Projection-SHA256", sha256);
  setBodyContentSha256Header(context, body);
}
