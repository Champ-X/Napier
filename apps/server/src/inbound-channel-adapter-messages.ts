import { sha256Text } from "./http-response-evidence.js";

export function buildGitHubWebhookMessage(
  event: string,
  delivery: string,
  payload: Record<string, unknown>,
): string {
  const deliveryFingerprint = sha256Text(delivery).slice(0, 12);
  const lines = [
    `GitHub ${event} webhook received.`,
    `Delivery fingerprint: ${deliveryFingerprint}.`,
  ];
  const repository = gitHubNestedString(payload, "repository", "full_name");
  const action = stringField(payload, "action", 120);
  const sender = gitHubNestedString(payload, "sender", "login");
  const ref = stringField(payload, "ref", 240);
  const compare = stringField(payload, "compare", 500);
  const subject = gitHubWebhookSubject(payload);

  if (repository) lines.push(`Repository: ${repository}.`);
  if (action) lines.push(`Action: ${action}.`);
  if (sender) lines.push(`Sender: ${sender}.`);
  if (subject) lines.push(subject);
  if (ref) lines.push(`Ref: ${ref}.`);
  if (compare) lines.push(`Compare: ${compare}.`);

  return lines.join("\n").slice(0, 4_000);
}

export function buildSlackEventMessage(
  eventId: string,
  payload: Record<string, unknown>,
): string {
  const event = recordField(payload, "event");
  const topLevelType = stringField(payload, "type", 120);
  const eventType = event
    ? stringField(event, "type", 120)
    : stringField(payload, "event_type", 120);
  const lines = [
    `Slack ${eventType ?? topLevelType ?? "event"} webhook received.`,
    `Event fingerprint: ${sha256Text(eventId).slice(0, 12)}.`,
  ];
  const team = stringField(payload, "team_id", 120);
  const app = stringField(payload, "api_app_id", 120);
  const channel = event ? stringField(event, "channel", 120) : undefined;
  const user =
    event &&
    (stringField(event, "user", 120) ?? stringField(event, "bot_id", 120));
  const text = event ? stringField(event, "text", 500) : undefined;
  const ts =
    event &&
    (stringField(event, "event_ts", 80) ?? stringField(event, "ts", 80));

  if (topLevelType) lines.push(`Envelope type: ${topLevelType}.`);
  if (team) lines.push(`Team: ${team}.`);
  if (app) lines.push(`App: ${app}.`);
  if (channel) lines.push(`Channel: ${channel}.`);
  if (user) lines.push(`Actor: ${user}.`);
  if (ts) lines.push(`Timestamp: ${ts}.`);
  if (text) lines.push(`Text: "${text}"`);

  return lines.join("\n").slice(0, 4_000);
}

export function linearWebhookSeed(
  payload: Record<string, unknown>,
): { ok: true; value: string } | { ok: false; error: string } {
  const data = recordField(payload, "data");
  const webhookId = linearStringField(payload, "webhookId", 160);
  const timestamp =
    linearStringField(payload, "createdAt", 80) ??
    linearStringField(payload, "webhookTimestamp", 80);
  const type = linearStringField(payload, "type", 120);
  const action = linearStringField(payload, "action", 120);
  const dataId = data ? linearStringField(data, "id", 160) : undefined;
  if (!webhookId) return { ok: false, error: "Linear webhookId is required" };
  if (!timestamp) {
    return { ok: false, error: "Linear webhook timestamp is required" };
  }
  if (!type || !action || !dataId) {
    return { ok: false, error: "Linear webhook event identity is incomplete" };
  }
  return {
    ok: true,
    value: [webhookId, timestamp, type, action, dataId].join("\0"),
  };
}

export function buildLinearWebhookMessage(
  seed: string,
  payload: Record<string, unknown>,
): string {
  const data = recordField(payload, "data");
  const type = linearStringField(payload, "type", 120);
  const action = linearStringField(payload, "action", 120);
  const organization = linearStringField(payload, "organizationId", 160);
  const identifier = data
    ? (linearStringField(data, "identifier", 120) ??
      linearStringField(data, "number", 120))
    : undefined;
  const title = data ? linearStringField(data, "title", 300) : undefined;
  const url = data ? linearStringField(data, "url", 500) : undefined;
  const state = nestedString(data, "state", "name", 160);
  const assignee = nestedString(data, "assignee", "name", 160);
  const team =
    nestedString(data, "team", "key", 80) ??
    nestedString(data, "team", "name", 160);
  const project = nestedString(data, "project", "name", 160);
  const lines = [
    `Linear ${type ?? "entity"} ${action ?? "changed"} webhook received.`,
    `Event fingerprint: ${sha256Text(seed).slice(0, 12)}.`,
  ];

  if (organization) lines.push(`Organization: ${organization}.`);
  if (team) lines.push(`Team: ${team}.`);
  if (project) lines.push(`Project: ${project}.`);
  if (identifier || title) {
    lines.push(
      `Subject: ${[identifier, title ? `"${title}"` : undefined]
        .filter(Boolean)
        .join(" ")}`,
    );
  }
  if (state) lines.push(`State: ${state}.`);
  if (assignee) lines.push(`Assignee: ${assignee}.`);
  if (url) lines.push(`URL: ${url}`);

  return lines.join("\n").slice(0, 4_000);
}

function gitHubWebhookSubject(
  payload: Record<string, unknown>,
): string | undefined {
  const pullRequest = recordField(payload, "pull_request");
  if (pullRequest) return gitHubIssueLikeLine("Pull request", pullRequest);
  const issue = recordField(payload, "issue");
  if (issue) return gitHubIssueLikeLine("Issue", issue);
  const release = recordField(payload, "release");
  if (release) return gitHubIssueLikeLine("Release", release);
  const checkRun = recordField(payload, "check_run");
  if (checkRun) return gitHubWorkflowLikeLine("Check run", checkRun);
  const checkSuite = recordField(payload, "check_suite");
  if (checkSuite) return gitHubWorkflowLikeLine("Check suite", checkSuite);
  const workflowRun = recordField(payload, "workflow_run");
  if (workflowRun) return gitHubWorkflowLikeLine("Workflow run", workflowRun);
  const headCommit = recordField(payload, "head_commit");
  if (headCommit) return gitHubCommitLine(headCommit);
  return undefined;
}

function gitHubIssueLikeLine(
  label: string,
  record: Record<string, unknown>,
): string {
  const number = numberField(record, "number");
  const title =
    stringField(record, "title", 220) ??
    stringField(record, "name", 220) ??
    stringField(record, "tag_name", 220);
  const url = stringField(record, "html_url", 500);
  return [
    `${label}${number === undefined ? "" : ` #${number}`}:`,
    title ? `"${title}"` : "untitled",
    url ? `(${url})` : undefined,
  ]
    .filter(Boolean)
    .join(" ");
}

function gitHubWorkflowLikeLine(
  label: string,
  record: Record<string, unknown>,
): string {
  const name =
    stringField(record, "name", 220) ??
    stringField(record, "workflow_name", 220);
  const status = stringField(record, "status", 120);
  const conclusion = stringField(record, "conclusion", 120);
  const url = stringField(record, "html_url", 500);
  return [
    `${label}:`,
    name ?? "unnamed",
    status ? `status=${status}` : undefined,
    conclusion ? `conclusion=${conclusion}` : undefined,
    url ? `(${url})` : undefined,
  ]
    .filter(Boolean)
    .join(" ");
}

function gitHubCommitLine(record: Record<string, unknown>): string {
  const id = stringField(record, "id", 80);
  const message = stringField(record, "message", 300)?.split("\n")[0];
  const url = stringField(record, "url", 500);
  return [
    "Head commit:",
    id ? id.slice(0, 12) : undefined,
    message ? `"${message}"` : undefined,
    url ? `(${url})` : undefined,
  ]
    .filter(Boolean)
    .join(" ");
}

function gitHubNestedString(
  record: Record<string, unknown>,
  key: string,
  nestedKey: string,
): string | undefined {
  const nested = recordField(record, key);
  return nested ? stringField(nested, nestedKey, 240) : undefined;
}

function recordField(
  record: Record<string, unknown> | undefined,
  key: string,
): Record<string, unknown> | undefined {
  if (!record) return undefined;
  const value = record[key];
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function nestedString(
  record: Record<string, unknown> | undefined,
  key: string,
  nestedKey: string,
  maxLength: number,
): string | undefined {
  const nested = recordField(record, key);
  return nested ? linearStringField(nested, nestedKey, maxLength) : undefined;
}

function stringField(
  record: Record<string, unknown>,
  key: string,
  maxLength: number,
): string | undefined {
  const value = record[key];
  if (typeof value !== "string") return undefined;
  const normalized = value.replace(/\s+/gu, " ").trim();
  return normalized ? normalized.slice(0, maxLength) : undefined;
}

function linearStringField(
  record: Record<string, unknown>,
  key: string,
  maxLength: number,
): string | undefined {
  const value = record[key];
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const normalized = String(value).replace(/\s+/gu, " ").trim();
  return normalized ? normalized.slice(0, maxLength) : undefined;
}

function numberField(
  record: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = record[key];
  return typeof value === "number" && Number.isSafeInteger(value)
    ? value
    : undefined;
}
