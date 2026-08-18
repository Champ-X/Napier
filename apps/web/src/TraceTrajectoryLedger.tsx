import { useState } from "react";
import { ChevronDown } from "lucide-react";

import type {
  TraceTrajectoryEvent,
  TraceTrajectoryRun,
} from "./trace-trajectory-model";

export function TraceTrajectoryRunSection({
  run,
  selectedEventId,
  visibleEventIds,
  forceOpen,
  latest,
  onSelect,
}: {
  run: TraceTrajectoryRun;
  selectedEventId: string | undefined;
  visibleEventIds: Set<string>;
  forceOpen: boolean;
  latest: boolean;
  onSelect: (eventId: string) => void;
}) {
  const [collapsed, setCollapsed] = useState(
    !latest && run.status !== "running",
  );
  const matchingTurns = run.turns
    .map((turn) => ({
      ...turn,
      events: turn.events.filter((event) =>
        visibleEventIds.has(event.event.id),
      ),
    }))
    .filter((turn) => turn.events.length > 0);
  if (matchingTurns.length === 0) return null;
  const open = forceOpen ? true : !collapsed;
  return (
    <article className={`trace-run status-${run.status}`}>
      <button
        type="button"
        className="trace-run-heading"
        aria-expanded={open}
        onClick={() => setCollapsed((value) => !value)}
      >
        <span className="trace-run-ordinal">
          {String(run.ordinal).padStart(2, "0")}
        </span>
        <span>
          <strong>Run {String(run.ordinal)}</strong>
          <small>{shortRunId(run.id)}</small>
        </span>
        <span className="trace-run-meta">
          <small>{formatTraceDuration(run.durationMs)}</small>
          <i>{run.status}</i>
        </span>
        <ChevronDown size={13} aria-hidden="true" />
      </button>
      {open ? (
        <div className="trace-run-turns">
          {matchingTurns.map((turn) => (
            <section className="trace-turn" key={turn.index}>
              <header>
                <span>{turn.label}</span>
                <small>{turn.events.length} events</small>
              </header>
              <ol>
                {turn.events.map((event) => (
                  <TraceTrajectoryEventRow
                    key={event.event.id}
                    event={event}
                    selected={event.event.id === selectedEventId}
                    onSelect={onSelect}
                  />
                ))}
              </ol>
            </section>
          ))}
        </div>
      ) : null}
    </article>
  );
}

function TraceTrajectoryEventRow({
  event,
  selected,
  onSelect,
}: {
  event: TraceTrajectoryEvent;
  selected: boolean;
  onSelect: (eventId: string) => void;
}) {
  return (
    <li
      id={`trace-event-${event.event.id}`}
      className={[`lane-${event.lane}`, selected ? "is-selected" : ""].join(
        " ",
      )}
    >
      <button type="button" onClick={() => onSelect(event.event.id)}>
        <span className="trace-event-sequence">
          <i />#{String(event.event.seq).padStart(3, "0")}
        </span>
        <span className="trace-event-copy">
          <span className="trace-event-title">
            <strong>{event.label}</strong>
            <i className={`status-${event.status}`}>{event.status}</i>
          </span>
          <small>{event.summary}</small>
        </span>
        <span className="trace-event-meta">
          {event.durationMs !== undefined ? (
            <strong>{formatTraceDuration(event.durationMs)}</strong>
          ) : null}
          <time dateTime={event.event.createdAt}>
            {formatTimestamp(event.event.createdAt)}
          </time>
          <ChevronDown size={15} aria-hidden="true" />
        </span>
      </button>
      {selected ? <TraceEventAudit event={event} /> : null}
    </li>
  );
}

function TraceEventAudit({ event }: { event: TraceTrajectoryEvent }) {
  const items = [
    ["Type", event.event.type],
    ["Role", event.role],
    ["Lane", event.lane],
    ...(event.callOrdinal ? [["Call", `C${event.callOrdinal}`]] : []),
    ["Summary", event.summarySource],
    ["Run", shortRunId(event.event.runId)],
  ];
  return (
    <div className="trace-event-audit">
      {items.map(([label, value]) => (
        <span key={label}>
          <small>{label}</small>
          <strong>{value}</strong>
        </span>
      ))}
    </div>
  );
}

export function formatTraceDuration(milliseconds: number): string {
  if (milliseconds < 1_000) return `${Math.round(milliseconds)}ms`;
  const seconds = milliseconds / 1_000;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes)}m ${String(Math.round(seconds % 60))}s`;
}

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

function shortRunId(runId: string): string {
  return runId.length > 17 ? `${runId.slice(0, 8)}…${runId.slice(-6)}` : runId;
}
