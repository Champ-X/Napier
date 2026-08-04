import type {
  BrowserSessionPauseState,
  ResumeBrowserSessionRequest,
} from "@napier/contracts/browser-session-control";

import { requestJson } from "./api-client";

export async function getBrowserSessionPauseState(
  threadId: string,
  runId: string,
): Promise<BrowserSessionPauseState> {
  return validateState(
    await requestJson<unknown>(
      `/api/threads/${encodeURIComponent(threadId)}/runs/${encodeURIComponent(runId)}/browser-session-control`,
    ),
    threadId,
    runId,
  );
}

export async function pauseBrowserSession(
  threadId: string,
  runId: string,
): Promise<BrowserSessionPauseState> {
  return validateState(
    await requestJson<unknown>(
      `/api/threads/${encodeURIComponent(threadId)}/runs/${encodeURIComponent(runId)}/browser-session-control/pause`,
      { method: "POST" },
    ),
    threadId,
    runId,
  );
}

export async function resumeBrowserSession(
  threadId: string,
  runId: string,
  request: ResumeBrowserSessionRequest,
): Promise<BrowserSessionPauseState> {
  return validateState(
    await requestJson<unknown>(
      `/api/threads/${encodeURIComponent(threadId)}/runs/${encodeURIComponent(runId)}/browser-session-control/resume`,
      {
        method: "POST",
        body: JSON.stringify(request),
      },
    ),
    threadId,
    runId,
  );
}

function validateState(
  value: unknown,
  threadId: string,
  runId: string,
): BrowserSessionPauseState {
  if (!record(value)) {
    throw new Error("Browser Session control response is invalid");
  }
  const allowedKeys = new Set([
    "kind",
    "schemaVersion",
    "threadId",
    "runId",
    "status",
    "pauseRequestedAt",
    "resumedAt",
    "cancelledAt",
    "contentSha256",
  ]);
  const status = value["status"];
  const pauseRequestedAt = value["pauseRequestedAt"];
  const resumedAt = value["resumedAt"];
  const cancelledAt = value["cancelledAt"];
  if (
    value["kind"] !== "napier.browser-session-pause-state" ||
    value["schemaVersion"] !== 1 ||
    value["threadId"] !== threadId ||
    value["runId"] !== runId ||
    Object.keys(value).some((key) => !allowedKeys.has(key)) ||
    (status !== "running" && status !== "paused" && status !== "cancelled") ||
    !hash(value["contentSha256"]) ||
    !optionalTimestamp(pauseRequestedAt) ||
    !optionalTimestamp(resumedAt) ||
    !optionalTimestamp(cancelledAt) ||
    (status === "paused" && typeof pauseRequestedAt !== "string") ||
    (status === "cancelled" && typeof cancelledAt !== "string")
  ) {
    throw new Error("Browser Session control response is invalid");
  }
  return value as unknown as BrowserSessionPauseState;
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hash(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function optionalTimestamp(value: unknown): boolean {
  return value === undefined || (typeof value === "string" && validTime(value));
}

function validTime(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}
