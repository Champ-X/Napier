import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  LoaderCircle,
  XCircle,
} from "lucide-react";

import type { ConversationSubagent } from "./conversation-subagent-view-model";
import { conversationDetailCopy } from "./conversation-detail-copy";
import { getLocale } from "./locale";
import { subagentHubCopy } from "./subagent-hub-copy";

export interface ConversationSubagentCardProps {
  item: ConversationSubagent;
  onOpenHub(taskId: string): void;
}

export function ConversationSubagentCard({
  item,
  onOpenHub,
}: ConversationSubagentCardProps) {
  const copy = conversationDetailCopy.subagent;
  const Icon =
    item.task.status === "completed"
      ? CheckCircle2
      : item.task.status === "pending" || item.task.status === "running"
        ? LoaderCircle
        : item.task.status === "failed" || item.task.status === "timed_out"
          ? AlertTriangle
          : XCircle;
  const active =
    item.task.status === "pending" || item.task.status === "running";
  return (
    <details
      className={`conversation-subagent status-${item.task.status}`}
      open={active}
    >
      <summary>
        <Bot size={15} aria-hidden="true" />
        <div>
          <span>
            {copy.label} · {copy.roles[item.task.role]} ·{" "}
            {copy.statuses[item.task.status]}
          </span>
          <strong>{item.task.description}</strong>
        </div>
        <Icon
          className={active ? "is-spinning" : ""}
          size={14}
          aria-hidden="true"
        />
        <time dateTime={item.createdAt}>{formatTime(item.createdAt)}</time>
      </summary>
      <dl>
        <div>
          <dt>{copy.model}</dt>
          <dd>
            {item.task.model.provider}/{item.task.model.id}
          </dd>
        </div>
        <div>
          <dt>{copy.turns}</dt>
          <dd>{formatNumber(item.task.turnCount)}</dd>
        </div>
        <div>
          <dt>{copy.steps}</dt>
          <dd>{formatNumber(item.task.stepCount)}</dd>
        </div>
        <div>
          <dt>{copy.usage}</dt>
          <dd>
            {formatNumber(
              item.task.usage.inputTokens + item.task.usage.outputTokens,
            )}{" "}
            {copy.tokens}
          </dd>
        </div>
        <div>
          <dt>{copy.outcome}</dt>
          <dd>
            {formatNumber(item.itemCount)} {copy.items} ·{" "}
            {formatNumber(item.evidenceCount)} {copy.evidence} ·{" "}
            {formatNumber(item.unknownCount)} {copy.unknown}
          </dd>
        </div>
        <div>
          <dt>{copy.risk}</dt>
          <dd>
            {formatNumber(item.blockerCount)} {copy.blocker} ·{" "}
            {formatNumber(item.warningCount)} {copy.warning}
          </dd>
        </div>
        {item.task.stopReason ? (
          <div>
            <dt>{copy.stop}</dt>
            <dd>{copy.stopReasons[item.task.stopReason]}</dd>
          </div>
        ) : null}
      </dl>
      <div className="conversation-subagent-actions">
        <button type="button" onClick={() => onOpenHub(item.task.id)}>
          <Bot size={13} aria-hidden="true" />
          {subagentHubCopy.openHub}
        </button>
      </div>
      {item.task.outcome ? (
        <section className="conversation-subagent-outcome">
          <strong>{copy.outcomeSummary}</strong>
          <p>{item.task.outcome.summary}</p>
          <ul>
            {item.task.outcome.items.slice(0, 5).map((outcome, index) => (
              <li className={`severity-${outcome.severity}`} key={index}>
                <span>{copy.outcomeKinds[outcome.kind]}</span>
                <strong>{outcome.title}</strong>
                <small>
                  {formatNumber(outcome.evidenceCount)} {copy.evidence} ·{" "}
                  {copy.detailsHidden}
                </small>
              </li>
            ))}
          </ul>
        </section>
      ) : item.task.hasError ? (
        <p className="conversation-subagent-error">
          {safeFailureSummary(item)}
        </p>
      ) : (
        <p className="conversation-subagent-guidance">
          {active ? copy.runningGuidance : copy.emptyGuidance}
        </p>
      )}
    </details>
  );
}

function safeFailureSummary(item: ConversationSubagent): string {
  const copy = conversationDetailCopy.subagent;
  const reason = item.task.stopReason
    ? ` · ${copy.stopReasons[item.task.stopReason]}`
    : "";
  return `${copy.failurePrefix} ${copy.statuses[item.task.status]}${reason}${copy.failureSeparator}${copy.failureGuidance}`;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat(getLocale() === "zh" ? "zh-CN" : "en").format(
    value,
  );
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat(getLocale() === "zh" ? "zh-CN" : "en", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}
