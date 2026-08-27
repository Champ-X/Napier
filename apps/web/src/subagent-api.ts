import type {
  ModelRef,
  SubagentOutcomeEvidenceVerification,
  SubagentOutcomeReview,
} from "@napier/contracts";
import type {
  CancelSubagentHubTaskRequestV1,
  ReviveSubagentHubTaskRequestV1,
  SteerSubagentHubTaskRequestV1,
  SubagentHubActionResponseV1,
} from "@napier/contracts/subagent-hub";

import { requestJson } from "./api-client";
import { validateSubagentHubActionResponse } from "./subagent-hub-protocol";

export async function steerSubagentHubTask(
  threadId: string,
  taskId: string,
  request: SteerSubagentHubTaskRequestV1,
): Promise<SubagentHubActionResponseV1> {
  return validateSubagentHubActionResponse(
    await requestSubagentHubAction(threadId, taskId, "steer", request),
    threadId,
    "steer",
    taskId,
  );
}

export async function cancelSubagentHubTask(
  threadId: string,
  taskId: string,
  request: CancelSubagentHubTaskRequestV1,
): Promise<SubagentHubActionResponseV1> {
  return validateSubagentHubActionResponse(
    await requestSubagentHubAction(threadId, taskId, "cancel", request),
    threadId,
    "cancel",
    taskId,
  );
}

export async function reviveSubagentHubTask(
  threadId: string,
  taskId: string,
  request: ReviveSubagentHubTaskRequestV1,
): Promise<SubagentHubActionResponseV1> {
  return validateSubagentHubActionResponse(
    await requestSubagentHubAction(threadId, taskId, "revive", request),
    threadId,
    "revive",
    taskId,
  );
}

function requestSubagentHubAction(
  threadId: string,
  taskId: string,
  action: "steer" | "cancel" | "revive",
  request:
    | SteerSubagentHubTaskRequestV1
    | CancelSubagentHubTaskRequestV1
    | ReviveSubagentHubTaskRequestV1,
): Promise<unknown> {
  return requestJson(
    `/api/threads/${encodeURIComponent(threadId)}/subagents/${encodeURIComponent(taskId)}/${action}`,
    {
      method: "POST",
      body: JSON.stringify(request),
    },
  );
}

export function verifySubagentOutcomeEvidence(
  threadId: string,
  taskId: string,
): Promise<SubagentOutcomeEvidenceVerification> {
  return requestJson(
    `/api/threads/${encodeURIComponent(threadId)}/subagents/${encodeURIComponent(taskId)}/outcome/verify`,
    { method: "POST" },
  );
}

export function reviewSubagentOutcome(
  threadId: string,
  taskId: string,
  model: ModelRef,
): Promise<SubagentOutcomeReview> {
  return requestJson(
    `/api/threads/${encodeURIComponent(threadId)}/subagents/${encodeURIComponent(taskId)}/outcome/review`,
    {
      method: "POST",
      body: JSON.stringify({ model }),
    },
  );
}
