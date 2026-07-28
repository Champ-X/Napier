import type { RunEvent } from "@napier/contracts";

export interface AgentEventTraceView {
  action: string;
  agentId?: string;
  milestoneId?: string;
  predecessorMilestoneId?: string;
  phase?: string;
  revision?: number;
  restoredFromRevision?: number;
  predecessorEventSeq?: number;
  changedFieldCount?: number;
  completedItemCount?: number;
  openLoopCount?: number;
  profileRevisionSha256?: string;
  restoredSnapshotSha256?: string;
  requestSha256?: string;
}

const AGENT_EVENT =
  /^agent\.(updated|rolled_back|milestone\.recorded)$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const SAFE_TOKEN = /^[A-Za-z0-9_.:-]{1,160}$/u;
const AGENT_RECEIPT_SUMMARY = "agent receipt";

export function agentEventTraceView(
  event: RunEvent,
): AgentEventTraceView | undefined {
  if (!AGENT_EVENT.test(event.type)) return undefined;
  if (
    !event.payload ||
    typeof event.payload !== "object" ||
    Array.isArray(event.payload)
  ) {
    return undefined;
  }
  const changedFields = Array.isArray(event.payload["changedFields"])
    ? event.payload["changedFields"]
    : undefined;
  const completedItems = Array.isArray(event.payload["completedItems"])
    ? event.payload["completedItems"]
    : undefined;
  const openLoops = Array.isArray(event.payload["openLoops"])
    ? event.payload["openLoops"]
    : undefined;
  return {
    action: event.type.slice("agent.".length),
    ...safeIdField(event.payload, "agentId"),
    ...safeIdField(event.payload, "milestoneId"),
    ...safeIdField(event.payload, "predecessorMilestoneId"),
    ...safeTokenField(event.payload, "phase"),
    ...integerField(event.payload, "revision"),
    ...integerField(event.payload, "restoredFromRevision"),
    ...integerField(event.payload, "predecessorEventSeq"),
    ...(changedFields ? { changedFieldCount: changedFields.length } : {}),
    ...(completedItems ? { completedItemCount: completedItems.length } : {}),
    ...(openLoops ? { openLoopCount: openLoops.length } : {}),
    ...shaField(event.payload, "profileRevisionSha256"),
    ...shaField(event.payload, "restoredSnapshotSha256"),
    ...shaField(event.payload, "requestSha256"),
  };
}

export function agentEventTraceSummary(event: RunEvent): string | undefined {
  if (!event.type.startsWith("agent.")) return undefined;
  if (!AGENT_EVENT.test(event.type)) return event.category;
  const view = agentEventTraceView(event);
  if (!view) return AGENT_RECEIPT_SUMMARY;
  return [
    `agent / ${view.action}`,
    ...(view.agentId ? [`agent ${view.agentId.slice(-10)}`] : []),
    ...(view.milestoneId ? [`milestone ${view.milestoneId.slice(-10)}`] : []),
    ...(view.predecessorMilestoneId
      ? [`predecessor ${view.predecessorMilestoneId.slice(-10)}`]
      : []),
    ...(view.phase ? [`phase ${view.phase}`] : []),
    ...(view.revision !== undefined ? [`revision ${view.revision}`] : []),
    ...(view.restoredFromRevision !== undefined
      ? [`restored-from ${view.restoredFromRevision}`]
      : []),
    ...(view.predecessorEventSeq !== undefined
      ? [`predecessor-seq ${view.predecessorEventSeq}`]
      : []),
    ...(view.changedFieldCount !== undefined
      ? [`changed-fields ${view.changedFieldCount}`]
      : []),
    ...(view.completedItemCount !== undefined
      ? [`completed ${view.completedItemCount}`]
      : []),
    ...(view.openLoopCount !== undefined
      ? [`open-loops ${view.openLoopCount}`]
      : []),
    ...hashSummary("profile", view.profileRevisionSha256),
    ...hashSummary("restored", view.restoredSnapshotSha256),
    ...hashSummary("request", view.requestSha256),
  ].join(" / ");
}

function hashSummary(label: string, value: string | undefined): string[] {
  return value ? [`${label} ${value.slice(0, 12)}`] : [];
}

function safeIdField(
  payload: Record<string, unknown>,
  key: keyof AgentEventTraceView,
): Partial<AgentEventTraceView> {
  const value = safeToken(payload[key]);
  return value ? { [key]: value } : {};
}

function safeTokenField(
  payload: Record<string, unknown>,
  key: keyof AgentEventTraceView,
): Partial<AgentEventTraceView> {
  const value = safeToken(payload[key]);
  return value ? { [key]: value } : {};
}

function integerField(
  payload: Record<string, unknown>,
  key: keyof AgentEventTraceView,
): Partial<AgentEventTraceView> {
  const value = payload[key];
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? { [key]: value }
    : {};
}

function shaField(
  payload: Record<string, unknown>,
  key: keyof AgentEventTraceView,
): Partial<AgentEventTraceView> {
  const value = sha256(payload[key]);
  return value ? { [key]: value } : {};
}

function safeToken(value: unknown): string | undefined {
  return typeof value === "string" && SAFE_TOKEN.test(value) ? value : undefined;
}

function sha256(value: unknown): string | undefined {
  return typeof value === "string" && SHA256.test(value) ? value : undefined;
}
