import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  LoaderCircle,
  XCircle,
} from "lucide-react";

import type { ConversationSubagent } from "./conversation-subagent-view-model";

export function ConversationSubagentCard({
  item,
}: {
  item: ConversationSubagent;
}) {
  const Icon =
    item.task.status === "completed"
      ? CheckCircle2
      : item.task.status === "pending" || item.task.status === "running"
        ? LoaderCircle
        : item.task.status === "failed" || item.task.status === "timed_out"
          ? AlertTriangle
          : XCircle;
  const active = item.task.status === "pending" || item.task.status === "running";
  return (
    <details
      className={`conversation-subagent status-${item.task.status}`}
      open={!active && item.task.status !== "completed"}
    >
      <summary>
        <Bot size={15} aria-hidden="true" />
        <div>
          <span>
            Subagent · {item.task.role} · {item.task.status}
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
          <dt>Model</dt>
          <dd>
            {item.task.model.provider}/{item.task.model.id}
          </dd>
        </div>
        <div>
          <dt>Turns</dt>
          <dd>{item.task.turnCount}</dd>
        </div>
        <div>
          <dt>Steps</dt>
          <dd>{item.task.stepCount}</dd>
        </div>
        <div>
          <dt>Usage</dt>
          <dd>
            {(
              item.task.usage.inputTokens + item.task.usage.outputTokens
            ).toLocaleString()}{" "}
            tokens
          </dd>
        </div>
        <div>
          <dt>Outcome</dt>
          <dd>
            {item.itemCount} items · {item.evidenceCount} evidence ·{" "}
            {item.unknownCount} unknown
          </dd>
        </div>
        <div>
          <dt>Risk</dt>
          <dd>
            {item.blockerCount} blocker · {item.warningCount} warning
          </dd>
        </div>
        {item.task.stopReason ? (
          <div>
            <dt>Stop</dt>
            <dd>{humanize(item.task.stopReason)}</dd>
          </div>
        ) : null}
      </dl>
      {item.task.outcome ? (
        <section className="conversation-subagent-outcome">
          <strong>Outcome summary</strong>
          <p>{item.task.outcome.summary}</p>
          <ul>
            {item.task.outcome.items.slice(0, 5).map((outcome, index) => (
              <li className={`severity-${outcome.severity}`} key={index}>
                <span>{outcome.kind}</span>
                <strong>{outcome.title}</strong>
                <small>
                  {outcome.evidence.length} evidence · details hidden
                </small>
              </li>
            ))}
          </ul>
        </section>
      ) : item.task.error ? (
        <p className="conversation-subagent-error">
          {safeFailureSummary(item.task.status, item.task.stopReason)}
        </p>
      ) : (
        <p className="conversation-subagent-guidance">
          {active
            ? "The delegated task is running independently."
            : "No structured outcome was recorded."}
        </p>
      )}
    </details>
  );
}

function safeFailureSummary(
  status: string,
  stopReason: string | undefined,
): string {
  return `Delegation ${humanize(status)}${stopReason ? ` · ${humanize(stopReason)}` : ""}. Inspect Trace for private diagnostics.`;
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
