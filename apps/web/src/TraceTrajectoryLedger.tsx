import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";

import type {
  TraceTrajectoryEvent,
  TraceTrajectoryRun,
} from "./trace-trajectory-model";
import { copy } from "./copy";
import { getLocale } from "./locale";
import { traceTrajectoryCopy } from "./trace-trajectory-copy";

const TRACE_EVENT_WINDOW = 180;

export interface TraceTrajectoryRunSectionProps {
  run: TraceTrajectoryRun;
  selectedEventId: string | undefined;
  visibleEventIds: Set<string>;
  forceOpen: boolean;
  latest: boolean;
  onSelect: (eventId: string) => void;
}

export function TraceTrajectoryRunSection({
  run,
  selectedEventId,
  visibleEventIds,
  forceOpen,
  latest,
  onSelect,
}: TraceTrajectoryRunSectionProps) {
  const [collapsed, setCollapsed] = useState(
    !latest && run.status !== "running",
  );
  const [eventLimit, setEventLimit] = useState(TRACE_EVENT_WINDOW);
  const matchingTurns = run.turns
    .map((turn) => ({
      ...turn,
      events: turn.events.filter((event) =>
        visibleEventIds.has(event.event.id),
      ),
    }))
    .filter((turn) => turn.events.length > 0);
  const matchingEventCount = matchingTurns.reduce(
    (total, turn) => total + turn.events.length,
    0,
  );
  const visibleTurns = traceTurnWindow(matchingTurns, eventLimit);
  const hiddenEventCount = Math.max(0, matchingEventCount - eventLimit);
  const open = forceOpen ? true : !collapsed;
  const selectedInRun = Boolean(
    selectedEventId &&
    matchingTurns.some((turn) =>
      turn.events.some((event) => event.event.id === selectedEventId),
    ),
  );
  useEffect(() => setEventLimit(TRACE_EVENT_WINDOW), [run.id]);
  useEffect(() => {
    if (selectedInRun) setEventLimit(matchingEventCount);
  }, [matchingEventCount, selectedInRun]);
  if (matchingTurns.length === 0) return null;
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
          <strong>
            {traceTrajectoryCopy.run} {formatNumber(run.ordinal)}
          </strong>
          <small>{shortRunId(run.id)}</small>
        </span>
        <span className="trace-run-meta">
          <small>{formatTraceDuration(run.durationMs)}</small>
          <i>{traceTrajectoryCopy.statuses[run.status]}</i>
        </span>
        <ChevronDown size={13} aria-hidden="true" />
      </button>
      {open ? (
        <div className="trace-run-turns">
          {hiddenEventCount > 0 ? (
            <button
              className="trace-show-earlier"
              type="button"
              onClick={() =>
                setEventLimit((current) => current + TRACE_EVENT_WINDOW)
              }
            >
              {copy.trace.showEarlier} · {hiddenEventCount}
            </button>
          ) : null}
          {visibleTurns.map((turn) => (
            <section className="trace-turn" key={turn.index}>
              <header>
                <span>
                  {turn.index === 0
                    ? traceTrajectoryCopy.setup
                    : `${traceTrajectoryCopy.turn} ${formatNumber(turn.index)}`}
                </span>
                <small>
                  {formatNumber(turn.events.length)}{" "}
                  {traceTrajectoryCopy.events}
                </small>
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

export function traceTurnWindow(
  turns: TraceTrajectoryRun["turns"],
  limit: number,
): TraceTrajectoryRun["turns"] {
  const visible: TraceTrajectoryRun["turns"] = [];
  let remaining = Math.max(0, limit);
  for (let index = turns.length - 1; index >= 0 && remaining > 0; index -= 1) {
    const turn = turns[index]!;
    const events = turn.events.slice(-remaining);
    if (events.length > 0) visible.unshift({ ...turn, events });
    remaining -= events.length;
  }
  return visible;
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
            <i className={`status-${event.status}`}>
              {traceTrajectoryCopy.statuses[event.status]}
            </i>
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
    [traceTrajectoryCopy.audit.type, event.event.type],
    [traceTrajectoryCopy.audit.role, event.role],
    [traceTrajectoryCopy.audit.lane, traceTrajectoryCopy.lanes[event.lane]],
    ...(event.callOrdinal
      ? [[traceTrajectoryCopy.audit.call, `C${event.callOrdinal}`]]
      : []),
    [
      traceTrajectoryCopy.audit.summary,
      traceTrajectoryCopy.summarySources[event.summarySource],
    ],
    [traceTrajectoryCopy.audit.run, shortRunId(event.event.runId)],
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
  const units = traceTrajectoryCopy.durationUnits;
  if (milliseconds < 1_000) {
    return `${formatNumber(Math.round(milliseconds))}${units.milliseconds}`;
  }
  const seconds = milliseconds / 1_000;
  if (seconds < 60) {
    return `${formatDecimal(seconds, seconds < 10 ? 1 : 0)}${units.seconds}`;
  }
  const minutes = Math.floor(seconds / 60);
  return `${formatNumber(minutes)}${units.minutes} ${formatNumber(
    Math.round(seconds % 60),
  )}${units.seconds}`;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat(getLocale() === "zh" ? "zh-CN" : "en").format(
    value,
  );
}

function formatDecimal(value: number, digits: number): string {
  return new Intl.NumberFormat(getLocale() === "zh" ? "zh-CN" : "en", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
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
