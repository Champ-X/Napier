import {
  Ban,
  CheckCircle2,
  CircleHelp,
  Clock3,
  PlayCircle,
} from "lucide-react";

import type { ConversationApproval } from "./conversation-approval-view-model";
import { getLocale } from "./locale";
import { taskSurfaceCopy } from "./task-surface-copy";

export interface ConversationApprovalCardProps {
  approval: ConversationApproval;
}

export function ConversationApprovalCard({
  approval,
}: ConversationApprovalCardProps) {
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
          <span>
            {taskSurfaceCopy.approval.label} ·{" "}
            {taskSurfaceCopy.approval.statuses[approval.decision.status]}
          </span>
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
          <dt>{taskSurfaceCopy.approval.mode}</dt>
          <dd>
            {approval.decision.multiSelect
              ? taskSurfaceCopy.approval.multiple
              : taskSurfaceCopy.approval.single}
          </dd>
        </div>
        <div>
          <dt>{taskSurfaceCopy.approval.selected}</dt>
          <dd>
            {approval.selectedLabels.length > 0
              ? approval.selectedLabels.join(", ")
              : taskSurfaceCopy.approval.none}
          </dd>
        </div>
        {approval.customAnswerRecorded ? (
          <div>
            <dt>{taskSurfaceCopy.approval.customAnswer}</dt>
            <dd>{taskSurfaceCopy.approval.recordedHidden}</dd>
          </div>
        ) : null}
        {approval.decision.cancellationReason ? (
          <div>
            <dt>{taskSurfaceCopy.approval.reason}</dt>
            <dd>
              {
                taskSurfaceCopy.approval.cancellationReasons[
                  approval.decision.cancellationReason
                ]
              }
            </dd>
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
  return taskSurfaceCopy.approval.guidance[approval.decision.status];
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat(getLocale() === "zh" ? "zh-CN" : "en", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}
