import {
  Ban,
  CheckCircle2,
  CircleHelp,
  Clock3,
  PlayCircle,
} from "lucide-react";

import type { ConversationApproval } from "./conversation-approval-view-model";

export function ConversationApprovalCard({
  approval,
}: {
  approval: ConversationApproval;
}) {
  const Icon =
    approval.decision.status === "pending"
      ? Clock3
      : approval.decision.status === "answered"
        ? CheckCircle2
        : approval.decision.status === "continued"
          ? PlayCircle
          : Ban;
  return (
    <details
      className={`conversation-approval status-${approval.decision.status}`}
      open={
        approval.decision.status === "pending" ||
        approval.decision.status === "answered"
      }
    >
      <summary>
        <CircleHelp size={15} aria-hidden="true" />
        <div>
          <span>Approval · {approval.decision.status}</span>
          <strong>{approval.decision.header}</strong>
        </div>
        <Icon size={14} aria-hidden="true" />
        <time dateTime={approval.createdAt}>
          {formatTime(approval.createdAt)}
        </time>
      </summary>
      <p className="conversation-approval-question">
        {approval.decision.question}
      </p>
      <ul>
        {approval.decision.options.map((option) => (
          <li
            className={
              approval.selectedLabels.includes(option.label)
                ? "is-selected"
                : undefined
            }
            key={option.id}
          >
            <strong>{option.label}</strong>
            <span>{option.description}</span>
          </li>
        ))}
      </ul>
      <dl>
        <div>
          <dt>Mode</dt>
          <dd>
            {approval.decision.multiSelect ? "Multiple choices" : "Single choice"}
          </dd>
        </div>
        <div>
          <dt>Selected</dt>
          <dd>
            {approval.selectedLabels.length > 0
              ? approval.selectedLabels.join(", ")
              : "None"}
          </dd>
        </div>
        {approval.customAnswerRecorded ? (
          <div>
            <dt>Custom answer</dt>
            <dd>Recorded · content hidden</dd>
          </div>
        ) : null}
        {approval.decision.cancellationReason ? (
          <div>
            <dt>Reason</dt>
            <dd>{humanize(approval.decision.cancellationReason)}</dd>
          </div>
        ) : null}
      </dl>
      <p className="conversation-approval-guidance">
        {approvalGuidance(approval)}
      </p>
    </details>
  );
}

function approvalGuidance(approval: ConversationApproval): string {
  if (approval.decision.status === "pending") {
    return "Operator input is required before the Run can continue.";
  }
  if (approval.decision.status === "answered") {
    return "Answer recorded. Continue the Run from the active approval panel.";
  }
  if (approval.decision.status === "continued") {
    return "The answer was accepted and execution continued.";
  }
  return "The approval was cancelled; no continuation was started.";
}

function humanize(value: string): string {
  const normalized = value.replaceAll("_", " ");
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat("en", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}
