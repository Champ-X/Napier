import { useEffect, useState, type ReactNode } from "react";
import {
  Activity,
  BookOpen,
  Box,
  Cable,
  Clock,
  Command,
  Download,
  Layers,
  ShieldCheck,
  Sparkles,
  Target,
  Upload,
} from "lucide-react";

import type { RunEvent, RunRecord, SubagentTask } from "@napier/contracts";

import { copy } from "./copy";
import type {
  OpenTelemetryTraceReceipt,
  OpenTelemetryTraceVerificationReceipt,
} from "./use-workspace-view-model";

export default function TracePanel({
  events,
  subagents,
  runs,
  running,
  exportBusy,
  exportReceipt,
  verifyBusy,
  verificationReceipt,
  onExport,
  onVerify,
}: {
  events: RunEvent[];
  subagents: SubagentTask[];
  runs: RunRecord[];
  running: boolean;
  exportBusy: boolean;
  exportReceipt: OpenTelemetryTraceReceipt | undefined;
  verifyBusy: boolean;
  verificationReceipt: OpenTelemetryTraceVerificationReceipt | undefined;
  onExport: (runId?: string) => void;
  onVerify: (file: File) => void;
}) {
  const [exportRunId, setExportRunId] = useState("");

  useEffect(() => {
    if (exportRunId && !runs.some((run) => run.id === exportRunId)) {
      setExportRunId("");
    }
  }, [exportRunId, runs]);

  return (
    <section className="panel-section" aria-labelledby="trace-title">
      <div className="panel-heading">
        <div>
          <span>{copy.trace.sequence}</span>
          <h2 id="trace-title">{copy.trace.title}</h2>
        </div>
        <span className={`live-index ${running ? "is-live" : ""}`}>
          {running ? "LIVE" : "REC"}
        </span>
      </div>
      <section className="otel-export-card" aria-labelledby="otel-export-title">
        <header>
          <div>
            <span>{copy.trace.otel.eyebrow}</span>
            <h3 id="otel-export-title">{copy.trace.otel.title}</h3>
          </div>
          <Activity size={14} aria-hidden="true" />
        </header>
        <p>{copy.trace.otel.body}</p>
        <div className="otel-export-controls">
          <label>
            <span>{copy.trace.otel.scope}</span>
            <select
              value={exportRunId}
              disabled={exportBusy}
              onChange={(event) => setExportRunId(event.target.value)}
            >
              <option value="">{copy.trace.otel.threadScope}</option>
              {runs
                .slice()
                .reverse()
                .map((run, index) => (
                  <option key={run.id} value={run.id}>
                    {copy.trace.otel.runScope}{" "}
                    {String(runs.length - index).padStart(2, "0")} /{" "}
                    {run.status}
                  </option>
                ))}
            </select>
          </label>
          <button
            type="button"
            disabled={exportBusy}
            onClick={() => onExport(exportRunId || undefined)}
          >
            <Download size={11} aria-hidden="true" />
            {exportBusy ? copy.trace.otel.exporting : copy.trace.otel.export}
          </button>
          <label className="otel-file-action" aria-disabled={verifyBusy}>
            <Upload size={11} aria-hidden="true" />
            {verifyBusy ? copy.trace.otel.verifying : copy.trace.otel.verify}
            <input
              type="file"
              accept="application/json,.json"
              disabled={verifyBusy}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = "";
                if (file) onVerify(file);
              }}
            />
          </label>
        </div>
        {exportReceipt ? (
          <output className="otel-export-receipt" aria-live="polite">
            <span>
              <strong>{copy.trace.otel.exported}</strong>
              <small>
                {exportReceipt.scope === "thread"
                  ? copy.trace.otel.threadScope
                  : copy.trace.otel.runScope}
              </small>
            </span>
            <span>
              <small>{copy.trace.otel.spans}</small>
              <strong>{exportReceipt.spanCount}</strong>
            </span>
            <span>
              <small>{copy.trace.otel.events}</small>
              <strong>{exportReceipt.eventCount}</strong>
            </span>
            <code title={exportReceipt.contentSha256}>
              {exportReceipt.contentSha256.slice(0, 12)}
            </code>
          </output>
        ) : null}
        {verificationReceipt ? (
          <output
            className={`otel-export-receipt status-${verificationReceipt.status}`}
            aria-live="polite"
          >
            <span>
              <strong>
                {verificationReceipt.status === "valid"
                  ? copy.trace.otel.verified
                  : copy.trace.otel.invalid}
              </strong>
              <small>
                {verificationReceipt.diagnostics.length > 0
                  ? verificationReceipt.diagnostics.join(", ")
                  : copy.trace.otel.noDiagnostics}
              </small>
            </span>
            <span>
              <small>{copy.trace.otel.spans}</small>
              <strong>{verificationReceipt.spanCount}</strong>
            </span>
            <span>
              <small>{copy.trace.otel.events}</small>
              <strong>{verificationReceipt.eventCount}</strong>
            </span>
            {verificationReceipt.contentSha256 ? (
              <code title={verificationReceipt.contentSha256}>
                {verificationReceipt.contentSha256.slice(0, 12)}
              </code>
            ) : null}
          </output>
        ) : null}
        <p className="otel-export-safety">
          <ShieldCheck size={10} aria-hidden="true" />
          {copy.trace.otel.safety}
        </p>
      </section>
      <DelegationLedger tasks={subagents} />
      {events.length === 0 ? (
        <p className="empty-panel">{copy.trace.empty}</p>
      ) : null}
      <ol className="trace-list">
        {events.map((event) => (
          <li key={event.id}>
            <div className={`trace-icon category-${event.category}`}>
              {eventIcon(event.category)}
            </div>
            <div className="trace-copy">
              <div>
                <strong>{eventLabel(event.type)}</strong>
                <span>#{String(event.seq).padStart(3, "0")}</span>
              </div>
              <p>{eventSummary(event)}</p>
              <time dateTime={event.createdAt}>
                {formatTime(event.createdAt)}
              </time>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function DelegationLedger({ tasks }: { tasks: SubagentTask[] }) {
  if (tasks.length === 0) return null;
  return (
    <section className="delegation-ledger" aria-labelledby="delegation-title">
      <header className="delegation-heading">
        <div>
          <span>{copy.delegation.eyebrow}</span>
          <h3 id="delegation-title">{copy.delegation.title}</h3>
        </div>
        <span>{String(tasks.length).padStart(2, "0")}</span>
      </header>
      <div className="delegation-list">
        {tasks
          .slice()
          .reverse()
          .map((task) => {
            const summary =
              task.error ?? task.outcome?.summary ?? task.result ?? task.prompt;
            const summaryLabel = task.error
              ? copy.delegation.error
              : task.outcome
                ? copy.delegation.outcome
                : task.result
                  ? copy.delegation.result
                  : copy.delegation.prompt;
            return (
              <article
                className={`delegation-card delegation-${task.status}`}
                key={task.id}
              >
                <header>
                  <span className="delegation-role">
                    <Layers size={11} aria-hidden="true" />
                    {task.role}
                  </span>
                  <span className="delegation-state">
                    {delegationStatusLabel(task.status)}
                  </span>
                </header>
                <h4>{task.description}</h4>
                <div className="delegation-result">
                  <span>{summaryLabel}</span>
                  <p>{summary}</p>
                </div>
                <footer>
                  <dl>
                    <div>
                      <dt>{copy.delegation.turns}</dt>
                      <dd>{task.turnCount}</dd>
                    </div>
                    <div>
                      <dt>{copy.delegation.steps}</dt>
                      <dd>{task.stepCount}</dd>
                    </div>
                    {task.outcome ? (
                      <>
                        <div>
                          <dt>{copy.delegation.items}</dt>
                          <dd>{task.outcome.itemCount}</dd>
                        </div>
                        <div>
                          <dt>{copy.delegation.evidence}</dt>
                          <dd>{task.outcome.evidenceCount ?? 0}</dd>
                        </div>
                        <div>
                          <dt>{copy.delegation.unknowns}</dt>
                          <dd>{task.outcome.unknownCount}</dd>
                        </div>
                      </>
                    ) : null}
                  </dl>
                  <code title={task.outcome?.contentSha256}>
                    {task.model.provider}/{task.model.id}
                    {task.outcome
                      ? ` · ${copy.delegation.receipt} ${task.outcome.contentSha256.slice(0, 10)}`
                      : ""}
                  </code>
                </footer>
              </article>
            );
          })}
      </div>
    </section>
  );
}

function eventIcon(category: RunEvent["category"]): ReactNode {
  if (category === "message") return <BookOpen size={13} />;
  if (category === "tool") return <Command size={13} />;
  if (category === "subagent") return <Layers size={13} />;
  if (category === "extension") return <Cable size={13} />;
  if (category === "goal") return <Target size={13} />;
  if (category === "model") return <Sparkles size={13} />;
  if (category === "artifact") return <Box size={13} />;
  if (category === "lifecycle") return <Clock size={13} />;
  return <Activity size={13} />;
}

function eventLabel(type: string): string {
  return type
    .split(".")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function eventSummary(event: RunEvent): string {
  if (
    !event.payload ||
    Array.isArray(event.payload) ||
    typeof event.payload !== "object"
  ) {
    return event.category;
  }
  if (event.type === "trace.otlp.exported") {
    const scope = event.payload["scope"];
    const spanCount = event.payload["spanCount"];
    if (typeof scope === "string" && typeof spanCount === "number") {
      return `${scope} / ${spanCount} spans`;
    }
  }
  for (const key of [
    "text",
    "message",
    "reason",
    "objective",
    "model",
    "source",
    "description",
    "result",
    "summary",
    "error",
    "toolName",
    "name",
    "trustStatus",
    "status",
  ]) {
    const value = event.payload[key];
    if (typeof value === "string" && value.trim()) {
      return value.replace(/\s+/g, " ").trim().slice(0, 100);
    }
  }
  return event.category;
}

function delegationStatusLabel(status: SubagentTask["status"]): string {
  return copy.delegation.statuses[status];
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
