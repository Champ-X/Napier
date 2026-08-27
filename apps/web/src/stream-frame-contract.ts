import type { StreamFrame } from "@napier/contracts";

import type { NapierStreamFrameContractReason } from "./api-error";
import { isActivePlanProjection } from "./active-plan-protocol";
import { isConversationActivityCandidates } from "./conversation-activity-candidates-protocol";
import { isConversationArtifacts } from "./conversation-artifacts-protocol";
import { isConversationActivityEvents } from "./conversation-activity-events-protocol";
import { isConversationCitations } from "./conversation-citations-protocol";
import { isConversationMessages } from "./conversation-messages-protocol";
import { isConversationPlans } from "./conversation-plans-protocol";
import { isConversationRecoveries } from "./conversation-recoveries-protocol";
import { isConversationSubagents } from "./conversation-subagents-protocol";
import { isSubagentHubProjection } from "./subagent-hub-protocol";
import { isOperatorDecisions } from "./operator-decisions-protocol";
import { isRunEventRecord } from "./run-event-contract";
import { isTaskNarrativeProjection } from "./task-narrative-protocol";

const SHA256 = /^[a-f0-9]{64}$/;
export function streamFrameContractReason(
  frame: unknown,
  helpers: {
    snapshot(frame: Record<string, unknown>): boolean;
    error(frame: Record<string, unknown>): boolean;
    done(frame: Record<string, unknown>): boolean;
  },
): NapierStreamFrameContractReason | undefined {
  if (!record(frame)) return "not_object";
  const type = frame["type"];
  if (typeof type !== "string") return "missing_type";
  switch (type) {
    case "event":
      return runEventFrame(frame) ? undefined : "invalid_event";
    case "snapshot":
      return snapshotFrame(frame, helpers.snapshot)
        ? undefined
        : "invalid_snapshot";
    case "error":
      return helpers.error(frame) ? undefined : "invalid_error_message";
    case "done":
      return helpers.done(frame) ? undefined : "invalid_done";
    default:
      return "unsupported_type";
  }
}

export function isStreamFrame(
  frame: unknown,
  helpers: Parameters<typeof streamFrameContractReason>[1],
): frame is StreamFrame {
  return streamFrameContractReason(frame, helpers) === undefined;
}

function runEventFrame(frame: Record<string, unknown>): boolean {
  return (
    typeof frame["eventSha256"] === "string" &&
    SHA256.test(frame["eventSha256"]) &&
    isRunEventRecord(frame["event"]) &&
    (frame["projections"] === undefined ||
      projectionBundle(frame["projections"]))
  );
}

function projectionBundle(value: unknown, threadId?: string): boolean {
  if (!record(value)) return false;
  return (
    (value["taskNarrative"] === undefined ||
      isTaskNarrativeProjection(value["taskNarrative"])) &&
    (value["activePlan"] === undefined ||
      isActivePlanProjection(value["activePlan"])) &&
    (value["messages"] === undefined ||
      isConversationMessages(value["messages"])) &&
    (value["conversationPlans"] === undefined ||
      isConversationPlans(value["conversationPlans"])) &&
    (value["artifacts"] === undefined ||
      isConversationArtifacts(value["artifacts"])) &&
    (value["activityEvents"] === undefined ||
      isConversationActivityEvents(value["activityEvents"])) &&
    (value["activityCandidates"] === undefined ||
      isConversationActivityCandidates(value["activityCandidates"])) &&
    (value["citations"] === undefined ||
      isConversationCitations(value["citations"])) &&
    (value["recoveries"] === undefined ||
      isConversationRecoveries(value["recoveries"])) &&
    (value["subagentCards"] === undefined ||
      isConversationSubagents(value["subagentCards"])) &&
    (value["subagentHub"] === undefined ||
      isSubagentHubProjection(value["subagentHub"], threadId)) &&
    (value["operatorDecisions"] === undefined ||
      isOperatorDecisions(value["operatorDecisions"]))
  );
}

function snapshotFrame(
  frame: Record<string, unknown>,
  validate: (frame: Record<string, unknown>) => boolean,
): boolean {
  if (!validate(frame)) return false;
  const detail = frame["detail"];
  if (!record(detail)) return false;
  const thread = detail["thread"];
  const threadId = record(thread) && typeof thread["id"] === "string"
    ? thread["id"] : undefined;
  return projectionBundle(detail, threadId);
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
