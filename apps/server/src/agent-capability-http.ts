import type {
  RestoreRecommendedCapabilitiesRequestV1,
  UpgradeRecommendedCapabilitiesRequestV1,
} from "@napier/contracts/agent-capability-contract";
import {
  AGENT_CAPABILITY_PRESET_IDS,
  type AgentCapabilityPresetId,
} from "@napier/contracts/agent-capabilities";
import type { LocalAgentRuntimeServices } from "@napier/runtime/agent";
import {
  CapabilityRestoreConflictError,
  CapabilityRestorePersistenceError,
  CapabilityRestoreValidationError,
  CapabilityUpgradeConflictError,
  CapabilityUpgradePersistenceError,
  CapabilityUpgradeValidationError,
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
    const preset = parseCapabilityPreset(context);
    if (preset === null) {
      return jsonError(
        context,
        "Capability projection request is invalid",
        400,
      );
    }
    try {
      const projection = await services.agentCapabilities.project(
        context.req.param("agentId"),
        preset,
      );
      setProjectionHeaders(
        context,
        projection.projectionSha256,
        projection,
        preset,
      );
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

  app.post("/api/agents/:agentId/capabilities/upgrade", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(
        context.req.raw,
        MAX_CAPABILITY_RESTORE_REQUEST_BYTES,
        "Capability upgrade request",
      );
    } catch (error) {
      return jsonError(
        context,
        errorMessage(error),
        error instanceof RequestBodyTooLargeError ? 413 : 400,
      );
    }
    const request = parseUpgradeRequest(input);
    if (!request) {
      return jsonError(context, "Capability upgrade request is invalid", 400);
    }
    try {
      const result = await services.agentCapabilities.upgrade(
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
  if (
    error instanceof CapabilityRestoreConflictError ||
    error instanceof CapabilityUpgradeConflictError
  ) {
    return jsonError(context, error.message, 409);
  }
  if (
    error instanceof CapabilityRestoreValidationError ||
    error instanceof CapabilityUpgradeValidationError
  ) {
    return jsonError(context, error.message, 422);
  }
  if (
    error instanceof CapabilityRestorePersistenceError ||
    error instanceof CapabilityUpgradePersistenceError
  ) {
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

function parseUpgradeRequest(
  input: unknown,
): UpgradeRecommendedCapabilitiesRequestV1 | undefined {
  const request = parseCapabilityCommitRequest(input);
  return request
    ? {
        schemaVersion: 1,
        expectedRevision: request.expectedRevision,
        diffSha256: request.diffSha256,
      }
    : undefined;
}

function parseRestoreRequest(
  input: unknown,
): RestoreRecommendedCapabilitiesRequestV1 | undefined {
  const request = parseCapabilityCommitRequest(input);
  return request
    ? {
        schemaVersion: 1,
        expectedRevision: request.expectedRevision,
        diffSha256: request.diffSha256,
      }
    : undefined;
}

function parseCapabilityCommitRequest(
  input: unknown,
): { expectedRevision: number; diffSha256: string } | undefined {
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
    expectedRevision: Number(record.expectedRevision),
    diffSha256: record.diffSha256,
  };
}

function parseCapabilityPreset(
  context: Context,
): AgentCapabilityPresetId | undefined | null {
  const parameters = new URL(context.req.url).searchParams;
  if (
    [...parameters.keys()].some((key) => key !== "preset") ||
    parameters.getAll("preset").length > 1
  ) {
    return null;
  }
  const preset = parameters.get("preset");
  if (preset === null) return undefined;
  return AGENT_CAPABILITY_PRESET_IDS.includes(preset as AgentCapabilityPresetId)
    ? (preset as AgentCapabilityPresetId)
    : null;
}

function setProjectionHeaders(
  context: Context,
  sha256: string,
  body: unknown,
  preset?: AgentCapabilityPresetId,
): void {
  context.header("Cache-Control", "no-store");
  context.header("X-Napier-Agent-Capability-Projection-SHA256", sha256);
  if (preset) context.header("X-Napier-Capability-Preset", preset);
  setBodyContentSha256Header(context, body);
}
