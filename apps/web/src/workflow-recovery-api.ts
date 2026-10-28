import type { WorkflowRecoveryCheckpoint } from "@napier/contracts/workflow-recovery";
import { throwNapierApiError } from "./api-error";
import { validateWorkflowResult } from "./workflow-result-web-protocol";

const HASH = /^[a-f0-9]{64}$/u;
const statuses = new Set([
  "ready",
  "waiting_answer",
  "completed",
  "unavailable",
  "busy",
]);
const actions = new Set(["resume", "continue_breakpoint", "retry_blocked"]);
const reasons = new Set([
  "definition_unavailable",
  "binding_mismatch",
  "evidence_limit",
  "ambiguous_breakpoint",
]);
function endpoint(threadId: string, planId: string) {
  return `/api/threads/${encodeURIComponent(threadId)}/workflows/${encodeURIComponent(planId)}/recovery`;
}

export async function getWorkflowRecovery(
  threadId: string,
  planId: string,
  signal?: AbortSignal,
): Promise<WorkflowRecoveryCheckpoint> {
  const url = endpoint(threadId, planId);
  const response = await fetch(url, {
    cache: "no-store",
    ...(signal ? { signal } : {}),
  });
  if (!response.ok)
    await throwNapierApiError(
      response,
      "Workflow checkpoint is unavailable",
      url,
    );
  const value = await response.json();
  if (
    !value ||
    value.schemaVersion !== 1 ||
    value.threadId !== threadId ||
    value.planId !== planId ||
    !statuses.has(value.status) ||
    (value.reason !== undefined && !reasons.has(value.reason)) ||
    (value.name !== undefined && typeof value.name !== "string") ||
    (value.manifestSha256 !== undefined && !HASH.test(value.manifestSha256)) ||
    (value.status === "ready" &&
      (!actions.has(value.action) ||
        !HASH.test(value.checkpointSha256) ||
        !HASH.test(value.manifestSha256))) ||
    (value.status !== "ready" &&
      (value.action !== undefined || value.checkpointSha256 !== undefined))
  ) {
    throw new Error("Workflow checkpoint binding is invalid");
  }
  return value as WorkflowRecoveryCheckpoint;
}

export async function recoverWorkflow(checkpoint: WorkflowRecoveryCheckpoint) {
  if (checkpoint.status !== "ready" || !checkpoint.checkpointSha256)
    throw new Error("Workflow checkpoint is not ready");
  const url = endpoint(checkpoint.threadId, checkpoint.planId);
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ checkpointSha256: checkpoint.checkpointSha256 }),
  });
  if (!response.ok)
    await throwNapierApiError(response, "Workflow recovery stopped", url);
  const body = await response.json();
  const result = await validateWorkflowResult(body?.result);
  if (
    body.checkpointSha256 !== checkpoint.checkpointSha256 ||
    result.threadId !== checkpoint.threadId ||
    result.planId !== checkpoint.planId ||
    result.manifestSha256 !== checkpoint.manifestSha256 ||
    !result.resumed
  ) {
    throw new Error("Workflow recovery result binding is invalid");
  }
  return result;
}
