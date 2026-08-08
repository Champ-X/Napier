import {
  AlertTriangle,
  CheckCircle2,
  LoaderCircle,
  RotateCcw,
  ShieldCheck,
  XCircle,
} from "lucide-react";

import type { AutomaticRecoveryBlockReason } from "@napier/contracts";
import type { ConversationRecovery } from "./conversation-recovery-view-model";

const BLOCK_REASON: Record<AutomaticRecoveryBlockReason, string> = {
  configuration_missing: "Run configuration evidence is missing.",
  legacy_configuration: "Legacy schema has no bound recovery policy.",
  policy_manual: "The frozen Agent policy requires manual Resume.",
  run_not_interrupted: "The source Run is not interrupted.",
  workflow_managed: "The source Run is resumed by its Workflow Plan.",
  demo_model: "The demo model cannot verify current state.",
  event_limit_exceeded: "The evidence range exceeds the safety limit.",
  unresolved_tool_call: "A tool start has no unique terminal outcome.",
  unsafe_tool_effect: "A write or delegated side effect was observed.",
  unknown_tool_effect: "A tool effect is not proven read-only.",
  attempt_limit_reached: "The frozen attempt limit is exhausted.",
  untrusted_recovery_chain: "The recovery chain is not trusted.",
};

export function ConversationRecoveryCard({
  item,
}: {
  item: ConversationRecovery;
}) {
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
            Retry · {statusLabel(item.status)}
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
            <li key={reason}>{BLOCK_REASON[reason]}</li>
          ))}
        </ul>
      ) : (
        <p className="conversation-recovery-guidance">
          {recoveryGuidance(item)}
        </p>
      )}
      <dl>
        <div>
          <dt>Mode</dt>
          <dd>{humanize(item.assessment.policy.mode)}</dd>
        </div>
        <div>
          <dt>Evidence</dt>
          <dd>
            {item.assessment.eventRange.eventCount} events ·{" "}
            {item.assessment.toolCalls.total} tools
          </dd>
        </div>
        <div>
          <dt>Read only</dt>
          <dd>
            {item.assessment.toolCalls.readOnly}/
            {item.assessment.toolCalls.total}
          </dd>
        </div>
        <div>
          <dt>Risk</dt>
          <dd>
            {item.assessment.toolCalls.unsafe} unsafe ·{" "}
            {item.assessment.toolCalls.unknownEffect} unknown ·{" "}
            {item.assessment.toolCalls.unresolved} unresolved
          </dd>
        </div>
        {item.settlement ? (
          <div>
            <dt>Stop</dt>
            <dd>{settlementSummary(item.settlement)}</dd>
          </div>
        ) : null}
        <div>
          <dt>Source Run</dt>
          <dd title={item.assessment.interruptedRunId}>
            {shortId(item.assessment.interruptedRunId)}
          </dd>
        </div>
        <div>
          <dt>Receipt</dt>
          <dd title={item.assessment.contentSha256}>
            {item.assessment.contentSha256.slice(0, 12)}
          </dd>
        </div>
      </dl>
    </details>
  );
}

function recoverySummary(item: ConversationRecovery): string {
  if (item.status === "skipped") return "Automatic recovery stopped safely";
  if (item.status === "completed") return "Interrupted work recovered";
  if (item.status === "claimed") return "Recovery lease claimed";
  if (item.status === "running") return "Restoring from verified evidence";
  if (item.status === "interrupted") return "Recovery Run was interrupted";
  if (item.status === "abandoned") return "Recovery claim was abandoned";
  if (item.status === "cancelled") return "Recovery Run was cancelled";
  return "Recovery attempt failed";
}

function recoveryGuidance(item: ConversationRecovery): string {
  if (item.status === "completed") {
    return "The continuation completed from a verified read-only boundary.";
  }
  if (item.status === "claimed" || item.status === "running") {
    return "Napier is reopening durable evidence without replaying side effects.";
  }
  return "The structured outcome is shown; private diagnostics remain in Trace.";
}

function statusLabel(status: ConversationRecovery["status"]): string {
  return status === "skipped" ? "blocked" : humanize(status);
}

function settlementSummary(
  settlement: NonNullable<ConversationRecovery["settlement"]>,
): string {
  if (
    settlement.budgetReason === "timeout" &&
    (settlement.limit !== undefined ||
      settlement.observedElapsedMs !== undefined)
  ) {
    return `Timeout · ${formatDuration(
      settlement.limit ?? settlement.observedElapsedMs ?? 0,
    )}`;
  }
  if (
    settlement.budgetReason === "turns" &&
    settlement.observedTurns !== undefined
  ) {
    return `Turn limit · ${settlement.observedTurns}`;
  }
  if (
    settlement.budgetReason === "tokens" &&
    settlement.observedTotalTokens !== undefined
  ) {
    return `Token limit · ${settlement.observedTotalTokens.toLocaleString()}`;
  }
  if (
    settlement.budgetReason === "cost" &&
    settlement.observedCostUsd !== undefined
  ) {
    return `Cost limit · $${settlement.observedCostUsd.toFixed(2)}`;
  }
  return humanize(settlement.budgetReason);
}

function formatDuration(milliseconds: number): string {
  const seconds = Math.max(0, Math.round(milliseconds / 1_000));
  return seconds >= 60
    ? `${Math.floor(seconds / 60)}m ${seconds % 60}s`
    : `${seconds}s`;
}

function humanize(value: string): string {
  const normalized = value.replaceAll("_", " ");
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function shortId(value: string): string {
  return value.slice(-10);
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat("en", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}
