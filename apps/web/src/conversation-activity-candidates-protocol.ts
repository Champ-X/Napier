import type { ThreadDetail } from "@napier/contracts";

const TONES = new Set(["working", "completed", "waiting", "blocked", "info"]);
const TOKEN = /^[A-Za-z0-9_.:-]{1,160}$/u;
const RESOURCE_ID = /^(plan|decision|task)_[a-z0-9]{8,80}$/u;

export function isConversationActivityCandidates(
  value: unknown,
): value is NonNullable<ThreadDetail["activityCandidates"]> {
  return (
    Array.isArray(value) &&
    value.length <= 256 &&
    value.every((candidate) => valid(candidate))
  );
}

function valid(value: unknown): boolean {
  if (!record(value)) return false;
  const required = [
    "id",
    "seq",
    "type",
    "label",
    "summary",
    "tone",
    "createdAt",
  ];
  const optional = ["callId", "planId", "decisionId", "taskId", "artifactKey"];
  return (
    exact(value, required, optional) &&
    boundedText(value["id"], 180) &&
    integer(value["seq"], 1) &&
    boundedText(value["type"], 180) &&
    boundedText(value["label"], 40) &&
    boundedText(value["summary"], 360) &&
    typeof value["tone"] === "string" &&
    TONES.has(value["tone"]) &&
    boundedText(value["createdAt"], 80) &&
    optionalToken(value["callId"]) &&
    optionalResourceId(value["planId"], "plan") &&
    optionalResourceId(value["decisionId"], "decision") &&
    optionalResourceId(value["taskId"], "task") &&
    optionalArtifactKey(value["artifactKey"])
  );
}

function optionalToken(value: unknown): boolean {
  return (
    value === undefined || (typeof value === "string" && TOKEN.test(value))
  );
}

function optionalResourceId(value: unknown, prefix: string): boolean {
  return (
    value === undefined ||
    (typeof value === "string" &&
      value.startsWith(`${prefix}_`) &&
      RESOURCE_ID.test(value))
  );
}

function optionalArtifactKey(value: unknown): boolean {
  if (value === undefined) return true;
  if (typeof value !== "string" || value.length > 260) return false;
  const [planId, artifactId, ...extra] = value.split(":");
  return (
    extra.length === 0 &&
    optionalResourceId(planId, "plan") &&
    typeof artifactId === "string" &&
    TOKEN.test(artifactId)
  );
}

function boundedText(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximum &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  );
}

function integer(value: unknown, minimum: number): boolean {
  return (
    typeof value === "number" && Number.isSafeInteger(value) && value >= minimum
  );
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exact(
  value: Record<string, unknown>,
  required: string[],
  optional: string[],
): boolean {
  const allowed = new Set([...required, ...optional]);
  return (
    required.every((key) => Object.prototype.hasOwnProperty.call(value, key)) &&
    Object.keys(value).every((key) => allowed.has(key))
  );
}
