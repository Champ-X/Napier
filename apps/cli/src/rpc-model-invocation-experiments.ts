import type {
  NapierRpcModelInvocationExperimentPreviewParams,
  NapierRpcModelInvocationExperimentRunParams,
} from "@napier/contracts";
import { validateCreateModelInvocationExperimentRequest } from "@napier/runtime";

import { invalidParams, resourceId } from "./rpc-protocol.js";

export type RpcModelInvocationExperimentPreviewParams =
  NapierRpcModelInvocationExperimentPreviewParams;
export type RpcModelInvocationExperimentRunParams =
  NapierRpcModelInvocationExperimentRunParams;

export function parseModelInvocationExperimentPreviewParams(
  input: Record<string, unknown> | undefined,
): RpcModelInvocationExperimentPreviewParams {
  if (!input) {
    invalidParams("Model invocation experiment preview params are required");
  }
  if (Object.hasOwn(input, "expectedPreviewSha256")) {
    invalidParams(
      "Model invocation experiment preview cannot include execution confirmation",
    );
  }
  const { sourceThreadId: sourceInput, ...requestInput } = input;
  const sourceThreadId = resourceId(sourceInput, "sourceThreadId");
  try {
    const request =
      validateCreateModelInvocationExperimentRequest(requestInput);
    return { sourceThreadId, ...request };
  } catch {
    return invalidParams(
      "Model invocation experiment preview params are invalid",
    );
  }
}

export function parseModelInvocationExperimentRunParams(
  input: Record<string, unknown> | undefined,
): RpcModelInvocationExperimentRunParams {
  if (!input) {
    invalidParams("Model invocation experiment run params are required");
  }
  if (!Object.hasOwn(input, "expectedPreviewSha256")) {
    invalidParams(
      "Model invocation experiment run requires expectedPreviewSha256",
    );
  }
  const { sourceThreadId: sourceInput, ...requestInput } = input;
  const sourceThreadId = resourceId(sourceInput, "sourceThreadId");
  try {
    const request =
      validateCreateModelInvocationExperimentRequest(requestInput);
    if (!request.expectedPreviewSha256) {
      return invalidParams(
        "Model invocation experiment run requires expectedPreviewSha256",
      );
    }
    return {
      sourceThreadId,
      ...request,
      expectedPreviewSha256: request.expectedPreviewSha256,
    };
  } catch {
    return invalidParams("Model invocation experiment run params are invalid");
  }
}
