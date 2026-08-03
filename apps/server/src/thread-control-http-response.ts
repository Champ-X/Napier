import type {
  AgentMilestone,
  OperatorDecision,
  RunControlMessage,
} from "@napier/contracts";
import type { Context } from "hono";

import {
  errorMessage,
  setBodyContentSha256Header,
  setStableContentSha256Header,
} from "./http-response-evidence.js";

export function setRunControlMessageHeaders(
  context: Context,
  message: RunControlMessage,
): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, message.contentSha256);
  context.header("X-Napier-Thread-Id", message.threadId);
  context.header("X-Napier-Run-Id", message.runId);
  context.header("X-Napier-Run-Control-Message-Id", message.id);
  context.header("X-Napier-Run-Control-Mode", message.mode);
  context.header("X-Napier-Run-Control-Status", message.status);
  context.header("X-Napier-Run-Control-Text-SHA256", message.textSha256);
  context.header("X-Napier-Run-Control-Text-Bytes", String(message.textBytes));
  setOptionalNumberHeader(
    context,
    "X-Napier-Run-Control-Queued-Event-Seq",
    message.queuedEventSeq,
  );
  setOptionalNumberHeader(
    context,
    "X-Napier-Run-Control-Delivered-Event-Seq",
    message.deliveredEventSeq,
  );
  setOptionalNumberHeader(
    context,
    "X-Napier-Run-Control-Message-Event-Seq",
    message.messageEventSeq,
  );
  setOptionalNumberHeader(
    context,
    "X-Napier-Run-Control-Cancellation-Event-Seq",
    message.cancellationEventSeq,
  );
  setOptionalHeader(
    context,
    "X-Napier-Run-Control-Cancellation-Reason",
    message.cancellationReason,
  );
}

export function setRunControlMessageListHeaders(
  context: Context,
  threadId: string,
  runId: string,
  messages: RunControlMessage[],
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, messages);
  context.header("X-Napier-Thread-Id", threadId);
  context.header("X-Napier-Run-Id", runId);
  context.header("X-Napier-Run-Control-Message-Count", String(messages.length));
  for (const status of [
    "queued",
    "delivered",
    "cancelled",
  ] satisfies RunControlMessage["status"][]) {
    context.header(
      `X-Napier-Run-Control-${capitalize(status)}-Count`,
      String(messages.filter((message) => message.status === status).length),
    );
  }
  for (const mode of [
    "steering",
    "follow_up",
  ] satisfies RunControlMessage["mode"][]) {
    context.header(
      `X-Napier-Run-Control-${mode === "steering" ? "Steering" : "Follow-Up"}-Count`,
      String(messages.filter((message) => message.mode === mode).length),
    );
  }
}

export function runControlMessageErrorStatus(error: unknown): 400 | 404 | 409 {
  const message = errorMessage(error).toLowerCase();
  if (message.includes("not found")) return 404;
  return [
    "active thread run",
    "cannot be cancelled",
    "limit reached",
    "demo model",
  ].some((fragment) => message.includes(fragment))
    ? 409
    : 400;
}

export function setOperatorDecisionHeaders(
  context: Context,
  decision: OperatorDecision,
): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, decision.contentSha256);
  context.header("X-Napier-Thread-Id", decision.threadId);
  context.header("X-Napier-Run-Id", decision.runId);
  context.header("X-Napier-Operator-Decision-Id", decision.id);
  context.header("X-Napier-Operator-Decision-Status", decision.status);
  context.header(
    "X-Napier-Operator-Decision-Question-SHA256",
    decision.questionSha256,
  );
  context.header(
    "X-Napier-Operator-Decision-Option-Count",
    String(decision.options.length),
  );
  setOptionalNumberHeader(
    context,
    "X-Napier-Operator-Decision-Requested-Event-Seq",
    decision.requestedEventSeq,
  );
  setOptionalNumberHeader(
    context,
    "X-Napier-Operator-Decision-Answered-Event-Seq",
    decision.answeredEventSeq,
  );
  setOptionalNumberHeader(
    context,
    "X-Napier-Operator-Decision-Continued-Event-Seq",
    decision.continuedEventSeq,
  );
  setOptionalNumberHeader(
    context,
    "X-Napier-Operator-Decision-Cancellation-Event-Seq",
    decision.cancellationEventSeq,
  );
  setOptionalHeader(
    context,
    "X-Napier-Operator-Decision-Answer-SHA256",
    decision.answerSha256,
  );
  setOptionalHeader(
    context,
    "X-Napier-Operator-Decision-Continuation-Run-Id",
    decision.continuationRunId,
  );
  setOptionalHeader(
    context,
    "X-Napier-Operator-Decision-Cancellation-Reason",
    decision.cancellationReason,
  );
}

export function setOperatorDecisionListHeaders(
  context: Context,
  threadId: string,
  decisions: OperatorDecision[],
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, decisions);
  context.header("X-Napier-Thread-Id", threadId);
  context.header("X-Napier-Operator-Decision-Count", String(decisions.length));
  for (const status of [
    "pending",
    "answered",
    "continued",
    "cancelled",
  ] satisfies OperatorDecision["status"][]) {
    context.header(
      `X-Napier-Operator-Decision-${capitalize(status)}-Count`,
      String(decisions.filter((decision) => decision.status === status).length),
    );
  }
}

export function setAgentMilestoneListHeaders(
  context: Context,
  threadId: string,
  milestones: AgentMilestone[],
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, milestones);
  context.header("X-Napier-Thread-Id", threadId);
  context.header("X-Napier-Agent-Milestone-Count", String(milestones.length));
  context.header(
    "X-Napier-Agent-Milestone-Evidence-Event-Count",
    String(
      milestones.reduce(
        (total, milestone) => total + milestone.evidence.eventCount,
        0,
      ),
    ),
  );
  const latest = milestones.at(-1);
  setOptionalHeader(context, "X-Napier-Agent-Milestone-Latest-Id", latest?.id);
  setOptionalHeader(
    context,
    "X-Napier-Agent-Milestone-Latest-Content-SHA256",
    latest?.contentSha256,
  );
  for (const phase of [
    "planning",
    "execution",
    "verification",
    "delivery",
  ] satisfies AgentMilestone["phase"][]) {
    context.header(
      `X-Napier-Agent-Milestone-${capitalize(phase)}-Count`,
      String(
        milestones.filter((milestone) => milestone.phase === phase).length,
      ),
    );
  }
}

export function operatorDecisionErrorStatus(error: unknown): 400 | 404 | 409 {
  const message = errorMessage(error).toLowerCase();
  if (message.includes("not found")) return 404;
  return [
    "requires a waiting thread",
    "already been answered",
    "cannot be answered",
    "cannot be cancelled",
    "cannot continue",
    "while the thread is running",
  ].some((fragment) => message.includes(fragment))
    ? 409
    : 400;
}

function setOptionalHeader(
  context: Context,
  name: string,
  value: string | undefined,
): void {
  if (value !== undefined) context.header(name, value);
}

function setOptionalNumberHeader(
  context: Context,
  name: string,
  value: number | undefined,
): void {
  if (value !== undefined) context.header(name, String(value));
}

function capitalize(value: string): string {
  return `${value[0]!.toUpperCase()}${value.slice(1)}`;
}
