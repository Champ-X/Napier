import type {
  BrowserTaskApiEvent,
  BrowserTaskBackend,
} from "./browser-task-contract";

export function parseBrowserTaskEvent(
  value: unknown,
  taskId: string,
  backend: BrowserTaskBackend,
): BrowserTaskApiEvent {
  if (
    !record(value) ||
    value["backend"] !== backend ||
    !boundedString(value["type"], 1, 32)
  ) {
    throw new Error("Browser task stream event is invalid");
  }
  const event =
    parseStartedEvent(value, backend) ??
    parseStepEvent(value, taskId) ??
    parseControlEvent(value) ??
    parseCompletedEvent(value, backend) ??
    parseErrorEvent(value);
  if (event) return event;
  throw new Error("Browser task stream event is invalid");
}

function parseStartedEvent(
  value: Record<string, unknown>,
  backend: BrowserTaskBackend,
): Extract<BrowserTaskApiEvent, { type: "started" }> | undefined {
  if (value["type"] !== "started") return undefined;
  if (!boundedString(value["model"], 1, 320)) return undefined;
  if (!Number.isSafeInteger(value["allowedDomainCount"])) return undefined;
  if (value["costStatus"] !== "unknown") return undefined;
  if (value["interactionPolicy"] !== "public_read_only") return undefined;
  if (!optionalString(value["startUrl"], 2_048)) return undefined;
  if (backend === "browser_use_cloud" && !validCloudStarted(value)) {
    return undefined;
  }
  if (backend === "browser_use_local" && !validLocalStarted(value)) {
    return undefined;
  }
  return value as unknown as Extract<BrowserTaskApiEvent, { type: "started" }>;
}

function parseControlEvent(
  value: Record<string, unknown>,
): Extract<BrowserTaskApiEvent, { type: "control" }> | undefined {
  if (value["type"] !== "control") return undefined;
  if (value["backend"] !== "browser_use_local") return undefined;
  if (!["running", "paused", "takeover"].includes(String(value["state"]))) {
    return undefined;
  }
  if (typeof value["pauseAvailable"] !== "boolean") return undefined;
  if (typeof value["takeoverAvailable"] !== "boolean") return undefined;
  if (value["browserVisibility"] !== "visible") return undefined;
  if (!boundedString(value["message"], 1, 2_048)) return undefined;
  return value as unknown as Extract<BrowserTaskApiEvent, { type: "control" }>;
}

function parseStepEvent(
  value: Record<string, unknown>,
  taskId: string,
): Extract<BrowserTaskApiEvent, { type: "step" }> | undefined {
  if (value["type"] !== "step") return undefined;
  if (!Number.isSafeInteger(value["step"])) return undefined;
  if (typeof value["url"] !== "string" || value["url"].length > 4_096) {
    return undefined;
  }
  if (typeof value["title"] !== "string" || value["title"].length > 2_048) {
    return undefined;
  }
  if (!validActionNames(value["actionNames"])) return undefined;
  if (!optionalString(value["nextGoal"], 8_000)) return undefined;
  if (!optionalString(value["errorCode"], 128)) return undefined;
  if (!optionalString(value["errorMessage"], 2_048)) return undefined;
  if (!optionalString(value["errorDiagnosticSha256"], 64)) return undefined;
  if (!optionalScreenshotUrl(value["screenshotUrl"], taskId, value["step"])) {
    return undefined;
  }
  return value as unknown as Extract<BrowserTaskApiEvent, { type: "step" }>;
}

function parseCompletedEvent(
  value: Record<string, unknown>,
  backend: BrowserTaskBackend,
): Extract<BrowserTaskApiEvent, { type: "completed" }> | undefined {
  if (value["type"] !== "completed") return undefined;
  if (!validBrowserTaskStatus(value["status"])) return undefined;
  if (typeof value["result"] !== "string") return undefined;
  if (value["result"].length > 128 * 1024) return undefined;
  if (!Number.isSafeInteger(value["stepCount"])) return undefined;
  if (!["reported", "unknown"].includes(String(value["costStatus"]))) {
    return undefined;
  }
  if (!optionalNumber(value["costUsd"])) return undefined;
  if (!optionalNumber(value["totalTokens"])) return undefined;
  if (!optionalString(value["recovery"], 4_096)) return undefined;
  if (!boundedString(value["artifactDirectory"], 1, 4_096)) return undefined;
  if (backend === "browser_use_cloud" && !validCloudCompleted(value)) {
    return undefined;
  }
  return value as unknown as Extract<
    BrowserTaskApiEvent,
    { type: "completed" }
  >;
}

function parseErrorEvent(
  value: Record<string, unknown>,
): Extract<BrowserTaskApiEvent, { type: "error" }> | undefined {
  if (value["type"] !== "error") return undefined;
  if (!boundedString(value["code"], 1, 128)) return undefined;
  if (!boundedString(value["message"], 1, 2_048)) return undefined;
  if (!boundedString(value["diagnosticSha256"], 64, 64)) return undefined;
  if (!boundedString(value["recovery"], 1, 4_096)) return undefined;
  return value as unknown as Extract<BrowserTaskApiEvent, { type: "error" }>;
}

function validCloudStarted(value: Record<string, unknown>): boolean {
  return (
    value["dataFlow"] ===
      "task_url_domains_and_page_data_to_browser_use_cloud" &&
    value["workspaceAccess"] === "none" &&
    value["secretForwarding"] === "browser_use_api_key_only" &&
    value["recording"] === "disabled" &&
    value["retentionPolicy"] === "provider_plan" &&
    value["costLimitMode"] === "napier_poll_stop" &&
    value["credentialStatus"] === "configured" &&
    value["pauseAvailable"] === false &&
    value["takeoverAvailable"] === false &&
    value["cancelMode"] === "stop_task_and_session" &&
    typeof value["maxCostUsd"] === "number" &&
    Number.isFinite(value["maxCostUsd"])
  );
}

function validLocalStarted(value: Record<string, unknown>): boolean {
  const available = value["pauseAvailable"] === true;
  return (
    typeof value["pauseAvailable"] === "boolean" &&
    value["takeoverAvailable"] === value["pauseAvailable"] &&
    value["browserVisibility"] === "visible" &&
    ["system_chrome", "system_chromium"].includes(
      String(value["browserProduct"]),
    ) &&
    boundedString(value["browserVersion"], 1, 64) &&
    value["pauseMode"] ===
      (available ? "immediate_agent_process" : "unavailable") &&
    value["challengeMode"] ===
      (available ? "automatic_takeover_pause" : "handoff_only") &&
    value["cancelMode"] ===
      (available ? "terminate_process_group" : "terminate_process")
  );
}

function validCloudCompleted(value: Record<string, unknown>): boolean {
  return (
    boundedString(value["providerTaskId"], 1, 128) &&
    value["retentionPolicy"] === "provider_plan"
  );
}

function validActionNames(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.every((action) => boundedString(action, 1, 128))
  );
}

function validBrowserTaskStatus(value: unknown): boolean {
  return ["completed", "failed", "cancelled", "handoff_required"].includes(
    String(value),
  );
}

function optionalScreenshotUrl(
  value: unknown,
  taskId: string,
  step: unknown,
): boolean {
  return (
    value === undefined ||
    value ===
      `/api/browser-tasks/${encodeURIComponent(taskId)}/screenshots/${String(step)}`
  );
}

function optionalString(value: unknown, maximum: number): boolean {
  return (
    value === undefined ||
    (typeof value === "string" && value.length <= maximum)
  );
}

function optionalNumber(value: unknown): boolean {
  return (
    value === undefined || (typeof value === "number" && Number.isFinite(value))
  );
}

function boundedString(
  value: unknown,
  minimum: number,
  maximum: number,
): value is string {
  return (
    typeof value === "string" &&
    value.length >= minimum &&
    value.length <= maximum
  );
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
