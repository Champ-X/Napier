import type {
  NapierRpcAgentMessageExperimentPreviewParams,
  NapierRpcAgentMessageExperimentRunParams,
} from "@napier/contracts";
import { validateCreateAgentMessageExperimentRequest } from "@napier/runtime";

import { invalidParams, resourceId } from "./rpc-protocol.js";

export type RpcAgentMessageExperimentPreviewParams =
  NapierRpcAgentMessageExperimentPreviewParams;
export type RpcAgentMessageExperimentRunParams =
  NapierRpcAgentMessageExperimentRunParams;

export function parseAgentMessageExperimentPreviewParams(
  input: Record<string, unknown> | undefined,
): RpcAgentMessageExperimentPreviewParams {
  if (!input) {
    invalidParams("Agent message experiment preview params are required");
  }
  if (Object.hasOwn(input, "expectedPreviewSha256")) {
    invalidParams(
      "Agent message experiment preview cannot include execution confirmation",
    );
  }
  const { sourceThreadId: sourceInput, ...requestInput } = input;
  const sourceThreadId = resourceId(sourceInput, "sourceThreadId");
  try {
    const request = validateCreateAgentMessageExperimentRequest(requestInput);
    return { sourceThreadId, ...request };
  } catch {
    return invalidParams("Agent message experiment preview params are invalid");
  }
}

export function parseAgentMessageExperimentRunParams(
  input: Record<string, unknown> | undefined,
): RpcAgentMessageExperimentRunParams {
  if (!input) {
    invalidParams("Agent message experiment run params are required");
  }
  if (!Object.hasOwn(input, "expectedPreviewSha256")) {
    invalidParams(
      "Agent message experiment run requires expectedPreviewSha256",
    );
  }
  const { sourceThreadId: sourceInput, ...requestInput } = input;
  const sourceThreadId = resourceId(sourceInput, "sourceThreadId");
  try {
    const request = validateCreateAgentMessageExperimentRequest(requestInput);
    if (!request.expectedPreviewSha256) {
      return invalidParams(
        "Agent message experiment run requires expectedPreviewSha256",
      );
    }
    return {
      sourceThreadId,
      ...request,
      expectedPreviewSha256: request.expectedPreviewSha256,
    };
  } catch {
    return invalidParams("Agent message experiment run params are invalid");
  }
}
