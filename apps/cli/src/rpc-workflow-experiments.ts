import type {
  NapierRpcWorkflowExperimentPreviewParams,
  NapierRpcWorkflowExperimentRunParams,
} from "@napier/contracts";
import { validateCreateExecutionPlanWorkflowExperimentRequest } from "@napier/runtime";

import { invalidParams, resourceId } from "./rpc-protocol.js";

export type RpcWorkflowExperimentPreviewParams =
  NapierRpcWorkflowExperimentPreviewParams;
export type RpcWorkflowExperimentRunParams =
  NapierRpcWorkflowExperimentRunParams;

export function parseWorkflowExperimentPreviewParams(
  input: Record<string, unknown> | undefined,
): RpcWorkflowExperimentPreviewParams {
  if (!input) invalidParams("Workflow experiment preview params are required");
  if (
    Object.hasOwn(input, "confirmSideEffects") ||
    Object.hasOwn(input, "expectedPreviewSha256")
  ) {
    invalidParams(
      "Workflow experiment preview cannot include execution confirmation",
    );
  }
  const { sourceThreadId: sourceInput, ...requestInput } = input;
  const sourceThreadId = resourceId(sourceInput, "sourceThreadId");
  try {
    const request =
      validateCreateExecutionPlanWorkflowExperimentRequest(requestInput);
    return { sourceThreadId, ...request };
  } catch {
    return invalidParams("Workflow experiment preview params are invalid");
  }
}

export function parseWorkflowExperimentRunParams(
  input: Record<string, unknown> | undefined,
): RpcWorkflowExperimentRunParams {
  if (!input) invalidParams("Workflow experiment run params are required");
  if (!Object.hasOwn(input, "expectedPreviewSha256")) {
    invalidParams("Workflow experiment run requires expectedPreviewSha256");
  }
  const { sourceThreadId: sourceInput, ...requestInput } = input;
  const sourceThreadId = resourceId(sourceInput, "sourceThreadId");
  try {
    const request =
      validateCreateExecutionPlanWorkflowExperimentRequest(requestInput);
    if (!request.expectedPreviewSha256) {
      return invalidParams(
        "Workflow experiment run requires expectedPreviewSha256",
      );
    }
    return {
      sourceThreadId,
      ...request,
      expectedPreviewSha256: request.expectedPreviewSha256,
    };
  } catch {
    return invalidParams("Workflow experiment run params are invalid");
  }
}
