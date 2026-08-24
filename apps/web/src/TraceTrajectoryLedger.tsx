import { useEffect, useState } from "react";
import { ChevronDown, Layers } from "lucide-react";

import type {
  TraceTrajectoryEvent,
  TraceTrajectoryLane,
  TraceTrajectoryRun,
} from "./trace-trajectory-model";
import { copy } from "./copy";
import { getLocale } from "./locale";
import { traceTrajectoryCopy } from "./trace-trajectory-copy";
import { traceTrajectorySummarySegments } from "./trace-trajectory-presentation";
import {
  buildTraceRunSemanticView,
  TRACE_SEMANTIC_ROW_BUDGET,
  type TraceSemanticFoldRow,
} from "./trace-semantic-rows";

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
  const [rowLimit, setRowLimit] = useState(TRACE_SEMANTIC_ROW_BUDGET);
  const matchingTurns = run.turns
    .map((turn) => ({
      ...turn,
      events: turn.events.filter((event) =>
        visibleEventIds.has(event.event.id),
      ),
    }))
    .filter((turn) => turn.events.length > 0);
  const view = buildTraceRunSemanticView(matchingTurns, {
    maxRows: rowLimit,
    selectedEventId,
  });
  const open = forceOpen ? true : !collapsed;
  const selectedInRun = Boolean(
    selectedEventId &&
    matchingTurns.some((turn) =>
      turn.events.some((event) => event.event.id === selectedEventId),
    ),
  );
  useEffect(() => setRowLimit(TRACE_SEMANTIC_ROW_BUDGET), [run.id]);
  useEffect(() => {
    if (selectedInRun) setRowLimit(view.totalRowCount);
  }, [selectedInRun, view.totalRowCount]);
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
        <div
          className="trace-run-turns"
          role="table"
          aria-label={traceTrajectoryCopy.rows}
          aria-rowcount={view.totalRowCount}
        >
          {view.hiddenRowCount > 0 ? (
            <button
              className="trace-show-earlier"
              type="button"
              onClick={() =>
                setRowLimit((current) => current + TRACE_SEMANTIC_ROW_BUDGET)
              }
            >
              {copy.trace.showEarlier} · {formatNumber(view.hiddenEventCount)}
            </button>
          ) : null}
          {view.turns.map((turn) => (
            <section className="trace-turn" role="presentation" key={turn.index}>
              <header>
                <span>
                  {turn.index === 0
                    ? traceTrajectoryCopy.setup
                    : `${traceTrajectoryCopy.turn} ${formatNumber(turn.index)}`}
                </span>
                <small>
                  {formatNumber(turn.eventCount)}{" "}
                  {traceTrajectoryCopy.events}
                </small>
              </header>
              <ol
                role="rowgroup"
                aria-label={
                  turn.index === 0
                    ? traceTrajectoryCopy.setup
                    : `${traceTrajectoryCopy.turn} ${formatNumber(turn.index)}`
                }
              >
                {turn.rows.map((row) =>
                  row.kind === "fold" ? (
                    <TraceTrajectoryFoldRow key={row.key} row={row} />
                  ) : (
                    <TraceTrajectoryEventRow
                      key={row.key}
                      rowIndex={row.rowIndex}
                      event={row.event}
                      selected={row.event.event.id === selectedEventId}
                      onSelect={onSelect}
                    />
                  ),
                )}
              </ol>
            </section>
          ))}
        </div>
      ) : null}
    </article>
  );
}

function TraceTrajectoryFoldRow({ row }: { row: TraceSemanticFoldRow }) {
  const lanes = (Object.entries(row.laneCounts) as [
    TraceTrajectoryLane,
    number,
  ][]).filter(([, count]) => count > 0);
  return (
    <li
      className="trace-fold-row"
      role="row"
      aria-rowindex={row.rowIndex}
    >
      <span className="trace-fold-icon" role="cell">
        <Layers size={13} aria-hidden="true" />
      </span>
      <span className="trace-fold-copy" role="cell">
        <strong>
          {formatNumber(row.count)} {traceTrajectoryCopy.fold.events}
        </strong>
        <small>
          {lanes.map(([lane, count]) => (
            <span key={lane}>
              {traceTrajectoryCopy.lanes[lane]} {formatNumber(count)}
            </span>
          ))}
        </small>
      </span>
      <span className="trace-fold-range" role="cell">
        <time dateTime={new Date(row.startMs).toISOString()}>
          {formatClock(row.startMs)}
        </time>
        <i aria-hidden="true">–</i>
        <time dateTime={new Date(row.endMs).toISOString()}>
          {formatClock(row.endMs)}
        </time>
      </span>
    </li>
  );
}

function TraceTrajectoryEventRow({
  rowIndex,
  event,
  selected,
  onSelect,
}: {
  rowIndex: number;
  event: TraceTrajectoryEvent;
  selected: boolean;
  onSelect: (eventId: string) => void;
}) {
  const summarySegments = traceTrajectorySummarySegments(event.summary);
  return (
    <li
      id={`trace-event-${event.event.id}`}
      role="row"
      aria-rowindex={rowIndex}
      aria-selected={selected}
      className={[
        `lane-${event.lane}`,
        event.status === "failed" ? "is-exception" : "",
        selected ? "is-selected" : "",
      ].join(" ")}
    >
      <button type="button" onClick={() => onSelect(event.event.id)}>
        <span className="trace-event-identity" role="cell">
          <span className="trace-event-role">{event.role}</span>
          <span className="trace-event-sequence">
            <i />#{String(event.event.seq).padStart(3, "0")}
          </span>
        </span>
        <span className="trace-event-copy" role="cell">
          <span className="trace-event-title">
            <strong>{event.label}</strong>
            <i className={`status-${event.status}`}>
              {traceTrajectoryCopy.statuses[event.status]}
            </i>
          </span>
          <small className="trace-event-summary-parts">
            {summarySegments.map((segment, index) => (
              <span key={`${segment}:${String(index)}`}>{segment}</span>
            ))}
          </small>
        </span>
        <span className="trace-event-meta" role="cell">
          {event.durationMs !== undefined ? (
            <strong>{formatTraceDuration(event.durationMs)}</strong>
          ) : null}
          <time dateTime={event.event.createdAt}>
            {formatTimestamp(event.event.createdAt)}
          </time>
          <ChevronDown size={15} aria-hidden="true" />
        </span>
      </button>
    </li>
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

function formatClock(milliseconds: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(milliseconds));
}

function shortRunId(runId: string): string {
  return runId.length > 17 ? `${runId.slice(0, 8)}…${runId.slice(-6)}` : runId;
}
