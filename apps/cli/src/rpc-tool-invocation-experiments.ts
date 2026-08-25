import type {
  NapierRpcToolInvocationExperimentPreviewParams,
  NapierRpcToolInvocationExperimentRunParams,
} from "@napier/contracts";
import { validateCreateToolInvocationExperimentRequest } from "@napier/runtime/evaluation";

import { invalidParams, resourceId } from "./rpc-protocol.js";

export type RpcToolInvocationExperimentPreviewParams =
  NapierRpcToolInvocationExperimentPreviewParams;
export type RpcToolInvocationExperimentRunParams =
  NapierRpcToolInvocationExperimentRunParams;

export function parseToolInvocationExperimentPreviewParams(
  input: Record<string, unknown> | undefined,
): RpcToolInvocationExperimentPreviewParams {
  if (!input) {
    invalidParams("Tool invocation experiment preview params are required");
  }
  if (Object.hasOwn(input, "expectedPreviewSha256")) {
    invalidParams(
      "Tool invocation experiment preview cannot include execution confirmation",
    );
  }
  const { sourceThreadId: sourceInput, ...requestInput } = input;
  const sourceThreadId = resourceId(sourceInput, "sourceThreadId");
  try {
    const request = validateCreateToolInvocationExperimentRequest(requestInput);
    return { sourceThreadId, ...request };
  } catch {
    return invalidParams(
      "Tool invocation experiment preview params are invalid",
    );
  }
}

export function parseToolInvocationExperimentRunParams(
  input: Record<string, unknown> | undefined,
): RpcToolInvocationExperimentRunParams {
  if (!input) {
    invalidParams("Tool invocation experiment run params are required");
  }
  if (!Object.hasOwn(input, "expectedPreviewSha256")) {
    invalidParams(
      "Tool invocation experiment run requires expectedPreviewSha256",
    );
  }
  const { sourceThreadId: sourceInput, ...requestInput } = input;
  const sourceThreadId = resourceId(sourceInput, "sourceThreadId");
  try {
    const request = validateCreateToolInvocationExperimentRequest(requestInput);
    if (!request.expectedPreviewSha256) {
      return invalidParams(
        "Tool invocation experiment run requires expectedPreviewSha256",
      );
    }
    return {
      sourceThreadId,
      ...request,
      expectedPreviewSha256: request.expectedPreviewSha256,
    };
  } catch {
    return invalidParams("Tool invocation experiment run params are invalid");
  }
}
