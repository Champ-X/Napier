import { createHash } from "node:crypto";

import type {
  ContextCheckpointSnapshot,
  JsonValue,
  RunEvent,
} from "@napier/contracts";

export interface ContinuityBoundContextCheckpoint
  extends ContextCheckpointSnapshot {
  continuityProjectionVersion?: 1;
  continuityEventCount?: number;
  continuitySha256?: string;
}

export function contextContinuityEvidenceEvents(events: RunEvent[]): RunEvent[] {
  return events.filter((event) => {
    if (event.visibility !== "user") return false;
    return event.type === "tool.completed" ||
      event.type === "tool.failed" ||
      event.type === "tool.blocked" ||
      event.type === "tool.result_reused" ||
      event.type.startsWith("plan.") ||
      event.type.startsWith("operator.decision.") ||
      event.type.startsWith("run.recovery.") ||
      event.type === "run.environment.negotiated" ||
      event.type === "verification.completed" ||
      event.type === "workspace.file.mutated" ||
      event.type === "workspace.file.recovered" ||
      event.type === "agent.milestone.recorded" ||
      event.type === "goal.evaluated";
  });
}

export function contextContinuityEventText(event: RunEvent): string {
  if (isMessageEvidence(event)) return messageEventText(event);
  const payload = record(event.payload) ?? {};
  const serialized = JSON.stringify(event.payload);
  return JSON.stringify({
    ...projectFields(payload),
    ...projectDetails(record(payload["details"])),
    payloadBytes: Buffer.byteLength(serialized, "utf8"),
    payloadSha256: createHash("sha256").update(serialized).digest("hex"),
  });
}

export function contextContinuityEventsCharacterCount(events: RunEvent[]): number {
  return events.reduce(
    (total, event) => total + contextContinuityEventText(event).length,
    0,
  );
}

export function hashContextEvents(events: RunEvent[]): string {
  return createHash("sha256")
    .update(events.map((event) => JSON.stringify(event)).join("\n"))
    .digest("hex");
}

export function validContinuityBinding(
  checkpoint: ContinuityBoundContextCheckpoint,
  events: RunEvent[],
): boolean {
  if (checkpoint.continuityProjectionVersion === undefined) return true;
  const source = contextContinuityEvidenceEvents(events).filter(
    (event) => event.seq >= checkpoint.fromSeq && event.seq <= checkpoint.toSeq,
  );
  return source.length === checkpoint.continuityEventCount &&
    hashContextEvents(source) === checkpoint.continuitySha256;
}

export function parseContinuityBinding(
  payload: Record<string, JsonValue>,
): Pick<
  ContinuityBoundContextCheckpoint,
  "continuityProjectionVersion" | "continuityEventCount" | "continuitySha256"
> | undefined | null {
  const version = payload["continuityProjectionVersion"];
  const count = payload["continuityEventCount"];
  const hash = payload["continuitySha256"];
  if (version === undefined && count === undefined && hash === undefined) return undefined;
  if (version !== 1 || !Number.isSafeInteger(count) || Number(count) < 0) return null;
  if (typeof hash !== "string" || !/^[a-f0-9]{64}$/u.test(hash)) return null;
  return { continuityProjectionVersion: 1, continuityEventCount: Number(count), continuitySha256: hash };
}

const CONTINUITY_SCALAR_FIELDS = [
  "toolName", "status", "effect", "planId", "objective", "stepId", "title",
  "planStatus", "artifactId", "path", "phase", "summary", "evidence", "blocker",
  "decisionId", "selectedOptionId", "verification", "exitCode", "signal", "operation",
  "stopReason", "outcome", "result", "resultSha256", "afterSha256", "contentSha256",
  "reason", "sandboxId", "executionMode", "activeToolCount", "configuredToolCount",
  "repairComponent",
] as const;
const CONTINUITY_LIST_FIELDS = [
  "completedItems", "openLoops", "readyStepIds", "blockedStepIds", "changedPaths",
] as const;
const CONTINUITY_DETAIL_FIELDS = [
  "kind", "status", "operation", "exitCode", "signal", "resultSha256", "afterSha256",
  "targetSnapshotSha256", "workspaceSnapshotSha256", "durationMs",
] as const;

function projectFields(
  payload: Record<string, JsonValue>,
): Record<string, string | number | boolean | string[]> {
  const projection: Record<string, string | number | boolean | string[]> = {};
  for (const key of CONTINUITY_SCALAR_FIELDS) {
    const value = continuityScalar(payload[key]);
    if (value !== undefined) projection[key] = value;
  }
  for (const key of CONTINUITY_LIST_FIELDS) {
    const value = continuityList(payload[key]);
    if (value) projection[key] = value;
  }
  return projection;
}

function projectDetails(
  details: Record<string, JsonValue> | undefined,
): Record<string, string | number | boolean> {
  if (!details) return {};
  const projection: Record<string, string | number | boolean> = {};
  for (const key of CONTINUITY_DETAIL_FIELDS) {
    const value = continuityScalar(details[key]);
    if (value !== undefined) projection[`details.${key}`] = value;
  }
  return projection;
}

function isMessageEvidence(event: RunEvent): boolean {
  return event.type === "message.user" ||
    event.type === "message.assistant" ||
    event.type === "goal.continuation.prompt";
}

function messageEventText(event: RunEvent): string {
  const payload = record(event.payload);
  return typeof payload?.["text"] === "string" ? payload["text"].trim() : "";
}

function continuityScalar(value: unknown): string | number | boolean | undefined {
  if (typeof value === "string") return normalizeText(value, 500);
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return typeof value === "boolean" ? value : undefined;
}

function continuityList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const list = value.slice(0, 20).flatMap((item) => {
    const text = normalizeText(item, 200);
    return text ? [text] : [];
  });
  return list.length > 0 ? list : undefined;
}

function normalizeText(value: unknown, maxLength: number): string {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u001f\u007f]/g, " ")
        .replace(/[<>]/g, (character) => character === "<" ? "[" : "]")
        .replace(/\s+/g, " ").trim().slice(0, maxLength)
    : "";
}

function record(value: unknown): Record<string, JsonValue> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, JsonValue>
    : undefined;
}
