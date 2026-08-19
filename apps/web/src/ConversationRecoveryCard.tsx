import {
  AlertTriangle,
  CheckCircle2,
  LoaderCircle,
  RotateCcw,
  ShieldCheck,
  XCircle,
} from "lucide-react";

import { conversationDetailCopy } from "./conversation-detail-copy";
import type { ConversationRecovery } from "./conversation-recovery-view-model";
import { getLocale } from "./locale";

export interface ConversationRecoveryCardProps {
  item: ConversationRecovery;
}

export function ConversationRecoveryCard({
  item,
}: ConversationRecoveryCardProps) {
  const copy = conversationDetailCopy.recovery;
  const active = item.status === "claimed" || item.status === "running";
  const Icon =
    item.status === "completed"
      ? CheckCircle2
      : active
        ? LoaderCircle
        : item.status === "skipped"
          ? ShieldCheck
          : item.status === "failed" ||
              item.status === "interrupted" ||
              item.status === "abandoned"
            ? AlertTriangle
            : XCircle;
  return (
    <details
      className={`conversation-recovery status-${item.status}`}
      open={!active && item.status !== "completed"}
    >
      <summary>
        <RotateCcw size={15} aria-hidden="true" />
        <div>
          <span>
            {copy.label} · {copy.statuses[item.status]}
            {item.attempt
              ? ` · ${item.attempt.attempt}/${item.attempt.maxAttempts}`
              : ""}
          </span>
          <strong>{recoverySummary(item)}</strong>
        </div>
        <Icon
          className={active ? "is-spinning" : ""}
          size={14}
          aria-hidden="true"
        />
        <time dateTime={item.createdAt}>{formatTime(item.createdAt)}</time>
      </summary>
      {item.assessment.blockReasons.length > 0 ? (
        <ul className="conversation-recovery-blockers">
          {item.assessment.blockReasons.map((reason) => (
            <li key={reason}>{copy.blockReasons[reason]}</li>
          ))}
        </ul>
      ) : (
        <p className="conversation-recovery-guidance">
          {recoveryGuidance(item)}
        </p>
      )}
      <dl>
        <div>
          <dt>{copy.mode}</dt>
          <dd>{copy.modes[item.assessment.policy.mode]}</dd>
        </div>
        <div>
          <dt>{copy.evidence}</dt>
          <dd>
            {formatNumber(item.assessment.eventRange.eventCount)} {copy.events}{" "}
            · {formatNumber(item.assessment.toolCalls.total)} {copy.tools}
          </dd>
        </div>
        <div>
          <dt>{copy.readOnly}</dt>
          <dd>
            {formatNumber(item.assessment.toolCalls.readOnly)}/
            {formatNumber(item.assessment.toolCalls.total)}
          </dd>
        </div>
        <div>
          <dt>{copy.risk}</dt>
          <dd>
            {formatNumber(item.assessment.toolCalls.unsafe)} {copy.unsafe} ·{" "}
            {formatNumber(item.assessment.toolCalls.unknownEffect)}{" "}
            {copy.unknown} ·{" "}
            {formatNumber(item.assessment.toolCalls.unresolved)}{" "}
            {copy.unresolved}
          </dd>
        </div>
        {item.settlement ? (
          <div>
            <dt>{copy.stop}</dt>
            <dd>{settlementSummary(item.settlement)}</dd>
          </div>
        ) : null}
        <div>
          <dt>{copy.sourceRun}</dt>
          <dd title={item.assessment.interruptedRunId}>
            {shortId(item.assessment.interruptedRunId)}
          </dd>
        </div>
        <div>
          <dt>{copy.receipt}</dt>
          <dd title={item.assessment.contentSha256}>
            {item.assessment.contentSha256.slice(0, 12)}
          </dd>
        </div>
      </dl>
    </details>
  );
}

function recoverySummary(item: ConversationRecovery): string {
  return conversationDetailCopy.recovery.summaries[item.status];
}

function recoveryGuidance(item: ConversationRecovery): string {
  const copy = conversationDetailCopy.recovery;
  if (item.status === "completed") {
    return copy.completedGuidance;
  }
  if (item.status === "claimed" || item.status === "running") {
    return copy.activeGuidance;
  }
  return copy.traceGuidance;
}

function settlementSummary(
  settlement: NonNullable<ConversationRecovery["settlement"]>,
): string {
  const copy = conversationDetailCopy.recovery.settlement;
  if (
    settlement.budgetReason === "timeout" &&
    (settlement.limit !== undefined ||
      settlement.observedElapsedMs !== undefined)
  ) {
    return `${copy.timeout} · ${formatDuration(
      settlement.limit ?? settlement.observedElapsedMs ?? 0,
    )}`;
  }
  if (
    settlement.budgetReason === "turns" &&
    settlement.observedTurns !== undefined
  ) {
    return `${copy.turns} · ${formatNumber(settlement.observedTurns)}`;
  }
  if (
    settlement.budgetReason === "tokens" &&
    settlement.observedTotalTokens !== undefined
  ) {
    return `${copy.tokens} · ${formatNumber(settlement.observedTotalTokens)}`;
  }
  if (
    settlement.budgetReason === "cost" &&
    settlement.observedCostUsd !== undefined
  ) {
    return `${copy.cost} · ${formatCurrency(settlement.observedCostUsd)}`;
  }
  return copy[settlement.budgetReason];
}

function formatDuration(milliseconds: number): string {
  const seconds = Math.max(0, Math.round(milliseconds / 1_000));
  const copy = conversationDetailCopy.recovery.settlement;
  return seconds >= 60
    ? `${formatNumber(Math.floor(seconds / 60))}${copy.minutes} ${formatNumber(
        seconds % 60,
      )}${copy.seconds}`
    : `${formatNumber(seconds)}${copy.seconds}`;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat(getLocale() === "zh" ? "zh-CN" : "en").format(
    value,
  );
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat(getLocale() === "zh" ? "zh-CN" : "en", {
    style: "currency",
    currency: "USD",
  }).format(value);
}

function shortId(value: string): string {
  return value.slice(-10);
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat(getLocale() === "zh" ? "zh-CN" : "en", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}
