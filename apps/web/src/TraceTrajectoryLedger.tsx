import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Layers } from "lucide-react";

import type {
  TraceTrajectoryEvent,
  TraceTrajectoryLane,
  TraceTrajectoryRun,
} from "./trace-trajectory-model";
import { getLocale } from "./locale";
import { traceTrajectoryCopy } from "./trace-trajectory-copy";
import { traceTrajectoryReadableSummary } from "./trace-trajectory-presentation";
import {
  buildTraceRunSemanticCollection,
  type TraceSemanticFoldRow,
} from "./trace-semantic-rows";
import {
  createTraceVirtualLayout,
  createTraceVirtualWindow,
  TRACE_COMPACT_EVENT_ROW_HEIGHT_PX,
  TRACE_VIRTUAL_VIEWPORT_PX,
} from "./trace-virtual-window";

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
  const matchingTurns = useMemo(
    () =>
      run.turns
        .map((turn) => ({
          ...turn,
          events: turn.events.filter((event) =>
            visibleEventIds.has(event.event.id),
          ),
        }))
        .filter((turn) => turn.events.length > 0),
    [run.turns, visibleEventIds],
  );
  const collection = useMemo(
    () => buildTraceRunSemanticCollection(matchingTurns, { selectedEventId }),
    [matchingTurns, selectedEventId],
  );
  const open = forceOpen ? true : !collapsed;
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
        <TraceVirtualizedRunRows
          collection={collection}
          selectedEventId={selectedEventId}
          onSelect={onSelect}
        />
      ) : null}
    </article>
  );
}

function TraceVirtualizedRunRows({
  collection,
  selectedEventId,
  onSelect,
}: {
  collection: ReturnType<typeof buildTraceRunSemanticCollection>;
  selectedEventId: string | undefined;
  onSelect: (eventId: string) => void;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const compactRows = useCompactTraceRows();
  const layout = useMemo(
    () =>
      createTraceVirtualLayout(collection, {
        ...(compactRows
          ? { eventRowHeightPx: TRACE_COMPACT_EVENT_ROW_HEIGHT_PX }
          : {}),
      }),
    [collection, compactRows],
  );
  const window = createTraceVirtualWindow(
    layout,
    scrollTop,
    TRACE_VIRTUAL_VIEWPORT_PX,
  );
  useEffect(() => {
    if (!selectedEventId) return;
    const eventTop = layout.eventTopById.get(selectedEventId);
    const viewport = viewportRef.current;
    if (eventTop === undefined || !viewport) return;
    const viewportHeight = viewport.clientHeight || TRACE_VIRTUAL_VIEWPORT_PX;
    if (
      eventTop >= viewport.scrollTop &&
      eventTop < viewport.scrollTop + viewportHeight
    ) {
      return;
    }
    const nextTop = Math.max(0, eventTop - Math.round(viewportHeight * 0.35));
    viewport.scrollTop = nextTop;
    setScrollTop(nextTop);
  }, [layout, selectedEventId]);
  return (
    <div
      className="trace-run-turns"
      role="list"
      aria-label={traceTrajectoryCopy.rows}
      data-row-count={layout.totalRowCount}
      data-mounted-row-count={window.mountedRowCount}
    >
      <div
        className="trace-virtual-viewport"
        ref={viewportRef}
        tabIndex={0}
        style={{
          height: `${String(Math.min(layout.totalHeight, TRACE_VIRTUAL_VIEWPORT_PX))}px`,
        }}
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      >
        <div
          className="trace-virtual-canvas"
          style={{ height: `${String(layout.totalHeight)}px` }}
        >
          {window.items.map((item) =>
            item.kind === "turn" ? (
              <section
                className="trace-turn trace-virtual-turn"
                role="presentation"
                key={item.key}
                style={{
                  height: item.height,
                  transform: `translateY(${String(item.top)}px)`,
                }}
              >
                <header>
                  <span>{turnLabel(item.turnIndex)}</span>
                  <small>
                    {formatNumber(item.eventCount)} {traceTrajectoryCopy.events}
                  </small>
                </header>
              </section>
            ) : (
              <div
                className="trace-turn trace-virtual-rowgroup"
                role="presentation"
                key={item.key}
                style={{
                  height: item.height,
                  transform: `translateY(${String(item.top)}px)`,
                }}
              >
                {item.row.kind === "fold" ? (
                  <TraceTrajectoryFoldRow
                    row={item.row}
                    setSize={layout.totalRowCount}
                  />
                ) : (
                  <TraceTrajectoryEventRow
                    rowIndex={item.row.rowIndex}
                    setSize={layout.totalRowCount}
                    event={item.row.event}
                    selected={item.row.event.event.id === selectedEventId}
                    onSelect={onSelect}
                  />
                )}
              </div>
            ),
          )}
        </div>
      </div>
    </div>
  );
}

function useCompactTraceRows(): boolean {
  const query = "(max-width: 520px)";
  const [compact, setCompact] = useState(
    () =>
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia(query).matches,
  );
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia(query);
    const update = () => setCompact(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return compact;
}

function turnLabel(index: number): string {
  return index === 0
    ? traceTrajectoryCopy.setup
    : `${traceTrajectoryCopy.turn} ${formatNumber(index)}`;
}

function TraceTrajectoryFoldRow({
  row,
  setSize,
}: {
  row: TraceSemanticFoldRow;
  setSize: number;
}) {
  const lanes = (
    Object.entries(row.laneCounts) as [TraceTrajectoryLane, number][]
  ).filter(([, count]) => count > 0);
  return (
    <div
      className="trace-fold-row"
      role="listitem"
      aria-posinset={row.rowIndex}
      aria-setsize={setSize}
    >
      <span className="trace-fold-icon">
        <Layers size={13} aria-hidden="true" />
      </span>
      <span className="trace-fold-copy">
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
      <span className="trace-fold-range">
        <time dateTime={new Date(row.startMs).toISOString()}>
          {formatClock(row.startMs)}
        </time>
        <i aria-hidden="true">→</i>
        <time dateTime={new Date(row.endMs).toISOString()}>
          {formatClock(row.endMs)}
        </time>
      </span>
    </div>
  );
}

function TraceTrajectoryEventRow({
  rowIndex,
  setSize,
  event,
  selected,
  onSelect,
}: {
  rowIndex: number;
  setSize: number;
  event: TraceTrajectoryEvent;
  selected: boolean;
  onSelect: (eventId: string) => void;
}) {
  const readableSummary = traceTrajectoryReadableSummary(event);
  return (
    <div
      id={`trace-event-${event.event.id}`}
      role="listitem"
      aria-posinset={rowIndex}
      aria-setsize={setSize}
      className={[
        `lane-${event.lane}`,
        `role-${event.role.toLocaleLowerCase()}`,
        event.status === "failed" ? "is-exception" : "",
        selected ? "is-selected" : "",
      ].join(" ")}
      data-turn={event.turnIndex}
    >
      <button
        type="button"
        aria-expanded={selected}
        onClick={() => onSelect(event.event.id)}
      >
        <span className="trace-event-identity">
          <span className="trace-event-role">{event.role}</span>
          <span className="trace-event-sequence">
            #{String(event.event.seq).padStart(3, "0")}
          </span>
        </span>
        <span className="trace-event-copy">
          <strong>{readableSummary}</strong>
          {readableSummary !== event.label ? (
            <small>{event.label}</small>
          ) : null}
        </span>
        <span className="trace-event-meta">
          <i className={`status-${event.status}`}>
            {traceTrajectoryCopy.statuses[event.status]}
          </i>
          {event.durationMs !== undefined ? (
            <strong>{formatTraceDuration(event.durationMs)}</strong>
          ) : null}
          <time dateTime={event.event.createdAt}>
            {formatTimestamp(event.event.createdAt)}
          </time>
          <ChevronRight size={13} aria-hidden="true" />
        </span>
      </button>
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
